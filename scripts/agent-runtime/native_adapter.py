#!/usr/bin/python3 -I
"""Permanent native profile boundary backed by fresh coordinator tickets."""
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

HERE = Path(__file__).resolve().parent
MAX_FILE = 65536
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}')
ENV_BINDINGS = {'workspace_id': 'MULTICA_WORKSPACE_ID', 'agent_id': 'MULTICA_AGENT_ID'}


def _module(name):
    spec = importlib.util.spec_from_file_location('altera_' + name, HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def _private_json(path, expected_sha256):
    path = Path(path)
    if (not path.is_absolute() or path.is_symlink() or path.resolve(strict=True) != path or
            not re.fullmatch(r'[a-f0-9]{64}', expected_sha256)):
        raise ValueError('unsafe_private_reference')
    info = path.lstat(); parent = path.parent.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
            stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or
            not 0 < info.st_size <= MAX_FILE or not stat.S_ISDIR(parent.st_mode) or
            parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) != 0o700):
        raise ValueError('unsafe_private_reference')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd); data = os.read(fd, MAX_FILE + 1); after = os.fstat(fd)
    finally:
        os.close(fd)
    identity = lambda x: (x.st_dev, x.st_ino, x.st_mode, x.st_uid, x.st_nlink,
                          x.st_size, x.st_mtime_ns, x.st_ctime_ns)
    if identity(before) != identity(after) or len(data) != before.st_size:
        raise ValueError('private_reference_changed')
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError('private_reference_changed')
    try:
        return json.loads(data, object_pairs_hook=_unique)
    except (ValueError, UnicodeError):
        raise ValueError('invalid_private_json') from None


def _registry_json(path):
    path = Path(path); info = path.lstat()
    if (path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
            stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or not 0 < info.st_size <= MAX_FILE):
        raise ValueError('invalid_registry_entry')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try: data = os.read(fd, MAX_FILE + 1)
    finally: os.close(fd)
    if len(data) != info.st_size: raise ValueError('invalid_registry_entry')
    try: return json.loads(data, object_pairs_hook=_unique), hashlib.sha256(data).hexdigest()
    except (ValueError, UnicodeError): raise ValueError('invalid_registry_entry') from None


def _pinned_file(path, expected_sha256):
    path = Path(path); info = path.lstat()
    if (not path.is_absolute() or path.is_symlink() or not stat.S_ISREG(info.st_mode) or
            info.st_uid != os.getuid() or info.st_mode & 0o022 or info.st_nlink != 1 or
            not 0 < info.st_size <= MAX_FILE):
        raise ValueError('pinned_file_invalid')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try: data = os.read(fd, MAX_FILE + 1)
    finally: os.close(fd)
    if len(data) != info.st_size or hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError('pinned_file_changed')


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value: raise ValueError()
        value[key] = item
    return value


def _directory(path):
    path = Path(path)
    if (not path.is_absolute() or path.is_symlink() or path.resolve(strict=True) != path or
            not path.is_dir()):
        raise ValueError('unsafe_registry')
    info = path.lstat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError('unsafe_registry')
    return path


def opaque_auth_reference(path):
    """Validate one credential inode without opening, reading, or hashing its content."""
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or path.resolve(strict=True) != path:
        raise ValueError('unsafe_auth_reference')
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
            stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or not 0 < info.st_size <= MAX_FILE):
        raise ValueError('unsafe_auth_reference')
    return str(path)


