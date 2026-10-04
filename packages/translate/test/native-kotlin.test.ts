import { describe, expect, it } from 'vitest';
import { committedFiles, runTarget } from '../src/check.ts';
import { buildCorpus } from '../src/corpus.ts';
import { describe as describeRun, kotlinTool, writeReport } from '../src/native.ts';

describe('Kotlin host run (native:kotlin)', () => {
  it('the committed Kotlin engine reproduces every suite bit for bit, or is reported blocked (owner tooling) without a JDK 17 and kotlinc, never passed', () => {
    const c = buildCorpus();
    const r = runTarget('kotlin', c, committedFiles('kotlin'), 'test-kotlin');
    writeReport(r, c);
    console.log(describeRun(r, c));
    if (kotlinTool() === null) {
      expect(r.status).toBe('blocked (owner tooling)');
      expect(r.suites).toEqual([]);
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
