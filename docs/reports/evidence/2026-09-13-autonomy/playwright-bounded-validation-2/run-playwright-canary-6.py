from pathlib import Path
import json, hashlib, subprocess, datetime, uuid
root=Path('/private/tmp/altera-agent-loop-autonomy')
s=root/'.superpowers/sdd/2026-09-13-autonomy-execution'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(p,data):
    with p.open('x') as f:
        json.dump(data,f,indent=2); f.write('\n'); f.flush()
        import os; os.fsync(f.fileno())
proof=json.loads((s/'playwright-static/namespace-capability-fix/source-proof.json').read_text())
pins={k:v['after'] for k,v in proof['files'].items()}; pins.update(proof['unchanged_sources'])
assert len(pins)==10
before={rel:sha(root/rel) for rel in pins}; assert before==pins
review=s/'task-5-playwright-namespace-capability-fix-independent-review.md'
assert sha(review)=='46488f090574fde3361df7d980b385a93426577bfb5e35cbd3180eed910ca45d'
request=s/'task-5-playwright-bounded-validation-request.md'
archived=root/'docs/reports/evidence/2026-09-13-autonomy/playwright-current-action-metadata-fix/task-5-playwright-bounded-validation-request.md'
assert sha(request)==sha(archived)
assert json.loads((s/'playwright-static/failure-history.json').read_text())['canary_consecutive_failures']==5
out=s/'playwright-static/canary-6'; assert not out.exists()
attempt=uuid.uuid4().hex
image='sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426'
cmd=['/usr/bin/python3','-I','scripts/agent-runtime/test_playwright_mcp.py','--docker',image,str(out)]
env={'PATH':'/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin:/usr/local/bin:/usr/bin:/bin','HOME':'/var/empty'}
auth={'attempt_id':attempt,'check_id':'playwright canary','authorized_at':now(),'authority':'explicit user approval of up to three bounded validation invocations; this is invocation2of3','scope_sha256':sha(request),'allowed_new_invocations':1,'package_invocation':2,'package_limit':3,'consecutive_failures_before':5,'image':image,'sources':pins,'snapshot_review_sha256':sha(review),'receipt_authorized':False,'failure_action':'record cause and cleanup; another invocation only after cause correction and independent review within remaining package budget'}
authpath=s/'task-5-playwright-canary-6-authorization.json'; save(authpath,auth)
claim={'attempt_id':attempt,'check_id':'playwright canary','claimed_at':now(),'authorization_sha256':sha(authpath),'allowed_invocations_claimed':1,'sources_before':before,'command':cmd,'environment':env,'cwd':str(root),'count_before':5}
save(s/'playwright-static/canary-6-invocation-claim.json',claim)
save(s/'playwright-static/canary-6-command.json',cmd)
save(s/'playwright-static/canary-6-env.json',env)
save(s/'playwright-static/canary-6-started.json',{'attempt_id':attempt,'started_at':now()})
print(json.dumps({'attempt_id':attempt,'started':True}),flush=True)
with (s/'playwright-static/canary-6.log').open('xb') as log:
    proc=subprocess.run(cmd,cwd=str(root),env=env,stdout=log,stderr=subprocess.STDOUT)
after={rel:sha(root/rel) for rel in pins}
result={'attempt_id':attempt,'check_id':'playwright canary','exit':proc.returncode if proc.returncode>=0 else None,'signal':-proc.returncode if proc.returncode<0 else None,'finished_at':now(),'sources_after':after,'sources_unchanged':after==before,'consecutive_failures_before':5,'receipt_created':False,'acceptance':'pending_independent_evidence_review' if proc.returncode==0 else 'failed_stopped'}
save(s/'playwright-static/canary-6-result.json',result)
print(json.dumps(result),flush=True)
