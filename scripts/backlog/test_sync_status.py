import unittest

import sync_status as s

PRS = [{"number": 60, "title": "T-087: request id", "headRefName": "server/t087-request-id",
        "mergeCommit": {"oid": "64c47488aaaaaaaa"}}]


def issue(identifier, status, task="T-087"):
    return {"identifier": identifier, "status": status, "title": f"{task}: задача", "number": int(identifier[5:])}


def decide(status, rows, task_id="T-087", questions=None):
    return s.decide({"id": task_id, "status": status}, rows, PRS, questions or {})[0]


class DecideTest(unittest.TestCase):
    def test_in_review_with_merged_pr_stays_in_progress(self):
        self.assertEqual(decide("зависит: T-086", [issue("ALTE-32", "in_review")]),
                         "в работе (влита PR #60, merge 64c47488; ждёт приёмки ALTE-32)")

    def test_done_becomes_finished_with_evidence(self):
        self.assertEqual(decide("зависит: T-086", [issue("ALTE-32", "done")]),
                         "завершена (PR #60, merge 64c47488; приёмка ALTE-32)")

    def test_open_owner_question_is_named(self):
        self.assertEqual(decide("решение владельца: Q-04", [issue("ALTE-32", "in_review")], questions={"T-087": ["Q-04"]}),
                         "в работе (влита PR #60, merge 64c47488; ждёт приёмки ALTE-32; реализована при открытом Q-04)")

    def test_finished_in_file_is_not_downgraded(self):
        status = decide("завершена", [issue("ALTE-32", "in_review")])
        self.assertTrue(status.startswith("завершена (PR #60"))

    def test_generated_finished_is_recomputed_after_review(self):
        status = "завершена (PR #60, merge 64c47488; приёмка записана в файле, ALTE-32 в Multica — in_review)"
        self.assertEqual(decide(status, [issue("ALTE-32", "done")]),
                         "завершена (PR #60, merge 64c47488; приёмка ALTE-32)")

    def test_manual_finished_note_is_kept(self):
        status = "завершена по AC-1 (merge 52910e46, PR #52); AC-2 перенесён в T-076"
        self.assertEqual(decide(status, [issue("ALTE-32", "done")]), status)

    def test_blocked_keeps_file_status(self):
        self.assertIsNone(decide("решение владельца: Q-09", [issue("ALTE-102", "blocked")]))

    def test_stage_subissues_are_not_acceptance(self):
        rows = [issue("ALTE-19", "done"), dict(issue("ALTE-31", "done"), title="T-087 стадия 4b: ревью")]
        self.assertIn("приёмка ALTE-19", decide("кандидат", rows))


if __name__ == "__main__":
    unittest.main()
