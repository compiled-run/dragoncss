// The device runner and matrix (notes/T015-p4-review-p5-plan.md sections 3.4 and 4 item 1): provisioning and verifying the iOS
// simulators and Android AVDs, headless boots with emulators addressed by serial (an emulator this runner did not start is never
// killed), batch launches of the host app with the run file, pulled dumps, the per-device record (model, OS and build, the scale
// from the device profile and from the app, the window and stage in device px, the text scale), the root-fits-window check, and
// the OS screenshots of the capture-trust probe. Devices boot only under the device lease, within one in-memory budget.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { freemem, homedir, tmpdir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import type { SupportPlant } from 'dragon';
import type { GlyphPosition } from './native-compare.ts';
import type { AndroidTools } from './native-host.ts';
import { androidTools, HOST_BUNDLE } from './native-host.ts';
import type { ExecResult } from './device-exec.ts';
import { exec, execAsync, execBytes, spawnChild } from './device-exec.ts';
import type { NativeTarget } from './targets.ts';
import { deviceDprs } from './targets.ts';

export type IosDeviceSpec = { readonly target: 'ios'; readonly name: string };
export type AvdDeviceSpec = { readonly target: 'android'; readonly name: string; readonly density: number; readonly width: number; readonly height: number; readonly port: number };
export type DeviceSpec = IosDeviceSpec | AvdDeviceSpec;

/**
 * The android-36 system image of the host's architecture: arm64-v8a on Apple Silicon, x86_64 on an x86-64 Linux host with KVM (CI),
 * where an arm64 image cannot be accelerated. Both are the same Android build line; the device record names the build that ran.
 */
export function androidImage(arch: string): string {
  const abi = arch === 'arm64' ? 'arm64-v8a' : arch === 'x64' ? 'x86_64' : null;
  if (abi === null) throw new Error(`no android-36 system image for the host architecture ${arch} (arm64 and x64 only)`);
  return `system-images;android-36;default;${abi}`;
}
export const ANDROID_IMAGE = androidImage(process.arch);
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
/** The glyph plants (T093), judged against the clean run on PLANT_CASE; every other support plant is a paint plant. */
export type GlyphPlant = 'glyph-offset-1' | 'glyph-offset-y-1';
/** The INL1a line plant, judged against the clean run on LINE_PLANT_CASE (judgeLinePlant). */
export type LinePlant = 'single-run-baseline';
/** The paint plants: every support plant that is neither a glyph plant nor the line plant. */
export type PaintPlant = Exclude<SupportPlant, GlyphPlant | LinePlant>;
export const isGlyphPlant = (p: SupportPlant): p is GlyphPlant => p === 'glyph-offset-1' || p === 'glyph-offset-y-1';
export const isLinePlant = (p: SupportPlant): p is LinePlant => p === 'single-run-baseline';
export const isPaintPlant = (p: SupportPlant): p is PaintPlant => !isGlyphPlant(p) && !isLinePlant(p);
/**
 * The cases each paint plant runs on: the dash plants (P6a) run on the border-paint fixtures, the image plant (REPL-a) on the
 * replaced fixtures whose images are drawn, the radius plant (PNT1) on a rounded case of its own group.
 */
