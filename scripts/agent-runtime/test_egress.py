"""Реальная проверка provider proxy на заранее созданном synthetic snapshot."""
import json
from pathlib import Path
import subprocess
import sys
import importlib.util

root = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('runtime', root / 'runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
manifest = json.loads(Path(sys.argv[1]).read_text())
base = Path(sys.argv[2]).resolve()
base.mkdir(exist_ok=False)
policy = base / 'policy'
policy.mkdir()
for source, destination in [('egress-fixture.mjs', 'fixture.mjs'), ('provider-proxy.mjs', 'provider-proxy.mjs')]:
    (policy / destination).write_bytes((root / source).read_bytes())
(policy / 'claude-settings.json').write_text('{"disableAllHooks":true}')
run = base / 'run'
run.mkdir()
manifest.update(policy=str(policy), policy_sha256=runtime.tree_hash(policy), run_root=str(run), network='provider-proxy')
manifest_path = base / 'manifest.json'
manifest_path.write_text(json.dumps(manifest, indent=2))
result = subprocess.run(['/usr/bin/python3', '-I', str(root / 'runtime.py'), str(manifest_path)],
    env={**runtime.child_env(), 'MULTICA_TOKEN': 'SYNTHETIC_TOKEN'},
    input=b'', stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
(base / 'stdout.log').write_bytes(result.stdout)
(base / 'stderr.log').write_bytes(result.stderr)
(base / 'exit.json').write_text(json.dumps({'exit': result.returncode}))
assert result.returncode == 0, (result.returncode, result.stderr.decode())
report = json.loads(result.stdout)
assert report['forbidden'] == [403] * 5
assert report['directResults'] == ['blocked'] * 3
print(json.dumps(report, indent=2))
