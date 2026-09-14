"""Проверки регистрации hooks: прямой чат не наследует очередь Multica."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

import test_gate

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT / 'docs/multica/claude-plugin'


class ChatRoutingTests(unittest.TestCase):
    setUp = test_gate.GateTests.setUp
    write = test_gate.GateTests.write
    git = test_gate.GateTests.git
    cli = test_gate.GateTests.cli
    start = test_gate.GateTests.start

    def stop_commands(self, multica=False):
        settings = json.loads((ROOT / '.claude/settings.json').read_text())
        groups = settings.get('hooks', {}).get('Stop', [])
        if multica:
            groups += json.loads((PLUGIN / 'hooks/hooks.json').read_text())['hooks']['Stop']
        return [h['command'] for g in groups for h in g['hooks']]

    def invoke_stop(self, multica=False):
        for path in ['.claude/hooks/ritual-check.sh', 'scripts/agent-loop/gate.py']:
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / path, target)
        return [subprocess.run(['bash', '-c', command], input='{}', text=True,
                               capture_output=True, env={**os.environ,
                                   'CLAUDE_PROJECT_DIR': str(self.root)})
                for command in self.stop_commands(multica)]

    def test_direct_chat_has_no_multica_stop_even_with_reserved_parent(self):
        self.start()
        self.cli('release', '--actor', 'tester', '--run', 'run-1')
        before = self.cli('status')
        self.assertEqual(self.invoke_stop(), [])
        self.assertEqual(self.cli('status'), before)

    def test_multica_stop_still_rejects_reserved_parent_without_mutation(self):
        self.start()
        self.cli('release', '--actor', 'tester', '--run', 'run-1')
        before = self.cli('status')
        results = self.invoke_stop(multica=True)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].returncode, 2, results[0].stderr)
        self.assertEqual(self.cli('status'), before)

    def test_multica_valid_docs_stop_still_succeeds(self):
        self.cli('docs-only', '--baseline', self.base)
        results = self.invoke_stop(multica=True)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].returncode, 0, results[0].stderr)

    def test_multica_roles_and_commands_are_not_auto_discovered(self):
        for kind in ['agents', 'commands']:
            self.assertEqual(list((ROOT / '.claude' / kind).glob('multica-*.md')), [])
            self.assertTrue(list((PLUGIN / kind).glob('multica-*.md')))


if __name__ == '__main__':
    unittest.main()
