"""D1: настоящие private files и subprocess; только synthetic config values."""
import hashlib
import json
import os
from pathlib import Path
import socket
import signal
import time
import subprocess
import tempfile
import unittest
import uuid

HERE = Path(__file__).resolve().parent


class MetadataConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(dir='/private/tmp')
        cls.base = Path(cls.temp.name).resolve()
        cls.root = cls.base / 'private-root'
        cls.root.mkdir(mode=0o700)
        cls.binary = cls.base / 'd1'
        helper = HERE / 'build_metadata_config_probe.py'
        if helper.exists():
            result = subprocess.run(['/usr/bin/python3', '-I', str(helper), str(cls.binary),
                            '--root', str(cls.root), '--uid', str(os.getuid())], capture_output=True)
            if result.returncode:
                raise AssertionError('D1 build failed: ' + result.stderr.decode())

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.directory = self.root / ('multica-mcp-' + uuid.uuid4().hex)
        self.directory.mkdir(mode=0o700)
        self.file = self.directory / 'mcp-config.json'
        self.save({'mcpServers': {'context7': {'type': 'http', 'url': 'https://mcp.context7.com/mcp'}}})

    def save(self, value):
        self.file.write_bytes(value if isinstance(value, bytes) else json.dumps(value).encode())
        self.file.chmod(0o600)

    def invoke(self, args=None, prefix=None):
        self.assertTrue(self.binary.exists(), 'D1 executable has not been implemented')
        run = subprocess.Popen((prefix or []) + [str(self.binary)] + (args if args is not None else ['--mcp-config', str(self.file)]),
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env={'PATH': '/usr/bin:/bin', 'TMPDIR': '/wrong/env/root', 'MULTICA_TOKEN': 'D1_SECRET_CANARY'})
        try:
            run.wait(timeout=3)
            stdout, stderr = run.communicate()
        finally:
            if run.poll() is None:
                run.kill()
                run.communicate()
        self.assertEqual(run.returncode, 78)
        self.assertEqual(stdout, b'')
        self.assertLessEqual(len(stderr), 8192)
        self.assertNotIn(b'D1_SECRET_CANARY', stderr)
        self.assertNotIn(hashlib.sha256(b'D1_SECRET_CANARY').hexdigest().encode(), stderr)
        self.assertTrue(stderr.startswith(b'ALTERA_METADATA_CONFIG_ONLY_V1 '), stderr)
        return json.loads(stderr.split(b' ', 1)[1])

    def test_reads_exact_private_json_without_waiting_for_stdin(self):
        result = self.invoke()
        self.assertEqual(result['read_status'], 'ok')
        self.assertEqual(result['mapping_candidate'], 'exact')
        self.assertEqual(result['servers'][0]['endpoint'], 'context7_public_mcp')
        self.assertEqual(result['task_acceptance'], 'not_checked')
        self.assertEqual(self.invoke(['--mcp-config=' + str(self.file)])['read_status'], 'ok')

    def test_uid_pin_rejects_other_process_owner_and_alias_pin_is_not_generic(self):
        self.assertTrue(self.binary.exists(), 'D1 executable has not been implemented')
        other = self.base / 'other-uid-probe'
        helper = HERE / 'build_metadata_config_probe.py'
        built = subprocess.run(['/usr/bin/python3', '-I', str(helper), str(other),
            '--root', str(self.root), '--uid', str(os.getuid() + 1)], capture_output=True)
        self.assertEqual(built.returncode, 0, built.stderr.decode())
        run = subprocess.run([str(other), '--mcp-config', str(self.file)], capture_output=True, timeout=3)
        self.assertEqual(run.returncode, 78)
        self.assertEqual(run.stdout, b'')
        self.assertEqual(json.loads(run.stderr.split(b' ', 1)[1])['read_status'], 'owner_mismatch')
        rejected = subprocess.run(['/usr/bin/python3', '-I', str(helper), str(self.base / 'bad-alias'),
            '--root', str(self.root), '--uid', str(os.getuid()), '--alias', '/arbitrary/alias'], capture_output=True)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertFalse((self.base / 'bad-alias').exists())

    def test_version_is_truthful_without_config_access(self):
        self.assertTrue(self.binary.exists(), 'D1 executable has not been implemented')
        self.file.unlink()
        for flag in ['--help', '--version']:
            result = subprocess.run([str(self.binary), flag], capture_output=True, timeout=3)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b'')
            self.assertIn(b'altera-metadata-config-probe', result.stderr)
            self.assertNotIn(b'Claude Code', result.stderr)

    def test_only_exact_public_endpoints_match(self):
        for url, match in [('https://mcp.context7.com/mcp/oauth', 'context7_public_oauth'),
                           ('https://mcp.context7.com/mcp?D1_SECRET_CANARY', 'unknown'),
                           ('https://D1_SECRET_CANARY@mcp.context7.com/mcp', 'unknown'),
                           ('https://mcp.context7.com:443/mcp', 'unknown'),
                           ('http://mcp.context7.com/mcp', 'unknown')]:
            with self.subTest(match=match):
                self.save({'mcpServers': {'context7': {'type': 'http', 'url': url}}})
                result = self.invoke()
                self.assertEqual(result['servers'][0]['endpoint'], match)
                self.assertEqual(result['mapping_candidate'], 'exact' if match != 'unknown' else 'unresolved')

    def test_literal_playwright_and_trace_candidates(self):
        for command in ['npx', '/usr/local/bin/npx', '/opt/homebrew/bin/npx', '/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/npx']:
            for args in [['-y', '@playwright/mcp'], ['-y', '@playwright/mcp@latest', '--headless']]:
                self.save({'mcpServers': {'playwright': {'command': command, 'args': args}}})
                self.assertEqual(self.invoke()['mapping_candidate'], 'exact')
        for command in ['/Users/egorbondarenko/.trace/bin/trace', '/Users/egorbondarenko/.trace/bin/trace-mcp']:
            for args in [['serve'], ['serve', '--preset', 'review']]:
                self.save({'mcpServers': {'trace': {'type': 'stdio', 'command': command, 'args': args}}})
                self.assertEqual(self.invoke()['mapping_candidate'], 'exact')
        for args in [['-y', '@playwright/mcp', '--cdp-endpoint', 'D1_SECRET_CANARY'], ['-y', '@playwright/mcp@0.1'], ['--yes', '@playwright/mcp']]:
            self.save({'mcpServers': {'playwright': {'command': 'npx', 'args': args}}})
            self.assertEqual(self.invoke()['mapping_candidate'], 'unresolved')

    def test_secrets_and_unknown_fields_are_presence_only(self):
        self.save({'mcpServers': {'context7': {'type': 'http', 'url': 'https://mcp.context7.com/mcp',
                    'headers': {'Authorization': 'D1_SECRET_CANARY', 'CONTEXT7_API_KEY': 'D1_SECRET_CANARY'},
                    'env': {'D1_SECRET_CANARY': 'D1_SECRET_CANARY'}, 'D1_SECRET_CANARY': 'D1_SECRET_CANARY'},
                    'D1_SECRET_CANARY': {'type': 'D1_SECRET_CANARY'}}})
        result = self.invoke(['-p', '--append-system-prompt', 'D1_SECRET_CANARY', '--mcp-config', str(self.file)])
        self.assertEqual(result['mapping_candidate'], 'unresolved')
        self.assertEqual(result['unknown_servers'], 1)
        self.assertTrue(result['servers'][0]['headers_present'])
        self.assertTrue(result['servers'][0]['env_present'])
        self.assertEqual(result['servers'][0]['known_secret_fields'], 2)

    def test_option_values_cannot_become_mcp_read_authority(self):
        needle = '--mcp-config=' + str(self.file)
        for flag in ['--append-system-prompt', '--system-prompt', '--model', '--effort',
                     '--input-format', '--output-format', '--permission-mode', '--disallowedTools', '--settings']:
            for opaque in [[flag, needle], [flag + '=' + needle]]:
                with self.subTest(flag=flag, equals=len(opaque) == 1):
                    rejected = self.invoke(opaque)
                    self.assertEqual(rejected['read_status'], 'argv_rejected')
                    self.assertNotIn('--mcp-config', rejected['known_flags'])
                    for genuine in [['--mcp-config', str(self.file)], [needle]]:
                        accepted = self.invoke(opaque + genuine)
                        self.assertEqual(accepted['read_status'], 'ok')
                        self.assertEqual(accepted['known_flags'].count('--mcp-config'), 1)
        result = self.invoke(['--append-system-prompt', '--mcp-config', str(self.file)])
        self.assertEqual(result['read_status'], 'argv_rejected')

    def test_unsupported_or_ambiguous_native_argv_is_rejected_before_read(self):
        genuine = ['--mcp-config', str(self.file)]
        for extra in [['--unknown=D1_SECRET_CANARY'], ['D1_SECRET_CANARY'], ['--'],
                      ['--model'], ['--verbose=true'], ['--verbose', '--verbose'],
                      ['--disallowedTools', 'one', 'two'], ['--mcp-config=' + str(self.file)]]:
            with self.subTest(extra_count=len(extra)):
                self.assertEqual(self.invoke(genuine + extra)['read_status'], 'argv_rejected')
        native = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json',
                  '--verbose', '--permission-mode', 'bypassPermissions', '--disallowedTools', 'Edit,Write',
                  '--strict-mcp-config', '--model', 'claude-opus-4-6'] + genuine
        self.assertEqual(self.invoke(native)['read_status'], 'ok')

    def test_unreviewed_counts_cover_root_server_headers_and_env_without_disclosure(self):
        self.save({'mcpServers': {'context7': {'type': 'http', 'url': 'https://mcp.context7.com/mcp',
            'D1_SECRET_CANARY': 'D1_SECRET_CANARY',
            'headers': {'Authorization': 'D1_SECRET_CANARY', 'D1_SECRET_CANARY': 'D1_SECRET_CANARY'},
            'env': {'D1_SECRET_CANARY': 'D1_SECRET_CANARY', 'other-private-key': {}}}},
            'D1_SECRET_CANARY': 'D1_SECRET_CANARY', 'second-private-key': {}})
        result = self.invoke()
        self.assertIs(result.get('unreviewed_fields'), True)
        self.assertEqual(result.get('unknown_fields'), 2)
        self.assertEqual(result['mapping_candidate'], 'unresolved')
        server = result['servers'][0]
        self.assertIs(server.get('unreviewed_fields'), True)
        self.assertEqual(server['unknown_fields'], 2)
        self.assertEqual(server['known_secret_fields'], 1)
        self.assertEqual(server['unknown_secret_fields'], 1)
        self.assertIs(server.get('headers_unreviewed_fields'), True)
        self.assertEqual(server.get('unknown_env_fields'), 2)
        self.assertIs(server.get('env_unreviewed_fields'), True)
        self.assertIs(server.get('env_types_match'), False)
        for key in ['headers', 'env']:
            self.save({'mcpServers': {'context7': {'type': 'http', 'url': 'https://mcp.context7.com/mcp', key: []}}})
            result = self.invoke()
            self.assertIs(result.get('unreviewed_fields'), True)
            self.assertIs(result['servers'][0].get(key + '_unreviewed_fields'), True)
        self.save({'mcpServers': {'context7': {'type': 'http', 'url': 'https://mcp.context7.com/mcp',
                   'headers': {'Authorization': 'D1_SECRET_CANARY'}}}})
        result = self.invoke()
        self.assertIs(result.get('unreviewed_fields'), False)
        self.assertEqual(result.get('unknown_fields'), 0)
        self.assertIs(result['servers'][0].get('unreviewed_fields'), False)
        self.assertIs(result['servers'][0].get('headers_unreviewed_fields'), False)
        self.assertEqual(result['mapping_candidate'], 'exact')

    def test_rejects_unsafe_argument_paths(self):
        for args in [[], ['--mcp-config', '{}'], ['--mcp-config', '/etc/passwd'],
                     ['--mcp-config', str(self.file), '--mcp-config', str(self.file)],
                     ['--mcp-config'], ['--mcp-config', str(self.root / '../private-root' / self.directory.name / self.file.name)],
                     ['--mcp-config', str(self.file) + '\n'], ['--mcp-config', str(self.file.relative_to(self.base))]]:
            with self.subTest(args_count=len(args)):
                self.assertNotEqual(self.invoke(args)['read_status'], 'ok')

    def test_private_modes_and_hardlinks_are_required(self):
        for path, bad_mode, restored in [(self.root, 0o755, 0o700), (self.directory, 0o750, 0o700), (self.file, 0o640, 0o600)]:
            path.chmod(bad_mode)
            try:
                self.assertNotEqual(self.invoke()['read_status'], 'ok')
            finally:
                path.chmod(restored)
        link = self.directory / 'hardlink'
        os.link(self.file, link)
        self.assertNotEqual(self.invoke()['read_status'], 'ok')
        link.unlink()

    def test_rejects_symlink_file_and_directory(self):
        target = self.directory / 'target'
        self.file.rename(target)
        self.file.symlink_to(target.name)
        self.assertNotEqual(self.invoke()['read_status'], 'ok')
        self.file.unlink()
        target.rename(self.file)
        alias = self.root / 'multica-mcp-alias'
        alias.symlink_to(self.directory, target_is_directory=True)
        self.assertNotEqual(self.invoke(['--mcp-config', str(alias / self.file.name)])['read_status'], 'ok')
        alias.unlink()

    def test_root_symlink_is_not_followed(self):
        moved = self.root.with_name('saved-root')
        self.root.rename(moved)
        self.root.symlink_to(moved, target_is_directory=True)
        try:
            self.assertNotEqual(self.invoke()['read_status'], 'ok')
        finally:
            self.root.unlink()
            moved.rename(self.root)

    def test_invalid_temp_names_and_extra_levels_are_rejected(self):
        for name in ['multica-mcp-', 'multica-mcp-a_b', 'multica-mcp-a.b', 'multica-mcp-a/extra', 'other-a']:
            self.assertEqual(self.invoke(['--mcp-config', str(self.root / name / 'mcp-config.json')])['read_status'], 'path_rejected')

    def test_fifo_and_socket_do_not_block(self):
        self.file.unlink()
        os.mkfifo(self.file, 0o600)
        self.assertNotEqual(self.invoke()['read_status'], 'ok')
        self.file.unlink()
        with socket.socket(socket.AF_UNIX) as sock:
            sock.bind(str(self.file))
            self.file.chmod(0o600)
            self.assertNotEqual(self.invoke()['read_status'], 'ok')

    def test_strict_json_rejects_malformed_duplicate_and_non_utf8(self):
        for raw in [b'{} trailing', b'{"mcpServers":{},"mcpServers":{}}',
                    b'{"mcpServers":{},"mcp\\u0053ervers":{}}', b'{"mcpServers":{"x":{"a":1,"a":2}}}',
                    b'{"mcpServers":{},}', b'[]', b'{"mcpServers":NaN}', b'{"mcpServers":01}',
                    b'{"mcpServers":"\xff"}', b'{"mcpServers":"\\ud800"}', b'{"mcpServers":"a\x00b"}',
                    b'{"mcpServers":"\\x00"}', b'{"mcpServers":"\xc0\x80"}']:
            with self.subTest(raw_length=len(raw)):
                self.save(raw)
                self.assertEqual(self.invoke()['read_status'], 'invalid_json')

    def test_limits_fail_closed(self):
        for raw in [b' ' * 65537, b'{"a":' * 18 + b'0' + b'}' * 18,
                    json.dumps({'mcpServers': {}, 'extra': [0] * 4096}).encode()]:
            self.save(raw)
            self.assertNotEqual(self.invoke()['read_status'], 'ok')
        self.save({'mcpServers': {str(n): {} for n in range(9)}})
        self.assertEqual(self.invoke()['mapping_candidate'], 'unresolved')

    def test_unknown_shapes_never_become_mapping_authority(self):
        for value in [{}, {'mcpServers': []}, {'mcpServers': {}},
                      {'mcpServers': {'context7': {'type': 'stdio', 'url': 'https://mcp.context7.com/mcp'}}},
                      {'mcpServers': {'context7': {'type': 'http', 'url': 'https://mcp.context7.com/mcp', 'headers': {'Authorization': {}}}}},
                      {'mcpServers': {'playwright': {'command': '/bin/sh', 'args': ['-y', '@playwright/mcp']}}}]:
            self.save(value)
            self.assertEqual(self.invoke()['mapping_candidate'], 'unresolved')

    def test_file_replacement_and_truncation_during_read_are_rejected(self):
        self.assertTrue(self.binary.exists(), 'D1 executable has not been implemented')
        # Test-only interposer останавливает процесс сразу после read; production не содержит test hooks.
        source = self.base / 'pause-read.c'
        library = self.base / 'pause-read.dylib'
        source.write_text(r'''#include <unistd.h>
#include <signal.h>
#include <string.h>
#include <sys/stat.h>
static ssize_t pause_read(int fd, void *buf, size_t n) {
    ssize_t got = read(fd, buf, n);
    struct stat s;
    static int paused;
    if (got >= 14 && !memcmp(buf, "{\"mcpServers\":", 14) && !paused && !fstat(fd, &s) && S_ISREG(s.st_mode)) {
        paused = 1;
        raise(SIGSTOP);
    }
    return got;
}
__attribute__((used)) static struct { const void *replacement; const void *original; }
interpose __attribute__((section("__DATA,__interpose"))) = { (const void *)pause_read, (const void *)read };
''')
        build = subprocess.run(['/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang',
                                '-isysroot', '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk',
                                '-Wall', '-Wextra', '-Werror', '-dynamiclib', str(source), '-o', str(library)],
                               env={'PATH': '/usr/bin:/bin', 'TMPDIR': str(self.base)}, capture_output=True)
        self.assertEqual(build.returncode, 0, build.stderr.decode())
        for action in ['replace', 'truncate']:
            with self.subTest(action=action):
                self.save({'mcpServers': {'context7': {'type': 'http', 'url': 'https://mcp.context7.com/mcp'}}})
                run = subprocess.Popen([str(self.binary), '--mcp-config', str(self.file)],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    env={'PATH': '/usr/bin:/bin', 'DYLD_INSERT_LIBRARIES': str(library)})
                try:
                    deadline = time.monotonic() + 3
                    stopped = False
                    while time.monotonic() < deadline:
                        pid, status = os.waitpid(run.pid, os.WNOHANG | os.WUNTRACED)
                        if pid:
                            stopped = os.WIFSTOPPED(status)
                            break
                        time.sleep(0.01)
                    self.assertTrue(stopped, 'instrumented read did not reach synchronization point')
                    if action == 'replace':
                        replacement = self.directory / 'replacement'
                        replacement.write_bytes(self.file.read_bytes())
                        replacement.chmod(0o600)
                        replacement.replace(self.file)
                    else:
                        self.file.write_bytes(b'{')
                    os.kill(run.pid, signal.SIGCONT)
                    stdout, stderr = run.communicate(timeout=3)
                    self.assertEqual(run.returncode, 78)
                    self.assertEqual(stdout, b'')
                    self.assertEqual(json.loads(stderr.split(b' ', 1)[1])['read_status'], 'file_changed')
                finally:
                    if run.poll() is None:
                        run.kill()
                        run.communicate()

    def test_os_sandbox_denies_child_network_write_and_unrelated_reads(self):
        self.assertTrue(self.binary.exists(), 'D1 executable has not been implemented')
        control = self.base / 'control'
        control_source = self.base / 'control.c'
        control_source.write_text(r'''#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <netinet/in.h>
int main(int argc, char **argv) {
    if (argc != 4) return 2;
    int fd = open(argv[1], O_WRONLY | O_CREAT | O_EXCL, 0600);
    int wrote = fd >= 0 && write(fd, "synthetic", 9) == 9;
    if (fd >= 0) close(fd);
    pid_t child = fork();
    if (!child) _exit(0);
    if (child > 0) waitpid(child, NULL, 0);
    fd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in address = {0};
    address.sin_family = AF_INET;
    address.sin_port = htons((unsigned short)atoi(argv[3]));
    address.sin_addr.s_addr = htonl(0x7f000001);
    int network = fd >= 0 && connect(fd, (struct sockaddr *)&address, sizeof(address)) == 0;
    if (fd >= 0) close(fd);
    fd = open(argv[2], O_RDONLY);
    int outside = fd >= 0;
    if (fd >= 0) close(fd);
    printf("{\"write\":%d,\"child\":%d,\"network\":%d,\"outside_read\":%d}\n", wrote, child > 0, network, outside);
    return 0;
}
''')
        built = subprocess.run(['/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang',
            '-isysroot', '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk',
            '-Wall', '-Wextra', '-Werror', str(control_source), '-o', str(control)],
            env={'PATH': '/usr/bin:/bin', 'TMPDIR': str(self.base)}, capture_output=True)
        self.assertEqual(built.returncode, 0, built.stderr.decode())
        attempted = self.base / 'attempted-write'
        outside = self.base / 'unrelated-input'
        outside.write_text('SYNTHETIC_OUTSIDE_READ')
        literals = {str(self.binary), str(control), str(self.file), str(self.directory), str(self.root)}
        literals.update(str(p) for p in self.root.parents)
        profile = self.base / 'd1.sb'
        profile.write_text('(version 1)\n(deny default)\n(allow sysctl-read)\n'
            '(allow file-read-metadata)\n'
            '(allow file-read-data (subpath "/usr/lib") (subpath "/System/Library") '
            + ' '.join('(literal ' + json.dumps(p) + ')' for p in sorted(literals)) + ')\n'
            '(allow process-exec (literal ' + json.dumps(str(self.binary)) + ') (literal ' + json.dumps(str(control)) + '))\n')
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen(2)
            args = [str(control), str(attempted), str(outside), str(listener.getsockname()[1])]
            positive = subprocess.run(args, capture_output=True, timeout=3)
            self.assertEqual(positive.returncode, 0, positive.stderr.decode())
            self.assertEqual(json.loads(positive.stdout), {'write': 1, 'child': 1, 'network': 1, 'outside_read': 1})
            connection, _ = listener.accept()
            connection.close()
            attempted.unlink()
            negative = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(profile)] + args, capture_output=True, timeout=3)
            self.assertEqual(negative.returncode, 0, negative.stderr.decode())
            self.assertEqual(json.loads(negative.stdout), {'write': 0, 'child': 0, 'network': 0, 'outside_read': 0})
            self.assertFalse(attempted.exists())
        before = hashlib.sha256(self.file.read_bytes()).hexdigest()
        result = self.invoke(prefix=['/usr/bin/sandbox-exec', '-f', str(profile)])
        self.assertEqual(result['read_status'], 'ok')
        self.assertEqual(result['mapping_candidate'], 'exact')
        self.assertEqual(hashlib.sha256(self.file.read_bytes()).hexdigest(), before)
        evidence = os.environ.get('D1_EVIDENCE_DIR')
        if evidence:
            target = Path(evidence)
            target.mkdir(mode=0o700)
            (target / 'sandbox.sb').write_bytes(profile.read_bytes())
            (target / 'control.c').write_bytes(control_source.read_bytes())
            (target / 'control').write_bytes(control.read_bytes())
            (target / 'positive.stdout').write_bytes(positive.stdout)
            (target / 'positive.stderr').write_bytes(positive.stderr)
            (target / 'negative.stdout').write_bytes(negative.stdout)
            (target / 'negative.stderr').write_bytes(negative.stderr)
            (target / 'd1-descriptor.json').write_text(json.dumps(result, indent=2) + '\n')
            (target / 'proof.json').write_text(json.dumps({'positive_exit': positive.returncode,
                'negative_exit': negative.returncode, 'd1_exit': 78, 'd1_stdout_empty': True,
                'source_config_unchanged': True, 'binary_sha256': hashlib.sha256(self.binary.read_bytes()).hexdigest(),
                'synthetic_only': True, 'network_target': 'own ephemeral loopback listener'}, indent=2) + '\n')

    def test_escaped_public_values_match_without_unknown_disclosure(self):
        self.save(b'{"mcpServers":{"context\\u0037":{"type":"http","url":"https:\\/\\/mcp.context7.com/mcp"}}}')
        self.assertEqual(self.invoke()['mapping_candidate'], 'exact')


if __name__ == '__main__':
    unittest.main(verbosity=2)
