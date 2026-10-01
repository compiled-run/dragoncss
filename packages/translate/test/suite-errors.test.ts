// T132: a fake harness that crashes, is killed, times out or writes a short, missing or long result gives a named cause, never a bare count.
import { describe, expect, it } from 'vitest';
import type { Corpus } from '../src/corpus.ts';
import type { Exec, RunResult } from '../src/native.ts';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { allPass, buildKotlin, buildSwift, describe as describeRun, OUT, execSuite, outputCause, runSuites, stderrTail, suiteCause } from '../src/native.ts';

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

  // The 5 s limit leaves a loaded host time to start node and print before the kill; the child would run 120 s.
  it('a process past its timeout names the timeout and keeps what it printed', () => {
    const s = run(fake(`console.error('started');setTimeout(()=>{},120000)`, 0, 5000), 'timeout');
    expect(s.pass).toBe(0);
    expect(s.cause).toBe('timeout: killed after 5 s; stderr tail: started');
  }, 30_000);

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

  // PR #48 finding 4151492050: a suite whose every expected line matched still fails when its process did not account for its cases.
  it('a suite with a cause never passes, even when its count is whole (extra lines, or an empty suite with no output)', () => {
    const long = run(fake(`require('fs').appendFileSync(process.argv[2],'["e"]\\n')`), 'allpass-long');
    expect([long.pass, long.total]).toEqual([4, 4]);
    expect(allPass([long])).toBe(false);
    const empty: Corpus = { ...corpus, digest: 't132-fake-harness-empty-000000000', suites: [{ name: 'engine', mode: 'engine', lines: [], expected: [] }] };
    const [none] = runSuites(empty, () => execSuite(process.execPath, ['-e', '']), 'test-t132-allpass-empty');
    expect(none).toMatchObject({ pass: 0, total: 0, cause: 'no output: exit 0 but no result file was written (0 cases)' });
    expect(allPass(none === undefined ? [] : [none])).toBe(false);
    expect(allPass([run(fake(''), 'allpass-ok')])).toBe(true);
  });

  it('untilFailure stops after a suite with a cause, as after one with failing cases', () => {
    const two: Corpus = { ...corpus, digest: 't132-fake-harness-two-00000000000', suites: [{ name: 'vectors', mode: 'engine', lines, expected: lines }, { name: 'engine', mode: 'engine', lines, expected: lines }] };
    const extra = fake(`require('fs').appendFileSync(process.argv[2],'["e"]\\n')`);
    expect(runSuites(two, extra, 'test-t132-until', true).map((s) => s.name)).toEqual(['vectors']);
  });

  it('every line terminator in stderr (\\r, U+2028, U+2029) becomes a separator, so the cause stays on one report line', () => {
    expect(stderrTail('a\rb\r\nc\u2028d\u2029e')).toBe('a | b | c | d | e');
    expect(suiteCause({ status: 1, signal: null, stderr: 'x\ry' }, 1000)).toBe('crash: exit status 1; stderr tail: x | y');
  });

  it('a failed build removes its work directory and throws the compiler output', () => {
    const files = new Map([['harness/Main.kt', 'fun main() {}'], ['Sources/DragonLayout/A.swift', 'let a = 1']]);
    const leftovers = (lang: string): string[] => (existsSync(join(OUT, lang)) ? readdirSync(join(OUT, lang)).filter((d) => d.endsWith(`.build-${process.pid}`)) : []);
    expect(() => buildKotlin({ kotlinc: process.execPath, javaHome: '/nonexistent', version: 't132-failed-build' }, files)).toThrow(/^kotlinc failed:/);
    expect(leftovers('kotlin')).toEqual([]);
    expect(() => buildSwift({ swiftc: process.execPath, version: 't132-failed-build' }, files)).toThrow(/^swiftc -typecheck of the engine module failed:/);
    expect(leftovers('swift')).toEqual([]);
  });
});
