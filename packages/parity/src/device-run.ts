// The device runner and matrix (notes/T015-p4-review-p5-plan.md sections 3.4 and 4 item 1): provisioning and verifying the iOS
// simulators and Android AVDs, headless boots with emulators addressed by serial (an emulator this runner did not start is never
// killed), batch launches of the host app with the run file, pulled dumps, the per-device record (model, OS and build, the scale
// from the device profile and from the app, the window and stage in device px, the text scale), the root-fits-window check, and
// the OS screenshots of the capture-trust probe. One device runs at a time.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SupportPlant } from 'dragon';
import type { GlyphPosition } from './native-compare.ts';
import type { AndroidTools } from './native-host.ts';
import { androidTools, HOST_BUNDLE, run } from './native-host.ts';
import type { NativeTarget } from './targets.ts';
import { deviceDprs } from './targets.ts';

export type IosDeviceSpec = { readonly target: 'ios'; readonly name: string };
export type AvdDeviceSpec = { readonly target: 'android'; readonly name: string; readonly density: number; readonly width: number; readonly height: number; readonly port: number };
export type DeviceSpec = IosDeviceSpec | AvdDeviceSpec;

export const ANDROID_IMAGE = 'system-images;android-36;default;arm64-v8a';
export const ANDROID_RENDERER = 'swiftshader_indirect';
/** The pinned text size: iOS content size large and Android font scale 1.0 (section 3.5). */
export const TEXT_SCALE = { ios: 'UICTContentSizeCategoryL', android: '1.0' } as const;

/**
 * The device matrix (section 3.4). iOS scales come from the device type profile; an AVD's scale is its density / 160. Each AVD
 * has its own console port, so its serial is emulator-<port>.
 */
export const DEVICE_MATRIX: readonly DeviceSpec[] = [
  { target: 'ios', name: 'iPhone 17' },
  { target: 'ios', name: 'iPad (A16)' },
  { target: 'android', name: 'dragon-320', density: 320, width: 1080, height: 2400, port: 5580 },
  { target: 'android', name: 'dragon-smoke', density: 420, width: 1080, height: 2400, port: 5582 },
  { target: 'android', name: 'dragon-480', density: 480, width: 1440, height: 3120, port: 5584 },
];

/** The devices of the layout-vectors-device lane: the vectors are DPR-independent inputs, so one device per target. */
export const VECTOR_DEVICES: { readonly [T in NativeTarget]: string } = { ios: 'iPhone 17', android: 'dragon-smoke' };
/** The capture-trust cases (the three native:smoke cases), held on screen for the OS screenshot on every device. */
export const TRUST_CASES: readonly string[] = ['color-border-sides', 'text-wrap-spaces', 'overflow-hidden-bfc'];
/**
 * The raster plant case: every line has an x centre pair and a glyph-bottom scanline at every device DPR (T093 addendum F1).
 * text-wrap-spaces, the P5 case, stacks Ahem lines at line-height 1, so most of its line bottoms are seams.
 */
export const PLANT_CASE = 'tree-projected-text#1';
/** The devices of the raster plant runs (section 4 item 5). */
export const PLANT_DEVICES: { readonly [T in NativeTarget]: string } = { ios: 'iPhone 17', android: 'dragon-smoke' };
/** The axis each raster plant moves every glyph along, by PLANT_SHIFT_DEVICE_PX. */
export const PLANT_AXIS: { readonly [P in SupportPlant]: 'x' | 'y' } = { 'glyph-offset-1': 'x', 'glyph-offset-y-1': 'y' };
/** T093 ruling A: a plant's glyph positions (x centre, or bottom edge), against the clean run on the same device, move by this much... */
export const PLANT_SHIFT_DEVICE_PX = 1;
/** ...within this... */
export const PLANT_SHIFT_SPREAD_DEVICE_PX = 0.05;
/** ...and each fails the position check by at least this much beyond GATE_GLYPH_POSITION_DEVICE_PX. */
export const PLANT_MARGIN_DEVICE_PX = 0.2;

/** One line's glyph position on the plant axis in the clean and the planted run, against Chrome's. */
export type PlantLine = { readonly line: string; readonly chrome: number; readonly clean: number; readonly planted: number };
export type PlantVerdict = { readonly caught: boolean; readonly lines: readonly PlantLine[]; readonly problems: readonly string[] };

/**
 * A raster plant judged against the clean run (T093 ruling A): both hosts finished; device-frames and device-lines have no failure
 * in either run; the clean run has no device-pixels failure; the plant has lines on its axis, the same lines as the clean run; every
 * one fails the position check with at least PLANT_MARGIN_DEVICE_PX to spare; and every one moved by PLANT_SHIFT_DEVICE_PX within
 * PLANT_SHIFT_SPREAD_DEVICE_PX from the clean run.
 */
