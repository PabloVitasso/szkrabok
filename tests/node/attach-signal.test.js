import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAttachSignal } from '../../src/attach-signal.js';

test('writes signal file with content ok', async () => {
  const dir  = await mkdtemp(join(tmpdir(), 'signal-'));
  const path = join(dir, '.attach-signal');
  await writeAttachSignal(path);
  assert.equal(await readFile(path, 'utf8'), 'ok');
  assert.ok(!existsSync(path + '.tmp'), '.tmp must be cleaned up by rename');
  await rm(dir, { recursive: true });
});

test('is a no-op when path is empty or falsy', async () => {
  await assert.doesNotReject(() => writeAttachSignal(''));
  await assert.doesNotReject(() => writeAttachSignal(null));
});

test('throws on unwritable path (fail-fast)', async () => {
  await assert.rejects(() => writeAttachSignal('/nonexistent/dir/.signal'));
});
