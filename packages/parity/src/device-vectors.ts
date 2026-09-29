// layout-vectors-device (notes/T015-p4-review-p5-plan.md section 4 item 2): the committed generated harnesses of packages/translate
// (consumed by import only) run on a device: on iOS the Swift harness built for the simulator and run with simctl spawn, on Android
// the Kotlin harness dexed with d8 --min-api 31 and run under ART with app_process, through a small launcher that gives the harness
// thread the stack the JVM run gets from -Xss. Stdin and stdout carry the same corpus lines as the host lane, compared byte for byte
// by the host lane's own runSuites; the lane passes only if every suite count and both corpus digests equal the host run's.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeviceHandle } from './device-run.ts';
import type { HostRun, LaneState, SuiteCount } from './lanes.ts';
import { androidTools, IOS_TARGET, NATIVE_CONFIG, nativeOut, run } from './native-host.ts';
import { repoPath } from './paths.ts';
import type { TargetConfig } from './targets.ts';
import { declaredSuites, extendedManifest, p1Manifest } from './targets.ts';

type Files = Map<string, string>;
type Suite = { readonly name: string; readonly mode: string; readonly lines: readonly string[]; readonly expected: readonly string[] };
type Corpus = { readonly digest: string; readonly suites: readonly Suite[] };
type SuiteResult = { readonly name: string; readonly total: number; readonly pass: number; readonly cause: string | null; readonly mismatches: readonly { index: number; expected: string; got: string }[] };
type Exec = (mode: string, input: string, output: string) => string | null;
type Translate = {
  readonly committedFiles: (target: 'swift' | 'kotlin') => Files;
  readonly buildCorpus: () => Corpus;
  readonly buildExtendedCorpus: () => Corpus;
  readonly runSuites: (c: Corpus, exec: Exec, tag: string) => SuiteResult[];
  readonly suiteCause: (r: { status: number | null; signal: NodeJS.Signals | null; error?: Error | undefined }, timeoutMs: number) => string | null;
  readonly SUITE_TIMEOUT_MS: number;
  readonly SWIFT_FLAGS: readonly string[];
  readonly KOTLIN_FLAGS: readonly string[];
  readonly kotlinTool: () => { readonly kotlinc: string; readonly javaHome: string; readonly version: string } | null;
  readonly buildKotlin: (tool: { kotlinc: string; javaHome: string; version: string }, files: Files) => { jar: string };
};

// packages/parity does not depend on packages/translate; its modules are loaded at run time from source, as lanes.ts does.
async function translate(): Promise<Translate> {
  const mod = async (p: string): Promise<Record<string, unknown>> => (await import(pathToFileURL(repoPath(p)).href)) as Record<string, unknown>;
  return { ...(await mod('packages/translate/src/check.ts')), ...(await mod('packages/translate/src/corpus.ts')), ...(await mod('packages/translate/src/corpus-dpr.ts')), ...(await mod('packages/translate/src/native.ts')) } as unknown as Translate;
}