export function judgeGlyphPlant(plant: SupportPlant, clean: { readonly failures: number; readonly centres: readonly GlyphPosition[] }, planted: readonly GlyphPosition[], gate: number, runs: { readonly hostErrors: readonly string[]; readonly frames: number; readonly lines: number }): PlantVerdict {
  const axis = PLANT_AXIS[plant];
  const problems: string[] = [...runs.hostErrors];
  if (runs.frames > 0) problems.push(`device-frames has ${runs.frames} failure(s) across the two runs`);
  if (runs.lines > 0) problems.push(`device-lines has ${runs.lines} failure(s) across the two runs`);
  if (clean.failures > 0) problems.push(`the clean run has ${clean.failures} device-pixels failure(s)`);
  const cleanAt = new Map(clean.centres.filter((c) => c.axis === axis).map((c) => [c.line, c]));
  const plantedOn = planted.filter((c) => c.axis === axis);
  if (plantedOn.length === 0) problems.push(`no ${axis} glyph position line was measured`);
  if (plantedOn.length !== cleanAt.size || plantedOn.some((c) => !cleanAt.has(c.line))) problems.push(`the planted run measured ${plantedOn.length} ${axis} position lines, the clean run ${cleanAt.size}, not the same lines`);
  const lines: PlantLine[] = [];
  for (const c of plantedOn) {
    const base = cleanAt.get(c.line);
    if (base === undefined) continue;
    lines.push({ line: c.line, chrome: c.chrome, clean: base.native, planted: c.native });
    const shift = c.native - base.native;
    const margin = Math.abs(c.native - c.chrome) - gate;
    if (Math.abs(shift - PLANT_SHIFT_DEVICE_PX) > PLANT_SHIFT_SPREAD_DEVICE_PX) problems.push(`${c.line}: the glyph ${axis === 'x' ? 'centre' : 'bottom edge'} moved ${shift.toFixed(3)} device px from the clean run, not ${PLANT_SHIFT_DEVICE_PX} within ${PLANT_SHIFT_SPREAD_DEVICE_PX}`);
    if (!(margin >= PLANT_MARGIN_DEVICE_PX)) problems.push(`${c.line}: the position check fails by ${margin.toFixed(3)} device px beyond the gate, less than ${PLANT_MARGIN_DEVICE_PX}`);
  }
  return { caught: problems.length === 0, lines, problems };
}

export const avdScale = (d: AvdDeviceSpec): number => d.density / 160;

/**
 * Matrix problems of the given targets: every target DPR needs exactly one device whose scale it is; no device may run a DPR its
 * target lacks.
 */
export function matrixProblems(scaleOf: (d: DeviceSpec) => number, matrix: readonly DeviceSpec[] = DEVICE_MATRIX, targets: readonly NativeTarget[] = ['ios', 'android']): string[] {
  const out: string[] = [];
  for (const target of targets) {
    const devices = matrix.filter((d) => d.target === target);
    for (const dpr of deviceDprs(target)) {
      const on = devices.filter((d) => scaleOf(d) === dpr);
      if (on.length !== 1) out.push(`${target} DPR ${dpr}: ${on.length} devices (${on.map((d) => d.name).join(', ') || 'none'}); the matrix needs exactly one`);
    }
    for (const d of devices) if (!deviceDprs(target).includes(scaleOf(d))) out.push(`${d.name}: scale ${scaleOf(d)} is not one of the ${target} device DPRs (${deviceDprs(target).join(', ')})`);
  }
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** run() without blocking the event loop: the exit status (1 on a timeout or spawn error) and the output. */
export function runAsync(cmd: string, args: readonly string[], timeoutMs: number): Promise<{ readonly status: number; readonly out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL' });
    let out = '';
    p.stdout.on('data', (d: Buffer) => void (out += d.toString('utf8')));
    p.stderr.on('data', (d: Buffer) => void (out += d.toString('utf8')));
    p.once('error', (e) => resolve({ status: 127, out: `${out}${String(e)}` }));
    p.once('close', (code, signal) => resolve({ status: code ?? 1, out: signal === null ? out : `${out} (killed by ${signal})` }));
  });
}
async function poll(what: string, timeoutMs: number, done: () => boolean | Promise<boolean>): Promise<void> {
  const t0 = Date.now();
  while (!(await done())) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
    await sleep(500);
  }
}

// ---------------------------------------------------------------- iOS

type SimDevice = { readonly name: string; readonly udid: string; readonly state: string };

function simctlJson<T>(args: readonly string[]): T {
  const r = run('xcrun', ['simctl', 'list', ...args, '-j']);
  if (r.status !== 0) throw new Error(`simctl list ${args.join(' ')} failed (tooling fault): ${r.out.slice(-400)}`);
  return JSON.parse(r.out) as T;
}

/** The newest iOS runtime: its identifier, version and build. */
export function iosRuntime(): { readonly identifier: string; readonly version: string; readonly build: string } {
  const rts = simctlJson<{ runtimes: { identifier: string; version: string; buildversion: string; isAvailable: boolean; platform?: string; name: string }[] }>(['runtimes']).runtimes;
  const ios = rts.filter((r) => r.isAvailable && r.name.startsWith('iOS')).sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  const last = ios[ios.length - 1];
  if (last === undefined) throw new Error('no available iOS simulator runtime (tooling fault)');
  return { identifier: last.identifier, version: last.version, build: last.buildversion };
}

/** The device type profile scale (capabilities.plist ArtworkDeviceScaleFactor), independent of the app. */
export function iosProfileScale(name: string): number {
  const types = simctlJson<{ devicetypes: { name: string; bundlePath: string; identifier: string }[] }>(['devicetypes']).devicetypes;
  const type = types.find((t) => t.name === name);
  if (type === undefined) throw new Error(`no simulator device type ${name} (tooling fault)`);
  const caps = run('plutil', ['-p', join(type.bundlePath, 'Contents', 'Resources', 'capabilities.plist')]).out;
  const scale = Number(/"ArtworkDeviceScaleFactor" => (\d+(?:\.\d+)?)/.exec(caps)?.[1]);
  if (!Number.isFinite(scale)) throw new Error(`${name}: capabilities.plist has no ArtworkDeviceScaleFactor`);
  return scale;
}