export const PLANT_CASES: { readonly [P in PaintPlant]: readonly string[] } = {
  'dash-phase-1': ['border-dash-fit', 'border-dot-fit'],
  'dash-gap-unfitted': ['border-dash-fit', 'border-dot-fit'],
  'radius-square': ['radius-basic'],
  // PNT2: each transform plant runs on the case its paint moves.
  'transform-origin-ignored': ['transform-origin'],
  'translate-percent-of-parent': ['transform-translate'],
  'image-offset-1': ['replaced-block', 'replaced-fit'],
  // T150a: visibility-basic's hidden boxes (ids hid-*) paint their backgrounds when the writer is ignored; its visible children
  // (kid-*) vanish when the writer hides the box view itself.
  'visibility-ignored': ['visibility-basic'],
  'visibility-subtree': ['visibility-basic'],
};
/** The sample rules a paint plant's device-pixels failures must name: border bands and edges, or radius points. */
export const PLANT_RULES: { readonly [P in PaintPlant]: RegExp } = {
  'dash-phase-1': /^(border:|edge:)/,
  'dash-gap-unfitted': /^(border:|edge:)/,
  // Square corners paint the box's colour where Chrome's rounded corner shows the backdrop: the radius rule catches it.
  'radius-square': /^radius:/,
  // A transform moves every pixel of the box, so any colour rule may catch it.
  'transform-origin-ignored': /^(interior|border|outside|radius|clip|glyph|shadow|gradient):/,
  'translate-percent-of-parent': /^(interior|border|outside|radius|clip|glyph|shadow|gradient):/,
  'image-offset-1': /^(image-flat:|edge:)/,
  'visibility-ignored': /^interior:hid-/,
  'visibility-subtree': /^interior:kid-/,
};
/** The devices of the raster plant runs (section 4 item 5). */
export const PLANT_DEVICES: { readonly [T in NativeTarget]: string } = { ios: 'iPhone 17', android: 'dragon-smoke' };
/** The axis each raster plant moves every glyph along, by PLANT_SHIFT_DEVICE_PX. */
export const PLANT_AXIS: { readonly [P in GlyphPlant]: 'x' | 'y' } = { 'glyph-offset-1': 'x', 'glyph-offset-y-1': 'y' };
/** The case of the single-run-baseline line plant: b1 holds a text node on two lines whose baselines sit differently below their line tops. */
export const LINE_PLANT_CASE = 'inline-baselines';
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
export function judgeGlyphPlant(plant: GlyphPlant, clean: { readonly failures: number; readonly centres: readonly GlyphPosition[] }, planted: readonly GlyphPosition[], gate: number, runs: { readonly hostErrors: readonly string[]; readonly frames: number; readonly lines: number }): PlantVerdict {
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

/** One text line's absolute baseline in device px, read from a dump. */
export type DumpBaseline = { readonly line: string; readonly baseline: number };

/**
 * The single-run-baseline line plant judged against the clean run (INL1a): both hosts finished; device-frames and device-lines have
 * no failure in either run (the plant moves glyphs, not line boxes); the clean run has no device-pixels failure; both runs dumped the
 * same text lines; every text node's first line keeps its baseline; at least one line's baseline moved by a whole device px or more;
 * and on every moved line the glyph bottom edge moved by the same amount within PLANT_SHIFT_SPREAD_DEVICE_PX and fails the position
 * check with at least PLANT_MARGIN_DEVICE_PX to spare.
 */
export function judgeLinePlant(clean: { readonly failures: number; readonly baselines: readonly DumpBaseline[]; readonly bottoms: readonly GlyphPosition[] }, planted: { readonly baselines: readonly DumpBaseline[]; readonly bottoms: readonly GlyphPosition[] }, gate: number, runs: { readonly hostErrors: readonly string[]; readonly frames: number; readonly lines: number }): PlantVerdict {
  const problems: string[] = [...runs.hostErrors];
  if (runs.frames > 0) problems.push(`device-frames has ${runs.frames} failure(s) across the two runs`);
  if (runs.lines > 0) problems.push(`device-lines has ${runs.lines} failure(s) across the two runs`);
  if (clean.failures > 0) problems.push(`the clean run has ${clean.failures} device-pixels failure(s)`);
  const cleanAt = new Map(clean.baselines.map((b) => [b.line, b.baseline]));
  if (planted.baselines.length !== cleanAt.size || planted.baselines.some((b) => !cleanAt.has(b.line))) problems.push(`the planted run dumped ${planted.baselines.length} text lines, the clean run ${cleanAt.size}, not the same lines`);
  const cleanBottom = new Map(clean.bottoms.filter((c) => c.axis === 'y').map((c) => [c.line, c]));
  const plantedBottom = new Map(planted.bottoms.filter((c) => c.axis === 'y').map((c) => [c.line, c]));
  const lines: PlantLine[] = [];
  for (const b of planted.baselines) {
    const base = cleanAt.get(b.line);
    if (base === undefined) continue;
    const shift = b.baseline - base;
    if (/:line0$/.test(b.line)) {
      if (shift !== 0) problems.push(`${b.line}: a first line's baseline moved ${shift} device px`);
      continue;
    }
    if (Math.abs(shift) < PLANT_SHIFT_DEVICE_PX) continue;
    const c = cleanBottom.get(b.line);
    const p = plantedBottom.get(b.line);
    if (c === undefined || p === undefined) {
      problems.push(`${b.line}: its baseline moved ${shift} device px, and no glyph bottom edge was measured on it`);
      continue;
    }
    lines.push({ line: b.line, chrome: p.chrome, clean: c.native, planted: p.native });
    const moved = p.native - c.native;
    const margin = Math.abs(p.native - p.chrome) - gate;
    if (Math.abs(moved - shift) > PLANT_SHIFT_SPREAD_DEVICE_PX) problems.push(`${b.line}: the glyph bottom edge moved ${moved.toFixed(3)} device px, the baseline ${shift}`);
    if (!(margin >= PLANT_MARGIN_DEVICE_PX)) problems.push(`${b.line}: the position check fails by ${margin.toFixed(3)} device px beyond the gate, less than ${PLANT_MARGIN_DEVICE_PX}`);
  }
  if (lines.length === 0 && problems.length === 0) problems.push('no line baseline moved by a whole device px');
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
  return JSON.parse(exec('xcrun', ['simctl', 'list', ...args, '-j']).stdout) as T;
}

/**
 * The pinned iOS simulator runtime: the one the device evidence was recorded on, so a host with a newer runtime (CI's xcode-27
 * image ships iOS 27) runs the same one (install it with xcodebuild -downloadPlatform iOS -buildVersion <version>).
 */
export const IOS_RUNTIME = { version: '26.5', build: '23F77' } as const;

export type SimRuntime = { readonly identifier: string; readonly version: string; readonly buildversion: string; readonly isAvailable: boolean; readonly name: string };

/** The available iOS runtime with the pinned build, or an error naming the available ones. */
export function pickIosRuntime(rts: readonly SimRuntime[], pin: { readonly version: string; readonly build: string } = IOS_RUNTIME): { readonly identifier: string; readonly version: string; readonly build: string } {
  const ios = rts.filter((r) => r.isAvailable && r.name.startsWith('iOS'));
  const hit = ios.find((r) => r.buildversion === pin.build);
  if (hit === undefined) throw new Error(`the pinned iOS ${pin.version} (${pin.build}) simulator runtime is not installed; available: ${ios.map((r) => `${r.version} (${r.buildversion})`).join(', ') || 'none'} (tooling fault)`);
  if (hit.version !== pin.version) throw new Error(`the iOS runtime with build ${pin.build} reports version ${hit.version}, not the pinned ${pin.version} (tooling fault)`);
  return { identifier: hit.identifier, version: hit.version, build: hit.buildversion };
}

/** The pinned iOS runtime on this host: its identifier, version and build. */
export function iosRuntime(): { readonly identifier: string; readonly version: string; readonly build: string } {
  return pickIosRuntime(simctlJson<{ runtimes: SimRuntime[] }>(['runtimes']).runtimes);
}

/** The device type profile scale (capabilities.plist ArtworkDeviceScaleFactor), independent of the app. */
export function iosProfileScale(name: string): number {
  const types = simctlJson<{ devicetypes: { name: string; bundlePath: string; identifier: string }[] }>(['devicetypes']).devicetypes;
  const type = types.find((t) => t.name === name);
  if (type === undefined) throw new Error(`no simulator device type ${name} (tooling fault)`);
  const caps = exec('plutil', ['-p', join(type.bundlePath, 'Contents', 'Resources', 'capabilities.plist')]).stdout;
  const scale = Number(/"ArtworkDeviceScaleFactor" => (\d+(?:\.\d+)?)/.exec(caps)?.[1]);
  if (!Number.isFinite(scale)) throw new Error(`${name}: capabilities.plist has no ArtworkDeviceScaleFactor`);
  return scale;
}

/** The simulator named name on the pinned runtime, created with simctl when none exists. */
export function provisionIos(name: string): { readonly udid: string; readonly created: boolean } {
  const rt = iosRuntime();
  const list = simctlJson<{ devices: Record<string, SimDevice[]> }>(['devices', 'available']);
  const have = (list.devices[rt.identifier] ?? []).find((d) => d.name === name);
  if (have !== undefined) return { udid: have.udid, created: false };
  const types = simctlJson<{ devicetypes: { name: string; identifier: string }[] }>(['devicetypes']).devicetypes;
  const type = types.find((t) => t.name === name);
  if (type === undefined) throw new Error(`no simulator device type ${name} (tooling fault)`);
  return { udid: exec('xcrun', ['simctl', 'create', name, type.identifier, rt.identifier]).stdout.trim(), created: true };
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
    exec('sh', ['-c', `echo no | "${tool}" create avd -n ${d.name} -k "${ANDROID_IMAGE}" -d pixel_7`], { env: { ...process.env, JAVA_HOME: tools.javaHome } });
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
  | { readonly spec: AvdDeviceSpec; readonly serial: string; readonly startedHere: boolean; readonly tools: AndroidTools; readonly boot?: AvdBoot };

/** How an AVD came up: from the golden snapshot, a cold boot, or already running (not started by this runner). */
export type AvdBoot = 'snapshot' | 'cold' | 'running';

export type DeviceProfile = { readonly name: string; readonly target: NativeTarget; readonly os: string; readonly build: string; readonly profileScale: number; readonly boot?: AvdBoot };

/** adb against one device; throws on failure unless the call names why its failure is an answer (allowFailure). */
function adb(h: { serial: string; tools: AndroidTools }, args: readonly string[], timeoutMs = 120_000, allowFailure?: string): ExecResult {
  return exec(h.tools.adb, ['-s', h.serial, ...args], allowFailure === undefined ? { timeoutMs } : { timeoutMs, allowFailure });
}

// ---------------------------------------------------------------- the device lease and the memory budget

/**
 * Device runs are machine-exclusive: every boot runs under /tmp/device-lease.sh (one lock directory, its holder's pid inside). So
 * the one process that boots devices owns the machine's device memory, and its budget can live in memory: no other run holds any.
 */
export const LEASE_LOCK = '/tmp/dragon-device.lock';
export const LEASE_HELP = 'run it under the device lease: /tmp/device-lease.sh pnpm run parity:lanes -- --run-host --run-device';

/** The pid holding the device lease (the lock directory's pid file), or null when it is free or unreadable. */
export function leaseHolder(lockDir: string = LEASE_LOCK): number | null {
  try {
    const pid = Number(readFileSync(join(lockDir, 'pid'), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** The parent of a process (ps), or null when it has none or cannot be read. */
export function parentPid(pid: number): number | null {
  const r = exec('ps', ['-o', 'ppid=', '-p', String(pid)], { allowFailure: 'ps exits 1 for a pid that no longer runs, which ends the walk' });
  const p = Number(r.stdout.trim());
  return r.ok && Number.isInteger(p) && p > 0 ? p : null;
}

/** Whether ancestor is pid or one of its ancestors, walking parentOf up to the root (at most 64 steps). */
export function isAncestor(ancestor: number, pid: number, parentOf: (pid: number) => number | null): boolean {
  let p: number | null = pid;
  // pid 1 is an ancestor like any other (a lease held by a container's entrypoint, finding 4149997421); the walk ends above it.
  for (let i = 0; i < 64 && p !== null && p >= 1; i++) {
    if (p === ancestor) return true;
    p = parentOf(p);
  }
  return false;
}

/** Throws unless this process runs under the device lease (the lock's pid is this process or an ancestor), naming what to do. */
export function requireDeviceLease(holder: number | null = leaseHolder(), pid: number = process.pid, parentOf: (pid: number) => number | null = parentPid): void {
  if (holder === null) throw new Error(`no device lease is held (${LEASE_LOCK}): devices are booted only under the lease; ${LEASE_HELP}`);
  if (!isAncestor(holder, pid, parentOf)) throw new Error(`the device lease is held by pid ${holder}, not by this process or an ancestor: another device run is in progress; ${LEASE_HELP}`);
}

const GIB = 1024 ** 3;
/** Memory one booted device holds with its app (resident size measured with a full run: see notes/LANE-SPEED.md), rounded up. */
export const DEVICE_MEMORY: { readonly [T in NativeTarget]: number } = { ios: 3 * GIB, android: 4 * GIB };
/** Memory left to the rest of the machine (the host lanes, the checks, other agents) when devices are started. */
export const MEMORY_RESERVE = 8 * GIB;

/**
 * The reserve of this run: MEMORY_RESERVE, or DRAGON_DEVICE_RESERVE_GIB (a whole number of GiB, 0 to 64) on a machine that runs
 * nothing else, such as a CI runner booting its one device (a 7 GiB macOS runner could never admit a device under 8 GiB).
 */
export function memoryReserve(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const v = env['DRAGON_DEVICE_RESERVE_GIB'];
  if (v === undefined) return MEMORY_RESERVE;
  if (!/^\d{1,2}$/.test(v) || Number(v) > 64) throw new Error(`DRAGON_DEVICE_RESERVE_GIB must be a whole number of GiB from 0 to 64, not ${JSON.stringify(v)}`);
  return Number(v) * GIB;
}
export const ADMIT_WAIT_MS = 1_800_000;

/** Memory free for new processes: free, inactive and speculative pages on macOS (vm_stat; a failed or unreadable read throws), else os.freemem(). */
export function availableMemory(): number {
  if (process.platform !== 'darwin') return freemem();
  const v = parseVmStat(exec('vm_stat', []).stdout);
  if (v === null) throw new Error('vm_stat gave no free, inactive and speculative page counts (tooling fault)');
  return v;
}

/** Free, inactive and speculative bytes from vm_stat output; null when a count or the page size is missing. */
export function parseVmStat(text: string): number | null {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const count = (name: string): number => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)\\.`, 'm').exec(text)?.[1]);
  const pages = count('free') + count('inactive') + count('speculative');
  return Number.isFinite(page) && page > 0 && Number.isFinite(pages) ? pages * page : null;
}

export type Memory = { readonly total: number; readonly available: number };

/**
 * Whether a device needing `need` bytes may boot, given the bytes this process's booted devices hold and one fresh memory reading:
 * the held bytes plus the request must fit the smaller of total and available memory, less the reserve. A booted device's memory
 * is already out of `available` and counts again as held, so it errs toward waiting. The first device waits too (PR #42 finding
 * 4149425879): a run never boots a device the budget does not admit, and one that can never be admitted fails after the wait.
 */
export function admits(held: number, need: number, mem: Memory, reserve: number = MEMORY_RESERVE): boolean {
  return held + need <= Math.min(mem.total, mem.available) - reserve;
}

/** The bytes each booted device of this process holds, by device name: reserved before its boot, given back once it is stopped. */
const reserved = new Map<string, number>();
export const heldBytes = (): number => [...reserved.values()].reduce((n, b) => n + b, 0);

export type AdmitOptions = { readonly memory?: () => Memory; readonly lease?: () => void; readonly waitMs?: number; readonly pollMs?: number; readonly log?: (line: string) => void };
const gib = (n: number): string => `${(n / GIB).toFixed(1)} GiB`;

/**
 * Waits until the budget admits the device, then reserves its memory; the admission and the reservation are one synchronous step,
 * so two boots of this process cannot both pass on one reading. Throws without the device lease, and after waitMs naming the holders.
 */
export async function admitDevice(spec: { readonly target: NativeTarget; readonly name: string }, opts: AdmitOptions = {}): Promise<void> {
  (opts.lease ?? requireDeviceLease)();
  // A device left running by this run (not started here, or its stop failed) still holds its reservation.
  if (reserved.has(spec.name)) return;
  const need = DEVICE_MEMORY[spec.target];
  const reserve = memoryReserve();
  const log = opts.log ?? ((l: string) => console.log(l));
  const t0 = Date.now();
  let waited = false;
  for (;;) {
    const mem = (opts.memory ?? (() => ({ total: totalmem(), available: availableMemory() })))();
    const held = heldBytes();
    const budget = Math.min(mem.total, mem.available) - reserve;
    const holders = [...reserved.keys()].join(', ');
    if (admits(held, need, mem, reserve)) {
      reserved.set(spec.name, need);
      if (waited) log(`${spec.name}: device memory admitted after ${((Date.now() - t0) / 1000).toFixed(0)} s (${gib(held + need)} held of a ${gib(budget)} budget)`);
      return;
    }
    const state = `needs ${gib(need)}; ${gib(mem.available)} free of ${gib(mem.total)} read, less the ${gib(reserve)} reserve, is a ${gib(budget)} budget; ${held === 0 ? 'no device held' : `${gib(held)} held by ${holders}`}`;
    if (!waited) log(`${spec.name}: waiting for device memory: ${state}`);
    waited = true;
    const waitMs = opts.waitMs ?? ADMIT_WAIT_MS;
    if (Date.now() - t0 > waitMs) throw new Error(`${spec.name}: no device memory within ${waitMs / 1000} s (tooling fault): ${state}`);
    await sleep(opts.pollMs ?? 2000);
  }
}

/** Gives a device's memory back; only for a device that is stopped (or never booted). */
export function releaseDeviceMemory(name: string): void {
  reserved.delete(name);
}

/**
 * A failed boot that could not stop the device it started: the device still runs and holds its memory, so its reservation is kept
 * (until this process exits), and the error says so.
 */
export class DeviceLeftRunning extends Error {}

/**
 * A booted device that is not the tree's matrix device (liveProblems against DEVICE_MATRIX): a defect of the tree's matrix or
 * provisioning, judged as a verdict, never retried as a tooling hiccup once the boot was cold.
 */
export class MatrixMismatch extends Error {}

/** Runs a boot holding the device's memory until release(); a failed boot gives it back unless it left the device running. */
export async function withDeviceSlot(spec: DeviceSpec, bootIt: () => Promise<DeviceHandle>, opts: AdmitOptions = {}): Promise<DeviceHandle> {
  await admitDevice(spec, opts);
  try {
    return await bootIt();
  } catch (e) {
    if (!(e instanceof DeviceLeftRunning)) releaseDeviceMemory(spec.name);
    throw e;
  }
}

/** Runs every stop given (a rejected one counts as not stopped); the problems of those that may have left the device running. */
export async function stopAll(stops: readonly (() => Promise<string | null>)[]): Promise<string[]> {
  const problems: string[] = [];
  for (const stop of stops) {
    try {
      const p = await stop();
      if (p !== null) problems.push(p);
    } catch (x) {
      problems.push(`the stop failed: ${x instanceof Error ? x.message : String(x)}`);
    }
  }
  return problems;
}

/** The cleanup of a failed boot: when a stop leaves the device possibly running, the error becomes DeviceLeftRunning; else it is rethrown. */
export async function failBoot(e: unknown, stops: readonly (() => Promise<string | null>)[]): Promise<never> {
  const problems = await stopAll(stops);
  if (problems.length === 0) throw e;
  throw new DeviceLeftRunning(`${e instanceof Error ? e.message : String(e)}; and ${problems.join('; ')}`);
}

export async function bootIos(spec: IosDeviceSpec): Promise<DeviceHandle> {
  return withDeviceSlot(spec, () => bootIosHeld(spec));
}

async function bootIosHeld(spec: IosDeviceSpec): Promise<DeviceHandle> {
  const { udid } = provisionIos(spec.name);
  const was = simState(udid);
  try {
    return await bootIosFrom(spec, udid, was);
  } catch (e) {
    // A simulator this runner booted is shut down again; one already booted or booting elsewhere is left alone.
    if (was === 'Shutdown') await failBoot(e, [() => stopDevice({ spec, udid, startedHere: true })]);
    throw e;
  }
}

/**
 * The SpringBoard preferences every simulator is pinned to: Full Screen Apps (no Windowed Apps, no Stage Manager). iPadOS 26 defaults
 * to Windowed Apps, where SpringBoard reopens an app at the window size it last kept for the bundle, across reinstalls and reboots:
 * one scene rotation on a portrait iPad (requestGeometryUpdate) left every later launch of the host in a scaled window, so the OS
 * screenshot of capture trust showed the wallpaper around it. Each key reads 0 once pinned.
 */
export const IOS_SPRINGBOARD_PINS: readonly string[] = ['SBMedusaMultitaskingEnabled', 'SBChamoisWindowingEnabled'];

/** The pinned keys a simulator does not hold yet; read gives a key's `defaults read` output, or null when the key is absent. */
export function springboardPinsToWrite(read: (key: string) => string | null): string[] {
  return IOS_SPRINGBOARD_PINS.filter((k) => read(k)?.trim() !== '0');
}

function readSpringboard(udid: string, key: string): string | null {
  const r = exec('xcrun', ['simctl', 'spawn', udid, 'defaults', 'read', 'com.apple.springboard', key], { allowFailure: 'an absent key fails the read; it is written below' });
  return r.ok ? r.stdout : null;
}

/**
 * Pins the multitasking mode (IOS_SPRINGBOARD_PINS). SpringBoard reads it when it starts, so a simulator that did not hold it
 * boots once more; the pins persist, so that happens once per simulator. A pin that does not read back fails the boot.
 */
async function pinFullScreenApps(spec: IosDeviceSpec, udid: string): Promise<void> {
  const missing = springboardPinsToWrite((k) => readSpringboard(udid, k));
  if (missing.length === 0) return;
  for (const k of missing) exec('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', 'com.apple.springboard', k, '-bool', 'NO']);
  exec('xcrun', ['simctl', 'shutdown', udid]);
  exec('xcrun', ['simctl', 'boot', udid]);
  const b = await execAsync('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeoutMs: 300_000, allowFailure: 'a failed reboot fails naming this output' });
  if (!b.ok) throw new Error(`the ${spec.name} simulator did not boot again after its multitasking mode was pinned (tooling fault): ${b.out.slice(-500)}`);
  const still = springboardPinsToWrite((k) => readSpringboard(udid, k));
  if (still.length > 0) throw new Error(`the ${spec.name} simulator does not hold the SpringBoard pins ${still.join(', ')} after writing them (tooling fault)`);
}

async function bootIosFrom(spec: IosDeviceSpec, udid: string, was: string): Promise<DeviceHandle> {
  for (let attempt = 1; ; attempt++) {
    if (was === 'Shutdown') noteStartedSim(udid, spec.name);
    if (simState(udid) !== 'Booted') exec('xcrun', ['simctl', 'boot', udid], { allowFailure: 'a simulator that started booting meanwhile refuses a second boot; bootstatus below judges the boot' });
    // Awaited, not blocking, so the cases are computed while the simulator boots.
    const b = await execAsync('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeoutMs: 300_000, allowFailure: 'a failed boot is retried once from a stopped simulator, then fails naming this output' });
    if (b.ok) break;
    if (attempt === 2 || was !== 'Shutdown') throw new Error(`the ${spec.name} simulator failed to boot${was === 'Shutdown' ? ' twice' : ` (it was ${was} before this run, so it is left alone)`} (tooling fault): ${b.out.slice(-500)}`);
    // The retry starts from a stopped simulator, or the boot fails (and its cleanup stops it, or keeps its memory reserved).
    const stopped = await stopDevice({ spec, udid, startedHere: true });
    if (stopped !== null) throw new Error(`the ${spec.name} simulator failed to boot, and before the retry ${stopped} (tooling fault): ${b.out.slice(-500)}`);
  }
  await pinFullScreenApps(spec, udid);
  exec('xcrun', ['simctl', 'ui', udid, 'content_size', 'large']);
  return { spec, udid, startedHere: was === 'Shutdown' };
}

function serialsRunning(tools: AndroidTools): string[] {
  // A failed read throws (PR #42 finding 4150454065): it is not an empty list, which would say every emulator has stopped.
  return exec(tools.adb, ['devices']).stdout.split('\n').map((l) => /^(emulator-\d+)\s+device/.exec(l)?.[1]).filter((s): s is string => s !== undefined);
}

/** The devices this process started and has not yet stopped: its detached emulators, and the simulators it booted. */
const startedNow = new Set<{ readonly kill: () => void }>();
const startedSims = new Map<string, string>();
/** Records a simulator this process boots, so a signal shuts it down (stopStartedNow) until stopDevice has. */
export const noteStartedSim = (udid: string, name: string): void => void startedSims.set(udid, name);

/**
 * Stops, without waiting, every device this process started and has not stopped (for a SIGTERM or SIGINT, when no cleanup of
 * the run will run): each detached emulator gets SIGTERM, and each simulator booted here is shut down. Each stop is tried on its
 * own, so one that throws does not leave the rest running. Returns what it stopped, and each stop that failed.
 */
export function stopStartedNow(simShutdown: (udid: string) => void = (udid) => void exec('xcrun', ['simctl', 'shutdown', udid], { allowFailure: 'a simulator already shut down refuses; on a signal every one is tried, none waited on' })): string[] {
  const out: string[] = [];
  const attempt = (what: string, stop: () => void): void => {
    try {
      stop();
      out.push(what);
    } catch (e) {
      out.push(`${what}: the stop FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  for (const e of [...startedNow]) {
    startedNow.delete(e);
    attempt('an emulator process (SIGTERM)', e.kill);
  }
  for (const [udid, name] of [...startedSims]) {
    startedSims.delete(udid);
    attempt(`the ${name} simulator`, () => simShutdown(udid));
  }
  return out;
}

/**
 * A detached child whose spawn error (a missing or unexecutable binary) is kept, not left unhandled: check() rethrows it, so the
 * caller's retry and tooling-fault handling sees it. With a log path, the child's stdout and stderr go to that file (truncated at
 * spawn), and exited() and logTail() say how it ended and what it last printed, so an early exit names its own reason.
 */
export function spawnDetached(cmd: string, args: readonly string[], logPath: string | null = null): { readonly check: () => void; readonly alive: () => boolean; readonly kill: () => void; readonly exited: () => string | null; readonly logTail: () => string } {
  let failure: Error | null = null;
  let fd: number | null = null;
  if (logPath !== null) {
    mkdirSync(dirname(logPath), { recursive: true });
    fd = openSync(logPath, 'w');
  }
  let spawned: ReturnType<typeof spawnChild>;
  try {
    spawned = spawnChild(cmd, args, { detached: true, stdio: fd === null ? 'ignore' : ['ignore', fd, fd], allowFailure: 'an emulator runs until it is killed; whether it booted is judged by the attach and boot polls through check() and alive()' });
  } finally {
    // The child holds its own copy of the descriptor.
    if (fd !== null) closeSync(fd);
  }
  const { child: p, done } = spawned;
  done.catch(() => undefined);
  p.once('error', (e) => {
    failure = e;
  });
  p.unref();
  // A detached emulator is outside this process group, so a signal to the group does not reach it: stopStartedNow does.
  const entry = { kill: (): void => void p.kill('SIGTERM') };
  startedNow.add(entry);
  const forget = (): void => void startedNow.delete(entry);
  done.then(forget, forget);
  const alive = (): boolean => failure === null && p.exitCode === null && p.signalCode === null;
  return {
    check: () => {
      if (failure !== null) throw new Error(`${cmd} could not be started: ${(failure as Error).message}`);
    },
    alive,
    kill: () => void p.kill('SIGTERM'),
    exited: () => (failure !== null ? `could not start: ${(failure as Error).message}` : p.signalCode !== null ? `killed by ${p.signalCode}` : p.exitCode !== null ? `exit ${p.exitCode}` : null),
    logTail: () => (logPath === null ? '' : logTailOf(logPath)),
  };
}

/**
 * The last 1500 characters of a log file on one line, or why it cannot be read. Only the file's last 4 bytes per character (and
 * a margin for line terminators) are read, so a log of any size costs the same.
 */
export function logTailOf(path: string, chars = 1500): string {
  if (!existsSync(path)) return `(no log at ${path})`;
  const fd = openSync(path, 'r');
  let text: string;
  try {
    const size = fstatSync(fd).size;
    const want = Math.min(size, chars * 4 + 1024);
    const buf = Buffer.alloc(want);
    const got = readSync(fd, buf, 0, want, size - want);
    // A read that starts inside a UTF-8 sequence decodes its first bytes to U+FFFD; they are dropped.
    text = buf.subarray(0, got).toString('utf8').replace(want < size ? /^\uFFFD+/ : /^$/, '');
  } finally {
    closeSync(fd);
  }
  const t = text.trim().replace(/\s*[\n\r\u2028\u2029]\s*/g, ' | ');
  if (t === '') return `(${path} is empty)`;
  return t.length > chars ? `...${t.slice(-chars)}` : t;
}

/** Where an AVD's emulator writes its stdout and stderr: one file per AVD, rewritten on every boot attempt. */
export const emulatorLog = (name: string): string => join(tmpdir(), 'dragon-emulator-logs', `${name}.log`);

/** Stops a spawned process that is still alive: null once it has exited, else why it may still run. */
export async function stopSpawned(p: { readonly alive: () => boolean; readonly kill: () => void }, name: string, timeoutMs = 30_000): Promise<string | null> {
  if (!p.alive()) return null;
  p.kill();
  try {
    await poll(`the ${name} emulator process to exit`, timeoutMs, () => !p.alive());
    return null;
  } catch (e) {
    return `the ${name} emulator process still runs after SIGTERM: ${e instanceof Error ? e.message : String(e)}`;
  }
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

// ---------------------------------------------------------------- the golden snapshot (quickboot)

/**
 * The snapshot a matrix AVD quickboots from: saved right after a cold boot and prepareAvd, the host app uninstalled and the vectors
 * dir removed, so every run starts from the same device state (a cold boot keeps whatever earlier runs left on the data disk).
 * It is loaded with -no-snapshot-save, so a run never changes it, and a boot from it is judged as a cold one is (liveProblems,
 * prepareAvd and the focus wait all run again).
 */
export const GOLDEN_SNAPSHOT = 'dragon-golden';
/** Where the key of an AVD's golden snapshot is kept: a snapshot whose key is not the current one is never loaded. */
export const goldenKeyFile = (name: string): string => join(avdDir(name), `${GOLDEN_SNAPSHOT}.key`);

/** The guest timezone of every boot, cold or from the snapshot: fixed, so neither depends on the host's zone. */
export const GUEST_TIMEZONE = 'Etc/UTC';
/** The emulator flags every boot shares; the renderer is the pixel evidence's, so it is never changed. */
const EMULATOR_FLAGS = ['-no-window', '-no-audio', '-no-boot-anim', '-gpu', ANDROID_RENDERER, '-timezone', GUEST_TIMEZONE] as const;

/** The emulator arguments of a boot: a cold boot that saves nothing, or a forced load of the golden snapshot that saves nothing. */
export function emulatorArgs(spec: AvdDeviceSpec, golden: boolean): string[] {
  const snapshot = golden ? ['-snapshot', GOLDEN_SNAPSHOT, '-force-snapshot-load', '-no-snapshot-save'] : ['-no-snapshot'];
  return ['-avd', spec.name, '-port', String(spec.port), ...snapshot, ...EMULATOR_FLAGS];
}

/** What a golden snapshot was taken with: change any of them and the snapshot is taken again from a cold boot. */
export type GoldenParts = { readonly emulator: string; readonly image: string; readonly imageProperties: string; readonly config: string; readonly flags: readonly string[]; readonly provision: string };

export const goldenKey = (parts: GoldenParts): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/**
 * The key of an AVD's golden snapshot now: the emulator version, the system image and its package properties, the AVD's whole
 * config.ini (the matrix keys pinned), the boot flags (the guest timezone among them), and the provisioning code (prepareAvd, its
 * settle wait, saveGolden and the settle after it).
 */
export function currentGoldenKey(spec: AvdDeviceSpec, tools: AndroidTools): string {
  return goldenKey({
    emulator: exec(tools.emulator, ['-version'], { timeoutMs: 60_000 }).stdout.split('\n')[0]?.trim() ?? '',
    image: ANDROID_IMAGE,
    imageProperties: readFileSync(join(tools.home, ...ANDROID_IMAGE.split(';'), 'source.properties'), 'utf8'),
    config: readFileSync(join(avdDir(spec.name), 'config.ini'), 'utf8'),
    flags: emulatorArgs(spec, true),
    provision: [prepareAvd, waitForSettledFocus, saveGolden, saveGoldenAndSettle, TEXT_SCALE.android, SETTLE_SAMPLES, SETTLE_INTERVAL_MS].map(String).join('\n'),
  });
}

/** A CI runner is fresh every job, so a snapshot saved there is never loaded again: its boots stay cold and save nothing. */
export const goldenEnabled = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => env['CI'] !== 'true';

/** Whether the AVD's golden snapshot exists and its recorded key is the current one. */
export function goldenCurrent(name: string, key: string): boolean {
  const f = goldenKeyFile(name);
  if (!existsSync(f) || !existsSync(join(avdDir(name), 'snapshots', GOLDEN_SNAPSHOT, 'snapshot.pb'))) return false;
  return readFileSync(f, 'utf8').trim() === key;
}

/** Forgets the golden snapshot (its key), so the next boot is cold and takes it again. */
export function dropGolden(name: string): void {
  rmSync(goldenKeyFile(name), { force: true });
}

/**
 * Takes the golden snapshot of a cold-booted, prepared matrix AVD: the host app uninstalled and the vectors dir removed first, then
 * the snapshot saved, then its key written. A save that fails leaves no key, so it is never loaded; the run goes on with this boot.
 */
async function saveGolden(h: { readonly serial: string; readonly spec: AvdDeviceSpec; readonly tools: AndroidTools }, key: string, log: (line: string) => void): Promise<void> {
  dropGolden(h.spec.name);
  const t0 = Date.now();
  adb(h, ['uninstall', HOST_BUNDLE], 120_000, 'uninstalling fails when the app is not installed; the package list read next decides');
  if (adb(h, ['shell', 'pm', 'list', 'packages', HOST_BUNDLE]).stdout.includes(`package:${HOST_BUNDLE}`)) throw new Error(`${h.serial}: ${HOST_BUNDLE} is still installed after adb uninstall (tooling fault)`);
  adb(h, ['shell', 'rm', '-rf', '/data/local/tmp/dragon-vectors']);
  const r = adb(h, ['emu', 'avd', 'snapshot', 'save', GOLDEN_SNAPSHOT], 600_000, 'a failed save leaves no key, so the snapshot is never loaded; the run goes on with this cold boot');
  if (!r.ok || !/^OK/m.test(r.stdout)) {
    log(`${h.spec.name}: the golden snapshot was not saved (the next boot is cold again): ${r.out.trim().slice(-300)}`);
    return;
  }
  writeFileSync(goldenKeyFile(h.spec.name), `${key}\n`);
  log(`${h.spec.name}: golden snapshot saved in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

/**
 * Saves the golden snapshot, then settles again: the uninstall, the vectors dir removal and the paused VM come after prepareAvd's
 * settle, so the app is launched, as on every other boot, only once the launcher holds the focus again. A failed save never fails
 * the boot; a failed settle does, as on any boot.
 */
async function saveGoldenAndSettle(h: { readonly serial: string; readonly spec: AvdDeviceSpec; readonly tools: AndroidTools }, key: string): Promise<void> {
  // The snapshot only saves time: a save that fails is logged and leaves no key, and the run goes on with this checked boot.
  await saveGolden(h, key, (l) => console.log(l)).catch((x: unknown) => console.log(`${h.spec.name}: the golden snapshot was not saved (the next boot is cold again): ${x instanceof Error ? x.message : String(x)}`));
  await waitForSettledFocus(h);
}

/** Whether an exited emulator's log says the snapshot failed to load (a forced load that fails exits the emulator). */
export const snapshotLoadFailed = (logTail: string): boolean => /snapshot/i.test(logTail) && /fail|cannot|can't|could not|unable|invalid|incompatible|error/i.test(logTail);

/**
 * What a failed boot attempt does next; every retry after a snapshot attempt is cold. An emulator that exited from the snapshot on
 * a first attempt is retried cold: its snapshot is dropped at once when its log says the load failed, and otherwise it is a suspect
 * (a truncated snapshot may crash without saying so), dropped only if the cold retry boots; a cold retry that fails too points at
 * the environment (a taken port), so the snapshot is kept. Any other exited emulator is left alone (its serial may be someone
 * else's). A live emulator that failed to boot from the snapshot drops it; a live one is stopped, then retried once.
 */
export function failedAttemptStep(golden: boolean, alive: boolean, attempt: number, loadFailed = false): { readonly dropGolden: boolean; readonly suspect: boolean; readonly next: 'retry' | 'left-alone' | 'stop-then-retry' | 'stop-then-fail' } {
  if (!alive) return golden && attempt === 1 ? { dropGolden: loadFailed, suspect: !loadFailed, next: 'retry' } : { dropGolden: false, suspect: false, next: 'left-alone' };
  return { dropGolden: golden, suspect: false, next: attempt >= 2 ? 'stop-then-fail' : 'stop-then-retry' };
}

/** Whether a suspect snapshot (see failedAttemptStep) is dropped: only once the cold retry after it has booted. */
export const dropSuspect = (suspect: boolean, coldBooted: boolean): boolean => suspect && coldBooted;

/** Boots an AVD headless on its own console port; provision pins the matrix keys first (the floor probe AVD is not in the matrix). */
export async function bootAvd(spec: AvdDeviceSpec, provision = true): Promise<DeviceHandle> {
  return withDeviceSlot(spec, () => bootAvdHeld(spec, provision));
}

async function bootAvdHeld(spec: AvdDeviceSpec, provision: boolean): Promise<DeviceHandle> {
  const tools = androidTools();
  if (provision) provisionAvd(spec, tools);
  else if (!existsSync(join(avdDir(spec.name), 'config.ini'))) throw new Error(`no AVD ${spec.name} (tooling fault)`);
  const serial = `emulator-${spec.port}`;
  const h = { spec, serial, tools };
  const expectSdk = provision ? ANDROID_IMAGE_API : null;
  if (serialsRunning(tools).includes(serial)) {
    const live = liveProblems(spec, readLive(h), expectSdk);
    if (live.length > 0) throw new MatrixMismatch(`${serial} is running but is not the matrix device: ${live.join('; ')}; it was not started by this runner, so it is left running`);
    await prepareAvd(h);
    return { ...h, startedHere: false, boot: 'running' };
  }
  // A matrix AVD quickboots from its golden snapshot while the snapshot's key is current; the floor probe AVD always boots cold.
  let key: string | null = null;
  try {
    if (provision && goldenEnabled()) key = currentGoldenKey(spec, tools);
  } catch (e) {
    // Without a key no snapshot is loaded or saved: the boot is the cold one it always was.
    console.log(`${spec.name}: no golden snapshot key (this boot is cold and saves none): ${e instanceof Error ? e.message : String(e)}`);
  }
  let golden = key !== null && goldenCurrent(spec.name, key);
  let suspect = false;
  for (let attempt = 1; ; attempt++) {
    const log = emulatorLog(spec.name);
    const p = spawnDetached(tools.emulator, emulatorArgs(spec, golden), log);
    try {
      await poll(`${serial} to attach`, 240_000, () => {
        p.check();
        // An emulator that exited cannot attach: fail now with its own reason instead of waiting out the poll.
        if (!p.alive()) throw new Error(`the emulator process ended (${p.exited() ?? 'unknown'}) before ${serial} attached`);
        return serialsRunning(tools).includes(serial);
      });
      await poll(`${serial} sys.boot_completed`, 420_000, () => {
        if (!p.alive()) throw new Error(`the emulator process ended (${p.exited() ?? 'unknown'}) before ${serial} finished booting`);
        return adb(h, ['shell', 'getprop', 'sys.boot_completed'], 10_000, 'adb does not answer while the emulator boots; the poll asks again until its timeout').stdout.trim() === '1';
      });
      // The settle is part of the attempt: a booted image whose focus never settles (a System UI ANR that outlives every
      // remedy) is stopped and booted cold once more, as a boot that never completes is.
      const live = liveProblems(spec, readLive(h), expectSdk);
      if (live.length > 0) throw new MatrixMismatch(`${serial} booted but is not the matrix device: ${live.join('; ')}`);
      await prepareAvd(h);
      break;
    } catch (e) {
      const wasGolden = golden;
      const step = failedAttemptStep(golden, p.alive(), attempt, golden && !p.alive() && snapshotLoadFailed(p.logTail()));
      // A snapshot that would not boot is dropped: the retry, and every boot after it until a new one is saved, is cold.
      if (step.dropGolden) {
        console.log(`${spec.name}: the golden snapshot did not boot, so it is dropped and the retry is cold: ${e instanceof Error ? e.message : String(e)}; emulator log ${log}: ${p.logTail()}`);
        dropGolden(spec.name);
      }
      if (step.suspect) console.log(`${spec.name}: the emulator exited booting from the golden snapshot; the retry is cold, and the snapshot is dropped only if it boots: ${e instanceof Error ? e.message : String(e)}; emulator log ${log}: ${p.logTail()}`);
      suspect = step.suspect;
      if (golden && step.next !== 'left-alone') golden = false;
      if (step.next === 'retry') {
        await sleep(5000);
        continue;
      }
      // Only the emulator this attempt spawned is killed: if it exited (say, the port was taken), the serial is someone else's.
      if (step.next === 'left-alone') throw new Error(`the ${spec.name} emulator exited (${p.exited() ?? 'unknown'}) before it booted; ${serial} is left alone (tooling fault): ${e instanceof Error ? e.message : String(e)}; emulator log ${log}: ${p.logTail()}`);
      // An emulator that never attached is not reached by adb emu kill, so the process this attempt spawned is stopped as well,
      // whatever the kill gave; a stop that fails keeps the device's memory held (failBoot).
      const problems = await stopAll([() => stopDevice({ ...h, startedHere: true }), () => stopSpawned(p, spec.name)]);
      if (problems.length > 0) throw new DeviceLeftRunning(`the ${spec.name} emulator failed to boot and settle (${e instanceof Error ? e.message : String(e)}); and ${problems.join('; ')}`);
      await sleep(5000);
      // A cold boot of the wrong device boots the same wrong device again; one from a snapshot may be the snapshot's, so it is retried cold.
      if (e instanceof MatrixMismatch && !wasGolden) throw e;
      if (step.next === 'stop-then-fail') throw new Error(`the ${spec.name} emulator failed to boot and settle twice (tooling fault): ${e instanceof Error ? e.message : String(e)}; emulator log ${log}: ${p.logTail()}`);
      console.log(`${spec.name}: attempt ${attempt} failed to boot and settle, so the emulator was stopped and the next attempt boots cold: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`${serial}: ${golden ? `booted from the golden snapshot ${GOLDEN_SNAPSHOT}` : 'booted cold'}`);
  if (dropSuspect(suspect, true)) {
    console.log(`${spec.name}: the cold retry booted, so the golden snapshot it replaced is dropped (it is retaken below)`);
    dropGolden(spec.name);
  }
  try {
    if (key !== null && !golden) await saveGoldenAndSettle({ ...h, spec }, key);
  } catch (e) {
    if (golden) dropGolden(spec.name);
    // This runner started it, so it stops it rather than leave the port taken.
    return failBoot(e, [() => stopDevice({ ...h, startedHere: true })]);
  }
  return { ...h, startedHere: true, boot: golden ? 'snapshot' : 'cold' };
}

/**
 * No animations, the pinned text scale, the screen awake and unlocked for the whole run, and no error dialogs: a freshly booted
 * image under load may raise an ANR dialog for System UI, which takes the focus from the app (Settings.Global.HIDE_ERROR_DIALOGS).
 */
async function prepareAvd(h: { readonly serial: string; readonly tools: AndroidTools }): Promise<void> {
  // Each step must succeed: a device left with animations, another text scale or a locked screen is not the matrix device.
  const step = (args: readonly string[]): void => {
    adb(h, ['shell', ...args]);
  };
  step(['settings', 'put', 'global', 'hide_error_dialogs', '1']);
  for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) step(['settings', 'put', 'global', k, '0']);
  step(['settings', 'put', 'system', 'font_scale', TEXT_SCALE.android]);
  step(['svc', 'power', 'stayon', 'true']);
  step(['input', 'keyevent', 'KEYCODE_WAKEUP']);
  step(['wm', 'dismiss-keyguard']);
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

/** An error dialog that holds the focus for this many samples in a row, BACK pressed at each, gets System UI restarted. */
export const SYSTEMUI_RESTART_AFTER = 20;

/**
 * The focus wait so far: the last sample (null when unparseable), its raw text, how many samples in a row read it, and totals;
 * dialogs counts the samples in a row an error dialog held the focus, restarts the System UI restarts asked for.
 */
export type SettleState = { readonly last: WindowFocus | null; readonly raw: string; readonly stable: number; readonly samples: number; readonly changes: number; readonly unparseable: number; readonly dialogs: number; readonly restarts: number };
export const SETTLE_START: SettleState = { last: null, raw: '', stable: 0, samples: 0, changes: 0, unparseable: 0, dialogs: 0, restarts: 0 };

const DIALOG = /Not Responding|has stopped|isn't responding/i;
const LAUNCHER = /[Ll]auncher/;

/**
 * One focus sample judged: 'back' closes an error dialog, and 'restart-systemui' asks for System UI to be restarted when a dialog
 * has outlived restartAfter samples of BACK (each restartAfter samples again while it stays); 'home' asks for the home screen
 * when something else has the focus, 'wait' samples again, and 'done' when the launcher has held both the focused window and the
 * focused activity, unchanged (the same window object), for `need` samples in a row. Unparseable output never counts toward the run.
 */
export function settleStep(state: SettleState, raw: string, need = SETTLE_SAMPLES, restartAfter = SYSTEMUI_RESTART_AFTER): { readonly state: SettleState; readonly action: 'done' | 'wait' | 'home' | 'back' | 'restart-systemui' } {
  const f = parseWindowFocus(raw);
  const samples = state.samples + 1;
  const changed = f !== null && state.last !== null && (f.currentFocus !== state.last.currentFocus || f.focusedApp !== state.last.focusedApp);
  const base = { last: f, raw, samples, changes: state.changes + (changed ? 1 : 0), unparseable: state.unparseable + (f === null ? 1 : 0), dialogs: 0, restarts: state.restarts };
  if (f === null) return { state: { ...base, stable: 0 }, action: 'wait' };
  if (DIALOG.test(f.currentFocus)) {
    const dialogs = state.dialogs + 1;
    if (dialogs % restartAfter === 0) return { state: { ...base, stable: 0, dialogs, restarts: state.restarts + 1 }, action: 'restart-systemui' };
    return { state: { ...base, stable: 0, dialogs }, action: 'back' };
  }
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
  return `${serial} did not settle on the home screen within ${timeoutMs / 1000} s (tooling fault): ${last}; ${s.samples} samples, ${s.changes} focus changes, ${s.unparseable} unparseable${s.restarts === 0 ? '' : `, ${s.restarts} System UI restarts`}`;
}

/**
 * The commands that restart System UI under an error dialog BACK does not close, by the restart's number: the first closes the
 * system dialogs and crashes System UI the documented way (am crash), which the system restarts as a persistent process; later
 * ones also kill it as root (su on the userdebug emulator image), for a main thread too stuck to take the crash.
 */
export function systemUiRestart(restart: number): readonly (readonly string[])[] {
  const first = [
    ['am', 'broadcast', '-a', 'android.intent.action.CLOSE_SYSTEM_DIALOGS'],
    ['am', 'crash', 'com.android.systemui'],
  ];
  return restart <= 1 ? first : [...first, ['su', '0', 'sh', '-c', "'kill -9 $(pidof com.android.systemui)'"]];
}

/**
 * A freshly booted image brings up its launcher some seconds after sys.boot_completed; an app launched before that is sent to the
 * back and its window detached. So the run starts only once the launcher has held the focus for SETTLE_SAMPLES samples in a row.
 */
async function waitForSettledFocus(h: { readonly serial: string; readonly tools: AndroidTools }): Promise<void> {
  const t0 = Date.now();
  let state = SETTLE_START;
  for (;;) {
    const r = adb(h, ['shell', 'dumpsys', 'window', '|', 'grep', '-E', "'mCurrentFocus=|mFocusedApp='"], 20_000, 'an unreadable sample counts as unparseable, never as a settled focus; the settle timeout bounds the wait');
    const step = settleStep(state, r.ok ? r.out : `adb exited ${r.status}: ${r.out}`);
    state = step.state;
    if (step.action === 'done') {
      console.log(`${h.serial}: the home screen held the focus after ${((Date.now() - t0) / 1000).toFixed(1)} s (${state.samples} samples, ${state.changes} focus changes, ${state.unparseable} unparseable)`);
      return;
    }
    if (step.action === 'back') adb(h, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
    if (step.action === 'restart-systemui') {
      console.log(`${h.serial}: an error dialog held the focus for ${state.dialogs} samples with BACK pressed at each (${state.last?.currentFocus ?? '?'}), so System UI is restarted (restart ${state.restarts})`);
      for (const c of systemUiRestart(state.restarts)) {
        const r = adb(h, ['shell', ...c], 20_000, 'a restart command that fails is logged; the next samples judge whether the dialog went, and the settle timeout bounds the wait');
        if (!r.ok) console.log(`${h.serial}: ${c.join(' ')} failed: ${r.out.trim().slice(-300)}`);
      }
    }
    if (step.action === 'home') adb(h, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
    if (Date.now() - t0 > SETTLE_TIMEOUT_MS) throw new Error(settleTimeoutMessage(h.serial, SETTLE_TIMEOUT_MS, state));
    await sleep(SETTLE_INTERVAL_MS);
  }
}

export async function boot(spec: DeviceSpec): Promise<DeviceHandle> {
  return spec.target === 'ios' ? bootIos(spec) : bootAvd(spec);
}

/**
 * Shuts down only a device this runner started. Its memory is given back only once the device is stopped: a device this runner
 * did not start stays running, as does one whose stop failed, so their reservations are kept until this process exits (PR #42 finding
 * 4147492203). A stop that failed is logged and returned, never dropped.
 */
export async function release(h: DeviceHandle, log: (line: string) => void = (l) => console.error(l), stop: (h: DeviceHandle) => Promise<string | null> = stopDevice): Promise<string | null> {
  let problem: string | null;
  try {
    problem = await stop(h);
  } catch (e) {
    problem = `${h.spec.name} could not be stopped: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (h.startedHere && problem === null) {
    releaseDeviceMemory(h.spec.name);
  }
  if (problem !== null) log(`${problem}; its device memory stays reserved until this process exits (tooling fault)`);
  return problem;
}

/** Stops a device this runner started; null once it is confirmed stopped (or was not started here), else why it may still run. */
export async function stopDevice(h: DeviceHandle): Promise<string | null> {
  if (!h.startedHere) return null;
  if ('udid' in h) {
    const r = exec('xcrun', ['simctl', 'shutdown', h.udid], { allowFailure: 'shutting down a simulator already shut down fails; the state read next decides' });
    const state = simState(h.udid);
    if (state === 'Shutdown' || state === 'missing') {
      startedSims.delete(h.udid);
      return null;
    }
    return `the ${h.spec.name} simulator is ${state} after simctl shutdown (exit ${r.status}): ${r.out.slice(-300)}`;
  }
  adb(h, ['emu', 'kill'], 120_000, 'an emulator that is going away may not answer; the poll for its serial to disappear decides');
  try {
    await poll(`${h.serial} to stop`, 60_000, () => !serialsRunning(h.tools).includes(h.serial));
    return null;
  } catch (e) {
    return `${h.serial} (${h.spec.name}) still runs after adb emu kill: ${e instanceof Error ? e.message : String(e)}`;
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
  return { name: h.spec.name, target: 'android', os: `Android ${release} (API ${sdk})`, build: id, profileScale: Number(density) / 160, ...(h.boot === undefined ? {} : { boot: h.boot }) };
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
    exec('xcrun', ['simctl', 'io', h.udid, 'screenshot', '--type=png', file], { timeoutMs: 60_000 });
    return readFileSync(file);
  }
  const r = execBytes(h.tools.adb, ['-s', h.serial, 'exec-out', 'screencap', '-p'], { timeoutMs: 60_000 });
  writeFileSync(file, r.bytes);
  return r.bytes;
}

/**
 * A fault of the device tooling, not of the tree: an install that kept failing with a transient error. The CI device job exits
 * with its own code for it, so the landing driver never takes it for a verdict (cli/device-ci.ts).
 */
export class ToolingFault extends Error {}

export const INSTALL_ATTEMPTS = 3;
export const INSTALL_RETRY_MS = 10_000;

/** The transient install errors: the device's package service or adb connection dropping, or a simulator service hiccup. */
const TRANSIENT_INSTALL: { readonly [t in NativeTarget]: readonly (readonly [string, RegExp])[] } = {
  android: [
    ['device offline', /device offline|device '[^']*' not found|no devices\/emulators found/i],
    ['package service unavailable', /Can't find service: package|Failure calling service package|Is the system running\?|DeadObjectException/i],
    ['adb connection dropped', /error: closed|protocol fault|Broken pipe|Connection reset/i],
  ],
  ios: [
    ['CoreSimulator connection', /CoreSimulatorService connection (?:became invalid|interrupted)|domain=NSMachErrorDomain, code=-308\b/],
    ['simulator still booting', /Unable to lookup in current state: Booting/],
  ],
};

/** The name of a transient install failure, or null for a failure that is no tooling hiccup (an app the device refuses). */
export function transientInstallFailure(target: NativeTarget, r: Pick<ExecResult, 'ok' | 'out' | 'errorCode' | 'signal'>): string | null {
  if (r.ok) return null;
  if (r.errorCode === 'ETIMEDOUT' || r.signal === 'SIGKILL') return 'install timed out';
  return TRANSIENT_INSTALL[target].find(([, re]) => re.test(r.out))?.[0] ?? null;
}

/**
 * An install, retried on a transient failure up to INSTALL_ATTEMPTS times, each retry logged naming the error. A transient
 * failure on the last attempt is a ToolingFault; any other failure throws at once as an Error (the tree's app may be at fault).
 */
export async function installWithRetries(target: NativeTarget, what: string, attempt: () => ExecResult, o: { readonly attempts?: number; readonly waitMs?: number; readonly log?: (line: string) => void; readonly wait?: (ms: number) => Promise<void> } = {}): Promise<ExecResult> {
  const attempts = o.attempts ?? INSTALL_ATTEMPTS;
  const waitMs = o.waitMs ?? INSTALL_RETRY_MS;
  const log = o.log ?? ((l: string) => console.log(l));
  for (let i = 1; ; i++) {
    const r = attempt();
    if (r.ok) return r;
    const transient = transientInstallFailure(target, r);
    const out = r.out.trim().slice(-800);
    if (transient === null) throw new Error(`${what} failed: ${out}`);
    if (i >= attempts) throw new ToolingFault(`${what} failed ${attempts} times with a transient error (${transient}; tooling fault): ${out}`);
    log(`${what} failed with a transient error (${transient}), attempt ${i} of ${attempts}; retrying in ${waitMs / 1000} s: ${out.slice(-300)}`);
    await (o.wait ?? sleep)(waitMs);
  }
}

/** adb install, retried on a transient failure; an app signed by another checkout's debug key is the same test host, so it is uninstalled first. */
export async function installApk(h: { readonly serial: string; readonly tools: AndroidTools }, artifact: string): Promise<ExecResult> {
  const install = (): ExecResult => adb(h, ['install', '-r', '-t', artifact], 600_000, 'a transient failure is retried, INSTALL_FAILED_UPDATE_INCOMPATIBLE (another checkout\'s debug key) is answered by a reinstall, and any other failure is thrown');
  const first = await installWithRetries('android', 'adb install', () => {
    const r = install();
    // A reinstall answers this one: it is returned for the caller below, not retried.
    return /INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(r.out) ? { ...r, ok: true } : r;
  });
  if (!/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(first.out)) return first;
  adb(h, ['uninstall', HOST_BUNDLE]);
  return installWithRetries('android', 'adb install after the uninstall', install);
}

/** Installs the app, hands it the run file, launches it once for every case in the file, waits and pulls the dumps. */
export async function runApp(h: DeviceHandle, artifact: string, opts: RunOptions): Promise<AppRun> {
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(opts.outDir, { recursive: true });
  const perCase = 3000;
  const timeout = 180_000 + opts.caseCount * perCase;
  let error: string | null = null;
  if ('udid' in h) {
    await installWithRetries('ios', 'simctl install', () => exec('xcrun', ['simctl', 'install', h.udid, artifact], { timeoutMs: 300_000, allowFailure: 'a transient failure is retried; any other failure is thrown' }));
    exec('xcrun', ['simctl', 'terminate', h.udid, HOST_BUNDLE], { allowFailure: 'terminating the app fails when it is not running, the usual case' });
    const docs = join(exec('xcrun', ['simctl', 'get_app_container', h.udid, HOST_BUNDLE, 'data']).stdout.trim(), 'Documents');
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, 'dragon-run.tsv'), opts.runFile);
    const env = { ...process.env, SIMCTL_CHILD_DRAGON_OUT: opts.outDir };
    exec('xcrun', ['simctl', 'launch', '--terminate-running-process', h.udid, HOST_BUNDLE], { env });
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
    const inst = await installApk(h, artifact);
    if (!/Success/.test(inst.out)) throw new Error(`adb install did not report Success: ${inst.out}`);
    adb(h, ['shell', 'am', 'force-stop', HOST_BUNDLE]);
    // A dump left from an earlier run must never be pulled as this run's: the files dir starts empty, or the run stops.
    const cleared = adb(h, ['shell', `rm -rf ${remote} && mkdir -p ${remote} && ls -A ${remote} | wc -l`]);
    if (cleared.stdout.trim() !== '0') throw new Error(`${h.spec.name}: could not empty ${remote} (tooling fault): ${cleared.out.slice(-300)}`);
    const local = join(opts.outDir, 'dragon-run.tsv');
    writeFileSync(local, opts.runFile);
    try {
      adb(h, ['push', local, `${remote}/dragon-run.tsv`]);
    } finally {
      rmSync(local, { force: true });
    }
    adb(h, ['logcat', '-c', '-b', 'crash']);
    const start = adb(h, ['shell', 'am', 'start', '-W', '-n', `${HOST_BUNDLE}/.DragonActivity`, '--es', 'dragon.model', h.spec.name, '--es', 'dragon.renderer', ANDROID_RENDERER]);
    if (/Error/.test(start.out)) throw new Error(`am start failed: ${start.out}`);
    const held = new Set<string>();
    try {
      await poll('the Android host to finish', timeout, async () => {
        if (adb(h, ['logcat', '-d', '-b', 'crash'], 20_000).out.includes(HOST_BUNDLE)) {
          const why = 'diagnostics added to the crash error being thrown';
          const focus = adb(h, ['shell', 'dumpsys', 'window', '|', 'grep', '-E', "'mCurrentFocus|mFocusedApp'"], 20_000, why).out.trim();
          const power = adb(h, ['shell', 'dumpsys', 'power', '|', 'grep', '-E', "'mWakefulness=|mHoldingDisplaySuspendBlocker'"], 20_000, why).out.trim();
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
        const done = adb(h, ['shell', 'ls', `${remote}/done-android`], 10_000, 'the done file is absent until the host finishes; any other failure is thrown below');
        if (!done.ok && !/No such file/.test(done.out)) throw new Error(`${h.serial}: could not look for the done file (tooling fault): ${done.out.slice(-300)}`);
        return done.ok;
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const pull = adb(h, ['pull', `${remote}/.`, opts.outDir], 600_000, 'a failed pull is recorded as the run\'s error, and the dumps it did not bring are missing dumps');
    if (!pull.ok) error = `${error ?? ''} adb pull failed: ${pull.out.slice(-400)}`.trim();
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
  /** How an AVD came up (quickboot), so a difference only one boot mode shows can be traced; absent on iOS and in older records. */
  readonly boot?: AvdBoot;
};

export function deviceRecord(p: DeviceProfile, a: AppRecord): DeviceRecord {
  return { name: p.name, target: p.target, model: a.model, os: `${p.os}; app: ${a.os}`, build: p.build, profileScale: p.profileScale, appScale: a.scale, windowPx: a.windowPx, stagePx: a.stagePx, rootOriginPx: a.rootOriginPx, textScale: a.textScale, ...(p.boot === undefined ? {} : { boot: p.boot }) };
}

/** Problems with a device record: the two scales differ, the root does not fit the stage, or the text scale is not the pinned one. */
export function recordProblems(r: DeviceRecord, root: { readonly width: number; readonly height: number }): string[] {
  const out: string[] = [];
  // The app must have run on the device the runner booted: iOS reports SIMULATOR_DEVICE_NAME, Android "<model> / <AVD>".
  if (!(r.target === 'ios' ? r.model === r.name : r.model.endsWith(` / ${r.name}`))) out.push(`${r.name}: the app ran on ${JSON.stringify(r.model)}, not ${r.name}`);
  if (r.profileScale !== r.appScale) out.push(`${r.name}: the device profile scale ${r.profileScale} differs from the app's ${r.appScale}`);
  if (r.stagePx[0] < root.width || r.stagePx[1] < root.height) out.push(`${r.name}: the stage ${r.stagePx[0]}x${r.stagePx[1]} device px cannot hold the ${root.width}x${root.height} root (device fit; never cropped)`);
  const pinned = r.target === 'ios' ? TEXT_SCALE.ios : TEXT_SCALE.android;
  if (r.textScale !== pinned) out.push(`${r.name}: text scale ${r.textScale}, pinned ${pinned}`);
  return out;
}
