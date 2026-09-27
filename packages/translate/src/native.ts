// Builds the generated Swift and Kotlin harnesses (cached on sources, flags and compiler version) and compares every result line
// with the TypeScript reference, byte for byte (every double is its IEEE bit pattern).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Corpus, Split, Suite } from './corpus.ts';
import { split } from './corpus.ts';
import type { Files } from './generate.ts';
import { ROOT } from './generate.ts';

export const OUT = join(ROOT, 'packages/translate/out');

export const SWIFT_FLAGS = ['-O', '-wmo', '-suppress-warnings', '-module-name', 'DragonHarness'];
export const KOTLIN_FLAGS = ['-nowarn', '-include-runtime'];

export type Mismatch = { readonly index: number; readonly input: string; readonly expected: string; readonly got: string };
export type SuiteResult = { readonly name: string; readonly total: number; readonly pass: number; readonly mismatches: readonly Mismatch[]; readonly split: Split };
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

export function swiftTool(): SwiftTool | null {
  const v = run('swiftc', ['--version']);
  if (!v.ok) return null;
  return { swiftc: 'swiftc', version: (v.out.split('\n').find((l) => l.includes('Swift version')) ?? v.out).trim() };
}

/** JDK 17+ and kotlinc; absent tools make the Kotlin run blocked (owner tooling), never passed. */
export function kotlinTool(): KotlinTool | null {
  const homes: string[] = [];
  if (process.env['JAVA_HOME'] !== undefined) homes.push(process.env['JAVA_HOME']);
  const jh = run('/usr/libexec/java_home', ['-v', '17+']);
  if (jh.ok) homes.push(jh.out.trim());
  homes.push('/opt/homebrew/opt/openjdk@17', '/opt/homebrew/opt/openjdk', '/usr/lib/jvm/java-17-openjdk-amd64');
  const javaHome = homes.find((h) => h !== '' && run(join(h, 'bin/java'), ['-version']).ok);
  if (javaHome === undefined) return null;
  const env = { ...process.env, JAVA_HOME: javaHome, PATH: `${join(javaHome, 'bin')}:${process.env['PATH'] ?? ''}` };
  const kotlinc = ['kotlinc', '/opt/homebrew/bin/kotlinc'].find((k) => run(k, ['-version'], env).ok);
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

/** Moves a finished build into its cache directory; a concurrent build of the same key may have won, which is equivalent. */
function publish(work: string, dir: string): void {
  try {
    renameSync(work, dir);
  } catch {
    rmSync(work, { recursive: true, force: true });
  }
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
  const alone = run(tool.swiftc, ['-typecheck', '-parse-as-library', '-module-name', 'DragonLayout', ...engine]);
  if (!alone.ok) throw new Error(`swiftc -typecheck of the engine module failed:\n${alone.out.slice(0, 4000)}`);
  const r = run(tool.swiftc, [...SWIFT_FLAGS, ...srcs, '-o', join(work, 'harness')]);
  if (!r.ok) throw new Error(`swiftc failed:\n${r.out.slice(0, 4000)}`);
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
  if (!r.ok) throw new Error(`kotlinc failed:\n${r.out.slice(0, 4000)}`);
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
      writeFileSync(`${p}.${process.pid}`, `${s.lines.join('\n')}\n`);
      renameSync(`${p}.${process.pid}`, p);
    }
    paths.set(s.name, p);
  }
  return paths;
}

export type Exec = (mode: Suite['mode'], input: string, output: string) => void;

/** Runs every suite; with untilFailure, stops after the first suite with a failing case (the planted-fault test needs one). */
export function runSuites(c: Corpus, exec: Exec, tag: string, untilFailure = false): SuiteResult[] {
  const inputs = corpusFiles(c);
  const dir = join(OUT, 'results', tag);
  mkdirSync(dir, { recursive: true });
  const fastFirst = ['vectors', 'library', 'units', 'engine'];
  const order = untilFailure ? [...c.suites].sort((a, b) => fastFirst.indexOf(a.name) - fastFirst.indexOf(b.name)) : c.suites;
  const out: SuiteResult[] = [];
  for (const s of order) {
    out.push(runSuite(c, s, exec, inputs, dir));
    const last = out[out.length - 1] as SuiteResult;
    if (untilFailure && last.pass < last.total) break;
  }
  return out;
}

function runSuite(c: Corpus, s: Suite, exec: Exec, inputs: Map<string, string>, dir: string): SuiteResult {
  {
    const outPath = join(dir, `${s.name}.jsonl`);
    rmSync(outPath, { force: true });
    exec(s.mode, inputs.get(s.name) as string, outPath);
    const got = existsSync(outPath) ? readFileSync(outPath, 'utf8').split('\n') : [];
    if (got[got.length - 1] === '') got.pop();
    let pass = 0;
    const mismatches: Mismatch[] = [];
    for (let i = 0; i < s.expected.length; i++) {
      const g = got[i] ?? '<missing>';
      if (g === s.expected[i]) pass++;
      else if (mismatches.length < 5) mismatches.push({ index: i, input: s.lines[i] as string, expected: s.expected[i] as string, got: g });
    }
    if (got.length !== s.expected.length && mismatches.length < 5) mismatches.push({ index: -1, input: '', expected: `${s.expected.length} lines`, got: `${got.length} lines` });
    return { name: s.name, total: s.expected.length, pass: got.length === s.expected.length ? pass : Math.min(pass, got.length), mismatches, split: split(got) };
  }
}

/** A suite that crashes, traps or runs past the limit leaves its missing lines as failing cases (a planted map fault can loop). */
export const SUITE_TIMEOUT_MS = 180_000;

function execSuite(cmd: string, args: readonly string[]): void {
  try {
    execFileSync(cmd, [...args], { stdio: ['ignore', 'ignore', 'pipe'], timeout: SUITE_TIMEOUT_MS, killSignal: 'SIGKILL' });
  } catch {
    // The comparison reports every missing or wrong line.
  }
}

export function swiftExec(binary: string): Exec {
  return (mode, input, output) => execSuite(binary, [mode, input, output]);
}

export function kotlinExec(tool: KotlinTool, jar: string): Exec {
  return (mode, input, output) => execSuite(join(tool.javaHome, 'bin/java'), ['-Xss64m', '-jar', jar, mode, input, output]);
}

export function allPass(suites: readonly SuiteResult[]): boolean {
  return suites.every((s) => s.pass === s.total);
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
    const extra = s.name === 'engine' ? ` (ok ${c.engineSplit.ok}, unsupported ${c.engineSplit.unsupported}, refused ${c.engineSplit.refused}, threw ${c.engineSplit.threw}; ${c.suites[2]?.lines.length} = 258 mutated vectors + ${(c.suites[2]?.lines.length ?? 0) - 258} generated trees)` : '';
    lines.push(`${label} ${s.pass}/${s.total}${extra}`);
    for (const m of s.mismatches) lines.push(`  MISMATCH #${m.index}\n    input    ${m.input.slice(0, 400)}\n    expected ${m.expected.slice(0, 400)}\n    got      ${m.got.slice(0, 400)}`);
  }
  lines.push(`corpus digest ${c.digest}`, `build ${r.buildSeconds.toFixed(1)} s, run ${r.runSeconds.toFixed(1)} s`, `status ${r.status}`);
  return lines.join('\n');
}

export function writeReport(r: RunResult, c: Corpus): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `report-${r.target}.json`), `${JSON.stringify({ ...r, corpusDigest: c.digest, engineSplit: c.engineSplit }, null, 2)}\n`);
}
