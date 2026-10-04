import { describe, expect, it } from 'vitest';
import { committedFiles, runTarget } from '../src/check.ts';
import { buildCorpus } from '../src/corpus.ts';
import { describe as describeRun, swiftTool, writeReport } from '../src/native.ts';

describe('Swift host run (native:swift)', () => {
  it('the committed Swift engine reproduces the vectors, the units corpus, the engine corpus and the library corpus bit for bit', () => {
    const c = buildCorpus();
    const r = runTarget('swift', c, committedFiles('swift'), 'test-swift');
    writeReport(r, c);
    console.log(describeRun(r, c));
    if (process.platform === 'darwin') expect(swiftTool(), 'swiftc is part of Xcode on the macOS reference machine').not.toBeNull();
    if (r.status === 'blocked (owner tooling)') {
      expect(swiftTool()).toBeNull();
      return;
    }
    // A suite that timed out, crashed or wrote a short result fails here with its cause (exit, signal, stderr tail), not only a count.
    expect(r.suites.filter((s) => s.cause !== null).map((s) => `${s.name}: ${s.cause}`)).toEqual([]);
    // PIN-DERIVE: every suite of the corpus ran in full and passed, sized from the corpus rather than literals; rt-vectors.test.ts
    // keeps the corpus above its floor (p1-floor.json), so a shrunk corpus fails there even where this run is blocked.
    expect(r.suites.map((s) => `${s.name} ${s.pass}/${s.total}`)).toEqual(c.suites.map((s) => `${s.name} ${s.lines.length}/${s.lines.length}`));
    expect(r.status).toBe('pass');
  }, 600_000);
});
