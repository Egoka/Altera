"""Synthetic credentials only: transactional store, lock и recovery без model/network."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
IMAGE = 'sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a'


def load(name):
    path = ROOT / (name + '.py')
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def model_result():
    return {'status': 'model_accepted', 'usage': {'input_tokens': 3, 'output_tokens': 5},
        'modelUsage': {'claude-opus-4-6': {'canonicalModel': 'claude-opus-4-6', 'provider': 'firstParty',
            'costBasis': 'list', 'inputTokens': 3, 'outputTokens': 5, 'costUSD': 0.05}},
        'totalCostUsd': 0.05, 'billingVerified': False}


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='altera-refresh-', dir='/private/tmp')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.module = load('credential_refresh')
        self.secret = 'SYNTHETIC_' + uuid.uuid4().hex
        self.source = self.base / 'bootstrap.credentials'
        self.source.write_text(json.dumps({'claudeAiOauth': {'refreshToken': self.secret, 'scopes': ['user:profile']}}))
        self.source.chmod(0o600)
        policy = self.base / 'policy'; policy.mkdir(mode=0o700)
        for filename in ['claude-refresh.mjs', 'provider-proxy.mjs']:
            (policy / filename).write_bytes((ROOT / filename).read_bytes())
        (policy / 'empty-mcp.json').write_text('{"mcpServers":{}}')
        (policy / 'claude-settings.json').write_text('{"disableAllHooks":true}')
        run = self.base / 'run'; run.mkdir(mode=0o700)
        self.manifest = {'schema_version': 1, 'store': str(self.base / 'store'), 'policy': str(policy),
            'policy_sha256': load('runtime').tree_hash(policy), 'run_root': str(run), 'image': IMAGE,
            'network': 'provider-proxy', 'check_id': 'synthetic-refresh', 'attempt_id': uuid.uuid4().hex}
        self.calls = []

    def store(self, runner=None):
        self.assertIsNotNone(self.module, 'credential refresh coordinator missing')
        store = self.module.Store(self.manifest, runner=runner or self.runner)
        self.addCleanup(store.close)
        return store

    def runner(self, operation, credential, output):
        self.calls.append(operation)
        if operation == 'exchange':
            state = json.loads((Path(self.manifest['store']) / 'refresh-state.json').read_text())
            self.assertEqual(state['stage'], 'exchange_started')
            path = output / '.credentials.json'
            path.write_text(json.dumps({'claudeAiOauth': {'refreshToken': self.secret + '_NEW', 'scopes': ['user:profile']}}))
            path.chmod(0o600)
            return {'status': 'exchange_succeeded'}
        return {'status': 'authenticated'} if operation == 'status' else model_result()

    def initialized(self, runner=None):
        store = self.store(runner)
        store.bootstrap(self.source)
        return store

    def pointer(self):
        return json.loads((Path(self.manifest['store']) / 'current.json').read_text())['generation']

    def test_bootstrap_opaque_copy_retains_original_and_refuses_existing_state(self):
        before = self.source.read_bytes()
        store = self.initialized()
        with store.select_current() as selected:
            self.assertTrue(selected.path.read_bytes() == before)
            self.assertTrue(self.source.read_bytes() == before)
        with self.assertRaises(ValueError):
            store.bootstrap(self.source)
        self.assertEqual(self.calls, [])

    def test_exchange_started_is_durable_before_child_spawn_and_publication_retains_previous(self):
        store = self.initialized(); old = self.pointer()
        result = store.refresh()
        self.assertEqual(result['status'], 'published')
        self.assertTrue(result['generation_changed'])
        self.assertNotEqual(self.pointer(), old)
        self.assertTrue((Path(self.manifest['store']) / 'generations' / old / '.credentials.json').is_file())
        self.assertEqual(self.calls, ['exchange', 'status', 'model'])
        self.assertEqual(store.refresh()['status'], 'published')
        self.assertEqual(self.calls, ['exchange', 'status', 'model'])

    def test_crash_after_exchange_uses_existing_candidate_without_second_exchange(self):
        class Interrupted(BaseException):
            pass
        def crash(operation, credential, output):
            result = self.runner(operation, credential, output)
            if operation == 'exchange':
                raise Interrupted()
            return result
        store = self.initialized(crash)
        with self.assertRaises(Interrupted):
            store.refresh()
        store.runner = self.runner
        self.assertEqual(store.refresh()['status'], 'published')
        self.assertEqual(self.calls.count('exchange'), 1)

    def test_missing_candidate_after_exchange_requires_manual_login_without_retry(self):
        def fail(operation, _credential, _output):
            self.calls.append(operation)
            return {'status': 'timeout'}
        store = self.initialized(fail); old = self.pointer()
        self.assertEqual(store.refresh()['status'], 'manual_login_required')
        self.assertEqual(store.refresh()['status'], 'manual_login_required')
        self.assertEqual(self.pointer(), old)
        self.assertEqual(self.calls, ['exchange'])

    def test_candidate_accepted_recovers_publication_without_another_container(self):
        store = self.initialized()
        original = store.publish
        class Interrupted(BaseException):
            pass
        def crash(_state):
            raise Interrupted()
        store.publish = crash
        with self.assertRaises(Interrupted):
            store.refresh()
        store.publish = original
        self.assertEqual(store.refresh()['status'], 'published')
        self.assertEqual(self.calls, ['exchange', 'status', 'model'])

    def test_pointer_published_before_journal_recovers_idempotently(self):
        store = self.initialized()
        original = store.write_state
        class Interrupted(BaseException):
            pass
        def crash(state):
            if state['stage'] == 'published':
                raise Interrupted()
            original(state)
        store.write_state = crash
        with self.assertRaises(Interrupted):
            store.refresh()
        published = self.pointer(); store.write_state = original
        self.assertEqual(store.refresh()['status'], 'published')
        self.assertEqual(self.pointer(), published)
        self.assertEqual(self.calls, ['exchange', 'status', 'model'])

    def test_status_failure_retains_unpublished_candidate_and_never_reexchanges(self):
        def fail_status(operation, credential, output):
            if operation == 'status':
                self.calls.append(operation); return {'status': 'status_unaccepted'}
            return self.runner(operation, credential, output)
        store = self.initialized(fail_status); old = self.pointer()
        self.assertEqual(store.refresh()['status'], 'candidate_rejected')
        self.assertEqual(self.pointer(), old)
        store.runner = self.runner
        self.assertEqual(store.refresh()['status'], 'published')
        self.assertEqual(self.calls.count('exchange'), 1)

    def test_wrong_mode_symlink_hardlink_escape_and_oversize_fail_closed(self):
        store = self.initialized()
        current = Path(self.manifest['store']) / 'generations' / self.pointer() / '.credentials.json'
        initial = current.read_bytes()
        for mutate in [lambda: current.chmod(0o644), lambda: current.write_bytes(b'x' * 65537),
                       lambda: os.link(current, self.base / 'hardlink')]:
            mutate()
            with self.assertRaises(ValueError):
                with store.select_current(): pass
            if (self.base / 'hardlink').exists(): (self.base / 'hardlink').unlink()
            current.write_bytes(initial); current.chmod(0o600)
        current.unlink(); current.symlink_to(self.source)
        with self.assertRaises(ValueError):
            with store.select_current(): pass
        pointer = Path(self.manifest['store']) / 'current.json'
        pointer.write_text('{"generation":"../../outside"}')
        with self.assertRaises(ValueError):
            with store.select_current(): pass

    def test_refresh_and_checker_selection_share_one_lock(self):
        store = self.initialized()
        manifest = self.base / 'manifest.json'; manifest.write_text(json.dumps(self.manifest))
        script = 'import importlib.util,json,sys;from pathlib import Path;spec=importlib.util.spec_from_file_location("refresh",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);s=m.Store(json.loads(Path(sys.argv[2]).read_text()));print("ready",flush=True);s.select_once_for_test()'
        # Отдельный процесс доказывает блокировку; только тест вызывает selection context.
        script = script.replace('s.select_once_for_test()', 'selection=s.select_current();selection.__enter__();print("selected",flush=True);selection.__exit__(None,None,None);s.close()')
        with store.locked():
            child = subprocess.Popen(['/usr/bin/python3', '-I', '-c', script, str(ROOT / 'credential_refresh.py'), str(manifest)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertEqual(child.stdout.readline(), b'ready\n')
            with self.assertRaises(subprocess.TimeoutExpired):
                child.wait(timeout=0.15)
        stdout, stderr = child.communicate(timeout=3)
        self.assertEqual((child.returncode, stdout, stderr), (0, b'selected\n', b''))

    def test_status_and_journal_contain_no_secret_or_secret_digest(self):
        store = self.initialized(); result = store.refresh()
        outputs = json.dumps(result).encode() + (Path(self.manifest['store']) / 'refresh-state.json').read_bytes()
        self.assertTrue(self.secret.encode() not in outputs)
        self.assertTrue(hashlib.sha256(self.secret.encode()).hexdigest().encode() not in outputs)

    def test_generation_root_permissions_and_replacement_are_rechecked_under_lock(self):
        store = self.initialized()
        generations = Path(self.manifest['store']) / 'generations'
        generations.chmod(0o755)
        with self.assertRaises(ValueError):
            with store.select_current(): pass
        generations.chmod(0o700)
        generations.rename(generations.with_name('saved-generations'))
        generations.mkdir(mode=0o700)
        with self.assertRaises(ValueError):
            with store.select_current(): pass

    def test_candidate_file_and_directory_are_synced_before_written_journal(self):
        store = self.initialized()
        original_sync = os.fsync; synced = set(); original_state = store.write_state
        def sync(fd):
            synced.add(os.fstat(fd).st_ino)
            original_sync(fd)
        def state(value):
            if value['stage'] == 'candidate_written':
                path = Path(self.manifest['store']) / 'generations' / (value['candidate'] + '.pending')
                self.assertIn((path / '.credentials.json').stat().st_ino, synced)
                self.assertIn(path.stat().st_ino, synced)
            original_state(value)
        store.write_state = state
        with patch.object(self.module.os, 'fsync', side_effect=sync):
            self.assertEqual(store.refresh()['status'], 'published')

    def test_prepared_recovery_removes_only_proven_empty_pending_directory(self):
        store = self.initialized(); original = store.write_state
        class Interrupted(BaseException): pass
        def state(value):
            original(value)
            if value['stage'] == 'prepared': raise Interrupted()
        store.write_state = state
        with self.assertRaises(Interrupted): store.refresh()
        pending = json.loads((Path(self.manifest['store']) / 'refresh-state.json').read_text())['candidate'] + '.pending'
        store.write_state = original
        self.assertEqual(store.refresh()['status'], 'published')
        self.assertFalse((Path(self.manifest['store']) / 'generations' / pending).exists())
        self.assertEqual(self.calls.count('exchange'), 1)

    def test_nonzero_container_exit_cannot_accept_model_result(self):
        from contextlib import nullcontext
        from types import SimpleNamespace
        store = self.initialized()
        process = SimpleNamespace(returncode=1, communicate=lambda **kwargs: (json.dumps(model_result()).encode(), b''), wait=lambda **kwargs: 1)
        with patch.object(self.module.runtime, 'refresh_command', return_value=['docker', '--network=none']), \
             patch.object(self.module.runtime, 'provider_network', return_value=nullcontext('synthetic')), \
             patch.object(self.module.subprocess, 'Popen', return_value=process), \
             patch.object(self.module.subprocess, 'run'):
            self.assertEqual(store.container('model', self.source, None), {'status': 'child_failed'})

    def test_foreign_owner_metadata_and_changed_journal_identity_fail_closed(self):
        from types import SimpleNamespace
        actual = self.source.stat()
        foreign = SimpleNamespace(st_uid=actual.st_uid + 1, st_mode=actual.st_mode, st_nlink=1, st_size=actual.st_size)
        with self.assertRaises(ValueError): self.module.metadata(foreign)
        store = self.initialized()
        self.assertEqual(store.refresh()['status'], 'published')
        self.manifest['check_id'] = 'different-check'
        other = self.store()
        with self.assertRaises(ValueError): other.refresh()
        self.assertEqual(self.calls, ['exchange', 'status', 'model'])

    def test_prepared_nonempty_candidate_is_retained_without_exchange(self):
        store = self.initialized(); original = store.write_state
        class Interrupted(BaseException): pass
        def state(value):
            original(value)
            if value['stage'] == 'prepared': raise Interrupted()
        store.write_state = state
        with self.assertRaises(Interrupted): store.refresh()
        journal = json.loads((Path(self.manifest['store']) / 'refresh-state.json').read_text())
        pending = Path(self.manifest['store']) / 'generations' / (journal['candidate'] + '.pending')
        retained = pending / 'unexpected'; retained.write_text('synthetic'); retained.chmod(0o600)
        store.write_state = original
        self.assertEqual(store.refresh()['status'], 'manual_login_required')
        self.assertTrue(retained.is_file()); self.assertEqual(self.calls, [])

    def test_container_cleanup_removes_named_worker_before_proxy_cleanup(self):
        from contextlib import contextmanager
        from types import SimpleNamespace
        store = self.initialized(); events = []
        @contextmanager
        def network(_manifest):
            try: yield 'synthetic'
            finally: events.append('proxy_cleanup')
        process = SimpleNamespace(returncode=0, communicate=lambda **kwargs: (b'{"status":"authenticated"}', b''),
                                  wait=lambda **kwargs: 0)
        def remove(command, **kwargs):
            self.assertEqual(command[:3], [self.module.runtime.DOCKER, 'rm', '--force'])
            self.assertRegex(command[3], r'^altera-refresh-[a-f0-9]{32}$')
            events.append('worker_cleanup')
        for scenario in ('success', 'watchdog', 'exception'):
            with self.subTest(scenario=scenario):
                events.clear()
                def communicate(**kwargs):
                    if scenario == 'watchdog': raise subprocess.TimeoutExpired('synthetic', 45)
                    if scenario == 'exception': raise RuntimeError('synthetic_transport_failure')
                    return b'{"status":"authenticated"}', b''
                process.communicate = communicate
                with patch.object(self.module.runtime, 'refresh_command', return_value=[self.module.runtime.DOCKER, 'run', '--network=none']), \
                     patch.object(self.module.runtime, 'provider_network', side_effect=network), \
                     patch.object(self.module.subprocess, 'Popen', return_value=process), \
                     patch.object(self.module.subprocess, 'run', side_effect=remove):
                    if scenario == 'exception':
                        with self.assertRaises(RuntimeError): store.container('status', self.source, None)
                    else:
                        self.assertEqual(store.container('status', self.source, None),
                                         {'status': 'timeout' if scenario == 'watchdog' else 'authenticated'})
                self.assertEqual(events, ['worker_cleanup', 'proxy_cleanup'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
