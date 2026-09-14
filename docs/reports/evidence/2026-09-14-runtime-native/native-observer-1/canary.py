import importlib.util,json,hashlib,pathlib,tempfile,subprocess,shutil
root=pathlib.Path('/Users/egorbondarenko/WebstormProjects/Altera')
s=root/'.superpowers/sdd/2026-09-13-autonomy-execution'
p=root/'scripts/agent-runtime/runtime.py'
assert hashlib.sha256(p.read_bytes()).hexdigest()=='3f104d127949a68f57040be35916be4a14dd999b71918a7c33d81611dc69183c'
spec=importlib.util.spec_from_file_location('accepted_runtime',p);runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
base=pathlib.Path(tempfile.mkdtemp(prefix='altera-native-observer-',dir='/private/tmp'))
(s/'native-observer-canary-location.json').write_text(json.dumps({'path':str(base)})+'\n')
policy=base/'policy';shutil.copytree('/Users/egorbondarenko/Library/Application Support/Altera/agent-runtime/deployments/20260914-native-v1/base-policy',policy)
shutil.copy2(root/'scripts/agent-runtime/runtime-check.test.mjs',policy/'runtime-check.test.mjs')
paths=[x for x in subprocess.check_output(['/usr/bin/git','ls-files','--others','--exclude-standard','-z'],cwd=root).decode().split('\0') if x]
snapshot=base/'snapshot';runtime.snapshot(root,snapshot,paths)
run=base/'run';run.mkdir(mode=0o700)
manifest={'schema_version':1,'family':'claude','source':str(root),'snapshot':str(snapshot),'state':runtime.fingerprint(root,paths),'dirty_paths':paths,'policy':str(policy),'policy_sha256':runtime.tree_hash(policy),'run_root':str(run),'image':'sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426','model':'claude-opus-4-6','effort':'medium','env_paths':{},'path_map':{},'managed_mapping_verified':True,'network':'none'}
check={'schema_version':1,'argv':['/usr/local/bin/node','--test','--test-reporter=tap','/runtime/policy/runtime-check.test.mjs'],'cwd':str(root),'network':'none','parser':'node-tap','timeout_seconds':120,'maximum_output':1048576}
f=base/'check.json';f.write_text(json.dumps(check,sort_keys=True,separators=(',',':'))+'\n');f.chmod(0o600)
(base/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
result=runtime.check(manifest,f,hashlib.sha256(f.read_bytes()).hexdigest(),invocation_id='native-observer-canary-1')
(base/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'evidence':str(base/'result.json'),'result':result},ensure_ascii=False))
assert result['complete'] and result['exit_code']==0 and result['executed']==5
