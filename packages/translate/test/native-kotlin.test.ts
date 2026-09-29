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
    expect(r.suites.map((s) => `${s.name} ${s.pass}/${s.total}`)).toEqual(['vectors 258/258', 'units 320000/320000', 'engine 20258/20258', 'library 22000/22000', 'rt 54588/54588']);
    expect(r.status).toBe('pass');
  }, 600_000);
});
