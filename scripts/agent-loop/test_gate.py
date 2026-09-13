"""Интеграционные fixtures CLI: настоящие файлы, Git и отдельные процессы."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

GATE = Path(__file__).with_name('gate.py')
HOOK = Path(__file__).resolve().parents[2] / '.claude/hooks/ritual-check.sh'


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'Fixture')
        self.write('server/code.txt', 'baseline\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'baseline')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.plan = 'docs/plans/fixture.gate.json'
        self.report = 'docs/reports/fixture-report.gate.json'
        self.passport = {
            'task': 'T-fixture', 'multica_issue': 'not_applicable', 'goal': 'Fixture contract',
            'contract_sources': ['docs/development/artifact-contracts.md'],
            'baseline_commit': self.base, 'baseline_tree': 'clean', 'scope': ['server'],
            'preserved_contract': 'Unrelated files', 'dependencies': [],
            'authorization': 'Owner fixture request', 'acceptance': {'AC-1': 'Checked output'},
            'unknowns': [], 'plan': 'docs/plans/fixture.md',
            'report': self.report, 'stages': [
                {'name': 'test', 'checks': [{'check_id': 'unit', 'criterion': 'AC-1'}]},
                {'name': 'review', 'checks': [{'check_id': 'review', 'criterion': 'AC-1'}]},
            ],
        }
        self.write('docs/plans/fixture.md', '# Fixture plan\n')
        self.write(self.plan, self.passport)

    def write(self, path, data):
        dest = self.root / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(data) if isinstance(data, (dict, list)) else data)
        return dest

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True)

    def cli(self, *args, ok=True):
        proc = subprocess.run([sys.executable, str(GATE), '--root', str(self.root), *args],
                              text=True, capture_output=True)
        self.assertEqual(proc.returncode, 0 if ok else 2, proc.stdout + proc.stderr)
        return json.loads(proc.stdout)

    def start(self, run='run-1', actor='tester', stage='test', ok=True):
        return self.cli('start', self.plan, '--stage', stage, '--actor', actor, '--run', run, ok=ok)

    def snapshot(self):
        return self.cli('snapshot', '--scope', 'server')

    def evidence(self, result='passed', run='run-1', check='unit', stage='test', event='event-1'):
        snap = self.snapshot()
        output = 'docs/reports/evidence/fixture/' + event + '.txt'
        trace = 'docs/reports/evidence/fixture/' + event + '-trace.txt'
        self.write(output, '1 test ' + result)
        self.write(trace, 'sanitized CLI invocation and result')
        evidence = {
            'task': 'T-fixture', 'stage': stage, 'run': run, 'actor': 'tester',
            'criterion': 'AC-1', 'check_id': check, 'baseline_commit': self.base,
            **snap, 'cwd': str(self.root), 'environment': 'Python fixture',
            'command': 'fixture-check', 'started_at': '2026-09-13T12:00:00+03:00',
            'exit_code': 0 if result == 'passed' else 1, 'executed': 1,
            'result': result, 'output': output, 'trace_ref': trace,
            'limits': 'Does not establish semantic acceptance',
        }
        path = 'docs/reports/evidence/fixture/' + event + '.json'
        self.write(path, evidence)
        return path

    def record(self, path, event='event-1', ok=True):
        return self.cli('record', path, '--event', event, ok=ok)

    def finish(self, run='run-1', ok=True, stage='test'):
        state = self.cli('status')
        report = {
            'task': 'T-fixture', 'stage': stage, 'actor': 'tester', 'run': run,
            'baseline_commit': self.base, **self.snapshot(),
            'plan': self.plan, 'evidence': state['slot']['evidence'],
            'native_outcome': 'success', 'stage_outcome': 'completed',
            'task_acceptance': 'not_checked',
        }
        self.write('docs/reports/fixture-report.md', '# Fixture report: ' + stage + '\n')
        self.write(self.report, report)
        return self.cli('finish', self.report, ok=ok)

    # Ловит обход: отсутствующий gate разрешает продуктовый Stop, включая повторный.
    def test_hook_repeated_stop_does_not_bypass_missing_passport(self):
        self.write('server/code.txt', 'changed')
        for active in [False, True]:
            proc = subprocess.run(['bash', str(HOOK)], input=json.dumps({'stop_hook_active': active}),
                                  env={**os.environ, 'CLAUDE_PROJECT_DIR': str(self.root),
                                       'PYTHONDONTWRITEBYTECODE': '1'}, text=True, capture_output=True)
            self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)

    # Ловит обход: отсутствие baseline скрывает уже закоммиченные продуктовые изменения.
    def test_docs_only_requires_explicit_baseline_and_rejects_committed_product(self):
        self.cli('stop', ok=False)
        self.cli('docs-only', '--baseline', self.base)
        self.cli('stop')
        self.write('server/code.txt', 'changed')
        self.git('add', 'server/code.txt')
        self.git('commit', '-qm', 'change')
        self.cli('docs-only', '--baseline', self.base, ok=False)
        self.cli('stop', ok=False)

    # Ловит потерю парности артефактов и привязки к фактической ревизии.
    def test_supported_flow_checks_committed_and_dirty_revision(self):
        self.write('server/code.txt', 'committed')
        self.git('add', 'server/code.txt')
        self.git('commit', '-qm', 'change')
        self.write('server/new.txt', 'dirty')
        self.start()
        self.record(self.evidence())
        self.finish()
        self.cli('stop')
        self.write('server/new.txt', 'new dirty')
        self.cli('stop', ok=False)

    # Ловит исключение committed/untracked изменений из разрешённого scope.
    def test_scope_cannot_omit_product_changes(self):
        self.passport['scope'] = ['server/code.txt']
        self.write(self.plan, self.passport)
        self.write('web/omitted.txt', 'committed')
        self.git('add', 'web/omitted.txt')
        self.git('commit', '-qm', 'omitted')
        self.start(ok=False)
        self.git('revert', '--no-edit', 'HEAD')
        self.write('web/untracked.txt', 'untracked')
        self.start(ok=False)

    # Ловит второе владение общим slot другим процессом, run или задачей.
    def test_global_slot_and_run_replay_rejected(self):
        self.start()
        self.start(ok=False)
        self.start(run='run-2', ok=False)
        self.cli('release', '--actor', 'intruder', '--run', 'run-1', ok=False)
        self.cli('release', '--actor', 'tester', '--run', 'run-1')
        self.start(ok=False)
        self.start(run='run-2')

    # Ловит сброс двух реальных неуспехов перезапуском процесса или новым run.
    def test_two_failures_stop_stable_check_across_runs(self):
        self.start()
        self.record(self.evidence('failed'))
        self.cli('release', '--actor', 'tester', '--run', 'run-1')
        self.start(run='run-2')
        self.record(self.evidence('failed', run='run-2', event='event-2'), event='event-2')
        self.cli('release', '--actor', 'tester', '--run', 'run-2')
        self.start(run='run-3', ok=False)
        state = self.cli('status')
        self.assertEqual(state['tasks']['T-fixture']['checks']['test']['unit']['failures'], 2)
        self.assertEqual(len(state['events']), 2)

    # Ловит двойной учёт неуспеха при повторной доставке evidence.
    def test_duplicate_event_rejected_without_mutation(self):
        self.start()
        path = self.evidence('failed')
        self.record(path)
        before = self.cli('status')
        self.record(path, ok=False)
        self.assertEqual(before, self.cli('status'))

    # Ловит сброс чужих счётчиков успехом или учёт ожидаемого RED как неуспеха исправления.
    def test_success_resets_own_counter_and_expected_red_is_success(self):
        self.start()
        self.record(self.evidence('failed'))
        path = self.evidence(event='event-2')
        record = json.loads((self.root / path).read_text())
        record['exit_code'] = 1
        record['expected_exit_code'] = 1
        record['purpose'] = 'tdd_red'
        self.write(path, record)
        self.record(path, event='event-2')
        state = self.cli('status')
        self.assertEqual(state['tasks']['T-fixture']['checks']['test']['unit']['failures'], 1)
        self.finish(ok=False)  # Ожидаемый RED не доказывает успешную итоговую реализацию.
        self.record(self.evidence(event='event-3'), event='event-3')
        self.assertEqual(self.cli('status')['tasks']['T-fixture']['checks']['test']['unit']['failures'], 0)

    # Ловит переход стадии или запись устаревшего evidence после изменения кода.
    def test_stale_evidence_and_output_tampering_rejected(self):
        self.start()
        path = self.evidence()
        self.write('server/code.txt', 'changed')
        self.record(path, ok=False)
        self.record(self.evidence(event='event-2'), event='event-2')
        self.write('docs/reports/evidence/fixture/event-2.txt', 'tampered')
        self.finish(ok=False)

    # Ловит подмену текущих stage/run/actor/check.
    def test_wrong_stage_actor_and_unknown_check_rejected(self):
        self.start(stage='review', ok=False)
        self.start()
        for key, value in [('stage', 'review'), ('actor', 'other'), ('run', 'other'),
                           ('check_id', 'invented'), ('criterion', 'AC-2'), ('task', 'T-other')]:
            path = self.evidence(event=key)
            data = json.loads((self.root / path).read_text())
            data[key] = value
            self.write(path, data)
            self.record(path, event=key, ok=False)
        self.finish(ok=False)

    # Ловит подстановку чужого плана/отчёта или изменённого паспорта.
    def test_missing_foreign_or_modified_plan_report_rejected(self):
        (self.root / 'docs/plans/fixture.md').unlink()
        self.start(ok=False)
        self.write('docs/plans/fixture.md', '# Restored')
        self.start()
        self.record(self.evidence())
        self.cli('finish', 'docs/reports/foreign-report.gate.json', ok=False)
        self.passport['task'] = 'T-foreign'
        self.write(self.plan, self.passport)
        self.finish(ok=False)

    # Ловит подстановку внешнего evidence через ../, абсолютный путь или symlink.
    def test_paths_and_symlink_evidence_rejected(self):
        self.start()
        path = self.evidence()
        data = json.loads((self.root / path).read_text())
        outside = Path(self.temp.name).parent / ('outside-' + self.root.name)
        outside.write_text('not evidence')
        self.addCleanup(outside.unlink)
        for bad in ['../' + outside.name, str(outside), 'server/code.txt']:
            data['output'] = bad
            self.write(path, data)
            self.record(path, ok=False)
        link = self.root / 'docs/reports/evidence/fixture/link'
        link.symlink_to(outside)
        data['output'] = str(link.relative_to(self.root))
        self.write(path, data)
        self.record(path, ok=False)

    # Ловит молчаливое принятие занятого lock или повреждённого state за новую стадию.
    def test_lock_and_corrupt_state_fail_closed(self):
        self.start()
        directory = self.root / '.git/agent-loop'
        (directory / 'lock').mkdir()
        self.cli('release', '--actor', 'tester', '--run', 'run-1', ok=False)
        (directory / 'lock').rmdir()
        (directory / 'state.json').write_text('{broken')
        self.cli('stop', ok=False)
        self.start(run='run-2', ok=False)

    # Ловит отдельный slot в связанном worktree, допускающий второго writer.
    def test_linked_worktrees_share_slot(self):
        self.start()
        second = self.root / 'linked'
        self.git('worktree', 'add', '-qb', 'fixture-linked', str(second))
        proc = subprocess.run([sys.executable, str(GATE), '--root', str(second), 'status'],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)['slot']['run'], 'run-1')


    # Ловит переход новой ревизии на ревью по устаревшим проверкам предыдущей стадии.
    def test_stage_handoff_rejects_stale_prior_revision(self):
        self.start()
        self.record(self.evidence())
        self.finish()
        self.write('server/code.txt', 'changed after test')
        self.start(run='review-1', actor='reviewer', stage='review', ok=False)

    # Ловит исчезновение человеческого отчёта после приёмки машинных метаданных.
    def test_paired_human_report_required_and_pinned(self):
        self.start()
        self.record(self.evidence())
        self.finish()
        (self.root / 'docs/reports/fixture-report.md').unlink()
        self.cli('stop', ok=False)
        self.write('docs/reports/fixture-report.md', '# Substituted report')
        self.cli('stop', ok=False)

    # Ловит подмену парного каталога evidence допустимым путём от другой задачи.
    def test_foreign_evidence_directory_rejected(self):
        self.start()
        path = self.evidence()
        data = json.loads((self.root / path).read_text())
        foreign = 'docs/reports/evidence/foreign/check.json'
        self.write(foreign, data)
        self.record(foreign, ok=False)

    # Ловит приёмку нуля тестов или внутренне противоречивого результата.
    def test_malformed_check_result_rejected_without_state_change(self):
        self.start()
        for key, value in [('executed', 0), ('exit_code', 1), ('started_at', 7)]:
            path = self.evidence(event=key)
            data = json.loads((self.root / path).read_text())
            data[key] = value
            self.write(path, data)
            before = self.cli('status')
            self.record(path, event=key, ok=False)
            self.assertEqual(before, self.cli('status'))

    # Ловит сброс неуспеха проверки A успехом B, допускающий бесконечные повторы.
    def test_success_preserves_other_check_failure_count(self):
        self.passport['stages'][0]['checks'].append({'check_id': 'other', 'criterion': 'AC-1'})
        self.write(self.plan, self.passport)
        self.start()
        self.record(self.evidence('failed'))
        self.record(self.evidence(check='other', event='other'), event='other')
        counters = self.cli('status')['tasks']['T-fixture']['checks']['test']
        self.assertEqual(counters['unit']['failures'], 1)
        self.assertEqual(counters['other']['failures'], 0)

    # Ловит одновременное получение пустого slot двумя конкурентными start.
    def test_concurrent_acquisition_has_exactly_one_owner(self):
        command = [sys.executable, str(GATE), '--root', str(self.root), 'start', self.plan,
                   '--stage', 'test', '--actor', 'tester', '--run']
        procs = [subprocess.Popen(command + [run], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                 for run in ['race-1', 'race-2']]
        results = [(p.communicate(), p.returncode) for p in procs]
        self.assertEqual(sorted(code for _, code in results), [0, 2])
        state = self.cli('status')
        self.assertEqual(len(state['runs']), 1)
        self.assertEqual(state['slot']['run'], state['runs'][0])


    # Ловит объявленный критерий приёмки без проверки в обязательных стадиях.
    def test_uncovered_criterion_and_malformed_passport_rejected(self):
        self.passport['acceptance']['AC-2'] = 'No check covers this criterion'
        self.write(self.plan, self.passport)
        self.start(ok=False)
        del self.passport['acceptance']['AC-2']
        self.passport['contract_sources'] = []
        self.write(self.plan, self.passport)
        self.start(ok=False)


    # Ловит подмену вывода предыдущей стадии после finish перед началом ревью.
    def test_stage_handoff_revalidates_prior_evidence(self):
        self.start()
        self.record(self.evidence())
        self.finish()
        self.write('docs/reports/evidence/fixture/event-1.txt', 'substituted output')
        self.start(run='review-1', actor='reviewer', stage='review', ok=False)


    def other_passport(self):
        other = json.loads(json.dumps(self.passport))
        other.update({'task': 'T-other', 'plan': 'docs/plans/other.md',
                      'report': 'docs/reports/other-report.gate.json'})
        self.write('docs/plans/other.md', '# Other plan')
        self.write('docs/plans/other.gate.json', other)
        return 'docs/plans/other.gate.json'

    def review_start(self):
        self.start()
        self.record(self.evidence())
        self.finish()
        self.start(run='review-1', stage='review')

    # Ловит передачу product parent другой задаче между обязательными стадиями.
    def test_parent_reservation_survives_finish_until_all_stages_complete(self):
        self.write('server/code.txt', 'product change')
        self.start()
        self.record(self.evidence())
        self.finish()
        other = self.other_passport()
        before = self.cli('status')
        self.cli('start', other, '--stage', 'test', '--actor', 'other', '--run', 'other-1', ok=False)
        self.assertEqual(before, self.cli('status'))
        self.start(run='review-1', stage='review')
        self.record(self.evidence(run='review-1', stage='review', check='review', event='review-1'),
                    event='review-1')
        self.finish(run='review-1', stage='review')
        self.cli('start', other, '--stage', 'test', '--actor', 'other', '--run', 'other-1')

    # Ловит сброс parent при release и стирание failures при возобновлении той же цепочки.
    def test_parent_reservation_survives_release_and_resume_preserves_failures(self):
        self.start()
        self.record(self.evidence('failed'))
        self.cli('release', '--actor', 'tester', '--run', 'run-1')
        other = self.other_passport()
        self.cli('start', other, '--stage', 'test', '--actor', 'other', '--run', 'other-1', ok=False)
        self.cli('docs-only', '--baseline', self.base, ok=False)
        self.start(run='run-2')
        self.assertEqual(self.cli('status')['tasks']['T-fixture']['checks']['test']['unit']['failures'], 1)
        self.record(self.evidence('failed', run='run-2', event='event-2'), event='event-2')
        self.cli('release', '--actor', 'tester', '--run', 'run-2')
        self.start(run='run-3', ok=False)

    # Ловит запись новой ревизии review после start при устаревшей тестовой стадии.
    def test_prerequisites_rechecked_at_record_after_review_start(self):
        self.review_start()
        self.write('server/code.txt', 'changed after review start')
        before = self.cli('status')
        self.record(self.evidence(run='review-1', stage='review', check='review', event='review-1'),
                    event='review-1', ok=False)
        self.assertEqual(before, self.cli('status'))

    # Ловит подмену предыдущего evidence после start даже при той же ревизии.
    def test_prerequisite_output_rechecked_at_record(self):
        self.review_start()
        self.write('docs/reports/evidence/fixture/event-1.txt', 'substituted prior output')
        self.record(self.evidence(run='review-1', stage='review', check='review', event='review-1'),
                    event='review-1', ok=False)

    # Ловит finish и активный Stop при подменённом выводе предыдущей стадии.
    def test_prerequisites_rechecked_at_finish_and_active_stop(self):
        self.review_start()
        self.record(self.evidence(run='review-1', stage='review', check='review', event='review-1'),
                    event='review-1')
        self.write('docs/reports/evidence/fixture/event-1.txt', 'substituted prior output')
        self.finish(run='review-1', stage='review', ok=False)
        self.cli('stop', ok=False)

    # Ловит принятие Stop после завершения цепочки с изменённым prior-stage evidence.
    def test_prerequisites_rechecked_at_completed_stop(self):
        self.review_start()
        self.record(self.evidence(run='review-1', stage='review', check='review', event='review-1'),
                    event='review-1')
        self.finish(run='review-1', stage='review')
        self.cli('stop')
        self.write('docs/reports/evidence/fixture/event-1.txt', 'substituted prior output')
        self.cli('stop', ok=False)


if __name__ == '__main__':
    unittest.main()