const key = (files: Files, extra: readonly string[]): string => {
  const h = createHash('sha256');
  for (const [f, t] of [...files.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(f).update('\0').update(t).update('\0');
  for (const e of extra) h.update(e).update('\0');
  return h.digest('hex').slice(0, 20);
};

function must(r: { status: number; out: string }, what: string): string {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status}):\n${r.out.slice(-4000)}`);
  return r.out;
}

/** The Swift harness for the iOS simulator: the committed generated tree, one module, the host lane's flags, the simulator target. */
export async function buildIosHarness(): Promise<string> {
  const t = await translate();
  const files = t.committedFiles('swift');
  const dir = join(nativeOut('ios'), 'vectors', key(files, [...t.SWIFT_FLAGS, IOS_TARGET]));
  const binary = join(dir, 'harness');
  if (existsSync(binary)) return binary;
  rmSync(dir, { recursive: true, force: true });
  const srcs: string[] = [];
  for (const [f, text] of files) {
    if (!f.endsWith('.swift') || f === 'Package.swift') continue;
    const p = join(dir, 'src', f);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
    srcs.push(p);
  }
  must(run('xcrun', ['-sdk', 'iphonesimulator', 'swiftc', '-target', IOS_TARGET, ...t.SWIFT_FLAGS, ...srcs, '-o', `${binary}.tmp`], { timeoutMs: 3_600_000 }), 'swiftc (the harness for the iOS simulator)');
  must(run('mv', [`${binary}.tmp`, binary]), 'mv');
  return binary;
}

const LAUNCHER = `package dev.dragon.p5

/** Runs the generated harness main on a thread with a 512 MB stack (the JVM host run uses -Xss64m); a throwable exits 1. */
fun main(args: Array<String>) {
  var failure: Throwable? = null
  val t = Thread(null, { try { dev.dragon.layout.main(args) } catch (e: Throwable) { failure = e } }, "dragon-harness", 1L shl 29)
  t.start()
  t.join()
  val f = failure
  if (f != null) {
    f.printStackTrace()
    kotlin.system.exitProcess(1)
  }
}
`;

/** The Kotlin harness for ART: the host lane's jar (kotlin runtime included) plus the launcher, dexed with d8 --min-api 31. */
export async function buildAndroidHarness(): Promise<string> {
  const t = await translate();
  const tool = t.kotlinTool();
  if (tool === null) throw new Error('no JDK 17+ or kotlinc (owner tooling)');
  const files = t.committedFiles('kotlin');
  const tools = androidTools();
  const dir = join(nativeOut('android'), 'vectors', key(files, [...t.KOTLIN_FLAGS, tool.version, LAUNCHER, String(NATIVE_CONFIG.android.minSdk)]));
  const dexJar = join(dir, 'harness-dex.jar');
  if (existsSync(dexJar)) return dexJar;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'dex'), { recursive: true });
  const { jar } = t.buildKotlin(tool, files);
  const env = { ...process.env, JAVA_HOME: tool.javaHome, PATH: `${join(tool.javaHome, 'bin')}:${process.env['PATH'] ?? ''}` };
  writeFileSync(join(dir, 'Launcher.kt'), LAUNCHER);
  must(run(tool.kotlinc, ['-nowarn', '-cp', jar, '-d', join(dir, 'launcher.jar'), join(dir, 'Launcher.kt')], { env, timeoutMs: 1_800_000 }), 'kotlinc (launcher)');
  must(run(join(tools.buildTools, 'd8'), ['--release', '--min-api', String(NATIVE_CONFIG.android.minSdk), '--lib', tools.androidJar, '--output', join(dir, 'dex'), jar, join(dir, 'launcher.jar')], { env, timeoutMs: 1_800_000 }), 'd8 (harness)');
  must(run('sh', ['-c', `cd "${join(dir, 'dex')}" && zip -q "${dexJar}.tmp" classes*.dex && mv "${dexJar}.tmp" "${dexJar}"`]), 'zip (harness dex)');
  return dexJar;
}

const DEVICE_DIR = '/data/local/tmp/dragon-vectors';
/** The most bytes of corpus lines one app_process run reads (the harness reads its input file whole). */
const CHUNK_BYTES = 16 * 1024 * 1024;

/** Runs every suite of both corpora on the device; returns the device lane's run, judged against the host lane's run. */
export async function runDeviceVectors(h: DeviceHandle, target: TargetConfig, host: HostRun | null): Promise<HostRun & { readonly device: string }> {
  const t = await translate();
  const p1 = t.buildCorpus();
  const x = t.buildExtendedCorpus();
  let exec: Exec;
  let toolchain: string;
  if ('udid' in h) {
    const binary = await buildIosHarness();
    exec = (mode, input, output) => {
      const r = spawnSync('xcrun', ['simctl', 'spawn', h.udid, binary, mode, input, output], { stdio: ['ignore', 'ignore', 'pipe'], timeout: t.SUITE_TIMEOUT_MS, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return t.suiteCause(r, t.SUITE_TIMEOUT_MS);
    };
    toolchain = `${must(run('xcrun', ['swiftc', '--version']), 'swiftc --version').split('\n').find((l) => l.includes('Swift version'))?.trim() ?? 'swiftc'}; ${IOS_TARGET}; simctl spawn on ${h.spec.name}`;
  } else {
    const dexJar = await buildAndroidHarness();
    const adb = (args: readonly string[], timeoutMs = 600_000) => run(h.tools.adb, ['-s', h.serial, ...args], { timeoutMs });
    must(adb(['shell', 'rm', '-rf', DEVICE_DIR]), 'adb shell rm');
    must(adb(['shell', 'mkdir', '-p', DEVICE_DIR]), 'adb shell mkdir');
    must(adb(['push', dexJar, `${DEVICE_DIR}/harness.jar`]), 'adb push harness');
    // ART's heap growth limit (192 MB on the emulator image) cannot hold the 123 MB engine corpus read whole, so a suite runs in
    // chunks of whole lines; every line is an independent case, so the output is the concatenation of the chunks' outputs.
    exec = (mode, input, output) => {
      const lines = readFileSync(input, 'utf8').split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      const chunks: string[][] = [[]];
      let bytes = 0;
      for (const l of lines) {
        if (bytes + l.length > CHUNK_BYTES && (chunks[chunks.length - 1] as string[]).length > 0) {
          chunks.push([]);
          bytes = 0;
        }
        (chunks[chunks.length - 1] as string[]).push(l);
        bytes += l.length + 1;
      }
      const outs: string[] = [];
      for (const [i, chunk] of chunks.entries()) {
        const local = `${output}.chunk-${i}`;
        writeFileSync(`${local}.in`, `${chunk.join('\n')}\n`);
        const remoteIn = `${DEVICE_DIR}/in-${i}-${basename(input)}`;
        const remoteOut = `${DEVICE_DIR}/out-${i}-${basename(output)}`;
        must(adb(['push', `${local}.in`, remoteIn]), 'adb push corpus chunk');
        rmSync(`${local}.in`, { force: true });
        adb(['shell', 'rm', '-f', remoteOut]);
        const r = spawnSync(h.tools.adb, ['-s', h.serial, 'shell', `CLASSPATH=${DEVICE_DIR}/harness.jar app_process /system/bin dev.dragon.p5.LauncherKt ${mode} ${remoteIn} ${remoteOut}; echo "exit=$?"`], { encoding: 'utf8', timeout: t.SUITE_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
        const code = /exit=(\d+)/.exec(`${r.stdout ?? ''}`)?.[1];
        adb(['pull', remoteOut, local]);
        adb(['shell', 'rm', '-f', remoteIn, remoteOut]);
        const cause = r.error !== undefined || r.signal !== null ? t.suiteCause(r, t.SUITE_TIMEOUT_MS) : code === '0' ? null : `crash: exit status ${code ?? 'unknown'} in chunk ${i} ${`${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-600)}`;
        outs.push(existsSync(local) ? readFileSync(local, 'utf8') : '');
        rmSync(local, { force: true });
        if (cause !== null) {
          writeFileSync(output, outs.join(''));
          return cause;
        }
      }
      writeFileSync(output, outs.join(''));
      return null;
    };
    const rel = run(h.tools.adb, ['-s', h.serial, 'shell', 'getprop', 'ro.build.version.release']).out.trim();
    toolchain = `${t.kotlinTool()?.version ?? 'kotlinc'}; d8 --min-api ${NATIVE_CONFIG.android.minSdk}; ART app_process on ${h.spec.name} (Android ${rel})`;
  }
  const tag = `device-${target.target}`;
  const results = [...t.runSuites(p1, exec, `${tag}-p1`).map((r) => ({ ...r, corpus: 'p1' as const })), ...t.runSuites(x, exec, `${tag}-extended`).map((r) => ({ ...r, corpus: 'extended' as const }))];
  return { ...judgeDeviceVectors(target, results, { p1: p1.digest, extended: x.digest }, host), toolchain, device: h.spec.name };
}

