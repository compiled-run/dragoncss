// T132: a fake harness that crashes, is killed, times out or writes a short, missing or long result gives a named cause, never a bare count.
// Every fake harness runs under spawnSync with a bounded timeout, so none outlives its test; every corpus and result folder a test
// writes under packages/translate/out is removed after it, pass or fail.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Corpus, Suite } from '../src/corpus.ts';
import type { Exec, RunResult } from '../src/native.ts';
import { allPass, buildKotlin, buildSwift, describe as describeRun, execSuite, OUT, outputCause, publish, runSuites, stderrTail, suiteCause, withToolTmp } from '../src/native.ts';

/** The longest a fake harness may run unless a test sets its own limit; below the 30 s test timeout. */
const FAKE_MS = 20_000;
const TEST_MS = 30_000;

let made: string[] = [];
afterEach(() => {
  for (const p of made) rmSync(p, { recursive: true, force: true });
  made = [];
});

const lines = ['["a"]', '["b"]', '["c"]', '["d"]'];
/** A corpus with its own input folder (corpusFiles keys it on the first 16 characters of the digest, so each id is distinct there). */
const corpusOf = (id: string, suites: readonly Suite[]): Corpus => {
  const digest = `t132x${id}`.padEnd(32, '0');
  if (digest.length !== 32) throw new Error(`corpus id ${id} is too long`);
  made.push(join(OUT, 'corpus', digest.slice(0, 16)));
  return { suites, vectors: [], engineSplit: { ok: 0, unsupported: 0, refused: 0, threw: 0, harnessError: 0 }, digest, digests: {} };
};
const engine: Suite = { name: 'engine', mode: 'engine', lines, expected: lines };
const corpus = corpusOf('base', [engine]);
/** Runs the corpus's suites under a results tag removed after the test. */
const runAll = (c: Corpus, exec: Exec, tag: string, untilFailure = false) => {
  made.push(join(OUT, 'results', `test-t132-${tag}`), join(OUT, 'corpus', c.digest.slice(0, 16)));
  return runSuites(c, exec, `test-t132-${tag}`, untilFailure);
};

// The fake harness: node copies the first `keep` input lines to the output (all of them when keep is null), then runs `then`.
const fake = (then: string, keep: number | null = null, timeoutMs = FAKE_MS): Exec => (_mode, input, output) =>
  execSuite(process.execPath, ['-e', `const fs=require('fs');const l=fs.readFileSync(process.argv[1],'utf8').split('\\n').filter(Boolean);fs.writeFileSync(process.argv[2],l.slice(0,${keep ?? 'l.length'}).map(x=>x+'\\n').join(''));${then}`, input, output], timeoutMs);

const run = (exec: Exec, tag: string) => {
  const [s] = runAll(corpus, exec, tag);
  if (s === undefined) throw new Error('no suite result');
  return s;
};

