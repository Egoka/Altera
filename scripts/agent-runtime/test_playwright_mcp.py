"""Синтетические проверки закреплённого Playwright runtime без модели."""
import hashlib
import copy
import importlib.util
import json
import re
import http.server
import os
import shutil
import subprocess
import sys
import threading
import tempfile
import time
import uuid
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent

def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

SAVED_TOOL_SCHEMAS = {'browser_type': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'properties': {'element': {'description': 'Human-readable element description used to obtain permission to interact with the element', 'type': 'string'}, 'target': {'type': 'string', 'description': 'Exact target element reference from the page snapshot, or a unique element selector'}, 'text': {'type': 'string', 'description': 'Text to type into the element'}, 'submit': {'description': 'Whether to submit entered text (press Enter after)', 'type': 'boolean'}, 'slowly': {'description': 'Whether to type one character at a time. Useful for triggering key handlers in the page. By default entire text is filled in at once.', 'type': 'boolean'}}, 'required': ['target', 'text'], 'additionalProperties': False}, 'browser_take_screenshot': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'properties': {'element': {'description': 'Human-readable element description used to obtain permission to interact with the element', 'type': 'string'}, 'target': {'description': 'Exact target element reference from the page snapshot, or a unique element selector', 'type': 'string'}, 'type': {'description': 'Image format for the screenshot. If unset, inferred from the filename extension, otherwise png.', 'type': 'string', 'enum': ['png', 'jpeg', 'webp']}, 'filename': {'description': 'File name to save the screenshot to. Defaults to `page-{timestamp}.{png|jpeg|webp}` if not specified. Prefer relative file names to stay within the output directory.', 'type': 'string'}, 'fullPage': {'description': 'When true, takes a screenshot of the full scrollable page, instead of the currently visible viewport. Cannot be used with element screenshots.', 'type': 'boolean'}, 'scale': {'default': 'css', 'description': 'Image resolution scale. "css" produces a screenshot sized in CSS pixels (smaller, consistent across devices). "device" produces a high-resolution screenshot using device pixels (larger, accounts for the device pixel ratio). Default is css.', 'type': 'string', 'enum': ['css', 'device']}}, 'required': ['scale'], 'additionalProperties': False}, 'browser_click': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'properties': {'element': {'description': 'Human-readable element description used to obtain permission to interact with the element', 'type': 'string'}, 'target': {'type': 'string', 'description': 'Exact target element reference from the page snapshot, or a unique element selector'}, 'doubleClick': {'description': 'Whether to perform a double click instead of a single click', 'type': 'boolean'}, 'button': {'description': 'Button to click, defaults to left', 'type': 'string', 'enum': ['left', 'right', 'middle']}, 'modifiers': {'description': 'Modifier keys to press', 'type': 'array', 'items': {'type': 'string', 'enum': ['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift']}}}, 'required': ['target'], 'additionalProperties': False}}

SAVED_SNAPSHOT_RESPONSE = {'content': [{'type': 'text', 'text': '### Page\n- Page URL: http://altera-web:3000/\n- Page Title: Altera synthetic\n### Snapshot\n- [Snapshot](../runtime/evidence/playwright/page-2026-09-14T08-44-00-471Z.yml)'}]}
SAVED_SNAPSHOT_YAML = '- generic [active] [ref=e1]:\n  - heading "ALTERA_PLAYWRIGHT_CANARY" [level=1] [ref=e2]\n  - link "Continue" [ref=e3] [cursor=pointer]:\n    - /url: /form'

SAVED_FORM_RESPONSE = {'content': [{'type': 'text', 'text': '### Page\n- Page URL: http://altera-web:3000/form\n- Page Title: Form\n### Snapshot\n- [Snapshot](../runtime/evidence/playwright/page-2026-09-14T09-29-07-217Z.yml)'}]}
SAVED_EMPTY_ACTION = {'content': [{'type': 'text', 'text': ''}]}
SAVED_FORM_YAML = '- generic [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - text: Name\n    - textbox "Name" [ref=f1e4]\n  - button "Submit" [ref=f1e5]'

