#!/usr/bin/python3 -I
"""Claude native metadata verifier and stable profile entrypoint."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

PREFIX = b'ALTERA_METADATA_CONFIG_ONLY_V1 '
VALUE_OPTIONS = {'--mcp-config', '--append-system-prompt', '--system-prompt', '--model', '--effort',
    '--input-format', '--output-format', '--permission-mode', '--disallowedTools', '--settings'}
FLAG_OPTIONS = {'-p', '--verbose', '--strict-mcp-config'}


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify(value, incoming):
    required = {'probe', 'probe_sha256', 'source_sha256', 'build_sha256', 'output_dir'}
    if (set(value) != required or not all(isinstance(value[key], str) for key in required) or
            any(not re.fullmatch(r'[a-f0-9]{64}', value[key]) for key in
                ('probe_sha256', 'source_sha256', 'build_sha256'))):
        raise ValueError('claude_probe_authority_invalid')
    probe = Path(value['probe'])
    if not probe.is_absolute() or probe.is_symlink() or not probe.is_file() or _sha(probe) != value['probe_sha256']:
        raise ValueError('claude_probe_changed')
    result = subprocess.run([str(probe), *incoming], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, env={'PATH': '/usr/bin:/bin'}, timeout=5, check=False)
    if _sha(probe) != value['probe_sha256']:
        raise ValueError('claude_probe_changed')
    if result.returncode != 78 or result.stdout or len(result.stderr) > 8192 or not result.stderr.startswith(PREFIX):
        raise ValueError('claude_descriptor_invalid')
    descriptor = json.loads(result.stderr[len(PREFIX):])
    if (not isinstance(descriptor, dict) or descriptor.get('schema_version') != 1 or
            descriptor.get('source_sha256') != value['source_sha256'] or
            descriptor.get('build_sha256') != value['build_sha256'] or
            descriptor.get('read_status') != 'ok' or descriptor.get('mapping_candidate') != 'exact' or
            descriptor.get('task_acceptance') != 'not_checked' or descriptor.get('unknown_servers') != 0 or
            descriptor.get('unknown_fields') != 0 or descriptor.get('unreviewed_fields') is not False):
        raise ValueError('claude_descriptor_invalid')
    servers = descriptor.get('servers')
    if (not isinstance(servers, list) or {row.get('name') for row in servers if isinstance(row, dict)} != {'context7', 'trace'} or
            any(row.get('unreviewed_fields') is not False or row.get('headers_present') or row.get('env_present')
                for row in servers)):
        raise ValueError('claude_descriptor_invalid')
    trace = next(row for row in servers if row['name'] == 'trace')
    if trace.get('command_match') is not True or trace.get('args_match') is not True:
        raise ValueError('claude_descriptor_invalid')
    config = None; index = 0; seen = set()
    while index < len(incoming):
        option = incoming[index]; index += 1
        if not isinstance(option, str): raise ValueError('claude_argv_invalid')
        if option.startswith('--mcp-config='):
            if '--mcp-config' in seen: raise ValueError('claude_argv_invalid')
            seen.add('--mcp-config'); config = option.split('=', 1)[1]; continue
        if option in FLAG_OPTIONS:
            if option in seen: raise ValueError('claude_argv_invalid')
            seen.add(option); continue
        if option in VALUE_OPTIONS:
            if option in seen or index >= len(incoming): raise ValueError('claude_argv_invalid')
            seen.add(option); argument = incoming[index]; index += 1
            if option == '--mcp-config': config = argument
            continue
        raise ValueError('claude_argv_invalid')
    if not isinstance(config, str) or not config.startswith('/'):
        raise ValueError('claude_argv_invalid')
    policy = Path(value['output_dir'])
    return {'path_map': {config: '/runtime/policy/claude-mcp.json'}, 'policy': str(policy),
            'policy_sha256': _runtime_tree(policy), 'managed_mapping_verified': True}


def _runtime_tree(policy):
    spec = importlib.util.spec_from_file_location('altera_runtime', Path(__file__).with_name('runtime.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.tree_hash(policy)


def main(argv):
    if argv in (['--help'], ['--version']) or (len(argv) == 4 and argv[2] == '--' and argv[3] in ('--help', '--version')):
        print('altera native Claude adapter 1.0 (container launcher)')
        return 0
    spec = importlib.util.spec_from_file_location('altera_native_adapter', Path(__file__).with_name('native_adapter.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.main('claude', argv)


if __name__ == '__main__':
    try: raise SystemExit(main(sys.argv[1:]))
    except Exception: raise SystemExit(78)
