// pnpm run native:smoke -- --target ios|android (notes/T013-p3-review-p4-plan.md section 2 item 10): the same three cases on both
// platforms, on the iPhone 17 simulator (scale 3) and the dragon-smoke AVD (density 420, scale 2.625). For each case the dump must
// validate, device.scale must equal the device's scale, check (d) must pass against the TS engine and check (b) against the
// expected dump at that DPR, and the bridge self-check must pass. This is not a lane and is not recorded in lanes.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpectedDump } from 'dragon';
import { expectedDigest, expectedDump } from 'dragon';
import type { ExpectedApplied } from '../native-compare.ts';
import { checkAgainstEngine, checkApplied } from '../native-compare.ts';
import type { NativeDump } from '../native-dump.ts';
import { validateNativeDump } from '../native-dump.ts';
import type { AvdDeviceSpec } from '../device-run.ts';
import { admitDevice, bootAvd, DEVICE_MATRIX, installApk, release as releaseDevice } from '../device-run.ts';
import { BACKEND_OF, buildAndroid, buildIos, engineBoxes, expectedEngine, HOST_BUNDLE, nativeCases, nativeOut, run } from '../native-host.ts';
import { repoPath } from '../paths.ts';
import type { NativeTarget } from '../targets.ts';
import { deviceDprs } from '../targets.ts';

const args = process.argv.slice(2);
export const SMOKE_CASES = ['color-border-sides', 'text-wrap-spaces', 'overflow-hidden-bfc'] as const;
const IOS_DEVICE = 'iPhone 17';
/** The AVD: dragon-smoke (API 36) by default; --avd names another AVD at or above the API 31 floor. */
const AVD = args.includes('--avd') ? (args[args.indexOf('--avd') + 1] as string) : 'dragon-smoke';
const RENDERER = 'swiftshader_indirect';
/** The console port of an AVD outside the matrix (the floor probe). */
const SMOKE_PORT = 5590;

