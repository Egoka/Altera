import datetime, hashlib, json, os, re, selectors, signal, stat, subprocess, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent
os.umask(0o077)
EXPECTED = '3e61e70d2e0d5d5cac9caa14eb23acc4082087608bfbb14d1232493776740b79'
command_path = ROOT/'commands.json'
assert hashlib.sha256(command_path.read_bytes()).hexdigest() == EXPECTED
manifest = json.loads(command_path.read_text())
assert json.loads((ROOT/'chroot-authorization.json').read_text())['two_cause_arms_authorized'] is True
identity_path = ROOT/'evidence/runtime-identity/result.json'
assert hashlib.sha256(identity_path.read_bytes()).hexdigest() == 'fe120a7a1de0687cbdd1e7687e85dfa1b129535eff7d3453c72981fee112be3d'
identity = json.loads(identity_path.read_text())
assert identity['accepted'] and identity['cleanup_confirmed']
assert identity['identity']['sha256'] == 'a87e4138d1e33d240bd31be3dd5ec59017f729b7aa9bd6b3dc012dfcab85d69b'
held = []
def bind_file(path, digest, mode):
    before = path.lstat()
    assert stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
    assert stat.S_IMODE(before.st_mode) == mode
    fd = os.open(str(path), os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    current = os.fstat(fd)
    assert (current.st_dev,current.st_ino) == (before.st_dev,before.st_ino)
    data = os.read(fd, 131073)
    assert len(data) == current.st_size and hashlib.sha256(data).hexdigest() == digest
    held.append((path,fd,current,digest))
    return data
assert stat.S_IMODE(ROOT.stat().st_mode) == 0o700
probe = bind_file(ROOT/'probe.pl',manifest['probe_sha256'],0o644)
policies = {}
for kind in ('control','candidate'):
    item = manifest['arms'][kind]
    policies[kind] = json.loads(bind_file(Path(item['profile']),item['profile_sha256'],0o600))
claim = ROOT/'cause-claimed.json'
with claim.open('x') as f:json.dump({'authorized':True,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commands_sha256':EXPECTED},f)
environment = manifest['environment']
overall = {'commands_sha256':EXPECTED,'image':manifest['image'],'probe_sha256':manifest['probe_sha256'],'arms':{},'confirmed':False,'browser_run':False,'browser_consecutive_failures':2}
def save(path, data):
    with Path(path).open('xb') as file:
        file.write(json.dumps(data, indent=2).encode() + b'\n')

def run(name):
    global created
    targets = plan['outputs'][name]
    argv = plan[name]
    save(targets['command'], {'argv': argv, 'environment': environment})
    outputs = {'stdout': bytearray(), 'stderr': bytearray()}
    started = time.monotonic()
    problem = None
    process = subprocess.Popen(argv, env=environment, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)
    selector = selectors.DefaultSelector()
    streams = {}
    try:
        for channel in outputs:
            stream = getattr(process, channel)
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, channel)
            streams[channel] = Path(targets[channel]).open('xb')
        while selector.get_map():
            remaining = plan['outer_timeout_seconds'] - (time.monotonic() - started)
            if remaining <= 0:
                raise TimeoutError('command_timeout')
            for key, event in selector.select(min(remaining, 0.25)):
                data = os.read(key.fileobj.fileno(), 8192)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                channel = key.data
                limit = targets[channel + '_limit_bytes']
                permitted = max(0, limit - len(outputs[channel]))
                piece = data[:permitted]
                streams[channel].write(piece)
                outputs[channel].extend(piece)
                if len(data) > permitted:
                    raise RuntimeError('output_limit')
        remaining = plan['outer_timeout_seconds'] - (time.monotonic() - started)
        process.wait(timeout=max(0.01, remaining))
    except BaseException as error:
        problem = type(error).__name__
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=3)
    finally:
        selector.close()
        for stream in streams.values():
            stream.close()
        process.stdout.close()
        process.stderr.close()
    result = {'returncode': process.returncode,
              'signal': -process.returncode if process.returncode < 0 else None,
              'problem': problem, 'elapsed_seconds': time.monotonic() - started,
              'stdout_bytes': len(outputs['stdout']), 'stderr_bytes': len(outputs['stderr'])}
    save(targets['exit'], result)
    report['commands'][name] = result
    if name == 'create' and process.returncode == 0:
        created = True
    if problem or process.returncode != 0 or outputs['stderr']:
        raise RuntimeError('command_refused_' + name)
    return bytes(outputs['stdout'])

def interrupted(signum, frame):
    raise InterruptedError('coordinator_interrupted')
def inspect_arm(raw, cid, kind, terminal=False):
    values=json.loads(raw); assert len(values)==1
    obj=values[0]; arm=manifest['arms'][kind]; name=arm['create'][2].split('=',1)[1]
    for dotted, expected in manifest['runtime_identity_preflight']['gates']['inspect'].items():
        if dotted in ('exit','HostConfig.SecurityOpt','Mounts'):continue
        replacements={'Id':cid,'Name':'/'+name,'Config.Entrypoint':['/usr/bin/env'], 'Config.Cmd':['-i','/usr/bin/perl','-T','/probe.pl'], 'HostConfig.PidsLimit':32,'HostConfig.Memory':134217728,'State.Status':'exited' if terminal else 'created'}
        expected=replacements.get(dotted,expected)
        value=obj
        for component in dotted.split('.'):value=value[component]
        assert value==expected, 'inspect_'+dotted
    opts=obj['HostConfig']['SecurityOpt']; assert len(opts)==2 and 'no-new-privileges' in opts
    supplied=[x[len('seccomp='):] for x in opts if x.startswith('seccomp=')]
    assert len(supplied)==1 and json.loads(supplied[0])==policies[kind]
    mounts=obj['Mounts'];assert len(mounts)==1
    mount=mounts[0]
    assert mount['Type']=='bind' and mount['Source']==str(ROOT/'probe.pl') and mount['Destination']=='/probe.pl' and mount['RW'] is False
    if terminal:assert obj['State']['ExitCode']==0 and not obj['State']['OOMKilled'] and obj['State']['Error']==''
    return obj
signal.signal(signal.SIGTERM, interrupted)
try:
    for kind in ('control','candidate'):
        arm=manifest['arms'][kind]
        evidence=ROOT/'evidence'/kind
        evidence.mkdir(mode=0o700,parents=True,exist_ok=False)
        plan=dict(arm)
        plan['pre_absence']=arm['absence'];plan['post_absence']=arm['absence'];plan['post_inspect']=arm['inspect']
        plan['outputs']={}
        for label in ('pre_absence','create','inspect','start_attach','post_inspect','remove','post_absence'):
            plan['outputs'][label]={'stdout':str(evidence/(label+'.stdout.log')),'stderr':str(evidence/(label+'.stderr.log')),'command':str(evidence/(label+'.command.json')),'exit':str(evidence/(label+'.exit.json')),'stdout_limit_bytes':262144 if 'inspect' in label else 8192,'stderr_limit_bytes':8192}
        report={'kind':kind,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'profile_sha256':arm['profile_sha256'],'commands':{},'accepted_observation':False}
        created=False;cleanup=False;observed=False
        try:
            assert run('pre_absence')==b'', 'existing_name'
            cid=run('create').decode().strip();assert re.fullmatch('[a-f0-9]{64}',cid)
            report['container_id']=cid;save(evidence/'created-id.json',{'container_id':cid})
            inspect_arm(run('inspect'),cid,kind)
            output=run('start_attach');inspect_arm(run('post_inspect'),cid,kind,True)
            result=json.loads(output);report['probe_result']=result
            assert result['reaped']==1
            for side in ('parent_before','parent_after'):
                state=result[side]
                assert state['uid']==1000 and state['gid']==1000 and int(state['CapEff'],16)==0 and int(state['CapBnd'],16)==0
                assert state['NoNewPrivs']=='1' and state['Seccomp']=='2'
            assert result['parent_before']['namespace_inode']==result['parent_after']['namespace_inode']
            child=result['child']
            assert child['phase']=='chroot_result' and child['map_ok']==1 and child['chroot_attempted']==1, 'unexpected_probe_phase'
            assert child['before']['namespace_inode']!=child['after']['namespace_inode']
            assert child['after']['uid']==child['after']['gid']==1000 and int(child['after']['CapEff'],16)&(1<<18)
            expected=(-1,1) if kind=='control' else (0,0)
            assert (child['return'],child['errno'])==expected,'unexpected_syscall_result'
            observed=True
        except BaseException as error:
            report['failure']={'class':type(error).__name__,'reason':str(error)}
        finally:
            if created:
                try:run('remove')
                except BaseException as error:report['cleanup_error']=type(error).__name__
                try:cleanup=run('post_absence')==b''
                except BaseException as error:report['absence_error']=type(error).__name__
            report['cleanup_confirmed']=cleanup
            report['accepted_observation']=observed and cleanup and 'cleanup_error' not in report
            report['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
            save(evidence/'result.json',report);overall['arms'][kind]=report
        if not report['accepted_observation']:raise RuntimeError('cause_control_stopped_'+kind)
    overall['confirmed']=True
except BaseException as error:
    overall['failure']={'class':type(error).__name__,'reason':str(error)}
finally:
    unchanged=True
    for p,fd,before,digest in held:
        now=os.fstat(fd);named=p.lstat();os.lseek(fd,0,0);data=os.read(fd,131073)
        unchanged=unchanged and (now.st_dev,now.st_ino,now.st_size,now.st_mtime_ns,now.st_ctime_ns,now.st_mode)==(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns,before.st_mode) and (named.st_dev,named.st_ino)==(now.st_dev,now.st_ino) and hashlib.sha256(data).hexdigest()==digest
        os.close(fd)
    overall['inputs_unchanged']=unchanged and hashlib.sha256(command_path.read_bytes()).hexdigest()==EXPECTED
    overall['confirmed']=overall['confirmed'] and overall['inputs_unchanged']
    save(ROOT/'cause-result.json',overall)
print(json.dumps(overall,indent=2))
raise SystemExit(0 if overall['confirmed'] else 1)
