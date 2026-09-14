#!/usr/bin/python3 -I
"""Trusted native collector. No model-selected commands, paths, events or acceptance."""
import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
RUNTIME = HERE.parent / 'agent-runtime'
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}')


def module(path):
    spec = importlib.util.spec_from_file_location('collector_' + path.stem, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def require(condition, message):
    if not condition: raise ValueError(message)


def regular(path, maximum=1048576, private=False):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path and not path.is_symlink(), 'unsafe_file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                before.st_uid == os.getuid() and 0 < before.st_size <= maximum and
                not before.st_mode & 0o022 and (not private or stat.S_IMODE(before.st_mode) == 0o600), 'unsafe_file')
        raw = os.read(fd, maximum + 1); after = os.fstat(fd)
        identity = lambda x: (x.st_dev, x.st_ino, x.st_mode, x.st_nlink, x.st_uid, x.st_size, x.st_mtime_ns, x.st_ctime_ns)
        require(identity(before) == identity(after) and len(raw) == before.st_size, 'file_changed')
        return raw
    finally: os.close(fd)


def read(path):
    return json.loads(regular(path, private=True), object_pairs_hook=module(RUNTIME / 'native_adapter.py')._unique)


def directory(path):
    path = Path(path)
    if not path.exists(): path.mkdir(mode=0o700)
    return module(RUNTIME / 'native_adapter.py')._directory(path)


def publish(path, value):
    """Publish immutable bytes atomically. Existing journal entries are exact-idempotent."""
    path = Path(path); directory(path.parent)
    raw = encoded(value) + b'\n'
    if path.exists():
        require(regular(path, private=True) == raw, 'journal_conflict'); return sha(raw)
    temporary = path.parent / ('.publish-' + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream: stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.link(temporary, path)
    finally: temporary.unlink(missing_ok=True)
    fd = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
    return sha(raw)


def deployment(path, digest):
    config = module(RUNTIME / 'native_adapter.py')._private_json(path, digest)
    fields = {'schema_version', 'provider', 'workspace_id', 'agent_id', 'actor', 'server_url',
              'registry', 'source', 'modules', 'multica', 'checks', 'limits'}
    require(set(config) == fields and config['schema_version'] == 1, 'invalid_deployment')
    require(config['provider'] in ('claude', 'codex') and
            all(ID.fullmatch(config[k]) for k in ('workspace_id', 'agent_id', 'actor')), 'invalid_deployment')
    expected = {'collector': Path(__file__).resolve(), 'gate': HERE / 'gate.py',
                'runtime': RUNTIME / 'runtime.py', 'adapter': RUNTIME / 'native_adapter.py',
                'prepare': RUNTIME / 'prepare_native.py'}
    require(set(config['modules']) == set(expected), 'invalid_module_pins')
    for key, source in expected.items():
        require(config['modules'][key] == sha(regular(source)), 'module_changed')
    require(set(config['multica']) == {'path', 'sha256'} and
            sha(regular(config['multica']['path'], maximum=134217728)) == config['multica']['sha256'], 'multica_changed')
    require(config['limits'] == {'cli_seconds': 15, 'cli_bytes': 1048576}, 'invalid_limits')
    registry = directory(config['registry']); source = Path(config['source'])
    require(source.is_absolute() and source.resolve() == source and
            not registry.is_relative_to(source) and not source.is_relative_to(registry), 'registry_source_overlap')
    for key in ('pending', 'claimed', 'reconciled', 'locks'): directory(registry / key)
    config['_reference'] = {'config_path': str(path), 'config_sha256': digest,
                            'module_sha256': config['modules']['collector']}
    return config


@contextmanager
def pair_lock(config):
    lock = Path(config['registry']) / 'locks' / (config['workspace_id'] + '.' + config['agent_id'])
    lock.mkdir(mode=0o700)  # Never guess whether a leftover lock is stale.
    try: yield
    finally: lock.rmdir()


def pending_directory(config):
    workspace = directory(Path(config['registry']) / 'pending' / config['workspace_id'])
    return directory(workspace / config['agent_id'])


def bounded_process(argv, environment, timeout=15, maximum=1048576):
    import selectors
    import time
    process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=environment)
    selector = selectors.DefaultSelector(); outputs = {'out': bytearray(), 'err': bytearray()}
    selector.register(process.stdout, selectors.EVENT_READ, 'out')
    selector.register(process.stderr, selectors.EVENT_READ, 'err')
    started = time.monotonic()
    try:
        while selector.get_map():
            require(time.monotonic() - started < timeout, 'command_timeout')
            for key, _ in selector.select(0.1):
                data = os.read(key.fd, 65536)
                if not data: selector.unregister(key.fileobj); continue
                require(len(outputs['out']) + len(outputs['err']) + len(data) <= maximum, 'command_output_oversize')
                outputs[key.data].extend(data)
        code = process.wait(timeout=max(0.01, timeout - (time.monotonic() - started)))
        return code, bytes(outputs['out']), bytes(outputs['err'])
    finally:
        if process.poll() is None: process.kill(); process.wait(timeout=15)
        selector.close(); process.stdout.close(); process.stderr.close()


