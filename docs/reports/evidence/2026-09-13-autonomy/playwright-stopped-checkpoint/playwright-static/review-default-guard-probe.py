import ast
import hashlib
import json
from pathlib import Path
import re
import tempfile

HERE = Path(__file__).resolve().parent
diff = (HERE / 'stopped-review.diff').read_bytes()
assert hashlib.sha256(diff).hexdigest() == '59ba79a448762f85ee25bc50e36bbb201c87691660f9f69cf40f4c5127174997'
lines = diff.decode().splitlines()
start = lines.index('+def playwright_policy(manifest):')
body = []
for line in lines[start:]:
    if not line.startswith('+'):
        break
    text = line[1:]
    if body and text == '@contextmanager':
        break
    body.append(text)
source = '\n'.join(body)
ast.parse(source)
namespace = {'Path': Path}
exec(compile(source, 'frozen_playwright_policy.py', 'exec'), namespace)
guard = namespace['playwright_policy']

vector_start = lines.index('+PLAYWRIGHT_VECTOR = [')
vector_lines = []
for line in lines[vector_start:]:
    vector_lines.append(line[1:])
    if line == '+]': break
vector = ast.literal_eval(ast.parse('\n'.join(vector_lines)).body[0].value)

with tempfile.TemporaryDirectory(prefix='pw-static-review-', dir='/private/tmp') as tmp:
    policy = Path(tmp)
    config = policy / 'codex-config.toml'
    # JSON basic-string escaping is a subset of these TOML basic strings.
    server = json.dumps('playwright').replace('p', '\\u0070')
    command = json.dumps(vector[0])
    arguments = re.sub('playwright', lambda match: '\\u%04x' % ord(match.group()[0]) + match.group()[1:],
                       json.dumps(vector[1:]), flags=re.IGNORECASE)
    encoded = ('[mcp_servers.' + server + ']\ncommand = ' + command + '\nargs = ' + arguments + '\n').encode()
    config.write_bytes(encoded)
    result = guard({'policy': str(policy), 'network': 'none'})
    proof = {
        'synthetic_only': True,
        'frozen_diff_sha256': hashlib.sha256(diff).hexdigest(),
        'no_receipt_supplied': True,
        'no_literal_playwright_bytes': b'playwright' not in encoded.lower(),
        'decoded_server_is_playwright': json.loads(server) == 'playwright',
        'decoded_vector_matches_fixed_vector': [json.loads(command)] + json.loads(arguments) == vector,
        'guard_returned_no_playwright': result is None,
        'docker_or_model_launched': False,
    }
(HERE / 'review-default-guard-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof, indent=2))
