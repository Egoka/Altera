#!/usr/bin/env python3
"""Кооперативная проверка контрактов и состояния с отказом при ошибке. Это не security boundary."""
import argparse
from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile

PRODUCT = ('server', 'web', 'packages')
IDENTIFIER = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
SHA = re.compile(r'^[0-9a-f]{40}$')
FINGERPRINT = re.compile(r'^(clean|sha256:[0-9a-f]{64})$')


class Rejected(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Rejected(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def relative(value):
    require(isinstance(value, str) and value and '\\' not in value, 'invalid relative path')
    path = PurePosixPath(value)
    require(not path.is_absolute() and '..' not in path.parts and str(path) == value,
            'path must be normalized and repository relative')
    require(path.parts[0] != '.git', 'git metadata is not an artifact or scope')
    return path


def safe_file(root, value, prefix=None):
    path = relative(value)
    if prefix:
        require(value.startswith(prefix + '/'), 'artifact outside required directory: ' + prefix)
    current = root
    for part in path.parts:
        current = current / part
        require(not current.is_symlink(), 'symlink artifact/path component rejected')
    require(current.is_file(), 'missing artifact: ' + value)
    return current


def json_file(root, value, prefix=None):
    data = json.loads(safe_file(root, value, prefix).read_text())
    require(isinstance(data, dict), 'JSON artifact must be an object')
    return data


def git(root, *args):
    proc = subprocess.run(['git', '-C', str(root), *args], capture_output=True)
    require(proc.returncode == 0, 'git operation failed: ' + args[0])
    return proc.stdout


def revision(root):
    return git(root, 'rev-parse', 'HEAD').decode().strip()


def scope_paths(values):
    require(isinstance(values, list) and bool(values), 'scope must be a nonempty array')
    require(len(values) == len(set(values)), 'duplicate scope path')
    for value in values:
        relative(value)
        require(value != '.' and not value.startswith('docs/reports') and
                not value.startswith('docs/plans'), 'scope cannot include gate artifacts')
    return values


def covered(path, scope):
    return any(path == item or path.startswith(item + '/') for item in scope)


def names(data):
    return [entry.decode() for entry in data.split(b'\0') if entry]


def changed_product(root, baseline):
    return set(names(git(root, 'diff', '--name-only', '-z', '--no-renames', baseline, 'HEAD', '--', *PRODUCT)) +
               names(git(root, 'diff', '--name-only', '-z', '--no-renames', 'HEAD', '--', *PRODUCT)) +
               names(git(root, 'diff', '--cached', '--name-only', '-z', '--no-renames', '--', *PRODUCT)) +
               names(git(root, 'ls-files', '--others', '--exclude-standard', '-z', '--', *PRODUCT)))


def validate_baseline(root, baseline):
    require(isinstance(baseline, str) and SHA.fullmatch(baseline), 'full baseline SHA required')
    require(git(root, 'rev-parse', baseline + '^{commit}').decode().strip() == baseline,
            'baseline must be a commit')
    git(root, 'merge-base', '--is-ancestor', baseline, 'HEAD')


def snapshot_once(root, scope):
    head = revision(root)
    staged = git(root, 'diff', '--cached', '--binary', '--no-ext-diff', '--', *scope)
    working = git(root, 'diff', '--binary', '--no-ext-diff', '--', *scope)
    untracked = []
    for name in sorted(names(git(root, 'ls-files', '--others', '--exclude-standard', '-z', '--', *scope))):
        path = root / name
        # При вычислении fingerprint нового продуктового файла не читаем цель symlink.
        content = os.readlink(path).encode() if path.is_symlink() else safe_file(root, name).read_bytes()
        untracked.append([name, path.lstat().st_mode, digest(content)])
    dirty = 'clean' if not staged and not working and not untracked else 'sha256:' + digest(encoded({
        'staged': digest(staged), 'working': digest(working), 'untracked': untracked}))
    return {'revision_commit': head, 'dirty_fingerprint': dirty}


def snapshot(root, scope):
    first = snapshot_once(root, scope)
    require(first == snapshot_once(root, scope), 'tree changed during fingerprint collection')
    return first


def boundary(root, passport):
    validate_baseline(root, passport['baseline_commit'])
    require(all(covered(path, passport['scope']) for path in changed_product(root, passport['baseline_commit'])),
            'product changes outside passport scope')
    return snapshot(root, passport['scope'])


def load_passport(root, path):
    p = json_file(root, path, 'docs/plans')
    for key in ('task', 'multica_issue', 'goal', 'contract_sources', 'baseline_commit', 'baseline_tree',
                'scope', 'preserved_contract', 'dependencies', 'authorization', 'acceptance', 'unknowns', 'stages',
                'plan', 'report'):
        require(key in p, 'passport missing ' + key)
    for key in ('task', 'goal', 'authorization', 'preserved_contract', 'multica_issue'):
        require(isinstance(p[key], str) and p[key].strip(), 'empty passport ' + key)
    require(IDENTIFIER.fullmatch(p['task']), 'invalid task ID')
    require(isinstance(p['contract_sources'], list) and p['contract_sources'] and
            all(isinstance(item, str) and item.strip() for item in p['contract_sources']),
            'contract_sources must identify at least one source')
    require(isinstance(p['dependencies'], list) and isinstance(p['unknowns'], list),
            'dependencies and unknowns must be arrays')
    require(path.endswith('.gate.json'), 'passport filename must end in .gate.json')
    slug = Path(path).name[:-10]
    require(path == 'docs/plans/' + slug + '.gate.json' and
            p['plan'] == 'docs/plans/' + slug + '.md' and
            p['report'] == 'docs/reports/' + slug + '-report.gate.json', 'unpaired plan/report')
    safe_file(root, p['plan'], 'docs/plans')
    scope_paths(p['scope'])
    require(isinstance(p['baseline_tree'], str) and FINGERPRINT.fullmatch(p['baseline_tree']),
            'baseline_tree requires clean or sha256 fingerprint')
    require(isinstance(p['acceptance'], dict) and p['acceptance'] and
            all(re.fullmatch(r'AC-[0-9]+', k) and isinstance(v, str) and v.strip()
                for k, v in p['acceptance'].items()), 'named acceptance criteria required')
    require(isinstance(p['stages'], list) and p['stages'], 'stages required')
    seen = set()
    criteria = set()
    for stage in p['stages']:
        require(isinstance(stage, dict) and IDENTIFIER.fullmatch(stage.get('name', '')) and
                stage['name'] not in seen, 'invalid or duplicate stage')
        seen.add(stage['name'])
        checks = stage.get('checks')
        require(isinstance(checks, list) and checks, 'named stage checks required')
        ids = set()
        for check in checks:
            require(isinstance(check, dict) and IDENTIFIER.fullmatch(check.get('check_id', '')) and
                    check['check_id'] not in ids and check.get('criterion') in p['acceptance'],
                    'invalid/duplicate check or unknown criterion')
            ids.add(check['check_id'])
            criteria.add(check['criterion'])
    require(criteria == set(p['acceptance']), 'acceptance criterion has no declared check')
    validate_lifecycle(p)
    return p


def passport_hash(root, path, passport):
    return digest(encoded(passport) + safe_file(root, passport['plan']).read_bytes())


def store_directory(root):
    common = Path(git(root, 'rev-parse', '--git-common-dir').decode().strip())
    if not common.is_absolute():
        common = root / common
    common = common.resolve()
    directory = common / 'agent-loop'
    require(not directory.is_symlink(), 'state directory symlink rejected')
    directory.mkdir(exist_ok=True, mode=0o700)
    return directory


@contextmanager
def locked(directory):
    lock = directory / 'lock'
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError:
        raise Rejected('state lock held; inspect owner/process, no automatic force unlock')
    try:
        (lock / 'owner.json').write_text(json.dumps({'pid': os.getpid(), 'cwd': os.getcwd()}))
        yield
    finally:
        (lock / 'owner.json').unlink(missing_ok=True)
        lock.rmdir()


def read_state(directory):
    path = directory / 'state.json'
    require(not path.is_symlink(), 'state symlink rejected')
    if not path.exists():
        return {'version': 3, 'tasks': {}, 'parent': None, 'slot': None, 'events': {}, 'runs': [], 'completed': {}, 'docs_only': {}}
    state = json.loads(path.read_text())
    require(isinstance(state, dict) and state.get('version') == 3 and
            all(k in state for k in ('tasks', 'parent', 'slot', 'events', 'runs', 'completed', 'docs_only')),
            'invalid or unsupported state schema; refusing reset')
    require(all(isinstance(state[k], dict) for k in ('tasks', 'events', 'completed', 'docs_only')) and
            isinstance(state['runs'], list) and len(state['runs']) == len(set(state['runs'])) and
            all(isinstance(run, str) and IDENTIFIER.fullmatch(run) for run in state['runs']),
            'corrupt state collections; refusing reset')
    for task_id, task in state['tasks'].items():
        require(isinstance(task, dict) and isinstance(task.get('passport_hash'), str) and
                isinstance(task.get('checks'), dict), 'corrupt retained task')
        for checks in task['checks'].values():
            require(isinstance(checks, dict) and all(isinstance(c, dict) and
                    type(c.get('failures')) is int and c['failures'] >= 0 for c in checks.values()),
                    'corrupt persistent failure counters')
        if task.get('lifecycle'):
            require(all(k in task for k in ('iteration', 'history', 'current_stages', 'relations',
                    'anchor', 'verification_target', 'pending_publication', 'used_remedies', 'contract_hashes')) and
                    type(task['iteration']) is int and task['iteration'] >= 0 and
                    isinstance(task['history'], list) and len(task['history']) == len(set(task['history'])) and
                    all(event in state['events'] for event in task['history']) and
                    isinstance(task['current_stages'], dict) and isinstance(task['relations'], list) and
                    isinstance(task['anchor'], dict) and isinstance(task['used_remedies'], list),
                    'corrupt lifecycle history; refusing reset')
        else:
            require(all(k in task for k in ('completed_stages', 'stage_revisions', 'stage_evidence')),
                    'corrupt legacy-profile task')
    for owner in (state['parent'], state['slot']):
        require(owner is None or (isinstance(owner, dict) and owner.get('task') in state['tasks'] and
                all(isinstance(owner.get(k), str) for k in ('root', 'passport', 'passport_hash'))),
                'corrupt parent/slot ownership')
    if state['slot']:
        require(state['parent'] and state['slot']['task'] == state['parent']['task'] and
                state['slot'].get('run') in state['runs'] and isinstance(state['slot'].get('evidence'), list) and
                all(event in state['events'] for event in state['slot']['evidence']), 'corrupt active slot')
    return state


def save_state(directory, state):
    fd, name = tempfile.mkstemp(prefix='state-', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encoded(state))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, directory / 'state.json')
        fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def active(root, state):
    slot = state['slot']
    require(slot and slot['root'] == str(root), 'no owned active passport in this checkout')
    p = load_passport(root, slot['passport'])
    require(passport_hash(root, slot['passport'], p) == slot['passport_hash'], 'passport or plan changed')
    return slot, p


def check_binding(data, slot, p, snap):
    expected = {'task': p['task'], 'stage': slot['stage'], 'actor': slot['actor'], 'run': slot['run'],
                'baseline_commit': p['baseline_commit'], **snap}
    require(all(data.get(k) == value for k, value in expected.items()), 'artifact ownership or revision mismatch')


def proof(root, path, passport):
    prefix = 'docs/reports/evidence/' + Path(passport['plan']).stem
    raw = safe_file(root, path, prefix).read_bytes()
    e = json.loads(raw)
    require(isinstance(e, dict), 'evidence must be an object')
    for key in ('cwd', 'environment', 'command', 'started_at', 'exit_code', 'executed', 'result',
                'output', 'trace_ref', 'limits', 'criterion', 'check_id'):
        require(key in e, 'evidence missing ' + key)
    require(e['cwd'] == str(root), 'evidence cwd mismatch')
    for key in ('environment', 'command', 'limits'):
        require(isinstance(e[key], str) and e[key].strip(), 'empty evidence ' + key)
    require(isinstance(e['started_at'], str) and
            datetime.fromisoformat(e['started_at'].replace('Z', '+00:00')).tzinfo is not None,
            'timestamp needs timezone')
    require(type(e['exit_code']) is int and type(e['executed']) is int and e['executed'] > 0,
            'actual exit code and positive executed count required')
    require(e['result'] in ('passed', 'failed', 'blocked', 'not_run', 'not_applicable'), 'unknown result')
    red = e.get('purpose') == 'tdd_red'
    if red:
        require(e['result'] == 'passed' and type(e.get('expected_exit_code')) is int and
                e['expected_exit_code'] != 0 and e['exit_code'] == e['expected_exit_code'],
                'expected RED must reproduce the declared nonzero exit')
    elif e['result'] == 'passed':
        require(e['exit_code'] == 0, 'passing implementation check must exit zero')
    elif e['result'] == 'failed':
        require(e['exit_code'] != 0, 'failed check needs nonzero exit')
    hashes = {path: digest(raw)}
    for key in ('output', 'trace_ref'):
        artifact = safe_file(root, e[key], prefix)
        require(artifact.stat().st_size > 0, 'empty output or trace')
        hashes[e[key]] = digest(artifact.read_bytes())
    return e, hashes


def validate_prerequisites(root, p, stage_name, task, snap, state):
    stage_names = [stage['name'] for stage in p['stages']]
    previous = stage_names[:stage_names.index(stage_name)]
    require(all(name in task['completed_stages'] for name in previous), 'previous stage incomplete')
    require(all(task['stage_revisions'][name] == snap for name in previous),
            'previous stage evidence belongs to an obsolete revision')
    for name in previous:
        for event in task['stage_evidence'][name]:
            entry = state['events'][event]
            require(proof(root, entry['path'], p)[1] == entry['hashes'],
                    'previous stage evidence/output/trace changed')


def validate_finish(root, slot, p, report_path, state):
    require(report_path == p['report'], 'report is not paired with active plan')
    report = json_file(root, report_path, 'docs/reports')
    human_report = report_path[:-10] + '.md'
    safe_file(root, human_report, 'docs/reports')
    if 'report_hashes' in slot:
        require(slot['report_hashes'] == {name: digest(safe_file(root, name).read_bytes())
                                         for name in (report_path, human_report)}, 'completed report changed')
    snap = boundary(root, p)
    validate_prerequisites(root, p, slot['stage'], state['tasks'][p['task']], snap, state)
    check_binding(report, slot, p, snap)
    require(report.get('plan') == slot['passport'] and report.get('evidence') == slot['evidence'],
            'report plan/evidence mismatch')
    require(report.get('native_outcome') in ('success', 'failed', 'blocked', 'cancelled', 'unknown') and
            report.get('stage_outcome') == 'completed' and report.get('task_acceptance') == 'not_checked',
            'contract gate cannot grant task acceptance')
    checks = next(s['checks'] for s in p['stages'] if s['name'] == slot['stage'])
    for check in checks:
        found = None
        for event in slot['evidence']:
            entry = state['events'][event]
            e, hashes = proof(root, entry['path'], p)
            require(hashes == entry['hashes'], 'recorded evidence/output/trace changed')
            check_binding(e, slot, p, snap)
            if e['check_id'] == check['check_id']:
                found = e
        require(found and found['result'] == 'passed' and found.get('purpose') != 'tdd_red',
                'stage lacks current passing implementation evidence: ' + check['check_id'])
    require(snap == boundary(root, p), 'revision changed while validating report')
    validate_prerequisites(root, p, slot['stage'], state['tasks'][p['task']], snap, state)
    return snap


def lifecycle(p):
    return any(s.get('kind', 'verification') != 'verification' for s in p['stages'])


def stage_spec(p, name):
    return next(s for s in p['stages'] if s['name'] == name)


def validate_lifecycle(p):
    kinds = [s.get('kind', 'verification') for s in p['stages']]
    require(all(k in ('contract', 'implementation', 'verification', 'publication') for k in kinds),
            'unknown stage kind')
    if not lifecycle(p):
        require(not any('return_to' in s for s in p['stages']), 'return requires implementation')
        return
    require(kinds.count('implementation') == 1, 'lifecycle requires one implementation stage')
    implementation = kinds.index('implementation')
    require(all(k == 'contract' for k in kinds[:implementation]) and
            all(k in ('verification', 'publication') for k in kinds[implementation + 1:]) and
            implementation + 1 < len(kinds) and kinds[implementation + 1] == 'verification',
            'invalid lifecycle order')
    for index, stage in enumerate(p['stages']):
        if 'return_to' in stage:
            require(kinds[index] == 'verification' and 'publication' not in kinds[:index] and
                    stage['return_to'] == p['stages'][implementation]['name'], 'invalid return target')
        if kinds[index] == 'publication':
            require(index > implementation + 1 and kinds[index - 1] == 'verification' and
                    index + 1 < len(kinds) and kinds[index + 1] == 'verification',
                    'publication requires preceding source checks and following docs verification')
    paths = p.get('publication_paths', [])
    require(isinstance(paths, list) and len(paths) == len(set(paths)), 'invalid publication paths')
    if 'publication' in kinds:
        require(paths, 'publication needs exact metadata paths')
    for path in paths:
        relative(path)
        require(path.startswith('docs/') and Path(path).suffix == '.md' and
                not path.startswith(('docs/plans/', 'docs/reports/')) and
                not any(c in path for c in '*?[') and covered(path, p['scope']),
                'publication requires exact scoped metadata files, never policy/config/source')


def artifact_prefix(p):
    return 'docs/reports/evidence/' + Path(p['plan']).stem


def is_artifact(path, p):
    return path in (p['plan'], p['plan'][:-3] + '.gate.json', p['report'], p['report'][:-10] + '.md') or \
        path.startswith(artifact_prefix(p) + '/')


def protected_snapshot(root, p):
    excludes = [':(exclude)' + name for name in p.get('publication_paths', [])]
    return snapshot(root, p['scope'] + excludes)


def committed_paths(root, before, after):
    git(root, 'merge-base', '--is-ancestor', before, after)
    return sorted(names(git(root, 'diff', '--name-only', '--no-renames', '-z', before, after)))


def checked_hashes(root, hashes):
    require(isinstance(hashes, dict), 'invalid proof hash map')
    require(all(digest(safe_file(root, path).read_bytes()) == value for path, value in hashes.items()),
            'immutable evidence/report/output/trace changed')


def historical_proofs(root, p, task, state):
    checked_hashes(root, task['contract_hashes'])
    for event in task['history']:
        item = state['events'][event]
        checked_hashes(root, item.get('hashes', {}))
    for name, completed in task['current_stages'].items():
        require(completed['stage'] == name, 'corrupt stage history')
        checked_hashes(root, completed['archives'])


def equivalent(task, before, after, publication=False):
    if before == after:
        return True
    reachable = [before]
    for edge in task['relations']:
        if edge['from'] in reachable and (edge['kind'] == 'artifacts' or publication):
            reachable.append(edge['to'])
    return after in reachable


def lifecycle_prerequisites(root, p, task, stage, snap, state, writing=False):
    historical_proofs(root, p, task, state)
    stages = [s['name'] for s in p['stages']]
    previous = stages[:stages.index(stage)]
    require(all(name in task['current_stages'] for name in previous), 'previous stage incomplete')
    if not writing:
        require(equivalent(task, task['anchor'], snap), 'source anchor is stale; explicit binding required')
    for name in previous:
        item = task['current_stages'][name]
        if stage_spec(p, name).get('kind') != 'contract' and not writing:
            require(equivalent(task, item['output'], snap, publication=True),
                    'previous source/publication proof is stale')
    pending = task['pending_publication']
    if pending:
        require(stages.index(stage) == stages.index(pending['stage']) + 1,
                'independent docs verification required before subsequent stages')


def write_boundary(root, p, slot, snap, publication=False):
    allowed = p.get('publication_paths', []) if publication else p['scope']
    paths = committed_paths(root, slot['input']['revision_commit'], snap['revision_commit'])
    require(all(is_artifact(path, p) or (path in allowed if publication else covered(path, allowed))
                for path in paths), 'writing stage changed a path outside its frozen write-set')
    # Dirty changes outside this stage's write-set cannot be smuggled through a commit later.
    excluded = [':(exclude)' + name for name in allowed]
    outside = snapshot(root, ['.'] + excluded + [':(exclude)' + p['plan'],
        ':(exclude)' + p['plan'][:-3] + '.gate.json', ':(exclude)' + p['report'],
        ':(exclude)' + p['report'][:-10] + '.md', ':(exclude)' + artifact_prefix(p)])
    require(outside['dirty_fingerprint'] == slot['outside_dirty'], 'dirty change outside stage write-set')
    if publication:
        require(protected_snapshot(root, p)['dirty_fingerprint'] == slot['protected_dirty'],
                'protected source dirty fingerprint changed')
        for path in allowed:
            require(not (root / path).is_dir(), 'publication path is a directory')
            if (root / path).exists() or (root / path).is_symlink():
                safe_file(root, path)
    return paths


def stage_outside_dirty(root, p, stage):
    allowed = p.get('publication_paths', []) if stage.get('kind') == 'publication' else p['scope']
    excludes = [':(exclude)' + name for name in allowed]
    return snapshot(root, ['.'] + excludes + [':(exclude)' + p['plan'],
        ':(exclude)' + p['plan'][:-3] + '.gate.json', ':(exclude)' + p['report'],
        ':(exclude)' + p['report'][:-10] + '.md', ':(exclude)' + artifact_prefix(p)])['dirty_fingerprint']


def lifecycle_current(root, p, task, slot, state):
    snap = boundary(root, p)
    kind = stage_spec(p, slot['stage']).get('kind', 'verification')
    writing = kind in ('implementation', 'publication')
    lifecycle_prerequisites(root, p, task, slot['stage'], snap, state, writing)
    if writing:
        write_boundary(root, p, slot, snap, kind == 'publication')
    else:
        require(equivalent(task, slot['input'], snap), 'pinned verification input changed')
    return snap


def lifecycle_binding(data, slot, p, snap, task):
    original = {key: data.get(key) for key in ('revision_commit', 'dirty_fingerprint')}
    require(equivalent(task, original, snap), 'artifact revision has no strict equivalence proof')
    check_binding(data, slot, p, original)


def lifecycle_archives(root, p, slot):
    prefix = artifact_prefix(p) + '/stages/' + slot['stage'] + '/' + slot['run'] + '-report'
    paths = {p['report']: prefix + '.gate.json', p['report'][:-10] + '.md': prefix + '.md'}
    hashes = {}
    for canonical, archive in paths.items():
        content = safe_file(root, canonical).read_bytes()
        require(content == safe_file(root, archive).read_bytes(), 'missing or mismatched immutable stage archive')
        hashes[archive] = digest(content)
    return hashes


def publication_relation(root, p, slot, snap):
    paths = [path for path in committed_paths(root, slot['input']['revision_commit'], snap['revision_commit'])
             if not is_artifact(path, p)]
    require(snapshot(root, p['publication_paths'])['dirty_fingerprint'] == 'clean',
            'commit proposed metadata before publication evidence')
    blobs = {}
    for path in paths:
        values = []
        for head in (slot['input']['revision_commit'], snap['revision_commit']):
            result = subprocess.run(['git', '-C', str(root), 'ls-tree', head, '--', path], capture_output=True)
            require(result.returncode == 0, 'cannot inspect metadata blob')
            values.append(result.stdout.decode().strip() or None)
        blobs[path] = values
    return {'kind': 'publication', 'from': slot['input'], 'to': snap, 'stage': slot['stage'],
            'actor': slot['actor'], 'run': slot['run'], 'paths': paths, 'blobs': blobs,
            'diff_sha256': digest(git(root, 'diff', '--binary', '--no-ext-diff', '--no-renames',
                slot['input']['revision_commit'], snap['revision_commit'], '--', *p['publication_paths'])),
            'protected_dirty': slot['protected_dirty']}


def docs_verdict(e, task, slot):
    pending = task['pending_publication']
    if pending:
        verdict = e.get('publication_review', {})
        require(slot['actor'] != pending['actor'] and slot['run'] != pending['run'] and
                verdict.get('relation') == pending and verdict.get('verdict') == 'supported_metadata' and
                verdict.get('preserved_contract') is True, 'missing independent exact-diff docs acceptance')


def lifecycle_event(state, task, event, entry):
    require(IDENTIFIER.fullmatch(event) and event not in state['events'], 'invalid or duplicate event ID')
    state['events'][event] = entry
    task['history'].append(event)


def lifecycle_report(root, p, task, slot, state, returned=False):
    snap = lifecycle_current(root, p, task, slot, state)
    report = json_file(root, p['report'])
    lifecycle_binding(report, slot, p, snap, task)
    require(report.get('plan') == slot['passport'] and report.get('evidence') == slot['evidence'],
            'report plan/evidence mismatch')
    require(report.get('native_outcome') in ('success', 'failed', 'blocked', 'cancelled', 'unknown') and
            report.get('stage_outcome') == ('returned' if returned else 'completed') and
            report.get('task_acceptance') == ('return' if returned else 'not_checked'), 'invalid report outcome')
    archives = lifecycle_archives(root, p, slot)
    for check in stage_spec(p, slot['stage'])['checks']:
        latest = [state['events'][ev] for ev in slot['evidence']
                  if state['events'][ev]['check_id'] == check['check_id']]
        if not returned:
            require(latest, 'missing check evidence')
            e, hashes = proof(root, latest[-1]['path'], p)
            require(hashes == latest[-1]['hashes'], 'evidence changed')
            lifecycle_binding(e, slot, p, snap, task)
            require(e['result'] == 'passed' and e.get('purpose') != 'tdd_red' and
                    task['checks'][slot['stage']][check['check_id']]['failures'] == 0,
                    'stage lacks passing evidence or check remains stopped')
            docs_verdict(e, task, slot)
    require(snap == lifecycle_current(root, p, task, slot, state), 'revision changed during report check')
    require(archives == lifecycle_archives(root, p, slot), 'archive changed during report check')
    return report, snap, archives


def lifecycle_start(args, root, state, p, recovery=None):
    require(not state['slot'], 'global slot is occupied')
    for value in (args.actor, args.run, args.stage):
        require(isinstance(value, str) and IDENTIFIER.fullmatch(value), 'invalid actor/run/stage')
    require(args.run not in state['runs'], 'run ID already used')
    snap = boundary(root, p)
    phash = passport_hash(root, args.passport, p)
    parent = {'task': p['task'], 'root': str(root), 'passport': args.passport, 'passport_hash': phash}
    require(state['parent'] is None or state['parent'] == parent, 'another product parent is still reserved')
    task = state['tasks'].get(p['task'])
    if task is None:
        require(not recovery, 'no stopped task')
        require(p['baseline_tree'] == 'clean' or (p['baseline_commit'] == snap['revision_commit'] and
                p['baseline_tree'] == snap['dirty_fingerprint']), 'dirty baseline unavailable or mismatched')
        task = {'passport_hash': phash, 'lifecycle': True, 'checks': {}, 'iteration': 0,
                'history': [], 'current_stages': {}, 'relations': [], 'anchor': snap,
                'verification_target': None, 'pending_publication': None, 'used_remedies': [],
                'contract_hashes': {path: digest(safe_file(root, path).read_bytes())
                                    for path in (args.passport, p['plan'])}}
    require(task.get('lifecycle') and task['passport_hash'] == phash, 'existing task contract changed')
    stage = stage_spec(p, args.stage)
    require(args.stage not in task['current_stages'], 'stage already completed')
    lifecycle_prerequisites(root, p, task, args.stage, snap, state)
    checks = task['checks'].setdefault(args.stage, {})
    for check in stage['checks']:
        counter = checks.setdefault(check['check_id'], {'failures': 0})
        require(counter['failures'] < 2 or recovery is not None, 'check stopped after two failures')
    slot = {'root': str(root), 'task': p['task'], 'stage': args.stage, 'actor': args.actor,
            'run': args.run, 'passport': args.passport, 'passport_hash': phash, 'input': snap,
            'evidence': [], 'iteration': task['iteration'], 'protected_dirty': protected_snapshot(root, p)['dirty_fingerprint'],
            'outside_dirty': stage_outside_dirty(root, p, stage),
            'lease': {'owner': args.actor, 'run': args.run, 'automatic_expiry': False}}
    if recovery:
        slot['recovery'] = recovery
    require(snap == boundary(root, p), 'revision changed during acquisition')
    historical_proofs(root, p, task, state)
    state['tasks'][p['task']] = task
    state['parent'], state['slot'] = parent, slot
    state['runs'].append(args.run)
    state['completed'].pop(str(root), None)
    state['docs_only'].pop(str(root), None)
    return {'result': 'acquired', 'slot': slot}


def lifecycle_bind(args, root, state):
    p = load_passport(root, args.passport)
    task = state['tasks'][p['task']]
    parent = state['parent']
    require(parent and parent['root'] == str(root) and parent['task'] == p['task'] and
            parent['passport'] == args.passport and parent['passport_hash'] == passport_hash(root, args.passport, p),
            'no owning parent for artifact binding')
    owner = state['slot'] or task.get('last_owner')
    require(owner and (owner['actor'], owner['run']) == (args.actor, args.run), 'artifact binding owner mismatch')
    require(IDENTIFIER.fullmatch(args.event) and args.event not in state['events'], 'invalid or duplicate event ID')
    historical_proofs(root, p, task, state)
    before, snap = task['anchor'], boundary(root, p)
    paths = committed_paths(root, before['revision_commit'], snap['revision_commit'])
    require(paths and all(is_artifact(path, p) for path in paths), 'binding requires only own gate artifact changes')
    require(before['dirty_fingerprint'] == snap['dirty_fingerprint'], 'dirty checked source changed')
    for path in paths:
        if (root / path).exists() or (root / path).is_symlink():
            safe_file(root, path)
    edge = {'kind': 'artifacts', 'from': before, 'to': snap, 'paths': paths,
            'actor': args.actor, 'run': args.run, 'task': p['task'], 'contract': task['passport_hash'],
            'proof_events': list(task['history'])}
    task['relations'].append(edge)
    task['anchor'] = snap
    if state['slot']:
        lifecycle_current(root, p, task, state['slot'], state)
    historical_proofs(root, p, task, state)
    require(snap == boundary(root, p), 'revision changed during artifact binding')
    lifecycle_event(state, task, args.event, edge)
    return {'result': 'artifacts_bound', 'relation': edge, 'task_acceptance': 'not_checked'}


def lifecycle_recover(args, root, state):
    require(not state['slot'], 'active run must actually end before recover')
    parent = state['parent']
    require(parent and parent['root'] == str(root), 'no owning stopped parent')
    p = load_passport(root, parent['passport'])
    task = state['tasks'][p['task']]
    require(task.get('lifecycle') and passport_hash(root, parent['passport'], p) == task['passport_hash'],
            'recovery contract changed')
    data = json_file(root, args.evidence, artifact_prefix(p))
    snap = boundary(root, p)
    require(all(data.get(k) == v for k, v in {'task': p['task'], 'actor': args.actor, 'run': args.run,
            'baseline_commit': p['baseline_commit'], **snap}.items()), 'recovery ownership or snapshot mismatch')
    require(IDENTIFIER.fullmatch(args.event) and args.event not in state['events'], 'invalid or duplicate event ID')
    stop = state['events'].get(data.get('stop_event'), {})
    stage, check = data.get('stage'), data.get('check_id')
    counter = task['checks'][stage][check]
    require(counter['failures'] >= 2 and data.get('failures') == counter['failures'] and
            counter.get('stop_event') == data.get('stop_event') and stop.get('task') == p['task'] and
            stop.get('stage') == stage and stop.get('check_id') == check and
            stop.get('run') == data.get('old_run'), 'recovery must bind the current retained stop')
    cause = stop.get('cause', {})
    require(cause and data.get('cause') == cause['name'] and data.get('condition') == cause['condition'],
            'recovery requires the named observed stopping cause')
    require(all(data.get(key) is True for key in ('condition_removed', 'old_run_stopped',
                'no_live_duplicate', 'q_resolved', 'conflict_free')) and
            data.get('next_operation') == check, 'recovery conditions are not established')
    confirmer = data.get('confirmer', '')
    require(IDENTIFIER.fullmatch(confirmer) and confirmer not in (args.actor, stop['actor']),
            'independent confirmation required')
    remedy = safe_file(root, data['remediation'], artifact_prefix(p)).read_bytes()
    require(remedy and digest(remedy) != cause['observation_hash'] and digest(remedy) not in task['used_remedies'],
            'remediation must be new and not consumed/disproved')
    hashes = {args.evidence: digest(safe_file(root, args.evidence).read_bytes()), data['remediation']: digest(remedy)}
    historical_proofs(root, p, task, state)
    lifecycle_prerequisites(root, p, task, stage, snap, state)
    recovery = {'event': args.event, 'stop_event': data['stop_event'], 'check_id': check,
                'hashes': hashes, 'snapshot': snap, 'consumed': False}
    start_args = argparse.Namespace(passport=parent['passport'], actor=args.actor, run=args.run, stage=stage)
    lifecycle_start(start_args, root, state, p, recovery)
    checked_hashes(root, hashes)
    require(snap == boundary(root, p), 'recovery snapshot changed')
    task['used_remedies'].append(digest(remedy))
    lifecycle_event(state, task, args.event, {'kind': 'recover', 'task': p['task'], 'stage': stage,
        'actor': args.actor, 'run': args.run, 'hashes': hashes, 'stop_event': data['stop_event'],
        'failures': counter['failures'], 'snapshot': snap})
    return {'result': 'recovered', 'failures': counter['failures'], 'slot': state['slot']}


def lifecycle_dispatch(args, root, state):
    if args.action == 'bind-artifacts':
        return lifecycle_bind(args, root, state)
    if args.action == 'recover':
        return lifecycle_recover(args, root, state)
    if args.action == 'start':
        return lifecycle_start(args, root, state, load_passport(root, args.passport))
    completed = state['completed'].get(str(root)) if args.action == 'stop' and not state['slot'] else None
    if completed:
        slot = completed['slot']
        p = load_passport(root, slot['passport'])
        require(passport_hash(root, slot['passport'], p) == slot['passport_hash'], 'contract changed')
    else:
        slot, p = active(root, state)
    task = state['tasks'][p['task']]
    if args.action == 'release':
        require((args.actor, args.run) == (slot['actor'], slot['run']), 'lease owner mismatch')
        task['last_owner'] = {'actor': slot['actor'], 'run': slot['run']}
        lifecycle_event(state, task, 'release:' + slot['run'], {'kind': 'release', 'task': p['task'],
            'stage': slot['stage'], 'actor': slot['actor'], 'run': slot['run'],
            'stage_outcome': 'not_completed', 'native_outcome': 'unknown'})
        state['slot'] = None
        return {'result': 'released', 'stage_outcome': 'not_completed'}
    if args.action == 'record':
        require(IDENTIFIER.fullmatch(args.event) and args.event not in state['events'], 'invalid or duplicate event ID')
        snap = lifecycle_current(root, p, task, slot, state)
        e, hashes = proof(root, args.evidence, p)
        # New executions must name the actually observed current revision, never a future artifact SHA.
        check_binding(e, slot, p, snap)
        stage = stage_spec(p, slot['stage'])
        require({'check_id': e['check_id'], 'criterion': e['criterion']} in stage['checks'], 'undeclared check/criterion')
        docs_verdict(e, task, slot)
        counter = task['checks'][slot['stage']][e['check_id']]
        recovery = slot.get('recovery')
        if recovery and e['check_id'] == recovery['check_id']:
            require(not recovery['consumed'] and equivalent(task, recovery['snapshot'], snap), 'recovery already consumed or stale')
            checked_hashes(root, recovery['hashes'])
            recovery['consumed'] = True
        else:
            require(counter['failures'] < 2, 'check stopped after two failures')
        if e.get('purpose') != 'tdd_red':
            if e['result'] == 'passed':
                counter['failures'] = 0
                counter.pop('stop_event', None)
            elif e['result'] in ('failed', 'blocked'):
                counter['failures'] += 1
        entry = {'kind': 'check', 'path': args.evidence, 'hashes': hashes, 'check_id': e['check_id'],
                 'task': p['task'], 'stage': slot['stage'], 'run': slot['run'], 'actor': slot['actor'],
                 'result': e['result'], 'failures': counter['failures'], 'snapshot': snap,
                 'iteration': task['iteration'], 'native_outcome': e.get('native_outcome', 'unknown')}
        if e.get('cause'):
            cause = e['cause']
            require(all(isinstance(cause.get(k), str) and cause[k].strip() for k in ('name', 'condition', 'observation')),
                    'malformed stopping cause')
            observation = safe_file(root, cause['observation'], artifact_prefix(p)).read_bytes()
            require(observation, 'empty cause observation')
            entry['cause'] = {**cause, 'observation_hash': digest(observation)}
            entry['hashes'][cause['observation']] = digest(observation)
        if counter['failures'] >= 2:
            counter['stop_event'] = args.event
            entry['stage_outcome'] = 'stopped'
        require(snap == lifecycle_current(root, p, task, slot, state), 'snapshot changed during record')
        checked_hashes(root, entry['hashes'])
        slot['evidence'] = [ev for ev in slot['evidence'] if state['events'][ev]['check_id'] != e['check_id']]
        slot['evidence'].append(args.event)
        lifecycle_event(state, task, args.event, entry)
        if stage.get('kind') in ('implementation', 'publication'):
            task['anchor'] = snap
        return {'result': 'recorded', 'failures': counter['failures'], 'stopped': counter['failures'] >= 2}
    if args.action == 'return':
        require((args.actor, args.run) == (slot['actor'], slot['run']), 'return owner mismatch')
        stage = stage_spec(p, slot['stage'])
        handoff = json_file(root, args.evidence, artifact_prefix(p))
        require(stage.get('return_to') and handoff.get('return_to') == stage['return_to'], 'undeclared return target')
        require(handoff.get('iteration') == task['iteration'] and
                handoff.get('preserved_contract') == p['preserved_contract'] and
                isinstance(handoff.get('repair_direction'), str) and handoff['repair_direction'].strip(),
                'invalid return contract/direction')
        require(all(c['failures'] < 2 for checks in task['checks'].values() for c in checks.values()),
                'stopped checks cannot return to implementation')
        failures = handoff.get('failed_events')
        require(isinstance(failures, list) and failures and len(failures) == len(set(failures)), 'recorded failed events required')
        for event in failures:
            entry = state['events'].get(event, {})
            require(event in slot['evidence'] and entry.get('result') in ('failed', 'blocked') and
                    entry['task'] == p['task'] and entry['stage'] == slot['stage'] and entry['run'] == slot['run'] and
                    entry['actor'] == slot['actor'], 'return references foreign/unrecorded defect')
        require(handoff.get('failure_counts') == {k: v['failures'] for k, v in task['checks'][slot['stage']].items()},
                'return failure counts changed')
        defects = handoff.get('defects')
        require(isinstance(defects, list) and defects and all(isinstance(d, dict) and
                d.get('criterion') in p['acceptance'] and isinstance(d.get('location'), str) and
                covered(d['location'], p['scope']) and isinstance(d.get('detail'), str) and d['detail'].strip()
                for d in defects), 'concrete scoped AC defect required')
        report, snap, archives = lifecycle_report(root, p, task, slot, state, returned=True)
        require(report == handoff, 'return must match canonical archived report')
        hashes = {**archives, args.evidence: digest(safe_file(root, args.evidence).read_bytes())}
        lifecycle_event(state, task, args.event, {'kind': 'return', 'task': p['task'], 'stage': slot['stage'],
            'actor': slot['actor'], 'run': slot['run'], 'iteration': task['iteration'], 'snapshot': snap,
            'hashes': hashes, 'superseded': task['current_stages'], 'native_outcome': report['native_outcome'],
            'stage_outcome': 'returned', 'task_acceptance': 'return', 'failed_events': failures})
        task['current_stages'] = {name: item for name, item in task['current_stages'].items()
                                  if stage_spec(p, name).get('kind') == 'contract'}
        task['iteration'] += 1
        task['verification_target'] = None
        task['pending_publication'] = None
        task['last_owner'] = {'actor': slot['actor'], 'run': slot['run']}
        state['slot'] = None
        state['completed'].pop(str(root), None)
        return {'result': 'returned', 'iteration': task['iteration'], 'parent_retained': True}
    if args.action in ('finish', 'stop'):
        if args.action == 'finish':
            require(args.report == p['report'], 'report is not paired with active plan')
        report, snap, archives = lifecycle_report(root, p, task, slot, state)
        if completed:
            require(archives == slot['archives'], 'completed archive changed')
        final = slot['stage'] == p['stages'][-1]['name']
        if final:
            committed = dict(archives)
            for event in task['history']:
                committed.update(state['events'][event].get('hashes', {}))
            committed.update({path: digest(safe_file(root, path).read_bytes())
                              for path in (p['report'], p['report'][:-10] + '.md')})
            require(all(digest(git(root, 'show', snap['revision_commit'] + ':' + path)) == value
                        for path, value in committed.items()), 'final evidence/archives must be committed before finish')
        if args.action == 'stop':
            return {'result': 'contract_valid', 'task_acceptance': 'not_checked', 'slot_retained': bool(state['slot'])}
        kind = stage_spec(p, slot['stage']).get('kind', 'verification')
        if kind == 'publication':
            relation = publication_relation(root, p, slot, snap)
            task['relations'].append(relation)
            task['pending_publication'] = relation
        elif task['pending_publication']:
            task['pending_publication'] = None
        if kind == 'implementation':
            task['verification_target'] = snap
        completion = {'stage': slot['stage'], 'actor': slot['actor'], 'run': slot['run'],
                      'input': slot['input'], 'output': snap, 'archives': archives, 'evidence': list(slot['evidence'])}
        task['current_stages'][slot['stage']] = completion
        lifecycle_event(state, task, 'finish:' + slot['run'], {'kind': 'finish', 'task': p['task'],
            **completion, 'hashes': archives, 'iteration': task['iteration'],
            'native_outcome': report['native_outcome'], 'stage_outcome': 'completed', 'task_acceptance': 'not_checked'})
        task['anchor'] = snap
        task['last_owner'] = {'actor': slot['actor'], 'run': slot['run']}
        slot['archives'] = archives
        state['completed'][str(root)] = {'slot': slot}
        state['slot'] = None
        if final:
            require(len(task['current_stages']) == len(p['stages']), 'mandatory stages remain incomplete')
            state['parent'] = None
        return {'result': 'contract_valid', 'task_acceptance': 'not_checked', 'parent_retained': not final}
    raise Rejected('unsupported lifecycle action')


def dispatch(args, root, state):
    action = args.action
    root_key = str(root)
    typed = action in ('bind-artifacts', 'return', 'recover')
    if action == 'start':
        typed = lifecycle(load_passport(root, args.passport))
    elif action not in ('status', 'docs-only'):
        owner = state['slot'] or state['completed'].get(root_key, {}).get('slot')
        typed = typed or bool(owner and state['tasks'][owner['task']].get('lifecycle'))
    if typed:
        return lifecycle_dispatch(args, root, state)
    if action == 'status':
        return state
    if action == 'docs-only':
        require(not state['parent'] and not state['slot'], 'product parent is still reserved')
        validate_baseline(root, args.baseline)
        require(not changed_product(root, args.baseline), 'docs-only has product changes')
        state['docs_only'][root_key] = {'baseline': args.baseline, **snapshot(root, list(PRODUCT))}
        return {'result': 'docs_only', 'task_acceptance': 'not_checked'}
    if action == 'start':
        require(not state['slot'], 'global slot is occupied')
        for value in (args.actor, args.run, args.stage):
            require(IDENTIFIER.fullmatch(value), 'invalid actor/run/stage ID')
        require(args.run not in state['runs'], 'run ID already used')
        p = load_passport(root, args.passport)
        snap = boundary(root, p)
        phash = passport_hash(root, args.passport, p)
        parent = {'task': p['task'], 'root': root_key, 'passport': args.passport, 'passport_hash': phash}
        require(state['parent'] is None or state['parent'] == parent, 'another product parent is still reserved')
        task = state['tasks'].get(p['task'])
        if task:
            require(task['passport_hash'] == phash, 'existing task passport changed')
        else:
            if p['baseline_tree'] != 'clean':
                require(p['baseline_commit'] == snap['revision_commit'] and
                        p['baseline_tree'] == snap['dirty_fingerprint'], 'dirty baseline unavailable or mismatched')
            task = {'passport_hash': phash, 'checks': {}, 'completed_stages': [], 'stage_revisions': {}, 'stage_evidence': {}}
        stage_names = [s['name'] for s in p['stages']]
        require(args.stage in stage_names, 'unknown stage')
        position = stage_names.index(args.stage)
        require(args.stage not in task['completed_stages'], 'stage already completed')
        validate_prerequisites(root, p, args.stage, task, snap, state)
        checks = task['checks'].setdefault(args.stage, {})
        for check in p['stages'][position]['checks']:
            entry = checks.setdefault(check['check_id'], {'failures': 0})
            require(entry['failures'] < 2, 'check stopped after two failures: ' + check['check_id'])
        slot = {'root': root_key, 'task': p['task'], 'stage': args.stage, 'actor': args.actor,
                'run': args.run, 'passport': args.passport, 'passport_hash': phash, 'evidence': [],
                'lease': {'owner': args.actor, 'run': args.run, 'automatic_expiry': False}}
        require(snap == boundary(root, p), 'revision changed while acquiring slot')
        validate_prerequisites(root, p, args.stage, task, snap, state)
        state['parent'] = parent
        state['tasks'][p['task']] = task
        state['slot'] = slot
        state['runs'].append(args.run)
        state['completed'].pop(root_key, None)
        state['docs_only'].pop(root_key, None)
        return {'result': 'acquired', 'slot': slot}
    if action == 'stop':
        if state['slot']:
            slot, p = active(root, state)
            validate_finish(root, slot, p, p['report'], state)
            return {'result': 'contract_valid', 'task_acceptance': 'not_checked', 'slot_retained': True}
        completed = state['completed'].get(root_key)
        if completed:
            slot = completed['slot']
            p = load_passport(root, slot['passport'])
            require(passport_hash(root, slot['passport'], p) == slot['passport_hash'], 'passport changed')
            validate_finish(root, slot, p, p['report'], state)
            return {'result': 'contract_valid', 'task_acceptance': 'not_checked'}
        docs = state['docs_only'].get(root_key)
        require(docs and docs['revision_commit'] == revision(root) and
                not changed_product(root, docs['baseline']),
                'no active passport; use start or explicit docs-only --baseline SHA')
        return {'result': 'docs_only', 'task_acceptance': 'not_checked'}
    slot, p = active(root, state)
    if action == 'release':
        require((args.actor, args.run) == (slot['actor'], slot['run']), 'lease owner mismatch')
        state['slot'] = None
        return {'result': 'released', 'stage_outcome': 'not_completed'}
    if action == 'record':
        require(IDENTIFIER.fullmatch(args.event) and args.event not in state['events'], 'invalid or duplicate event ID')
        snap = boundary(root, p)
        validate_prerequisites(root, p, slot['stage'], state['tasks'][p['task']], snap, state)
        e, hashes = proof(root, args.evidence, p)
        check_binding(e, slot, p, snap)
        stage = next(s for s in p['stages'] if s['name'] == slot['stage'])
        require(any(c == {'check_id': e['check_id'], 'criterion': e['criterion']} for c in stage['checks']),
                'check/criterion absent from stage contract')
        counter = state['tasks'][p['task']]['checks'][slot['stage']][e['check_id']]
        require(counter['failures'] < 2, 'check stopped after two failures')
        if e.get('purpose') != 'tdd_red':
            if e['result'] == 'passed':
                counter['failures'] = 0
            elif e['result'] in ('failed', 'blocked'):
                counter['failures'] += 1
        require(snap == boundary(root, p) and hashes == proof(root, args.evidence, p)[1],
                'revision or evidence changed during record')
        validate_prerequisites(root, p, slot['stage'], state['tasks'][p['task']], snap, state)
        # В текущем отчёте остаётся последнее evidence каждой проверки; общая история сохраняется.
        slot['evidence'] = [event for event in slot['evidence']
                            if state['events'][event]['check_id'] != e['check_id']]
        slot['evidence'].append(args.event)
        state['events'][args.event] = {'path': args.evidence, 'hashes': hashes, 'check_id': e['check_id'],
                                      'task': p['task'], 'stage': slot['stage'], 'run': slot['run'],
                                      'actor': slot['actor'], 'result': e['result'], 'failures': counter['failures']}
        return {'result': 'recorded', 'failures': counter['failures'], 'stopped': counter['failures'] >= 2}
    if action == 'finish':
        report_hashes = {name: digest(safe_file(root, name).read_bytes())
                         for name in (args.report, args.report[:-10] + '.md')}
        snap = validate_finish(root, slot, p, args.report, state)
        require(report_hashes == {name: digest(safe_file(root, name).read_bytes())
                                  for name in report_hashes}, 'report changed during validation')
        slot['report_hashes'] = report_hashes
        state['tasks'][p['task']]['completed_stages'].append(slot['stage'])
        state['tasks'][p['task']]['stage_revisions'][slot['stage']] = snap
        state['tasks'][p['task']]['stage_evidence'][slot['stage']] = list(slot['evidence'])
        state['completed'][root_key] = {'slot': slot}
        state['slot'] = None
        if all(stage['name'] in state['tasks'][p['task']]['completed_stages'] for stage in p['stages']):
            state['parent'] = None
        return {'result': 'contract_valid', 'task_acceptance': 'not_checked',
                'parent_retained': state['parent'] is not None}
    raise Rejected('unsupported action')


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog='See docs/development/agent-loop-gate.md for JSON schemas and supported flow.')
    parser.add_argument('--root', default='.', help='Git checkout root (not a subdirectory)')
    subs = parser.add_subparsers(dest='action', required=True)
    snap = subs.add_parser('snapshot', help='Print HEAD and scoped staged/working/untracked fingerprint')
    snap.add_argument('--scope', nargs='+', default=list(PRODUCT))
    start = subs.add_parser('start', help='Validate passport and acquire shared cooperative slot')
    start.add_argument('passport')
    for flag in ('stage', 'actor', 'run'):
        start.add_argument('--' + flag, required=True)
    for command in ('bind-artifacts', 'return', 'recover'):
        transition = subs.add_parser(command, help='Explicit history-preserving lifecycle transition')
        transition.add_argument('passport' if command == 'bind-artifacts' else 'evidence')
        for flag in ('event', 'actor', 'run'):
            transition.add_argument('--' + flag, required=True)
    record = subs.add_parser('record', help='Record immutable evidence and persistent check failure count')
    record.add_argument('evidence')
    record.add_argument('--event', required=True)
    finish = subs.add_parser('finish', help='Validate report; release stage slot, retain parent until every stage finishes')
    finish.add_argument('report')
    release = subs.add_parser('release', help='Owner releases stage slot; parent reservation and counters retained')
    release.add_argument('--actor', required=True)
    release.add_argument('--run', required=True)
    docs = subs.add_parser('docs-only', help='Attest no product diff from explicit baseline; no product stage')
    docs.add_argument('--baseline', required=True)
    subs.add_parser('stop', help='Validate active/finished contract or explicit docs-only attestation')
    subs.add_parser('status', help='Read shared state without changing ownership')
    args = parser.parse_args()
    try:
        root = Path(args.root).resolve(strict=True)
        require(Path(git(root, 'rev-parse', '--show-toplevel').decode().strip()).resolve() == root,
                '--root must identify checkout root')
        if args.action == 'snapshot':
            result = snapshot(root, scope_paths(args.scope))
        else:
            directory = store_directory(root)
            with locked(directory):
                state = read_state(directory)
                result = dispatch(args, root, state)
                if args.action not in ('status', 'stop'):
                    save_state(directory, state)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (Rejected, OSError, ValueError, KeyError, TypeError, StopIteration) as exc:
        print(json.dumps({'result': 'rejected', 'error': str(exc)}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
