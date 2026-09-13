"""Contract tests используют настоящие Git snapshots; Docker проверяется отдельно."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent


class RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        implementation = ROOT / 'runtime.py'
        assert implementation.exists(), 'isolated runtime is not implemented'
        spec = importlib.util.spec_from_file_location('runtime', implementation)
        cls.runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.runtime)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.source = self.base / 'source'
        self.source.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        (self.source / '.gitignore').write_text('.env\n')
        (self.source / 'code.txt').write_text('original\n')
        self.git('add', '.')
        self.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture')
        (self.source / '.env').write_text('SYNTHETIC_IGNORED_SECRET')
        self.policy = self.base / 'policy'
        self.policy.mkdir()
        (self.policy / 'mcp.json').write_text('{"mcpServers":{}}')
        (self.policy / 'claude-settings.json').write_text('{"disableAllHooks":true}')
        self.snapshot = self.base / 'snapshot'
        self.state = self.runtime.snapshot(self.source, self.snapshot, [])
        self.run = self.base / 'run'
        self.run.mkdir()
        self.manifest = {'schema_version': 1, 'family': 'claude',
            'source': str(self.source), 'snapshot': str(self.snapshot),
            'state': self.state, 'dirty_paths': [], 'policy': str(self.policy),
            'policy_sha256': self.runtime.tree_hash(self.policy),
            'run_root': str(self.run), 'image': 'sha256:' + 'a' * 64,
            'model': 'claude-opus-4-6', 'effort': 'medium', 'env_paths': {},
            'path_map': {'/managed/task/mcp.json': '/runtime/policy/mcp.json'},
            'managed_mapping_verified': False, 'fixture': True}

    def git(self, *args):
        return subprocess.check_output(['/usr/bin/git', '-C', str(self.source), *args], stderr=subprocess.DEVNULL)

    def test_snapshot_preserves_revision_and_dirty_without_ignored_secrets(self):
        (self.source / 'code.txt').write_text('modified\n')
        (self.source / 'new-test.txt').write_text('new\n')
        state = self.runtime.snapshot(self.source, self.base / 'dirty-snapshot', ['new-test.txt'])
        dest = self.base / 'dirty-snapshot'
        self.assertEqual((dest / 'code.txt').read_text(), 'modified\n')
        self.assertEqual((dest / 'new-test.txt').read_text(), 'new\n')
        self.assertFalse((dest / '.env').exists())
        self.assertTrue((dest / '.git').is_dir())
        self.assertFalse((dest / '.git/objects/info/alternates').exists())
        self.assertEqual(state['head'], self.git('rev-parse', 'HEAD').decode().strip())

    def test_external_symlink_and_ignored_explicit_input_are_rejected(self):
        (self.source / 'escape').symlink_to('/etc/passwd')
        for paths in [['escape'], ['.env']]:
            with self.assertRaisesRegex(ValueError, 'unsafe|ignored'):
                self.runtime.snapshot(self.source, self.base / ('bad-' + paths[0]), paths)

    def test_undeclared_untracked_source_cannot_disappear_from_snapshot(self):
        (self.source / 'new-source.js').write_text('export const untested = true;')
        with self.assertRaisesRegex(ValueError, 'untracked_input_mismatch'):
            self.runtime.snapshot(self.source, self.base / 'incomplete-snapshot', [])

    def test_untracked_mode_changes_in_source_and_snapshot_fail_closed(self):
        path = self.source / 'new-input'
        path.write_text('code.txt')
        path.chmod(0o644)
        dest = self.base / 'mode-snapshot'
        state = self.runtime.snapshot(self.source, dest, ['new-input'])
        self.manifest.update(snapshot=str(dest), state=state, dirty_paths=['new-input'])
        for root, error in [(self.source, 'source_changed'), (dest, 'snapshot_changed')]:
            with self.subTest(root=root.name):
                (root / 'new-input').chmod(0o755)
                try:
                    with self.assertRaisesRegex(ValueError, error):
                        self.runtime.command(self.manifest, [], {})
                finally:
                    (root / 'new-input').chmod(0o644)

    def test_untracked_kind_changes_with_identical_digest_fail_closed(self):
        path = self.source / 'new-input'
        path.write_text('code.txt')
        dest = self.base / 'kind-snapshot'
        state = self.runtime.snapshot(self.source, dest, ['new-input'])
        self.manifest.update(snapshot=str(dest), state=state, dirty_paths=['new-input'])
        for root, error in [(self.source, 'source_changed'), (dest, 'snapshot_changed')]:
            with self.subTest(root=root.name):
                changed = root / 'new-input'
                changed.unlink()
                changed.symlink_to('code.txt')
                try:
                    with self.assertRaisesRegex(ValueError, error):
                        self.runtime.command(self.manifest, [], {})
                finally:
                    changed.unlink()
                    changed.write_text('code.txt')

    def test_untracked_fingerprint_normalizes_permissions_to_git_mode(self):
        path = self.source / 'new-input'
        path.write_text('code.txt')
        path.chmod(0o600)
        initial = self.runtime.fingerprint(self.source, ['new-input'])
        path.chmod(0o644)
        self.assertEqual(initial, self.runtime.fingerprint(self.source, ['new-input']))
        self.assertEqual(initial['untracked']['new-input'], {
            'kind': 'file', 'mode': '100644',
            'sha256': hashlib.sha256(b'code.txt').hexdigest()})
        path.chmod(0o755)
        executable = self.runtime.fingerprint(self.source, ['new-input'])['untracked']['new-input']
        self.assertEqual(executable['mode'], '100755')
        path.unlink()
        path.symlink_to('code.txt')
        link = self.runtime.fingerprint(self.source, ['new-input'])['untracked']['new-input']
        self.assertEqual(link, {'kind': 'symlink', 'mode': '120000', 'sha256': executable['sha256']})

    def test_readonly_mounts_and_token_free_env(self):
        args = self.runtime.command(self.manifest,
            ['--model', 'claude-opus-4-6', '--effort', 'medium', '--mcp-config', '/managed/task/mcp.json'], {})
        self.assertIn('--read-only', args)
        self.assertIn('--network=none', args)
        self.assertIn('--cap-drop=ALL', args)
        self.assertIn('--security-opt=no-new-privileges', args)
        self.assertTrue(any('dst=' + str(self.source) + ',readonly' in item for item in args))
        self.assertIn('/runtime/policy/mcp.json', args)
        self.assertEqual(args.count('--settings'), 1)
        self.assertIn('/runtime/policy/claude-settings.json', args)
        self.assertNotIn('MULTICA_TOKEN', ' '.join(args))
        self.assertNotIn(str(Path.home()), self.runtime.child_env().get('HOME', ''))

    def test_rejects_unknown_paths_settings_and_model_changes(self):
        for args in [['--mcp-config', '/unknown/config'], ['--settings', '{}'],
                     ['--model', 'other'], ['--effort', 'low'], ['--unknown'],
                     ['--plugin-dir', '/host/path']]:
            with self.assertRaises(ValueError):
                self.runtime.command(self.manifest, args, {})

    def test_stale_source_policy_and_mutable_aliases_fail_closed(self):
        (self.source / 'code.txt').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'source_changed'):
            self.runtime.command(self.manifest, [], {})
        (self.source / 'code.txt').write_text('original\n')
        (self.policy / 'mcp.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'policy_changed'):
            self.runtime.command(self.manifest, [], {})
        self.manifest['policy_sha256'] = self.runtime.tree_hash(self.policy)
        self.manifest['run_root'] = str(self.source / 'run')
        (self.source / 'run').mkdir()
        with self.assertRaisesRegex(ValueError, 'overlap'):
            self.runtime.command(self.manifest, [], {})

    def test_verified_reviewer_mcp_policy_preserves_both_trace_argv_forms_and_context7(self):
        for trace_args in [['serve'], ['serve', '--preset', 'review']]:
            config = {'mcpServers': {
                'trace': {'type': 'stdio', 'command': '/usr/local/bin/trace-mcp', 'args': trace_args},
                'context7': {'type': 'http', 'url': 'https://mcp.context7.com/mcp'}}}
            path = self.policy / 'mcp.json'
            raw = json.dumps(config, indent=2)
            path.write_text(raw)
            self.manifest['policy_sha256'] = self.runtime.tree_hash(self.policy)
            args = self.runtime.command(self.manifest, ['--mcp-config', '/managed/task/mcp.json'], {})
            self.assertIn('/runtime/policy/mcp.json', args)
            self.assertEqual(path.read_text(), raw)

    def test_mcp_policy_rejects_unknown_servers_transports_and_fields(self):
        trace = {'command': '/usr/local/bin/trace-mcp', 'args': ['serve', '--preset', 'review']}
        context7 = {'type': 'http', 'url': 'https://mcp.context7.com/mcp'}
        invalid = [
            {'other': trace}, {'context7': trace}, {'trace': context7},
            {'trace': {**trace, 'args': []}}, {'trace': {**trace, 'args': ['serve', '--preset', 'full']}},
            {'trace': {**trace, 'args': 'serve'}}, {'trace': {**trace, 'args': ['serve', 'D1_SECRET_CANARY']}},
            {'trace': {**trace, 'command': '/host/trace'}}, {'trace': {**trace, 'type': 'http'}},
            {'trace': {**trace, 'env': {}}}, {'trace': {**trace, 'headers': {}}},
            {'context7': {**context7, 'headers': {}}}, {'context7': {**context7, 'env': {}}},
            {'context7': {**context7, 'type': 'sse'}}, {'context7': {'url': context7['url']}},
            {'context7': {**context7, 'command': '/bin/sh'}}, {'trace': None}]
        for url in ['https://mcp.context7.com/mcp/oauth', 'https://mcp.context7.com/mcp?secret',
                    'https://mcp.context7.com/mcp#fragment', 'https://user@mcp.context7.com/mcp',
                    'https://mcp.context7.com:443/mcp', 'http://mcp.context7.com/mcp',
                    'https://mcp.context7.com.evil.invalid/mcp']:
            invalid.append({'context7': {**context7, 'url': url}})
        for servers in invalid:
            with self.subTest(servers=list(servers)):
                (self.policy / 'mcp.json').write_text(json.dumps({'mcpServers': servers}))
                self.manifest['policy_sha256'] = self.runtime.tree_hash(self.policy)
                with self.assertRaises(ValueError):
                    self.runtime.command(self.manifest, ['--mcp-config', '/managed/task/mcp.json'], {})

    def test_mcp_policy_rejects_duplicate_or_malformed_json_without_echoing_values(self):
        for raw in ['{"mcpServers":{},"mcpServers":{}}',
                    '{"mcpServers":{"trace":{"command":"D1_SECRET_CANARY","command":"/usr/local/bin/trace-mcp","args":["serve","--preset","review"]}}}',
                    '{"mcpServers":{},"extra":NaN}', 'D1_SECRET_CANARY', '[]']:
            (self.policy / 'mcp.json').write_text(raw)
            self.manifest['policy_sha256'] = self.runtime.tree_hash(self.policy)
            with self.assertRaises(ValueError) as raised:
                self.runtime.command(self.manifest, ['--mcp-config', '/managed/task/mcp.json'], {})
            self.assertNotIn('D1_SECRET_CANARY', str(raised.exception))

    def test_unresolved_managed_home_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'managed_env_unresolved'):
            self.runtime.command(self.manifest, [], {'CODEX_HOME': '/managed/unknown'})

    def test_auth_is_one_readonly_file_and_never_a_home_mount(self):
        auth = self.base / 'auth.json'
        auth.write_text('SYNTHETIC_AUTH_SECRET')
        auth.chmod(0o600)
        self.manifest.update(family='codex', model='gpt-5.6-terra', auth_file=str(auth))
        args = self.runtime.command(self.manifest, ['app-server'], {})
        self.assertIn('--mount=type=bind,src=' + str(auth) + ',dst=/runtime/cache/codex/auth.json,readonly', args)
        self.assertNotIn('SYNTHETIC_AUTH_SECRET', ' '.join(args))

    def test_claude_login_is_fixed_and_cannot_become_a_model_command(self):
        self.manifest.update(operation='claude-login', fixture=False)
        args = self.runtime.command(self.manifest, [], {})
        self.assertEqual(args[-3:], [self.manifest['image'], 'auth', 'login'])
        with self.assertRaises(ValueError):
            self.runtime.command(self.manifest, ['--print', 'prompt'], {})

    def test_codex_protocol_preserves_args_and_restricts_overrides(self):
        self.manifest.update(family='codex', model='gpt-5.6-terra')
        args = self.runtime.command(self.manifest, ['app-server', '-c', 'model="gpt-5.6-terra"'], {})
        self.assertIn('app-server', args)
        self.assertIn('model="gpt-5.6-terra"', args)
        for bad in [['exec'], ['app-server', '--listen', 'tcp://0.0.0.0:1234'],
                    ['app-server', '-c', 'mcp_servers.host.command="/host/bin"']]:
            with self.assertRaises(ValueError):
                self.runtime.command(self.manifest, bad, {})

    def test_native_codex_stdio_listener_is_forwarded_exactly(self):
        self.manifest.update(family='codex', model='gpt-5.6-terra')
        for incoming in [['app-server', '--listen', 'stdio://'],
                         ['app-server', '--listen', 'stdio://', '-c', 'model="gpt-5.6-terra"'],
                         ['app-server', '--config', 'model_reasoning_effort="medium"', '--listen', 'stdio://']]:
            with self.subTest(incoming=incoming):
                args = self.runtime.command(self.manifest, incoming, {})
                self.assertEqual(args[args.index('app-server'):], incoming + [
                    '-c', 'model="gpt-5.6-terra"', '-c', 'model_reasoning_effort="medium"'])

    def test_native_codex_listener_does_not_allow_alternate_transports_or_overrides(self):
        self.manifest.update(family='codex', model='gpt-5.6-terra')
        for tail in [['--listen'], ['--listen=stdio://'],
                     ['--listen', 'stdio://', '--listen', 'stdio://'],
                     ['--listen', 'tcp://127.0.0.1:9000'], ['--listen', 'unix:///tmp/socket'],
                     ['--listen', 'https://example.invalid'], ['--listen', 'stdio:/'],
                     ['--listen', 'stdio://', '--unknown'],
                     ['--listen', 'stdio://', '-c', 'model="other"'],
                     ['--listen', 'stdio://', '-c', 'model_reasoning_effort="low"'],
                     ['--listen', 'stdio://', '-c', 'service_tier="fast"']]:
            with self.subTest(tail=tail):
                with self.assertRaises(ValueError):
                    self.runtime.command(self.manifest, ['app-server'] + tail, {})

    def test_omitted_native_flags_keep_explicit_model_and_effort(self):
        args = self.runtime.command(self.manifest, [], {})
        self.assertIn('--model', args)
        self.assertIn('--effort', args)
        self.assertIn('claude-opus-4-6', args)
        self.manifest.update(family='codex', model='gpt-5.6-terra')
        args = self.runtime.command(self.manifest, ['app-server'], {})
        self.assertIn('model="gpt-5.6-terra"', args)
        self.assertIn('model_reasoning_effort="medium"', args)


if __name__ == '__main__':
    unittest.main(verbosity=2)
