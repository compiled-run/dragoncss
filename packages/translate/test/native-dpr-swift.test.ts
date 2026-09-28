import { describe, expect, it } from 'vitest';
import { committedFiles, runTarget } from '../src/check.ts';
import { buildExtendedCorpus } from '../src/corpus-dpr.ts';
import { describe as describeRun, swiftTool, writeReport } from '../src/native.ts';

// The corpus size the parity FIXTURES registry declares; a computed specifier, as the parity package is outside this project's rootDir.
const { declaredLayoutCaseCount } = (await import(new URL('../../parity/src/case-count.ts', import.meta.url).href)) as { declaredLayoutCaseCount: () => number };
const CASES = declaredLayoutCaseCount();

describe('Swift host run on the extended corpus (native:swift)', () => {
  it('the committed Swift engine reproduces vectors-m2, the DPR vectors, engine-dpr, units-m2 and snap bit for bit', () => {
    const x = buildExtendedCorpus();
    const r = runTarget('swift', x, committedFiles('swift'), 'test-swift-extended');
    writeReport(r, x, 'extended');
    console.log(describeRun(r, x));
    if (process.platform === 'darwin') expect(swiftTool(), 'the Swift toolchain is installed on the macOS reference machine').not.toBeNull();
    if (r.status === 'blocked (owner tooling)') {
      expect(swiftTool()).toBeNull();
      return;
    }
    const n = Object.fromEntries(x.suites.map((s) => [s.name, s.lines.length]));
    expect(r.suites.map((s) => `${s.name} ${s.pass}/${s.total}`)).toEqual([`vectors-m2 ${CASES - 258}/${CASES - 258}`, `vectors-dpr ${3 * CASES}/${3 * CASES}`, `engine-dpr ${n['engine-dpr']}/${n['engine-dpr']}`, `units-m2 ${n['units-m2']}/${n['units-m2']}`, `snap ${n['snap']}/${n['snap']}`]);
    expect(r.suites.every((s) => s.cause === null)).toBe(true);
    expect(r.status).toBe('pass');
  }, 600_000);
});