def _admission_environment(environment):
    names = (*ENV_BINDINGS.values(), 'MULTICA_TASK_ID', 'MULTICA_SERVER_URL', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR')
    return {name: environment[name] for name in names if name in environment}


def _separate_authority(ticket, runtime_manifest, registry=None, trusted_paths=()):
    run = Path(runtime_manifest['run_root']).resolve()
    writable = [run / name for name in ('cache', 'tmp', 'evidence')]
    trusted = [Path(ticket[key]).resolve() for key in ('claim', 'observation', 'runtime_manifest', 'store_manifest', 'passport_path')]
    trusted.extend(Path(path).resolve() for path in trusted_paths)
    if ticket.get('collector'): trusted.append(Path(ticket['collector']['config_path']).resolve())
    if registry is not None: trusted.append(Path(registry).resolve())
    if any(left == right or left.is_relative_to(right) or right.is_relative_to(left)
           for left in trusted for right in writable):
        raise ValueError('trusted_output_mount_overlap')


def _validate_ticket(provider, ticket, environment):
    required = {'schema_version', 'provider', 'invocation_id', 'native_task_id', 'native_run_id',
        'actor', 'agent_id', 'issue_id', 'workspace_id', 'passport_path', 'passport_sha256',
        'gate', 'gate_input', 'check_ids', 'criteria', 'event_ids', 'runtime_manifest',
        'runtime_manifest_sha256', 'store_manifest', 'store_manifest_sha256', 'claim',
        'observation', 'provider_input'}
    if (not isinstance(ticket, dict) or set(ticket) not in (required, required | {'collector'}) or ticket.get('schema_version') != 1 or
            ticket.get('provider') != provider or provider not in ('claude', 'codex')):
        raise ValueError('invalid_pending_request')
    for key in ('invocation_id', 'issue_id', *ENV_BINDINGS):
        if not isinstance(ticket[key], str) or not ID.fullmatch(ticket[key]):
            raise ValueError('invalid_pending_request')
    native_task = environment.get('MULTICA_TASK_ID')
    if not isinstance(native_task, str) or not ID.fullmatch(native_task):
        raise ValueError('native_binding_mismatch')
    if ticket['native_task_id'] is not None and ticket['native_task_id'] != native_task:
        raise ValueError('native_binding_mismatch')
    if ((ticket['actor'] != ticket['agent_id'] and not ticket.get('collector')) or
            any(environment.get(env) != ticket[key] for key, env in ENV_BINDINGS.items())):
        raise ValueError('native_binding_mismatch')
    if (not isinstance(ticket['provider_input'], dict) or
            not re.fullmatch(r'[a-f0-9]{64}', ticket['passport_sha256']) or
            not isinstance(ticket['gate'], dict) or set(ticket['gate']) != {'task', 'stage', 'run', 'lease'} or
            not isinstance(ticket['gate_input'], dict) or set(ticket['gate_input']) != {'revision_commit', 'dirty_fingerprint'} or
            not re.fullmatch(r'[a-f0-9]{40}', ticket['gate_input']['revision_commit']) or
            not re.fullmatch(r'(?:clean|sha256:[a-f0-9]{64})', ticket['gate_input']['dirty_fingerprint']) or
            not isinstance(ticket['check_ids'], list) or not ticket['check_ids'] or
            not isinstance(ticket['criteria'], list) or not ticket['criteria'] or
            not isinstance(ticket['event_ids'], dict) or set(ticket['event_ids']) != {'claimed', 'observed'}):
        raise ValueError('invalid_pending_request')
    return {**ticket, 'native_task_id': native_task}


def _exclusive_json(path, value):
    path = Path(path); _directory(path.parent)
    data = _canonical(value) + b'\n'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, data); os.fsync(fd)
    finally:
        os.close(fd)
    return path


def _production_store(manifest):
    return _module('credential_refresh').Store(manifest)


def _production_launch(manifest, incoming):
    return _module('runtime').launch(manifest, incoming)


def _claim(ticket):
    return _exclusive_json(ticket['claim'], {'schema_version': 1,
        'invocation_id': ticket['invocation_id'], 'native_task_id': ticket['native_task_id'],
        'claimed_at_ns': time.time_ns()})


def _write_observation(ticket, ticket_sha256, started, status=None, refusal=None):
    evidence = Path(_private_json(ticket['runtime_manifest'], ticket['runtime_manifest_sha256'])['run_root']) / 'evidence'
    inventory = []
    if evidence.is_dir():
        inventory = sorted(p.name for p in evidence.iterdir() if p.is_file() and not p.is_symlink())
    record = {'schema_version': 1, **{key: ticket[key] for key in
        ('provider', 'invocation_id', 'native_task_id', 'native_run_id', 'actor', 'agent_id',
         'issue_id', 'workspace_id', 'gate', 'gate_input', 'check_ids', 'criteria', 'event_ids')},
        'ticket_sha256': ticket_sha256, 'passport_path': ticket['passport_path'],
        'passport_sha256': ticket['passport_sha256'],
        'started_at_ns': started, 'ended_at_ns': time.time_ns(), 'runtime_status': status,
        'refusal': refusal, 'raw_child_exit': None, 'signal': None, 'container_id': None,
        'worker_quiescence': 'unknown', 'evidence_inventory': inventory,
        'evidence_trust': 'untrusted_output_inventory'}
    _exclusive_json(ticket['observation'], record)


