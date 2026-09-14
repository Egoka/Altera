// Coordinator-pinned infrastructure checks; this does not establish product acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';

const source = '/Users/egorbondarenko/WebstormProjects/Altera';
test('runtime process has the accepted non-root UID', () => {
  assert.equal(process.getuid(), 501);
});
test('source mount is read-only', () => {
  assert.throws(() => writeFileSync(`${source}/.runtime-write-probe`, 'probe'), { code: 'EROFS' });
});
test('policy mount is read-only', () => {
  assert.throws(() => writeFileSync('/runtime/policy/.runtime-write-probe', 'probe'), { code: 'EROFS' });
});
test('dedicated evidence and temporary mounts are writable', () => {
  for (const directory of ['evidence', 'tmp']) {
    const path = `/runtime/${directory}/.runtime-write-probe`;
    writeFileSync(path, 'probe', { flag: 'wx' });
    unlinkSync(path);
  }
});
test('model environment contains no Multica or provider credential variables', () => {
  for (const key of ['MULTICA_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    assert.equal(Object.hasOwn(process.env, key), false, key);
  }
});