SAVED_PROCESS_ROWS = {'observer': {'pid': 'self', 'argv': [], 'errors': [], 'starttime': '24790037', 'fields': {'Uid': '1000\t1000\t1000\t1000', 'Gid': '1000\t1000\t1000\t1000', 'NSpid': '7', 'CapInh': '0000000000000000', 'CapPrm': '0000000000000000', 'CapEff': '0000000000000000', 'CapBnd': '0000000000000000', 'CapAmb': '0000000000000000', 'NoNewPrivs': '1', 'Seccomp': '2', 'Seccomp_filters': '1'}, 'uid_map': '         0          0 4294967295\n', 'gid_map': '         0          0 4294967295\n', 'user_namespace': {'value': 'user:[4026531837]'}}, 'rows': [{'pid': '32', 'argv': ['/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell', '--disable-field-trial-config', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-back-forward-cache', '--disable-breakpad', '--disable-client-side-phishing-detection', '--disable-component-extensions-with-background-pages', '--disable-component-update', '--no-default-browser-check', '--disable-default-apps', '--disable-dev-shm-usage', '--disable-edgeupdater', '--disable-extensions', '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion', '--enable-features=CDPScreenshotNewSurface', '--allow-pre-commit-input', '--disable-hang-monitor', '--disable-ipc-flooding-protection', '--disable-popup-blocking', '--disable-prompt-on-repost', '--disable-renderer-backgrounding', '--disable-updater-scheduler', '--force-color-profile=srgb', '--metrics-recording-only', '--no-first-run', '--password-store=basic', '--use-mock-keychain', '--no-service-autorun', '--export-tagged-pdf', '--disable-search-engine-choice-screen', '--unsafely-disable-devtools-self-xss-warnings', '--edge-skip-compat-layer-relaunch', '--disable-infobars', '--disable-search-engine-choice-screen', '--disable-sync', '--enable-unsafe-swiftshader', '--headless', '--hide-scrollbars', '--mute-audio', '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4', '--disable-blink-features=AutomationControlled', '--user-data-dir=/runtime/tmp/playwright_chromiumdev_profile-4KDDzl', '--remote-debugging-pipe', '--no-startup-window'], 'errors': [], 'starttime': '24790142', 'fields': {'Uid': '1000\t1000\t1000\t1000', 'Gid': '1000\t1000\t1000\t1000', 'NSpid': '32', 'CapInh': '0000000000000000', 'CapPrm': '0000000000000000', 'CapEff': '0000000000000000', 'CapBnd': '0000000000000000', 'CapAmb': '0000000000000000', 'NoNewPrivs': '1', 'Seccomp': '2', 'Seccomp_filters': '1'}, 'uid_map': '         0          0 4294967295\n', 'gid_map': '         0          0 4294967295\n', 'user_namespace': {'value': 'user:[4026531837]'}}, {'pid': '35', 'argv': ['/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell --type=zygote --no-zygote-sandbox --headless'], 'errors': [], 'starttime': '24790145', 'fields': {'Uid': '1000\t1000\t1000\t1000', 'Gid': '1000\t1000\t1000\t1000', 'NSpid': '35', 'CapInh': '0000000000000000', 'CapPrm': '0000000000000000', 'CapEff': '0000000000000000', 'CapBnd': '0000000000000000', 'CapAmb': '0000000000000000', 'NoNewPrivs': '1', 'Seccomp': '2', 'Seccomp_filters': '1'}, 'uid_map': '         0          0 4294967295\n', 'gid_map': '         0          0 4294967295\n', 'user_namespace': {'value': 'user:[4026531837]'}}, {'pid': '36', 'argv': ['/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell --type=zygote --headless'], 'errors': [], 'starttime': '24790145', 'fields': {'Uid': '1000\t1000\t1000\t1000', 'Gid': '1000\t1000\t1000\t1000', 'NSpid': '36\t1', 'CapInh': '0000000000000000', 'CapPrm': '0000000000000000', 'CapEff': '0000000000000000', 'CapBnd': '000001ffffffffff', 'CapAmb': '0000000000000000', 'NoNewPrivs': '1', 'Seccomp': '2', 'Seccomp_filters': '1'}, 'uid_map': '      1000       1000          1\n', 'gid_map': '      1000       1000          1\n', 'user_namespace': {'value': 'user:[4026535659]'}}, {'pid': '38', 'argv': ['/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell --type=zygote --headless'], 'errors': [], 'starttime': '24790146', 'fields': {'Uid': '1000\t1000\t1000\t1000', 'Gid': '1000\t1000\t1000\t1000', 'NSpid': '38\t3', 'CapInh': '0000000000000000', 'CapPrm': '0000000000200000', 'CapEff': '0000000000200000', 'CapBnd': '000001ffffffffff', 'CapAmb': '0000000000000000', 'NoNewPrivs': '1', 'Seccomp': '2', 'Seccomp_filters': '1'}, 'uid_map': '      1000       1000          1\n', 'gid_map': '      1000       1000          1\n', 'user_namespace': {'value': 'user:[4026535659]'}}, {'pid': '54', 'argv': ['/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell --type=gpu-process --disable-dev-shm-usage --disable-breakpad --headless --ozone-platform=headless --use-angle=swiftshader-webgl --enable-unsafe-swiftshader --gpu-preferences=YAAAAAAAAAAgAAAEAAAAAAAAAAAAAGAASAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAACAAAAAAAA'], 'errors': [], 'starttime': '24790147', 'fields': {'Uid': '1000\t1000\t1000\t1000', 'Gid': '1000\t1000\t1000\t1000', 'NSpid': '54', 'CapInh': '0000000000000000', 'CapPrm': '0000000000000000', 'CapEff': '0000000000000000', 'CapBnd': '0000000000000000', 'CapAmb': '0000000000000000', 'NoNewPrivs': '1', 'Seccomp': '2', 'Seccomp_filters': '1'}, 'uid_map': '         0          0 4294967295\n', 'gid_map': '         0          0 4294967295\n', 'user_namespace': {'value': 'user:[4026531837]'}}, {'pid': '73', 'argv': ['/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US --service-sandbox-type=none --disable-dev-shm-usage --use-angle=swiftshader-webgl --use-gl=angle --mute-audio --headless=old --shared-files=v8_context_snapshot_data:100 --field-trial-handle=3,i,17905413727812230093,8369023344363284317,262144 --enable-features=CDPScreenshotNewSurface --disable-features=AutoDeElevate,AvoidUnnecessaryBeforeUnloadCheckSync,BlockOriginHeaderModificationOnRedirect,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,OptimizationHints,PaintHolding,ThirdPartyStoragePartitioning,Translate,msEdgeUpdateLaunchServicesPreferredVersion,msForceBrowserSignIn --variations-seed-version --pseudonymization-salt-handle=7,i,6199143251911370035,5957414092429795204,4 --trace-process-track-uuid=3190708989122997041'], 'errors': [], 'starttime': '24790164', 'fields': {'Uid': '1000\t1000\t1000\t1000', 'Gid': '1000\t1000\t1000\t1000', 'NSpid': '73', 'CapInh': '0000000000000000', 'CapPrm': '0000000000000000', 'CapEff': '0000000000000000', 'CapBnd': '0000000000000000', 'CapAmb': '0000000000000000', 'NoNewPrivs': '1', 'Seccomp': '2', 'Seccomp_filters': '1'}, 'uid_map': '         0          0 4294967295\n', 'gid_map': '         0          0 4294967295\n', 'user_namespace': {'value': 'user:[4026531837]'}}, {'pid': '94', 'argv': ['/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell --type=renderer --headless=old --disable-dev-shm-usage --disable-back-forward-cache --disable-background-timer-throttling --disable-breakpad --force-color-profile=srgb --remote-debugging-pipe --allow-pre-commit-input --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --ozone-plat'], 'errors': [], 'starttime': '24790167', 'fields': {'Uid': '1000\t1000\t1000\t1000', 'Gid': '1000\t1000\t1000\t1000', 'NSpid': '94\t4\t1', 'CapInh': '0000000000000000', 'CapPrm': '0000000000000000', 'CapEff': '0000000000000000', 'CapBnd': '000001ffffffffff', 'CapAmb': '0000000000000000', 'NoNewPrivs': '1', 'Seccomp': '2', 'Seccomp_filters': '2'}, 'uid_map': '      1000       1000          1\n', 'gid_map': '      1000       1000          1\n', 'user_namespace': {'value': 'user:[4026535659]'}}], 'scanErrors': []}

class PlaywrightStaticTests(unittest.TestCase):
    def test_locked_four_package_closure_and_build(self):
        package = json.loads((ROOT / 'playwright-mcp/package.json').read_text())
        lock = json.loads((ROOT / 'playwright-mcp/package-lock.json').read_text())
        self.assertEqual(lock['lockfileVersion'], 3)
        self.assertEqual(package['engines'], {'node': '24.12.0', 'npm': '11.6.2'})
        self.assertEqual(set(package['dependencies']), {'@playwright/mcp', 'playwright', 'playwright-core', '@playwright/browser-chromium'})
        self.assertEqual(set(lock['packages']), {''} | {'node_modules/' + name for name in package['dependencies']})
        for name, version in package['dependencies'].items():
            entry = lock['packages']['node_modules/' + name]
            self.assertEqual(version, '0.0.80' if name == '@playwright/mcp' else '1.63.0-alpha-2026-08-31')
            self.assertEqual(entry['version'], version)
            self.assertTrue(entry['integrity'].startswith('sha512-'))
            self.assertNotIn('optionalDependencies', entry)
        dockerfile = (ROOT / 'Dockerfile').read_text()
        self.assertIn('npm ci --omit=dev --ignore-scripts', dockerfile)
        self.assertIn('install chromium --only-shell', dockerfile)
        self.assertIn('install-deps chromium', dockerfile)
        self.assertNotIn('npx', dockerfile)
        self.assertIn('RUN chmod -R a+rX /ms-playwright', dockerfile)
        self.assertTrue(dockerfile.index('USER 1000:1000') > dockerfile.index('install chromium'))

    def test_canary_requests_match_saved_real_schema_and_denials_are_specific(self):
        source = (ROOT / 'playwright-mcp-canary.mjs').read_text()
        if "mode === 'contract'" in source:
            command = ['/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node', str(ROOT / 'playwright-mcp-canary.mjs'), 'contract']
            proof = json.loads(subprocess.check_output(command, env={'PATH': '/usr/bin:/bin'}, timeout=5))
            requests = proof['requests']
        else:
            # RED читает действительные literal requests, не исполняя browser ветку на host.
            requests = []
            for line in source.splitlines():
                match = re.search(r"call\('(browser_click|browser_type|browser_take_screenshot)', \{(.*?)\}", line)
                if match:
                    arguments = {key: ('css' if key == 'scale' else 'png' if key == 'type' else 'synthetic') for key in re.findall(r'(\w+):', match.group(2))}
                    requests.append({'name': match.group(1), 'arguments': arguments})
        self.assertGreaterEqual(len(requests), 7)
        for request in requests:
            schema = SAVED_TOOL_SCHEMAS[request['name']]; args = request['arguments']
            self.assertTrue(set(schema['required']) <= set(args), request)
            self.assertTrue(set(args) <= set(schema['properties']), request)
            for key, value in args.items():
                self.assertIsInstance(value, str)
                if 'enum' in schema['properties'][key]:
                    self.assertIn(value, schema['properties'][key]['enum'])
        self.assertEqual(proof['denials'], {'readonly': True, 'policy_path': True, 'schema_error': False,
            'schema_with_errno': False, 'generic_failure': False, 'other_path': False, 'not_error': False})

    def test_snapshot_observation_uses_saved_artifact_and_rejects_unsafe_reads(self):
        source = (ROOT / 'playwright-mcp-canary.mjs').read_text()
        if "mode === 'snapshot-contract'" not in source:
            # RED проверяет фактическую прежнюю text-функцию без запуска browser branch.
            expression = re.search(r"const text = (.*)\n", source).group(1)
            script = 'const text = ' + expression + '; console.log(text(' + json.dumps(SAVED_SNAPSHOT_RESPONSE) + '))'
            observed = subprocess.check_output(['/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node', '-e', script], text=True)
            self.assertIn('ALTERA_PLAYWRIGHT_CANARY', observed)
            return
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp).resolve(); evidence = base / 'playwright'; evidence.mkdir()
            filename = 'page-2026-09-14T08-44-00-471Z.yml'
            (evidence / filename).write_text(SAVED_SNAPSHOT_YAML)
            (base / 'outside.yml').write_text('OUTSIDE_MUST_NOT_BE_READ')
            (evidence / 'link.yml').symlink_to(base / 'outside.yml')
            (evidence / 'oversized.yml').write_bytes(b'x' * (1024 * 1024 + 1))
            (evidence / 'limit.yml').write_text(SAVED_SNAPSHOT_YAML + ' ' * (1024 * 1024 - len(SAVED_SNAPSHOT_YAML.encode())))
            (evidence / 'empty.yml').touch()
            os.mkfifo(evidence / 'fifo.yml')
            (evidence / 'directory.yml').mkdir()
            (evidence / 'invalid.yml').write_bytes(b'\xff')
            os.link(evidence / filename, evidence / 'hardlink.yml')
            # Отдельный regular fixture сохраняет nlink=1 для positive observation.
            (evidence / filename).unlink(); (evidence / filename).write_text(SAVED_SNAPSHOT_YAML)
            os.link(evidence / 'hardlink.yml', base / 'hardlink-other.yml')
            def linked(target):
                return {'content': [{'type': 'text', 'text': '### Page\n- Page URL: http://altera-web:3000/\n- Page Title: Altera synthetic\n### Snapshot\n- [Snapshot](' + target + ')'}]}
            prefix = '../runtime/evidence/playwright/'
            cases = [{'name': 'saved', 'result': SAVED_SNAPSHOT_RESPONSE},
                     {'name': 'inline', 'result': {'content': [{'type': 'text', 'text': '### Page\n- Page URL: http://altera-web:3000/\n- Page Title: Altera synthetic\n' + SAVED_SNAPSHOT_YAML}]}},
                     {'name': 'absolute', 'result': linked('/runtime/evidence/playwright/' + filename)},
                     {'name': 'limit', 'result': linked(prefix + 'limit.yml')}]
            for name, target in [('missing', prefix + 'missing.yml'), ('escape', prefix + '../outside.yml'),
                ('sibling', '../runtime/evidence/playwright-other/outside.yml'), ('symlink', prefix + 'link.yml'),
                ('oversized', prefix + 'oversized.yml'), ('empty', prefix + 'empty.yml'), ('fifo', prefix + 'fifo.yml'), ('directory', prefix + 'directory.yml'),
                ('invalid_utf8', prefix + 'invalid.yml'), ('hardlink', prefix + 'hardlink.yml'),
                ('url', 'https://unreviewed.invalid/snapshot.yml'), ('encoded', prefix + '%2e%2e/outside.yml')]:
                cases.append({'name': name, 'result': linked(target)})
            duplicate = linked(prefix + filename); duplicate['content'][0]['text'] += '\n- [Snapshot](' + prefix + filename + ')'
            cases.append({'name': 'ambiguous', 'result': duplicate})
            command = ['/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node', str(ROOT / 'playwright-mcp-canary.mjs'), 'snapshot-contract', str(evidence)]
            result = subprocess.run(command, input=json.dumps(cases), text=True, env={'PATH': '/usr/bin:/bin'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr); self.assertEqual(result.stderr, '')
            observations = json.loads(result.stdout); self.assertEqual(len(observations), len(cases))
            for item in observations:
                with self.subTest(case=item['name']):
                    if item['name'] in ('saved', 'inline', 'absolute', 'limit'):
                        self.assertTrue(item['ok']); self.assertIn('ALTERA_PLAYWRIGHT_CANARY', item['text'])
                        self.assertIn('http://altera-web:3000/', item['text']); self.assertIn('Altera synthetic', item['text'])
                        self.assertRegex(item['text'], r'link "Continue" \[ref=e3\]')
                    else:
                        self.assertEqual(item, {'name': item['name'], 'ok': False, 'error': 'SNAPSHOT_OBSERVATION_INVALID'})
            alias = base / 'alias'; alias.symlink_to(evidence, target_is_directory=True)
            command[-1] = str(alias)
            result = subprocess.run(command, input=json.dumps(cases[:1]), text=True, env={'PATH': '/usr/bin:/bin'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
            self.assertEqual(json.loads(result.stdout), [{'name': 'saved', 'ok': False, 'error': 'SNAPSHOT_OBSERVATION_INVALID'}])

    def test_actions_await_fresh_snapshot_before_reference_lookup(self):
        source = (ROOT / 'playwright-mcp-canary.mjs').read_text()
        with tempfile.TemporaryDirectory() as temp:
            evidence = Path(temp).resolve()
            (evidence / 'page-2026-09-14T09-29-07-217Z.yml').write_text(SAVED_FORM_YAML)
            command = ['/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node', str(ROOT / 'playwright-mcp-canary.mjs'), 'action-contract', str(evidence)]
            if "mode === 'action-contract'" not in source:
                # RED применяет действующий observer к реальному пустому action success.
                command[2] = 'snapshot-contract'
                result = subprocess.run(command, input=json.dumps([{'name': 'empty_type', 'result': SAVED_EMPTY_ACTION}]), text=True, env={'PATH': '/usr/bin:/bin'}, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('"Submit"', json.loads(result.stdout)[0]['text'])
                return
            cases = [{'name': method, 'method': method, 'action': SAVED_EMPTY_ACTION, 'snapshot': SAVED_FORM_RESPONSE}
                     for method in ['browser_navigate', 'browser_click', 'browser_type']]
            cases += [{'name': 'inline', 'method': 'browser_click', 'action': SAVED_EMPTY_ACTION,
                       'snapshot': {'content': [{'type': 'text', 'text': SAVED_FORM_YAML}]}},
                      {'name': 'stale_action', 'method': 'browser_click',
                       'action': {'content': [{'type': 'text', 'text': '- button "Submit" [ref=STALE]'}]}, 'snapshot': SAVED_FORM_RESPONSE},
                      {'name': 'action_error', 'method': 'browser_type', 'action': {'isError': True, 'content': []}, 'snapshot': SAVED_FORM_RESPONSE},
                      {'name': 'action_reject', 'method': 'browser_type', 'rejectAction': True, 'snapshot': SAVED_FORM_RESPONSE},
                      {'name': 'snapshot_error', 'method': 'browser_type', 'action': SAVED_EMPTY_ACTION, 'snapshot': {'isError': True, 'content': []}}]
            result = subprocess.run(command, input=json.dumps(cases), text=True, env={'PATH': '/usr/bin:/bin'}, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr); self.assertEqual(result.stderr, '')
            proof = json.loads(result.stdout)
            self.assertIn('browser_snapshot', proof['requiredTools'])
            self.assertEqual(len(proof['observations']), len(cases))
            for case, actual in zip(cases, proof['observations']):
                with self.subTest(case=case['name']):
                    self.assertEqual(actual['calls'][0], {'name': case['method'], 'args': {'synthetic': True}})
                    if case['name'].startswith('action_'):
                        self.assertFalse(actual['ok']); self.assertEqual(actual['observed'], 0)
                        self.assertEqual(len(actual['calls']), 1); self.assertNotIn('snapshot', actual['events'])
                    else:
                        self.assertEqual(actual['calls'][1], {'name': 'browser_snapshot', 'args': {}})
                        self.assertEqual(actual['events'], ['action-start', 'action-complete', 'snapshot'])
                        if case['name'] == 'snapshot_error':
                            self.assertFalse(actual['ok']); self.assertEqual(actual['observed'], 0)
                        else:
                            self.assertTrue(actual['ok']); self.assertEqual(actual['observed'], 1)
                            self.assertIn('"Submit" [ref=f1e5]', actual['text']); self.assertNotIn('STALE', actual['text'])

    def test_current_action_url_and_fresh_snapshot_have_separate_authority(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence = Path(temp).resolve()
            tree = '- heading "FORM_COMPLETE_ADA" [ref=FRESH]'
            (evidence / 'completion.yml').write_text(tree)
            def response(body):
                return {'content': [{'type': 'text', 'text': body}]}
            current_action = response('### Page\n- Page URL: http://altera-web:3000/done?name=Ada\n- button "Submit" [ref=STALE]')
            cases = [
                {'name': 'action_url_inline_tree', 'method': 'browser_click', 'action': current_action, 'snapshot': response(tree)},
                {'name': 'action_url_linked_tree', 'method': 'browser_click', 'action': current_action,
                 'snapshot': response('### Snapshot\n- [Snapshot](../runtime/evidence/playwright/completion.yml)')},
                {'name': 'empty_action_full_snapshot', 'method': 'browser_click', 'action': SAVED_EMPTY_ACTION,
                 'snapshot': response('### Page\n- Page URL: http://altera-web:3000/done?name=Ada\n' + tree)},
                {'name': 'neither_current_url', 'method': 'browser_click', 'action': SAVED_EMPTY_ACTION,
                 'snapshot': response(tree), 'previous': current_action},
                {'name': 'stale_action_marker', 'method': 'browser_click',
                 'action': response('### Page\n- Page URL: http://altera-web:3000/done?name=Ada\n' + tree),
                 'snapshot': response('- heading "NOT_COMPLETE" [ref=FRESH]')},
            ]
            command = ['/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node', str(ROOT / 'playwright-mcp-canary.mjs'), 'action-contract', str(evidence)]
            result = subprocess.run(command, input=json.dumps(cases), text=True, env={'PATH': '/usr/bin:/bin'}, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr); self.assertEqual(result.stderr, '')
            observed = json.loads(result.stdout)['observations']
            for case, item in zip(cases, observed):
                with self.subTest(case=case['name']):
                    self.assertTrue(item['ok']); self.assertNotIn('STALE', item['text'])
                    # RED воспроизводит прежнюю actual final assertion по snapshot-only результату.
                    completed = item.get('completed', 'FORM_COMPLETE_ADA' in item['text'] and '/done?name=Ada' in item['text'])
                    self.assertEqual(completed, case['name'] in ('action_url_inline_tree', 'action_url_linked_tree', 'empty_action_full_snapshot'))
                    if 'actionText' in item:
                        self.assertEqual(item['actionText'], '\n'.join(part['text'] for part in case['action']['content']))

    def test_namespace_capabilities_require_real_isolation_and_preserve_diagnostics(self):
        binary = '/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell'
        zero, admin, bound = '0000000000000000', '0000000000200000', '000001ffffffffff'
        def row(pid, role=None, inner=False, capabilities=zero):
            fields = {'Uid': '1000 1000 1000 1000', 'Gid': '1000 1000 1000 1000',
                      'CapEff': capabilities, 'CapPrm': capabilities, 'CapInh': zero, 'CapAmb': zero,
                      'CapBnd': bound if inner else zero, 'NoNewPrivs': '1', 'Seccomp': '2', 'Seccomp_filters': '2', 'NSpid': str(pid)}
            return {'pid': str(pid), 'argv': [binary] + (['--type=' + role] if role else ['--headless']), 'fields': fields,
                    'uid_map': '1000 1000 1\n' if inner else '0 0 4294967295\n',
                    'gid_map': '1000 1000 1\n' if inner else '0 0 4294967295\n',
                    'user_namespace': {'value': 'user:[%d]' % (200 + pid if inner else 100)}, 'starttime': '100', 'errors': []}
        good = {'observer': row(10), 'rows': [row(11), row(12, 'zygote', True, admin), row(13, 'renderer', True)], 'scanErrors': []}
        good['rows'][1]['argv'].append('--no-zygote-sandbox')
        source = (ROOT / 'playwright-mcp-canary.mjs').read_text()
        if "mode === 'process-contract'" not in source:
            assertion = re.search(r"assert.equal\(fields.CapEff, '[0-9a-f]+'\)", source).group()
            script = "const assert=require('node:assert/strict'),fields=" + json.dumps(good['rows'][1]['fields']) + ';' + assertion
            result = subprocess.run(['/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node', '-e', script], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return
        cases = [{'name': 'proven_inner', 'diagnostic': good, 'expected': True}]
        unavailable = copy.deepcopy(good); unavailable['rows'][1]['user_namespace'] = {'error': 'EACCES'}
        cases.append({'name': 'maps_prove_separation', 'diagnostic': unavailable, 'expected': True})
        def bad(name, mutate):
            diagnostic = copy.deepcopy(good); mutate(diagnostic)
            cases.append({'name': name, 'diagnostic': diagnostic, 'expected': False})
        bad('same_namespace_admin', lambda d: d['rows'][1].update(user_namespace={'value': 'user:[100]'}))
        bad('outer_admin', lambda d: d['rows'][0]['fields'].update(CapEff=admin, CapPrm=admin))
        bad('outer_bounding', lambda d: d['rows'][0]['fields'].update(CapBnd=bound))
        bad('observer_bounding', lambda d: d['observer']['fields'].update(CapBnd=bound))
        bad('renderer_admin', lambda d: d['rows'][2]['fields'].update(CapEff=admin, CapPrm=admin))
        bad('zygote_extra_bit', lambda d: d['rows'][1]['fields'].update(CapEff='0000000000200001', CapPrm='0000000000200001'))
        bad('ambient', lambda d: d['rows'][1]['fields'].update(CapAmb=admin))
        bad('inheritable', lambda d: d['rows'][1]['fields'].update(CapInh=admin))
        bad('outer_zero_mapping', lambda d: d['rows'][1].update(uid_map='1000 0 1\n'))
        bad('inner_zero_mapping', lambda d: d['rows'][1].update(uid_map='0 1000 1\n'))
        bad('range_mapping', lambda d: d['rows'][1].update(gid_map='1000 1000 2\n'))
        bad('missing_map', lambda d: d['rows'][1].update(gid_map=None))
        bad('ambiguous_maps', lambda d: d['rows'][1].update(user_namespace={'error': 'EACCES'}, uid_map=d['observer']['uid_map'], gid_map=d['observer']['gid_map']))
        bad('same_narrow_maps_without_identity', lambda d: (d['observer'].update(uid_map='1000 1000 1\n', gid_map='1000 1000 1\n'), d['rows'][1].update(user_namespace={'error': 'EACCES'})))
        bad('missing_observer_map', lambda d: d['observer'].update(uid_map=None))
        bad('missing_observer_namespace', lambda d: d['observer'].update(user_namespace={'error': 'EACCES'}))
        bad('bad_uid', lambda d: d['rows'][1]['fields'].update(Uid='1000 0 1000 1000'))
        bad('nnp', lambda d: d['rows'][1]['fields'].update(NoNewPrivs='0'))
        bad('seccomp', lambda d: d['rows'][1]['fields'].update(Seccomp='0'))
        bad('wrong_binary', lambda d: d['rows'][1]['argv'].__setitem__(0, '/unreviewed/browser'))
        bad('no_sandbox', lambda d: d['rows'][1]['argv'].append('--no-sandbox'))
        bad('missing_renderer', lambda d: d['rows'].pop())
        bad('raced_row', lambda d: d['rows'][1]['errors'].append('ROW_CHANGED'))
        with tempfile.TemporaryDirectory() as temp:
            proc = Path(temp).resolve()
            file = proc / 'chrome-headless-shell'; file.write_text('SYNTHETIC_EXECUTABLE'); file.chmod(0o755)
            previous_binary = binary; binary = str(file); info = file.stat()
            for case in cases:
                case['diagnostic']['executable'] = {'path': binary, 'dev': str(info.st_dev), 'ino': str(info.st_ino), 'regular': True}
                for row in case['diagnostic']['rows']:
                    row['exe'] = dict(case['diagnostic']['executable'])
                    if row['argv'][0] == previous_binary: row['argv'][0] = binary
            for entry, directory in [(good['observer'], 'self'), (good['rows'][1], '12')]:
                folder = proc / directory; folder.mkdir(); (folder / 'ns').mkdir()
                (folder / 'cmdline').write_bytes(('\0'.join(entry['argv']) + '\0').encode())
                (folder / 'status').write_text('\n'.join(k + ':\t' + v for k, v in entry['fields'].items()))
                for name in ['uid_map', 'gid_map']: (folder / name).write_text(entry[name])
                (folder / 'ns/user').symlink_to(entry['user_namespace']['value'])
                (folder / 'exe').symlink_to(file)
                (folder / 'stat').write_text(entry['pid'] + ' (chrome) ' + ' '.join(['S'] + ['0'] * 18 + ['100']))
            # Неправильный extra bit сохраняется в диагностике до отказа; renderer также отсутствует.
            status = proc / '12/status'; status.write_text(status.read_text().replace(admin, '0000000000200001'))
            command = ['/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node', str(ROOT / 'playwright-mcp-canary.mjs'), 'process-contract', str(proc), binary]
            result = subprocess.run(command, input=json.dumps(cases), text=True, env={'PATH': '/usr/bin:/bin'}, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr); self.assertEqual(result.stderr, '')
            proof = json.loads(result.stdout); self.assertEqual(len(proof['cases']), len(cases))
            for expected, actual in zip(cases, proof['cases']):
                with self.subTest(case=expected['name']): self.assertEqual(actual['ok'], expected['expected'])
            self.assertFalse(proof['capture']['ok']); self.assertEqual(proof['capture']['persisted'], proof['capture']['report']['browser_processes'])
            rows = proof['capture']['persisted']['rows']; self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['fields']['CapEff'], '0000000000200001')
            self.assertEqual(rows[0]['uid_map'].split(), ['1000', '1000', '1'])
            self.assertEqual(rows[0]['exe']['path'], binary)
            self.assertEqual(rows[0]['exe']['ino'], str(info.st_ino))
            self.assertEqual(rows[0]['raw_cmdline'], '\0'.join(good['rows'][1]['argv']) + '\0')
            (proc / '12/exe').unlink()
            result = subprocess.run(command, input='[]', text=True, env={'PATH': '/usr/bin:/bin'}, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            failed = json.loads(result.stdout)['capture']; self.assertFalse(failed['ok'])
            self.assertEqual(failed['persisted'], failed['report']['browser_processes'])
            self.assertIn('executable:ENOENT', failed['persisted']['rows'][0]['errors'])

    def test_rewritten_titles_require_kernel_executable_identity(self):
        binary = SAVED_PROCESS_ROWS['rows'][0]['argv'][0]
        good = copy.deepcopy(SAVED_PROCESS_ROWS)
        good['executable'] = {'path': binary, 'dev': '1', 'ino': '42', 'regular': True}
        for row in good['rows']: row['exe'] = dict(good['executable'])
        cases = [{'name': 'all_seven_saved_rows', 'diagnostic': good, 'expected': True}]
        def bad(name, mutate):
            diagnostic = copy.deepcopy(good); mutate(diagnostic)
            cases.append({'name': name, 'diagnostic': diagnostic, 'expected': False})
        bad('wrong_prefix', lambda d: d['rows'][1]['argv'].__setitem__(0, '/wrong' + d['rows'][1]['argv'][0]))
        bad('wrong_inode', lambda d: d['rows'][1]['exe'].update(ino='99'))
        bad('wrong_device', lambda d: d['rows'][1]['exe'].update(dev='99'))
        bad('wrong_exe_path', lambda d: d['rows'][1]['exe'].update(path='/wrong/browser'))
        bad('missing_exe', lambda d: d['rows'][1].pop('exe'))
        bad('exe_permission', lambda d: d['rows'][1].update(exe={'error': 'EACCES'}))
        bad('multiple_types', lambda d: d['rows'][1]['argv'].__setitem__(0, d['rows'][1]['argv'][0] + ' --type=renderer'))
        bad('unknown_type', lambda d: d['rows'][1]['argv'].__setitem__(0, binary + ' --type=unknown'))
        bad('unanchored_type', lambda d: d['rows'][1]['argv'].__setitem__(0, binary + ' --headless --type=zygote'))
        bad('title_no_sandbox', lambda d: d['rows'][1]['argv'].__setitem__(0, d['rows'][1]['argv'][0] + ' --no-sandbox'))
        bad('main_no_sandbox', lambda d: d['rows'][0]['argv'].append('--no-sandbox'))
        bad('missing_main', lambda d: d['rows'].pop(0))
        bad('exe_race', lambda d: d['rows'][1]['errors'].append('EXE_CHANGED'))
        source = (ROOT / 'playwright-mcp-canary.mjs').read_text()
        mode = 'process-title-contract' if "mode === 'process-title-contract'" in source else 'process-contract'
        command = ['/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node', str(ROOT / 'playwright-mcp-canary.mjs'), mode, '/unused-synthetic-proc', binary]
        result = subprocess.run(command, input=json.dumps(cases), text=True, env={'PATH': '/usr/bin:/bin'}, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr); self.assertEqual(result.stderr, '')
        proof = json.loads(result.stdout); self.assertEqual(len(proof['cases']), len(cases))
        for expected, actual in zip(cases, proof['cases']):
            with self.subTest(case=expected['name']): self.assertEqual(actual['ok'], expected['expected'])
        if 'formats' in proof:
            self.assertEqual(proof['formats'], ['nul-argv'] + ['rewritten-title'] * 6)

    def test_only_new_empty_failed_launch_profiles_are_nonreusable(self):
        source = (ROOT / 'playwright-mcp-canary.mjs').read_text()
        name = 'playwright_chromiumdev_profile-lJcdZs'
        if "mode === 'profile-contract'" not in source:
            assertion = re.search(r'assert.deepEqual\(report.profileResidue, \[\]\)', source).group()
            script = "const assert=require('node:assert/strict'),report={profileResidue:" + json.dumps([name]) + '};' + assertion
            result = subprocess.run(['/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node', '-e', script], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve(); cases = []
            for label, phase, kind, prior, accepted in [
                ('new_empty', 'failed-launch', 'empty', [], True),
                ('main_empty_dir', 'main', 'empty', [], False),
                ('reused', 'failed-launch', 'empty', [name], False),
                ('nonempty', 'failed-launch', 'nonempty', [], False),
                ('symlink', 'failed-launch', 'symlink', [], False),
                ('file', 'failed-launch', 'file', [], False),
                ('main_clean', 'main', 'none', [], True),
                ('failed_clean', 'failed-launch', 'none', [], True)]:
                area = root / label; area.mkdir()
                profile = area / name
                if kind in ('empty', 'nonempty'):
                    profile.mkdir(mode=0o700)
                    if kind == 'nonempty': (profile / 'state').write_text('SYNTHETIC_STATE')
                elif kind == 'symlink': profile.symlink_to(root, target_is_directory=True)
                elif kind == 'file': profile.write_text('SYNTHETIC_STATE')
                cases.append({'name': label, 'phase': phase, 'prior': prior, 'expected': accepted, 'hasResidue': kind != 'none'})
            command = ['/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node', str(ROOT / 'playwright-mcp-canary.mjs'), 'profile-contract', str(root)]
            result = subprocess.run(command, input=json.dumps(cases), text=True, env={'PATH': '/usr/bin:/bin'}, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr); self.assertEqual(result.stderr, '')
            actual = json.loads(result.stdout); self.assertEqual(len(actual), len(cases))
            for case, item in zip(cases, actual):
                with self.subTest(case=case['name']):
                    self.assertEqual(item['ok'], case['expected'])
                    self.assertEqual(item['profileResidue'], [name] if case['hasResidue'] else [])
                    if item['ok']:
                        self.assertFalse(item['state']['reusableState'])
                        self.assertEqual(item['state']['failedLaunchEmptyDirectories'], [name] if case['hasResidue'] else [])
                    self.assertEqual((root / case['name'] / name).exists() or (root / case['name'] / name).is_symlink(), case['hasResidue'])

    def test_seccomp_exact_bytes(self):
        self.assertEqual(hashlib.sha256((ROOT / 'playwright-seccomp.json').read_bytes()).hexdigest(),
                         'e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1')

    def test_exact_environment_and_vector(self):
        mapper = module('codex_toml_map')
        vector = mapper.PLAYWRIGHT_VECTOR
        self.assertEqual(vector[:2], ['/usr/bin/env', '-i'])
        self.assertEqual(vector[2:9], [
            'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/runtime/cache/playwright-home',
            'TMPDIR=/runtime/tmp', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
            'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1', 'PLAYWRIGHT_SKIP_BROWSER_GC=1', 'npm_config_offline=true'])
        self.assertEqual(vector[9:14], ['/usr/local/bin/node', '/opt/playwright-mcp/node_modules/@playwright/mcp/cli.js', '--headless', '--sandbox',
            '--executable-path=/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell'])
        self.assertEqual(vector[14:], ['--isolated', '--block-service-workers', '--allowed-origins=http://altera-web:3000', '--codegen=none',
            '--image-responses=omit', '--output-dir=/runtime/evidence/playwright', '--output-max-size=16777216'])

def run_docker_canary(image, evidence):
    """Прямой trusted bootstrap harness: receipt ещё не существует, production admission не обходится."""
    out = Path(evidence).resolve(); out.mkdir(mode=0o700, exist_ok=False)
    mapper = module('codex_toml_map')
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/var/empty',
           'DOCKER_HOST': 'unix:///Users/egorbondarenko/.docker/run/docker.sock'}
    commands = []
    def docker(*args, check=True, timeout=240):
        cmd = ['/usr/local/bin/docker', *args]
        result = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        commands.append({'argv': cmd, 'exit': result.returncode})
        (out / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        (out / ('docker-%02d.stdout' % len(commands))).write_bytes(result.stdout)
        (out / ('docker-%02d.stderr' % len(commands))).write_bytes(result.stderr)
        if check and result.returncode:
            raise AssertionError('Docker command failed; inspect saved numbered raw logs')
        return result
    info = json.loads(docker('image', 'inspect', image).stdout)[0]
    image = info['Id']; assert info['Architecture'] == 'arm64' and info['Os'] == 'linux'
    assert set(item.split('=', 1)[0] for item in info['Config']['Env']) <= {'PATH', 'NODE_VERSION', 'YARN_VERSION'}
    (out / 'image-inspect.json').write_text(json.dumps(info, indent=2) + '\n')
    seccomp = out / 'seccomp.json'; seccomp.write_bytes((ROOT / 'playwright-seccomp.json').read_bytes()); seccomp.chmod(0o600)
    assert hashlib.sha256(seccomp.read_bytes()).hexdigest() == mapper.PLAYWRIGHT_SECCOMP
    class Control(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200); self.end_headers(); self.wfile.write(b'HOST_SYNTHETIC_CONTROL')
        def log_message(self, *args):
            pass
    server = http.server.HTTPServer(('127.0.0.1', 0), Control)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    import urllib.request
    assert urllib.request.urlopen('http://127.0.0.1:%d' % server.server_port).read() == b'HOST_SYNTHETIC_CONTROL'
    reports = {}
    try:
        for mode in ['control', 'acceptance']:
            area = out / mode; area.mkdir(mode=0o700)
            policy = area / 'policy'; policy.mkdir(mode=0o755)
            shutil.copyfile(ROOT / 'playwright-mcp-canary.mjs', policy / 'canary.mjs')
            (policy / 'vector.json').write_text(json.dumps(mapper.PLAYWRIGHT_VECTOR))
            (policy / 'poison.cjs').write_text("require('fs').writeFileSync('/runtime/evidence/poison-executed','EXECUTED')")
            source = area / 'source'; source.mkdir(mode=0o755); (source / 'input.txt').write_text('SYNTHETIC_SOURCE')
            for name in ['evidence', 'cache', 'tmp']:
                (area / name).mkdir(mode=0o777); (area / name).chmod(0o777)
            def fingerprint(root):
                return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
            before = {'policy': fingerprint(policy), 'source': fingerprint(source)}
            network = 'altera-pw-' + uuid.uuid4().hex
            names = [network + '-web', network + '-runner'] + ([network + '-sink'] if mode == 'control' else [])
            created = False
            try:
                docker('network', 'create', '--internal', '--opt', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', network)
                created = True
                common = ['--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=1000:1000',
                          '--pids-limit=128', '--memory=2g', '--cpus=2']
                for name, role, alias in [(names[0], 'web', 'altera-web')] + ([(names[2], 'sink', 'forbidden-sink')] if mode == 'control' else []):
                    docker('run', '--detach', '--name', name, '--network=' + network, '--network-alias=' + alias, *common,
                           '--mount=type=bind,src=' + str(policy / 'canary.mjs') + ',dst=/fixture.mjs,readonly',
                           '--entrypoint=/usr/local/bin/node', image, '/fixture.mjs', role)
                    for _ in range(50):
                        if b'FIXTURE_READY' in docker('logs', name).stdout:
                            break
                        time.sleep(0.1)
                    else:
                        raise AssertionError('fixture_not_ready')
                cmd = ['create', '--init', '--name', names[1], '--network=' + network, *common,
                       '--security-opt=seccomp=' + str(seccomp), '--workdir=/source',
                       '--mount=type=bind,src=' + str(policy) + ',dst=/runtime/policy,readonly',
                       '--mount=type=bind,src=' + str(source) + ',dst=/source,readonly']
                for name in ['evidence', 'cache', 'tmp']:
                    cmd += ['--mount=type=bind,src=' + str(area / name) + ',dst=/runtime/' + name]
                cmd += ['--env=HOME=/runtime/cache/home', '--env=TMPDIR=/runtime/tmp', '--entrypoint=/usr/local/bin/node',
                        image, '/runtime/policy/canary.mjs', mode, str(server.server_port)]
                docker(*cmd)
                runtime = json.loads(docker('inspect', names[1]).stdout)[0]
                inspect = json.loads(docker('network', 'inspect', network).stdout)[0]
                assert inspect['Internal'] and not inspect['EnableIPv6']
                assert inspect['Options']['com.docker.network.bridge.gateway_mode_ipv4'] == 'isolated'
                # Created runner ещё не подключён; membership после запуска сохраняется отдельно.
                assert runtime['HostConfig']['ReadonlyRootfs'] and runtime['HostConfig']['CapDrop'] == ['ALL']
                assert not runtime['HostConfig']['CapAdd'] and not runtime['HostConfig']['Privileged']
                assert not runtime['HostConfig']['PortBindings'] and not runtime['HostConfig']['ExtraHosts']
                assert runtime['Config']['User'] == '1000:1000'
                assert all(m['Destination'] in ['/runtime/policy', '/source', '/runtime/evidence', '/runtime/cache', '/runtime/tmp'] for m in runtime['Mounts'])
                (area / 'container-inspect.json').write_text(json.dumps(runtime, indent=2) + '\n')
                result = docker('start', '--attach', names[1], check=False)
                (area / 'network-inspect.json').write_bytes(docker('network', 'inspect', network).stdout)
                state = json.loads(docker('inspect', names[1]).stdout)[0]['State']
                (area / 'exit.json').write_text(json.dumps(state, indent=2) + '\n')
                assert state['ExitCode'] == 0 and result.returncode == 0, 'real MCP canary failed; inspect canary-report.json'
                report = json.loads((area / 'evidence/canary-report.json').read_text()); assert report['accepted']
                reports[mode] = report
                assert before == {'policy': fingerprint(policy), 'source': fingerprint(source)}
                (area / 'readonly-source-policy.json').write_text(json.dumps(before, indent=2) + '\n')
            finally:
                if created:
                    for name in names:
                        docker('rm', '--force', name, check=False)
                    remaining = json.loads(docker('network', 'inspect', network).stdout)[0]
                    assert not remaining.get('Containers'), 'targeted_cleanup_unconfirmed'
                    docker('network', 'rm', network)
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)
    assert hashlib.sha256(seccomp.read_bytes()).hexdigest() == mapper.PLAYWRIGHT_SECCOMP
    proof = {'image': image, 'accepted': True, 'modes': list(reports), 'host_listener_positive': True,
             'seccomp_sha256': mapper.PLAYWRIGHT_SECCOMP, 'cleanup': True}
    (out / 'result.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--docker':
        run_docker_canary(sys.argv[2], sys.argv[3])
    else:
        unittest.main()
