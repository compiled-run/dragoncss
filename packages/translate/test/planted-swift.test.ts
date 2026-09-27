import { describe, expect, it } from 'vitest';
import { expectedFiles, runTarget } from '../src/check.ts';
import { buildCorpus } from '../src/corpus.ts';
import { FAULTS } from '../src/faults.ts';
import { lowerAll } from '../src/generate.ts';
import { failures, swiftTool } from '../src/native.ts';

describe('planted translator faults, Swift (native:planted -- --target swift)', () => {
  it('each planted fault makes at least one vector or corpus case fail', () => {
    const l = lowerAll();
    const c = buildCorpus();
    if (process.platform === 'darwin') expect(swiftTool(), 'swiftc is part of Xcode on the macOS reference machine').not.toBeNull();
    const caught: string[] = [];
    for (const f of FAULTS) {
      const r = runTarget('swift', c, expectedFiles('swift', l, f.id), `test-planted-swift-${f.id}`, true);
      if (r.status === 'blocked (owner tooling)') {
        expect(swiftTool()).toBeNull();
        return;
      }
      const n = failures(r.suites);
      console.log(`swift ${f.id}: ${n} failing cases in ${r.suites.map((s) => s.name).join(', ')}`);
      if (n > 0) caught.push(f.id);
    }
    expect(caught).toEqual(FAULTS.map((f) => f.id));
  }, 900_000);
});
