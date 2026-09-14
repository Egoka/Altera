#!/usr/bin/python3 -I
"""Codex managed-TOML verifier and stable profile entrypoint."""
import importlib.util
import hashlib
import json
import os
import subprocess
from pathlib import Path
import sys


def _mapper():
    spec = importlib.util.spec_from_file_location('altera_codex_toml_map', Path(__file__).with_name('codex_toml_map.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def _runtime():
    spec = importlib.util.spec_from_file_location('altera_runtime', Path(__file__).with_name('runtime.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def verify(value, _incoming):
    required = {'d2_record', 'workspace_root', 'expected_cwd', 'expected_uid', 'base_policy_path',
        'expected_base_sha256', 'output_dir', 'mapping_policy_version', 'required_servers', 'auth_file'}
    fresh = (required - {'d2_record'}) | {'probe'}
    if set(value) not in (required, fresh) or value['required_servers'] != ['context7', 'trace']:
        raise ValueError('codex_mapping_authority_invalid')
    mapper = _mapper()
    record = value.get('d2_record')
    if 'probe' in value:
        probe = Path(value['probe'])
        if not probe.is_absolute() or probe.is_symlink() or probe.resolve() != probe:
            raise ValueError('codex_probe_changed')
        if hashlib.sha256(probe.read_bytes()).hexdigest() != mapper.D2_BINARY_SHA256:
            raise ValueError('codex_probe_changed')
        home = os.environ.get('CODEX_HOME')
        if not isinstance(home, str) or not home.startswith('/'):
            raise ValueError('codex_managed_home_missing')
        observed = subprocess.run([str(probe), *_incoming], stdin=subprocess.DEVNULL,
            capture_output=True, timeout=5, env={'PATH': '/usr/bin:/bin', 'CODEX_HOME': home})
        prefix = b'ALTERA_CODEX_PATH_ONLY_V1 '
        if (observed.returncode != 78 or observed.stdout or len(observed.stderr) > 4096 or
                not observed.stderr.startswith(prefix) or
                hashlib.sha256(probe.read_bytes()).hexdigest() != mapper.D2_BINARY_SHA256):
            raise ValueError('codex_probe_refused')
        record = {'binary_sha256': mapper.D2_BINARY_SHA256,
                  'descriptor': json.loads(observed.stderr[len(prefix):])}
    result = mapper.materialize(record, workspace_root=value['workspace_root'],
        expected_cwd=value['expected_cwd'], expected_uid=value['expected_uid'],
        base_policy_path=value['base_policy_path'], expected_base_sha256=value['expected_base_sha256'],
        output_dir=value['output_dir'], mapping_policy_version=value['mapping_policy_version'],
        required_servers=value['required_servers'])
    if result.get('managed_mapping_verified') is not True:
        raise ValueError('codex_mapping_refused')
    policy = Path(result['policy_path']).parent
    return {'path_map': result['path_map'], 'policy': str(policy),
            'policy_sha256': _runtime().tree_hash(policy), 'managed_mapping_verified': True}


def main(argv):
    if argv in (['--help'], ['--version']) or (len(argv) == 4 and argv[2] == '--' and argv[3] in ('--help', '--version')):
        print('altera native Codex adapter 1.0 (container launcher)')
        return 0
    spec = importlib.util.spec_from_file_location('altera_native_adapter', Path(__file__).with_name('native_adapter.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.main('codex', argv)


if __name__ == '__main__':
    try: raise SystemExit(main(sys.argv[1:]))
    except Exception: raise SystemExit(78)
