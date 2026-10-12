// Planted: a temp folder made in a describe body; `vitest list` runs describe bodies without hooks, so it leaks.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

describe('a describe-scope temp folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dragon-planted-describe-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('uses it', () => {
    expect(dir).toContain('dragon-planted-describe-');
  });
});
