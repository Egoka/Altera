"""Контракты no-model MCP canary; --canary запускает отдельную реальную проверку."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parent
NODE = '/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node'
IMAGE = 'sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a'


class CanaryContracts(unittest.TestCase):
    def node(self, source):
        script = ('import assert from "node:assert/strict";\n'
                  'import { decodeRpc, acceptedResult, libraryIds, readRpc, traceAccepted } from ' +
                  json.dumps((ROOT / 'reviewer-mcp-canary.mjs').as_uri()) + ';\n' + source)
        result = subprocess.run([NODE, '--input-type=module', '-e', script],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_json_and_sse_require_matching_successful_rpc(self):
        self.node(r'''
const message = {jsonrpc: "2.0", id: 7, result: {tools: []}};
assert.deepEqual(decodeRpc(JSON.stringify(message), "application/json", 7), message);
assert.deepEqual(decodeRpc(': ping\n\nevent: message\ndata: ' + JSON.stringify(message) + '\n\n', "text/event-stream", 7), message);
for (const bad of [{...message, id: 8}, {...message, jsonrpc: "1.0"}, {jsonrpc:"2.0", id:7}, {...message, error:{code:1}}, {...message,result:{isError:true}}]) {
  assert.throws(() => acceptedResult(bad, 7));
}
assert.throws(() => decodeRpc(JSON.stringify(message), "text/html", 7));
''')

    def test_library_result_requires_actual_public_library_id(self):
        self.node('''
assert.deepEqual(libraryIds({content:[{type:"text",text:"Title: React\\nContext7-compatible library ID: /websites/react_dev\\nDescription: Public React docs"}]}), ["/websites/react_dev"]);
for (const result of [{}, {isError:true,content:[{type:"text",text:"Context7-compatible library ID: /x/y"}]}, {content:[{type:"text",text:"Authentication required"}]}, {content:[{type:"text",text:"Context7-compatible library ID: https://evil.invalid/x/y"}]}]) assert.throws(() => libraryIds(result));
''')

    def test_stream_body_is_bounded_and_stops_after_matching_sse(self):
        self.node('''
const encoded = new TextEncoder();
let cancelled = false;
const stream = new ReadableStream({start(c) {c.enqueue(encoded.encode('data: {"jsonrpc":"2.0","id":3,"result":{}}\\n\\n'));}, cancel() {cancelled = true;}});
assert.deepEqual(await readRpc(new Response(stream,{headers:{"content-type":"text/event-stream"}}),3), {jsonrpc:"2.0",id:3,result:{}});
assert.equal(cancelled,true);
await assert.rejects(readRpc(new Response('x'.repeat(524289),{headers:{"content-type":"application/json"}}),3));
''')

    def test_trace_summary_counts_and_exact_outline_are_accepted(self):
        self.node('''
const content = (value) => ({content:[{type:"text",text:JSON.stringify(value)}]});
const map = {fileCount:1,symbolCount:1,languages:["javascript"]};
const outline = {path:"sample.js",language:"javascript",symbols:[{symbolId:"sample.js::answer#function",name:"answer",kind:"function"}],_freshness:"fresh"};
traceAccepted(content(map),content(outline));
for (const bad of [{...map,fileCount:0},{...map,symbolCount:0},{...map,languages:[]}]) assert.throws(() => traceAccepted(content(bad),content(outline)));
for (const bad of [{...outline,path:"elsewhere.js"},{...outline,symbols:[]},{...outline,_freshness:"stale_index"}]) assert.throws(() => traceAccepted(content(map),content(bad)));
assert.throws(() => traceAccepted({content:[{type:"text",text:"sample.js"}]},{content:[{type:"text",text:"answer"}]}));
''')


def canary(destination):
    spec = importlib.util.spec_from_file_location('runtime', ROOT / 'runtime.py')
    runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runtime)
    base = Path(destination).resolve()
    base.mkdir(exist_ok=False)
    source = base / 'source'
    source.mkdir()
    runtime.git(source, 'init', '-q')
    runtime.git(source, 'config', 'user.name', 'Synthetic MCP Canary')
    runtime.git(source, 'config', 'user.email', 'fixture@example.invalid')
    (source / 'sample.js').write_text('export function answer() { return 42; }\n')
    runtime.git(source, 'add', 'sample.js')
    runtime.git(source, 'commit', '-qm', 'Synthetic MCP fixture')
    snapshot = base / 'snapshot'
    state = runtime.snapshot(source, snapshot, [])
    policy = base / 'policy'
    policy.mkdir()
    for filename, target in [('reviewer-mcp-canary.mjs', 'fixture.mjs'), ('provider-proxy.mjs', 'provider-proxy.mjs')]:
        (policy / target).write_bytes((ROOT / filename).read_bytes())
    (policy / 'claude-settings.json').write_text('{"disableAllHooks":true}')
    (policy / 'mcp.json').write_text(json.dumps({'mcpServers': {
        'trace': {'type': 'stdio', 'command': '/usr/local/bin/trace-mcp', 'args': ['serve']},
        'context7': {'type': 'http', 'url': 'https://mcp.context7.com/mcp'}}}, indent=2))
    run = base / 'run'
    run.mkdir()
    manifest = {'schema_version': 1, 'family': 'claude', 'source': str(source),
        'snapshot': str(snapshot), 'state': state, 'dirty_paths': [], 'policy': str(policy),
        'policy_sha256': runtime.tree_hash(policy), 'run_root': str(run), 'image': IMAGE,
        'model': 'claude-opus-4-6', 'effort': 'medium', 'env_paths': {},
        'path_map': {'/synthetic/managed/mcp.json': '/runtime/policy/mcp.json'},
        'managed_mapping_verified': False, 'fixture': True, 'network': 'provider-proxy'}
    path = base / 'manifest.json'
    path.write_text(json.dumps(manifest, indent=2) + '\n')
    invocation = ['/usr/bin/python3', '-I', str(ROOT / 'runtime.py'), str(path),
                  '--mcp-config', '/synthetic/managed/mcp.json']
    prepared = runtime.command(manifest, invocation[-2:], {})
    (base / 'prepared-command.json').write_text(json.dumps(prepared, indent=2) + '\n')
    before = {'source': runtime.fingerprint(source, []), 'snapshot': runtime.tree_hash(snapshot),
              'policy': runtime.tree_hash(policy), 'runtime_sha256': runtime.digest((ROOT / 'runtime.py').read_bytes())}
    (base / 'before.json').write_text(json.dumps(before, indent=2) + '\n')
    process = subprocess.Popen(invocation, env=runtime.child_env(), stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        stdout, stderr = process.communicate(b'', timeout=300)
        code = process.returncode
    except subprocess.TimeoutExpired:
        # Launcher пересылает SIGTERM контейнеру и освобождает отдельную сеть в finally.
        process.terminate()
        stdout, stderr = process.communicate(timeout=30)
        code = 124
    (base / 'stdout.log').write_bytes(stdout)
    (base / 'stderr.log').write_bytes(stderr)
    after = {'source': runtime.fingerprint(source, []), 'snapshot': runtime.tree_hash(snapshot),
             'policy': runtime.tree_hash(policy), 'runtime_sha256': runtime.digest((ROOT / 'runtime.py').read_bytes())}
    proof = {'exit': code, 'unchanged': before == after, 'after': after, 'image': IMAGE,
             'invocation': invocation, 'model_launched': False, 'auth_mounted': False}
    (base / 'exit.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'exit': code, 'unchanged': before == after, 'evidence': str(base)}))
    return 0 if code == 0 and before == after else 1


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--canary':
        sys.exit(canary(sys.argv[2]))
    unittest.main(verbosity=2)