const target = args[args.indexOf('--target') + 1] as NativeTarget;
if (target !== 'ios' && target !== 'android') {
  console.error('usage: native:smoke -- --target ios|android');
  process.exit(2);
}
const log = (s: string): void => console.log(`native:smoke ${target}: ${s}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** The device scale, recorded as soon as it is known, so a host failure still checks the dumps it wrote. */
let lastScale: number | null = null;
const ahemSha = createHash('sha256').update(readFileSync(repoPath('vendor/fonts/Ahem.ttf'))).digest('hex');

async function poll(what: string, timeoutMs: number, done: () => boolean): Promise<void> {
  const t0 = Date.now();
  while (!done()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
    await sleep(500);
  }
}

// ---------------------------------------------------------------- iOS

async function smokeIos(outDir: string): Promise<{ scale: number; files: string }> {
  const list = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']).out) as { devices: Record<string, { name: string; udid: string; state: string }[]> };
  const runtimes = Object.keys(list.devices).filter((r) => r.includes('iOS')).sort();
  const runtime = runtimes.reverse().find((r) => (list.devices[r] ?? []).some((d) => d.name === IOS_DEVICE));
  const dev = runtime === undefined ? undefined : (list.devices[runtime] ?? []).find((d) => d.name === IOS_DEVICE);
  if (dev === undefined || runtime === undefined) throw new Error(`no available ${IOS_DEVICE} simulator (tooling fault)`);
  // The device's scale from its device type profile, independent of the app.
  const types = JSON.parse(run('xcrun', ['simctl', 'list', 'devicetypes', '-j']).out) as { devicetypes: { name: string; bundlePath: string }[] };
  const type = types.devicetypes.find((t) => t.name === IOS_DEVICE);
  if (type === undefined) throw new Error(`no device type ${IOS_DEVICE}`);
  const caps = run('plutil', ['-p', join(type.bundlePath, 'Contents', 'Resources', 'capabilities.plist')]).out;
  const scale = Number(/"ArtworkDeviceScaleFactor" => (\d+(?:\.\d+)?)/.exec(caps)?.[1]);
  lastScale = scale;
  log(`${IOS_DEVICE} ${dev.udid}, runtime ${runtime.replace(/^.*SimRuntime\./, '')}, device type scale ${scale} (capabilities.plist ArtworkDeviceScaleFactor)`);
  // Like every boot, only under the device lease and admitted by the memory budget (device-run.ts); this run leaves the simulator
  // booted, so its memory stays reserved until the process exits.
  await admitDevice({ target: 'ios', name: IOS_DEVICE });
  for (let attempt = 1; ; attempt++) {
    if (dev.state !== 'Booted') run('xcrun', ['simctl', 'boot', dev.udid]);
    const b = run('xcrun', ['simctl', 'bootstatus', dev.udid, '-b'], { timeoutMs: 180_000 });
    if (b.status === 0) break;
    // A simulator booting or booted elsewhere is never shut down by this run.
    if (attempt === 2 || dev.state !== 'Shutdown') throw new Error(`the ${IOS_DEVICE} simulator failed to boot (tooling fault; it was ${dev.state} before this run): ${b.out.slice(-500)}`);
    run('xcrun', ['simctl', 'shutdown', dev.udid]);
  }
  const build = buildIos({ reuse: true });
  log(`built ${build.cases} cases, source sha256 ${build.sourceSha256}`);
  const inst = run('xcrun', ['simctl', 'install', dev.udid, build.artifact]);
  if (inst.status !== 0) throw new Error(`simctl install failed: ${inst.out}`);
  const env = { ...process.env, SIMCTL_CHILD_DRAGON_OUT: outDir };
  const launch = run('xcrun', ['simctl', 'launch', '--terminate-running-process', dev.udid, HOST_BUNDLE, '--dragon-cases', SMOKE_CASES.join(',')], { env });
  if (launch.status !== 0) throw new Error(`simctl launch failed: ${launch.out}`);
  await poll('the iOS host to finish', 180_000, () => existsSync(join(outDir, 'done-ios')));
  return { scale, files: outDir };
}

// ---------------------------------------------------------------- Android

async function smokeAndroid(outDir: string): Promise<{ scale: number; files: string }> {
  // By serial (O3): the matrix AVD on its own port, or another AVD (the floor probe) on a port of its own; an emulator this run
  // did not start is never killed.
  const spec: AvdDeviceSpec = (DEVICE_MATRIX.find((d) => d.target === 'android' && d.name === AVD) as AvdDeviceSpec | undefined) ?? { target: 'android', name: AVD, density: 0, width: 0, height: 0, port: SMOKE_PORT };
  const h = await bootAvd(spec, false);
  if ('udid' in h) throw new Error('not an emulator');
  const adb = (a: readonly string[], timeoutMs = 120_000) => run(h.tools.adb, ['-s', h.serial, ...a], { timeoutMs });
  try {
    const density = /Physical density:\s*(\d+)/.exec(adb(['shell', 'wm', 'density']).out)?.[1];
    if (density === undefined) throw new Error('adb shell wm density gave no physical density');
    const scale = Number(density) / 160;
    lastScale = scale;
    const release = adb(['shell', 'getprop', 'ro.build.version.release']).out.trim();
    const sdk = adb(['shell', 'getprop', 'ro.build.version.sdk']).out.trim();
    log(`${AVD} (${h.serial}), Android ${release} (API ${sdk}; text drawn with Canvas.drawGlyphs), density ${density}, scale ${scale}`);
    const build = buildAndroid({ reuse: true });
    log(`built ${build.cases} cases, source sha256 ${build.sourceSha256}`);
    const inst = installApk(h, build.artifact);
    if (inst.status !== 0 || !/Success/.test(inst.out)) throw new Error(`adb install failed: ${inst.out}`);
    const remote = `/sdcard/Android/data/${HOST_BUNDLE}/files`;
    adb(['shell', 'rm', '-rf', remote]);
    adb(['shell', 'am', 'force-stop', HOST_BUNDLE]);
    const start = adb(['shell', 'am', 'start', '-W', '-n', `${HOST_BUNDLE}/.DragonActivity`, '--es', 'dragon.cases', `'${SMOKE_CASES.join(',')}'`, '--es', 'dragon.model', AVD, '--es', 'dragon.renderer', RENDERER]);
    if (start.status !== 0 || /Error/.test(start.out)) throw new Error(`am start failed: ${start.out}`);
    adb(['logcat', '-c', '-b', 'crash']);
    try {
      await poll('the Android host to finish', 180_000, () => {
        if (adb(['logcat', '-d', '-b', 'crash'], 20_000).out.includes('dev.dragon.host')) throw new Error('the Android host crashed');
        return adb(['shell', 'ls', `${remote}/done-android`], 10_000).status === 0;
      });
    } finally {
      const pull = adb(['pull', `${remote}/.`, outDir]);
      if (pull.status !== 0) console.error(`adb pull failed: ${pull.out}`);
    }
    return { scale, files: outDir };
  } finally {
    const crash = adb(['logcat', '-d', '-b', 'crash'], 20_000).out.trim();
    if (crash !== '') console.error(crash.slice(-4000));
    await releaseDevice(h);
  }
}

// ---------------------------------------------------------------- checks

type Bridge = { platform: string; fontSha256: string; selfCheck: string; mismatches: string[]; unitsPerEm: number; ascent: number; descent: number; lineGap: number };

async function main(): Promise<number> {
  const outDir = join(nativeOut(target), target === 'android' ? `smoke-${AVD}` : 'smoke');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  let hostError: string | null = null;
  let device: { scale: number; files: string };
  try {
    device = target === 'ios' ? await smokeIos(outDir) : await smokeAndroid(outDir);
  } catch (e) {
    // A host that stopped early still leaves its bridge record and the dumps it wrote; they are checked below.
    hostError = e instanceof Error ? e.message : String(e);
    if (lastScale === null) throw e;
    device = { scale: lastScale, files: outDir };
  }
  if (!deviceDprs(target).includes(device.scale)) throw new Error(`the device scale ${device.scale} is not a ${target} device DPR (${deviceDprs(target).join(', ')})`);
  let failures = hostError === null ? 0 : 1;
  if (hostError !== null) console.error(`native:smoke ${target}: FAIL the host did not finish: ${hostError}`);
  const fail = (s: string): void => {
    failures++;
    console.error(`native:smoke ${target}: FAIL ${s}`);
  };
  const bridgeFile = join(outDir, `bridge-${target}.json`);
  if (!existsSync(bridgeFile)) fail('no bridge self-check record');
  else {
    const b = JSON.parse(readFileSync(bridgeFile, 'utf8')) as Bridge;
    const ok = b.selfCheck === 'pass' && b.mismatches.length === 0 && b.fontSha256 === ahemSha;
    const probe = (b as unknown as { probe?: { textSize: number; advanceUnits: number }[] }).probe ?? [];
    log(`bridge advance probe (evidence only), U+0058 in font units by text size: ${probe.map((x) => `${x.textSize}: ${x.advanceUnits}`).join(', ')}`);
    log(`bridge self-check ${b.selfCheck}: unitsPerEm ${b.unitsPerEm}, ascent ${b.ascent}, descent ${b.descent}, lineGap ${b.lineGap}, 95 advances; font sha256 ${b.fontSha256} (repo Ahem ${b.fontSha256 === ahemSha ? 'equal' : 'DIFFERENT'})`);
    if (!ok) fail(`bridge self-check: ${b.mismatches.slice(0, 6).join('; ') || 'font sha256 differs'}${b.mismatches.length > 6 ? ` (and ${b.mismatches.length - 6} more)` : ''}`);
  }
  const backend = BACKEND_OF[target];
  const m = expectedEngine();
  for (const id of SMOKE_CASES) {
    const n = nativeCases().find((c) => c.case.id === id);
    if (n === undefined) throw new Error(`no layout case ${id}`);
    const file = join(outDir, `${id}@${device.scale}.json`);
    if (!existsSync(file)) {
      fail(`${id}: no dump at ${file}`);
      continue;
    }
    const v = validateNativeDump(JSON.parse(readFileSync(file, 'utf8')));
    if (!v.ok) {
      fail(`${id}: the dump does not validate: ${v.errors.slice(0, 5).map((e) => `${e.path} ${e.code}`).join('; ')}`);
      continue;
    }
    const dump: NativeDump = v.dump;
    const lane = target === 'ios' ? 'ios-sim' : 'android-emu';
    if (dump.lane !== lane) fail(`${id}: lane ${dump.lane}, expected ${lane}`);
    if (dump.device.scale !== device.scale) fail(`${id}: device.scale ${dump.device.scale} is not the device's scale ${device.scale}`);
    const program = n.programs[backend];
    const viewport = n.case.environment.viewport;
    const d = checkAgainstEngine(dump, engineBoxes(program, viewport, device.scale));
    const e: ExpectedDump = expectedDump(program, id, viewport, device.scale, m);
    const expected: ExpectedApplied = new Map(e.nodes.map((x) => [x.id, x.applied]));
    const b = checkApplied(dump, expected);
    const natives = e.nodes.filter((x) => dump.nodes.find((y) => y.id === x.id)?.native !== x.native).map((x) => `${x.id}: native ${dump.nodes.find((y) => y.id === x.id)?.native ?? 'missing'}, expected ${x.native}`);
    const digestOk = dump.case.expectedDigest === expectedDigest(e);
    log(`${id} @${device.scale}: valid; ${dump.nodes.length} nodes, ${dump.nodes.reduce((k, x) => k + x.lines.length, 0)} lines; (d) ${d.pass ? 'pass' : 'FAIL'} (${d.compared} compared); (b) ${b.pass && natives.length === 0 ? 'pass' : 'FAIL'} (${b.compared} applied values); expectedDigest ${digestOk ? 'equal' : 'DIFFERENT'}; ${dump.device.os}; ${dump.device.model}; ${dump.device.toolchain}; pixels ${dump.pixels?.capture} ${dump.pixels?.width}x${dump.pixels?.height}`);
    if (!d.pass) fail(`${id} (d): ${d.problems.slice(0, 12).join(' | ')}`);
    if (!b.pass) fail(`${id} (b): ${b.problems.slice(0, 12).join(' | ')}`);
    if (natives.length > 0) fail(`${id} native classes: ${natives.join(' | ')}`);
    if (!digestOk) fail(`${id}: expectedDigest ${dump.case.expectedDigest} is not the expected dump's ${expectedDigest(e)}`);
  }
  log(`status ${failures === 0 ? 'pass' : 'fail'} (${failures} failure(s)); dumps in ${outDir}`);
  return failures === 0 ? 0 : 1;
}

main().then((code) => process.exit(code), (e: unknown) => {
  console.error(`native:smoke ${target}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