def gate_call(config, args, runner=None):
    argv = [sys.executable, '-I', str(HERE / 'gate.py'), '--root', config['source'], *args]
    if runner is not None: return runner(argv)
    code, output, _ = bounded_process(argv, {'PATH': '/usr/bin:/bin', 'HOME': '/var/empty'})
    require(code == 0, 'gate_refused')
    return json.loads(output)


def current(claim, runner=None, *, gate_validates_artifacts=False):
    config, ticket = claim['deployment'], claim['ticket']
    state = gate_call(config, ['status'], runner)
    slot = state.get('slot')
    require(slot is not None and all(slot.get(k) == ticket['slot'].get(k) for k in
        ('root', 'task', 'stage', 'actor', 'run', 'passport', 'passport_hash', 'input', 'iteration', 'lease')), 'gate_slot_changed')
    gate = module(HERE / 'gate.py'); root = Path(config['source'])
    passport = gate.load_passport(root, ticket['slot']['passport'])
    require(sha(regular(root / slot['passport'])) == ticket['passport_sha256'], 'gate_input_changed')
    if not gate_validates_artifacts:
        require(gate.snapshot(root, passport['scope']) == slot['input'], 'gate_input_changed')
    return state


def admit(config, request, gate_runner=None):
    require(set(request) == {'invocation_id', 'native_task_id', 'issue_id', 'passport', 'stage',
                            'run', 'prepare_request', 'allowed_transitions'}, 'invalid_admission')
    invocation = request['invocation_id']
    require(ID.fullmatch(invocation) and ID.fullmatch(request['run']), 'invalid_invocation')
    gate = module(HERE / 'gate.py'); root = Path(config['source'])
    passport = gate.load_passport(root, request['passport'])
    require(not passport['unknowns'], 'unresolved_passport')
    require(passport['multica_issue'] == request['issue_id'], 'issue_mismatch')
    stage = next(s for s in passport['stages'] if s['name'] == request['stage'])
    checks = []
    for check in stage['checks']:
        spec = config['checks'][check['check_id']]
        require(set(spec) == {'path', 'sha256'} and sha(regular(spec['path'])) == spec['sha256'], 'check_spec_changed')
        checks.append({**check, **spec, 'event_id': invocation + '-' + check['check_id']})
    require(set(request['allowed_transitions']) <= {'release', 'finish', 'return', 'bind-artifacts'}, 'invalid_transitions')
    with pair_lock(config):
        pending = pending_directory(config)
        require(not list(pending.iterdir()), 'pending_ticket_exists')
        for existing in (Path(config['registry']) / 'claimed').iterdir():
            old = read(existing / 'ticket.json')
            if old['workspace_id'] == config['workspace_id'] and old['agent_id'] == config['agent_id']:
                require((Path(config['registry']) / 'reconciled' / existing.name / 'terminal.json').exists(), 'unreconciled_invocation')
        require(not gate_call(config, ['status'], gate_runner)['slot'], 'gate_slot_occupied')
        gate_call(config, ['start', request['passport'], '--stage', request['stage'],
                          '--actor', config['actor'], '--run', request['run']], gate_runner)
        slot = gate_call(config, ['status'], gate_runner)['slot']
        require(slot['run'] == request['run'] and slot['actor'] == config['actor'], 'gate_acquisition_uncertain')
        preparation = dict(request['prepare_request'])
        preparation.update(invocation_id=invocation, native_task_id=request['native_task_id'],
            native_run_id=request['run'], actor=config['actor'], agent_id=config['agent_id'],
            workspace_id=config['workspace_id'], issue_id=request['issue_id'], source=config['source'],
            passport_path=str(root / request['passport']), passport_sha256=sha(regular(root / request['passport'])),
            gate={'task': slot['task'], 'stage': slot['stage'], 'run': slot['run'], 'lease': slot['lease']},
            gate_input=slot['input'], check_ids=[c['check_id'] for c in checks],
            criteria=[c['criterion'] for c in checks], event_ids={'claimed': invocation + ':claimed', 'observed': invocation + ':observed'})
        destination = Path(preparation.pop('destination'))
        result = module(RUNTIME / 'prepare_native.py').prepare(config['provider'], preparation, destination)
        adapter_ticket = read(result['pending_path']); adapter_ticket['collector'] = config['_reference']
        temporary = destination / 'collector-pending.json'; publish(temporary, adapter_ticket)
        os.replace(temporary, result['pending_path'])
        ticket = {'schema_version': 1, 'invocation_id': invocation, 'native_task_id': request['native_task_id'],
            'issue_id': request['issue_id'], 'provider': config['provider'], 'workspace_id': config['workspace_id'],
            'agent_id': config['agent_id'], 'actor': config['actor'], 'slot': slot,
            'passport_sha256': preparation['passport_sha256'], 'checks': checks,
            'allowed_transitions': request['allowed_transitions'], 'adapter_path': result['pending_path'],
            'adapter_sha256': sha(regular(result['pending_path'], private=True)), 'adapter_ticket': adapter_ticket}
        claim = {'deployment': config, 'ticket': ticket}
        current(claim, gate_runner)
        manifest = read(adapter_ticket['runtime_manifest'])
        registry = Path(config['registry'])
        require(all(not registry.is_relative_to(Path(manifest[k])) and not Path(manifest[k]).is_relative_to(registry)
                    for k in ('source', 'snapshot', 'policy', 'run_root')), 'registry_runtime_overlap')
        digest = publish(pending / (invocation + '.json'), ticket)
        return {'invocation_id': invocation, 'ticket_sha256': digest,
                'adapter_path': result['pending_path'], 'adapter_sha256': ticket['adapter_sha256']}