def run_pending(provider, pending_path, expected_sha256, incoming, *, environment=None,
                provider_verifier=None, store_factory=None, launcher=None, outcome_sink=None,
                authorized_source=None, collector_bound=False, trusted_paths=()):
    native_environment = os.environ if environment is None else environment
    pending = _private_json(pending_path, expected_sha256)
    if pending.get('collector') and not collector_bound:
        reference = pending['collector']
        if set(reference) != {'config_path', 'config_sha256', 'module_sha256'}: raise ValueError('invalid_collector_reference')
        source = HERE.parent / 'agent-loop/native_collector.py'
        _pinned_file(source, reference['module_sha256'])
        spec = importlib.util.spec_from_file_location('native_collector', source)
        collector = importlib.util.module_from_spec(spec); spec.loader.exec_module(collector)
        return collector.run_adapter(_module('native_adapter'), provider, pending_path, expected_sha256, incoming,
            environment=native_environment, authorized_source=authorized_source, trusted_paths=trusted_paths)
    environment = _admission_environment(native_environment)
    ticket = _validate_ticket(provider, _private_json(pending_path, expected_sha256), environment)
    started = time.time_ns()
    try:
        runtime_manifest = _private_json(ticket['runtime_manifest'], ticket['runtime_manifest_sha256'])
        if authorized_source is not None and (runtime_manifest.get('source') != authorized_source or
                os.getcwd() != authorized_source):
            raise ValueError('authorized_source_mismatch')
        store_manifest = _private_json(ticket['store_manifest'], ticket['store_manifest_sha256'])
        _separate_authority(ticket, runtime_manifest, Path(pending_path).parent,
                            (*trusted_paths, pending_path))
        if runtime_manifest.get('network') != 'provider-proxy' or runtime_manifest.get('fixture'):
            raise ValueError('provider_network_refused')
        _pinned_file(ticket['passport_path'], ticket['passport_sha256'])
        if runtime_manifest.get('state', {}).get('head') != ticket['gate_input']['revision_commit']:
            raise ValueError('gate_source_mismatch')
        if provider == 'claude':
            store_path = _directory(store_manifest['store'])
            _directory(store_path / 'generations')
        if _module('runtime').tree_hash(runtime_manifest['policy']) != runtime_manifest['policy_sha256']:
            raise ValueError('prepared_policy_changed')
        _claim(ticket)
        try:
            mapped = (provider_verifier or verify_provider)(ticket, list(incoming))
        except Exception:
            raise ValueError('provider_input_refused') from None
        if not isinstance(mapped, dict) or set(mapped) - {'path_map', 'policy', 'policy_sha256',
                'managed_mapping_verified'}:
            raise ValueError('provider_input_refused')
        runtime_manifest = {**runtime_manifest, **mapped}
        runtime_manifest['env_paths'] = {key: environment[key] for key in ('CODEX_HOME', 'CLAUDE_CONFIG_DIR') if key in environment}
        if provider == 'codex':
            if ticket.get('collector') and 'probe' not in ticket['provider_input']:
                raise ValueError('fresh_codex_probe_required')
            runtime_manifest['auth_file'] = opaque_auth_reference(ticket['provider_input']['auth_file'])
            status = (launcher or _production_launch)(runtime_manifest, list(incoming))
            _write_observation(ticket, expected_sha256, started, status=status)
            if outcome_sink is not None: outcome_sink(ticket, status)
            return status
        store = (store_factory or _production_store)(store_manifest)
        selected = None
        try:
            # Whole-run exclusive cooperative refresh lock; an open descriptor alone is not a lease.
            with store.locked(timeout=5):
                generation = store.current()
                if generation is not None:
                    selected = store.credential(generation)
                    runtime_manifest['auth_file'] = str(selected.path)
                status = (launcher or _production_launch)(runtime_manifest, list(incoming))
        finally:
            if selected is not None and selected.fd is not None: os.close(selected.fd)
            store.close()
        _write_observation(ticket, expected_sha256, started, status=status)
        if outcome_sink is not None: outcome_sink(ticket, status)
        return status
    except Exception as error:
        try: _write_observation(ticket, expected_sha256, started, refusal=str(error) if str(error) in
            ('admission_lock_timeout', 'provider_input_refused') else 'adapter_refused')
        except Exception: pass
        raise


