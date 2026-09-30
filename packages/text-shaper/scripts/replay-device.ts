// On-device shim equality (T029): replays transcripts/gate.json through the shim built for the device and compares every
// integer with what dragon_hb.wasm recorded, like the host replays in scripts/replay.ts.
//   --platform ios       builds device/ios/main.swift with swift/Sources/DragonHBShaper against DragonHB.xcframework's
//                        simulator slice and runs it with `xcrun simctl spawn <udid>`.
//   --platform android   builds kotlin/src plus device/android with kotlinc and d8, pushes the dex, libdragon_hb.so for the
//                        device ABI, the transcript and its faces to /data/local/tmp/dragon-hb, and runs it with app_process.
//   --device <id>        simulator UDID or adb serial; required when more than one simulator or device is up.
//   --plant <name>       off-by-one | bad-index | fractional-index (src/transcript.ts); the device must catch it.
//   --build-only         builds everything and starts nothing on a device.
// Exit 0 only when the device did what was expected: unplanted, every call replayed with the transcript's counts and 0
// mismatches; planted, the replay failed on exactly the planted call. A crash or a partial run is never a pass.
// An unplanted pass writes transcripts/device/<platform>.txt (transcript, device and summary; deterministic per device).
// Needs: zig, Xcode (ios); JAVA_HOME, kotlinc, ANDROID_HOME build-tools (d8) and adb, -Dandroid-ndk or ANDROID_NDK_HOME (android).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLYPH_STRIDE } from '../src/wasm.ts';
import { TRANSCRIPT_PLANTS, parseTranscript, plantTranscript, serializeTranscript, sha256Hex } from '../src/transcript.ts';
import type { Transcript, TranscriptPlant } from '../src/transcript.ts';
import { GATE_TRANSCRIPT_PATH, PACKAGE_DIR, REPO_ROOT } from './replay.ts';

const DEVICE_DIR = '/data/local/tmp/dragon-hb';

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

function files(dir: string, ext: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith(ext)) out.push(join(d, e.name));
    }
  };
  walk(dir);
  return out;
}

function buildIos(work: string): string {
  must('zig', ['build', 'ios'], PACKAGE_DIR);
  const sdk = must('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']).trim();
  const exe = join(work, 'dragon-hb-replay-ios');
  must('xcrun', [
    '--sdk', 'iphonesimulator', 'swiftc', '-O', '-target', 'arm64-apple-ios15.0-simulator', '-sdk', sdk,
    '-module-name', 'DragonHBDeviceReplay', '-I', join(PACKAGE_DIR, 'swift', 'Sources', 'CDragonHB'),
    '-L', join(PACKAGE_DIR, 'zig-out', 'ios', 'ios-arm64-simulator'),
    ...files(join(PACKAGE_DIR, 'swift', 'Sources', 'DragonHBShaper'), '.swift'), join(PACKAGE_DIR, 'device', 'ios', 'main.swift'),
    '-o', exe,
  ]);
  return exe;
}

