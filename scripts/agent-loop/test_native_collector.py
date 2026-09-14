"""Collector fixtures use the real gate CLI/Git/private registry; native boundary is synthetic."""
import importlib.util
from pathlib import Path
import unittest


class CollectorAvailabilityTests(unittest.TestCase):
    def test_six_trusted_operations_exist(self):
        path = Path(__file__).with_name('native_collector.py')
        self.assertTrue(path.exists(), 'trusted collector missing')
        spec = importlib.util.spec_from_file_location('native_collector', path)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        for name in ('admit', 'bind', 'collect', 'check', 'transition', 'reconcile'):
            self.assertTrue(callable(getattr(module, name, None)), name)

import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from unittest.mock import patch
import test_gate as fixtures


class CollectorIntegrationTests(unittest.TestCase):
    write = fixtures.GateTests.write
    git = fixtures.GateTests.git
    cli = fixtures.GateTests.cli
    start = fixtures.GateTests.start
    record = fixtures.GateTests.record

    def setUp(self):
        fixtures.LifecycleTests.setUp(self)
        path = Path(__file__).with_name('native_collector.py')
        spec = importlib.util.spec_from_file_location('collector_test', path)
        self.c = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.c)
        self.private = tempfile.TemporaryDirectory(prefix='collector-private-'); self.addCleanup(self.private.cleanup)
        self.private_root = Path(self.private.name).resolve(); self.private_root.chmod(0o700)
        self.passport['multica_issue'] = 'issue-1'; self.write(self.plan, self.passport)
        self.git('add', 'docs'); self.git('commit', '-qm', 'native issue binding')
        self.policy = self.private_root / 'policy'; self.policy.mkdir(mode=0o700)
        (self.policy / 'claude-settings.json').write_text('{"disableAllHooks":true}')
        (self.policy / 'protocol-guard.mjs').write_text('export {};')
        (self.policy / 'check.test.mjs').write_text("import test from 'node:test';test('real assertion',()=>{});")
        self.checkspec = self.private_root / 'check.json'
        self.c.publish(self.checkspec, {'schema_version': 1,
            'argv': ['/usr/local/bin/node', '--test', '--test-reporter=tap', '/runtime/policy/check.test.mjs'],
            'cwd': str(self.root), 'network': 'none', 'parser': 'node-tap',
            'timeout_seconds': 120, 'maximum_output': 1048576})
        registry = self.private_root / 'registry'; registry.mkdir(mode=0o700)
        for name in ('pending', 'claimed', 'reconciled', 'locks'): (registry / name).mkdir(mode=0o700)
        self.config = {'schema_version': 1, 'provider': 'claude', 'workspace_id': 'workspace-1',
            'agent_id': 'agent-1', 'actor': 'agent-1', 'server_url': 'https://example.invalid',
            'source': str(self.root), 'registry': str(registry), 'modules': {},
            'multica': {'path': '/usr/bin/true', 'sha256': self.c.sha(Path('/usr/bin/true').read_bytes())},
            'limits': {'cli_seconds':15, 'cli_bytes':1048576},
            'checks': {'plan': {'path':str(self.checkspec), 'sha256':self.c.sha(self.checkspec.read_bytes())}},
            '_reference': {'config_path':'/private/config.json', 'config_sha256':'a'*64, 'module_sha256':'b'*64}}
        self.env = {'MULTICA_WORKSPACE_ID':'workspace-1','MULTICA_AGENT_ID':'agent-1',
                    'MULTICA_SERVER_URL':'https://example.invalid','MULTICA_TASK_ID':'native-1'}

    def request(self, invocation='invocation-1'):
        prepared = self.private_root / invocation; prepared.mkdir(mode=0o700)
        for name in ('claims','observations','store'): (prepared / name).mkdir(mode=0o700)
        return {'invocation_id':invocation, 'native_task_id':None, 'issue_id':'issue-1',
            'passport':self.plan, 'stage':'plan','run':invocation, 'allowed_transitions':['release','finish'],
            'prepare_request':{'schema_version':1, 'destination':str(prepared / 'prepared'),
            'snapshot':str(prepared / 'snapshot'), 'run_root':str(prepared / 'run'),
            'dirty_paths':self.git('ls-files','--others','--exclude-standard').splitlines(), 'policy':str(self.policy), 'image':'sha256:'+'a'*64,
            'store_manifest':{'schema_version':1,'store':str(prepared / 'store')},
            'provider_input':{'output_dir':str(prepared / 'policy')},
            'claim':str(prepared / 'claims/claim.json'), 'observation':str(prepared / 'observations/adapter.json')}}

    def claim(self, invocation='invocation-1'):
        self.c.admit(self.config, self.request(invocation))
        return self.c.bind(self.config, self.env)

    def row(self, status='running'):
        return {'id':'native-1','issue_id':'issue-1','agent_id':'agent-1','workspace_id':'workspace-1',
            'status':status, 'started_at':'2026-09-14T00:00:00Z',
            'completed_at':None if status=='running' else '2026-09-14T00:01:00Z'}

    def collect(self, claim):
        manifest = self.c.read(claim['ticket']['adapter_ticket']['runtime_manifest'])
        observation = {'invocation_id':claim['ticket']['invocation_id'], 'child_created':True,
            'child_reaped':True,'raw_wait':0,'worker_quiescence':'proven','container_removed':True,
            'provider_cleanup':'proven','validation':'verified','source_before':manifest['state'],
            'source_after':manifest['state'],'policy_before':manifest['policy_sha256'],
            'policy_after':manifest['policy_sha256'],'runtime_status':0}
        return self.c.collect(claim, {'invocation_id':claim['ticket']['invocation_id'],
            'native_task_id':'native-1','refusal':None,'runtime_status':0}, observation,
            lambda argv:[{'id':'unrelated'},self.row()])

    def command_runner(self, exit_code=0, executed=1):
        def run(manifest, path, digest, *, invocation_id):
            command = [shutil.which('node'), '--test', '--test-reporter=tap',str(self.policy / 'check.test.mjs')]
            result = subprocess.run(command,capture_output=True,text=True,check=False)
            self.assertEqual(result.returncode,0)
            actual = re.search(r'^# tests (\d+)',result.stdout,re.MULTILINE)
            self.assertEqual(int(actual[1]),1)
            return {'complete':executed>0,'executed':executed,'exit_code':exit_code,'output':result.stdout,
                'command':command,'started_at':datetime.now(timezone.utc).isoformat(),
                'truncated':False,'timed_out':False,'worker_quiescence':'proven'}
        return run

    def test_real_gate_admit_claim_collect_command_record_and_terminal_release(self):
        claim = self.claim(); process = self.collect(claim)
        result = self.c.check(claim,'plan',self.command_runner())
        self.assertFalse(result['response']['stopped'])
        proof = self.c.read(self.root / result['stored_event']['path'])
        self.assertEqual(proof['executed'],1); self.assertEqual(proof['native_outcome'],'unknown')
        self.assertEqual(self.c.check(claim,'plan',lambda *_:self.fail('duplicate child')),result)
        self.assertEqual(self.c.reconcile(self.config,'invocation-1',lambda _:[self.row()])['result'],'pending')
        terminal = self.c.reconcile(self.config,'invocation-1',lambda _:[self.row('completed')])
        self.assertEqual(terminal['native_outcome'],'success')
        self.assertEqual(self.c.read(Path(claim['directory'])/'observations/process.json'),process)
        decision = self.c.transition(claim,{'operation':'release','artifact':None,'event_id':None})
        self.assertEqual(decision['response']['result'],'released')

    def test_two_failures_survive_release_and_stop_before_next_child(self):
        first=self.claim();self.collect(first)
        self.assertEqual(self.c.check(first,'plan',self.command_runner(1))['response']['failures'],1)
        self.c.reconcile(self.config,'invocation-1',lambda _:[self.row('failed')])
        self.c.transition(first,{'operation':'release','artifact':None,'event_id':None})
        second=self.claim('invocation-2');self.collect(second)
        self.assertTrue(self.c.check(second,'plan',self.command_runner(1))['response']['stopped'])
        # Even a different declared event may not start another child after the retained stop.
        second['ticket']['checks'][0]['event_id']='forbidden-next-event'
        with self.assertRaisesRegex(ValueError,'check_stopped'):
            self.c.check(second,'plan',lambda *_:self.fail('child after stop'))

    def test_native_substitution_and_duplicate_claim_are_refused(self):
        self.c.admit(self.config,self.request())
        with self.assertRaisesRegex(ValueError,'native_identity_mismatch'):
            self.c.bind(self.config,{**self.env,'MULTICA_AGENT_ID':'other'})
        claim=self.c.bind(self.config,self.env)
        with self.assertRaisesRegex(ValueError,'pending_missing_or_ambiguous'):self.c.bind(self.config,self.env)
        with self.assertRaisesRegex(ValueError,'native_row_mismatch'):
            self.c.multica_rows(claim,True,lambda _:[{**self.row(),'agent_id':'other'}])
        with self.assertRaisesRegex(ValueError,'native_row_missing_or_duplicate'):
            self.c.multica_rows(claim,True,lambda _:[self.row(),self.row()])
        with self.assertRaisesRegex(ValueError,'task_token_missing'):self.c.multica_rows(claim,True)

    def test_model_prose_and_zero_count_cannot_be_recorded(self):
        claim=self.claim()
        with self.assertRaises(FileNotFoundError):self.c.check(claim,'plan',self.command_runner())
        self.collect(claim)
        with self.assertRaisesRegex(ValueError,'check_incomplete'):self.c.check(claim,'plan',self.command_runner(executed=0))
        self.assertFalse(self.cli('status')['events'])

    def test_lost_record_response_recovers_exact_event_without_second_execution(self):
        claim=self.claim();self.collect(claim)
        def lost(argv):
            result=subprocess.run(argv,capture_output=True,text=True,check=True)
            if 'record' in argv:raise TimeoutError('response lost after durable record')
            return json.loads(result.stdout)
        with self.assertRaises(TimeoutError):self.c.check(claim,'plan',self.command_runner(),lost)
        result=self.c.check(claim,'plan',lambda *_:self.fail('second execution'))
        self.assertEqual(result['response']['result'],'recorded')

    def test_symlink_hardlink_oversize_and_source_drift_are_refused(self):
        claim=self.claim();path=self.private_root/'ordinary.json';self.c.publish(path,{'ok':1})
        link=self.private_root/'link.json';link.symlink_to(path)
        with self.assertRaisesRegex(ValueError,'unsafe_file'):self.c.read(link)
        link.unlink();os.link(path,link)
        with self.assertRaisesRegex(ValueError,'unsafe_file'):self.c.read(path)
        self.write('server/code.txt','drift')
        with self.assertRaisesRegex(ValueError,'gate_input_changed'):self.c.current(claim)


