// Planted: a test that makes a temp folder and never removes it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('leaves a temp folder behind', () => {
  expect(mkdtempSync(join(tmpdir(), 'dragon-planted-leak-'))).toContain('dragon-planted-leak-');
});
