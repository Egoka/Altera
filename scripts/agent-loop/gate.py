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
        return {'version': 1, 'tasks': {}, 'slot': None, 'events': {}, 'runs': [], 'completed': {}, 'docs_only': {}}
    state = json.loads(path.read_text())
    require(isinstance(state, dict) and state.get('version') == 1 and
            all(k in state for k in ('tasks', 'slot', 'events', 'runs', 'completed', 'docs_only')),
            'invalid state schema; refusing reset')
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


def validate_finish(root, slot, p, report_path, state):
    require(report_path == p['report'], 'report is not paired with active plan')
    report = json_file(root, report_path, 'docs/reports')
    human_report = report_path[:-10] + '.md'
    safe_file(root, human_report, 'docs/reports')
    if 'report_hashes' in slot:
        require(slot['report_hashes'] == {name: digest(safe_file(root, name).read_bytes())
                                         for name in (report_path, human_report)}, 'completed report changed')
    snap = boundary(root, p)
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
    return snap


def dispatch(args, root, state):
    action = args.action
    root_key = str(root)
    if action == 'status':
        return state
    if action == 'docs-only':
        require(not state['slot'], 'global slot is occupied')
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
        require(all(s in task['completed_stages'] for s in stage_names[:position]), 'previous stage incomplete')
        require(args.stage not in task['completed_stages'], 'stage already completed')
        require(all(task['stage_revisions'][name] == snap for name in stage_names[:position]),
                'previous stage evidence belongs to an obsolete revision')
        for name in stage_names[:position]:
            for event in task['stage_evidence'][name]:
                entry = state['events'][event]
                require(proof(root, entry['path'], p)[1] == entry['hashes'],
                        'previous stage evidence/output/trace changed')
        checks = task['checks'].setdefault(args.stage, {})
        for check in p['stages'][position]['checks']:
            entry = checks.setdefault(check['check_id'], {'failures': 0})
            require(entry['failures'] < 2, 'check stopped after two failures: ' + check['check_id'])
        slot = {'root': root_key, 'task': p['task'], 'stage': args.stage, 'actor': args.actor,
                'run': args.run, 'passport': args.passport, 'passport_hash': phash, 'evidence': [],
                'lease': {'owner': args.actor, 'run': args.run, 'automatic_expiry': False}}
        require(snap == boundary(root, p), 'revision changed while acquiring slot')
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
        return {'result': 'contract_valid', 'task_acceptance': 'not_checked'}
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
    record = subs.add_parser('record', help='Record immutable evidence and persistent check failure count')
    record.add_argument('evidence')
    record.add_argument('--event', required=True)
    finish = subs.add_parser('finish', help='Validate paired report; release slot without granting acceptance')
    finish.add_argument('report')
    release = subs.add_parser('release', help='Owner releases slot without completing stage; counters retained')
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
