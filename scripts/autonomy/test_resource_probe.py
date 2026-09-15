import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from resource_probe import measure_resources


class ResourceProbeTests(unittest.TestCase):
    def test_counts_logical_bytes_once_and_excludes_symlink_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "root"
            root.mkdir()
            outside = Path(directory) / "outside"
            outside.mkdir()
            (outside / "private").write_bytes(b"outside" * 100)
            source = root / "file"
            source.write_bytes(b"abcd")
            os.link(source, root / "hardlink")
            (root / "outside-link").symlink_to(outside, target_is_directory=True)
            (root / "file-link").symlink_to(outside / "private")
            result = measure_resources([root, root])
            self.assertEqual(result["status"], "ok")
            self.assertEqual(result["logical_bytes"], 4)
            self.assertEqual(result["files"], 1)
            self.assertIsNone(result["reclaimed_bytes"])
            self.assertTrue(result["measured_at"].endswith("+00:00"))

    def test_missing_and_symlink_roots_are_unknown_and_mixed_roots_partial(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "root"
            root.mkdir()
            (root / "file").write_bytes(b"abc")
            missing = Path(directory) / "missing"
            link = Path(directory) / "link"
            link.symlink_to(root, target_is_directory=True)
            for roots, status in [([missing], "unknown"), ([link], "unknown"), ([root, missing], "partial")]:
                result = measure_resources(roots)
                self.assertEqual(result["status"], status)
                self.assertIsNone(result["logical_bytes"])
                self.assertTrue(result["errors"])
                self.assertNotIn(str(directory), str(result))

    def test_entry_limit_and_deadline_never_report_partial_sum_as_total(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "one").write_bytes(b"one")
            (root / "two").write_bytes(b"two")
            result = measure_resources([root], max_entries=1)
            self.assertEqual(result["status"], "partial")
            self.assertIsNone(result["logical_bytes"])
            self.assertIn("entry_limit", result["errors"])
            with patch("resource_probe.time.monotonic", side_effect=[0, 2]):
                result = measure_resources([root], timeout_seconds=1)
            self.assertEqual(result["status"], "unknown")
            self.assertIsNone(result["logical_bytes"])
            self.assertIn("deadline", result["errors"])


if __name__ == "__main__":
    unittest.main()
