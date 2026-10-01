// T132: a fake harness that crashes, is killed, times out or writes a short, missing or long result gives a named cause, never a bare count.
import { describe, expect, it } from 'vitest';
import type { Corpus } from '../src/corpus.ts';
import type { Exec, RunResult } from '../src/native.ts';
import { describe as describeRun, execSuite, outputCause, runSuites, stderrTail, suiteCause } from '../src/native.ts';

const lines = ['["a"]', '["b"]', '["c"]', '["d"]'];
const corpus: Corpus = {
  suites: [{ name: 'engine', mode: 'engine', lines, expected: lines }],
  vectors: [],
  engineSplit: { ok: 0, unsupported: 0, refused: 0, threw: 0, harnessError: 0 },
  digest: 't132-fake-harness-0000000000000000',
  digests: {},
};

// The fake harness: node copies the first `keep` input lines to the output (all of them when keep is null), then runs `then`.
const fake = (then: string, keep: number | null = null, timeoutMs?: number): Exec => (_mode, input, output) =>
  execSuite(process.execPath, ['-e', `const fs=require('fs');const l=fs.readFileSync(process.argv[1],'utf8').split('\\n').filter(Boolean);fs.writeFileSync(process.argv[2],l.slice(0,${keep ?? 'l.length'}).map(x=>x+'\\n').join(''));${then}`, input, output], timeoutMs);

const run = (exec: Exec, tag: string) => {
  const [s] = runSuites(corpus, exec, `test-t132-${tag}`);
  if (s === undefined) throw new Error('no suite result');
  return s;
};

describe('T132: a harness that does not account for every case is a named error', () => {
  it('a full result with exit 0 passes with no cause', () => {
    const s = run(fake(''), 'ok');
    expect([s.pass, s.total, s.cause]).toEqual([4, 4, null]);
  });

  it('a crash (non-zero exit) names the exit status and the stderr tail', () => {
    const s = run(fake(`console.error('Exception in thread "main" java.lang.OutOfMemoryError: Java heap space\\n\\tat Main.main');process.exit(3)`, 0), 'crash');
    expect(s.pass).toBe(0);
    expect(s.cause).toBe('crash: exit status 3; stderr tail: Exception in thread "main" java.lang.OutOfMemoryError: Java heap space | at Main.main');
  });

  it('a process killed by a signal names the signal', () => {
    const s = run(fake(`console.error('dying');process.kill(process.pid,'SIGKILL')`, 2), 'killed');
    expect(s.pass).toBe(2);
    expect(s.cause).toBe('crash: signal SIGKILL; stderr tail: dying');
  });

  it('a process past its timeout names the timeout and keeps what it printed', () => {
    const s = run(fake(`console.error('started');setTimeout(()=>{},10000)`, 0, 500), 'timeout');
    expect(s.pass).toBe(0);
    expect(s.cause).toBe('timeout: killed after 0.5 s; stderr tail: started');
  });

  it('exit 0 with a short result is a short-output cause, not a count alone', () => {
    const s = run(fake('', 1), 'short');
    expect([s.pass, s.total]).toEqual([1, 4]);
    expect(s.cause).toBe('short output: exit 0 but 1 result lines for 4 cases');
  });

  it('exit 0 with no result file, or with more lines than cases, is named too', () => {
    const none: Exec = () => execSuite(process.execPath, ['-e', '']);
    expect(run(none, 'none').cause).toBe('no output: exit 0 but no result file was written (4 cases)');
    const long = run(fake(`require('fs').appendFileSync(process.argv[2],'["e"]\\n')`), 'long');
    expect(long.cause).toBe('long output: exit 0 but 5 result lines for 4 cases');
    expect(outputCause(true, 4, 4)).toBeNull();
  });

  it('a spawn error is a cause with its message', () => {
    expect(run(() => execSuite('/nonexistent/t132-harness', []), 'spawn').cause).toMatch(/^could not run: .*ENOENT/);
  });

  it('the stderr tail is one line and bounded, so the report and the lane parser read one suite line', () => {
    const tail = stderrTail(`${'x'.repeat(2000)}\n  last line  \n`);
    expect(tail).not.toContain('\n');
    expect(tail.length).toBeLessThanOrEqual(603);
    expect(tail.endsWith('x | last line')).toBe(true);
    expect(suiteCause({ status: 1, signal: null }, 1000)).toBe('crash: exit status 1');
  });

  it('describe prints the named cause on the suite line', () => {
    const s = run(fake('', 1), 'describe');
    const r: RunResult = { target: 'kotlin', status: 'fail', toolchain: 't', reason: null, buildSeconds: 0, runSeconds: 0, suites: [s] };
    expect(describeRun(r, corpus)).toMatch(/^engine corpus 1\/4 .*\(short output: exit 0 but 1 result lines for 4 cases\)$/m);
  });
});