describe('T132: a harness that does not account for every case is a named error', () => {
  it('a full result with exit 0 passes with no cause', () => {
    const s = run(fake(''), 'ok');
    expect([s.pass, s.total, s.cause]).toEqual([4, 4, null]);
  }, TEST_MS);

  it('a crash (non-zero exit) names the exit status and the stderr tail', () => {
    const s = run(fake(`console.error('Exception in thread "main" java.lang.OutOfMemoryError: Java heap space\\n\\tat Main.main');process.exit(3)`, 0), 'crash');
    expect(s.pass).toBe(0);
    expect(s.cause).toBe('crash: exit status 3; stderr tail: Exception in thread "main" java.lang.OutOfMemoryError: Java heap space | at Main.main');
  }, TEST_MS);

  it('a process killed by a signal names the signal', () => {
    const s = run(fake(`console.error('dying');process.kill(process.pid,'SIGKILL')`, 2), 'killed');
    expect(s.pass).toBe(2);
    expect(s.cause).toBe('crash: signal SIGKILL; stderr tail: dying');
  }, TEST_MS);

  // The 5 s limit leaves a loaded host time to start node and print before the kill; the child would run 120 s.
  it('a process past its timeout names the timeout and keeps what it printed', () => {
    const s = run(fake(`console.error('started');setTimeout(()=>{},120000)`, 0, 5000), 'timeout');
    expect(s.pass).toBe(0);
    expect(s.cause).toBe('timeout: killed after 5 s; stderr tail: started');
  }, TEST_MS);

  it('exit 0 with a short result is a short-output cause, not a count alone', () => {
    const s = run(fake('', 1), 'short');
    expect([s.pass, s.total]).toEqual([1, 4]);
    expect(s.cause).toBe('short output: exit 0 but 1 result lines for 4 cases');
  }, TEST_MS);

  it('exit 0 with no result file, or with more lines than cases, is named too', () => {
    const none: Exec = () => execSuite(process.execPath, ['-e', ''], FAKE_MS);
    expect(run(none, 'none').cause).toBe('no output: exit 0 but no result file was written (4 cases)');
    const long = run(fake(`require('fs').appendFileSync(process.argv[2],'["e"]\\n')`), 'long');
    expect(long.cause).toBe('long output: exit 0 but 5 result lines for 4 cases');
    expect(outputCause(true, 4, 4)).toBeNull();
  }, TEST_MS);

  it('a spawn error is a cause with its message', () => {
    expect(run(() => execSuite('/nonexistent/t132-harness', [], FAKE_MS), 'spawn').cause).toMatch(/^could not run: .*ENOENT/);
  }, TEST_MS);

  it('the stderr tail is one line and bounded, so the report and the lane parser read one suite line', () => {
    const tail = stderrTail(`${'x'.repeat(2000)}\n  last line  \n`);
    expect(tail).not.toContain('\n');
    expect(tail.length).toBeLessThanOrEqual(603);
    expect(tail.endsWith('x | last line')).toBe(true);
    expect(suiteCause({ status: 1, signal: null }, 1000)).toBe('crash: exit status 1');
  }, TEST_MS);

  it('describe prints the named cause on the suite line', () => {
    const s = run(fake('', 1), 'describe');
    const r: RunResult = { target: 'kotlin', status: 'fail', toolchain: 't', reason: null, buildSeconds: 0, runSeconds: 0, suites: [s] };
    expect(describeRun(r, corpus)).toMatch(/^engine corpus 1\/4 .*\(short output: exit 0 but 1 result lines for 4 cases\)$/m);
  }, TEST_MS);

  // PR #48 finding 4151492050: a suite whose every expected line matched still fails when its process did not account for its cases.
  it('a suite with a cause never passes, even when its count is whole (extra lines, or an empty suite with no output)', () => {
    const long = run(fake(`require('fs').appendFileSync(process.argv[2],'["e"]\\n')`), 'allpass-long');
    expect([long.pass, long.total]).toEqual([4, 4]);
    expect(allPass([long])).toBe(false);
    const empty = corpusOf('empty', [{ name: 'engine', mode: 'engine', lines: [], expected: [] }]);
    const [none] = runAll(empty, () => execSuite(process.execPath, ['-e', ''], FAKE_MS), 'allpass-empty');
    expect(none).toMatchObject({ pass: 0, total: 0, cause: 'no output: exit 0 but no result file was written (0 cases)' });
    expect(allPass(none === undefined ? [] : [none])).toBe(false);
    expect(allPass([run(fake(''), 'allpass-ok')])).toBe(true);
  }, TEST_MS);

  it('untilFailure stops after a suite with a cause, as after one with failing cases', () => {
    const two = corpusOf('two', [{ name: 'vectors', mode: 'engine', lines, expected: lines }, engine]);
    const extra = fake(`require('fs').appendFileSync(process.argv[2],'["e"]\\n')`);
    expect(runAll(two, extra, 'until', true).map((s) => s.name)).toEqual(['vectors']);
  }, TEST_MS);

  it('every line terminator in stderr (\\r, U+2028, U+2029) becomes a separator, so the cause stays on one report line', () => {
    expect(stderrTail('a\rb\r\nc\u2028d\u2029e')).toBe('a | b | c | d | e');
    expect(suiteCause({ status: 1, signal: null, stderr: 'x\ry' }, 1000)).toBe('crash: exit status 1; stderr tail: x | y');
  }, TEST_MS);

  it('a failed build removes its work directory and throws the compiler output', () => {
    const files = new Map([['harness/Main.kt', 'fun main() {}'], ['Sources/DragonLayout/A.swift', 'let a = 1']]);
    const leftovers = (lang: string): string[] => (existsSync(join(OUT, lang)) ? readdirSync(join(OUT, lang)).filter((d) => d.endsWith(`.build-${process.pid}`)) : []);
    expect(() => buildKotlin({ kotlinc: process.execPath, javaHome: '/nonexistent', version: 't132-failed-build' }, files)).toThrow(/^kotlinc failed:/);
    expect(leftovers('kotlin')).toEqual([]);
    expect(() => buildSwift({ swiftc: process.execPath, version: 't132-failed-build' }, files)).toThrow(/^swiftc -typecheck of the engine module failed:/);
    expect(leftovers('swift')).toEqual([]);
  }, TEST_MS);

  it('withToolTmp gives the compiler its own TMPDIR and removes it after a return and after a throw (TMP-LEAK)', () => {
    let seen = '';
    expect(withToolTmp((env) => {
      seen = env['TMPDIR'] as string;
      return existsSync(seen);
    })).toBe(true);
    expect(existsSync(seen)).toBe(false);
    expect(() => withToolTmp((env) => {
      seen = env['TMPDIR'] as string;
      throw new Error('planted');
    })).toThrow('planted');
    expect(existsSync(seen)).toBe(false);
  });
});

