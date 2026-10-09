// Planted for the collection-time mkdtemp scan in tmpdir-guard.test.ts: each `BAD` line must be reported, no `OK` line may be.
// Never run: its include name is not a test file's.
import { mkdtemp, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it, test } from 'vitest';

const t = (): string => join(tmpdir(), 'x-');
const top = mkdtempSync(t()); // BAD module scope
function helper(): string {
  return mkdtempSync(t()); // OK only reached through a call
}
const arrowHelper = (): string => helper();
const unused = helper; // OK a reference, not a call

describe('collection time', () => {
  const a = mkdtempSync(t()); // BAD describe scope
  const b = helper(); // BAD helper called in a describe body
  const c = arrowHelper(); // BAD helper of a helper called in a describe body
  const d = [1].map(() => mkdtempSync(t())); // BAD an inline callback runs now
  describe('nested', () => {
    mkdtemp(t(), () => undefined); // BAD nested describe scope
  });
  describe.each([1])('each %s', () => {
    helper(); // BAD describe.each body
  });
  beforeAll(() => {
    mkdtempSync(t()); // OK hook
  });
  beforeEach(() => helper()); // OK hook
  afterAll(() => helper()); // OK hook
  it('in a test', () => {
    mkdtempSync(t()); // OK test
    arrowHelper(); // OK test
  });
  test.each([1])('each %s', () => {
    helper(); // OK test.each
  });
  void [top, a, b, c, d, unused];
});