def bind(config, native_env, gate_runner=None):
    expected = {'MULTICA_WORKSPACE_ID': config['workspace_id'], 'MULTICA_AGENT_ID': config['agent_id'],
                'MULTICA_SERVER_URL': config['server_url']}
    require(all(native_env.get(k) == value for k, value in expected.items()), 'native_identity_mismatch')
    native_id = native_env.get('MULTICA_TASK_ID')
    require(isinstance(native_id, str) and ID.fullmatch(native_id), 'native_identity_mismatch')
    with pair_lock(config):
        entries = list(pending_directory(config).iterdir())
        require(len(entries) == 1, 'pending_missing_or_ambiguous')
        raw = regular(entries[0], private=True); ticket = read(entries[0])
        invocation = ticket['invocation_id']
        require(entries[0].name == invocation + '.json' and ID.fullmatch(invocation), 'invalid_ticket')
        claimed = Path(config['registry']) / 'claimed' / invocation
        claimed.mkdir(mode=0o700)
        os.rename(entries[0], claimed / 'ticket.json')
        directory(claimed / 'journal'); directory(claimed / 'observations')
        claim = {'deployment': config, 'ticket': ticket, 'directory': str(claimed),
                 'ticket_sha256': sha(raw), 'native_task_id': native_id}
        publish(claimed / 'binding.json', {'native_task_id': native_id, 'ticket_sha256': sha(raw)})
        require(ticket['native_task_id'] in (None, native_id), 'native_task_substitution')
        require(all(ticket[k] == config[k] for k in ('provider', 'workspace_id', 'agent_id', 'actor')), 'ticket_identity_mismatch')
        current(claim, gate_runner)
        publish(claimed / 'journal' / '01-bound.json', {'result': 'bound', 'native_task_id': native_id})
        return claim


def retained(config, invocation):
    require(ID.fullmatch(invocation), 'invalid_invocation')
    directory = Path(config['registry']) / 'claimed' / invocation
    binding = read(directory / 'binding.json')
    require(sha(regular(directory / 'ticket.json', private=True)) == binding['ticket_sha256'], 'ticket_changed')
    return {'deployment': config, 'ticket': read(directory / 'ticket.json'), 'directory': str(directory), **binding}


