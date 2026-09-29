// Shape transcript of the TXT1-0 gate (T056 R3, TXT1-N) and its host replays.
//   --record   runs every gate case (all GATE_REFERENCES) through dragon_hb.wasm, requires all exact, and writes
//              transcripts/gate.json: every shim call with its integers, faces by sha256.
//   --check    records again in memory and requires the committed file byte for byte, then replays it through the WASM.
//   --swift    replays the committed transcript through the aarch64-macos static library (zig build host) from Swift.
//   --kotlin   replays it through the JNI dylib (zig build host-jni) from Kotlin on the JVM.
//   --plant off-by-one   (with --swift, --kotlin or --check) changes one expected integer; the replay must exit 1.
//   --plant bad-index    points the first call at a font past the last; the replay must exit 1 with a bad-transcript error.
// Usage: node packages/text-shaper/scripts/replay.ts --record | --check | --swift | --kotlin [--plant off-by-one | bad-index]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_REFERENCES, fontPath, loadReference, runGate } from '../src/gate.ts';
import {
  TRANSCRIPT_PLANTS, parseTranscript, plantTranscript, recordTranscript, replayTranscript, serializeTranscript, sha256Hex, wasmBackend,
} from '../src/transcript.ts';
import type { Transcript, TranscriptPlant } from '../src/transcript.ts';
import { DEFAULT_WASM_PATH, DragonHB } from '../src/wasm.ts';

export const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const GATE_TRANSCRIPT_PATH = join(PACKAGE_DIR, 'transcripts', 'gate.json');

/** Runs the whole gate through a recording WASM instance. Throws unless every case is exact. */
export function recordGate(): { transcript: Transcript; cases: number } {
  const wasm = readFileSync(DEFAULT_WASM_PATH);
  const files = new Map<string, string>();
  for (const { reference } of GATE_REFERENCES) {
    for (const meta of Object.values(loadReference(reference).fonts)) {
      const path = fontPath(meta.file);
      files.set(sha256Hex(readFileSync(path)), relative(REPO_ROOT, path));
    }
  }
  const hb = DragonHB.fromBytes(wasm);
  const recorder = recordTranscript(hb, 'TXT1-0 gate: every case of GATE_REFERENCES (packages/text-shaper/src/gate.ts)', sha256Hex(wasm), (sha) => {
    const file = files.get(sha);
    if (file === undefined) throw new Error(`no gate font with sha256 ${sha}`);
    return file;
  });
  let cases = 0;
  for (const { reference } of GATE_REFERENCES) {
    const results = runGate(loadReference(reference), hb);
    const bad = results.filter((r) => !r.exact);
    if (bad.length > 0) throw new Error(`gate mismatch while recording: ${bad.map((r) => r.id).join(', ')}`);
    cases += results.length;
  }
  return { transcript: recorder.finish(), cases };
}

function readFace(file: string): Uint8Array {
  return readFileSync(join(REPO_ROOT, file));
}

