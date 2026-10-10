// One planted translator fault on one target (native:planted -- --target <target>): each (target, fault) pair is its own test
// file so the native compiles run on separate workers and shards; planted-union.test.ts proves the files cover FAULTS exactly.
import { describe, expect, it } from 'vitest';
import type { Target } from '../src/check.ts';
import { expectedFiles, runTarget } from '../src/check.ts';
import { buildCorpus } from '../src/corpus.ts';
import type { Fault } from '../src/faults.ts';
import { FAULTS } from '../src/faults.ts';
import { lowerAll } from '../src/generate.ts';
import { failures, isBlocked, kotlinTool, swiftTool } from '../src/native.ts';

export const PLANTED_TITLE: Record<Target, string> = {
  swift: 'planted translator faults, Swift (native:planted -- --target swift)',
  kotlin: 'planted translator faults, Kotlin (native:planted -- --target kotlin)',
};

export function plantedFaultTest(target: Target, fault: Fault): void {
  if (!FAULTS.some((f) => f.id === fault)) throw new Error(`${fault} is not in FAULTS`);
  const tool = (): unknown => (target === 'swift' ? swiftTool() : kotlinTool());
  describe(PLANTED_TITLE[target], () => {
    it(`${fault} makes at least one vector or corpus case fail, or the run is blocked (owner tooling), never passed`, () => {
      const l = lowerAll();
      const c = buildCorpus();
      if (target === 'swift' && process.platform === 'darwin') expect(swiftTool(), 'swiftc is part of Xcode on the macOS reference machine').not.toBeNull();
      const r = runTarget(target, c, expectedFiles(target, l, fault), `test-planted-${target}-${fault}`, true);
      if (isBlocked(r)) {
        expect(tool()).toBeNull();
        return;
      }
      const n = failures(r.suites);
      console.log(`${target} ${fault}: ${n} failing cases in ${r.suites.map((s) => s.name).join(', ')}`);
      expect(n, `${target} ${fault} must fail at least one case`).toBeGreaterThan(0);
    }, 900_000);
  });
}