describe('the harness build cache recovers from a stale entry', () => {
  /** Every file under dir removed, its directories kept: what the landing driver's ignored-file cleanup left under out/. */
  const deleteFilesOnly = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) deleteFilesOnly(p);
      else rmSync(p);
    }
  };

  it('a cache directory whose jar was deleted is rebuilt and republished, never returned without its jar', () => {
    const bin = mkdtempSync(join(tmpdir(), 'dragon-fake-kotlinc-'));
    made.push(bin);
    const kotlinc = join(bin, 'kotlinc');
    writeFileSync(kotlinc, '#!/bin/sh\nwhile [ $# -gt 1 ]; do if [ "$1" = -d ]; then echo built > "$2"; fi; shift; done\n');
    chmodSync(kotlinc, 0o755);
    const tool = { kotlinc, javaHome: '/nonexistent', version: `stale-entry-${process.pid}` };
    const files = new Map([['harness/Main.kt', 'fun main() {}']]);
    const first = buildKotlin(tool, files);
    made.push(dirname(first.jar));
    expect([first.cached, readFileSync(first.jar, 'utf8')]).toEqual([false, 'built\n']);
    expect(buildKotlin(tool, files).cached).toBe(true);
    deleteFilesOnly(dirname(first.jar));
    expect(existsSync(join(dirname(first.jar), 'src'))).toBe(true);
    const again = buildKotlin(tool, files);
    expect([again.jar, again.cached, readFileSync(again.jar, 'utf8')]).toEqual([first.jar, false, 'built\n']);
    expect(readdirSync(dirname(dirname(first.jar))).filter((d) => d.endsWith(`.build-${process.pid}`))).toEqual([]);
  }, TEST_MS);

  it('publish keeps a concurrent winner that has the artifacts and drops its own copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'dragon-publish-'));
    made.push(root);
    const dir = join(root, 'key');
    const work = join(root, 'key.build-1');
    for (const [d, text] of [[dir, 'winner'], [work, 'mine']] as const) {
      mkdirSync(join(d, 'src'), { recursive: true });
      writeFileSync(join(d, 'harness.jar'), text);
    }
    publish(work, dir);
    expect([readFileSync(join(dir, 'harness.jar'), 'utf8'), existsSync(work)]).toEqual(['winner', false]);
  }, TEST_MS);
});
