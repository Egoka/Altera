"""Настоящие Docker проверки с явными image ID и evidence directory.

Writable sensitivity control намеренно даёт exit41; isolation должна дать exit0.
Набор не использует AI модель и credentials.
"""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('runtime', ROOT / 'runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
image = sys.argv[1]
evidence = Path(sys.argv[2]).resolve()
evidence.mkdir(exist_ok=False)


def run(command, **kwargs):
    return subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)


def git(source, *args):
    subprocess.run(['/usr/bin/git', '-C', str(source), *args], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def fixture(name, program):
    base = evidence / name
    base.mkdir()
    source = base / 'source'
    source.mkdir()
    git(source, 'init', '-q')
    git(source, 'config', 'user.name', 'Fixture')
    git(source, 'config', 'user.email', 'fixture@example.invalid')
    for name in ('canary', 'delete-canary', 'rename-canary'):
        (source / name).write_text('original')
    (source / 'alias').symlink_to('canary')
    (source / '.gitignore').write_text('.env\n')
    git(source, 'add', '.')
    git(source, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture')
    (source / '.env').write_text('SYNTHETIC_IGNORED_SECRET')
    snap = base / 'snapshot'
    state = runtime.snapshot(source, snap, [])
    policy = base / 'policy'
    policy.mkdir()
    (policy / 'claude-settings.json').write_text('{"disableAllHooks":true}')
    (policy / 'fixture.mjs').write_text(program)
    for root in (snap / '.git', policy):
        for name in ('canary', 'delete-canary', 'rename-canary'):
            (root / name).write_text('original')
        (root / 'alias').symlink_to('canary')
    # Source aliases допустимы; policy symlinks запрещены основным launcher.
    (policy / 'alias').unlink()
    (policy / 'alias').write_text('original')
    runroot = base / 'run'
    runroot.mkdir()
    for root in (source, snap, policy):
        for item in [root, *root.rglob('*')]:
            if not item.is_symlink():
                item.chmod(0o777 if item.is_dir() else 0o666)
    manifest = {'schema_version': 1, 'family': 'claude', 'source': str(source),
        'snapshot': str(snap), 'state': state, 'dirty_paths': [], 'policy': str(policy),
        'policy_sha256': runtime.tree_hash(policy), 'run_root': str(runroot), 'image': image,
        'model': 'claude-opus-4-6', 'effort': 'medium', 'env_paths': {}, 'path_map': {},
        'managed_mapping_verified': False, 'fixture': True}
    manifest_path = base / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2))
    return base, manifest, manifest_path


program = (ROOT / 'fixture.mjs').read_text()
summary = []
for name, writable in [('writable-control', True), ('readonly-boundary', False)]:
    base, manifest, manifest_path = fixture(name, program)
    args = runtime.command(manifest, [], {})
    before = (Path(manifest['snapshot']) / '.git/canary').read_bytes()
    if writable:
        args = [arg.replace(',readonly', '') for arg in args]
    result = run(args, env=runtime.child_env(), input=b'')
    (base / 'stdout.log').write_bytes(result.stdout)
    (base / 'stderr.log').write_bytes(result.stderr)
    (base / 'command.json').write_text(json.dumps(args, indent=2))
    expected = 41 if writable else 0
    assert result.returncode == expected, (name, result.returncode, result.stderr.decode())
    report = json.loads(result.stdout)
    assert len(report['results']) == 18
    assert all(row['denied'] == (not writable) for row in report['results'])
    if not writable:
        assert (Path(manifest['snapshot']) / '.git/canary').read_bytes() == before
        assert runtime.fingerprint(manifest['source'], []) == manifest['state']
        assert runtime.fingerprint(manifest['snapshot'], []) == manifest['state']
        assert runtime.tree_hash(manifest['policy']) == manifest['policy_sha256']
    summary.append({'check': name, 'exit': result.returncode, 'operations': 18})

# Точные raw streams и ненулевой exit через настоящий host wrapper и Docker.
program = "process.stderr.write('fixture-stderr\\n');process.stdin.pipe(process.stdout);process.stdin.on('end',()=>process.exitCode=42);"
base, manifest, manifest_path = fixture('protocol', program)
data = b'{"id":1,"method":"initialize","params":{}}\n{"payload":"unicode-\\u0424"}\n'
result = run(['/usr/bin/python3', '-I', str(ROOT / 'runtime.py'), str(manifest_path)],
             input=data, env={**runtime.child_env(), 'MULTICA_TOKEN': 'SYNTHETIC_TOKEN'})
(base / 'stdout.log').write_bytes(result.stdout)
(base / 'stderr.log').write_bytes(result.stderr)
assert result.returncode == 42, result.stderr.decode()
assert result.stdout == data
assert result.stderr == b'fixture-stderr\n'
summary.append({'check': 'protocol', 'exit': 42, 'exact_streams': True})

program = "process.on('SIGTERM',()=>{process.stderr.write('TERM\\n');process.exit(143)});process.stdout.write('READY\\n');setInterval(()=>{},1000);"
base, manifest, manifest_path = fixture('signal', program)
process = subprocess.Popen(['/usr/bin/python3', '-I', str(ROOT / 'runtime.py'), str(manifest_path)],
    env=runtime.child_env(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
assert process.stdout.readline() == b'READY\n'
process.send_signal(signal.SIGTERM)
stdout, stderr = process.communicate(timeout=10)
(base / 'stderr.log').write_bytes(stderr)
assert process.returncode == 143, (process.returncode, stderr)
assert stderr == b'TERM\n'
summary.append({'check': 'signal', 'exit': 143, 'forwarded_SIGTERM': True})

# Проверка реального app-server через JSONL guard, без модели и credentials.
base, manifest, manifest_path = fixture('codex-cwd-guard', '')
policy = Path(manifest['policy'])
(policy / 'protocol-guard.mjs').write_bytes((ROOT / 'protocol-guard.mjs').read_bytes())
manifest.update(family='codex', model='gpt-5.6-terra', fixture=False,
                managed_mapping_verified=True, policy_sha256=runtime.tree_hash(policy))
manifest_path.write_text(json.dumps(manifest, indent=2))
result = run(['/usr/bin/python3', '-I', str(ROOT / 'runtime.py'), str(manifest_path), 'app-server'],
             input=b'{"id":1,"method":"thread/start","params":{"cwd":"/tmp"}}\n', env=runtime.child_env())
(base / 'stdout.log').write_bytes(result.stdout)
(base / 'stderr.log').write_bytes(result.stderr)
assert result.returncode == 78, (result.returncode, result.stderr)
assert b'rejected protocol cwd' in result.stderr
summary.append({'check': 'codex-cwd-guard', 'exit': 78, 'rejected_alternate_cwd': True})
(evidence / 'results.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
