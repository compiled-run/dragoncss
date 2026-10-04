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
    expect(r.suites.map((s) => `${s.name} ${s.pass}/${s.total}`)).toEqual(['vectors 258/258', 'units 320000/320000', 'engine 20258/20258', 'library 22000/22000', 'rt 54588/54588', 'hit 2068/2068']);
    expect(r.status).toBe('pass');
  }, 600_000);
});
