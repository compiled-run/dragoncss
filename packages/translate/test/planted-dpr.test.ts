// The extended planted fault (notes/T010-p2-triage.md ruling 4): snap-truncating-division must fail at least one case of the
// extended corpus on both targets. The P1 faults stay pinned by planted-swift.test.ts and planted-kotlin.test.ts; the CLI
// (pnpm run native:planted) runs every EXTENDED_FAULTS fault on both corpora.
import { describe, expect, it } from 'vitest';
import { expectedFiles, runTarget } from '../src/check.ts';
import type { Target } from '../src/check.ts';
import { buildExtendedCorpus } from '../src/corpus-dpr.ts';
import { EXTENDED_FAULTS } from '../src/faults.ts';
import { lowerAll } from '../src/generate.ts';
import { failures, kotlinTool, swiftTool } from '../src/native.ts';

describe('planted translator fault snap-truncating-division (native:planted)', () => {
  const l = lowerAll();
  const x = buildExtendedCorpus();

  it('is defined for both emitters and changes the translated snapEdge on both', () => {
    const f = EXTENDED_FAULTS.find((y) => y.id === 'snap-truncating-division');
    expect(f?.kind).toBe('ir');
    for (const target of ['swift', 'kotlin'] as const) {
      const planted = expectedFiles(target, l, 'snap-truncating-division');
      const clean = expectedFiles(target, l);
      const changed = [...planted.keys()].filter((k) => planted.get(k) !== clean.get(k));
      expect(changed.length, target).toBeGreaterThan(0);
      expect(changed.some((k) => /Units\.(swift|kt)$/.test(k)), target).toBe(true);
    }
  });

  for (const target of ['swift', 'kotlin'] as const satisfies readonly Target[]) {
    it(`${target}: fails at least one extended corpus case`, () => {
      if (process.platform === 'darwin') expect(target === 'swift' ? swiftTool() : kotlinTool(), `${target} toolchain`).not.toBeNull();
      const r = runTarget(target, x, expectedFiles(target, l, 'snap-truncating-division'), `test-planted-${target}-snap`, true);
      if (r.status === 'blocked (owner tooling)') {
        expect(target === 'swift' ? swiftTool() : kotlinTool()).toBeNull();
        return;
      }
      console.log(`${target} snap-truncating-division: ${failures(r.suites)} failing cases in ${r.suites.map((s) => `${s.name} ${s.total - s.pass}`).join(', ')}`);
      expect(failures(r.suites)).toBeGreaterThan(0);
      expect(r.status).toBe('fail');
    }, 600_000);
  }
});
