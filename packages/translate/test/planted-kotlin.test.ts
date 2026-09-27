import { describe, expect, it } from 'vitest';
import { expectedFiles, runTarget } from '../src/check.ts';
import { buildCorpus } from '../src/corpus.ts';
import { FAULTS } from '../src/faults.ts';
import { lowerAll } from '../src/generate.ts';
import { failures, kotlinTool } from '../src/native.ts';

describe('planted translator faults, Kotlin (native:planted -- --target kotlin)', () => {
  it('each planted fault makes at least one vector or corpus case fail, or the run is blocked (owner tooling), never passed', () => {
    const l = lowerAll();
    const c = buildCorpus();
    const caught: string[] = [];
    for (const f of FAULTS) {
      const r = runTarget('kotlin', c, expectedFiles('kotlin', l, f.id), `test-planted-kotlin-${f.id}`, true);
      if (r.status === 'blocked (owner tooling)') {
        expect(kotlinTool()).toBeNull();
        return;
      }
      const n = failures(r.suites);
      console.log(`kotlin ${f.id}: ${n} failing cases in ${r.suites.map((s) => s.name).join(', ')}`);
      if (n > 0) caught.push(f.id);
    }
    expect(caught).toEqual(FAULTS.map((f) => f.id));
  }, 900_000);
});