def run_registered(provider, deployment_path, expected_sha256, incoming, *, environment=None, **kwargs):
    native_environment = os.environ if environment is None else environment
    environment = _admission_environment(native_environment)
    deployment = _private_json(deployment_path, expected_sha256)
    required = {'schema_version', 'provider', 'actor', 'agent_id', 'workspace_id', 'registry',
                'claims', 'observations', 'authority'}
    if (not isinstance(deployment, dict) or set(deployment) != required or
            deployment.get('schema_version') != 1 or deployment.get('provider') != provider or
            deployment.get('actor') != deployment.get('agent_id') or
            environment.get('MULTICA_AGENT_ID') != deployment.get('agent_id') or
            environment.get('MULTICA_WORKSPACE_ID') != deployment.get('workspace_id')):
        raise ValueError('invalid_deployment')
    authority = deployment['authority']
    expected_authority = {'native_adapter_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'provider_adapter_sha256': hashlib.sha256(HERE.joinpath('native_' + provider + '_adapter.py').read_bytes()).hexdigest(),
        'prepare_native_sha256': hashlib.sha256(HERE.joinpath('prepare_native.py').read_bytes()).hexdigest(),
        'runtime_sha256': hashlib.sha256(HERE.joinpath('runtime.py').read_bytes()).hexdigest(),
        'credential_refresh_sha256': hashlib.sha256(HERE.joinpath('credential_refresh.py').read_bytes()).hexdigest(),
        'codex_mapper_sha256': hashlib.sha256(HERE.joinpath('codex_toml_map.py').read_bytes()).hexdigest(),
        'source': os.getcwd()}
    if authority != expected_authority:
        raise ValueError('deployment_authority_changed')
    registry, claims, observations = map(_directory,
        (deployment['registry'], deployment['claims'], deployment['observations']))
    candidates = []
    for count, entry in enumerate(registry.iterdir()):
        if count >= 1024: raise ValueError('registry_entry_limit')
        path = entry / 'pending.json' if entry.is_dir() and not entry.is_symlink() else entry
        if path.suffix != '.json' or path.is_symlink(): raise ValueError('invalid_registry_entry')
        try:
            raw, ticket_hash = _registry_json(path)
            ticket = _validate_ticket(provider, raw, environment)
            if (Path(ticket['claim']).parent == claims and Path(ticket['observation']).parent == observations and
                    not Path(ticket['claim']).exists()):
                candidates.append((path, ticket_hash))
        except ValueError as error:
            if str(error) == 'native_binding_mismatch':
                continue
            raise
        except (OSError, TypeError):
            raise ValueError('invalid_registry_entry') from None
    if len(candidates) != 1:
        raise ValueError('pending_request_missing_or_ambiguous')
    return run_pending(provider, *candidates[0], incoming, environment=native_environment,
        authorized_source=authority['source'], trusted_paths=(deployment_path,), **kwargs)


def verify_provider(ticket, incoming):
    module = _module('native_' + ticket['provider'] + '_adapter')
    return module.verify(ticket['provider_input'], incoming)


def main(provider, argv):
    if len(argv) < 3 or argv[2] != '--': raise ValueError('invalid_adapter_argv')
    return run_registered(provider, Path(argv[0]), argv[1], argv[3:])


if __name__ == '__main__':
    try: raise SystemExit(main(sys.argv[1], sys.argv[2:]))
    except Exception: raise SystemExit(78)
