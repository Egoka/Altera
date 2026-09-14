import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
from unittest.mock import patch

HEAD = 'ccadb408e22936ad00779778a7bbc5799cb87afa'
source = subprocess.check_output(['git', 'show', HEAD + ':scripts/agent-runtime/codex_toml_map.py'],
    cwd='/private/tmp/altera-agent-loop-autonomy')
assert hashlib.sha256(source).hexdigest() == '60b9c909076efcad8223a5584442ab357f5a255b4a07df9fc89bd4e4a1ba0ae1'
m = types.ModuleType('frozen_fix1')
exec(compile(source, 'frozen_fix1.py', 'exec'), m.__dict__)
result = {'head': HEAD, 'synthetic_only': True, 'suite_rerun': False, 'foreign_read_bytes': 0}
with tempfile.TemporaryDirectory(prefix='mapper-fix1-reopen-', dir='/private/tmp') as tmp:
    root = Path(tmp)
    output = root / 'generation'
    output.mkdir(mode=0o700)
    canary = root / 'synthetic-private-canary'
    canary.write_bytes(b'PRIVATE_SYNTHETIC_CANARY_ONLY')
    canary.chmod(0o600)
    foreign_inode = canary.stat().st_ino
    directory_fd, identity = m._open_output_directory(str(output), os.getuid())
    real_open, real_read = m.os.open, m.os.read
    def swapped_open(name, flags, *args, **kwargs):
        if name == 'codex-config.toml' and kwargs.get('dir_fd') == directory_fd:
            result['final_open_nonblocking'] = bool(flags & os.O_NONBLOCK)
            os.replace(canary, output / 'codex-config.toml')
            result['foreign_replacement_before_reopen'] = True
        return real_open(name, flags, *args, **kwargs)
    def observed_read(fd, size):
        value = real_read(fd, size)
        if os.fstat(fd).st_ino == foreign_inode:
            result['foreign_read_bytes'] += len(value)
        return value
    try:
        with patch.object(m.os, 'open', side_effect=swapped_open), patch.object(m.os, 'read', side_effect=observed_read):
            m._write_atomic(str(output), directory_fd, identity, 'codex-config.toml',
                b'model_reasoning_effort = "medium"\n', os.getuid())
        result['outcome'] = 'returned_success'
    except m.MappingError as error:
        result['outcome'] = error.code
    finally:
        os.close(directory_fd)
    result['foreign_entry_preserved'] = (output / 'codex-config.toml').exists()
text = json.dumps(result, indent=2, sort_keys=True) + '\n'
Path(__file__).with_name('fix1-reopen-proof.json').write_text(text)
print(text, end='')
