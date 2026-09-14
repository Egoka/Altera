"""Contract tests используют настоящие Git snapshots; Docker проверяется отдельно."""
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

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

    def test_ordinary_commands_match_pre_refresh_boundary(self):
        expected = {'claude': ['/usr/local/bin/docker', 'run', '--rm', '--init', '--interactive', '--read-only', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=2g', '--cpus=2', '$USER', '--workdir=$BASE/source', '--mount=type=bind,src=$BASE/snapshot,dst=$BASE/source,readonly', '--mount=type=bind,src=$BASE/policy,dst=/runtime/policy,readonly', '--mount=type=bind,src=$BASE/run/evidence,dst=/runtime/evidence', '--mount=type=bind,src=$BASE/run/cache,dst=/runtime/cache', '--mount=type=bind,src=$BASE/run/tmp,dst=/runtime/tmp', '--env', 'HOME=/runtime/cache/home', '--env', 'CODEX_HOME=/runtime/cache/codex', '--env', 'CLAUDE_CONFIG_DIR=/runtime/cache/claude', '--env', 'TMPDIR=/runtime/tmp', '--env', 'TMP=/runtime/tmp', '--env', 'TEMP=/runtime/tmp', '--env', 'XDG_CACHE_HOME=/runtime/cache/xdg', '--env', 'TRACE_MCP_TELEMETRY=off', '--entrypoint=/usr/local/bin/node', 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '/runtime/policy/fixture.mjs', '--model', 'claude-opus-4-6', '--effort', 'medium', '--settings', '/runtime/policy/claude-settings.json', '--strict-mcp-config'], 'codex': ['/usr/local/bin/docker', 'run', '--rm', '--init', '--interactive', '--read-only', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=2g', '--cpus=2', '$USER', '--workdir=$BASE/source', '--mount=type=bind,src=$BASE/snapshot,dst=$BASE/source,readonly', '--mount=type=bind,src=$BASE/policy,dst=/runtime/policy,readonly', '--mount=type=bind,src=$BASE/run/evidence,dst=/runtime/evidence', '--mount=type=bind,src=$BASE/run/cache,dst=/runtime/cache', '--mount=type=bind,src=$BASE/run/tmp,dst=/runtime/tmp', '--env', 'HOME=/runtime/cache/home', '--env', 'CODEX_HOME=/runtime/cache/codex', '--env', 'CLAUDE_CONFIG_DIR=/runtime/cache/claude', '--env', 'TMPDIR=/runtime/tmp', '--env', 'TMP=/runtime/tmp', '--env', 'TEMP=/runtime/tmp', '--env', 'XDG_CACHE_HOME=/runtime/cache/xdg', '--env', 'TRACE_MCP_TELEMETRY=off', '--entrypoint=/usr/local/bin/node', 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '/runtime/policy/fixture.mjs', 'app-server', '--listen', 'stdio://', '-c', 'model="gpt-5.6-terra"', '-c', 'model_reasoning_effort="medium"'], 'claude-login': ['/usr/local/bin/docker', 'run', '--rm', '--init', '--interactive', '--read-only', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=2g', '--cpus=2', '$USER', '--workdir=$BASE/source', '--mount=type=bind,src=$BASE/snapshot,dst=$BASE/source,readonly', '--mount=type=bind,src=$BASE/policy,dst=/runtime/policy,readonly', '--mount=type=bind,src=$BASE/run/evidence,dst=/runtime/evidence', '--mount=type=bind,src=$BASE/run/cache,dst=/runtime/cache', '--mount=type=bind,src=$BASE/run/tmp,dst=/runtime/tmp', '--env', 'HOME=/runtime/cache/home', '--env', 'CODEX_HOME=/runtime/cache/codex', '--env', 'CLAUDE_CONFIG_DIR=/runtime/cache/claude', '--env', 'TMPDIR=/runtime/tmp', '--env', 'TMP=/runtime/tmp', '--env', 'TEMP=/runtime/tmp', '--env', 'XDG_CACHE_HOME=/runtime/cache/xdg', '--env', 'TRACE_MCP_TELEMETRY=off', '--entrypoint=/usr/local/bin/claude', 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'auth', 'login']}
        for mode, incoming in [("claude", ["--model", "claude-opus-4-6"]), ("codex", ["app-server", "--listen", "stdio://"]), ("claude-login", [])]:
            manifest = dict(self.manifest)
            if mode == "codex":
                manifest.update(family="codex", model="gpt-5.6-terra")
            if mode == "claude-login":
                manifest["operation"] = "claude-login"
            actual = [value.replace(str(self.base), "$BASE").replace("--user=" + str(os.getuid()) + ":" + str(os.getgid()), "$USER") for value in self.runtime.command(manifest, incoming, {})]
            self.assertEqual(actual, expected[mode])

    def test_playwright_admission_binds_receipt_image_vector_and_private_seccomp(self):
        mapper = self.runtime.playwright_mapper()
        receipt_dir = self.base / 'accepted'; receipt_dir.mkdir(mode=0o700)
        receipt = receipt_dir / 'playwright.json'
        record = mapper.playwright_receipt_template(self.manifest['image'])
        record['artifacts'] = {key: 'b' * 64 for key in mapper.PLAYWRIGHT_ARTIFACTS}
        record['checks'] = {key: 'c' * 64 for key in mapper.PLAYWRIGHT_CHECKS}
        receipt.write_bytes(mapper._canonical_json(record)); receipt.chmod(0o600)
        seccomp = receipt_dir / 'seccomp.json'; seccomp.write_bytes((ROOT / 'playwright-seccomp.json').read_bytes()); seccomp.chmod(0o600)
        (self.policy / 'codex-config.toml').write_bytes(mapper._render_block({'playwright'}))
        (self.policy / 'playwright-mcp-canary.mjs').write_bytes((ROOT / 'playwright-mcp-canary.mjs').read_bytes())
        self.manifest.update(family='codex', model='gpt-5.6-terra', network='playwright-fixture',
            policy_sha256=self.runtime.tree_hash(self.policy),
            playwright={'receipt': {'path': str(receipt), 'sha256': hashlib.sha256(receipt.read_bytes()).hexdigest(), 'image': self.manifest['image']},
                        'seccomp': str(seccomp), 'origin': 'http://altera-web:3000'})
        args = self.runtime.command(self.manifest, ['app-server'], {})
        self.assertIn('--security-opt=seccomp=' + str(seccomp), args)
        self.assertFalse(any('dst=' + str(seccomp) in arg for arg in args))
        without = dict(self.manifest); without.pop('playwright'); without['network'] = 'none'
        with self.assertRaisesRegex(ValueError, 'playwright_policy_invalid'):
            self.runtime.command(without, ['app-server'], {})
        for mutation in [{'image': 'sha256:' + 'd' * 64}, {'network': 'provider-proxy'}, {'auth_file': '/synthetic/auth'}]:
            with self.assertRaises(ValueError):
                self.runtime.command({**self.manifest, **mutation}, ['app-server'], {})
        config = self.policy / 'codex-config.toml'
        config.write_bytes(config.read_bytes().replace(b'--sandbox', b'--no-sandbox'))
        self.manifest['policy_sha256'] = self.runtime.tree_hash(self.policy)
        with self.assertRaisesRegex(ValueError, 'playwright_policy_invalid'):
            self.runtime.command(self.manifest, ['app-server'], {})

    def test_no_receipt_rejects_semantic_playwright_and_ambiguous_mcp_authority(self):
        mapper = self.runtime.playwright_mapper()
        config = self.policy / 'codex-config.toml'
        server = json.dumps('playwright').replace('p', '\\u0070')
        arguments = re.sub('playwright', lambda match: '\\u%04x' % ord(match.group()[0]) + match.group()[1:],
                           json.dumps(mapper.PLAYWRIGHT_VECTOR[1:]), flags=re.IGNORECASE)
        encoded = ('[mcp_servers.' + server + ']\ncommand = ' + json.dumps(mapper.PLAYWRIGHT_VECTOR[0]) + '\nargs = ' + arguments + '\n').encode()
        self.assertNotIn(b'playwright', encoded.lower())
        self.assertEqual(json.loads(server), 'playwright')
        self.assertEqual(json.loads(arguments), mapper.PLAYWRIGHT_VECTOR[1:])
        config.write_bytes(encoded)
        with self.assertRaisesRegex(ValueError, '^playwright_policy_invalid$'):
            self.runtime.playwright_policy(self.manifest)
        for text in ['[mcp_servers."playwright"]\ncommand = "ignored"\n',
                     "[mcp_servers.'playwright']\ncommand = \"ignored\"\n",
                     'mcp_servers = { "playwright" = {} }\n',
                     '[mcp_servers]\nplaywright = {}\n',
                     'mcp_servers.playwright.command = "ignored"\n',
                     '[[mcp_servers.playwright]]\ncommand = "ignored"\n',
                     '[profiles.test.mcp_servers.playwright]\ncommand = "ignored"\n',
                     'profiles = { test = { mcp_servers = {} } }\n',
                     '[mcp_servers.future]\ncommand = "ignored"\n',
                     '[mcp_servers.trace]\ncommand = "/usr/bin/env"\nargs = []\n',
                     '[mcp_servers.trace]\ncommand = "/usr/bin/env"\nargs = ' + arguments + '\n',
                     '[mcp_servers.context7]\nexperimental_use_rmcp_client = true\nurl = "https://unreviewed.invalid/mcp"\n',
                     '[mcp_servers.trace]\ncommand = "/usr/local/bin/trace-mcp"\nargs = ["serve"]\nenv = {}\n',
                     '[mcp_servers.trace.env]\nNODE_OPTIONS = "ignored"\n']:
            config.write_text(text)
            with self.subTest(policy=text):
                with self.assertRaisesRegex(ValueError, '^playwright_policy_invalid$'):
                    self.runtime.playwright_policy(self.manifest)
        for text in ['description = "playwright appears harmlessly here"\n',
                     "description = 'playwright is harmless here too'\n",
                     'model = "gpt-5.6-terra"\n' + mapper._render_block(set()).decode(),
                     mapper._render_block({'context7', 'trace'}).decode()]:
            config.write_text(text)
            self.assertIsNone(self.runtime.playwright_policy(self.manifest))

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

    def refresh_inputs(self):
        policy = self.base / 'refresh-policy'
        policy.mkdir(mode=0o700)
        for filename in ['claude-refresh.mjs', 'provider-proxy.mjs']:
            (policy / filename).write_bytes((ROOT / filename).read_bytes())
        (policy / 'empty-mcp.json').write_text('{"mcpServers":{}}')
        (policy / 'claude-settings.json').write_text('{"disableAllHooks":true}')
        store = self.base / 'store'; store.mkdir(mode=0o700)
        generations = store / 'generations'; generations.mkdir(mode=0o700)
        old = generations / ('a' * 32); old.mkdir(mode=0o700)
        credential = old / '.credentials.json'; credential.write_text('SYNTHETIC_PRIVATE'); credential.chmod(0o600)
        pending = generations / ('b' * 32 + '.pending'); pending.mkdir(mode=0o700)
        manifest = {'schema_version': 1, 'store': str(store), 'policy': str(policy),
            'policy_sha256': self.runtime.tree_hash(policy), 'run_root': str(self.run),
            'image': self.runtime.REFRESH_IMAGE, 'network': 'provider-proxy',
            'check_id': 'synthetic-refresh', 'attempt_id': 'c' * 32}
        self.run.chmod(0o700)
        return manifest, credential, pending

    def test_refresh_command_has_no_source_model_mcp_stdin_or_secret_docker_env(self):
        manifest, credential, pending = self.refresh_inputs()
        for operation in ['exchange', 'status', 'model']:
            run = self.base / ('refresh-' + operation); run.mkdir(mode=0o700)
            args = self.runtime.refresh_command({**manifest, 'run_root': str(run)}, operation, credential,
                                                pending if operation == 'exchange' else None)
            encoded = ' '.join(args)
            for forbidden in [str(self.source), str(self.snapshot), 'MULTICA_TOKEN', 'REFRESH_TOKEN', 'OAUTH_SCOPES', 'CODEX_HOME', 'docker.sock', 'SYNTHETIC_PRIVATE', '--interactive']:
                self.assertNotIn(forbidden, encoded)
            self.assertIn('--read-only', args)
            self.assertIn('--cap-drop=ALL', args)
            self.assertEqual(args[-1], operation)
            mounts = [arg for arg in args if arg.startswith('--mount=')]
            self.assertTrue(any(str(credential) in arg and arg.endswith(',readonly') for arg in mounts))
            self.assertFalse(any('dst=/runtime/policy,' in arg for arg in mounts))
            if operation != 'model':
                self.assertFalse(any('mcp' in arg or 'settings' in arg for arg in mounts))
            self.assertEqual(any('dst=/runtime/output/claude' in arg for arg in mounts), operation == 'exchange')
        for changed in [{'image': 'sha256:' + '0' * 64}, {'network': 'bridge'}, {'prompt': 'arbitrary'}]:
            with self.assertRaises(ValueError):
                self.runtime.refresh_command({**manifest, **changed}, 'exchange', credential, pending)

    def test_refresh_policy_hardlink_is_rejected_before_read_or_digest(self):
        manifest, credential, pending = self.refresh_inputs()
        forbidden = self.base / 'synthetic-private'; forbidden.write_bytes(os.urandom(32)); forbidden.chmod(0o600)
        target = Path(manifest['policy']) / 'claude-refresh.mjs'; target.unlink(); os.link(forbidden, target)
        observed = {'read': False, 'digest': False}; identity = forbidden.stat().st_ino
        original_bytes, original_read, original_digest = Path.read_bytes, os.read, self.runtime.digest
        def path_read(path):
            if path.stat().st_ino == identity: observed['read'] = True
            return original_bytes(path)
        def fd_read(fd, size):
            if os.fstat(fd).st_ino == identity: observed['read'] = True
            return original_read(fd, size)
        def digest(data):
            observed['digest'] = True
            return original_digest(data)
        with patch.object(Path, 'read_bytes', path_read), patch.object(os, 'read', side_effect=fd_read), \
             patch.object(self.runtime, 'digest', side_effect=digest):
            with self.assertRaises(ValueError): self.runtime.refresh_command(manifest, 'exchange', credential, pending)
        self.assertEqual(observed, {'read': False, 'digest': False})

    def test_refresh_policy_replacement_during_read_is_rejected_before_digest(self):
        manifest, credential, pending = self.refresh_inputs()
        policy = Path(manifest['policy']); target = policy / 'empty-mcp.json'
        replacement = self.base / 'replacement'; replacement.write_bytes(target.read_bytes())
        observed = {'replaced': False, 'digest': False}
        first_inode = (policy / 'claude-refresh.mjs').stat().st_ino
        original_bytes, original_read, original_digest = Path.read_bytes, os.read, self.runtime.digest
        def replace(inode):
            if inode == first_inode and not observed['replaced']:
                os.replace(replacement, target); observed['replaced'] = True
        def path_read(path):
            replace(path.stat().st_ino); return original_bytes(path)
        def fd_read(fd, size):
            replace(os.fstat(fd).st_ino); return original_read(fd, size)
        def digest(data):
            observed['digest'] = True; return original_digest(data)
        with patch.object(Path, 'read_bytes', path_read), patch.object(os, 'read', side_effect=fd_read), \
             patch.object(self.runtime, 'digest', side_effect=digest):
            with self.assertRaises(ValueError): self.runtime.refresh_command(manifest, 'exchange', credential, pending)
        self.assertEqual(observed, {'replaced': True, 'digest': False})

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


class ObserverTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('observer_runtime', ROOT / 'runtime.py')
        self.runtime = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.runtime)

    def test_raw_wait_preserves_signal_and_does_not_infer_from_137(self):
        from unittest.mock import Mock
        for raw, expected in [(-9, 9), (137, None), (0, None)]:
            observation = {}
            process = Mock(pid=123); process.wait.return_value = raw
            with patch.object(self.runtime.subprocess, 'Popen', return_value=process), \
                    patch.object(self.runtime.signal, 'signal'):
                code = self.runtime.execute(['/usr/bin/true'], observation=observation)
            self.assertEqual(code, 137 if raw == -9 else raw)
            self.assertEqual(observation['raw_wait'], raw)
            self.assertEqual(observation['signal'], expected)
            self.assertTrue(observation['child_reaped'])

    def test_owned_cleanup_never_accepts_unknown_or_live_container(self):
        for running in (True, None):
            observation = {'container_name': 'altera-native-fixture', 'container_id': None}
            with tempfile.TemporaryDirectory() as temporary:
                cidfile = Path(temporary) / 'cid'
                cidfile.write_text('a' * 64)
                row = {'Id': 'a' * 64, 'Name': '/altera-native-fixture',
                       'Running': running, 'ExitCode': 0, 'OOMKilled': False}
                with patch.object(self.runtime, '_docker_observe', return_value=(0, json.dumps(row), '')):
                    self.runtime.drain_container(observation, cidfile)
            self.assertNotEqual(observation['worker_quiescence'], 'proven')

    def test_check_requires_pinned_spec_and_actual_positive_count(self):
        self.assertTrue(callable(getattr(self.runtime, 'check', None)), 'trusted runtime check operation missing')


class FixedCheckTests(unittest.TestCase):
    setUpClass = classmethod(RuntimeTests.setUpClass.__func__)
    setUp = RuntimeTests.setUp
    git = RuntimeTests.git

    def test_production_check_runs_real_node_and_rejects_zero_count_and_truncation(self):
        import shutil
        import sys
        script = self.policy / 'check.test.mjs'
        state = self.base / 'docker-state'
        docker = self.base / 'docker-boundary'
        docker.write_text('#!' + sys.executable + '\n' +
            "import os,sys\nfrom pathlib import Path\n" +
            "args=sys.argv[1:]\nassert args[0]=='run'\nassert '--network=none' in args\n" +
            "assert sum(arg.endswith(',readonly') for arg in args)==2\n" +
            "Path(next(a.split('=',1)[1] for a in args if a.startswith('--cidfile='))).write_text('a'*64)\n" +
            "Path(" + repr(str(state)) + ").write_text(next(a.split('=',1)[1] for a in args if a.startswith('--name=')))\n" +
            "os.execv(" + repr(shutil.which('node')) + ",[" + repr(shutil.which('node')) +
            ",'--test','--test-reporter=tap'," + repr(str(script)) + "])\n")
        docker.chmod(0o700)
        spec_path = self.base / 'check.json'; spec_path.touch(mode=0o600)
        cases = [("import test from 'node:test';test('positive',()=>{});", 1048576, True, 0, 1),
                 ("import test from 'node:test';test('failure',()=>{throw Error('actual assertion')});",1048576,True,1,1),
                 ("import test from 'node:test';test('skip',{skip:true},()=>{});",1048576,False,0,0),
                 ("import test from 'node:test';test('output',()=>console.log('x'.repeat(1000)));",8,False,None,None)]
        for content, cap, complete, exit_code, count in cases:
            script.write_text(content); self.manifest['policy_sha256']=self.runtime.tree_hash(self.policy)
            spec={'schema_version':1,'argv':['/usr/local/bin/node','--test','--test-reporter=tap','/runtime/policy/check.test.mjs'],
                  'cwd':str(self.source),'network':'none','parser':'node-tap','timeout_seconds':120,'maximum_output':cap}
            spec_path.write_text(json.dumps(spec)); removed=[]
            def inspect(*args):
                if args[1]=='rm': removed.append(True); return (0,'','')
                if removed:return (1,'','Error: No such container')
                return (0,json.dumps({'Id':'a'*64,'Name':'/'+state.read_text(),
                                      'Running':False,'ExitCode':exit_code or 0,'OOMKilled':False}),'')
            with patch.object(self.runtime,'DOCKER',str(docker)),patch.object(self.runtime,'_docker_observe',side_effect=inspect):
                result=self.runtime.check(self.manifest,str(spec_path),hashlib.sha256(spec_path.read_bytes()).hexdigest(),invocation_id='fixed-check')
            self.assertEqual(result['complete'],complete,result)
            if count is not None:self.assertEqual(result['executed'],count)
            if exit_code is not None:self.assertEqual(result['exit_code'],exit_code)
            self.assertTrue(result['container_removed'])
            self.assertEqual(result['provider_cleanup'],'proven')
        with self.assertRaisesRegex(ValueError,'check_spec_changed'):
            self.runtime.check(self.manifest,str(spec_path),'0'*64,invocation_id='fixed-check')
