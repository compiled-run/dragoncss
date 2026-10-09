// Planted: a temp folder made at module scope; `vitest list` collects the file without running afterAll, so it leaks.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'dragon-planted-module-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('uses its module-scope temp folder', () => {
  expect(dir).toContain('dragon-planted-module-');
});
