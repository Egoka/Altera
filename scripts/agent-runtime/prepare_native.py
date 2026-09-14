#!/usr/bin/python3 -I
"""Trusted per-invocation preparation for permanent native adapters."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys

HERE = Path(__file__).resolve().parent


def _module(name):
    spec = importlib.util.spec_from_file_location('altera_' + name, HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def _write(path, value):
    data = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try: os.write(fd, data); os.fsync(fd)
    finally: os.close(fd)
    return hashlib.sha256(data).hexdigest()


def prepare(provider, request, destination, *, runtime_module=None):
    """Create a fresh snapshot/run and publish one immutable pending ticket."""
    required = {'schema_version', 'invocation_id', 'native_task_id', 'native_run_id', 'issue_id',
        'actor', 'agent_id', 'workspace_id', 'passport_path', 'passport_sha256', 'gate', 'gate_input',
        'check_ids', 'criteria', 'event_ids', 'source', 'snapshot', 'dirty_paths', 'policy', 'run_root',
        'image', 'store_manifest', 'provider_input', 'claim', 'observation'}
    if set(request) != required or request.get('schema_version') != 1 or provider not in ('claude', 'codex'):
        raise ValueError('invalid_prepare_request')
    destination = Path(destination)
    if destination.exists() or destination.is_symlink(): raise ValueError('preparation_not_fresh')
    destination.mkdir(mode=0o700)
    runtime = runtime_module or _module('runtime')
    snapshot, run = Path(request['snapshot']), Path(request['run_root'])
    if snapshot.exists() or run.exists(): raise ValueError('preparation_not_fresh')
    runtime.snapshot(request['source'], snapshot, request['dirty_paths'])
    run.mkdir(mode=0o700)
    policy_source = Path(request['policy'])
    policy = Path(request['provider_input']['output_dir'])
    if policy.exists() or policy.is_symlink(): raise ValueError('preparation_not_fresh')
    policy.mkdir(mode=0o700)
    for entry in policy_source.iterdir():
        if entry.is_symlink() or not entry.is_file(): raise ValueError('policy_input_invalid')
        if entry.name not in ('codex-config.toml', 'codex-mcp-catalog.json', 'claude-mcp.json'):
            shutil.copy2(entry, policy / entry.name, follow_symlinks=False)
    if provider == 'claude':
        (policy / 'claude-mcp.json').write_text('{"mcpServers":{"context7":{"type":"http","url":"https://mcp.context7.com/mcp"},"trace":{"command":"/usr/local/bin/trace-mcp","args":["serve"]}}}')
        (policy / 'claude-mcp.json').chmod(0o600)
    state = runtime.fingerprint(Path(request['source']), request['dirty_paths'])
    manifest = {'schema_version': 1, 'family': provider, 'source': request['source'],
        'snapshot': str(snapshot), 'state': state, 'dirty_paths': request['dirty_paths'],
        'policy': str(policy), 'policy_sha256': runtime.tree_hash(policy),
        'run_root': str(run), 'image': request['image'],
        'model': 'gpt-5.6-terra' if provider == 'codex' else 'claude-opus-4-6', 'effort': 'medium',
        'env_paths': {}, 'path_map': {}, 'managed_mapping_verified': False,
        'network': 'provider-proxy'}
    runtime_path = destination / 'runtime.json'; runtime_sha = _write(runtime_path, manifest)
    store_path = destination / 'store.json'; store_sha = _write(store_path, request['store_manifest'])
    identity = {key: request[key] for key in required - {'schema_version', 'source', 'snapshot',
        'dirty_paths', 'policy', 'run_root', 'image', 'store_manifest', 'provider_input', 'claim', 'observation'}}
    ticket = {'schema_version': 1, 'provider': provider, **identity,
        'runtime_manifest': str(runtime_path), 'runtime_manifest_sha256': runtime_sha,
        'store_manifest': str(store_path), 'store_manifest_sha256': store_sha,
        'claim': request['claim'], 'observation': request['observation'],
        'provider_input': request['provider_input']}
    ticket_path = destination / 'pending.json'; ticket_sha = _write(ticket_path, ticket)
    return {'pending_path': str(ticket_path), 'pending_sha256': ticket_sha,
            'invocation_id': request['invocation_id']}


def main(provider, argv):
    if len(argv) != 3: raise ValueError('invalid_prepare_argv')
    adapter = _module('native_adapter')
    request = adapter._private_json(argv[0], argv[1])
    result = prepare(provider, request, Path(argv[2]))
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    try: raise SystemExit(main(sys.argv[1], sys.argv[2:]))
    except Exception: raise SystemExit(78)
