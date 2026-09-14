#!/usr/bin/python3 -I
"""Trusted coordinator: opaque credential generations, shared lock и durable publication."""
from contextlib import contextmanager
import errno
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
from types import SimpleNamespace
import uuid

spec = importlib.util.spec_from_file_location('refresh_runtime', Path(__file__).with_name('runtime.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
GENERATION = re.compile(r'[a-f0-9]{32}')
MAX_FILE = 65536
STAGES = ('prepared', 'exchange_started', 'candidate_written', 'candidate_accepted', 'published')


def directory(path):
    """Каждый компонент открывается относительно предыдущего fd, без symlink traversal."""
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or re.search(r'[\x00-\x1f,=]', str(path)):
        raise ValueError('unsafe_store_path')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def metadata(info, is_directory=False, allow_empty=False):
    kind = stat.S_ISDIR(info.st_mode) if is_directory else stat.S_ISREG(info.st_mode)
    if (not kind or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != (0o700 if is_directory else 0o600) or
        (not is_directory and (info.st_nlink != 1 or info.st_size > MAX_FILE or (not allow_empty and info.st_size == 0)))):
        raise ValueError('unsafe_private_metadata')


def public_model_result(result):
    """Повторная граница redaction: journal не доверяет произвольным полям stdout."""
    def numbers(value, keys):
        if not isinstance(value, dict):
            raise ValueError('model_result_unaccepted')
        clean = {}
        for key in keys:
            if key in value:
                number = value[key]
                if type(number) not in (int, float) or not 0 <= number < float('inf'):
                    raise ValueError('model_result_unaccepted')
                clean[key] = number
        return clean
    if result.get('status') != 'model_accepted' or result.get('billingVerified') is not False:
        raise ValueError('model_result_unaccepted')
    usage = numbers(result.get('usage'), ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'))
    for group, keys in [('output_tokens_details', ('thinking_tokens',)), ('cache_creation', ('ephemeral_1h_input_tokens', 'ephemeral_5m_input_tokens')),
                        ('server_tool_use', ('web_search_requests', 'web_fetch_requests'))]:
        if group in result['usage']:
            usage[group] = numbers(result['usage'][group], keys)
            if group == 'server_tool_use' and any(usage[group].values()):
                raise ValueError('model_result_unaccepted')
    models = result.get('modelUsage')
    if not isinstance(models, dict) or 'claude-opus-4-6' not in models:
        raise ValueError('model_result_unaccepted')
    clean_models = {}
    for name, value in models.items():
        expected = {'claude-opus-4-6': 'claude-opus-4-6', 'claude-haiku-4-5-20251001': 'claude-haiku-4-5'}.get(name)
        if (not expected or not isinstance(value, dict) or value.get('canonicalModel') != expected or
            value.get('provider') != 'firstParty' or value.get('costBasis') != 'list'):
            raise ValueError('model_result_unaccepted')
        clean = numbers(value, ('inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens',
                               'webSearchRequests', 'costUSD', 'contextWindow', 'maxOutputTokens', 'thinkingTokens'))
        if clean.get('webSearchRequests', 0) != 0:
            raise ValueError('model_result_unaccepted')
        clean_models[name] = {**clean, 'canonicalModel': expected, 'provider': 'firstParty', 'costBasis': 'list'}
    cost = numbers(result, ('totalCostUsd',))
    if 'totalCostUsd' not in cost:
        raise ValueError('model_result_unaccepted')
    return {'status': 'model_accepted', 'usage': usage, 'modelUsage': clean_models, **cost, 'billingVerified': False}


class Store:
    def __init__(self, manifest, runner=None):
        required = {'schema_version', 'store', 'policy', 'policy_sha256', 'run_root', 'image', 'network', 'check_id', 'attempt_id'}
        if (set(manifest) != required or manifest['schema_version'] != 1 or manifest['image'] != runtime.REFRESH_IMAGE or
            manifest['network'] != 'provider-proxy' or not GENERATION.fullmatch(manifest['attempt_id']) or
            not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}', manifest['check_id'])):
            raise ValueError('invalid_refresh_manifest')
        self.manifest = dict(manifest)
        self.path = Path(manifest['store'])
        if not self.path.is_absolute() or self.path in (Path('/'), Path.home()) or os.getuid() == 0:
            raise ValueError('unsafe_store_path')
        if not self.path.exists() and not self.path.is_symlink():
            self.path.mkdir(mode=0o700)
        self.fd = directory(self.path)
        try:
            metadata(os.fstat(self.fd), True)
            try:
                os.mkdir('generations', 0o700, dir_fd=self.fd); os.fsync(self.fd)
            except FileExistsError:
                pass
            self.generations = os.open('generations', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.fd)
            metadata(os.fstat(self.generations), True)
            if os.fstat(self.generations).st_dev != os.fstat(self.fd).st_dev:
                raise ValueError('cross_filesystem_store')
        except BaseException:
            if hasattr(self, 'generations'): os.close(self.generations)
            os.close(self.fd)
            raise
        self.runner = runner or self.container

    def close(self):
        if self.fd is not None:
            os.close(self.generations); os.close(self.fd); self.fd = None

    def file(self, parent, name, allow_empty=False):
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
        except OSError:
            raise ValueError('unsafe_or_missing_store_file') from None
        try:
            metadata(os.fstat(fd), allow_empty=allow_empty)
            return fd
        except BaseException:
            os.close(fd)
            raise

    @contextmanager
    def locked(self, timeout=None):
        if timeout is not None and (type(timeout) not in (int, float) or timeout < 0):
            raise ValueError('invalid_lock_timeout')
        metadata(os.fstat(self.fd), True)
        lock = os.open('refresh.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        try:
            metadata(os.fstat(lock), allow_empty=True)
            if timeout is None:
                fcntl.flock(lock, fcntl.LOCK_EX)
            else:
                deadline = time.monotonic() + timeout
                while True:
                    try:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except OSError as error:
                        if error.errno not in (errno.EACCES, errno.EAGAIN):
                            raise
                        if time.monotonic() >= deadline:
                            raise ValueError('admission_lock_timeout') from None
                        time.sleep(min(0.01, max(0, deadline - time.monotonic())))
            metadata(os.fstat(self.fd), True)
            metadata(os.fstat(lock), allow_empty=True)
            metadata(os.fstat(self.generations), True)
            named = os.stat('generations', dir_fd=self.fd, follow_symlinks=False)
            held_generation = os.fstat(self.generations)
            if (named.st_dev, named.st_ino) != (held_generation.st_dev, held_generation.st_ino):
                raise ValueError('generations_replaced')
            found = os.stat('refresh.lock', dir_fd=self.fd, follow_symlinks=False)
            held = os.fstat(lock)
            if (found.st_dev, found.st_ino) != (held.st_dev, held.st_ino):
                raise ValueError('lock_replaced')
            actual = os.stat(self.path, follow_symlinks=False)
            if (actual.st_dev, actual.st_ino) != (os.fstat(self.fd).st_dev, os.fstat(self.fd).st_ino):
                raise ValueError('store_replaced')
            for name in os.listdir(self.generations):
                if not re.fullmatch(r'[a-f0-9]{32}(?:\.pending)?', name):
                    raise ValueError('unexpected_generation_name')
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN); os.close(lock)

    def exists(self, parent, name):
        try:
            os.stat(name, dir_fd=parent, follow_symlinks=False)
            return True
        except FileNotFoundError:
            return False

    def read_json(self, name, optional=False):
        if optional and not self.exists(self.fd, name):
            return None
        fd = self.file(self.fd, name)
        try:
            data = os.read(fd, MAX_FILE + 1)
            def unique(pairs):
                value = {}
                for key, item in pairs:
                    if key in value:
                        raise ValueError('invalid_metadata_json')
                    value[key] = item
                return value
            return json.loads(data, object_pairs_hook=unique)
        except (ValueError, UnicodeError):
            raise ValueError('invalid_metadata_json') from None
        finally:
            os.close(fd)

    def atomic_json(self, name, value):
        if self.exists(self.fd, name):
            existing = self.file(self.fd, name); os.close(existing)
        temporary = '.metadata-' + uuid.uuid4().hex
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        try:
            data = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
            if len(data) > MAX_FILE:
                raise ValueError('metadata_limit')
            while data:
                written = os.write(fd, data); data = data[written:]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(temporary, name, src_dir_fd=self.fd, dst_dir_fd=self.fd)
        os.fsync(self.fd)

    def current(self):
        value = self.read_json('current.json')
        if not isinstance(value, dict) or set(value) != {'generation'} or not isinstance(value['generation'], str) or not GENERATION.fullmatch(value['generation']):
            raise ValueError('invalid_current_pointer')
        return value['generation']

    def generation(self, name):
        if not re.fullmatch(r'[a-f0-9]{32}(?:\.pending)?', name):
            raise ValueError('invalid_generation')
        try:
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.generations)
        except OSError:
            raise ValueError('unsafe_or_missing_generation') from None
        try:
            metadata(os.fstat(fd), True)
            if os.fstat(fd).st_dev != os.fstat(self.generations).st_dev:
                raise ValueError('cross_filesystem_generation')
            return fd
        except BaseException:
            os.close(fd)
            raise

    def credential(self, name):
        parent = self.generation(name)
        try:
            fd = self.file(parent, '.credentials.json')
        finally:
            os.close(parent)
        return SimpleNamespace(path=self.path / 'generations' / name / '.credentials.json', fd=fd)

    @contextmanager
    def select_current(self, timeout=None):
        with self.locked(timeout=timeout):
            selected = self.credential(self.current())
        try:
            yield selected
        finally:
            os.close(selected.fd)

    def bootstrap(self, source):
        with self.locked():
            if self.exists(self.fd, 'current.json') or self.exists(self.fd, 'refresh-state.json') or os.listdir(self.generations):
                raise ValueError('bootstrap_store_not_empty')
            source = Path(source)
            parent = directory(source.parent)
            try:
                original = self.file(parent, source.name)
            finally:
                os.close(parent)
            try:
                before = os.fstat(original)
                name = uuid.uuid4().hex
                os.mkdir(name, 0o700, dir_fd=self.generations)
                generation = self.generation(name)
                try:
                    target = os.open('.credentials.json', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=generation)
                    try:
                        total = 0
                        while True:
                            data = os.read(original, 8192)
                            if not data: break
                            total += len(data)
                            if total > MAX_FILE: raise ValueError('bootstrap_source_changed')
                            while data:
                                count = os.write(target, data); data = data[count:]
                        os.fsync(target)
                    finally:
                        os.close(target)
                    os.fsync(generation)
                finally:
                    os.close(generation)
                after = os.fstat(original)
                if total != before.st_size or (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_ino, after.st_dev, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    raise ValueError('bootstrap_source_changed')
                os.fsync(self.generations)
                self.atomic_json('current.json', {'generation': name})
                return {'status': 'bootstrapped', 'original_retained': True}
            finally:
                os.close(original)

    def write_state(self, state):
        self.atomic_json('refresh-state.json', state)

    def state(self):
        value = self.read_json('refresh-state.json', optional=True)
        if value is None: return None
        required = {'stage', 'old', 'candidate', 'attempt_id', 'check_id', 'image', 'policy_sha256', 'worker'}
        if (not isinstance(value, dict) or not required.issubset(value) or set(value) - required - {'model_result'} or
            value['stage'] not in STAGES or any(not isinstance(value[key], str) or not GENERATION.fullmatch(value[key]) for key in ('old', 'candidate', 'attempt_id')) or
            value['old'] == value['candidate']):
            raise ValueError('invalid_refresh_journal')
        worker = value['worker']
        if worker is None:
            if value['stage'] != 'prepared': raise ValueError('worker_identity_missing')
        elif (not isinstance(worker, dict) or set(worker) != {'name', 'operation', 'quiescence'} or
              not isinstance(worker['name'], str) or not re.fullmatch(r'altera-refresh-[a-f0-9]{32}', worker['name']) or
              worker['operation'] not in ('exchange', 'status', 'model') or worker['quiescence'] not in ('unconfirmed', 'confirmed')):
            raise ValueError('invalid_worker_identity')
        for key in ('image', 'policy_sha256', 'check_id'):
            if value[key] != self.manifest[key]:
                raise ValueError('refresh_identity_changed')
        if value['stage'] in ('candidate_accepted', 'published'):
            value['model_result'] = public_model_result(value.get('model_result', {}))
        return value

    def quiesce(self, state):
        """Только адресный cleanup; успешный пустой Docker listing доказывает отсутствие worker."""
        worker = state['worker']
        if worker is None: return state['stage'] == 'prepared'
        if worker['quiescence'] == 'confirmed': return True
        name = worker['name']
        try:
            subprocess.run([runtime.DOCKER, 'rm', '--force', name], env=runtime.child_env(),
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=15, check=False)
        except (OSError, subprocess.SubprocessError):
            pass
        try:
            proof = subprocess.run([runtime.DOCKER, 'container', 'ls', '--all', '--filter', 'name=^/' + name + '$',
                                    '--format', '{{.Names}}'], env=runtime.child_env(), stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15, check=False)
            if proof.returncode != 0 or proof.stdout != b'': return False
        except (OSError, subprocess.SubprocessError):
            return False
        state['worker'] = {**worker, 'quiescence': 'confirmed'}
        self.write_state(state)
        return True

    def run_operation(self, state, operation, credential, output):
        if not self.quiesce(state): return {'status': 'worker_cleanup_unconfirmed'}
        if operation == 'exchange': state['stage'] = 'exchange_started'
        state['worker'] = {'name': 'altera-refresh-' + uuid.uuid4().hex,
                           'operation': operation, 'quiescence': 'unconfirmed'}
        self.write_state(state)
        try:
            result = self.runner(operation, credential, output)
        finally:
            # container уже проверяет cleanup до снятия proxy; после interruption перечитываем durable результат.
            state.update(self.state())
        return result if self.quiesce(state) else {'status': 'worker_cleanup_unconfirmed'}

    def candidate(self, state):
        pending, final = state['candidate'] + '.pending', state['candidate']
        names = [name for name in (pending, final) if self.exists(self.generations, name)]
        if len(names) != 1:
            raise ValueError('candidate_missing_or_ambiguous')
        return self.credential(names[0])

    def publish(self, state):
        if state['stage'] != 'candidate_accepted':
            raise ValueError('unaccepted_candidate')
        if not self.quiesce(state): return {'status': 'worker_cleanup_unconfirmed'}
        selected = self.candidate(state); os.close(selected.fd)
        if selected.path.parent.name.endswith('.pending'):
            os.rename(state['candidate'] + '.pending', state['candidate'], src_dir_fd=self.generations, dst_dir_fd=self.generations)
            os.fsync(self.generations)
        changed = self.current() != state['candidate']
        if changed:
            self.atomic_json('current.json', {'generation': state['candidate']})
        self.write_state({**state, 'stage': 'published'})
        return {'status': 'published', 'generation_changed': changed, 'model_result': state['model_result']}

    def refresh(self):
        with self.locked():
            old = self.current()
            previous = self.credential(old); os.close(previous.fd)
            state = self.state()
            if state and not self.quiesce(state): return {'status': 'worker_cleanup_unconfirmed'}
            if state and state['stage'] == 'published':
                if old != state['candidate']: raise ValueError('pointer_journal_mismatch')
                if state['attempt_id'] == self.manifest['attempt_id']:
                    return {'status': 'published', 'generation_changed': False, 'model_result': state['model_result']}
                state = None
            if state and state['attempt_id'] != self.manifest['attempt_id']:
                return {'status': 'existing_attempt_requires_recovery'}
            if state and old not in (state['old'], state['candidate']):
                raise ValueError('pointer_journal_mismatch')
            if state and state['stage'] == 'prepared':
                pending = state['candidate'] + '.pending'
                if self.exists(self.generations, state['candidate']): return {'status': 'manual_login_required'}
                if self.exists(self.generations, pending):
                    fd = self.generation(pending)
                    try:
                        if os.listdir(fd): return {'status': 'manual_login_required'}
                    finally: os.close(fd)
                    os.rmdir(pending, dir_fd=self.generations); os.fsync(self.generations)
                state = None
            if state is None:
                name = uuid.uuid4().hex
                os.mkdir(name + '.pending', 0o700, dir_fd=self.generations); os.fsync(self.generations)
                state = {'stage': 'prepared', 'old': old, 'candidate': name, 'worker': None,
                         **{key: self.manifest[key] for key in ('attempt_id', 'check_id', 'image', 'policy_sha256')}}
                self.write_state(state)
                try:
                    outcome = self.run_operation(state, 'exchange', previous.path, self.path / 'generations' / (name + '.pending'))
                except Exception:
                    outcome = {'status': 'child_failed'}
                if not self.quiesce(state): return {'status': 'worker_cleanup_unconfirmed'}
                if outcome.get('status') != 'exchange_succeeded':
                    try:
                        found = self.candidate(state); os.close(found.fd)
                        return {'status': 'candidate_recovery_required'}
                    except ValueError:
                        return {'status': 'manual_login_required'}
            try:
                selected = self.candidate(state)
                try:
                    os.fsync(selected.fd)
                    parent = self.generation(selected.path.parent.name)
                    try: os.fsync(parent)
                    finally: os.close(parent)
                finally: os.close(selected.fd)
            except ValueError:
                return {'status': 'manual_login_required'}
            if state['stage'] == 'candidate_accepted':
                return self.publish(state)
            state = {**state, 'stage': 'candidate_written'}; self.write_state(state)
            try:
                if self.run_operation(state, 'status', selected.path, None).get('status') != 'authenticated':
                    if not self.quiesce(state): return {'status': 'worker_cleanup_unconfirmed'}
                    return {'status': 'candidate_rejected'}
                result = public_model_result(self.run_operation(state, 'model', selected.path, None))
            except Exception:
                if not self.quiesce(state): return {'status': 'worker_cleanup_unconfirmed'}
                return {'status': 'candidate_rejected'}
            state = {**state, 'stage': 'candidate_accepted', 'model_result': result}; self.write_state(state)
            return self.publish(state)

    def container(self, operation, credential, output):
        base = runtime.private_reference(self.manifest['run_root'], directory=True)
        run = base / (operation + '-' + uuid.uuid4().hex); run.mkdir(mode=0o700)
        manifest = {**self.manifest, 'run_root': str(run)}
        command = runtime.refresh_command(manifest, operation, credential, output)
        state = self.state()
        if not state or not state['worker'] or state['worker']['operation'] != operation or state['worker']['quiescence'] != 'unconfirmed':
            raise ValueError('worker_not_reserved')
        name = state['worker']['name']
        command[2:2] = ['--name', name]
        with runtime.provider_network(manifest) as network:
            command[command.index('--network=none')] = '--network=' + network
            process = None
            try:
                process = subprocess.Popen(command, env=runtime.child_env(), stdin=subprocess.DEVNULL,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    stdout, stderr = process.communicate(timeout={'exchange': 75, 'status': 45, 'model': 135}[operation])
                except subprocess.TimeoutExpired:
                    return {'status': 'timeout'}
            finally:
                # Docker client exit не гарантирует остановку worker; cleanup предшествует снятию proxy.
                try:
                    if process is not None:
                        if process.returncode is None: process.terminate()
                        try: process.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            process.kill(); process.wait(timeout=15)
                    self.quiesce(state)
                finally:
                    if process is not None:
                        for stream in (getattr(process, 'stdout', None), getattr(process, 'stderr', None)):
                            if stream is not None: stream.close()
        if len(stdout) + len(stderr) > 8192:
            return {'status': 'output_limit'}
        try:
            result = json.loads(stdout)
            if operation == 'model':
                if process.returncode != 0: raise ValueError()
                return public_model_result(result)
            allowed = {'exchange': {'exchange_succeeded', 'exchange_failed', 'browser_flow_rejected', 'invalid_credential', 'child_failed', 'timeout', 'output_limit'},
                       'status': {'authenticated', 'status_unaccepted', 'child_failed', 'timeout', 'output_limit'}}[operation]
            if not isinstance(result, dict) or result.get('status') not in allowed:
                raise ValueError()
            if result['status'] in ('exchange_succeeded', 'authenticated') and process.returncode != 0:
                raise ValueError()
            clean = {'status': result['status']}
            if operation == 'exchange':
                for key in ('refreshBranchObserved', 'browserHandoffObserved'):
                    if key in result and type(result[key]) is bool: clean[key] = result[key]
            return clean
        except (ValueError, TypeError):
            return {'status': 'child_failed'}


def main(argv):
    store = None
    try:
        if len(argv) not in (2, 3): raise ValueError()
        manifest = json.loads(Path(argv[0]).read_text())
        store = Store(manifest)
        if argv[1] == 'bootstrap' and len(argv) == 3:
            result = store.bootstrap(Path(argv[2]))
        elif argv[1] == 'refresh' and len(argv) == 2:
            result = store.refresh()
        elif argv[1] == 'select' and len(argv) == 2:
            with store.select_current() as selected:
                result = {'status': 'selected', 'auth_file': str(selected.path)}
        else: raise ValueError()
    except Exception:
        result = {'status': 'store_rejected'}
    finally:
        if store is not None: store.close()
    print(json.dumps(result, sort_keys=True))
    return 0 if result['status'] in ('bootstrapped', 'published', 'selected') else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
