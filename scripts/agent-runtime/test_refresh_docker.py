"""Только synthetic credentials: fake CLI без сети и отдельная invalid-token compatibility."""
from contextlib import nullcontext
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('refresh_tests', ROOT / 'test_credential_refresh.py')
fixtures = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixtures)

FAKE = r'''#!/bin/sh
exec /usr/local/bin/node --input-type=commonjs - "$@" <<'FAKE_JS'
const fs = require('node:fs'), {spawn} = require('node:child_process');
const op = process.argv[2] === 'auth' ? process.argv[3] : 'model';
const checks = {};
const check = (name, value) => {checks[name] = Boolean(value); if (!value) throw Error('fixture_boundary_failed')};
check('privateHome', process.env.HOME === '/runtime/cache/home');
check('noSource', !fs.existsSync('/workspace') && !fs.existsSync('/var/run/docker.sock'));
check('noCoordinatorToken', !Object.hasOwn(process.env, 'MULTICA_TOKEN'));
check('readonlyRoot', (() => {try {fs.writeFileSync('/boundary-write', 'x'); return false} catch {return true}})());
const file = op === 'login' ? '/runtime/input/.credentials.json' : '/runtime/cache/claude/.credentials.json';
const data = JSON.parse(fs.readFileSync(file));
check('readonlyCredential', (() => {try {fs.appendFileSync(file, 'x'); return false} catch {return true}})());
if (op === 'login') {
  check('exactArgv', JSON.stringify(process.argv.slice(2)) === JSON.stringify(['auth','login']));
  check('childFields', process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN === data.claudeAiOauth.refreshToken &&
    process.env.CLAUDE_CODE_OAUTH_SCOPES === data.claudeAiOauth.scopes.join(' ') &&
    process.env.CLAUDE_CODE_OAUTH_CLIENT_ID === data.claudeAiOauth.clientId);
  check('parentHasNoSecret', !fs.readFileSync(`/proc/${process.ppid}/environ`).includes(Buffer.from(data.claudeAiOauth.refreshToken)));
  check('candidateConfig', process.env.CLAUDE_CONFIG_DIR === '/runtime/output/claude');
} else {
  check('noRefreshFields', ['CLAUDE_CODE_OAUTH_REFRESH_TOKEN','CLAUDE_CODE_OAUTH_SCOPES','CLAUDE_CODE_OAUTH_CLIENT_ID'].every(k=>!Object.hasOwn(process.env,k)));
  check('noOldInput', !fs.existsSync('/runtime/input/.credentials.json') && !fs.existsSync('/runtime/output/claude'));
  check('candidateConfig', process.env.CLAUDE_CONFIG_DIR === '/runtime/cache/claude');
}
fs.writeFileSync('/runtime/cache/fake-proof.json', JSON.stringify(checks), {mode:0o600});
const behavior = '__BEHAVIOR__';
if (behavior === 'timeout' || behavior === 'pending-timeout') {
  if (behavior === 'pending-timeout') fs.writeFileSync('/runtime/output/claude/.credentials.json', JSON.stringify(data), {mode:0o600});
  spawn('/usr/local/bin/node', ['-e', 'setInterval(()=>{},1000)'], {stdio:'inherit'});
  setInterval(()=>{},1000);
} else if (behavior === 'overflow') {
  process.stdout.write(data.claudeAiOauth.refreshToken + 'X'.repeat(9000)); setInterval(()=>{},1000);
} else if (behavior === 'failure') {
  process.stderr.write('Login failed: ' + data.claudeAiOauth.refreshToken); process.exitCode=1;
} else if (op === 'login') {
  data.claudeAiOauth.refreshToken += '_NEW';
  fs.writeFileSync('/runtime/output/claude/.credentials.json', JSON.stringify(data), {mode:0o600});
  process.stdout.write(data.claudeAiOauth.refreshToken); process.stderr.write(data.irrelevant);
} else if (op === 'status') {
  check('exactArgv', JSON.stringify(process.argv.slice(2)) === JSON.stringify(['auth','status']));
  process.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:data.irrelevant}));
} else {
  check('exactArgv', JSON.stringify(process.argv.slice(2)) === JSON.stringify(['--print','--output-format','json','--model','claude-opus-4-6','--effort','medium','--tools','','--strict-mcp-config','--mcp-config','/runtime/policy/empty-mcp.json','--settings','/runtime/policy/claude-settings.json','Reply exactly ALTERA_CLAUDE_AUTH_OK']));
  check('emptyMcp', JSON.stringify(JSON.parse(fs.readFileSync('/runtime/policy/empty-mcp.json'))) === '{"mcpServers":{}}');
  check('hooksDisabled', JSON.parse(fs.readFileSync('/runtime/policy/claude-settings.json')).disableAllHooks === true);
  process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'ALTERA_CLAUDE_AUTH_OK',
    usage:{input_tokens:3,output_tokens:5}, modelUsage:{'claude-opus-4-6':{canonicalModel:'claude-opus-4-6',provider:'firstParty',costBasis:'list',inputTokens:3,outputTokens:5,costUSD:0.05}},
    total_cost_usd:0.05,irrelevant:data.irrelevant}));
}
if (op !== 'login') fs.writeFileSync('/runtime/cache/fake-proof.json', JSON.stringify(checks), {mode:0o600});
FAKE_JS
'''


class DockerRefreshTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.RefreshTests('test_bootstrap_opaque_copy_retains_original_and_refuses_existing_state')
        self.fixture.setUp(); self.addCleanup(self.fixture.doCleanups)
        self.base = self.fixture.base
        self.module = self.fixture.module
        self.manifest = self.fixture.manifest
        data = {'claudeAiOauth': {'refreshToken': self.fixture.secret, 'scopes': ['user:profile', 'SYNTHETIC_' + uuid.uuid4().hex],
                                 'clientId': 'SYNTHETIC_' + uuid.uuid4().hex}, 'irrelevant': 'SYNTHETIC_' + uuid.uuid4().hex}
        self.fixture.source.write_text(json.dumps(data))
        self.secrets = [data['claudeAiOauth']['refreshToken'], data['claudeAiOauth']['scopes'][1], data['claudeAiOauth']['clientId'], data['irrelevant']]
        self.store = self.module.Store(self.manifest); self.addCleanup(self.store.close)
        self.store.bootstrap(self.fixture.source)
        self.commands = []; self.results = []

    def fake(self, behavior):
        path = self.base / ('fake-' + behavior)
        path.write_text(FAKE.replace('__BEHAVIOR__', behavior)); path.chmod(0o755)
        original = self.module.runtime.refresh_command
        def command(*args):
            vector = original(*args)
            vector.insert(vector.index('--entrypoint=/usr/local/bin/node'), '--mount=type=bind,src=' + str(path) + ',dst=/usr/local/bin/claude,readonly')
            self.commands.append(vector)
            return vector
        return patch.object(self.module.runtime, 'refresh_command', side_effect=command)

    def assert_redacted(self, result):
        outputs = json.dumps([self.commands, result]).encode()
        journal = (Path(self.manifest['store']) / 'refresh-state.json').read_bytes()
        self.assertTrue(all(secret.encode() not in outputs + journal for secret in self.secrets), 'synthetic secret leaked')
        proofs = list(Path(self.manifest['run_root']).glob('*/cache/fake-proof.json'))
        self.assertTrue(proofs, 'fake executable did not run')
        for path in proofs:
            proof = json.loads(path.read_text())
            self.assertTrue(proof and all(value is True for value in proof.values()), 'boundary predicate failed')

    def test_success_concurrent_selection_and_interrupted_publication(self):
        class Interrupted(BaseException): pass
        original = self.store.write_state
        def state(value):
            original(value)
            if value['stage'] == 'candidate_accepted': raise Interrupted()
        self.store.write_state = state
        manifest = self.base / 'manifest.json'; manifest.write_text(json.dumps(self.manifest)); manifest.chmod(0o600)
        reader = None
        container = self.store.container
        def runner(*args):
            nonlocal reader
            if args[0] == 'exchange':
                reader = subprocess.Popen(['/usr/bin/python3', '-I', str(ROOT / 'credential_refresh.py'), str(manifest), 'select'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                time.sleep(0.2)
                self.assertIsNone(reader.poll(), 'checker selection bypassed refresh lock')
            result = container(*args); self.results.append(result)
            print(json.dumps({'syntheticOperation': args[0], 'result': result}), flush=True)
            return result
        self.store.runner = runner
        with self.fake('success'), patch.object(self.module.runtime, 'provider_network', side_effect=lambda _: nullcontext('none')):
            with self.assertRaises(Interrupted): self.store.refresh()
            self.assertIsNotNone(reader)
            stdout, stderr = reader.communicate(timeout=5)
            self.assertEqual(reader.returncode, 0); self.assertEqual(stderr, b'')
            self.assertEqual(json.loads(stdout)['status'], 'selected')
            self.store.write_state = original
            result = self.store.refresh()
        self.assertEqual(result['status'], 'published')
        self.assertEqual([item['status'] for item in self.results], ['exchange_succeeded', 'authenticated', 'model_accepted'])
        self.assertEqual(len(self.commands), 3, 'accepted recovery spawned another CLI')
        self.assert_redacted(result)

    def test_failure_retains_journal_without_second_exchange(self):
        with self.fake('failure'), patch.object(self.module.runtime, 'provider_network', side_effect=lambda _: nullcontext('none')):
            result = self.store.refresh()
            self.assertEqual(result['status'], 'manual_login_required')
            self.assertEqual(self.store.refresh()['status'], 'manual_login_required')
        self.assertEqual(len(self.commands), 1)
        self.assert_redacted(result)

    def test_output_limit_is_bounded_and_redacted(self):
        results = []; container = self.store.container
        def runner(*args):
            result = container(*args); results.append(result); return result
        self.store.runner = runner
        with self.fake('overflow'), patch.object(self.module.runtime, 'provider_network', side_effect=lambda _: nullcontext('none')):
            result = self.store.refresh()
        self.assertEqual(results, [{'status': 'output_limit'}])
        self.assertEqual(result['status'], 'manual_login_required')
        self.assert_redacted(result)

    def test_fixed_timeout_kills_child_group_with_inherited_pipes(self):
        results = []; container = self.store.container
        def runner(*args):
            result = container(*args); results.append(result); return result
        self.store.runner = runner
        start = time.monotonic()
        with self.fake('timeout'), patch.object(self.module.runtime, 'provider_network', side_effect=lambda _: nullcontext('none')):
            result = self.store.refresh()
        elapsed = time.monotonic() - start
        self.assertEqual(results, [{'status': 'timeout'}])
        self.assertGreaterEqual(elapsed, 60); self.assertLess(elapsed, 75)
        self.assertEqual(result['status'], 'manual_login_required')
        self.assert_redacted(result)

    def test_interrupted_transport_removes_worker_before_recovery(self):
        original = subprocess.Popen; names = []
        def start(command, **kwargs):
            process = original(command, **kwargs)
            if command[:2] == [self.module.runtime.DOCKER, 'run']:
                names.append(command[command.index('--name') + 1])
                def interrupt(**_kwargs):
                    deadline = time.monotonic() + 10
                    while not list(Path(self.manifest['run_root']).glob('*/cache/fake-proof.json')):
                        if process.poll() is not None or time.monotonic() >= deadline:
                            raise AssertionError('synthetic worker did not reach controlled interruption')
                        time.sleep(0.05)
                    raise KeyboardInterrupt()
                process.communicate = interrupt
            return process
        with self.fake('timeout'), patch.object(self.module.runtime, 'provider_network', side_effect=lambda _: nullcontext('none')), \
             patch.object(self.module.subprocess, 'Popen', side_effect=start):
            with self.assertRaises(KeyboardInterrupt): self.store.refresh()
        self.assertEqual(len(names), 1)
        inspection = subprocess.run([self.module.runtime.DOCKER, 'inspect', names[0]], env=self.module.runtime.child_env(),
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.assertNotEqual(inspection.returncode, 0, 'interrupted worker survived cleanup')
        self.assertEqual(self.store.refresh()['status'], 'manual_login_required')
        self.assertEqual(len(self.commands), 1, 'recovery retried exchange')
        self.assert_redacted({'status': 'manual_login_required'})

    def test_unconfirmed_cleanup_recovery_removes_only_reserved_worker(self):
        original_start, original_run = subprocess.Popen, subprocess.run
        names = []; observations = []; old = self.fixture.pointer()
        def start(command, **kwargs):
            process = original_start(command, **kwargs)
            if command[:2] == [self.module.runtime.DOCKER, 'run']:
                names.append(command[command.index('--name') + 1])
                process.terminate = process.kill  # SIGKILL клиента не проксируется в worker: моделируем abrupt disconnect.
                def interrupt(**_kwargs):
                    deadline = time.monotonic() + 10
                    while not list((Path(self.manifest['store']) / 'generations').glob('*.pending/.credentials.json')):
                        if process.poll() is not None or time.monotonic() >= deadline:
                            raise AssertionError('synthetic candidate was not written')
                        time.sleep(0.05)
                    raise KeyboardInterrupt()
                process.communicate = interrupt
            return process
        def failed_remove(command, **kwargs):
            if command[:3] == [self.module.runtime.DOCKER, 'rm', '--force']:
                self.assertEqual(command[3:], names)
                return subprocess.CompletedProcess(command, 1)
            result = original_run(command, **kwargs)
            if command[1:4] == ['container', 'ls', '--all']:
                self.assertEqual(result.returncode, 0)
                self.assertIn('name=^/' + names[0] + '$', command)
                self.assertEqual(result.stdout, (names[0] + '\n').encode())
                observations.append('present')
            return result
        def actual_cleanup(command, **kwargs):
            result = original_run(command, **kwargs)
            if command[1:4] == ['container', 'ls', '--all'] and 'name=^/' + names[0] + '$' in command:
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, b'')
                observations.append('absent')
            return result
        try:
            with self.fake('pending-timeout'), patch.object(self.module.runtime, 'provider_network', side_effect=lambda _: nullcontext('none')), \
                 patch.object(self.module.subprocess, 'Popen', side_effect=start), \
                 patch.object(self.module.subprocess, 'run', side_effect=failed_remove):
                with self.assertRaises(KeyboardInterrupt): self.store.refresh()
                self.assertEqual(self.store.state()['worker']['quiescence'], 'unconfirmed')
                self.assertEqual(self.store.refresh()['status'], 'worker_cleanup_unconfirmed')
                self.assertEqual(self.fixture.pointer(), old)
                self.assertEqual(len(self.commands), 1)
            with self.fake('success'), patch.object(self.module.runtime, 'provider_network', side_effect=lambda _: nullcontext('none')), \
                 patch.object(self.module.subprocess, 'run', side_effect=actual_cleanup):
                result = self.store.refresh()
            self.assertEqual(result['status'], 'published')
            self.assertEqual(len(self.commands), 3, 'recovery exchanged the old token again')
            self.assertEqual(self.store.state()['worker']['quiescence'], 'confirmed')
            self.assert_redacted(result)
            self.assertIn('present', observations); self.assertIn('absent', observations)
            print(json.dumps({'exactFilterSeesLiveWorker': True, 'sameFilterProvesAbsenceAfterRemoval': True,
                              'unknownCleanupBlockedPublication': True, 'exchangeCount': 1, 'syntheticOnly': True}))
        finally:
            for name in names:
                original_run([self.module.runtime.DOCKER, 'rm', '--force', name], env=self.module.runtime.child_env(),
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)


class PinnedCompatibilityTests(unittest.TestCase):
    setUp = DockerRefreshTests.setUp

    def test_pinned_cli_invalid_synthetic_token_uses_refresh_branch(self):
        with self.store.select_current() as selected:
            candidate = Path(self.manifest['store']) / 'generations' / (uuid.uuid4().hex + '.pending'); candidate.mkdir(mode=0o700)
            state = {'stage': 'prepared', 'old': selected.path.parent.name, 'candidate': candidate.name.removesuffix('.pending'),
                     'worker': None, **{key: self.manifest[key] for key in ('attempt_id', 'check_id', 'image', 'policy_sha256')}}
            self.store.write_state(state)
            start = time.monotonic()
            result = self.store.run_operation(state, 'exchange', selected.path, candidate)
        self.assertLess(time.monotonic() - start, 75)
        self.assertEqual(result, {'status': 'exchange_failed', 'refreshBranchObserved': True, 'browserHandoffObserved': False})
        inspections = list(Path(self.manifest['run_root']).glob('*/network-inspect.json'))
        self.assertEqual(len(inspections), 1)
        network = json.loads(inspections[0].read_text())
        self.assertTrue(network['Internal'])
        self.assertEqual(network['Options']['com.docker.network.bridge.gateway_mode_ipv4'], 'isolated')
        proxy = json.loads(inspections[0].with_name('proxy-inspect.json').read_text())[0]
        self.assertEqual(len(proxy['Mounts']), 1)
        self.assertFalse(proxy['Mounts'][0]['RW'])
        print(json.dumps({'compatibility': result, 'image': self.manifest['image'], 'syntheticOnly': True,
                          'network': 'provider-proxy', 'internalIsolatedVerified': True, 'proxyPolicyReadOnly': True}))


if __name__ == '__main__':
    unittest.main(verbosity=2)
