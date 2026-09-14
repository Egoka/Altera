import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import traceback
import types
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = '/private/tmp/altera-agent-loop-autonomy'
HEAD = '123d1e6f9c6c5199c8a4fe6bf16b451bfe11a084'
source = subprocess.check_output(['git', 'show', HEAD + ':scripts/agent-runtime/codex_toml_map.py'], cwd=ROOT)
assert hashlib.sha256(source).hexdigest() == 'e26bb20479efd6c8e6033fa6832716c5530a673e753a87deb9d78304c2c93391'
m = types.ModuleType('frozen_mapper')
exec(compile(source, 'frozen_mapper.py', 'exec'), m.__dict__)

def block(*lines):
    return ('\n'.join((m.BEGIN_MARKER,) + lines + (m.END_MARKER,)) + '\n').encode()

results = {'head': HEAD, 'synthetic_only': True, 'suite_rerun': False}
with tempfile.TemporaryDirectory(prefix='mapper-review-risk-', dir='/private/tmp') as tmp:
    root = Path(tmp)
    workspace = root / 'workspace'
    home = workspace / 'alte-1-012345abcdef' / 'codex-home'
    home.mkdir(parents=True)
    config = home / 'config.toml'
    config.write_bytes(block())
    config.chmod(0o600)
    base = root / 'base.toml'
    record = {'binary_sha256': m.D2_BINARY_SHA256, 'descriptor': {
        'source_sha256': m.D2_SOURCE_SHA256, 'build_sha256': m.D2_BUILD_SHA256,
        'read_status': 'lexical_candidate', 'canonical_identity': 'not_checked',
        'task_acceptance': 'not_checked', 'cwd_matches_expected': True,
        'argc': 4, 'candidate_path': str(home)}}

    def materialize(label, base_bytes):
        base.write_bytes(base_bytes)
        base.chmod(0o600)
        output = root / label
        output.mkdir(mode=0o700)
        result = m.materialize(record, workspace_root=str(workspace), expected_cwd=os.getcwd(),
            expected_uid=os.getuid(), base_policy_path=str(base),
            expected_base_sha256=hashlib.sha256(base_bytes).hexdigest(), output_dir=str(output),
            mapping_policy_version='review-v1')
        return result, output

    foreign_base = b'model = "gpt-5.6-terra"\n[ "mcp_servers".unmanaged ]\ncommand = "SYNTHETIC_ONLY"\n'
    result, output = materialize('base-mcp', foreign_base)
    catalog = json.loads((output / 'codex-mcp-catalog.json').read_text())
    results['quoted_base_mcp'] = {
        'verified': result['managed_mapping_verified'],
        'catalog_explicit_empty': catalog['managed_state'] == 'explicit_empty',
        'unmanaged_table_preserved': b'[ "mcp_servers".unmanaged ]' in (output / 'codex-config.toml').read_bytes()}

    real_link = m.os.link
    replaced = []
    def replace_before_link(src, dst, **kwargs):
        if Path(dst).name == 'codex-config.toml':
            original = Path(src).read_bytes()
            substitute = Path(src).with_name('synthetic-substitute')
            substitute.write_bytes(original.replace(b'medium', b'high  '))
            substitute.chmod(0o600)
            os.replace(substitute, src)
            replaced.append(True)
        return real_link(src, dst, **kwargs)
    with patch.object(m.os, 'link', side_effect=replace_before_link):
        result, output = materialize('publish-race', b'model_reasoning_effort = "medium"\n')
    actual = (output / 'codex-config.toml').read_bytes()
    results['temp_replacement'] = {'replacement_observed': bool(replaced),
        'verified': result['managed_mapping_verified'],
        'published_digest_matches_reported': hashlib.sha256(actual).hexdigest() == result['policy_sha256']}

    missing_home = workspace / 'alte-9-abcdef012345' / 'codex-home'
    try:
        m._read_validated_config(str(missing_home), str(workspace), os.getuid())
    except Exception as error:
        rendered = ''.join(traceback.format_exception(type(error), error, error.__traceback__))
        results['error_chain'] = {'outer_type': type(error).__name__,
            'outer_code': str(error), 'traceback_contains_task_component': missing_home.parent.name in rendered}

for name, data in {
    'trace_command_array': block('[mcp_servers.trace]', 'command = ["SYNTHETIC_ONLY"]', 'args = ["serve"]'),
    'playwright_nested_args': block('[mcp_servers.playwright]', 'command = "npx"', 'args = [["SYNTHETIC_ONLY"]]'),
}.items():
    try:
        answer = m.build_mapping(data, 'review-v1')
        results[name] = {'returned_failure': answer['failure']}
    except Exception as error:
        results[name] = {'exception_type': type(error).__name__, 'is_fixed_mapping_error': isinstance(error, m.MappingError)}

output = json.dumps(results, indent=2, sort_keys=True) + '\n'
(HERE / 'named-risk-proof.json').write_text(output)
print(output, end='')
