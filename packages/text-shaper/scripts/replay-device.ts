// On-device shim equality (T029 runs this; TXT1-N only builds it): replays transcripts/gate.json through the shim built
// for the device and compares every integer, like the host replays in scripts/replay.ts.
//   --platform ios       builds device/ios/main.swift with swift/Sources/DragonHBShaper against DragonHB.xcframework's
//                        simulator slice and runs it with `xcrun simctl spawn <device>` (default: booted).
//   --platform android   builds kotlin/src plus device/android with kotlinc and d8, pushes the dex, libdragon_hb.so for the
//                        device ABI, the transcript and its faces to /data/local/tmp/dragon-hb, and runs it with app_process.
//   --device <id>        simulator UDID or adb serial.
//   --plant off-by-one   one expected integer changed; the replay must exit 1.
//   --build-only         builds everything and starts nothing on a device.
// An unplanted run writes transcripts/device/<platform>.txt (the device's output).
// Needs: zig, Xcode (ios); JAVA_HOME, kotlinc, ANDROID_HOME build-tools (d8) and adb, -Dandroid-ndk or ANDROID_NDK_HOME (android).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseTranscript, plantTranscript, serializeTranscript } from '../src/transcript.ts';
import type { TranscriptPlant } from '../src/transcript.ts';
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

function transcriptText(plant: TranscriptPlant | undefined): string {
  const text = readFileSync(GATE_TRANSCRIPT_PATH, 'utf8');
  return plant === undefined ? text : serializeTranscript(plantTranscript(parseTranscript(text), plant));
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

function main(argv: readonly string[]): number {
  const args = argv.filter((a) => a !== '--');
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const platform = opt('--platform');
  if (platform !== 'ios' && platform !== 'android') {
    console.error('usage: replay-device.ts --platform ios|android [--device <id>] [--plant off-by-one] [--build-only]');
    return 2;
  }
  const plant = opt('--plant') as TranscriptPlant | undefined;
  if (plant !== undefined && plant !== 'off-by-one') throw new Error(`unknown plant ${plant}`);
  const buildOnly = args.includes('--build-only');
  const work = mkdtempSync(join(tmpdir(), `dragon-hb-${platform}-`));
  const transcript = join(work, 'gate.json');
  writeFileSync(transcript, transcriptText(plant));

  let result: { status: number; out: string };
  if (platform === 'ios') {
    const exe = buildIos(work);
    if (buildOnly) {
      console.log(`built ${exe}`);
      return 0;
    }
    // Simulator processes read the Mac's file system, so the faces are read in place.
    result = run('xcrun', ['simctl', 'spawn', opt('--device') ?? 'booted', exe, transcript, REPO_ROOT]);
  } else {
    const dex = buildAndroid(work);
    if (buildOnly) {
      console.log(`built ${dex}`);
      return 0;
    }
    const serial = opt('--device');
    const adb = (...a: string[]): string[] => [...(serial !== undefined ? ['-s', serial] : []), ...a];
    const abi = must('adb', adb('shell', 'getprop', 'ro.product.cpu.abi')).trim();
    if (abi !== 'arm64-v8a' && abi !== 'x86_64') throw new Error(`unsupported device ABI ${abi}`);
    must('adb', adb('shell', 'rm', '-rf', DEVICE_DIR));
    must('adb', adb('shell', 'mkdir', '-p', `${DEVICE_DIR}/root`));
    must('adb', adb('push', dex, `${DEVICE_DIR}/replay.dex`));
    must('adb', adb('push', join(PACKAGE_DIR, 'zig-out', 'android', abi, 'libdragon_hb.so'), `${DEVICE_DIR}/libdragon_hb.so`));
    must('adb', adb('push', transcript, `${DEVICE_DIR}/gate.json`));
    for (const f of parseTranscript(readFileSync(transcript, 'utf8')).faces) {
      must('adb', adb('shell', 'mkdir', '-p', `${DEVICE_DIR}/root/${dirname(f.file)}`));
      must('adb', adb('push', join(REPO_ROOT, f.file), `${DEVICE_DIR}/root/${f.file}`));
    }
    result = run('adb', adb('shell', `CLASSPATH=${DEVICE_DIR}/replay.dex app_process /system/bin dev.dragon.text.DeviceMain --lib ${DEVICE_DIR}/libdragon_hb.so ${DEVICE_DIR}/gate.json ${DEVICE_DIR}/root; echo "exit=$?"`));
    const m = /exit=(\d+)\s*$/.exec(result.out);
    result = { status: m === null ? 1 : Number(m[1]), out: result.out.replace(/exit=\d+\s*$/, '') };
  }
  process.stdout.write(result.out);
  if (plant === undefined) {
    const out = join(PACKAGE_DIR, 'transcripts', 'device', `${platform}.txt`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, result.out);
  }
  return result.status;
}

process.exitCode = main(process.argv.slice(2));