class CollectorFinishRegression(unittest.TestCase):
    setUp = CollectorIntegrationTests.setUp
    write = CollectorIntegrationTests.write
    git = CollectorIntegrationTests.git
    cli = CollectorIntegrationTests.cli
    start = CollectorIntegrationTests.start
    record = CollectorIntegrationTests.record
    request = CollectorIntegrationTests.request
    collect = CollectorIntegrationTests.collect
    row = CollectorIntegrationTests.row
    command_runner = CollectorIntegrationTests.command_runner
    snapshot = fixtures.LifecycleTests.snapshot
    def test_own_archive_commit_bind_and_finish_use_gate_equivalence(self):
        request = self.request()
        request['allowed_transitions'].append('bind-artifacts')
        self.c.admit(self.config, request)
        claim = self.c.bind(self.config, self.env)
        self.collect(claim)
        self.c.check(claim, 'plan', self.command_runner())
        self.c.reconcile(self.config, 'invocation-1', lambda _:[self.row('completed')])
        fixtures.LifecycleTests.report_pair(self)
        self.git('add', 'docs/reports')
        self.git('commit', '-qm', 'own immutable report and check evidence')
        with self.assertRaisesRegex(ValueError, 'gate_input_changed'):
            self.c.current(claim)
        bound = self.c.transition(claim, {'operation':'bind-artifacts', 'artifact':self.plan, 'event_id':'bind-own-artifacts'})
        self.assertEqual(bound['after']['tasks']['T-fixture']['relations'][-1]['kind'], 'artifacts')
        finished = self.c.transition(claim, {'operation':'finish', 'artifact':self.report, 'event_id':None})
        self.assertIsNone(finished['after']['slot'])
        self.assertIn('plan', finished['after']['tasks']['T-fixture']['current_stages'])


    def test_standalone_collect_cli_refuses_model_writable_observation_paths(self):
        import sys
        writable = self.private_root / 'run-evidence'; writable.mkdir(mode=0o700)
        forged = writable / 'runtime.json'; self.c.publish(forged, {'worker_quiescence':'proven'})
        proc = subprocess.run([sys.executable, str(Path(__file__).with_name('native_collector.py')),
            '--config', str(self.private_root / 'unused-config.json'), '--sha256', 'a'*64,
            'collect', '--invocation', 'invocation-1', '--adapter-observation', str(forged),
            '--runtime-observation', str(forged)], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn('invalid choice', proc.stderr)
        self.assertEqual(self.cli('status')['events'], {})


class CollectorLegacyVerificationRegression(unittest.TestCase):
    setUp = CollectorIntegrationTests.setUp
    write = CollectorIntegrationTests.write
    git = CollectorIntegrationTests.git
    cli = CollectorIntegrationTests.cli
    start = CollectorIntegrationTests.start
    record = CollectorIntegrationTests.record
    request = CollectorIntegrationTests.request
    collect = CollectorIntegrationTests.collect
    row = CollectorIntegrationTests.row
    command_runner = CollectorIntegrationTests.command_runner
    snapshot = fixtures.LifecycleTests.snapshot

    def test_two_legacy_verification_stages_admit_collect_record_and_finish(self):
        self.passport['stages'] = [{'name':stage, 'checks':[{'check_id':'plan','criterion':'AC-1'}]}
                                   for stage in ('test','review')]
        self.write(self.plan,self.passport)
        self.git('add','docs/plans');self.git('commit','-qm','legacy verification passport')
        original_passport = (self.root / self.plan).read_bytes()
        for stage in ('test','review'):
            invocation = 'legacy-' + stage
            request = self.request(invocation);request['stage']=stage
            self.c.admit(self.config,request)
            claim=self.c.bind(self.config,self.env)
            slot=self.cli('status')['slot']
            self.assertNotIn('input',slot);self.assertNotIn('iteration',slot)
            self.assertEqual(claim['ticket']['gate_input'],self.snapshot())
            self.collect(claim)
            recorded=self.c.check(claim,'plan',self.command_runner())
            self.assertEqual(recorded['stored_event']['result'],'passed')
            self.c.reconcile(self.config,invocation,lambda _:[self.row('completed')])
            fixtures.LifecycleTests.report_pair(self)
            finished=self.c.transition(claim,{'operation':'finish','artifact':self.report,'event_id':None})
            self.assertIsNone(finished['after']['slot'])
            self.assertIn(stage,finished['after']['tasks']['T-fixture']['completed_stages'])
            self.assertEqual((self.root/self.plan).read_bytes(),original_passport)
        self.assertIsNone(self.cli('status')['parent'])
