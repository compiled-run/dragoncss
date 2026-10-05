// Builds the generated Swift and Kotlin harnesses (cached on sources, flags and compiler version) and compares every result line
// with the TypeScript reference, byte for byte (every double is its IEEE bit pattern).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Corpus, Split, Suite } from './corpus.ts';
import { canonicalNan, sameResult, split } from './corpus.ts';
import type { Files } from './generate.ts';
import { ROOT } from './generate.ts';

export const OUT = join(ROOT, 'packages/translate/out');

export const SWIFT_FLAGS = ['-O', '-wmo', '-suppress-warnings', '-module-name', 'DragonHarness'];
export const KOTLIN_FLAGS = ['-nowarn', '-include-runtime'];

export type Mismatch = { readonly index: number; readonly input: string; readonly expected: string; readonly got: string };
/** Why a suite's process ended early, or null when it exited 0: a timeout at SUITE_TIMEOUT_MS, a crash (signal) or a non-zero exit. */
export type SuiteCause = string | null;
export type SuiteResult = { readonly name: string; readonly total: number; readonly pass: number; readonly mismatches: readonly Mismatch[]; readonly split: Split; readonly cause: SuiteCause };
export type Status = 'pass' | 'fail' | 'blocked (owner tooling)';
export type RunResult = {
  readonly target: 'swift' | 'kotlin';
  readonly status: Status;
  readonly toolchain: string;
  readonly reason: string | null;
  readonly suites: readonly SuiteResult[];
  readonly buildSeconds: number;
  readonly runSeconds: number;
};

export type SwiftTool = { readonly swiftc: string; readonly version: string };
export type KotlinTool = { readonly kotlinc: string; readonly javaHome: string; readonly version: string };

