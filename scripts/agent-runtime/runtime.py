#!/usr/bin/python3 -I
"""Доверенный host launcher: AI, shell и локальные MCP работают только в Docker.

Вызов: runtime.py MANIFEST.json [аргументы native protocol...]
Manifest создаёт coordinator; проверяемый агент не может его менять.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import uuid
from contextlib import contextmanager
import time

DOCKER = '/usr/local/bin/docker'
GIT = '/usr/bin/git'


def child_env():
    # Docker не нужны model/API/Multica credentials и унаследованные plugin paths.
    return {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/var/empty',
            'DOCKER_HOST': 'unix:///Users/egorbondarenko/.docker/run/docker.sock'}


def git(source, *args, data=None):
    return subprocess.run([GIT, '-c', 'core.hooksPath=/dev/null', '-C', str(source), *args],
        input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
        env={'PATH': '/usr/bin:/bin', 'HOME': '/var/empty', 'GIT_CONFIG_NOSYSTEM': '1',
             'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'}).stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_relative(value):
    path = Path(value)
    if not value or path.is_absolute() or '..' in path.parts or '.git' in path.parts:
        raise ValueError('unsafe_relative_path')
    return path


def safe_symlink(path, root):
    if path.is_symlink() and (os.path.isabs(os.readlink(path)) or not path.resolve().is_relative_to(root)):
        raise ValueError('unsafe_symlink')


def fingerprint(source, dirty_paths):
    source = Path(source).resolve(strict=True)
    untracked = {name for name in git(source, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0') if name}
    # Неперечисленный новый source не должен молча исчезать из проверяемого snapshot.
    if len(dirty_paths) != len(set(dirty_paths)) or untracked != set(dirty_paths):
        if any(subprocess.run([GIT, '-C', str(source), 'check-ignore', '-q', '--', name],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0 for name in dirty_paths):
            raise ValueError('ignored_input')
        raise ValueError('untracked_input_mismatch')
    entries = {}
    for name in dirty_paths:
        relative = safe_relative(name)
        if subprocess.run([GIT, '-C', str(source), 'check-ignore', '-q', '--', name],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            raise ValueError('ignored_input')
        path = source / relative
        safe_symlink(path, source)
        if not path.is_file() or not path.resolve().is_relative_to(source):
            raise ValueError('unsafe_dirty_path')
        mode = path.lstat().st_mode
        # Git различает symlink и regular file, у regular — только owner execute bit.
        if stat.S_ISLNK(mode):
            kind, git_mode, content = 'symlink', '120000', os.fsencode(os.readlink(path))
        elif stat.S_ISREG(mode):
            kind = 'file'
            git_mode = '100755' if mode & stat.S_IXUSR else '100644'
            content = path.read_bytes()
        else:
            raise ValueError('unsafe_dirty_path')
        entries[name] = {'kind': kind, 'mode': git_mode, 'sha256': digest(content)}
    return {'head': git(source, 'rev-parse', 'HEAD').decode().strip(),
            'tree': git(source, 'rev-parse', 'HEAD^{tree}').decode().strip(),
            'dirty_sha256': digest(git(source, 'diff', '--binary', 'HEAD', '--')),
            'untracked': entries}


def tree_hash(root):
    root = Path(root).resolve(strict=True)
    entries = []
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('unsafe_policy_symlink')
        if path.is_file():
            entries.append([path.relative_to(root).as_posix(), digest(path.read_bytes())])
        elif not path.is_dir():
            raise ValueError('unsafe_special_file')
    return digest(json.dumps(entries, separators=(',', ':')).encode())


def snapshot(source, target, dirty_paths):
    """Независимый clone без ignored files, hooks и shared objects."""
    source, target = Path(source).resolve(strict=True), Path(target).resolve()
    if target.exists() or target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError('unsafe_snapshot_target')
    before = fingerprint(source, dirty_paths)
    git(source, 'clone', '--no-local', '--no-hardlinks', '--no-checkout', '--', str(source), str(target))
    git(target, 'checkout', '--detach', before['head'])
    patch = git(source, 'diff', '--binary', 'HEAD', '--')
    if patch:
        git(target, 'apply', '--binary', '-', data=patch)
    import shutil
    for name in dirty_paths:
        path = source / safe_relative(name)
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination, follow_symlinks=False)
    # Проверить symlinks, не открывая путь к исходным host inputs.
    for name in git(target, 'ls-files', '-z').decode().split('\0'):
        if name:
            safe_symlink(target / name, target)
    if fingerprint(source, dirty_paths) != before:
        raise ValueError('source_changed_during_snapshot')
    if fingerprint(target, dirty_paths) != before:
        raise ValueError('snapshot_mismatch')
    git(target, 'remote', 'remove', 'origin')
    return before


def canonical(value):
    if not isinstance(value, str) or not value.startswith('/') or re.search(r'[\x00-\x1f,=]', value):
        raise ValueError('unsafe_mount_path')
    path = Path(value)
    if str(path.resolve(strict=True)) != value or not path.is_dir():
        raise ValueError('mount_must_be_canonical_directory')
    return path


def effective_args(manifest, incoming):
    family = manifest['family']
    result = []
    if family == 'codex':
        if not incoming or incoming[0] != 'app-server':
            raise ValueError('unsupported_codex_protocol')
        result.append('app-server')
        i = 1
        while i < len(incoming):
            if incoming[i] not in ('-c', '--config') or i + 1 == len(incoming):
                raise ValueError('unsupported_codex_argument')
            setting = incoming[i + 1]
            if setting not in ('model="gpt-5.6-terra"', 'model_reasoning_effort="medium"'):
                raise ValueError('unmapped_codex_override')
            result.extend([incoming[i], setting]); i += 2
        result.extend(['-c', 'model="gpt-5.6-terra"', '-c', 'model_reasoning_effort="medium"'])
        return result
    toggles = {'--print', '-p', '--verbose', '--include-partial-messages',
               '--dangerously-skip-permissions'}
    values = {'--input-format', '--output-format', '--permission-mode', '--model', '--effort',
              '--session-id', '--resume', '--mcp-config', '--append-system-prompt', '--system-prompt',
              '--disallowedTools'}
    seen = set()
    i = 0
    while i < len(incoming):
        flag = incoming[i]
        if flag == '--strict-mcp-config':
            i += 1
            continue
        if flag in toggles:
            result.append(flag); i += 1; continue
        if flag not in values or i + 1 >= len(incoming) or flag in seen:
            raise ValueError('unsupported_or_duplicate_claude_argument')
        seen.add(flag)
        value = incoming[i + 1]
        if flag in ('--model', '--effort') and value != manifest[flag[2:]]:
            raise ValueError('model_or_effort_change')
        if flag in ('--input-format', '--output-format') and value != 'stream-json':
            raise ValueError('unsupported_stream_format')
        if flag == '--mcp-config':
            if value.lstrip().startswith(('{', '[')):
                raise ValueError('inline_mcp_config_unresolved')
            if not Path(value).is_absolute():
                raise ValueError('managed_path_unresolved')
            value = manifest['path_map'].get(value)
            if value is None or not value.startswith('/runtime/policy/') or '..' in Path(value).parts:
                raise ValueError('managed_path_unresolved')
            mapped = Path(manifest['policy']) / value.removeprefix('/runtime/policy/')
            if not mapped.is_file():
                raise ValueError('mapped_mcp_file_missing')
            config = json.loads(mapped.read_text())
            if not isinstance(config, dict) or set(config) != {'mcpServers'} or not isinstance(config['mcpServers'], dict):
                raise ValueError('unsupported_mcp_config')
            for server in config['mcpServers'].values():
                if (not isinstance(server, dict) or set(server) - {'command', 'args', 'type'} or
                    server.get('type', 'stdio') != 'stdio' or
                    server.get('command') != '/usr/local/bin/trace-mcp' or
                    server.get('args') != ['serve', '--preset', 'review']):
                    raise ValueError('unverified_mcp_server')
        result.extend([flag, value]); i += 2
    for flag in ('--model', '--effort'):
        if flag not in seen:
            result.extend([flag, manifest[flag[2:]]])
    result.extend(['--settings', '/runtime/policy/claude-settings.json', '--strict-mcp-config'])
    return result


def command(manifest, incoming, environment):
    required = {'schema_version', 'family', 'source', 'snapshot', 'state', 'dirty_paths', 'policy',
                'policy_sha256', 'run_root', 'image', 'model', 'effort', 'env_paths', 'path_map',
                'managed_mapping_verified'}
    optional = {'network', 'fixture', 'auth_file', 'operation'}
    if set(manifest) - required - optional or not required.issubset(manifest) or manifest['schema_version'] != 1:
        raise ValueError('invalid_manifest_schema')
    if manifest['family'] not in ('codex', 'claude') or manifest['effort'] != 'medium':
        raise ValueError('unsupported_family_or_effort')
    expected_model = 'gpt-5.6-terra' if manifest['family'] == 'codex' else 'claude-opus-4-6'
    if manifest['model'] != expected_model or not re.fullmatch(r'sha256:[a-f0-9]{64}', manifest['image']):
        raise ValueError('unpreserved_model_or_unpinned_image')
    roots = [canonical(manifest[key]) for key in ('source', 'snapshot', 'policy', 'run_root')]
    for n, left in enumerate(roots):
        if left == Path.home() or left == Path('/'):
            raise ValueError('unsafe_root_mount')
        for right in roots[n+1:]:
            if left.is_relative_to(right) or right.is_relative_to(left):
                raise ValueError('mount_overlap')
    source, snap, policy, run = roots
    if os.getuid() == 0:
        raise ValueError('nonroot_host_user_required')
    if fingerprint(source, manifest['dirty_paths']) != manifest['state']:
        raise ValueError('source_changed')
    if fingerprint(snap, manifest['dirty_paths']) != manifest['state'] or not (snap / '.git').is_dir():
        raise ValueError('snapshot_changed')
    if (snap / '.git/objects/info/alternates').exists():
        raise ValueError('shared_git_objects')
    if tree_hash(policy) != manifest['policy_sha256']:
        raise ValueError('policy_changed')
    if json.loads((policy / 'claude-settings.json').read_text()) != {'disableAllHooks': True}:
        raise ValueError('invalid_hook_policy')
    for key in ('CODEX_HOME', 'CLAUDE_CONFIG_DIR'):
        if key in environment and environment[key] != manifest['env_paths'].get(key):
            raise ValueError('managed_env_unresolved')
    operation = manifest.get('operation', 'protocol')
    if operation == 'claude-login':
        if manifest['family'] != 'claude' or incoming or manifest.get('auth_file'):
            raise ValueError('invalid_login_invocation')
        final = ['auth', 'login']
    elif operation == 'protocol':
        final = effective_args(manifest, incoming)
    else:
        raise ValueError('unsupported_operation')
    network = manifest.get('network', 'none')
    if network not in ('none', 'provider-proxy'):
        raise ValueError('unsupported_network')
    args = [DOCKER, 'run', '--rm', '--init', '--interactive', '--read-only', '--network=none',
            '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128',
            '--memory=2g', '--cpus=2', '--user=' + str(os.getuid()) + ':' + str(os.getgid()), '--workdir=' + str(source),
            '--mount=type=bind,src=' + str(snap) + ',dst=' + str(source) + ',readonly',
            '--mount=type=bind,src=' + str(policy) + ',dst=/runtime/policy,readonly']
    for name in ('evidence', 'cache', 'tmp'):
        path = run / name
        path.mkdir(exist_ok=True, mode=0o777)
        if path.is_symlink() or path.resolve() != path:
            raise ValueError('unsafe_run_directory')
        path.chmod(0o777)
        args.append('--mount=type=bind,src=' + str(path) + ',dst=/runtime/' + name)
    for name in ('home', 'codex', 'claude', 'xdg'):
        path = run / 'cache' / name
        path.mkdir(exist_ok=True, mode=0o700)
        if path.is_symlink() or path.resolve() != path:
            raise ValueError('unsafe_runtime_home')
    if manifest.get('auth_file'):
        auth = Path(manifest['auth_file'])
        if (not auth.is_absolute() or auth.is_symlink() or not auth.is_file() or
            auth.resolve() != auth or re.search(r'[\x00-\x1f,=]', str(auth))):
            raise ValueError('unsafe_auth_reference')
        destination = '/runtime/cache/codex/auth.json' if manifest['family'] == 'codex' else '/runtime/cache/claude/.credentials.json'
        placeholder = run / destination.removeprefix('/runtime/')
        if placeholder.is_symlink():
            raise ValueError('unsafe_auth_mountpoint')
        if not placeholder.exists():
            placeholder.touch(mode=0o600, exist_ok=False)
        args.append('--mount=type=bind,src=' + str(auth) + ',dst=' + destination + ',readonly')
    if manifest['family'] == 'codex' and (policy / 'codex-config.toml').is_file():
        placeholder = run / 'cache/codex/config.toml'
        if placeholder.is_symlink():
            raise ValueError('unsafe_config_mountpoint')
        if not placeholder.exists():
            placeholder.touch(mode=0o600, exist_ok=False)
        args.append('--mount=type=bind,src=' + str(policy / 'codex-config.toml') +
                    ',dst=/runtime/cache/codex/config.toml,readonly')
    for entry in ('HOME=/runtime/cache/home', 'CODEX_HOME=/runtime/cache/codex',
                  'CLAUDE_CONFIG_DIR=/runtime/cache/claude', 'TMPDIR=/runtime/tmp',
                  'TMP=/runtime/tmp', 'TEMP=/runtime/tmp', 'XDG_CACHE_HOME=/runtime/cache/xdg'):
        args.extend(['--env', entry])
    args.extend(['--env', 'TRACE_MCP_TELEMETRY=off'])
    if operation == 'claude-login':
        args.extend(['--entrypoint=/usr/local/bin/claude', manifest['image']])
    elif manifest.get('fixture'):
        # Явная coordinator policy, те же mounts/OS policy, что у настоящего CLI.
        args.extend(['--entrypoint=/usr/local/bin/node', manifest['image'], '/runtime/policy/fixture.mjs'])
    else:
        if not manifest['managed_mapping_verified']:
            raise ValueError('managed_mapping_unverified')
        if not (policy / 'protocol-guard.mjs').is_file():
            raise ValueError('protocol_guard_missing')
        args.extend(['--entrypoint=/usr/local/bin/node', manifest['image'],
                     '/runtime/policy/protocol-guard.mjs', manifest['family']])
    return args + final


@contextmanager
def provider_network(manifest):
    """Отдельная internal сеть без адреса host bridge, плюс HTTPS-only proxy."""
    if manifest.get('network', 'none') == 'none':
        yield None
        return
    name = 'altera-check-' + uuid.uuid4().hex
    proxy = name + '-proxy'
    def docker(*args, check=True):
        return subprocess.run([DOCKER, *args], check=check, env=child_env(),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
    created = False
    try:
        docker('network', 'create', '--internal', '--opt',
               'com.docker.network.bridge.gateway_mode_ipv4=isolated', name)
        created = True
        docker('run', '--detach', '--name', proxy, '--network=bridge', '--read-only',
               '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=1000:1000',
               '--pids-limit=32', '--memory=128m', '--cpus=1',
               '--mount=type=bind,src=' + manifest['policy'] + '/provider-proxy.mjs,dst=/proxy.mjs,readonly',
               '--entrypoint=/usr/local/bin/node', manifest['image'], '/proxy.mjs')
        docker('network', 'connect', '--alias', 'egress-proxy', name, proxy)
        inspection = json.loads(docker('network', 'inspect', name))[0]
        if not inspection['Internal'] or inspection['EnableIPv6'] or inspection['Options'].get(
                'com.docker.network.bridge.gateway_mode_ipv4') != 'isolated':
            raise ValueError('network_boundary_unverified')
        for _ in range(30):
            if b'PROXY_READY' in docker('logs', proxy):
                break
            time.sleep(0.1)
        else:
            raise ValueError('proxy_not_ready')
        Path(manifest['run_root'], 'network-inspect.json').write_text(json.dumps(inspection, indent=2))
        Path(manifest['run_root'], 'proxy-inspect.json').write_bytes(docker('inspect', proxy))
        yield name
    finally:
        if created:
            docker('rm', '--force', proxy, check=False)
            docker('network', 'rm', name, check=False)


def execute(args):
    process = subprocess.Popen(args, env=child_env(), stdin=sys.stdin.buffer,
                               stdout=sys.stdout.buffer, stderr=sys.stderr.buffer)
    def forward(signum, _frame):
        if process.poll() is None:
            process.send_signal(signum)
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, forward)
    code = process.wait()
    return 128 - code if code < 0 else code


def launch(manifest, incoming):
    evidence = Path(manifest['run_root']) / 'evidence'
    if evidence.exists() and any(evidence.iterdir()):
        raise ValueError('evidence_directory_not_fresh')
    args = command(manifest, incoming, os.environ)
    with provider_network(manifest) as network:
        if network:
            args[args.index('--network=none')] = '--network=' + network
            args[2:2] = ['--env', 'HTTPS_PROXY=http://egress-proxy:8080',
                          '--env', 'HTTP_PROXY=http://egress-proxy:8080',
                          '--env', 'ALL_PROXY=http://egress-proxy:8080',
                          '--env', 'NO_PROXY=', '--env', 'NODE_USE_ENV_PROXY=1']
        code = execute(args)
    if fingerprint(manifest['source'], manifest['dirty_paths']) != manifest['state']:
        print('ALTERA_RUNTIME source_changed_after_run', file=sys.stderr)
        return 78
    if tree_hash(manifest['policy']) != manifest['policy_sha256']:
        print('ALTERA_RUNTIME policy_changed_after_run', file=sys.stderr)
        return 78
    return code


if __name__ == '__main__':
    try:
        if sys.argv[1:] in (['--help'], ['--version']):
            print('altera-isolated-runtime 1.0.0; explicit manifest required')
            sys.exit(0)
        manifest = json.loads(Path(sys.argv[1]).read_text())
        sys.exit(launch(manifest, sys.argv[2:]))
    except (ValueError, KeyError, IndexError, OSError, subprocess.CalledProcessError) as error:
        # Ошибки не раскрывают argv, prompt, env values, config contents или секреты.
        message = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z_]+', str(error)) else type(error).__name__
        print('ALTERA_RUNTIME rejected: ' + message, file=sys.stderr)
        sys.exit(78)
