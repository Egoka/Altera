import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import time

ROOT = Path(__file__).resolve().parent
EXPECTED = '3e61e70d2e0d5d5cac9caa14eb23acc4082087608bfbb14d1232493776740b79'
os.umask(0o077)
path = ROOT / 'commands.json'
metadata = path.lstat()
assert stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid()
assert metadata.st_size < 65536 and not metadata.st_mode & 0o022
raw = path.read_bytes()
assert hashlib.sha256(raw).hexdigest() == EXPECTED
manifest = json.loads(raw)
plan = manifest['runtime_identity_preflight']
evidence = Path(plan['evidence_directory'])
assert evidence == ROOT / 'evidence' / 'runtime-identity'
evidence.mkdir(mode=0o700, parents=True, exist_ok=False)
environment = manifest['environment']
report = {'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'commands_sha256': EXPECTED, 'image': manifest['image'],
          'candidate_applied': False, 'syscall_probe_run': False,
          'browser_run': False, 'accepted': False, 'commands': {}}

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

def inspected(raw, created_id, terminal=False):
    rows = json.loads(raw)
    assert isinstance(rows, list) and len(rows) == 1
    obj = rows[0]
    for dotted, expected in plan['gates']['inspect'].items():
        if dotted == 'exit':
            continue
        if dotted == 'Id':
            expected = created_id
        if dotted == 'State.Status' and terminal:
            expected = 'exited'
        value = obj
        for component in dotted.split('.'):
            value = value[component]
        assert value == expected, 'inspect_gate_' + dotted
    if terminal:
        assert obj['State']['ExitCode'] == 0
        assert obj['State']['OOMKilled'] is False
        assert obj['State']['Error'] == ''
    return obj

def interrupted(signum, frame):
    raise InterruptedError('coordinator_interrupted')

signal.signal(signal.SIGTERM, interrupted)
created = False
started_ok = False
cleanup = False
try:
    assert run('pre_absence') == b'', 'preexisting_name'
    value = run('create').decode().strip()
    created = True
    assert re.fullmatch('[0-9a-f]{64}', value), 'created_id_invalid'
    report['container_id'] = value
    save(evidence / 'created-id.json', {'container_id': value, 'name': plan['name']})
    inspected(run('inspect'), value)
    identity_raw = run('start_attach')
    inspected(run('post_inspect'), value, terminal=True)
    identity = json.loads(identity_raw)
    assert set(identity) == {'path', 'canonical', 'regular', 'executable', 'sha256', 'elf'}
    assert identity['path'] == identity['canonical'] == '/usr/bin/perl'
    assert identity['regular'] is True and identity['executable'] is True
    assert re.fullmatch('[0-9a-f]{64}', identity['sha256'])
    header = bytes.fromhex(identity['elf'])
    assert len(header) == 20 and header[:6] == b'\x7fELF\x02\x01'
    assert int.from_bytes(header[18:20], 'little') == 183
    report['identity'] = identity
    started_ok = True
except BaseException as error:
    report['failure'] = {'class': type(error).__name__, 'reason': str(error)}
finally:
    if created:
        try:
            run('remove')
        except BaseException as error:
            report['cleanup_error'] = type(error).__name__
        try:
            cleanup = run('post_absence') == b''
        except BaseException as error:
            report['absence_error'] = type(error).__name__
    report['cleanup_confirmed'] = cleanup
    report['commands_unchanged'] = hashlib.sha256(path.read_bytes()).hexdigest() == EXPECTED
    report['accepted'] = started_ok and cleanup and report['commands_unchanged'] and 'cleanup_error' not in report
    report['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save(evidence / 'result.json', report)
print(json.dumps(report, indent=2))
raise SystemExit(0 if report['accepted'] else 1)