def multica_rows(claim, active, runner=None, token=None):
    config, ticket = claim['deployment'], claim['ticket']
    argv = [config['multica']['path'], '--server-url', config['server_url'], '--workspace-id', config['workspace_id'],
            'issue', 'runs', ticket['issue_id'], *(['--active'] if active else []), '--output', 'json']
    if runner is not None:
        rows = runner(argv)  # Explicit controller/test authority; no implicit credential fallback.
        authority = 'explicit_controller_runner'
    else:
        require(isinstance(token, str) and bool(token), 'task_token_missing')
        with tempfile.TemporaryDirectory(prefix='altera-multica-') as home:
            code, output, _ = bounded_process(argv,
                {'PATH': '/usr/bin:/bin', 'HOME': home, 'MULTICA_TOKEN': token})
        require(code == 0, 'native_readback_incomplete')
        try: rows = json.loads(output)
        except (ValueError, UnicodeError): raise ValueError('native_readback_malformed') from None
        authority = 'native_task_token'
    require(isinstance(rows, list), 'native_rows_malformed')
    matching = [r for r in rows if isinstance(r, dict) and r.get('id') == claim['native_task_id']]
    require(len(matching) == 1, 'native_row_missing_or_duplicate')
    row = matching[0]
    require(all(row.get(k) == ticket[k] for k in ('issue_id', 'agent_id', 'workspace_id')), 'native_row_mismatch')
    return {k: row.get(k) for k in ('id', 'issue_id', 'agent_id', 'workspace_id', 'status', 'started_at', 'completed_at')}, authority


def collect(claim, adapter_observation, runtime_observation, multica_runner=None, *, token=None):
    current(claim)
    ticket = claim['ticket']; observed = runtime_observation
    require(adapter_observation.get('invocation_id') == ticket['invocation_id'] and
            adapter_observation.get('native_task_id') == claim['native_task_id'] and
            adapter_observation.get('refusal') is None, 'adapter_observation_mismatch')
    require(observed.get('invocation_id') == ticket['invocation_id'] and observed.get('child_created') is True and
            observed.get('child_reaped') is True and type(observed.get('raw_wait')) is int and
            observed.get('worker_quiescence') == 'proven' and observed.get('container_removed') is True and
            observed.get('provider_cleanup') == 'proven' and observed.get('validation') == 'verified' and
            observed.get('source_before') == observed.get('source_after') and
            observed.get('policy_before') == observed.get('policy_after') and
            observed.get('runtime_status') == adapter_observation.get('runtime_status'), 'runtime_observation_incomplete')
    manifest = read(ticket['adapter_ticket']['runtime_manifest'])
    # The pilot declares no model output as trusted evidence. Check evidence is made by check().
    inventory = Path(manifest['run_root']) / 'evidence'
    require(not inventory.exists() or not list(inventory.iterdir()), 'undeclared_native_evidence')
    row, authority = multica_rows(claim, True, multica_runner, token)
    require(row['status'] in ('running', 'in_progress') and row['completed_at'] is None, 'native_not_running')
    receipt = {'kind': 'process_receipt', 'native_identity': 'native_identity_running',
        'ticket_sha256': claim['ticket_sha256'], 'adapter_sha256': sha(encoded(adapter_observation)),
        'runtime': observed, 'native': row, 'authority': authority, 'task_acceptance': 'not_checked'}
    publish(Path(claim['directory']) / 'observations' / 'process.json', receipt)
    return receipt