export type DeviceSuiteResult = { readonly corpus: 'p1' | 'extended'; readonly name: string; readonly total: number; readonly pass: number; readonly cause: string | null; readonly mismatches: readonly { index: number; expected: string; got: string }[] };

/**
 * The device vectors verdict: pass only if every declared suite ran whole and byte-equal, both corpus digests are the manifests',
 * and the suite counts and digests equal the target's layout-vectors-host run.
 */
export function judgeDeviceVectors(target: TargetConfig, results: readonly DeviceSuiteResult[], digests: HostRun['digests'], host: HostRun | null): Omit<HostRun, 'toolchain'> {
  const lane = target.lanes.find((l) => l.lane === 'layout-vectors-device');
  if (lane === undefined) throw new Error(`${target.target} has no layout-vectors-device lane`);
  const declared = declaredSuites(lane);
  const got = new Map(results.map((s) => [`${s.corpus}/${s.name}`, s] as const));
  const suites: SuiteCount[] = declared.map((d) => {
    const s = got.get(`${d.corpus}/${d.suite}`);
    return { corpus: d.corpus, suite: d.suite, declared: d.cases, total: s?.total ?? null, pass: s?.pass ?? null };
  });
  const problems: string[] = [];
  for (const s of suites) if (s.total !== s.declared || s.pass !== s.declared) problems.push(`${s.corpus}/${s.suite} ${s.pass ?? '-'}/${s.total ?? '-'}, declared ${s.declared}`);
  for (const [k, s] of got) {
    if (!declared.some((d) => `${d.corpus}/${d.suite}` === k)) problems.push(`${k} is not a declared suite`);
    if (s.cause !== null) problems.push(`${k}: ${s.cause}`);
    for (const m of s.mismatches.slice(0, 2)) problems.push(`${k} #${m.index}: expected ${m.expected.slice(0, 120)}, got ${m.got.slice(0, 120)}`);
  }
  if (digests.p1 !== p1Manifest().digest) problems.push(`P1 corpus digest ${digests.p1}, manifest ${p1Manifest().digest}`);
  if (digests.extended !== extendedManifest().digest) problems.push(`extended corpus digest ${digests.extended}, manifest ${extendedManifest().digest}`);
  if (host === null) problems.push('no layout-vectors-host run to compare with');
  else {
    if (JSON.stringify(host.digests) !== JSON.stringify(digests)) problems.push(`digests ${JSON.stringify(digests)}, layout-vectors-host ${JSON.stringify(host.digests)}`);
    if (JSON.stringify(host.suites) !== JSON.stringify(suites)) problems.push('suite counts differ from layout-vectors-host');
    if (host.state !== 'pass') problems.push(`layout-vectors-host is ${host.state}`);
  }
  const state: LaneState = problems.length === 0 ? 'pass' : 'fail';
  return { state, reason: problems.length === 0 ? null : problems.join('; '), suites, digests };
}

