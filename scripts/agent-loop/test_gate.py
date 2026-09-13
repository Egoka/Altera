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


class LifecycleTests(unittest.TestCase):
    write = GateTests.write
    git = GateTests.git
    cli = GateTests.cli
    start = GateTests.start
    record = GateTests.record

    def setUp(self):
        GateTests.setUp(self)
        self.passport['scope'] = ['server', 'docs/status.md']
        self.passport['publication_paths'] = ['docs/status.md']
        self.passport['stages'] = [
            {'name': name, 'kind': kind, 'checks': [{'check_id': name, 'criterion': 'AC-1'}],
             **({'return_to': 'develop'} if name in ('test', 'review') else {})}
            for name, kind in [('plan', 'contract'), ('develop', 'implementation'),
                               ('test', 'verification'), ('review', 'verification')]]
        self.write(self.plan, self.passport)
        self.write('docs/status.md', 'in progress\nRules: retain authorization\n')
        self.git('add', 'docs')
        self.git('commit', '-qm', 'frozen contract')
        self.serial = 0

    def snapshot(self):
        return self.cli('snapshot', '--scope', *self.passport['scope'])

    def begin(self, stage, run=None):
        self.serial += 1
        run = run or stage + '-' + str(self.serial)
        self.start(run=run, actor=stage, stage=stage)
        return run

    def result(self, result='passed', extra=None, ok=True):
        slot = self.cli('status')['slot']
        self.serial += 1
        event = 'check-' + str(self.serial)
        path = GateTests.evidence(self, result=result, run=slot['run'], stage=slot['stage'],
                                  check=slot['stage'], event=event)
        data = json.loads((self.root / path).read_text())
        data['actor'] = slot['actor']
        # Real subprocess output: successful source check or deliberate failing predicate.
        proc = subprocess.run([sys.executable, '-c',
                               'from pathlib import Path; print(Path("server/code.txt").read_text()); '
                               'raise SystemExit(' + ('0' if result == 'passed' else '1') + ')'],
                              cwd=self.root, text=True, capture_output=True)
        self.write(data['output'], proc.stdout + proc.stderr)
        data['command'] = 'python fixture source observation, exit=' + str(proc.returncode)
        data.update(extra or {})
        self.write(path, data)
        self.record(path, event=event, ok=ok)
        return event, path

    def report_pair(self, returned=False, extra=None):
        slot = self.cli('status')['slot']
        data = {'task': 'T-fixture', 'stage': slot['stage'], 'actor': slot['actor'], 'run': slot['run'],
                'baseline_commit': self.base, **self.snapshot(), 'plan': self.plan,
                'evidence': slot['evidence'], 'native_outcome': 'failed' if returned else 'success',
                'stage_outcome': 'returned' if returned else 'completed',
                'task_acceptance': 'return' if returned else 'not_checked'}
        data.update(extra or {})
        self.write(self.report, data)
        self.write('docs/reports/fixture-report.md', '# ' + slot['stage'] + ' ' + slot['run'])
        prefix = 'docs/reports/evidence/fixture/stages/' + slot['stage'] + '/' + slot['run']
        self.write(prefix + '-report.gate.json', (self.root / self.report).read_text())
        self.write(prefix + '-report.md', (self.root / 'docs/reports/fixture-report.md').read_text())
        return data

    def bind(self, ok=True, actor=None, run=None, event=None):
        state = self.cli('status')
        owner = state['slot'] or state['tasks']['T-fixture']['last_owner']
        self.serial += 1
        return self.cli('bind-artifacts', self.plan, '--event', event or 'bind-' + str(self.serial),
                        '--actor', actor or owner['actor'], '--run', run or owner['run'], ok=ok)

    def finish_stage(self, commit=True, ok=True):
        self.report_pair()
        if commit:
            self.git('add', self.plan, self.passport['plan'], self.report,
                     'docs/reports/fixture-report.md', 'docs/reports/evidence/fixture')
            self.git('commit', '-qm', 'immutable stage evidence')
            self.bind()
        return self.cli('finish', self.report, ok=ok)

    def complete(self, stage, change=None):
        self.begin(stage)
        if change:
            self.write('server/code.txt', change)
            self.git('add', 'server/code.txt')
            self.git('commit', '-qm', 'scoped implementation')
        self.result()
        self.finish_stage()

    def source_ready(self):
        self.complete('plan')
        self.complete('develop', 'implementation one\n')
        self.complete('test')

    def return_review(self, ok=True):
        state = self.cli('status')
        slot = state['slot']
        data = self.report_pair(True, {'iteration': state['tasks']['T-fixture']['iteration'],
            'return_to': 'develop', 'failed_events': slot['evidence'],
            'defects': [{'criterion': 'AC-1', 'location': 'server/code.txt', 'detail': 'Observed defect'}],
            'repair_direction': 'Correct scoped source', 'preserved_contract': self.passport['preserved_contract'],
            'failure_counts': {k: v['failures'] for k, v in state['tasks']['T-fixture']['checks']['review'].items()}})
        path = 'docs/reports/evidence/fixture/return-' + slot['run'] + '.json'
        self.write(path, data)
        return self.cli('return', path, '--event', 'return-' + slot['run'], '--actor', slot['actor'],
                        '--run', slot['run'], ok=ok)

    def test_real_plan_source_change_test_review_and_truthful_artifact_binding(self):
        self.source_ready()
        source = self.git('rev-parse', 'HEAD').strip()
        self.begin('review')
        _, path = self.result()
        self.finish_stage()
        self.cli('stop')
        state = self.cli('status')
        self.assertIsNone(state['parent'])
        self.assertEqual(json.loads((self.root / path).read_text())['revision_commit'], source)
        self.assertNotEqual(self.git('rev-parse', 'HEAD').strip(), source)
        self.assertEqual(len(state['tasks']['T-fixture']['current_stages']), 4)

    def test_return_preserves_history_parent_and_counter_then_fresh_pass_resets_only_review(self):
        self.source_ready()
        self.begin('review')
        _, old = self.result('failed')
        old_bytes = (self.root / old).read_bytes()
        self.return_review()
        state = self.cli('status')
        self.assertEqual(state['tasks']['T-fixture']['iteration'], 1)
        self.assertEqual(state['tasks']['T-fixture']['checks']['review']['review']['failures'], 1)
        self.assertIsNotNone(state['parent'])
        self.start(stage='review', actor='review', run='skip-tests', ok=False)
        self.complete('develop', 'fixed implementation\n')
        self.complete('test')
        self.complete('review')
        self.assertEqual((self.root / old).read_bytes(), old_bytes)
        self.assertEqual(self.cli('status')['tasks']['T-fixture']['checks']['review']['review']['failures'], 0)

    def test_two_review_failures_across_iterations_stop_without_reset(self):
        self.source_ready()
        self.begin('review')
        self.result('failed')
        self.return_review()
        self.complete('develop', 'second implementation\n')
        self.complete('test')
        self.begin('review')
        self.result('failed')
        self.return_review(ok=False)
        self.result(ok=False)
        state = self.cli('status')
        self.assertEqual(state['tasks']['T-fixture']['checks']['review']['review']['failures'], 2)
        slot = state['slot']
        self.cli('release', '--actor', slot['actor'], '--run', slot['run'])
        self.start(stage='review', actor='review', run='third', ok=False)

    def test_source_mutation_during_verification_rejects_record_finish_stop(self):
        self.source_ready()
        self.begin('review')
        self.result()
        self.report_pair()
        self.write('server/code.txt', 'unauthorized new source')
        self.result(ok=False)
        self.cli('finish', self.report, ok=False)
        self.cli('stop', ok=False)

    def test_bind_rejects_foreign_owner_duplicate_and_nonartifact_commits(self):
        self.complete('plan')
        self.bind(actor='foreign', ok=False)
        self.begin('develop')
        self.result()
        self.report_pair()
        self.git('add', 'docs/reports')
        self.git('commit', '-qm', 'artifacts')
        self.bind(event='one-bind')
        self.bind(event='one-bind', ok=False)
        self.write('docs/foreign.md', 'not this task artifact')
        self.git('add', 'docs/foreign.md')
        self.git('commit', '-qm', 'forbidden docs')
        before = self.cli('status')
        self.bind(ok=False)
        self.assertEqual(before, self.cli('status'))

    def test_archive_tampering_and_legacy_state_fail_closed(self):
        self.complete('plan')
        archive = next((self.root / 'docs/reports/evidence/fixture/stages/plan').glob('*-report.md'))
        archive.write_text('tampered')
        self.start(stage='develop', actor='develop', run='next', ok=False)
        state_path = self.root / '.git/agent-loop/state.json'
        old = json.loads(state_path.read_text())
        old['version'] = 2
        state_path.write_text(json.dumps(old))
        raw = state_path.read_bytes()
        self.cli('status', ok=False)
        self.assertEqual(state_path.read_bytes(), raw)

    def publications(self):
        for name, kind in [('docs', 'publication'), ('docs-check', 'verification'),
                           ('release', 'verification'), ('docs-finalize', 'publication'),
                           ('completion-check', 'verification')]:
            self.passport['stages'].append({'name': name, 'kind': kind,
                'checks': [{'check_id': name, 'criterion': 'AC-1'}]})
        self.write(self.plan, self.passport)
        self.git('add', self.plan)
        self.git('commit', '-qm', 'declare complete lifecycle')

    def publish(self, stage, text):
        self.begin(stage)
        self.write('docs/status.md', text + '\nRules: retain authorization\n')
        self.git('add', 'docs/status.md')
        self.git('commit', '-qm', 'metadata publication')
        self.result()
        self.finish_stage()

    def docs_result(self, verdict='supported_metadata', ok=True):
        state = self.cli('status')
        relation = state['tasks']['T-fixture']['pending_publication']
        self.result(extra={'publication_review': {'relation': relation, 'verdict': verdict,
                    'preserved_contract': True}}, ok=ok)

    def test_publication_release_finalization_retains_parent_and_separate_source_proof(self):
        self.publications()
        self.source_ready()
        self.complete('review')
        self.publish('docs', 'source accepted; release pending')
        self.begin('docs-check')
        self.docs_result()
        self.finish_stage()
        self.complete('release')
        self.publish('docs-finalize', 'completed proposal')
        self.begin('completion-check')
        self.docs_result()
        self.report_pair()
        self.cli('finish', self.report, ok=False)  # final archives must be committed
        other = GateTests.other_passport(self)
        self.cli('start', other, '--stage', 'plan', '--actor', 'other', '--run', 'other', ok=False)
        self.finish_stage()
        self.assertIsNone(self.cli('status')['parent'])
        self.cli('stop')

    def test_publication_rejects_source_drift_and_unaccepted_rules(self):
        self.publications()
        self.source_ready()
        self.complete('review')
        self.publish('docs', 'source accepted; release pending')
        self.begin('docs-check')
        self.docs_result('rules_changed', ok=False)
        self.write('server/code.txt', 'source drift')
        self.docs_result(ok=False)
        self.cli('stop', ok=False)

    def test_failed_release_cannot_finalize(self):
        self.publications()
        self.source_ready()
        self.complete('review')
        self.publish('docs', 'release pending')
        self.begin('docs-check')
        self.docs_result()
        self.finish_stage()
        self.begin('release')
        self.result('failed')
        self.finish_stage(ok=False)
        slot = self.cli('status')['slot']
        self.cli('release', '--actor', slot['actor'], '--run', slot['run'])
        self.start(stage='docs-finalize', actor='docs-finalize', run='premature', ok=False)

    def stopped(self):
        self.source_ready()
        for number in (1, 2):
            self.begin('review')
            observation = 'docs/reports/evidence/fixture/environment-' + str(number) + '.txt'
            self.write(observation, 'dependency unavailable')
            event, _ = self.result('failed', {'cause': {'name': 'dependency unavailable',
                'condition': 'dependency available', 'observation': observation}})
            slot = self.cli('status')['slot']
            self.cli('release', '--actor', slot['actor'], '--run', slot['run'])
        return event, slot

    def recover(self, stop, old_slot, event='recovery-1', modifications=None, ok=True):
        observation = 'docs/reports/evidence/fixture/remediated.txt'
        self.write(observation, 'dependency independently observed available')
        data = {'task': 'T-fixture', 'stage': 'review', 'check_id': 'review', 'stop_event': stop,
                'old_run': old_slot['run'], 'actor': 'controller', 'run': event,
                'baseline_commit': self.base, **self.snapshot(), 'failures': 2,
                'cause': 'dependency unavailable', 'condition': 'dependency available',
                'remediation': observation, 'confirmer': 'independent-operator',
                'condition_removed': True, 'old_run_stopped': True, 'no_live_duplicate': True,
                'q_resolved': True, 'conflict_free': True, 'next_operation': 'review'}
        data.update(modifications or {})
        path = 'docs/reports/evidence/fixture/' + event + '.json'
        self.write(path, data)
        return self.cli('recover', path, '--event', event, '--actor', 'controller', '--run', event, ok=ok)

    def test_recovery_requires_new_confirmed_conditions_and_preserves_counters(self):
        stop, slot = self.stopped()
        before = self.cli('status')
        for field in ('condition_removed', 'old_run_stopped', 'no_live_duplicate', 'q_resolved', 'conflict_free'):
            self.recover(stop, slot, modifications={field: False}, ok=False)
            self.assertEqual(before, self.cli('status'))
        self.recover(stop, slot)
        self.assertEqual(self.cli('status')['tasks']['T-fixture']['checks']['review']['review']['failures'], 2)
        self.result()
        self.finish_stage()
        self.assertEqual(self.cli('status')['tasks']['T-fixture']['checks']['review']['review']['failures'], 0)

    def test_failed_recovery_immediately_stops_at_three_and_cannot_reuse_remedy(self):
        stop, slot = self.stopped()
        self.recover(stop, slot)
        self.result('failed')
        state = self.cli('status')
        self.assertEqual(state['tasks']['T-fixture']['checks']['review']['review']['failures'], 3)
        self.result(ok=False)
        active = state['slot']
        self.cli('release', '--actor', active['actor'], '--run', active['run'])
        self.recover(stop, slot, event='recovery-2', ok=False)

    def test_source_repair_cannot_resurrect_stale_prerequisites_for_recovery(self):
        stop, slot = self.stopped()
        self.write('server/code.txt', 'claimed repair outside implementation')
        self.git('add', 'server/code.txt')
        self.git('commit', '-qm', 'unsupported source remedy')
        self.recover(stop, slot, ok=False)
        self.assertEqual(self.cli('status')['tasks']['T-fixture']['checks']['review']['review']['failures'], 2)


    def test_binding_rejects_checked_inputs_dirty_renames_symlinks_and_unrelated_head(self):
        self.source_ready()
        checkpoint = self.git('rev-parse', 'HEAD').strip()
        for path in ('server/code.txt', 'config.json', 'scripts/check.py', 'docs/status.md',
                     'docs/plans/fixture.md'):
            with self.subTest(path=path):
                self.write(path, 'changed checked input')
                self.git('add', path)
                self.git('commit', '-qm', 'inadmissible binding')
                before = self.cli('status')
                self.bind(ok=False)
                self.assertEqual(before, self.cli('status'))
                self.git('reset', '--hard', checkpoint)
        self.write('server/code.txt', 'changed dirty source')
        self.bind(ok=False)
        self.git('reset', '--hard', checkpoint)
        archive = next((self.root / 'docs/reports/evidence/fixture/stages/plan').glob('*-report.md'))
        archive.unlink()
        archive.symlink_to(self.root / 'server/code.txt')
        self.bind(ok=False)
        self.git('reset', '--hard', checkpoint)
        self.git('mv', str(archive.relative_to(self.root)), 'docs/moved.md')
        self.git('commit', '-qm', 'cross-boundary rename')
        self.bind(ok=False)
        self.git('reset', '--hard', checkpoint)
        tree = self.git('rev-parse', 'HEAD^{tree}').strip()
        unrelated = self.git('commit-tree', tree, '-m', 'unrelated root').strip()
        self.git('reset', '--hard', unrelated)
        self.bind(ok=False)
        self.git('reset', '--hard', checkpoint)

    def test_return_rejects_wrong_owner_foreign_events_and_replay_atomically(self):
        self.source_ready()
        run = self.begin('review')
        self.result('failed')
        before = self.cli('status')
        self.cli('return', 'docs/reports/evidence/fixture/missing.json', '--event', 'foreign',
                 '--actor', 'foreign', '--run', run, ok=False)
        self.assertEqual(before, self.cli('status'))
        self.return_review()
        after = self.cli('status')
        path = 'docs/reports/evidence/fixture/return-' + run + '.json'
        self.cli('return', path, '--event', 'return-' + run, '--actor', 'review', '--run', run, ok=False)
        self.assertEqual(after, self.cli('status'))
        other = GateTests.other_passport(self)
        self.cli('start', other, '--stage', 'plan', '--actor', 'other', '--run', 'other', ok=False)
        self.assertEqual(after, self.cli('status'))

    def test_frozen_lifecycle_passport_rejects_even_byte_only_rewrite(self):
        self.begin('plan')
        (self.root / self.plan).write_text(json.dumps(self.passport, indent=2))
        self.result(ok=False)

    def test_malformed_v3_counters_and_history_are_rejected_without_reset(self):
        self.begin('plan')
        state_path = self.root / '.git/agent-loop/state.json'
        original = json.loads(state_path.read_text())
        for key, value in [('history', []), ('checks', {'plan': {'plan': {'failures': -1}}})]:
            state = json.loads(json.dumps(original))
            if key == 'history':
                del state['tasks']['T-fixture']['history']
            else:
                state['tasks']['T-fixture'][key] = value
            state_path.write_text(json.dumps(state))
            raw = state_path.read_bytes()
            self.cli('status', ok=False)
            self.assertEqual(raw, state_path.read_bytes())

    def test_unknown_recovery_result_cannot_grant_second_execution(self):
        stop, slot = self.stopped()
        self.recover(stop, slot)
        self.result('not_run')
        self.result(ok=False)
        self.cli('finish', self.report, ok=False)


if __name__ == '__main__':
    unittest.main()