def check(claim, check_id, runtime_check_runner=None, gate_runner=None):
    ticket, config = claim['ticket'], claim['deployment']; state = current(claim, gate_runner)
    spec = next(c for c in ticket['checks'] if c['check_id'] == check_id)
    process = read(Path(claim['directory']) / 'observations' / 'process.json')
    require(process['native_identity'] == 'native_identity_running', 'process_receipt_missing')
    event = spec['event_id']; journal = Path(claim['directory']) / 'journal' / (event + '.json')
    if journal.exists(): return read(journal)
    counter = state['tasks'][ticket['slot']['task']]['checks'][ticket['slot']['stage']][check_id]
    require(counter['failures'] < 2, 'check_stopped')
    existing = state['events'].get(event)
    root = Path(config['source']); prefix = 'docs/reports/evidence/' + Path(ticket['slot']['passport']).name[:-10]
    base = prefix + '/' + event; proof_path = base + '.json'
    receipt_path = Path(claim['directory']) / 'observations' / (event + '.json')
    if existing:
        require(all(sha(regular(root / path)) == digest for path, digest in existing['hashes'].items()), 'existing_event_conflict')
        require(existing['path'] == proof_path and existing['hashes'][proof_path] == sha(regular(root / proof_path)) and
                receipt_path.exists(), 'existing_event_conflict')
        saved_proof = read(root / proof_path)
        require(saved_proof['check_receipt_sha256'] == sha(regular(receipt_path, private=True)), 'existing_event_conflict')
        response = {'result': 'recorded', 'failures': existing['failures'], 'stopped': existing['failures'] >= 2}
    else:
        require(not receipt_path.exists() and not (root / proof_path).exists(), 'check_execution_needs_reconciliation')
        manifest = read(ticket['adapter_ticket']['runtime_manifest'])
        # Provider preparation can specialize policy before launching; bind the trusted observer pin.
        manifest['policy_sha256'] = process['runtime']['policy_after']
        intent = receipt_path.with_suffix('.intent.json')
        fd = os.open(intent, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encoded({'event_id': event, 'check_spec_sha256': spec['sha256']})); stream.flush(); os.fsync(stream.fileno())
        runner = runtime_check_runner or module(RUNTIME / 'runtime.py').check
        outcome = runner(manifest, spec['path'], spec['sha256'], invocation_id=ticket['invocation_id'])
        publish(receipt_path, {'kind': 'check_receipt', 'process_sha256': sha(encoded(process)), 'outcome': outcome})
        require(outcome.get('complete') is True and type(outcome.get('executed')) is int and outcome['executed'] > 0 and
                type(outcome.get('exit_code')) is int and not outcome.get('truncated') and not outcome.get('timed_out'), 'check_incomplete')
        directory_path = root / prefix; directory_path.mkdir(parents=True, exist_ok=True)
        require(directory_path.resolve() == directory_path, 'unsafe_evidence_directory')
        output = outcome['output'].encode(); trace = encoded({k: v for k, v in outcome.items() if k != 'output'})
        for path, data in ((root / (base + '.txt'), output), (root / (base + '-trace.json'), trace)):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as stream: stream.write(data); stream.flush(); os.fsync(stream.fileno())
        passport = module(HERE / 'gate.py').load_passport(root, ticket['slot']['passport'])
        proof = {**{k: ticket['slot'][k] for k in ('task', 'stage', 'actor', 'run')},
            **ticket['slot']['input'], 'baseline_commit': passport['baseline_commit'], 'cwd': str(root),
            'environment': 'accepted isolated fixed command', 'command': json.dumps(outcome['command']),
            'started_at': outcome['started_at'], 'exit_code': outcome['exit_code'], 'executed': outcome['executed'],
            'result': 'passed' if outcome['exit_code'] == 0 else 'failed', 'criterion': spec['criterion'],
            'check_id': check_id, 'output': base + '.txt', 'trace_ref': base + '-trace.json',
            'limits': 'Fixed command evidence; semantic acceptance is a separate controller decision.',
            'native_outcome': 'unknown', 'process_receipt_sha256': sha(encoded(process)),
            'check_receipt_sha256': sha(regular(receipt_path, private=True))}
        fd = os.open(root / proof_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream: stream.write(encoded(proof)); stream.flush(); os.fsync(stream.fileno())
        response = gate_call(config, ['record', proof_path, '--event', event], gate_runner)
    after = gate_call(config, ['status'], gate_runner)
    require(after['events'][event]['hashes'][proof_path] == sha(regular(root / proof_path)), 'record_not_observed')
    receipt = {'kind': 'check_record', 'event_id': event, 'response': response,
               'stored_event': after['events'][event]}
    publish(journal, receipt)
    return receipt


def reconcile(config, invocation_id, multica_runner=None, gate_runner=None, *, token=None):
    claim = retained(config, invocation_id)
    process = read(Path(claim['directory']) / 'observations' / 'process.json')
    row, authority = multica_rows(claim, False, multica_runner, token)
    if row['status'] in ('running', 'in_progress', 'pending', 'queued'):
        return {'result': 'pending', 'invocation_id': invocation_id}
    require(row['status'] in ('completed', 'failed') and row['completed_at'], 'terminal_mapping_unverified')
    receipt = {'kind': 'terminal_receipt', 'native': row, 'authority': authority,
        'process_sha256': sha(encoded(process)), 'native_outcome': 'success' if row['status'] == 'completed' else 'failed',
        'task_acceptance': 'not_checked'}
    target = directory(Path(config['registry']) / 'reconciled' / invocation_id)
    publish(target / 'terminal.json', receipt)
    return receipt


def transition(claim, decision, gate_runner=None):
    ticket = claim['ticket']; config = claim['deployment']
    require(set(decision) == {'operation', 'artifact', 'event_id'}, 'invalid_decision')
    operation = decision['operation']
    require(operation in ticket['allowed_transitions'], 'transition_not_declared')
    # The gate validates own-artifact commits and its recorded equivalence edges.
    # Admission, collection and new check execution still pin the original input.
    before = current(claim, gate_runner, gate_validates_artifacts=operation in ('bind-artifacts', 'finish'))
    process = read(Path(claim['directory']) / 'observations' / 'process.json')
    require(process['runtime']['worker_quiescence'] == 'proven', 'quiescence_unknown')
    if operation == 'release':
        args = ['release', '--actor', ticket['actor'], '--run', ticket['slot']['run']]
    elif operation == 'finish':
        terminal = read(Path(config['registry']) / 'reconciled' / ticket['invocation_id'] / 'terminal.json')
        require(terminal['native_outcome'] == 'success', 'native_not_successful')
        require(all(before['events'].get(c['event_id'], {}).get('result') == 'passed' for c in ticket['checks']), 'checks_not_passing')
        args = ['finish', decision['artifact']]
    else:
        args = [operation, decision['artifact'], '--event', decision['event_id'],
                '--actor', ticket['actor'], '--run', ticket['slot']['run']]
    require(not any(c['failures'] >= 2 for checks in before['tasks'][ticket['slot']['task']]['checks'].values()
                    for c in checks.values()) or operation == 'release', 'retained_stop')
    response = gate_call(config, args, gate_runner)
    result = {'kind': 'acceptance_decision', 'operation': operation, 'decision': decision,
              'response': response, 'after': gate_call(config, ['status'], gate_runner)}
    publish(Path(claim['directory']) / 'journal' / ('transition-' + operation + '.json'), result)
    return result


def run_adapter(adapter, provider, pending_path, expected_sha256, incoming, *, environment, **kwargs):
    pending = adapter._private_json(pending_path, expected_sha256)
    reference = pending['collector']; config = deployment(reference['config_path'], reference['config_sha256'])
    require(config['modules']['collector'] == reference['module_sha256'], 'collector_changed')
    claim = bind(config, environment)
    require(claim['ticket']['adapter_sha256'] == expected_sha256 and
            claim['ticket']['adapter_path'] == str(pending_path), 'adapter_ticket_changed')
    outcomes = []
    def outcome_sink(observation):
        publish(Path(claim['directory']) / 'observations' / 'runtime.json', observation)
        outcomes.append(observation)
    def launch(manifest, args):
        return module(RUNTIME / 'runtime.py').launch(manifest, args, outcome_sink,
                                                   invocation_id=claim['ticket']['invocation_id'])
    status = adapter.run_pending(provider, pending_path, expected_sha256, incoming,
        environment=environment, launcher=launch, collector_bound=True, **kwargs)
    require(len(outcomes) == 1, 'runtime_receipt_missing')
    collect(claim, read(pending['observation']), outcomes[0], token=environment.get('MULTICA_TOKEN'))
    for spec in claim['ticket']['checks']:
        result = check(claim, spec['check_id'])
        if result['response']['stopped'] or result['stored_event']['result'] != 'passed': return 78
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True); parser.add_argument('--sha256', required=True)
    parser.add_argument('operation', choices=('admit', 'bind', 'check', 'transition', 'reconcile'))
    parser.add_argument('--request'); parser.add_argument('--invocation'); parser.add_argument('--check-id')
    args = parser.parse_args(); config = deployment(args.config, args.sha256)
    if args.operation == 'admit': result = admit(config, read(args.request))
    elif args.operation == 'bind': result = bind(config, os.environ); result = {'invocation_id': result['ticket']['invocation_id']}
    elif args.operation == 'reconcile': result = reconcile(config, args.invocation, token=os.environ.get('MULTICA_TOKEN'))
    else:
        claim = retained(config, args.invocation)
        if args.operation == 'check': result = check(claim, args.check_id)
        elif args.operation == 'transition': result = transition(claim, read(args.request))
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception:
        print('ALTERA_COLLECTOR refused; retained claim requires reconciliation', file=sys.stderr)
        raise SystemExit(78)