function run(cmd: string, args: readonly string[], env?: NodeJS.ProcessEnv): { ok: boolean; out: string } {
  const r = spawnSync(cmd, [...args], { encoding: 'utf8', env: env ?? process.env, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0 && r.error === undefined, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Runs use with a fresh TMPDIR, removed afterwards: swiftc leaves an empty TemporaryDirectory.* there on --version and -typecheck. */
export function withToolTmp<T>(use: (env: NodeJS.ProcessEnv) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'dragon-swiftc-'));
  try {
    return use({ ...process.env, TMPDIR: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function swiftTool(): SwiftTool | null {
  const v = withToolTmp((env) => run('swiftc', ['--version'], env));
  if (!v.ok) return null;
  return { swiftc: 'swiftc', version: (v.out.split('\n').find((l) => l.includes('Swift version')) ?? v.out).trim() };
}

/** Where kotlinTool looks: JAVA_HOME, then java_home, then fixed JDK homes; kotlinc on PATH, then a fixed path. Tests replace it. */
export type KotlinLookup = { readonly javaHomeEnv: string | null; readonly javaHomeCommand: string; readonly jdkHomes: readonly string[]; readonly kotlincs: readonly string[] };

export function defaultKotlinLookup(): KotlinLookup {
  return {
    javaHomeEnv: process.env['JAVA_HOME'] ?? null,
    javaHomeCommand: '/usr/libexec/java_home',
    jdkHomes: ['/opt/homebrew/opt/openjdk@17', '/opt/homebrew/opt/openjdk', '/usr/lib/jvm/java-17-openjdk-amd64'],
    kotlincs: ['kotlinc', '/opt/homebrew/bin/kotlinc'],
  };
}

/** JDK 17+ and kotlinc; absent tools make the Kotlin run blocked (owner tooling), never passed. */
export function kotlinTool(lookup: KotlinLookup = defaultKotlinLookup()): KotlinTool | null {
  const homes: string[] = [];
  if (lookup.javaHomeEnv !== null) homes.push(lookup.javaHomeEnv);
  const jh = run(lookup.javaHomeCommand, ['-v', '17+']);
  if (jh.ok) homes.push(jh.out.trim());
  homes.push(...lookup.jdkHomes);
  const javaHome = homes.find((h) => h !== '' && run(join(h, 'bin/java'), ['-version']).ok);
  if (javaHome === undefined) return null;
  const env = { ...process.env, JAVA_HOME: javaHome, PATH: `${join(javaHome, 'bin')}:${process.env['PATH'] ?? ''}` };
  const kotlinc = lookup.kotlincs.find((k) => run(k, ['-version'], env).ok);
  if (kotlinc === undefined) return null;
  const kv = run(kotlinc, ['-version'], env).out.split('\n').find((l) => l.includes('kotlinc')) ?? '';
  const jv = run(join(javaHome, 'bin/java'), ['-version']).out.split('\n')[0] ?? '';
  return { kotlinc, javaHome, version: `${kv.replace(/^info: /, '').trim()}; ${jv.trim()}` };
}

function filesKey(files: Files, extra: readonly string[]): string {
  const h = createHash('sha256');
  for (const [f, t] of files) h.update(f).update('\0').update(t).update('\0');
  for (const e of extra) h.update(e).update('\0');
  return h.digest('hex').slice(0, 20);
}

function writeFiles(dir: string, files: Files): void {
  for (const [f, t] of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), t);
  }
}

/**
 * Moves a finished build into its cache directory. A concurrent build of the same key may have won, which is equivalent. A
 * directory that lacks the build's artifacts is a stale entry (something deleted files under out/ and left the directories),
 * which would otherwise block every later publish of the key while the caller runs an artifact that is not there: it is replaced.
 */
export function publish(work: string, dir: string): void {
  try {
    renameSync(work, dir);
    return;
  } catch {
    // The directory exists: a concurrent winner, or a stale entry.
  }
  const artifacts = readdirSync(work).filter((n) => n !== 'src');
  if (artifacts.every((n) => existsSync(join(dir, n)))) {
    rmSync(work, { recursive: true, force: true });
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  try {
    renameSync(work, dir);
  } catch (e) {
    // A concurrent build may have published between the removal and this rename.
    if (!artifacts.every((n) => existsSync(join(dir, n)))) throw new Error(`could not publish the build ${work} to ${dir}: ${(e as Error).message}`);
    rmSync(work, { recursive: true, force: true });
  }
}

/** A failed build removes its work directory, then throws the compiler's output. */
function failBuild(work: string, message: string): never {
  rmSync(work, { recursive: true, force: true });
  throw new Error(message);
}

/** Compiles the Swift harness; returns the binary. Cached on sources, flags and compiler version. */
export function buildSwift(tool: SwiftTool, files: Files): { binary: string; seconds: number; cached: boolean } {
  const key = filesKey(files, [...SWIFT_FLAGS, tool.version]);
  const dir = join(OUT, 'swift', key);
  const binary = join(dir, 'harness');
  if (existsSync(binary)) return { binary, seconds: 0, cached: true };
  const work = `${dir}.build-${process.pid}`;
  rmSync(work, { recursive: true, force: true });
  writeFiles(join(work, 'src'), files);
  const srcs = [...files.keys()].filter((f) => f.endsWith('.swift') && f !== 'Package.swift').map((f) => join(work, 'src', f));
  const t = Date.now();
  // The engine module must compile on its own (no Foundation, nothing from the harness), as it does in the SwiftPM package.
  const engine = srcs.filter((f) => f.includes('/Sources/DragonLayout/'));
  withToolTmp((env) => {
    const alone = run(tool.swiftc, ['-typecheck', '-parse-as-library', '-module-name', 'DragonLayout', ...engine], env);
    if (!alone.ok) failBuild(work, `swiftc -typecheck of the engine module failed:\n${alone.out.slice(0, 4000)}`);
    const r = run(tool.swiftc, [...SWIFT_FLAGS, ...srcs, '-o', join(work, 'harness')], env);
    if (!r.ok) failBuild(work, `swiftc failed:\n${r.out.slice(0, 4000)}`);
  });
  publish(work, dir);
  return { binary, seconds: (Date.now() - t) / 1000, cached: false };
}

/** Compiles the Kotlin harness to a jar. Cached on sources, flags and compiler version. */
export function buildKotlin(tool: KotlinTool, files: Files): { jar: string; seconds: number; cached: boolean } {
  const key = filesKey(files, [...KOTLIN_FLAGS, tool.version]);
  const dir = join(OUT, 'kotlin', key);
  const jar = join(dir, 'harness.jar');
  if (existsSync(jar)) return { jar, seconds: 0, cached: true };
  const work = `${dir}.build-${process.pid}`;
  rmSync(work, { recursive: true, force: true });
  writeFiles(join(work, 'src'), files);
  const srcs = [...files.keys()].filter((f) => f.endsWith('.kt')).map((f) => join(work, 'src', f));
  const t = Date.now();
  const env = { ...process.env, JAVA_HOME: tool.javaHome, PATH: `${join(tool.javaHome, 'bin')}:${process.env['PATH'] ?? ''}` };
  const r = run(tool.kotlinc, [...KOTLIN_FLAGS, ...srcs, '-d', join(work, 'harness.jar')], env);
  if (!r.ok) failBuild(work, `kotlinc failed:\n${r.out.slice(0, 4000)}`);
  publish(work, dir);
  return { jar, seconds: (Date.now() - t) / 1000, cached: false };
}

/** Writes the corpus inputs once per digest. */
export function corpusFiles(c: Corpus): Map<string, string> {
  const dir = join(OUT, 'corpus', c.digest.slice(0, 16));
  const paths = new Map<string, string>();
  for (const s of c.suites) {
    const p = join(dir, `${s.name}.jsonl`);
    if (!existsSync(p)) {
      mkdirSync(dir, { recursive: true });
      // The inputs as the digest covers them: every NaN the one quiet NaN, whatever host generated them.
      writeFileSync(`${p}.${process.pid}`, `${s.lines.map(canonicalNan).join('\n')}\n`);
      renameSync(`${p}.${process.pid}`, p);
    }
    paths.set(s.name, p);
  }
  return paths;
}

/** Runs one suite's process; returns why it ended early, or null when it exited 0. */
export type Exec = (mode: Suite['mode'], input: string, output: string) => SuiteCause;

/** Runs every suite; with untilFailure, stops after the first suite with a failing case (the planted-fault test needs one). */
export function runSuites(c: Corpus, exec: Exec, tag: string, untilFailure = false): SuiteResult[] {
  const inputs = corpusFiles(c);
  const dir = join(OUT, 'results', tag);
  mkdirSync(dir, { recursive: true });
  const fastFirst = ['vectors', 'library', 'units', 'engine', 'vectors-m2', 'snap', 'units-m2', 'vectors-dpr', 'engine-dpr'];
  const order = untilFailure ? [...c.suites].sort((a, b) => fastFirst.indexOf(a.name) - fastFirst.indexOf(b.name)) : c.suites;
  const out: SuiteResult[] = [];
  for (const s of order) {
    out.push(runSuite(c, s, exec, inputs, dir));
    const last = out[out.length - 1] as SuiteResult;
    if (untilFailure && (last.pass < last.total || last.cause !== null)) break;
  }
  return out;
}

function runSuite(c: Corpus, s: Suite, exec: Exec, inputs: Map<string, string>, dir: string): SuiteResult {
  const outPath = join(dir, `${s.name}.jsonl`);
  rmSync(outPath, { force: true });
  const ended = exec(s.mode, inputs.get(s.name) as string, outPath);
  const written = existsSync(outPath);
  const got = written ? readFileSync(outPath, 'utf8').split('\n') : [];
  if (got[got.length - 1] === '') got.pop();
  let pass = 0;
  const mismatches: Mismatch[] = [];
  for (let i = 0; i < s.expected.length; i++) {
    const g = got[i] ?? '<missing>';
    if (sameResult(s.expected[i] as string, g)) pass++;
    else if (mismatches.length < 5) mismatches.push({ index: i, input: s.lines[i] as string, expected: s.expected[i] as string, got: g });
  }
  if (got.length !== s.expected.length && mismatches.length < 5) mismatches.push({ index: -1, input: '', expected: `${s.expected.length} lines`, got: `${got.length} lines` });
  return { name: s.name, total: s.expected.length, pass: got.length === s.expected.length ? pass : Math.min(pass, got.length), mismatches, split: split(got), cause: ended ?? outputCause(written, got.length, s.expected.length) };
}

/** A process that exited 0 must still account for every case: no result file, or fewer or more lines than cases, is a cause. */
export function outputCause(written: boolean, lines: number, cases: number): SuiteCause {
  if (!written) return `no output: exit 0 but no result file was written (${cases} cases)`;
  if (lines !== cases) return `${lines < cases ? 'short' : 'long'} output: exit 0 but ${lines} result lines for ${cases} cases`;
  return null;
}

/** A suite that crashes, traps or runs past the limit leaves its missing lines as failing cases (a planted map fault can loop). */
export const SUITE_TIMEOUT_MS = 180_000;

/** Runs a suite process under SUITE_TIMEOUT_MS; the comparison still reports every missing or wrong line, and the cause names why. */
export function execSuite(cmd: string, args: readonly string[], timeoutMs: number = SUITE_TIMEOUT_MS): SuiteCause {
  const r = spawnSync(cmd, [...args], { stdio: ['ignore', 'ignore', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return suiteCause(r, timeoutMs);
}

/** The last 600 characters of a process's stderr on one line (the cause is one report line), or '' when it printed nothing. */
export function stderrTail(stderr: string | null | undefined): string {
  // Every line terminator, \r and U+2028/U+2029 too, so the cause stays on its suite line for the lane parser.
  const t = (stderr ?? '').trim().replace(/\s*[\n\r\u2028\u2029]\s*/g, ' | ');
  return t.length > 600 ? `...${t.slice(-600)}` : t;
}

/** The cause of a suite process ending: timeout, crash (a signal), a non-zero exit, or a spawn error, with its stderr tail; null for exit 0. */
export function suiteCause(r: { readonly status: number | null; readonly signal: NodeJS.Signals | null; readonly error?: Error | undefined; readonly stderr?: string | null }, timeoutMs: number): SuiteCause {
  const code = r.error === undefined ? '' : (r.error as NodeJS.ErrnoException).code ?? '';
  const tail = stderrTail(r.stderr);
  const why = code === 'ETIMEDOUT' ? `timeout: killed after ${timeoutMs / 1000} s` : r.error !== undefined ? `could not run: ${r.error.message}` : r.signal !== null ? `crash: signal ${r.signal}` : r.status !== 0 ? `crash: exit status ${r.status}` : null;
  return why === null ? null : tail === '' ? why : `${why}; stderr tail: ${tail}`;
}

export function swiftExec(binary: string): Exec {
  return (mode, input, output) => execSuite(binary, [mode, input, output]);
}

/**
 * The Kotlin harness heap cap. With the JVM default (a quarter of RAM) the engine suite grows to 4.3 GB resident, the likely reason
 * it ran past SUITE_TIMEOUT_MS under machine-wide memory pressure; it needs 512-768 MB and runs as fast at 2 GB (1.6 GB resident).
 */
export const KOTLIN_HEAP = '-Xmx2g';

export function kotlinExec(tool: KotlinTool, jar: string): Exec {
  return (mode, input, output) => execSuite(join(tool.javaHome, 'bin/java'), ['-Xss64m', KOTLIN_HEAP, '-jar', jar, mode, input, output]);
}

/** Every case matched and every process accounted for its cases: a suite with a cause (say, extra lines) does not pass. */
export function allPass(suites: readonly SuiteResult[]): boolean {
  return suites.every((s) => s.pass === s.total && s.cause === null);
}

export function failures(suites: readonly SuiteResult[]): number {
  return suites.reduce((n, s) => n + (s.total - s.pass), 0);
}

export function describe(r: RunResult, c: Corpus): string {
  const lines = [`native:${r.target}: ${r.toolchain}`];
  if (r.status === 'blocked (owner tooling)') {
    lines.push(`status blocked (owner tooling): ${r.reason ?? ''}`);
    return lines.join('\n');
  }
  for (const s of r.suites) {
    const label = s.name === 'engine' ? 'engine corpus' : s.name === 'library' ? 'library corpus' : s.name;
    const sp = c.engineSplit;
    const splitText = `ok ${sp.ok}, unsupported ${sp.unsupported}, refused ${sp.refused}, threw ${sp.threw}`;
    const extra = s.name === 'engine' ? ` (${splitText}; ${c.suites[2]?.lines.length} = 258 mutated vectors + ${(c.suites[2]?.lines.length ?? 0) - 258} generated trees)` : s.name === 'engine-dpr' ? ` (${splitText}; one seeded mutation per DPR vector)` : '';
    lines.push(`${label} ${s.pass}/${s.total}${extra}${s.cause === null ? '' : ` (${s.cause})`}`);
    for (const m of s.mismatches) lines.push(`  MISMATCH #${m.index}\n    input    ${m.input.slice(0, 400)}\n    expected ${m.expected.slice(0, 400)}\n    got      ${m.got.slice(0, 400)}`);
  }
  lines.push(`corpus digest ${c.digest}`, `build ${r.buildSeconds.toFixed(1)} s, run ${r.runSeconds.toFixed(1)} s`, `status ${r.status}`);
  return lines.join('\n');
}

export function writeReport(r: RunResult, c: Corpus, corpus: 'p1' | 'extended' = 'p1'): void {
  mkdirSync(OUT, { recursive: true });
  const name = corpus === 'p1' ? `report-${r.target}.json` : `report-${r.target}-extended.json`;
  writeFileSync(join(OUT, name), `${JSON.stringify({ ...r, corpusDigest: c.digest, engineSplit: c.engineSplit }, null, 2)}\n`);
}