/** The simulator named name on the newest runtime, created with simctl when none exists. */
export function provisionIos(name: string): { readonly udid: string; readonly created: boolean } {
  const rt = iosRuntime();
  const list = simctlJson<{ devices: Record<string, SimDevice[]> }>(['devices', 'available']);
  const have = (list.devices[rt.identifier] ?? []).find((d) => d.name === name);
  if (have !== undefined) return { udid: have.udid, created: false };
  const types = simctlJson<{ devicetypes: { name: string; identifier: string }[] }>(['devicetypes']).devicetypes;
  const type = types.find((t) => t.name === name);
  if (type === undefined) throw new Error(`no simulator device type ${name} (tooling fault)`);
  const r = run('xcrun', ['simctl', 'create', name, type.identifier, rt.identifier]);
  if (r.status !== 0) throw new Error(`simctl create ${name} failed (tooling fault): ${r.out}`);
  return { udid: r.out.trim(), created: true };
}

function simState(udid: string): string {
  const list = simctlJson<{ devices: Record<string, SimDevice[]> }>(['devices']);
  for (const ds of Object.values(list.devices)) for (const d of ds) if (d.udid === udid) return d.state;
  return 'missing';
}

// ---------------------------------------------------------------- Android

export const avdDir = (name: string): string => join(homedir(), '.android', 'avd', `${name}.avd`);

function avdConfig(name: string): Map<string, string> {
  const p = join(avdDir(name), 'config.ini');
  const out = new Map<string, string>();
  if (!existsSync(p)) return out;
  for (const l of readFileSync(p, 'utf8').split('\n')) {
    const i = l.indexOf('=');
    if (i > 0) out.set(l.slice(0, i).trim(), l.slice(i + 1).trim());
  }
  return out;
}

/** The config.ini keys the matrix pins for an AVD. */
export function avdKeys(d: AvdDeviceSpec): Map<string, string> {
  return new Map([
    ['hw.lcd.density', String(d.density)],
    ['hw.lcd.width', String(d.width)],
    ['hw.lcd.height', String(d.height)],
    ['image.sysdir.1', `${ANDROID_IMAGE.split(';').join('/')}/`],
  ]);
}

/** Creates the AVD from the android-36 image when it is missing (avdmanager), then pins its display keys in config.ini. */
export function provisionAvd(d: AvdDeviceSpec, tools: AndroidTools): { readonly created: boolean; readonly changed: readonly string[] } {
  let created = false;
  if (!existsSync(join(avdDir(d.name), 'config.ini'))) {
    const avdmanager = join(tools.home, 'cmdline-tools', 'latest', 'bin', 'avdmanager');
    const tool = existsSync(avdmanager) ? avdmanager : 'avdmanager';
    const r = run('sh', ['-c', `echo no | "${tool}" create avd -n ${d.name} -k "${ANDROID_IMAGE}" -d pixel_7`], { env: { ...process.env, JAVA_HOME: tools.javaHome } });
    if (r.status !== 0) throw new Error(`avdmanager create avd ${d.name} failed (tooling fault): ${r.out.slice(-800)}`);
    created = true;
  }
  const path = join(avdDir(d.name), 'config.ini');
  const text = readFileSync(path, 'utf8');
  const have = avdConfig(d.name);
  const changed: string[] = [];
  let next = text;
  for (const [k, v] of avdKeys(d)) {
    if (have.get(k) === v) continue;
    changed.push(`${k}=${v}`);
    const re = new RegExp(`^${k.replace(/\./g, '\\.')}\\s*=.*$`, 'm');
    next = re.test(next) ? next.replace(re, `${k}=${v}`) : `${next.replace(/\n?$/, '\n')}${k}=${v}\n`;
  }
  if (changed.length > 0) writeFileSync(path, next);
  return { created, changed };
}

// ---------------------------------------------------------------- handles

/** A booted device. startedHere: this runner booted it, so it shuts it down (and only it). */
export type DeviceHandle =
  | { readonly spec: IosDeviceSpec; readonly udid: string; readonly startedHere: boolean }
  | { readonly spec: AvdDeviceSpec; readonly serial: string; readonly startedHere: boolean; readonly tools: AndroidTools };

export type DeviceProfile = { readonly name: string; readonly target: NativeTarget; readonly os: string; readonly build: string; readonly profileScale: number };

function adb(h: { serial: string; tools: AndroidTools }, args: readonly string[], timeoutMs = 120_000) {
  return run(h.tools.adb, ['-s', h.serial, ...args], { timeoutMs });
}

export async function bootIos(spec: IosDeviceSpec): Promise<DeviceHandle> {
  const { udid } = provisionIos(spec.name);
  const was = simState(udid);
  try {
    return await bootIosFrom(spec, udid, was);
  } catch (e) {
    // A simulator this runner booted is shut down again; one already booted or booting elsewhere is left alone.
    if (was === 'Shutdown') run('xcrun', ['simctl', 'shutdown', udid]);
    throw e;
  }
}

