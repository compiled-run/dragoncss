// Control: a test that makes a temp folder and removes it after the test.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished } from 'vitest';

it('removes its temp folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dragon-planted-clean-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  expect(dir).toContain('dragon-planted-clean-');
});
