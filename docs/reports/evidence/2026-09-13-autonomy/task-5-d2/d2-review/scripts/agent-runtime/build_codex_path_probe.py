#!/usr/bin/python3 -I
"""Сборка D2 с явными trusted pins; native environment не задаёт полномочия."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

COMPILER = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang'
SDK = '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk'


def path_pin(value, limit):
    if (not isinstance(value, str) or not value.startswith('/') or value.endswith('/') or
        len(value) > limit or '//' in value or any(part in ('.', '..') for part in value.split('/')) or
        any(char not in '/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.' for char in value)):
        raise ValueError('invalid_path_pin')
    return value


def build(output, root, cwd, uid):
    root, cwd = path_pin(root, 993), path_pin(cwd, 1024)
    if not isinstance(uid, int) or isinstance(uid, bool) or not 0 <= uid <= 4294967295:
        raise ValueError('invalid_uid_pin')
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('output_already_exists')
    source = Path(__file__).with_name('codex-path-probe.c')
    digest = lambda data: hashlib.sha256(data).hexdigest()
    pins = {'root': root, 'expected_cwd': cwd, 'uid_provenance_only': uid,
            'source_sha256': digest(source.read_bytes()), 'builder_sha256': digest(Path(__file__).read_bytes()),
            'compiler': COMPILER, 'sdk': SDK,
            'flags': ['-std=c11', '-Wall', '-Wextra', '-Werror', '-O2']}
    build_hash = digest(json.dumps(pins, sort_keys=True, separators=(',', ':')).encode())
    with tempfile.TemporaryDirectory(prefix='altera-d2-build-', dir='/private/tmp') as work:
        header = Path(work) / 'd2-build.h'
        header.write_text('\n'.join([
            '#define D2_ROOT ' + json.dumps(root), '#define D2_CWD ' + json.dumps(cwd),
            '#define D2_SOURCE_SHA ' + json.dumps(pins['source_sha256']),
            '#define D2_BUILD_SHA ' + json.dumps(build_hash)]) + '\n')
        invocation = [COMPILER, '-isysroot', SDK, *pins['flags'], '-I', work, str(source), '-o', str(output)]
        subprocess.run(invocation, check=True,
                       env={'PATH': '/usr/bin:/bin', 'HOME': '/var/empty', 'TMPDIR': work})
    output.chmod(0o755)
    print(json.dumps({**pins, 'build_sha256': build_hash, 'invocation': invocation,
                      'compiler_tmpdir_private': True, 'binary': str(output.resolve()),
                      'binary_sha256': digest(output.read_bytes())}, sort_keys=True))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--root', required=True)
    parser.add_argument('--cwd', required=True)
    parser.add_argument('--uid', required=True, type=int)
    arguments = parser.parse_args()
    build(arguments.output, arguments.root, arguments.cwd, arguments.uid)