async function bootIosFrom(spec: IosDeviceSpec, udid: string, was: string): Promise<DeviceHandle> {
  for (let attempt = 1; ; attempt++) {
    if (simState(udid) !== 'Booted') run('xcrun', ['simctl', 'boot', udid]);
    // Awaited, not blocking, so a device process can compute its cases while the simulator boots.
    const b = await runAsync('xcrun', ['simctl', 'bootstatus', udid, '-b'], 300_000);
    if (b.status === 0) break;
    if (attempt === 2 || was !== 'Shutdown') throw new Error(`the ${spec.name} simulator failed to boot${was === 'Shutdown' ? ' twice' : ` (it was ${was} before this run, so it is left alone)`} (tooling fault): ${b.out.slice(-500)}`);
    run('xcrun', ['simctl', 'shutdown', udid]);
  }
  const ui = run('xcrun', ['simctl', 'ui', udid, 'content_size', 'large']);
  if (ui.status !== 0) throw new Error(`simctl ui content_size large failed on ${spec.name}: ${ui.out}`);
  return { spec, udid, startedHere: was === 'Shutdown' };
}

function serialsRunning(tools: AndroidTools): string[] {
  return run(tools.adb, ['devices']).out.split('\n').map((l) => /^(emulator-\d+)\s+device/.exec(l)?.[1]).filter((s): s is string => s !== undefined);
}

/**
 * A detached child whose spawn error (a missing or unexecutable binary) is kept, not left unhandled: check() rethrows it, so the
 * caller's retry and tooling-fault handling sees it.
 */
export function spawnDetached(cmd: string, args: readonly string[]): { readonly check: () => void; readonly alive: () => boolean } {
  let failure: Error | null = null;
  const p = spawn(cmd, [...args], { detached: true, stdio: 'ignore' });
  p.once('error', (e) => {
    failure = e;
  });
  p.unref();
  return {
    check: () => {
      if (failure !== null) throw new Error(`${cmd} could not be started: ${(failure as Error).message}`);
    },
    alive: () => failure === null && p.exitCode === null && p.signalCode === null,
  };
}

/** The API level of ANDROID_IMAGE (system-images;android-<N>;...). */
export const ANDROID_IMAGE_API = Number(/;android-(\d+);/.exec(ANDROID_IMAGE)?.[1]);

/** What a running emulator reports about itself: its AVD name, physical display size and density, and API level. */
export type LiveAvd = { readonly name: string; readonly size: string; readonly density: string; readonly sdk: string };

function readLive(h: { readonly serial: string; readonly tools: AndroidTools }): LiveAvd {
  return {
    name: adb(h, ['emu', 'avd', 'name']).out.split('\n')[0]?.trim() ?? '',
    size: /Physical size:\s*(\d+x\d+)/.exec(adb(h, ['shell', 'wm', 'size']).out)?.[1] ?? '',
    density: /Physical density:\s*(\d+)/.exec(adb(h, ['shell', 'wm', 'density']).out)?.[1] ?? '',
    sdk: adb(h, ['shell', 'getprop', 'ro.build.version.sdk']).out.trim(),
  };
}

/**
 * A running emulator is the matrix device only if its live AVD name, display size, density and API level are the spec's (config.ini
 * changes take effect only at boot, so an emulator started before provisioning may still run the old ones). The floor probe AVD,
 * outside the matrix, checks the name only (expectSdk null, no geometry).
 */
export function liveProblems(spec: AvdDeviceSpec, live: LiveAvd, expectSdk: number | null): string[] {
  const out: string[] = [];
  if (live.name !== spec.name) out.push(`it runs the AVD ${JSON.stringify(live.name)}, not ${spec.name}`);
  if (expectSdk === null) return out;
  if (live.size !== `${spec.width}x${spec.height}`) out.push(`display ${live.size || 'unknown'}, the matrix ${spec.width}x${spec.height}`);
  if (live.density !== String(spec.density)) out.push(`density ${live.density || 'unknown'}, the matrix ${spec.density}`);
  if (live.sdk !== String(expectSdk)) out.push(`API ${live.sdk || 'unknown'}, the image ${expectSdk}`);
  return out;
}

