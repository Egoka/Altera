"""Только synthetic callbacks и static manifest; Linux syscalls не запускаются."""
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent


def classify(control, candidate):
    for record in (control, candidate):
        if record.get('phase') != 'chroot_result' or record.get('chroot_attempted') != 1:
            return 'probe_setup_unresolved'
        if record['before']['namespace_inode'] == record['after']['namespace_inode']:
            return 'probe_setup_unresolved'
        if record['after']['uid'] != 1000 or record['after']['gid'] != 1000:
            return 'probe_setup_unresolved'
    left = (control.get('return'), control.get('errno'))
    right = (candidate.get('return'), candidate.get('errno'))
    if left == (-1, 1) and right == (0, 0):
        return 'seccomp_hypothesis_confirmed_only'
    if left == (-1, 1) and right == (-1, 1):
        return 'seccomp_only_remedy_falsified'
    if left == (0, 0):
        return 'control_unexpected_success'
    return 'other_errno_or_probe_defect'


class ProbePreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(['/usr/bin/perl', str(ROOT / 'probe.pl'), '--self-test'],
                                capture_output=True, check=True, timeout=5)
        (ROOT / 'synthetic-raw.json').write_bytes(result.stdout)
        (ROOT / 'synthetic-raw.stderr').write_bytes(result.stderr)
        cls.proof = json.loads(result.stdout)

    def test_success_and_errno_are_distinct(self):
        cases = self.proof['cases']
        self.assertEqual((cases['success']['return'], cases['success']['errno']), (0, 0))
        self.assertEqual((cases['eperm']['return'], cases['eperm']['errno']), (-1, 1))
        self.assertEqual(classify(cases['eperm'], cases['success']), 'seccomp_hypothesis_confirmed_only')
        self.assertEqual(classify(cases['eperm'], cases['eperm']), 'seccomp_only_remedy_falsified')
        self.assertEqual(classify(cases['success'], cases['success']), 'control_unexpected_success')
        self.assertEqual(classify(cases['other_errno'], cases['success']), 'other_errno_or_probe_defect')

    def test_setup_failure_never_calls_chroot(self):
        for name in ['mapping_failure', 'unshare_failure']:
            self.assertEqual(self.proof['cases'][name]['chroot_attempted'], 0)
            self.assertEqual(classify(self.proof['cases'][name], self.proof['cases']['success']), 'probe_setup_unresolved')

    def test_fixed_mapping_and_targeted_cleanup_callbacks(self):
        self.assertEqual(self.proof['map_ok'], 1)
        self.assertEqual(self.proof['cleanup'], {'child_pid': 123, 'reaped': 1})
        self.assertEqual(self.proof['synthetic'], 1)

    def test_static_no_executor_and_literal_syscalls(self):
        source = (ROOT / 'probe.pl').read_text()
        self.assertIn('syscall(97, 0x10000000)', source)
        self.assertIn("syscall(51, $literal)", source)
        self.assertIn("my $literal = '/proc/self/fdinfo/'", source)
        for forbidden in ['system(', 'exec(', 'qx(', 'require ', 'use POSIX', 'use JSON']:
            self.assertNotIn(forbidden, source)

if __name__ == '__main__':
    unittest.main()
