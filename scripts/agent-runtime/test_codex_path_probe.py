"""D2: synthetic metadata contracts; реальные local sandbox controls без моделей."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
MARKER = b'ALTERA_CODEX_PATH_ONLY_V1 '
COMPILER = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang'
SDK = '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk'


class BuildPinTests(unittest.TestCase):
    def test_required_catalog_and_durable_cwd_allow_embedded_dots_only(self):
        self.assertTrue((ROOT / 'build_codex_path_probe.py').exists(), 'D2 builder is missing')
        spec = importlib.util.spec_from_file_location('d2_pins', ROOT / 'build_codex_path_probe.py')
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        for path in ['/Users/egorbondarenko/multica_workspaces_desktop-api.multica.ai/altera-fd1da0aa3ec6',
                     '/private/tmp/fixture/.superpowers/proof']:
            self.assertEqual(builder.path_pin(path, 1024), path)
        for path in ['/private/./tmp', '/private/../tmp']:
            with self.assertRaises(ValueError):
                builder.path_pin(path, 1024)


class CodexPathTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        supplied = os.environ.get('D2_EVIDENCE_DIR')
        if supplied:
            cls.base = Path(supplied).resolve()
            cls.base.mkdir(exist_ok=False)
        else:
            cls.temporary = tempfile.TemporaryDirectory(prefix='altera-d2-test-', dir='/private/tmp')
            cls.addClassCleanup(cls.temporary.cleanup)
            cls.base = Path(cls.temporary.name)
        cls.binary = cls.base / 'codex-path-probe'
        cls.workspace = '/synthetic/workspace'
        cls.cwd = cls.base
        cls.build = None
        if (ROOT / 'build_codex_path_probe.py').exists():
            cls.build = cls.compile_probe(cls.binary, cls.workspace, str(cls.cwd))

    @classmethod
    def compile_probe(cls, output, workspace, cwd):
        command = ['/usr/bin/python3', '-I', str(ROOT / 'build_codex_path_probe.py'), str(output),
                   '--root', workspace, '--cwd', cwd, '--uid', '501']
        result = subprocess.run(command, capture_output=True, timeout=30)
        (cls.base / (output.name + '-build.stdout')).write_bytes(result.stdout)
        (cls.base / (output.name + '-build.stderr')).write_bytes(result.stderr)
        if result.returncode:
            raise AssertionError('D2 build failed: ' + result.stderr.decode())
        return json.loads(result.stdout)

    def run_probe(self, home=None, args=(), cwd=None, extra=None, binary=None):
        self.assertTrue(self.binary.exists(), 'D2 metadata-only executable is missing')
        environment = {'PATH': '/usr/bin:/bin', 'HOME': '/var/empty', **(extra or {})}
        if home is not None:
            environment['CODEX_HOME'] = home
        process = subprocess.Popen([str(binary or self.binary), *args], env=environment,
                                   cwd=cwd or self.cwd, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        # stdin остаётся открытым без EOF; диагностике нельзя ждать protocol input.
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            self.fail('D2 consumed or waited on stdin')
        stdout, stderr = process.communicate()
        with (self.base / 'probe-exchanges.jsonl').open('a') as stream:
            stream.write(json.dumps({'exit': process.returncode, 'stdout': stdout.decode(),
                                     'stderr': stderr.decode()}) + '\n')
        return process.returncode, stdout, stderr

    def diagnostic(self, home=None, **kwargs):
        code, stdout, stderr = self.run_probe(home, **kwargs)
        self.assertEqual(code, 78)
        self.assertEqual(stdout, b'')
        self.assertLessEqual(len(stderr), 1800)
        self.assertEqual(stderr.count(b'\n'), 1)
        self.assertTrue(stderr.startswith(MARKER))
        data = json.loads(stderr[len(MARKER):])
        self.assertEqual(data['canonical_identity'], 'not_checked')
        self.assertEqual(data['task_acceptance'], 'not_checked')
        self.assertEqual(data['source_sha256'], self.build['source_sha256'])
        self.assertEqual(data['build_sha256'], self.build['build_sha256'])
        return data, stderr

    def test_exact_lexical_candidates_and_cwd_boolean(self):
        for number in ['1', '0', '000001', '123456789']:
            home = self.workspace + '/alte-' + number + '-012345abcdef/codex-home'
            data, _ = self.diagnostic(home, args=['app-server', '--listen', 'stdio://'])
            self.assertEqual(data['read_status'], 'lexical_candidate')
            self.assertEqual(data['candidate_path'], home)
            self.assertTrue(data['cwd_matches_expected'])
            self.assertEqual(data['argc'], 4)
            other, _ = self.diagnostic(home, cwd='/private/tmp')
            self.assertFalse(other['cwd_matches_expected'])
            self.assertEqual(other['candidate_path'], home)

    def test_missing_and_invalid_paths_are_opaque(self):
        valid = self.workspace + '/alte-1-012345abcdef/codex-home'
        candidates = [None, '', 'relative', '/Users/secret/.codex', '/wrong' + valid,
                      valid + '/', valid + '/child', valid.replace('/alte-', '//alte-'),
                      valid.replace('/alte-', '/./alte-'), valid.replace('/alte-', '/../alte-'),
                      valid.replace('alte-1-', 'alte--'), valid.replace('alte-1-', 'alte-1234567890-'),
                      valid.replace('012345abcdef', '012345abcde'), valid.replace('012345abcdef', '012345abcdef0'),
                      valid.replace('012345abcdef', '012345abcdeF'), valid.replace('012345abcdef', '012345abcdeg'),
                      valid + 'SECRET_CANARY', valid + '\n', valid + '\t', valid + ' ', valid + '\x01',
                      valid + 'é', 'X' * 1025, valid + 'X' * 100000]
        for candidate in candidates:
            with self.subTest(case=candidates.index(candidate)):
                data, raw = self.diagnostic(candidate)
                self.assertEqual(data['read_status'], 'managed_paths_unresolved')
                self.assertNotIn('candidate_path', data)
                if candidate:
                    self.assertNotIn(candidate.encode(), raw)
                    self.assertNotIn(hashlib.sha256(candidate.encode()).hexdigest().encode(), raw)

    def test_unrelated_env_and_argv_never_appear_or_change_capability(self):
        secret = 'D2_SECRET_TOKEN_9b3a1a'
        data, raw = self.diagnostic(None, args=['--mcp-config', secret, '--CODEX_HOME=' + secret], extra={
            'MULTICA_TOKEN': secret, 'CODEX_HOME_SECRET': secret, secret: secret,
            'CLAUDE_CONFIG_DIR': secret, 'PWD': secret})
        self.assertEqual(data['read_status'], 'managed_paths_unresolved')
        self.assertEqual(data['argc'], 4)
        self.assertNotIn(secret.encode(), raw)
        self.assertNotIn(hashlib.sha256(secret.encode()).hexdigest().encode(), raw)

    def test_help_and_version_are_static_and_truthful(self):
        for argument in ['--help', '--version']:
            first = self.run_probe('D2_SECRET_VALUE', [argument], extra={'MULTICA_TOKEN': 'D2_SECRET_OTHER'})
            second = self.run_probe(None, [argument], cwd='/private/tmp')
            self.assertEqual(first, second)
            self.assertEqual(first[0], 0)
            self.assertEqual(first[2], b'')
            self.assertIn(b'altera-codex-path-probe 1.0.0', first[1])
            self.assertNotIn(b'D2_SECRET', first[1])
            data, _ = self.diagnostic(None, args=[argument, 'extra'])
            self.assertEqual(data['argc'], 3)

    def test_maximum_candidate_is_not_truncated(self):
        self.assertTrue(self.binary.exists(), 'D2 metadata-only executable is missing')
        workspace = '/' + 'a' * 984
        binary = self.base / 'max-path-probe'
        build = self.compile_probe(binary, workspace, str(self.cwd))
        home = workspace + '/alte-123456789-012345abcdef/codex-home'
        self.assertEqual(len(home), 1024)
        code, stdout, stderr = self.run_probe(home, binary=binary)
        self.assertEqual((code, stdout), (78, b''))
        self.assertLessEqual(len(stderr), 1800)
        data = json.loads(stderr[len(MARKER):])
        self.assertEqual(data['candidate_path'], home)
        self.assertEqual(data['build_sha256'], build['build_sha256'])
        code, stdout, stderr = self.run_probe(home + 'x', binary=binary)
        self.assertEqual((code, stdout), (78, b''))
        self.assertNotIn(b'candidate_path', stderr)

    def test_imports_have_no_file_process_or_network_capability(self):
        self.assertTrue(self.binary.exists(), 'D2 metadata-only executable is missing')
        result = subprocess.run(['/usr/bin/nm', '-u', str(self.binary)], capture_output=True, check=True)
        (self.base / 'imports.txt').write_bytes(result.stdout)
        imports = {line.split()[-1] for line in result.stdout.decode().splitlines() if line.strip()}
        allowed = {'___stack_chk_fail', '___stack_chk_guard', '___stderrp', '___stdoutp',
                   '_getenv', '_getcwd', '_snprintf', '_fwrite', '_fputs', '_puts', '_strncmp', '_memcmp'}
        self.assertTrue(imports <= allowed, imports - allowed)
        self.assertIn('_getenv', imports)
        self.assertIn('_getcwd', imports)

    def compile_control(self, name, source, flags=()):
        path = self.base / (name + '.c')
        path.write_text(source)
        output = self.base / name
        result = subprocess.run([COMPILER, '-isysroot', SDK, '-std=c11', '-Wall', '-Wextra', '-Werror',
                                 *flags, str(path), '-o', str(output)], capture_output=True,
                                env={'PATH': '/usr/bin:/bin', 'HOME': '/var/empty', 'TMPDIR': str(self.base)}, timeout=30)
        (self.base / (name + '-compiler.stdout')).write_bytes(result.stdout)
        (self.base / (name + '-compiler.stderr')).write_bytes(result.stderr)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        return output

    def test_static_probes_skip_the_actual_getenv_call(self):
        self.assertTrue(self.binary.exists(), 'D2 metadata-only executable is missing')
        library = self.compile_control('getenv-control.dylib', r'''
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static char *controlled_getenv(const char *name) {
    if (strcmp(name, "CODEX_HOME") == 0) _exit(91);
    return NULL;
}
__attribute__((used, section("__DATA,__interpose")))
static struct { const void *replacement; const void *original; } binding = {
    (const void *)&controlled_getenv, (const void *)&getenv
};
''', ['-dynamiclib'])
        extra = {'DYLD_INSERT_LIBRARIES': str(library), 'MULTICA_TOKEN': 'D2_SYNTHETIC_SECRET'}
        results = {}
        for flag in ['--help', '--version']:
            result = self.run_probe('D2_SYNTHETIC_SECRET', [flag], extra=extra)
            self.assertEqual((result[0], result[2]), (0, b''))
            results[flag] = {'exit': result[0], 'stdout': result[1].decode(), 'stderr': result[2].decode()}
        control = self.run_probe('D2_SYNTHETIC_SECRET', ['app-server'], extra=extra)
        self.assertEqual(control, (91, b'', b''))
        results['diagnostic_getenv_control_exit'] = control[0]
        (self.base / 'static-getenv-proof.json').write_text(json.dumps(results, indent=2) + '\n')

    def test_build_pins_are_explicit_and_uid_is_only_provenance(self):
        self.assertTrue(self.binary.exists(), 'D2 metadata-only executable is missing')
        self.assertEqual(self.build['uid_provenance_only'], 501)
        module_spec = importlib.util.spec_from_file_location('d2_builder', ROOT / 'build_codex_path_probe.py')
        builder = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(builder)
        for value in ['relative', '/', '/x/', '/x//y', '/x/../y', '/x/./y', '/x/secret value', '/x/"value', '/x/é']:
            with self.assertRaises(ValueError):
                builder.path_pin(value, 1024)
        with self.assertRaises(ValueError):
            builder.build(self.binary, self.workspace, str(self.cwd), 501)
        for uid in [-1, 4294967296, True]:
            with self.assertRaises(ValueError):
                builder.build(self.base / 'invalid-uid', self.workspace, str(self.cwd), uid)
        data, _ = self.diagnostic(self.workspace + '/alte-1-012345abcdef/codex-home')
        self.assertFalse(any('owner' in key or 'uid' in key for key in data))

    def test_real_sandbox_denies_control_operations_and_allows_only_metadata_probe(self):
        self.assertTrue(self.binary.exists(), 'D2 metadata-only executable is missing')
        control = self.compile_control('sandbox-control', r'''
#include <arpa/inet.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char **argv) {
    int fd, wrote, read_file, connected, forked;
    pid_t pid;
    struct sockaddr_in address = {0};
    if (argc != 4) return 2;
    fd = open(argv[1], O_CREAT | O_WRONLY | O_EXCL, 0600);
    wrote = fd >= 0;
    if (fd >= 0) { wrote = write(fd, "fixture", 7) == 7; close(fd); }
    fd = open(argv[2], O_RDONLY);
    read_file = fd >= 0;
    if (fd >= 0) close(fd);
    pid = fork();
    if (pid == 0) _exit(0);
    forked = pid > 0;
    if (pid > 0) waitpid(pid, NULL, 0);
    fd = socket(AF_INET, SOCK_STREAM, 0);
    address.sin_family = AF_INET;
    address.sin_port = htons((unsigned short)atoi(argv[3]));
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    connected = fd >= 0 && connect(fd, (struct sockaddr *)&address, sizeof(address)) == 0;
    if (fd >= 0) close(fd);
    printf("{\"write\":%d,\"read\":%d,\"fork\":%d,\"connect\":%d}\n", wrote, read_file, forked, connected);
    return 0;
}
''')
        unread = self.base / 'unrelated-config-canary'
        unread.write_text('D2_SYNTHETIC_UNREAD_FILE_SECRET')
        policy = self.base / 'sandbox.sb'
        # Как в принятом D1 control: loader может читать только literal directories предков.
        ancestors = ' '.join('(literal ' + json.dumps(str(path)) + ')' for path in [self.base, *self.base.parents])
        policy.write_text('(version 1)\n(deny default)\n(allow sysctl-read)\n(allow file-read-metadata)\n'
            '(allow file-read-data (subpath "/usr/lib") (subpath "/System/Library") '
            + ancestors + ' (literal ' + json.dumps(str(self.binary)) + ') (literal ' + json.dumps(str(control)) + '))\n'
            '(allow process-exec (literal ' + json.dumps(str(self.binary)) + ') (literal ' + json.dumps(str(control)) + '))\n')
        environment = {'PATH': '/usr/bin:/bin', 'HOME': '/var/empty'}
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            port = str(listener.getsockname()[1])
            for name, prefix, expected in [('allowed', [], 1), ('denied', ['/usr/bin/sandbox-exec', '-f', str(policy)], 0)]:
                command = [*prefix, str(control), str(self.base / ('control-' + name)), str(unread), port]
                result = subprocess.run(command, env=environment, capture_output=True, timeout=5)
                (self.base / ('control-' + name + '.stdout')).write_bytes(result.stdout)
                (self.base / ('control-' + name + '.stderr')).write_bytes(result.stderr)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                self.assertEqual(json.loads(result.stdout), dict(write=expected, read=expected, fork=expected, connect=expected))
        home = self.workspace + '/alte-1-012345abcdef/codex-home'
        result = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(policy), str(self.binary), 'app-server'],
            cwd=self.cwd, env={**environment, 'CODEX_HOME': home, 'MULTICA_TOKEN': 'D2_SYNTHETIC_SECRET'},
            input=b'', capture_output=True, timeout=5)
        (self.base / 'sandbox-probe.stdout').write_bytes(result.stdout)
        (self.base / 'sandbox-probe.stderr').write_bytes(result.stderr)
        self.assertEqual((result.returncode, result.stdout), (78, b''), result.stderr.decode())
        data = json.loads(result.stderr[len(MARKER):])
        self.assertEqual(data['candidate_path'], home)
        self.assertEqual(data['read_status'], 'lexical_candidate')
        self.assertTrue(data['cwd_matches_expected'])
        self.assertEqual(unread.read_text(), 'D2_SYNTHETIC_UNREAD_FILE_SECRET')
        self.assertFalse((self.base / 'control-denied').exists())
        (self.base / 'sandbox-proof.json').write_text(json.dumps({'probe_exit': 78, 'control_allowed': 4,
            'control_denied': 4, 'unrelated_file_unchanged': True, 'stdout_empty': True,
            'canonical_identity': 'not_checked'}, indent=2) + '\n')


if __name__ == '__main__':
    unittest.main(verbosity=2)