/** Boots an AVD headless on its own console port; provision pins the matrix keys first (the floor probe AVD is not in the matrix). */
export async function bootAvd(spec: AvdDeviceSpec, provision = true): Promise<DeviceHandle> {
  const tools = androidTools();
  if (provision) provisionAvd(spec, tools);
  else if (!existsSync(join(avdDir(spec.name), 'config.ini'))) throw new Error(`no AVD ${spec.name} (tooling fault)`);
  const serial = `emulator-${spec.port}`;
  const h = { spec, serial, tools };
  const expectSdk = provision ? ANDROID_IMAGE_API : null;
  if (serialsRunning(tools).includes(serial)) {
    const live = liveProblems(spec, readLive(h), expectSdk);
    if (live.length > 0) throw new Error(`${serial} is running but is not the matrix device: ${live.join('; ')}; it was not started by this runner, so it is left running (tooling fault)`);
    await prepareAvd(h);
    return { ...h, startedHere: false };
  }
  for (let attempt = 1; ; attempt++) {
    const p = spawnDetached(tools.emulator, ['-avd', spec.name, '-port', String(spec.port), '-no-window', '-no-audio', '-no-snapshot', '-no-boot-anim', '-gpu', ANDROID_RENDERER]);
    try {
      await poll(`${serial} to attach`, 240_000, () => {
        p.check();
        return serialsRunning(tools).includes(serial);
      });
      await poll(`${serial} sys.boot_completed`, 420_000, () => adb(h, ['shell', 'getprop', 'sys.boot_completed'], 10_000).out.trim() === '1');
      break;
    } catch (e) {
      // Only the emulator this attempt spawned is killed: if it exited (say, the port was taken), the serial is someone else's.
      if (!p.alive()) throw new Error(`the ${spec.name} emulator exited before it booted; ${serial} is left alone (tooling fault): ${e instanceof Error ? e.message : String(e)}`);
      adb(h, ['emu', 'kill']);
      await sleep(5000);
      if (attempt === 2) throw new Error(`the ${spec.name} emulator failed to boot twice (tooling fault): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    const live = liveProblems(spec, readLive(h), expectSdk);
    if (live.length > 0) throw new Error(`${serial} booted but is not the matrix device: ${live.join('; ')} (tooling fault)`);
    await prepareAvd(h);
  } catch (e) {
    // This runner started it, so it stops it rather than leave the port taken.
    await release({ ...h, startedHere: true });
    throw e;
  }
  return { ...h, startedHere: true };
}

/**
 * No animations, the pinned text scale, the screen awake and unlocked for the whole run, and no error dialogs: a freshly booted
 * image under load may raise an ANR dialog for System UI, which takes the focus from the app (Settings.Global.HIDE_ERROR_DIALOGS).
 */
async function prepareAvd(h: { readonly serial: string; readonly tools: AndroidTools }): Promise<void> {
  adb(h, ['shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1']);
  for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) adb(h, ['shell', 'settings', 'put', 'global', k, '0']);
  adb(h, ['shell', 'settings', 'put', 'system', 'font_scale', TEXT_SCALE.android]);
  adb(h, ['shell', 'svc', 'power', 'stayon', 'true']);
  adb(h, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  adb(h, ['shell', 'wm', 'dismiss-keyguard']);
  await waitForSettledFocus(h);
}

/** The focus read from `dumpsys window`: the focused window (mCurrentFocus) and the focused activity (mFocusedApp). */
export type WindowFocus = { readonly currentFocus: string; readonly focusedApp: string };

/**
 * The focus in `dumpsys window` output, or null when it cannot be read: either line missing, empty, or given twice with different
 * values (the runner uses one display, so two focuses is not a state it can judge).
 */
export function parseWindowFocus(text: string): WindowFocus | null {
  const one = (key: string): string | null => {
    const values = new Set([...text.matchAll(new RegExp(`^\\s*${key}=(.*)$`, 'gm'))].map((m) => (m[1] ?? '').trim()));
    const [v] = values;
    return values.size === 1 && v !== undefined && v !== '' ? v : null;
  };
  const currentFocus = one('mCurrentFocus');
  const focusedApp = one('mFocusedApp');
  return currentFocus === null || focusedApp === null ? null : { currentFocus, focusedApp };
}

/** The home screen holds the focus when this many consecutive samples, SETTLE_INTERVAL_MS apart, read the same launcher focus. */
export const SETTLE_SAMPLES = 6;
export const SETTLE_INTERVAL_MS = 500;
export const SETTLE_TIMEOUT_MS = 300_000;

/** The focus wait so far: the last sample (null when unparseable), its raw text, how many samples in a row read it, and totals. */
export type SettleState = { readonly last: WindowFocus | null; readonly raw: string; readonly stable: number; readonly samples: number; readonly changes: number; readonly unparseable: number };
export const SETTLE_START: SettleState = { last: null, raw: '', stable: 0, samples: 0, changes: 0, unparseable: 0 };

const DIALOG = /Not Responding|has stopped|isn't responding/i;
const LAUNCHER = /[Ll]auncher/;

/**
 * One focus sample judged: 'back' closes an error dialog, 'home' asks for the home screen when something else has the focus,
 * 'wait' samples again, and 'done' when the launcher has held both the focused window and the focused activity, unchanged (the
 * same window object), for `need` samples in a row. Unparseable output never counts toward the run.
 */
export function settleStep(state: SettleState, raw: string, need = SETTLE_SAMPLES): { readonly state: SettleState; readonly action: 'done' | 'wait' | 'home' | 'back' } {
  const f = parseWindowFocus(raw);
  const samples = state.samples + 1;
  const changed = f !== null && state.last !== null && (f.currentFocus !== state.last.currentFocus || f.focusedApp !== state.last.focusedApp);
  const base = { last: f, raw, samples, changes: state.changes + (changed ? 1 : 0), unparseable: state.unparseable + (f === null ? 1 : 0) };
  if (f === null) return { state: { ...base, stable: 0 }, action: 'wait' };
  if (DIALOG.test(f.currentFocus)) return { state: { ...base, stable: 0 }, action: 'back' };
  if (!LAUNCHER.test(f.currentFocus) || !LAUNCHER.test(f.focusedApp)) return { state: { ...base, stable: 0 }, action: 'home' };
  const stable = !changed && state.last !== null && state.stable > 0 ? state.stable + 1 : 1;
  return { state: { ...base, stable }, action: stable >= need ? 'done' : 'wait' };
}

/** Why the focus wait gave up, naming the last state read. */
export function settleTimeoutMessage(serial: string, timeoutMs: number, s: SettleState, need = SETTLE_SAMPLES): string {
  const last =
    s.samples === 0
      ? 'no sample was read'
      : s.last === null
        ? `the last dumpsys window output had no single mCurrentFocus and mFocusedApp: ${JSON.stringify(s.raw.trim().slice(-400))}`
        : `the last focus was mCurrentFocus=${s.last.currentFocus} mFocusedApp=${s.last.focusedApp}, held for ${s.stable} of ${need} samples`;
  return `${serial} did not settle on the home screen within ${timeoutMs / 1000} s (tooling fault): ${last}; ${s.samples} samples, ${s.changes} focus changes, ${s.unparseable} unparseable`;
}

/**
 * A freshly booted image brings up its launcher some seconds after sys.boot_completed; an app launched before that is sent to the
 * back and its window detached. So the run starts only once the launcher has held the focus for SETTLE_SAMPLES samples in a row.
 */
async function waitForSettledFocus(h: { readonly serial: string; readonly tools: AndroidTools }): Promise<void> {
  const t0 = Date.now();
  let state = SETTLE_START;
  for (;;) {
    const r = adb(h, ['shell', 'dumpsys', 'window', '|', 'grep', '-E', "'mCurrentFocus=|mFocusedApp='"], 20_000);
    const step = settleStep(state, r.status === 0 ? r.out : `adb exited ${r.status}: ${r.out}`);
    state = step.state;
    if (step.action === 'done') {
      console.log(`${h.serial}: the home screen held the focus after ${((Date.now() - t0) / 1000).toFixed(1)} s (${state.samples} samples, ${state.changes} focus changes, ${state.unparseable} unparseable)`);
      return;
    }
    if (step.action === 'back') adb(h, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
    if (step.action === 'home') adb(h, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
    if (Date.now() - t0 > SETTLE_TIMEOUT_MS) throw new Error(settleTimeoutMessage(h.serial, SETTLE_TIMEOUT_MS, state));
    await sleep(SETTLE_INTERVAL_MS);
  }
}

export async function boot(spec: DeviceSpec): Promise<DeviceHandle> {
  return spec.target === 'ios' ? bootIos(spec) : bootAvd(spec);
}

/** Shuts down only a device this runner started. */
export async function release(h: DeviceHandle): Promise<void> {
  if (!h.startedHere) return;
  if ('udid' in h) run('xcrun', ['simctl', 'shutdown', h.udid]);
  else {
    adb(h, ['emu', 'kill']);
    await poll(`${h.serial} to stop`, 60_000, () => !serialsRunning(h.tools).includes(h.serial)).catch(() => undefined);
  }
}

export function deviceProfile(h: DeviceHandle): DeviceProfile {
  if ('udid' in h) {
    const rt = iosRuntime();
    return { name: h.spec.name, target: 'ios', os: `iOS ${rt.version}`, build: rt.build, profileScale: iosProfileScale(h.spec.name) };
  }
  const density = /Physical density:\s*(\d+)/.exec(adb(h, ['shell', 'wm', 'density']).out)?.[1];
  if (density === undefined) throw new Error(`${h.serial}: adb shell wm density gave no physical density`);
  const release = adb(h, ['shell', 'getprop', 'ro.build.version.release']).out.trim();
  const sdk = adb(h, ['shell', 'getprop', 'ro.build.version.sdk']).out.trim();
  const id = adb(h, ['shell', 'getprop', 'ro.build.id']).out.trim();
  return { name: h.spec.name, target: 'android', os: `Android ${release} (API ${sdk})`, build: id, profileScale: Number(density) / 160 };
}

// ---------------------------------------------------------------- app runs

/** What the app writes as device-<platform>.json. */
export type AppRecord = {
  readonly platform: NativeTarget;
  readonly model: string;
  readonly os: string;
  readonly build: string;
  readonly scale: number;
  readonly windowPx: readonly [number, number];
  readonly stagePx: readonly [number, number];
  readonly rootOriginPx: readonly [number, number];
  readonly textScale: string;
};

export type RunOptions = {
  /** The run file text (pixel-reference.ts runFileText). */
  readonly runFile: string;
  readonly caseCount: number;
  readonly outDir: string;
  /** With the hold flag: called with each case id while the case is on screen; returns when the OS screenshot is taken. */
  readonly onHold?: (id: string, screenshot: () => Promise<Buffer>) => Promise<void> | void;
};

export type AppRun = { readonly outDir: string; readonly record: AppRecord; readonly error: string | null };

/**
 * The OS screenshot of a held case, once the screen is still: screenshots are taken until two consecutive ones are byte-equal (a
 * screenshot during the app's launch transition differs from the next).
 */
export async function stableScreenshot(h: DeviceHandle, file: string): Promise<Buffer> {
  let last = osScreenshot(h, file);
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const next = osScreenshot(h, file);
    if (Buffer.compare(next, last) === 0) return next;
    last = next;
  }
  throw new Error(`${h.spec.name}: the screen did not settle for the OS screenshot ${file}`);
}

/** The OS screenshot of the whole screen: simctl io screenshot, or adb exec-out screencap -p. */
export function osScreenshot(h: DeviceHandle, file: string): Buffer {
  if ('udid' in h) {
    const r = run('xcrun', ['simctl', 'io', h.udid, 'screenshot', '--type=png', file], { timeoutMs: 60_000 });
    if (r.status !== 0) throw new Error(`simctl io screenshot failed: ${r.out}`);
    return readFileSync(file);
  }
  const r = spawnSync(h.tools.adb, ['-s', h.serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 256 * 1024 * 1024, timeout: 60_000 });
  if (r.status !== 0) throw new Error(`adb exec-out screencap failed: ${String(r.stderr)}`);
  writeFileSync(file, r.stdout as Buffer);
  return r.stdout as Buffer;
}

/** adb install; an app signed by another checkout's debug key is the same test host, so it is uninstalled first. */
export function installApk(h: { readonly serial: string; readonly tools: AndroidTools }, artifact: string): { readonly status: number; readonly out: string } {
  const first = adb(h, ['install', '-r', '-t', artifact], 600_000);
  if (!/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(first.out)) return first;
  adb(h, ['uninstall', HOST_BUNDLE]);
  return adb(h, ['install', '-r', '-t', artifact], 600_000);
}

/** Installs the app, hands it the run file, launches it once for every case in the file, waits and pulls the dumps. */
export async function runApp(h: DeviceHandle, artifact: string, opts: RunOptions): Promise<AppRun> {
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(opts.outDir, { recursive: true });
  const perCase = 3000;
  const timeout = 180_000 + opts.caseCount * perCase;
  let error: string | null = null;
  if ('udid' in h) {
    const inst = run('xcrun', ['simctl', 'install', h.udid, artifact], { timeoutMs: 300_000 });
    if (inst.status !== 0) throw new Error(`simctl install failed: ${inst.out}`);
    run('xcrun', ['simctl', 'terminate', h.udid, HOST_BUNDLE]);
    const container = run('xcrun', ['simctl', 'get_app_container', h.udid, HOST_BUNDLE, 'data']);
    if (container.status !== 0) throw new Error(`simctl get_app_container failed: ${container.out}`);
    const docs = join(container.out.trim(), 'Documents');
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, 'dragon-run.tsv'), opts.runFile);
    const env = { ...process.env, SIMCTL_CHILD_DRAGON_OUT: opts.outDir };
    const launch = run('xcrun', ['simctl', 'launch', '--terminate-running-process', h.udid, HOST_BUNDLE], { env });
    if (launch.status !== 0) throw new Error(`simctl launch failed: ${launch.out}`);
    const shot = (id: string) => (): Promise<Buffer> => stableScreenshot(h, join(opts.outDir, `screen-${id}.png`));
    const held = new Set<string>();
    try {
      await poll('the iOS host to finish', timeout, async () => {
        if (opts.onHold !== undefined) {
          for (const id of pendingHolds(opts.outDir, held)) {
            await opts.onHold(id, shot(id));
            held.add(id);
            writeFileSync(join(opts.outDir, `release-${id}`), 'ok');
          }
        }
        return existsSync(join(opts.outDir, 'done-ios'));
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    rmSync(join(docs, 'dragon-run.tsv'), { force: true });
  } else {
    const remote = `/sdcard/Android/data/${HOST_BUNDLE}/files`;
    const inst = installApk(h, artifact);
    if (inst.status !== 0 || !/Success/.test(inst.out)) throw new Error(`adb install failed: ${inst.out}`);
    adb(h, ['shell', 'am', 'force-stop', HOST_BUNDLE]);
    // A dump left from an earlier run must never be pulled as this run's: the files dir starts empty, or the run stops.
    const cleared = adb(h, ['shell', `rm -rf ${remote} && mkdir -p ${remote} && ls -A ${remote} | wc -l`]);
    if (cleared.status !== 0 || cleared.out.trim() !== '0') throw new Error(`${h.spec.name}: could not empty ${remote} (tooling fault): ${cleared.out.slice(-300)}`);
    const local = join(opts.outDir, 'dragon-run.tsv');
    writeFileSync(local, opts.runFile);
    const push = adb(h, ['push', local, `${remote}/dragon-run.tsv`]);
    rmSync(local, { force: true });
    if (push.status !== 0) throw new Error(`adb push of the run file failed: ${push.out}`);
    adb(h, ['logcat', '-c', '-b', 'crash']);
    const start = adb(h, ['shell', 'am', 'start', '-W', '-n', `${HOST_BUNDLE}/.DragonActivity`, '--es', 'dragon.model', h.spec.name, '--es', 'dragon.renderer', ANDROID_RENDERER]);
    if (start.status !== 0 || /Error/.test(start.out)) throw new Error(`am start failed: ${start.out}`);
    const held = new Set<string>();
    try {
      await poll('the Android host to finish', timeout, async () => {
        if (adb(h, ['logcat', '-d', '-b', 'crash'], 20_000).out.includes(HOST_BUNDLE)) {
          const focus = adb(h, ['shell', 'dumpsys', 'window', '|', 'grep', '-E', "'mCurrentFocus|mFocusedApp'"], 20_000).out.trim();
          const power = adb(h, ['shell', 'dumpsys', 'power', '|', 'grep', '-E', "'mWakefulness=|mHoldingDisplaySuspendBlocker'"], 20_000).out.trim();
          throw new Error(`the Android host crashed (${focus.replace(/\s+/g, ' ')}; ${power.replace(/\s+/g, ' ')}): ${adb(h, ['logcat', '-d', '-b', 'crash'], 20_000).out.slice(-3000)}`);
        }
        if (opts.onHold !== undefined) {
          const listed = adb(h, ['shell', 'ls', remote], 20_000).out.split(/\s+/).filter((f) => f.startsWith('hold-')).map((f) => f.slice('hold-'.length));
          for (const id of listed) {
            if (held.has(id)) continue;
            await opts.onHold(id, () => stableScreenshot(h, join(opts.outDir, `screen-${id}.png`)));
            held.add(id);
            adb(h, ['shell', 'touch', `${remote}/release-${id}`]);
          }
        }
        return adb(h, ['shell', 'ls', `${remote}/done-android`], 10_000).status === 0;
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const pull = adb(h, ['pull', `${remote}/.`, opts.outDir], 600_000);
    if (pull.status !== 0) error = `${error ?? ''} adb pull failed: ${pull.out.slice(-400)}`.trim();
  }
  const recFile = join(opts.outDir, `device-${h.spec.target}.json`);
  if (!existsSync(recFile)) throw new Error(`${h.spec.name}: the app wrote no device record${error === null ? '' : ` (${error})`}`);
  return { outDir: opts.outDir, record: parseAppRecord(readFileSync(recFile, 'utf8'), h.spec.target), error };
}

/**
 * The app's device record, checked field by field: JSON with the platform of the target, non-empty strings, a positive finite
 * scale, pairs of whole non-negative device px, and nothing else. A record that fails is a tooling fault, never a silent pass.
 */
export function parseAppRecord(text: string, target: NativeTarget): AppRecord {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`the device record is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const problems: string[] = [];
  const o = (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  if (o !== v) problems.push('not an object');
  const keys = ['platform', 'model', 'os', 'build', 'scale', 'windowPx', 'stagePx', 'rootOriginPx', 'textScale'];
  for (const k of Object.keys(o)) if (!keys.includes(k) && k !== 'densityDpi') problems.push(`unknown key ${k}`);
  if (o['platform'] !== target) problems.push(`platform ${JSON.stringify(o['platform'])}, the target ${target}`);
  for (const k of ['model', 'os', 'textScale']) if (typeof o[k] !== 'string' || o[k] === '') problems.push(`${k} is not a non-empty string`);
  if (typeof o['build'] !== 'string') problems.push('build is not a string');
  if (typeof o['scale'] !== 'number' || !Number.isFinite(o['scale']) || o['scale'] <= 0) problems.push('scale is not a positive number');
  for (const k of ['windowPx', 'stagePx', 'rootOriginPx']) {
    const p = o[k];
    if (!Array.isArray(p) || p.length !== 2 || !p.every((x) => Number.isInteger(x) && (x as number) >= 0)) problems.push(`${k} is not two whole non-negative device px`);
  }
  if (problems.length > 0) throw new Error(`the ${target} device record is malformed (tooling fault): ${problems.join('; ')}`);
  return o as unknown as AppRecord;
}

function pendingHolds(dir: string, held: ReadonlySet<string>): string[] {
  return readdirSync(dir).filter((f) => f.startsWith('hold-')).map((f) => f.slice('hold-'.length)).filter((id) => !held.has(id));
}

/** The device record of a run: both scales, window and stage, the root offset, the text scale; and whether the root fits. */
export type DeviceRecord = {
  readonly name: string;
  readonly target: NativeTarget;
  readonly model: string;
  readonly os: string;
  readonly build: string;
  readonly profileScale: number;
  readonly appScale: number;
  readonly windowPx: readonly [number, number];
  readonly stagePx: readonly [number, number];
  readonly rootOriginPx: readonly [number, number];
  readonly textScale: string;
};

export function deviceRecord(p: DeviceProfile, a: AppRecord): DeviceRecord {
  return { name: p.name, target: p.target, model: a.model, os: `${p.os}; app: ${a.os}`, build: p.build, profileScale: p.profileScale, appScale: a.scale, windowPx: a.windowPx, stagePx: a.stagePx, rootOriginPx: a.rootOriginPx, textScale: a.textScale };
}

/** Problems with a device record: the two scales differ, the root does not fit the stage, or the text scale is not the pinned one. */
export function recordProblems(r: DeviceRecord, root: { readonly width: number; readonly height: number }): string[] {
  const out: string[] = [];
  // The app must have run on the device the runner booted: iOS reports SIMULATOR_DEVICE_NAME, Android "<model> / <AVD>".
  if (!(r.target === 'ios' ? r.model === r.name : r.model.endsWith(` / ${r.name}`))) out.push(`${r.name}: the app ran on ${JSON.stringify(r.model)}, not ${r.name}`);
  if (r.profileScale !== r.appScale) out.push(`${r.name}: the device profile scale ${r.profileScale} differs from the app's ${r.appScale}`);
  if (r.stagePx[0] < root.width || r.stagePx[1] < root.height) out.push(`${r.name}: the stage ${r.stagePx[0]}x${r.stagePx[1]} device px cannot hold the ${root.width}x${root.height} root (device fit, tooling fault; never cropped)`);
  const pinned = r.target === 'ios' ? TEXT_SCALE.ios : TEXT_SCALE.android;
  if (r.textScale !== pinned) out.push(`${r.name}: text scale ${r.textScale}, pinned ${pinned}`);
  return out;
}