function d8Path(): string {
  const home = process.env.ANDROID_HOME;
  if (home === undefined || home === '') throw new Error('ANDROID_HOME must name the Android SDK');
  const tools = readdirSync(join(home, 'build-tools')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const latest = tools.at(-1);
  if (latest === undefined) throw new Error('no Android build-tools installed');
  return join(home, 'build-tools', latest, 'd8');
}

function buildAndroid(work: string): string {
  must('zig', ['build', 'android'], PACKAGE_DIR);
  const jar = join(work, 'replay.jar');
  must('kotlinc', [...files(join(PACKAGE_DIR, 'kotlin', 'src'), '.kt'), join(PACKAGE_DIR, 'device', 'android', 'DeviceMain.kt'), '-include-runtime', '-d', jar]);
  const dexDir = join(work, 'dex');
  mkdirSync(dexDir, { recursive: true });
  must(d8Path(), ['--release', '--min-api', '31', '--output', dexDir, jar]);
  return join(dexDir, 'classes.dex');
}

export interface ReplayCounts {
  readonly calls: number;
  readonly shapeCalls: number;
  readonly glyphs: number;
}

/** What a replay of t reports when it runs every call. */
export function transcriptCounts(t: Transcript): ReplayCounts {
  let shapeCalls = 0;
  let glyphs = 0;
  for (const c of t.calls) {
    if (c.op !== 'shape') continue;
    shapeCalls++;
    glyphs += c.glyphs.length / GLYPH_STRIDE;
  }
  return { calls: t.calls.length, shapeCalls, glyphs };
}

const SUMMARY = /^replay (.+): (\d+) calls \((\d+) shape, (\d+) glyphs\), (\d+) mismatches$/gm;

/** The one mismatch line the off-by-one plant must produce (plantTranscript: glyphs[2] + 1 of the first shape call with a glyph). */
export function offByOneMismatch(t: Transcript): string {
  const i = t.calls.findIndex((c) => c.op === 'shape' && c.glyphs.length >= GLYPH_STRIDE);
  const c = t.calls[i];
  if (c === undefined || c.op !== 'shape') throw new Error('transcript has no shape call with a glyph');
  const got = c.glyphs[2] as number;
  return `  MISMATCH call ${i} shape: int 2: ${got}, expected ${got + 1}`;
}

/**
 * Judges a device replay of t (the unplanted transcript), planted with plant or not. Returns null when the device did
 * exactly what was expected, else the reason it did not. Every line of the output is accounted for.
 */
export function judgeDeviceRun(t: Transcript, plant: TranscriptPlant | undefined, status: number, out: string): string | null {
  const lines = out.split('\n').filter((l) => l.trim() !== '');
  const summaries = [...out.matchAll(SUMMARY)];
  if (plant === 'bad-index' || plant === 'fractional-index') {
    if (status !== 1) return `exit ${status}, expected 1`;
    const want = plant === 'bad-index' ? `bad transcript: call.font ${t.fonts.length} of ${t.fonts.length}` : `${(t.calls[0]?.font ?? 0) + 0.5}`;
    if (lines.length !== 1 || !/^replay .+: error: /.test(lines[0] as string) || !(lines[0] as string).includes(want)) {
      return `expected one error line naming "${want}", got:\n${out.slice(-2000)}`;
    }
    return null;
  }
  const want = transcriptCounts(t);
  if (summaries.length !== 1) return `expected one summary line, got ${summaries.length}:\n${out.slice(-2000)}`;
  const m = summaries[0] as RegExpMatchArray;
  const got = { calls: Number(m[2]), shapeCalls: Number(m[3]), glyphs: Number(m[4]) };
  if (got.calls !== want.calls || got.shapeCalls !== want.shapeCalls || got.glyphs !== want.glyphs) {
    return `replayed ${got.calls} calls (${got.shapeCalls} shape, ${got.glyphs} glyphs), the transcript has ${want.calls} (${want.shapeCalls} shape, ${want.glyphs} glyphs)`;
  }
  const mismatches = Number(m[5]);
  const rest = lines.filter((l) => l !== m[0]);
  if (plant === undefined) {
    if (status !== 0 || mismatches !== 0 || rest.length !== 0) return `exit ${status}, ${mismatches} mismatches, expected exit 0 and none:\n${out.slice(-2000)}`;
    return null;
  }
  const line = offByOneMismatch(t);
  if (status !== 1 || mismatches !== 1 || rest.length !== 1 || rest[0] !== line) {
    return `exit ${status}, ${mismatches} mismatches; expected exit 1 and exactly "${line.trim()}", got:\n${out.slice(-2000)}`;
  }
  return null;
}

interface SimDevice {
  readonly udid: string;
  readonly name: string;
  readonly state: string;
}

/** The simulator to run on: --device, else the only booted iOS simulator. Returns its UDID and a description. */
function iosDevice(requested: string | undefined): { udid: string; label: string } {
  const list = JSON.parse(must('xcrun', ['simctl', 'list', 'devices', '-j'])) as { devices: Record<string, SimDevice[]> };
  const booted: { udid: string; label: string }[] = [];
  for (const [runtime, devices] of Object.entries(list.devices)) {
    if (!runtime.includes('.iOS-')) continue;
    const os = runtime.replace(/^.*\.iOS-/, 'iOS ').replace(/-/g, '.');
    for (const d of devices) if (d.state === 'Booted') booted.push({ udid: d.udid, label: `${d.name}, ${os} simulator` });
  }
  if (requested !== undefined) {
    const d = booted.find((b) => b.udid === requested);
    if (d === undefined) throw new Error(`simulator ${requested} is not a booted iOS simulator`);
    return d;
  }
  if (booted.length !== 1) throw new Error(`${booted.length} iOS simulators are booted; pass --device <udid>`);
  return booted[0] as { udid: string; label: string };
}

/** The adb serial to run on: --device, else the only attached device. */
function androidSerial(requested: string | undefined): string {
  const serials = must('adb', ['devices']).split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((f) => f[1] === 'device').map((f) => f[0] as string);
  if (requested !== undefined) {
    if (!serials.includes(requested)) throw new Error(`adb device ${requested} is not attached (attached: ${serials.join(', ') || 'none'})`);
    return requested;
  }
  if (serials.length !== 1) throw new Error(`${serials.length} adb devices are attached; pass --device <serial>`);
  return serials[0] as string;
}

function main(argv: readonly string[]): number {
  const args = argv.filter((a) => a !== '--');
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`);
    return v;
  };
  const platform = opt('--platform');
  if (platform !== 'ios' && platform !== 'android') {
    console.error('usage: replay-device.ts --platform ios|android [--device <id>] [--plant off-by-one|bad-index|fractional-index] [--build-only]');
    return 2;
  }
  const plantArg = opt('--plant');
  if (plantArg !== undefined && !TRANSCRIPT_PLANTS.includes(plantArg as TranscriptPlant)) throw new Error(`unknown plant ${plantArg}`);
  const plant = plantArg as TranscriptPlant | undefined;
  const buildOnly = args.includes('--build-only');
  const committed = readFileSync(GATE_TRANSCRIPT_PATH, 'utf8');
  const t = parseTranscript(committed);
  const work = mkdtempSync(join(tmpdir(), `dragon-hb-${platform}-`));
  try {
    const transcript = join(work, 'gate.json');
    writeFileSync(transcript, plant === undefined ? committed : serializeTranscript(plantTranscript(t, plant)));
    let result: { status: number; out: string };
    let label: string;
    if (platform === 'ios') {
      const exe = buildIos(work);
      if (buildOnly) {
        console.log(`built ${exe}`);
        return 0;
      }
      const sim = iosDevice(opt('--device'));
      label = `${sim.label}, arm64`;
      // Simulator processes read the Mac's file system, so the faces are read in place.
      result = run('xcrun', ['simctl', 'spawn', sim.udid, exe, transcript, REPO_ROOT]);
    } else {
      const dex = buildAndroid(work);
      if (buildOnly) {
        console.log(`built ${dex}`);
        return 0;
      }
      const serial = androidSerial(opt('--device'));
      const adb = (...a: string[]): string[] => ['-s', serial, ...a];
      const prop = (name: string): string => must('adb', adb('shell', 'getprop', name)).trim();
      const abi = prop('ro.product.cpu.abi');
      if (abi !== 'arm64-v8a' && abi !== 'x86_64') throw new Error(`unsupported device ABI ${abi}`);
      const kind = prop('ro.boot.qemu') === '1' || prop('ro.kernel.qemu') === '1' ? 'emulator' : 'device';
      label = `${prop('ro.product.model')}, Android ${prop('ro.build.version.release')} (API ${prop('ro.build.version.sdk')}) ${kind}, ${abi}`;
      try {
        must('adb', adb('shell', 'rm', '-rf', DEVICE_DIR));
        must('adb', adb('shell', 'mkdir', '-p', `${DEVICE_DIR}/root`));
        must('adb', adb('push', dex, `${DEVICE_DIR}/replay.dex`));
        must('adb', adb('push', join(PACKAGE_DIR, 'zig-out', 'android', abi, 'libdragon_hb.so'), `${DEVICE_DIR}/libdragon_hb.so`));
        must('adb', adb('push', transcript, `${DEVICE_DIR}/gate.json`));
        for (const f of t.faces) {
          must('adb', adb('shell', 'mkdir', '-p', `${DEVICE_DIR}/root/${dirname(f.file)}`));
          must('adb', adb('push', join(REPO_ROOT, f.file), `${DEVICE_DIR}/root/${f.file}`));
        }
        result = run('adb', adb('shell', `CLASSPATH=${DEVICE_DIR}/replay.dex app_process /system/bin dev.dragon.text.DeviceMain --lib ${DEVICE_DIR}/libdragon_hb.so ${DEVICE_DIR}/gate.json ${DEVICE_DIR}/root; echo "exit=$?"`));
        const m = /exit=(\d+)\s*$/.exec(result.out);
        if (m === null) throw new Error(`adb shell ended without the exit marker (adb exit ${result.status}):\n${result.out.slice(-2000)}`);
        result = { status: Number(m[1]), out: result.out.slice(0, m.index) };
      } finally {
        const rm = run('adb', adb('shell', 'rm', '-rf', DEVICE_DIR));
        if (rm.status !== 0) console.error(`warning: could not remove ${DEVICE_DIR} on ${serial}: ${rm.out}`);
      }
    }
    process.stdout.write(result.out);
    const wrong = judgeDeviceRun(t, plant, result.status, result.out);
    if (wrong !== null) {
      console.log(`FAIL ${platform} (${label})${plant === undefined ? '' : `, plant ${plant}`}: ${wrong}`);
      return 1;
    }
    if (plant !== undefined) {
      console.log(`PASS ${platform} (${label}): plant ${plant} caught`);
      return 0;
    }
    const summary = (result.out.match(SUMMARY) as RegExpMatchArray)[0];
    const out = join(PACKAGE_DIR, 'transcripts', 'device', `${platform}.txt`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `transcript: ${relative(REPO_ROOT, GATE_TRANSCRIPT_PATH)} sha256 ${sha256Hex(Buffer.from(committed))}, recorded by dragon_hb.wasm sha256 ${t.wasmSha256}\ndevice: ${label}\n${summary}\n`);
    console.log(`PASS ${platform} (${label}): equal to the WASM transcript; wrote ${relative(REPO_ROOT, out)}`);
    return 0;
  } finally {
    // --build-only leaves the build for inspection.
    if (!buildOnly) rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) process.exitCode = main(process.argv.slice(2));