function run(cmd: string, args: readonly string[], cwd?: string): { status: number; out: string } {
  const r = spawnSync(cmd, [...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error !== undefined) throw r.error;
  return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

function must(cmd: string, args: readonly string[], cwd?: string): string {
  const r = run(cmd, args, cwd);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${r.out.slice(-4000)}`);
  return r.out;
}

/** The transcript file a native replay reads: the committed one, or a planted copy in a temporary directory. */
function transcriptFor(plant: TranscriptPlant | undefined): string {
  if (plant === undefined) return GATE_TRANSCRIPT_PATH;
  const dir = mkdtempSync(join(tmpdir(), 'dragon-hb-replay-'));
  const path = join(dir, 'gate.json');
  writeFileSync(path, serializeTranscript(plantTranscript(parseTranscript(readFileSync(GATE_TRANSCRIPT_PATH, 'utf8')), plant)));
  return path;
}

/** Builds the Swift host replay (swift/, linked against zig build host) and returns the executable. */
export function buildSwiftReplay(): string {
  must('zig', ['build', 'host'], PACKAGE_DIR);
  const swiftDir = join(PACKAGE_DIR, 'swift');
  const flags = ['-c', 'release', '--package-path', swiftDir, '-Xlinker', '-L', '-Xlinker', join(PACKAGE_DIR, 'zig-out', 'host')];
  must('swift', ['build', ...flags, '--product', 'dragon-hb-replay']);
  return join(must('swift', ['build', ...flags, '--show-bin-path']).trim().split('\n').pop() as string, 'dragon-hb-replay');
}

const KOTLIN_SRC = join(PACKAGE_DIR, 'kotlin', 'src');

function kotlinSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith('.kt')) out.push(join(dir, e.name));
    }
  };
  walk(KOTLIN_SRC);
  return out;
}

function javaHome(): string {
  const home = process.env.JAVA_HOME;
  if (home === undefined || home === '') throw new Error('JAVA_HOME must name a JDK 17+');
  return home;
}

/** Builds the Kotlin replay jar (cached by source hash) and the JNI dylib (zig build host-jni). */
export function buildKotlinReplay(): { jar: string; lib: string } {
  must('zig', ['build', 'host-jni', `-Djava-home=${javaHome()}`], PACKAGE_DIR);
  const sources = kotlinSources();
  const hash = createHash('sha256');
  for (const s of sources) hash.update(s).update(readFileSync(s));
  const buildDir = join(PACKAGE_DIR, 'kotlin', 'build');
  const jar = join(buildDir, `replay-${hash.digest('hex').slice(0, 16)}.jar`);
  if (!existsSync(jar)) {
    mkdirSync(buildDir, { recursive: true });
    must('kotlinc', [...sources, '-include-runtime', '-d', jar]);
  }
  return { jar, lib: join(PACKAGE_DIR, 'zig-out', 'host-jni', 'libdragon_hb.dylib') };
}

function main(argv: readonly string[]): number {
  const args = argv.filter((a) => a !== '--');
  const pi = args.indexOf('--plant');
  const plant = pi >= 0 ? (args[pi + 1] as TranscriptPlant) : undefined;
  if (pi >= 0 && !TRANSCRIPT_PLANTS.includes(plant as TranscriptPlant)) throw new Error(`unknown plant ${String(plant)}`);
  const mode = args.find((a) => ['--record', '--check', '--swift', '--kotlin'].includes(a));

  if (mode === '--record') {
    const { transcript, cases } = recordGate();
    mkdirSync(join(PACKAGE_DIR, 'transcripts'), { recursive: true });
    writeFileSync(GATE_TRANSCRIPT_PATH, serializeTranscript(transcript));
    const shapes = transcript.calls.filter((c) => c.op === 'shape').length;
    console.log(`recorded ${relative(REPO_ROOT, GATE_TRANSCRIPT_PATH)}: ${cases}/${cases} cases exact, ${transcript.faces.length} faces, ${transcript.fonts.length} fonts, ${transcript.calls.length} calls (${shapes} shape)`);
    return 0;
  }
  if (mode === '--check') {
    const committed = readFileSync(GATE_TRANSCRIPT_PATH, 'utf8');
    const { transcript, cases } = recordGate();
    if (serializeTranscript(transcript) !== committed) {
      console.log(`${relative(REPO_ROOT, GATE_TRANSCRIPT_PATH)} differs from a fresh recording; run --record`);
      return 1;
    }
    let t = parseTranscript(committed);
    if (plant !== undefined) t = plantTranscript(t, plant);
    const r = replayTranscript(t, wasmBackend(DragonHB.load()), (f) => readFace(f.file));
    console.log(`check: byte-identical to a fresh recording of ${cases} cases; wasm replay ${r.calls} calls (${r.shapeCalls} shape, ${r.glyphs} glyphs), ${r.mismatches.length} mismatches`);
    for (const m of r.mismatches.slice(0, 5)) console.log(`  MISMATCH call ${m.call} ${m.op}: ${m.detail}`);
    return r.mismatches.length === 0 ? 0 : 1;
  }
  if (mode === '--swift') {
    const exe = buildSwiftReplay();
    const r = run(exe, [transcriptFor(plant), REPO_ROOT]);
    process.stdout.write(r.out);
    return r.status;
  }
  if (mode === '--kotlin') {
    const { jar, lib } = buildKotlinReplay();
    const r = run(join(javaHome(), 'bin', 'java'), ['-cp', jar, 'dev.dragon.text.ReplayKt', '--lib', lib, transcriptFor(plant), REPO_ROOT]);
    process.stdout.write(r.out);
    return r.status;
  }
  console.error('usage: replay.ts --record | --check | --swift | --kotlin [--plant off-by-one | bad-index]');
  return 2;
}

if (process.argv[1] !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) process.exitCode = main(process.argv.slice(2));
