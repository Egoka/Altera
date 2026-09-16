import unittest

import multica_guard as g


class MulticaGuardTests(unittest.TestCase):
    def test_issue_create_gets_canonical_project(self):
        self.assertEqual(
            g.guarded_args(["issue", "create", "--title", "Task"], "project"),
            ["issue", "create", "--title", "Task", "--project", "project"],
        )

    def test_matching_explicit_project_is_preserved(self):
        args = ["issue", "create", "--project=project", "--title", "Task"]
        self.assertEqual(g.guarded_args(args, "project"), args)

    def test_different_project_is_rejected(self):
        with self.assertRaises(ValueError):
            g.guarded_args(["issue", "create", "--project", "other", "--title", "Task"], "project")

    def test_other_commands_are_unchanged(self):
        args = ["issue", "list", "--project", "project"]
        self.assertEqual(g.guarded_args(args, "project"), args)


if __name__ == "__main__":
    unittest.main()
