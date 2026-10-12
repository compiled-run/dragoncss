// The fix of module-scope.planted.ts: the temp folder is made in beforeAll, which `vitest list` does not run.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dragon-planted-hooked-'));
});
afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

it('uses its hooked temp folder', () => {
  expect(dir).toContain('dragon-planted-hooked-');
});
