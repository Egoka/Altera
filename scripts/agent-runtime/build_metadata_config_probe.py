#!/usr/bin/python3 -I
"""Сборка D1: trusted canonical root/UID задаёт coordinator, не native env."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

COMPILER = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang'

SDK = '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk'


def build(output, root, uid, alias=''):
    root = root.rstrip('/')
    if not root.startswith('/') or len(root) > 3000 or any(c not in '/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in root):
        raise ValueError('invalid_root_pin')
    if not root or '//' in root or any(p in ('.', '..') for p in root.split('/')):
        raise ValueError('invalid_root_pin')
    if alias and (not root.startswith('/private/var/') or alias != root.removeprefix('/private')):
        raise ValueError('unverified_alias_spelling')
    if uid < 0:
        raise ValueError('invalid_uid_pin')
    source = Path(__file__).with_name('metadata-config-probe.c')
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    pins = {'root': root, 'uid': uid, 'alias': alias, 'source_sha256': source_hash,
            'builder_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'compiler': COMPILER, 'sdk': SDK}
    build_hash = hashlib.sha256(json.dumps(pins, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='altera-d1-build-', dir='/private/tmp') as work:
        header = Path(work) / 'd1-build.h'
        header.write_text('\n'.join([
            '#define D1_ROOT ' + json.dumps(root), '#define D1_ALIAS ' + json.dumps(alias),
            '#define D1_UID ' + str(uid), '#define D1_SOURCE_SHA ' + json.dumps(source_hash),
            '#define D1_BUILD_SHA ' + json.dumps(build_hash)]) + '\n')
        subprocess.run([COMPILER, '-isysroot', SDK, '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
                        '-I', work, str(source), '-o', str(output)], check=True,
                       env={'PATH': '/usr/bin:/bin', 'HOME': '/var/empty', 'TMPDIR': work})
    output.chmod(0o755)
    print(json.dumps({**pins, 'build_sha256': build_hash,
                      'binary': str(output.resolve()), 'binary_sha256': hashlib.sha256(output.read_bytes()).hexdigest()}, sort_keys=True))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--root', required=True)
    parser.add_argument('--uid', required=True, type=int)
    parser.add_argument('--alias', default='')
    args = parser.parse_args()
    build(args.output, args.root, args.uid, args.alias)
