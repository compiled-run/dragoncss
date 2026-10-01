// T132: a host lane whose suite process timed out, crashed or wrote a short result records that cause, and a host CLI that crashes
// or exits against its printed status records its exit, signal and stderr tail, never a bare count.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { HostRun } from '../src/lanes.ts';
import { hostEnd, judgeHost, lanesFile, parseNativeOutput, runHostLane } from '../src/lanes.ts';
import { repoPath } from '../src/paths.ts';
import type { NativeTarget, TargetConfig } from '../src/targets.ts';
import { nativeTargets } from '../src/targets.ts';

const targets = nativeTargets();
const android = targets.find((t) => t.target === 'android') as TargetConfig;
const kotlinOut = readFileSync(join(import.meta.dirname, 'native-output', 'kotlin.txt'), 'utf8');
const ENGINE_LINE = /^engine corpus 20258\/20258 .*$/m;
const FINAL = /status pass$/m;
const tmp = mkdtempSync(join(tmpdir(), 'dragon-t132-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type TranslateCauses = {
  readonly suiteCause: (r: { status: number | null; signal: NodeJS.Signals | null; error?: Error; stderr?: string }, timeoutMs: number) => string | null;
  readonly outputCause: (written: boolean, lines: number, cases: number) => string | null;
  readonly kotlinTool: () => unknown;
};
// packages/parity does not depend on packages/translate, so its cause wording is loaded at run time, as lanes.ts loads its tools.
const translate = async (): Promise<TranslateCauses> => (await import(pathToFileURL(repoPath('packages/translate/src/native.ts')).href)) as TranslateCauses;

describe('T132: suite causes reach the host lane verdict', () => {
  it('a suite line with a trailing cause parses to the same label and counts, and the cause is a problem', () => {
    const cause = 'crash: signal SIGKILL; stderr tail: Exception (x 1/2) | at Main.main';
    const out = kotlinOut.replace(ENGINE_LINE, (l) => `${l.replace('20258/20258', '0/20258')} (${cause})`).replace(FINAL, 'status fail');
    const plain = parseNativeOutput(kotlinOut);
    const parsed = parseNativeOutput(out);
    expect(parsed?.suites.map((s) => `${s.corpus}/${s.suite}`)).toEqual(plain?.suites.map((s) => `${s.corpus}/${s.suite}`));
    expect(parsed?.suites.find((s) => s.suite === 'engine')).toMatchObject({ corpus: 'p1', pass: 0, total: 20258, cause });
    expect(parsed?.suites.filter((s) => s.cause !== null)).toHaveLength(1);
    expect(plain?.suites.every((s) => s.cause === null)).toBe(true);
    expect(judgeHost(android, parsed).reason).toContain(`p1/engine: ${cause}`);
  });

  it('any label keeps its first count with a cause after the note (PR #42 any-label rule)', () => {
    const parsed = parseNativeOutput(`extended corpus:\ncalc (v2) 7/9 (note 1/2) (timeout: killed after 180 s)\nnative:kotlin: P1 corpus digest 00; extended corpus digest 00; status fail`);
    expect(parsed?.suites).toEqual([{ corpus: 'extended', suite: 'calc (v2)', pass: 7, total: 9, cause: 'timeout: killed after 180 s' }]);
  });

  it('every cause the translate runner writes parses back', async () => {
    const t = await translate();
    const causes = [
      t.suiteCause({ status: null, signal: 'SIGKILL', error: Object.assign(new Error('spawnSync java ETIMEDOUT'), { code: 'ETIMEDOUT' }), stderr: 'started' }, 180_000),
      t.suiteCause({ status: null, signal: 'SIGSEGV', stderr: '' }, 180_000),
      t.suiteCause({ status: 3, signal: null, stderr: 'java.lang.OutOfMemoryError: Java heap space\n\tat Main' }, 180_000),
      t.suiteCause({ status: null, signal: null, error: Object.assign(new Error('spawnSync /x ENOENT'), { code: 'ENOENT' }) }, 180_000),
      t.outputCause(false, 0, 4),
      t.outputCause(true, 1, 4),
      t.outputCause(true, 5, 4),
    ];
    for (const c of causes) {
      expect(c).not.toBeNull();
      const parsed = parseNativeOutput(`snap 1/4 (${c})\nnative:kotlin: P1 corpus digest 00; extended corpus digest 00; status fail`);
      expect(parsed?.suites[0]?.cause, c ?? '').toBe(c);
    }
  });

  it('a host CLI that crashes before its final line records its signal and stderr tail; an exit against the printed status is a problem', async () => {
    const t = await translate();
    // Without a JDK and kotlinc the lane is blocked before any command runs, which is its own tested path (lanes.test.ts).
    if (t.kotlinTool() === null) return expect((await runHostLane(android, { command: ['-e', 'process.exit(9)'] })).state).toBe('blocked (owner tooling)');
    const crashed = await runHostLane(android, { command: ['-e', "console.log('native:kotlin: kotlinc');console.error('Error: boom');process.kill(process.pid,'SIGKILL')"] });
    expect(crashed).toMatchObject({ state: 'fail', reason: 'native:kotlin output could not be parsed; exit -, signal SIGKILL; stderr tail: Error: boom' });
    const file = join(tmp, 'pass.txt');
    writeFileSync(file, kotlinOut);
    const lying = await runHostLane(android, { command: ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(file)},'utf8'));process.exitCode=3`] });
    expect(lying.state).toBe('fail');
    expect(lying.reason).toContain('native:kotlin printed status pass but ended with exit 3, signal -; stderr (empty)');
  });

  it('a host lane with a killed Kotlin suite (fake harness) records the cause in its lanes.json reason', async () => {
    const t = await translate();
    // Without a JDK and kotlinc the lane is blocked before any command runs, which is its own tested path (lanes.test.ts).
    if (t.kotlinTool() === null) return expect((await runHostLane(android, { command: ['-e', 'process.exit(9)'] })).state).toBe('blocked (owner tooling)');
    const dir = tmp;
    const committed = join(dir, 'kotlin.txt');
    writeFileSync(committed, kotlinOut);
    // The fake host CLI runs the engine suite through the translate runner with a harness that kills itself, then prints the
    // committed native:kotlin output with the runner's own engine line in place of the passing one, as the real CLI would.
    const cli = join(dir, 'fake-native.ts');
    writeFileSync(cli, `
import { readFileSync } from 'node:fs';
import { describe, execSuite, runSuites } from ${JSON.stringify(repoPath('packages/translate/src/native.ts'))};
const lines = ['["a"]', '["b"]'];
const corpus = { suites: [{ name: 'engine', mode: 'engine', lines, expected: lines }], vectors: [], engineSplit: { ok: 0, unsupported: 0, refused: 0, threw: 0, harnessError: 0 }, digest: 't132-fake-host-lane-000000000000', digests: {} };
const killed = (_m, _i, _o) => execSuite(process.execPath, ['-e', "console.error('Killed: 9'); process.kill(process.pid, 'SIGKILL')"]);
const s = runSuites(corpus, killed, 'test-t132-host-lane')[0];
const r = { target: 'kotlin', status: 'fail', toolchain: 't', reason: null, buildSeconds: 0, runSeconds: 0, suites: [{ ...s, total: 20258 }] };
const line = describe(r, corpus).split('\\n').find((l) => l.startsWith('engine corpus '));
process.stdout.write(readFileSync(${JSON.stringify(committed)}, 'utf8').replace(/^engine corpus 20258\\/20258 .*$/m, line).replace(/status pass$/m, 'status fail'));
process.exitCode = 1;
`);
    const run = await runHostLane(android, { command: [cli] });
    expect(run.state).toBe('fail');
    expect(run.reason).toContain('p1/engine 0/20258, declared 20258');
    expect(run.reason).toContain('p1/engine: crash: signal SIGKILL; stderr tail: Killed: 9');
    const f = lanesFile(targets, [], new Map<NativeTarget, HostRun>([['android', run]]), null);
    const host = f.targets.find((x) => x.target === 'android')?.lanes.find((l) => l.lane === 'layout-vectors-host');
    expect(host?.state).toBe('fail');
    expect(host?.reason).toContain('p1/engine: crash: signal SIGKILL; stderr tail: Killed: 9');
  });

  // PR #48 finding 4151492056: a cause holding a carriage return (or U+2028/U+2029) is still read whole.
  it('a cause with a carriage return or a Unicode line separator in it is still parsed whole', () => {
    for (const c of ['crash: exit status 1; stderr tail: a\rb', 'timeout: killed after 180 s; stderr tail: x\u2028y\u2029z']) {
      const parsed = parseNativeOutput(`snap 1/4 (${c})\nnative:kotlin: P1 corpus digest 00; extended corpus digest 00; status fail`);
      expect(parsed?.suites[0]?.cause, JSON.stringify(c)).toBe(c);
    }
    expect(hostEnd({ status: 1, signal: null, error: null, stderr: 'a\rb\u2028c' })).toBe('exit 1, signal -; stderr tail: a | b | c');
  });

  it('a suite printed twice fails the lane, so a failing second copy is not hidden by a passing first', () => {
    const out = kotlinOut.replace(ENGINE_LINE, (l) => `${l}\nengine corpus 0/20258 (crash: signal SIGKILL)`);
    const parsed = parseNativeOutput(out);
    expect(parsed?.suites.filter((s) => s.suite === 'engine')).toHaveLength(2);
    expect(judgeHost(android, parsed).reason).toContain('p1/engine is printed more than once');
    expect(judgeHost(android, parseNativeOutput(kotlinOut)).reason ?? '').not.toContain('printed more than once');
  });
});
