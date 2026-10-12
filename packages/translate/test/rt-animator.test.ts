// T065 ANIM-b1 3b: the runtime animator is a translated root, and the animator suite runs it over every frame case's tables and
// script, so the generated Swift and Kotlin runtimes are judged against the TypeScript reference the frame lanes judge against
// Chrome (packages/parity anim-report).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLibraryCase } from '../harness/harness.ts';
import { ANIMATOR_VECTORS, animatorCases, animatorExpected, buildCorpus } from '../src/corpus.ts';
import { engineFiles, engineRoots, LAYOUT_SRC } from '../src/generate.ts';

describe('animator suite (ANIM-b1 3b)', () => {
  it('translates the animator: its event, advance, frame, colour and input-patch functions are engine roots', () => {
    const roots = engineRoots(engineFiles());
    for (const fn of ['animatorStart', 'animatorEvent', 'animatorAdvance', 'animatorFrame', 'animatorBusy', 'frameColors', 'patchInput', 'lengthBase']) {
      expect(roots.some((r) => r.file === join(LAYOUT_SRC, 'rt-animator.ts') && r.name === fn), fn).toBe(true);
    }
  });

  it('has one line per frame case, after the hit suite, each answered by the TypeScript reference', () => {
    const cases = (JSON.parse(readFileSync(ANIMATOR_VECTORS, 'utf8')) as { cases: readonly unknown[] }).cases;
    const lines = animatorCases();
    expect(lines.length).toBe(cases.length);
    expect(lines.length).toBeGreaterThan(0);
    const expected = animatorExpected(lines);
    expect(expected.every((e) => e.startsWith('["ok",'))).toBe(true);
    const names = buildCorpus().suites.map((s) => s.name);
    expect(names.indexOf('animator')).toBe(names.indexOf('hit') + 1);
  }, 600_000);

  it('refuses a line it cannot read rather than computing from a guess', () => {
    const line = JSON.parse(animatorCases()[0] as string) as unknown[];
    const withSteps = (steps: unknown): string => JSON.stringify([line[0], line[1], line[2], line[3], steps]);
    expect(runLibraryCase(withSteps([['jump', 1]]))).toMatch(/^\["harness-error","\$\[4\]\[0\]: unknown step jump"\]$/);
    expect(runLibraryCase(JSON.stringify([line[0], { assignments: 1 }, line[2], line[3], []]))).toMatch(/^\["harness-error",/);
    // An event to an assignment the tables do not have is the animator's own refusal: the reference throws.
    expect(runLibraryCase(withSteps([['event', 99]]))).toBe('["threw"]');
    expect(() => animatorExpected([withSteps([['event', 99]])])).toThrow(/animator case 0: the TypeScript reference answered \["threw"\]/);
  }, 600_000);
});
