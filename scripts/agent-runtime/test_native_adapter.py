"""Synthetic permanent adapter tests; no native CLI, model, Docker, or credentials."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def write_private(path, value):
    path.write_bytes(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())
    path.chmod(0o600)
    return hashlib.sha256(path.read_bytes()).hexdigest()


class EmptyStore:
    @contextmanager
    def locked(self, timeout=None): yield
    def current(self): return None
    def close(self): pass


class NativeAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='altera-adapter-', dir='/private/tmp')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name); self.base.chmod(0o700)
        self.module = load('native_adapter')
        self.registry = self.base / 'registry'; self.registry.mkdir(mode=0o700)
        self.claims = self.base / 'claims'; self.claims.mkdir(mode=0o700)
        self.observations = self.base / 'observations'; self.observations.mkdir(mode=0o700)
        self.run = self.base / 'run'; self.run.mkdir(mode=0o700)
        self.store_root = self.base / 'store-root'; self.store_root.mkdir(mode=0o700)
        (self.store_root / 'generations').mkdir(mode=0o700)
        self.policy = self.base / 'policy'; self.policy.mkdir()
        (self.policy / 'protocol-guard.mjs').write_text('export {};')
        self.runtime_manifest = self.base / 'runtime.json'
        write_private(self.runtime_manifest, {'schema_version': 1, 'family': 'claude',
            'network': 'provider-proxy', 'run_root': str(self.run), 'source': os.getcwd(),
            'state': {'head': 'c' * 40}, 'policy': str(self.policy),
            'policy_sha256': load('runtime').tree_hash(self.policy)})
        self.store_manifest = self.base / 'store.json'
        write_private(self.store_manifest, {'schema_version': 1, 'store': str(self.store_root)})
        self.passport = self.base / 'passport.json'
        passport_sha = write_private(self.passport, {'schema_version': 1})
        self.invocation = uuid.uuid4().hex
        self.ticket = {
            'schema_version': 1, 'provider': 'claude', 'invocation_id': self.invocation,
            'native_task_id': None, 'native_run_id': 'run-8', 'actor': 'reviewer-1',
            'agent_id': 'reviewer-1', 'issue_id': 'issue-4', 'workspace_id': 'workspace-1',
            'passport_path': str(self.passport), 'passport_sha256': passport_sha,
            'gate': {'task': 'T-17', 'stage': 'review', 'run': 'run-8', 'lease': 'lease-4'},
            'gate_input': {'revision_commit': 'c' * 40, 'dirty_fingerprint': 'd' * 64},
            'check_ids': ['native-review'], 'criteria': ['AC-1'],
            'event_ids': {'claimed': self.invocation + ':claimed', 'observed': self.invocation + ':observed'},
            'runtime_manifest': str(self.runtime_manifest),
            'runtime_manifest_sha256': hashlib.sha256(self.runtime_manifest.read_bytes()).hexdigest(),
            'store_manifest': str(self.store_manifest),
            'store_manifest_sha256': hashlib.sha256(self.store_manifest.read_bytes()).hexdigest(),
            'claim': str(self.claims / (self.invocation + '.json')),
            'observation': str(self.observations / (self.invocation + '.json')),
            'provider_input': {'probe': '/private/tmp/synthetic-probe', 'probe_sha256': 'a' * 64},
        }
        self.ticket_path = self.registry / (self.invocation + '.json')
        write_private(self.ticket_path, self.ticket)
        self.deployment = self.base / 'deployment.json'
        source_hash = lambda name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        self.deployment_value = {'schema_version': 1, 'provider': 'claude', 'actor': 'reviewer-1',
            'agent_id': 'reviewer-1', 'workspace_id': 'workspace-1', 'registry': str(self.registry),
            'claims': str(self.claims), 'observations': str(self.observations), 'authority': {
                'native_adapter_sha256': source_hash('native_adapter.py'),
                'provider_adapter_sha256': source_hash('native_claude_adapter.py'),
                'prepare_native_sha256': source_hash('prepare_native.py'),
                'runtime_sha256': source_hash('runtime.py'),
                'credential_refresh_sha256': source_hash('credential_refresh.py'),
                'codex_mapper_sha256': source_hash('codex_toml_map.py'), 'source': os.getcwd()}}
        self.deployment_sha = write_private(self.deployment, self.deployment_value)
        self.environment = {'MULTICA_WORKSPACE_ID': 'workspace-1', 'MULTICA_AGENT_ID': 'reviewer-1',
            'MULTICA_TASK_ID': 'task-17', 'MULTICA_RUN_ID': 'run-8', 'MULTICA_TOKEN': 'secret'}

    def test_stable_registry_entrypoint_claims_unique_ticket_and_preserves_opaque_argv(self):
        launched = []
        status = self.module.run_registered('claude', self.deployment, self.deployment_sha,
            ['-p', '--append-system-prompt', '--flag-looking-value'], environment=self.environment,
            provider_verifier=lambda ticket, argv: {'path_map': {'/host/trace': '/usr/local/bin/trace-mcp'}},
            store_factory=lambda manifest: EmptyStore(),
            launcher=lambda manifest, argv: launched.append((manifest, argv)) or 23)
        self.assertEqual(status, 23)
        self.assertEqual(launched[0][1], ['-p', '--append-system-prompt', '--flag-looking-value'])
        self.assertEqual(launched[0][0]['path_map'], {'/host/trace': '/usr/local/bin/trace-mcp'})
        claim = json.loads(Path(self.ticket['claim']).read_text())
        self.assertEqual(claim['invocation_id'], self.invocation)
        self.assertEqual(claim['native_task_id'], 'task-17')
        receipt = json.loads(Path(self.ticket['observation']).read_text())
        self.assertEqual(receipt['runtime_status'], 23)
        self.assertIsNone(receipt['raw_child_exit'])
        self.assertEqual(receipt['worker_quiescence'], 'unknown')

    def test_duplicate_or_ambiguous_invocation_refuses_before_child(self):
        calls = []
        kwargs = dict(environment=self.environment, provider_verifier=lambda *_: {},
            store_factory=lambda manifest: EmptyStore(),
            launcher=lambda *_: calls.append(True) or 0)
        self.module.run_registered('claude', self.deployment, self.deployment_sha, ['-p', 'x'], **kwargs)
        with self.assertRaisesRegex(ValueError, '^pending_request_missing_or_ambiguous$'):
            self.module.run_registered('claude', self.deployment, self.deployment_sha, ['-p', 'x'], **kwargs)
        second = dict(self.ticket); second['invocation_id'] = uuid.uuid4().hex
        second['claim'] = str(self.claims / (second['invocation_id'] + '.json'))
        second['observation'] = str(self.observations / (second['invocation_id'] + '.json'))
        write_private(self.registry / (second['invocation_id'] + '.json'), second)
        third = dict(second); third['invocation_id'] = uuid.uuid4().hex
        third['claim'] = str(self.claims / (third['invocation_id'] + '.json'))
        third['observation'] = str(self.observations / (third['invocation_id'] + '.json'))
        write_private(self.registry / (third['invocation_id'] + '.json'), third)
        with self.assertRaisesRegex(ValueError, '^pending_request_missing_or_ambiguous$'):
            self.module.run_registered('claude', self.deployment, self.deployment_sha, ['-p', 'x'], **kwargs)
        self.assertEqual(len(calls), 1)

    def test_wrong_binding_and_provider_refusal_consume_no_child_authority(self):
        calls = []
        self.ticket['native_task_id'] = 'task-17'
        write_private(self.ticket_path, self.ticket)
        wrong = dict(self.environment, MULTICA_TASK_ID='other')
        with self.assertRaisesRegex(ValueError, '^pending_request_missing_or_ambiguous$'):
            self.module.run_registered('claude', self.deployment, self.deployment_sha, [], environment=wrong,
                launcher=lambda *_: calls.append(True), provider_verifier=lambda *_: {})
        with self.assertRaisesRegex(ValueError, '^provider_input_refused$'):
            self.module.run_pending('claude', self.ticket_path,
                hashlib.sha256(self.ticket_path.read_bytes()).hexdigest(), [], environment=self.environment,
                provider_verifier=lambda *_: (_ for _ in ()).throw(ValueError('secret detail')),
                store_factory=lambda manifest: EmptyStore(), launcher=lambda *_: calls.append(True))
        self.assertEqual(calls, [])
        self.assertTrue(Path(self.ticket['claim']).exists())

    def test_prebound_native_task_must_match_daemon_binding(self):
        ticket = dict(self.ticket, native_task_id='task-other')
        sha = write_private(self.registry / 'prebound.json', ticket)
        with self.assertRaisesRegex(ValueError, '^native_binding_mismatch$'):
            self.module.run_pending('claude', self.registry / 'prebound.json', sha, [],
                environment=self.environment, provider_verifier=lambda *_: {})
        self.assertFalse(Path(ticket['claim']).exists())

    def test_static_probes_need_no_deployment_or_claim(self):
        for name in ('native_claude_adapter.py', 'native_codex_adapter.py'):
            result = __import__('subprocess').run(['/usr/bin/python3', '-I', str(ROOT / name), '--version'],
                capture_output=True, text=True, env={'PATH': '/usr/bin:/bin'})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('container launcher', result.stdout)

    def integration_request(self, provider, source, policy, provider_input):
        identity = uuid.uuid4().hex
        passport = self.base / (provider + '-passport.json')
        passport_sha = write_private(passport, {'scope': []})
        return {'schema_version': 1, 'invocation_id': identity, 'native_task_id': None,
            'native_run_id': 'run-1', 'issue_id': 'issue-1', 'actor': 'reviewer-1',
            'agent_id': 'reviewer-1', 'workspace_id': 'workspace-1',
            'passport_path': str(passport), 'passport_sha256': passport_sha,
            'gate': {'task': 'T-1', 'stage': 'review', 'run': 'run-1', 'lease': 'lease-1'},
            'gate_input': {'revision_commit': __import__('subprocess').check_output(
                ['/usr/bin/git', '-C', str(source), 'rev-parse', 'HEAD']).decode().strip(),
                'dirty_fingerprint': 'a' * 64}, 'check_ids': ['native'], 'criteria': ['AC-1'],
            'event_ids': {'claimed': identity + ':claimed', 'observed': identity + ':observed'},
            'source': str(source), 'snapshot': str(self.base / (provider + '-snapshot')),
            'dirty_paths': [], 'policy': str(policy), 'run_root': str(self.base / (provider + '-run')),
            'image': 'sha256:' + 'b' * 64, 'store_manifest': {'schema_version': 1},
            'provider_input': provider_input, 'claim': str(self.claims / (identity + '.json')),
            'observation': str(self.observations / (identity + '.json'))}

    def integration_source_policy(self, name):
        source = self.base / (name + '-source'); source.mkdir(mode=0o700)
        (source / 'AGENTS.md').write_text('synthetic instructions\n')
        __import__('subprocess').run(['/usr/bin/git', '-C', str(source), 'init', '-q'], check=True)
        __import__('subprocess').run(['/usr/bin/git', '-C', str(source), 'add', 'AGENTS.md'], check=True)
        __import__('subprocess').run(['/usr/bin/git', '-C', str(source), '-c', 'user.name=t',
            '-c', 'user.email=t@example.test', 'commit', '-qm', 'fixture'], check=True)
        policy = self.base / (name + '-policy'); policy.mkdir(mode=0o700)
        (policy / 'claude-settings.json').write_text('{"disableAllHooks":true}')
        (policy / 'protocol-guard.mjs').write_text('export {}\n')
        return source, policy

    def test_real_claude_prepare_probe_and_runtime_command_chain(self):
        prepare, claude, runtime = load('prepare_native'), load('native_claude_adapter'), load('runtime')
        source, policy = self.integration_source_policy('claude-integration')
        private_root = self.base / 'private-root'; private_root.mkdir(mode=0o700)
        config_dir = private_root / ('multica-mcp-' + uuid.uuid4().hex); config_dir.mkdir(mode=0o700)
        config = config_dir / 'mcp-config.json'
        config.write_text('{"mcpServers":{"context7":{"type":"http","url":"https://mcp.context7.com/mcp"},"trace":{"command":"/Users/egorbondarenko/.trace/bin/trace","args":["serve"]}}}')
        config.chmod(0o600)
        binary = self.base / 'd1'
        builder = load('build_metadata_config_probe')
        builder.build(binary, str(private_root), os.getuid())
        provider_input = {'probe': str(binary), 'probe_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
            'source_sha256': hashlib.sha256((ROOT / 'metadata-config-probe.c').read_bytes()).hexdigest(),
            'build_sha256': '', 'output_dir': str(self.base / 'claude-generated-policy')}
        result = __import__('subprocess').run([str(binary), '--mcp-config', str(config)], capture_output=True)
        provider_input['build_sha256'] = json.loads(result.stderr.split(b' ', 1)[1])['build_sha256']
        request = self.integration_request('claude', source, policy, provider_input)
        prepared = prepare.prepare('claude', request, self.base / 'claude-prepared')
        ticket = json.loads(Path(prepared['pending_path']).read_text())
        manifest = json.loads(Path(ticket['runtime_manifest']).read_text())
        manifest.update(claude.verify(provider_input, ['-p', '--append-system-prompt', '--opaque',
            '--mcp-config', str(config)]))
        command = runtime.command(manifest, ['-p', '--append-system-prompt', '--opaque',
            '--mcp-config', str(config)], {})
        self.assertEqual(manifest['network'], 'provider-proxy')
        self.assertIn('/runtime/policy/claude-mcp.json', command)

    def test_real_codex_prepare_mapper_and_runtime_command_chain(self):
        prepare, codex, runtime, mapper = load('prepare_native'), load('native_codex_adapter'), load('runtime'), load('codex_toml_map')
        source, policy = self.integration_source_policy('codex-integration')
        workspace = self.base / 'workspace'; home = workspace / ('alte-1-' + '1' * 12) / 'codex-home'
        home.mkdir(parents=True); workspace.chmod(0o755); home.parent.chmod(0o755); home.chmod(0o755)
        managed = (mapper.BEGIN_MARKER + '\n[mcp_servers.context7]\nexperimental_use_rmcp_client = true\nurl = "https://mcp.context7.com/mcp"\n'
            '[mcp_servers.trace]\ncommand = "/Users/egorbondarenko/.trace/bin/trace"\nargs = ["serve"]\n' + mapper.END_MARKER + '\n')
        (home / 'config.toml').write_text(managed); (home / 'config.toml').chmod(0o600)
        base = policy / 'base.toml'; base.write_text('model = "gpt-5.6-terra"\n'); base.chmod(0o600)
        record = {'binary_sha256': mapper.D2_BINARY_SHA256, 'descriptor': {'candidate_path': str(home),
            'source_sha256': mapper.D2_SOURCE_SHA256, 'build_sha256': mapper.D2_BUILD_SHA256,
            'read_status': 'lexical_candidate', 'canonical_identity': 'not_checked',
            'task_acceptance': 'not_checked', 'cwd_matches_expected': True, 'argc': 4}}
        auth = self.base / 'auth.json'; auth.write_text('{}'); auth.chmod(0o600)
        provider_input = {'d2_record': record, 'workspace_root': str(workspace), 'expected_cwd': os.getcwd(),
            'expected_uid': os.getuid(), 'base_policy_path': str(base),
            'expected_base_sha256': hashlib.sha256(base.read_bytes()).hexdigest(),
            'output_dir': str(self.base / 'codex-generated-policy'), 'mapping_policy_version': 'codex-mcp-map-v1',
            'required_servers': ['context7', 'trace'], 'auth_file': str(auth)}
        request = self.integration_request('codex', source, policy, provider_input)
        prepared = prepare.prepare('codex', request, self.base / 'codex-prepared')
        ticket = json.loads(Path(prepared['pending_path']).read_text())
        manifest = json.loads(Path(ticket['runtime_manifest']).read_text())
        manifest.update(codex.verify(provider_input, ['app-server']))
        command = runtime.command(manifest, ['app-server'], {})
        self.assertIn('app-server', command)
        self.assertTrue((Path(manifest['policy']) / 'protocol-guard.mjs').is_file())


if __name__ == '__main__':
    unittest.main(verbosity=2)


class AdapterCollectorRegressions(unittest.TestCase):
    setUp = NativeAdapterTests.setUp
    def test_policy_drift_refuses_before_provider_and_child(self):
        (self.policy / 'protocol-guard.mjs').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'prepared_policy_changed'):
            self.module.run_registered('claude', self.deployment, self.deployment_sha, ['-p'],
                environment=self.environment, provider_verifier=lambda *_: self.fail('provider ran'),
                launcher=lambda *_: self.fail('child ran'))

    def test_fixed_profile_static_probe_does_not_open_config(self):
        for provider in ('claude', 'codex'):
            self.assertEqual(load('native_' + provider + '_adapter').main(
                ['/missing/deployment.json', 'not-a-digest', '--', '--version']), 0)

    def test_manifest_in_runtime_writable_mount_refused(self):
        cache = self.run / 'cache'; cache.mkdir(mode=0o700)
        path = cache / 'runtime.json'; path.write_bytes(self.runtime_manifest.read_bytes()); path.chmod(0o600)
        self.ticket['runtime_manifest'] = str(path)
        write_private(self.ticket_path, self.ticket)
        with self.assertRaisesRegex(ValueError, 'trusted_output_mount_overlap'):
            self.module.run_registered('claude', self.deployment, self.deployment_sha, ['-p'], environment=self.environment)


class FreshCodexProbeTests(unittest.TestCase):
    def test_fresh_probe_uses_only_current_managed_home_and_no_task_token(self):
        from unittest.mock import Mock, patch
        with tempfile.TemporaryDirectory() as temporary:
            base=Path(temporary).resolve();probe=base/'probe';probe.write_text('synthetic pinned executable');probe.chmod(0o700)
            module=load('native_codex_adapter');mapper=Mock()
            mapper.D2_BINARY_SHA256=hashlib.sha256(probe.read_bytes()).hexdigest()
            mapper.materialize.return_value={'managed_mapping_verified':True,'policy_path':str(base/'codex-config.toml'),'path_map':{}}
            descriptor={'candidate_path':'/fresh/managed/codex-home'}
            result=Mock(returncode=78,stdout=b'',stderr=b'ALTERA_CODEX_PATH_ONLY_V1 '+json.dumps(descriptor).encode())
            value={'probe':str(probe),'workspace_root':'/fresh/managed','expected_cwd':os.getcwd(),
                'expected_uid':os.getuid(),'base_policy_path':str(base/'base.toml'),'expected_base_sha256':'a'*64,
                'output_dir':str(base),'mapping_policy_version':'codex-mcp-map-v1','required_servers':['context7','trace'],
                'auth_file':str(base/'opaque.json')}
            with patch.object(module,'_mapper',return_value=mapper),patch.object(module.subprocess,'run',return_value=result) as run,\
                    patch.dict(os.environ,{'CODEX_HOME':'/fresh/managed/codex-home','MULTICA_TOKEN':'never-forward'}):
                module.verify(value,['app-server','--listen','stdio://'])
            self.assertEqual(run.call_args.kwargs['env'],{'PATH':'/usr/bin:/bin','CODEX_HOME':'/fresh/managed/codex-home'})
            self.assertEqual(mapper.materialize.call_args.args[0]['descriptor'],descriptor)
