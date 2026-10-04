// The device lanes (notes/T015-p4-review-p5-plan.md section 4 items 3, 5 and 6): every layout case at every device DPR of a target,
// read back from real device dumps. device-frames: node (a) against the committed Chrome DPR capture within GATE_DEVICE_PX and node
// (d) against snapRect of the TS engine. device-applied: (b) against the expected dump, the native class and the expected digest.
// device-lines: line (a), line (d), and the break check (the dump's start and end against the break vectors, the break vectors
// against Chrome's breaks), failure kind break-mismatch. device-pixels: (c) at the generated points against the committed Chrome
// PNG, and the capture-trust probe. The check functions are the existing ones; the node and line split of (a) and (d) is by id.
// Then every DUMP_FAULTS entry is planted in the real dumps and must be caught by the check it targets.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LayoutRect } from '@dragon/layout';
import type { ExpectedDump } from 'dragon';
import { expectedDigest, expectedDump } from 'dragon';
import type { WebCapture } from './capture.ts';
import { GATE_CHANNEL_DELTA } from './compare.ts';
import type { DeviceHandle, DeviceRecord, DeviceSpec } from './device-run.ts';
import { runDevicesInChildren } from './device-jobs.ts';
import { boot, DEVICE_MATRIX, deviceProfile, deviceRecord, recordProblems, release, runApp, TRUST_CASES, VECTOR_DEVICES } from './device-run.ts';
import { deviceEvidence } from './device-evidence.ts';
import { runDeviceVectors } from './device-vectors.ts';
import type { DeviceRun, HostRun } from './lanes.ts';
import { committedDprCapture } from './dpr.ts';
import type { BreakVector, ChromeBreaks } from './line-breaks.ts';
import { BREAK_MISMATCH, checkDumpBreaks, compareVectorWithChrome, leafTexts, readBreakVector, readChromeBreaks } from './line-breaks.ts';
import type { CheckResult, DumpFault, ExpectedApplied, NamedCheck, RgbaImage } from './native-compare.ts';
import { checkAgainstChrome, checkAgainstEngine, checkApplied, DUMP_FAULTS, FAULT_CHECK, pixelAt, plantDumpFault } from './native-compare.ts';
import type { NativeDump } from './native-dump.ts';
import { validateNativeDump } from './native-dump.ts';
import type { NativeCase } from './native-host.ts';
import { BACKEND_OF, buildAndroid, buildIos, engineBoxes, expectedEngine, nativeCases, nativeOut } from './native-host.ts';
import { expectedHitRuns } from './hit-capture.ts';
import { deriveScripts, stateEmits, stateGroups, stateProgramOf } from './state-cases.ts';
import { casePoints, checkCasePixels, committedPixels, decodePng, rasterSize, runFileText } from './pixel-reference.ts';
import type { ImageSize, SamplePoint } from './samples.ts';
import { ruleKind, SAMPLE_RULES } from './samples.ts';
import type { LaneId, NativeTarget, TargetConfig } from './targets.ts';

export const DEVICE_CHECK_LANES = ['device-frames', 'device-applied', 'device-lines', 'device-pixels'] as const;
export type DeviceCheckLane = (typeof DEVICE_CHECK_LANES)[number];

export type FailureKind =
  | 'dump-missing' | 'dump-invalid' | 'device-scale' | 'frame-chrome' | 'frame-engine' | 'applied' | 'native-class' | 'expected-digest'
  | 'line-chrome' | 'line-engine' | typeof BREAK_MISMATCH | 'pixel' | 'raster-size' | 'capture-trust' | 'device-record' | 'compiler-digest' | 'case-identity' | 'capture-kind'
  | 'hit-missing' | 'hit-mismatch';

/** SELD-R1b's device lanes: the case scripts' dumps (device-states) and the device hit test's answers (device-hit). */
export const STATE_LANE = 'device-states';
export const HIT_LANE = 'device-hit';
export type DeviceLaneId = DeviceCheckLane | typeof STATE_LANE | typeof HIT_LANE;

/** One failure, named: lane, case, DPR, node (or sample rule), kind and the values. */
export type LaneFailure = { readonly lane: DeviceLaneId; readonly case: string; readonly dpr: number; readonly node: string | null; readonly kind: FailureKind; readonly detail: string };

/** Counts compared per check. */
export type Compared = { a: number; b: number; c: number; d: number; breaks: number };
const zero = (): Compared => ({ a: 0, b: 0, c: 0, d: 0, breaks: 0 });

const LINE_PROBLEM = /^[^\s]+:line\d+: |: the dump has \d+ line boxes, the engine \d+$/;
const idOf = (p: string): string | null => /^([^\s]+?): /.exec(p)?.[1] ?? null;

/** (a) or (d), split by id into the node part and the line part; the parts together are the check's problems. */
export function splitByLines(r: CheckResult, lineCompared: number): { readonly nodes: CheckResult; readonly lines: CheckResult } {
  const lines = r.problems.filter((p) => LINE_PROBLEM.test(p));
  const nodes = r.problems.filter((p) => !LINE_PROBLEM.test(p));
  return { nodes: { pass: nodes.length === 0, compared: r.compared - lineCompared, problems: nodes }, lines: { pass: lines.length === 0, compared: lineCompared, problems: lines } };
}

/** The references of one case at one DPR, computed on the host from committed data and the TS engine. */
export type CaseReference = {
  readonly engine: readonly LayoutRect[];
  readonly expected: ExpectedDump;
  readonly chrome: WebCapture;
  readonly breaks: BreakVector | null;
  readonly chromeBreaks: ChromeBreaks | null;
  readonly points: readonly SamplePoint[];
  readonly pixels: RgbaImage | null;
};

export function caseReference(target: NativeTarget, n: NativeCase, dpr: number): CaseReference {
  const program = n.programs[BACKEND_OF[target]];
  const viewport = n.case.environment.viewport;
  return {
    engine: engineBoxes(program, viewport, dpr),
    expected: expectedDump(program, n.case.id, viewport, dpr, expectedEngine()),
    chrome: committedDprCapture(n.case.id, dpr),
    breaks: readBreakVector(n.case.id, dpr),
    chromeBreaks: readChromeBreaks(n.case.id, dpr),
    points: casePoints(program, viewport, dpr),
    pixels: committedPixels(n.case.id, dpr),
  };
}

export type CaseOutcome = { readonly failures: readonly LaneFailure[]; readonly compared: Compared; readonly passingSamples: readonly number[] };

/** Every device check of one case's dump (null when the device wrote none) at one DPR. */
export function evaluateCase(target: NativeTarget, n: NativeCase, dpr: number, raw: unknown | null, ref: CaseReference): CaseOutcome {
  const id = n.case.id;
  const failures: LaneFailure[] = [];
  const compared = zero();
  const fail = (lane: DeviceCheckLane, kind: FailureKind, detail: string, node: string | null = null): void => {
    failures.push({ lane, case: id, dpr, node, kind, detail });
  };
  const everyLane = (kind: FailureKind, detail: string): void => {
    for (const l of DEVICE_CHECK_LANES) fail(l, kind, detail);
  };
  if (raw === null) {
    everyLane('dump-missing', 'the device wrote no dump');
    return { failures, compared, passingSamples: [] };
  }
  const v = validateNativeDump(raw);
  if (!v.ok) {
    everyLane('dump-invalid', v.errors.slice(0, 5).map((e) => `${e.path} ${e.code}`).join('; '));
    return { failures, compared, passingSamples: [] };
  }
  const dump = v.dump;
  const lane = target === 'ios' ? 'ios-sim' : 'android-emu';
  if (dump.lane !== lane || dump.device.platform !== target || dump.device.scale !== dpr || dump.case.dpr !== dpr || dump.case.id !== id) everyLane('device-scale', `lane ${dump.lane}, platform ${dump.device.platform}, case ${dump.case.id} at case.dpr ${dump.case.dpr}, device.scale ${dump.device.scale}; expected ${lane}, ${target}, ${id} at ${dpr}`);
  // The case identity the dump claims must be the case under test: fixture, direction and viewport.
  const env = n.case.environment;
  if (dump.case.fixture !== n.spec.id || dump.case.direction !== env.direction || dump.case.viewport.width !== env.viewport.width || dump.case.viewport.height !== env.viewport.height) everyLane('case-identity', `fixture ${dump.case.fixture}, ${dump.case.direction}, viewport ${dump.case.viewport.width}x${dump.case.viewport.height}; expected ${n.spec.id}, ${env.direction}, ${env.viewport.width}x${env.viewport.height}`);
  // The dump must come from the compile under test, not a stale app.
  if (dump.case.compilerDigest !== n.compiled.digest) everyLane('compiler-digest', `compilerDigest ${dump.case.compilerDigest}, the compile under test ${n.compiled.digest}`);

  // (a) and (d), split into nodes (device-frames) and lines (device-lines).
  // The line boxes each check actually compared: those present in both the reference and the dump.
  const dumpLines = new Set(dump.nodes.flatMap((x) => x.lines.map((_, j) => `${x.id}:line${j}`)));
  const chromeLines = ref.chrome.nodes.filter((c) => c.kind === 'line' && dumpLines.has(c.id)).length;
  const a = splitByLines(checkAgainstChrome(dump, ref.chrome), chromeLines);
  const engineLines = ref.engine.filter((r) => r.parent !== null && r.id.startsWith(`${r.parent}:line`) && dumpLines.has(r.id)).length;
  const d = splitByLines(checkAgainstEngine(dump, ref.engine), engineLines);
  compared.a += a.nodes.compared + a.lines.compared;
  compared.d += d.nodes.compared + d.lines.compared;
  for (const p of a.nodes.problems) fail('device-frames', 'frame-chrome', p, idOf(p));
  for (const p of d.nodes.problems) fail('device-frames', 'frame-engine', p, idOf(p));
  for (const p of a.lines.problems) fail('device-lines', 'line-chrome', p, idOf(p));
  for (const p of d.lines.problems) fail('device-lines', 'line-engine', p, idOf(p));

  // (b), the native classes and the expected digest.
  const expected: ExpectedApplied = new Map(ref.expected.nodes.map((x) => [x.id, x.applied]));
  const b = checkApplied(dump, expected);
  compared.b += b.compared;
  for (const p of b.problems) fail('device-applied', 'applied', p, idOf(p));
  for (const x of ref.expected.nodes) {
    const got = dump.nodes.find((y) => y.id === x.id)?.native ?? 'missing';
    if (got !== x.native) fail('device-applied', 'native-class', `${x.id}: native ${got}, expected ${x.native}`, x.id);
  }
  const digest = expectedDigest(ref.expected);
  if (dump.case.expectedDigest !== digest) fail('device-applied', 'expected-digest', `expectedDigest ${dump.case.expectedDigest}, the expected dump's ${digest}`);

  // The break check: the dump against the break vector, and the break vector against Chrome's breaks.
  if (ref.breaks === null || ref.chromeBreaks === null) fail('device-lines', BREAK_MISMATCH, `no ${ref.breaks === null ? 'break vector (pnpm run layout:break-vectors)' : 'Chrome break capture (pnpm run parity:break-capture)'}`);
  else {
    const mine = checkDumpBreaks(dump, ref.breaks);
    const chrome = compareVectorWithChrome(ref.breaks, ref.chromeBreaks, leafTexts(n.programs[BACKEND_OF[target]].root));
    compared.breaks += mine.compared;
    for (const p of [...mine.problems, ...chrome.problems]) fail('device-lines', BREAK_MISMATCH, p.detail, p.text);
  }

  // (c) at the generated points against the committed Chrome PNG.
  let passingSamples: number[] = [];
  const captureKind = target === 'ios' ? 'drawHierarchy' : 'PixelCopy';
  if (dump.pixels !== null && dump.pixels.capture !== captureKind) fail('device-pixels', 'capture-kind', `capture ${dump.pixels.capture}, the ${target} compositor capture is ${captureKind}`);
  if (dump.pixels === null) fail('device-pixels', 'pixel', 'the dump has no pixels');
  else if (ref.pixels === null) fail('device-pixels', 'pixel', 'no committed Chrome PNG (pnpm run parity:pixel-capture)');
  else {
    const want = rasterSize(n.case.environment.viewport, dpr);
    const c = checkCasePixels(dump.pixels.samples, ref.points, ref.pixels, want, { width: dump.pixels.width, height: dump.pixels.height });
    compared.c += c.compared;
    for (const p of c.problems) fail('device-pixels', /raster rule/.test(p) ? 'raster-size' : 'pixel', p, pixelProblemNode(p));
    const img = ref.pixels;
    passingSamples = dump.pixels.samples.flatMap((s, i) => {
      // A rule no generator emits is already a (c) failure (the points do not match); it is never a passing sample.
      if (!isSampleRule(s.rule) || ruleKind(s.rule) === 'edge' || s.x >= img.width || s.y >= img.height) return [];
      const ch = pixelAt(img, s.x, s.y);
      return s.rgba.every((x, k) => x === ch[k]) ? [i] : [];
    });
  }
  return { failures, compared, passingSamples };
}

// ---------------------------------------------------------------- a DPR set

/** One DPR set of a target, as run on one device. */
export type DeviceSet = {
  readonly dpr: number;
  readonly device: DeviceRecord;
  readonly cases: number;
  readonly dumps: number;
  readonly compared: Compared;
  /** sha256 of the dumps in case order, timing removed (the only field that varies between identical runs). */
  readonly dumpsSha256: string;
  readonly failures: readonly LaneFailure[];
  readonly faults: readonly FaultRow[];
};

export type FaultRow = { readonly fault: DumpFault; readonly check: NamedCheck; readonly applicable: number; readonly caught: number; readonly uncaught: readonly string[] };

export const dumpFile = (dir: string, caseId: string, dpr: number): string => join(dir, `${caseId}@${dpr}.json`);

/** A pulled dump file: absent, not JSON (a truncated or malformed write), or its parsed value for the validator. */
export function readDump(file: string): { readonly kind: 'missing' } | { readonly kind: 'unparseable'; readonly detail: string } | { readonly kind: 'ok'; readonly raw: unknown } {
  if (!existsSync(file)) return { kind: 'missing' };
  try {
    return { kind: 'ok', raw: JSON.parse(readFileSync(file, 'utf8')) as unknown };
  } catch (e) {
    return { kind: 'unparseable', detail: `the dump is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function namedCheck(check: NamedCheck, dump: NativeDump, target: NativeTarget, n: NativeCase, dpr: number, ref: CaseReference): readonly string[] {
  switch (check) {
    case 'a':
      return checkAgainstChrome(dump, ref.chrome).problems;
    case 'd':
      return checkAgainstEngine(dump, ref.engine).problems;
    case 'b':
      return checkApplied(dump, new Map(ref.expected.nodes.map((x) => [x.id, x.applied]))).problems;
    case 'c':
      return dump.pixels === null || ref.pixels === null ? ['no pixels'] : checkCasePixels(dump.pixels.samples, ref.points, ref.pixels, rasterSize(n.case.environment.viewport, dpr), dump.pixels).problems;
    case 'breaks':
      return ref.breaks === null ? ['no break vector'] : checkDumpBreaks(dump, ref.breaks).problems.map((p) => `${p.kind}: ${p.detail}`);
  }
}

/** Every case of the set: the dumps in dir, checked; then every dump fault planted into every real dump it applies to. */
export function evaluateSet(target: NativeTarget, dpr: number, dir: string, device: DeviceRecord, cases: readonly NativeCase[], extra: readonly LaneFailure[] = [], refOf: (n: NativeCase) => CaseReference = (n) => caseReference(target, n, dpr)): DeviceSet {
  const failures: LaneFailure[] = [...extra];
  const compared = zero();
  const h = createHash('sha256');
  let dumps = 0;
  const faults = new Map<DumpFault, { applicable: number; caught: number; uncaught: string[] }>(DUMP_FAULTS.map((f) => [f, { applicable: 0, caught: 0, uncaught: [] }]));
  for (const n of cases) {
    const file = dumpFile(dir, n.case.id, dpr);
    const read = readDump(file);
    if (read.kind === 'unparseable') {
      for (const lane of DEVICE_CHECK_LANES) failures.push({ lane, case: n.case.id, dpr, node: null, kind: 'dump-invalid', detail: read.detail });
      continue;
    }
    const raw = read.kind === 'ok' ? read.raw : null;
    const ref = refOf(n);
    const o = evaluateCase(target, n, dpr, raw, ref);
    failures.push(...o.failures);
    for (const k of Object.keys(compared) as (keyof Compared)[]) compared[k] += o.compared[k];
    if (raw === null) continue;
    dumps++;
    h.update(n.case.id).update('\0').update(JSON.stringify({ ...(raw as object), timing: null })).update('\0');
    const v = validateNativeDump(raw);
    if (!v.ok) continue;
    for (const fault of DUMP_FAULTS) {
      const planted = plantDumpFault(fault, v.dump, { engine: ref.engine, passingSamples: o.passingSamples });
      if (planted === null) continue;
      const row = faults.get(fault) as { applicable: number; caught: number; uncaught: string[] };
      row.applicable++;
      const check = FAULT_CHECK[fault];
      const clean = new Set(namedCheck(check, v.dump, target, n, dpr, ref));
      const got = namedCheck(check, planted, target, n, dpr, ref);
      if (got.some((p) => !clean.has(p))) row.caught++;
      else row.uncaught.push(n.case.id);
    }
  }
  return {
    dpr,
    device,
    cases: cases.length,
    dumps,
    compared,
    dumpsSha256: h.digest('hex'),
    failures,
    faults: DUMP_FAULTS.map((f) => {
      const r = faults.get(f) as { applicable: number; caught: number; uncaught: string[] };
      return { fault: f, check: FAULT_CHECK[f], applicable: r.applicable, caught: r.caught, uncaught: r.uncaught };
    }),
  };
}

// ---------------------------------------------------------------- capture trust

export type TrustRow = { readonly case: string; readonly points: number; readonly mismatches: readonly string[] };

/** A capture-trust case: its generated sample points and the raster size its capture must have. */
export type TrustCase = { readonly id: string; readonly points: readonly SamplePoint[]; readonly size: ImageSize };

/**
 * The capture-trust probe of one device: for each held case, the dump must be that case at this DPR, its capture the raster size,
 * and its samples exactly the generated points (count, order, coordinates and rule); then the in-app samples are compared with
 * the OS screenshot at the same points shifted by the root's window offset, every channel within GATE_CHANNEL_DELTA.
 */
export function captureTrust(dir: string, trustCases: readonly TrustCase[], dpr: number, origin: readonly [number, number]): TrustRow[] {
  return trustCases.map(({ id, points, size }) => {
    const dumpPath = dumpFile(dir, id, dpr);
    const shot = join(dir, `screen-${id}.png`);
    if (!existsSync(dumpPath) || !existsSync(shot)) return { case: id, points: 0, mismatches: [`${existsSync(dumpPath) ? 'no OS screenshot' : 'no dump'}`] };
    const read = readDump(dumpPath);
    if (read.kind !== 'ok') return { case: id, points: 0, mismatches: [read.kind === 'unparseable' ? read.detail : 'no dump'] };
    const valid = validateNativeDump(read.raw);
    if (!valid.ok) return { case: id, points: 0, mismatches: [`the dump does not validate: ${valid.errors.slice(0, 5).map((e) => `${e.path} ${e.code}`).join('; ')}`] };
    const dump = valid.dump;
    if (dump.case.id !== id || dump.case.dpr !== dpr) return { case: id, points: 0, mismatches: [`the dump is case ${dump.case.id} at DPR ${dump.case.dpr}, not ${id} at ${dpr}`] };
    if (dump.pixels === null) return { case: id, points: 0, mismatches: ['the dump has no pixels'] };
    if (dump.pixels.width !== size.width || dump.pixels.height !== size.height) return { case: id, points: 0, mismatches: [`the in-app capture is ${dump.pixels.width}x${dump.pixels.height}, the raster rule ${size.width}x${size.height}`] };
    const samples = dump.pixels.samples;
    if (points.length === 0) return { case: id, points: 0, mismatches: ['the case has no generated points'] };
    const placed = samples.length !== points.length ? `the dump has ${samples.length} samples, the generator ${points.length}` : (() => {
      const k = points.findIndex((p, i) => samples[i]?.x !== p.x || samples[i]?.y !== p.y || samples[i]?.rule !== p.rule);
      return k < 0 ? null : `sample ${k} is ${samples[k]?.rule} at ${samples[k]?.x},${samples[k]?.y}, the generator's is ${points[k]?.rule} at ${points[k]?.x},${points[k]?.y}`;
    })();
    if (placed !== null) return { case: id, points: 0, mismatches: [placed] };
    let img: RgbaImage;
    try {
      img = decodePng(readFileSync(shot));
    } catch (e) {
      return { case: id, points: 0, mismatches: [`the OS screenshot is not a readable PNG: ${e instanceof Error ? e.message : String(e)}`] };
    }
    const mismatches: string[] = [];
    for (const s of samples) {
      const x = s.x + origin[0];
      const y = s.y + origin[1];
      if (x >= img.width || y >= img.height) {
        mismatches.push(`${s.rule} at ${s.x},${s.y}: outside the ${img.width}x${img.height} screenshot`);
        continue;
      }
      const os = pixelAt(img, x, y);
      if (!s.rgba.every((v, k) => Math.abs(v - (os[k] as number)) <= GATE_CHANNEL_DELTA)) mismatches.push(`${s.rule} at ${s.x},${s.y}: in-app ${JSON.stringify(s.rgba)}, OS screenshot ${JSON.stringify(os)}`);
    }
    return { case: id, points: samples.length, mismatches };
  });
}

/** The capture-trust mismatches of a device, and a trust run that did not finish, as device-pixels failures of kind capture-trust. */
export function trustFailuresOf(rows: readonly TrustRow[], dpr: number, device: string, runError: string | null = null): LaneFailure[] {
  const out = rows.flatMap((r) => r.mismatches.map((m): LaneFailure => ({ lane: 'device-pixels', case: r.case, dpr, node: null, kind: 'capture-trust', detail: `${device}: ${m}` })));
  if (runError !== null) out.push({ lane: 'device-pixels', case: '-', dpr, node: null, kind: 'capture-trust', detail: `${device}: the capture-trust run did not finish: ${runError}` });
  return out;
}

/**
 * A paint plant's verdict on its cases: caught only when the host finished, device-pixels failed on one of the plant's sample
 * rules, and device-frames and device-lines have no failure (pixels see what (d) cannot).
 */
export function plantVerdict(failures: readonly LaneFailure[], hostError: string | null, rule: RegExp): { readonly caught: boolean; readonly pixels: number; readonly inked: number; readonly frames: number; readonly lines: number } {
  const of = (lane: DeviceCheckLane): LaneFailure[] => failures.filter((f) => f.lane === lane);
  const pixels = of('device-pixels');
  const inked = pixels.filter((f) => f.kind === 'pixel' && rule.test(f.node ?? '')).length;
  const frames = of('device-frames').length;
  const lines = of('device-lines').length;
  return { caught: hostError === null && inked > 0 && frames === 0 && lines === 0, pixels: pixels.length, inked, frames, lines };
}

/** The sample rule a pixel problem names ("image-flat:a1:0 at 80,40: ...", "edge:a1:right: ..."), or null for a case-level one. */
const PROBLEM_RULE = new RegExp(`^((?:${SAMPLE_RULES.join('|')}):\\S+?)(?: at |: )`);
export function pixelProblemNode(problem: string): string | null {
  return PROBLEM_RULE.exec(problem)?.[1] ?? null;
}

/** Whether a sample rule string names one of SAMPLE_RULES (ruleKind throws on any other). */
export function isSampleRule(rule: string): boolean {
  const k = rule.indexOf(':');
  return k > 0 && (SAMPLE_RULES as readonly string[]).includes(rule.slice(0, k));
}

/** The ids of the pulled dumps of a run directory at a DPR. */
export function dumpedIds(dir: string, dpr: number): string[] {
  const suffix = `@${dpr}.json`;
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)).map((f) => f.slice(0, -suffix.length)) : [];
}

export type LaneOutcome = { readonly lane: LaneId; readonly failures: readonly LaneFailure[] };

/** The failures of one device lane across the target's sets. */
export function laneFailures(sets: readonly DeviceSet[], lane: DeviceLaneId): LaneFailure[] {
  return sets.flatMap((s) => s.failures.filter((f) => f.lane === lane));
}

export function failuresByKind(fs: readonly LaneFailure[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fs) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
}

// ---------------------------------------------------------------- a target's device run

export type RunLog = (line: string) => void;

/** What one device of a target's matrix gives the run: its DPR set, capture-trust rows and vectors lane, or why it was blocked. */
export type DeviceOutcome = {
  readonly device: string;
  readonly set: DeviceSet | null;
  /** SELD-R1b: the case scripts' set (device-states) and the hit records' set (device-hit); absent before them. */
  readonly states?: DeviceSet | null;
  readonly hits?: DeviceSet | null;
  readonly trust: { readonly device: string; readonly dpr: number; readonly rows: readonly TrustRow[] } | null;
  readonly vectors: (HostRun & { readonly device: string }) | null;
  readonly blocked: string | null;
};

/**
 * Runs a target on every device of the matrix: build (reused when the sources are unchanged), then per device boot, one batch
 * launch of every case with its points, the checks, the held capture-trust launch, and on the vectors device the vectors lane.
 * With jobs above 1 the devices run at once, each device's work in its own process and its boot and stop here (device-jobs.ts),
 * so every boot of the run is admitted by the one memory budget (device-run.ts); the outcomes are merged in matrix order,
 * so the run is the one a sequential run makes. A device that fails to boot twice, or cannot hold the root, is a tooling fault:
 * its DPR is recorded as not run, never as a pass.
 */
export async function runTargetOnDevices(t: TargetConfig, host: HostRun | null, log: RunLog, opts: { readonly vectors?: boolean; readonly jobs?: number } = {}): Promise<DeviceRun> {
  // Stamped before any device work: the code, reference data and app sources this run is made and judged with.
  const evidence = deviceEvidence(t.target);
  const cases = nativeCases();
  const b0 = Date.now();
  const build = t.target === 'ios' ? buildIos({ reuse: true }) : buildAndroid({ reuse: true });
  for (const l of build.log) log(`${t.target} build: ${l}`);
  log(`${t.target} build: ${((Date.now() - b0) / 1000).toFixed(0)} s`);
  if (build.cases !== cases.length) throw new Error(`${t.target}: the app holds ${build.cases} cases, layoutCases() ${cases.length}`);
  const specs = DEVICE_MATRIX.filter((d) => d.target === t.target);
  const vectors = opts.vectors !== false;
  const jobs = Math.min(opts.jobs ?? 1, specs.length);
  const outcomes =
    jobs <= 1
      ? await sequentially(specs, (spec) => runOneDevice(t, spec, host, build.artifact, () => cases, vectors, log))
      : await runDevicesInChildren(t.target, specs, jobs, (spec) => ({ target: t.target, device: spec.name, artifact: build.artifact, host, vectors }), log);
  return mergeOutcomes(outcomes, evidence);
}

async function sequentially<A, B>(xs: readonly A[], f: (x: A) => Promise<B>): Promise<B[]> {
  const out: B[] = [];
  for (const x of xs) out.push(await f(x));
  return out;
}

/** The target's run from its devices' outcomes, in matrix order. */
export function mergeOutcomes(outcomes: readonly DeviceOutcome[], evidence: DeviceRun['evidence']): DeviceRun {
  const sets: DeviceSet[] = [];
  const states: DeviceSet[] = [];
  const hits: DeviceSet[] = [];
  const trust: { device: string; dpr: number; rows: readonly TrustRow[] }[] = [];
  const blocked: string[] = [];
  let vectors: (HostRun & { device: string }) | null = null;
  for (const o of outcomes) {
    if (o.blocked !== null) blocked.push(o.blocked);
    if (o.set !== null) sets.push(o.set);
    if (o.states !== undefined && o.states !== null) states.push(o.states);
    if (o.hits !== undefined && o.hits !== null) hits.push(o.hits);
    if (o.trust !== null) trust.push(o.trust);
    if (o.vectors !== null) {
      if (vectors !== null) throw new Error(`two devices ran the vectors lane (${vectors.device}, ${o.vectors.device})`);
      vectors = o.vectors;
    }
  }
  return { vectors, sets, states, hits, trust, blocked: blocked.length === 0 ? null : blocked.join('; '), evidence };
}

/** Every failure of a target's run, the SELD-R1b lanes' too (the list written to out/device-failures-<target>.json). */
export function allRunFailures(d: DeviceRun): LaneFailure[] {
  return [...d.sets, ...(d.states ?? []), ...(d.hits ?? [])].flatMap((s) => s.failures);
}

// ---------------------------------------------------------------- device-states and device-hit (SELD-R1b)

/** A case script as a layout case for the device checks: the end assignment's case under the script's id. */
export type ScriptCase = { readonly script: NativeCase; readonly end: NativeCase };

/** Every case script of a target, in state program order (state-cases.ts stateEmits), each with its end assignment's case. */
export function scriptCases(target: NativeTarget): ScriptCase[] {
  const groups = stateGroups();
  const emits = stateEmits(target);
  if (emits.length !== groups.length) throw new Error(`${emits.length} state programs for ${groups.length} state groups`);
  return emits.flatMap((e, k) => {
    const g = groups[k] as (typeof groups)[number];
    if (g.id !== e.id) throw new Error(`state program ${e.id} is not group ${g.id}`);
    const sp = stateProgramOf(g, BACKEND_OF[target]);
    return deriveScripts(g, sp).map((s): ScriptCase => {
      const end = g.cases[s.ends];
      if (end === undefined) throw new Error(`${s.id}: no end case ${s.ends}`);
      return { script: { ...end, case: { ...end.case, id: s.id } }, end };
    });
  });
}

/** The device checks of a case script: the end assignment's references, with the expected dump under the script's id. */
export function scriptReference(target: NativeTarget, s: ScriptCase, dpr: number): CaseReference {
  const ref = caseReference(target, s.end, dpr);
  // The end assignment's Chrome capture is the script's Chrome reference, so it is named for the script.
  return { ...ref, chrome: { ...ref.chrome, fixture: s.script.case.id }, expected: expectedDump(s.end.programs[BACKEND_OF[target]], s.script.case.id, s.end.case.environment.viewport, dpr, expectedEngine()) };
}

/** device-states at one DPR: every script's dump checked as its end assignment's case would be, failures under device-states. */
export function evaluateStates(target: NativeTarget, dpr: number, dir: string, device: DeviceRecord, scripts: readonly ScriptCase[], extra: readonly LaneFailure[] = []): DeviceSet {
  const byId = new Map(scripts.map((s) => [s.script.case.id, s]));
  const set = evaluateSet(target, dpr, dir, device, scripts.map((s) => s.script), [], (n) => scriptReference(target, byId.get(n.case.id) as ScriptCase, dpr));
  // One failure per kind, case and detail: the four check lanes report a missing or invalid dump each.
  const seen = new Set<string>();
  const failures: LaneFailure[] = [...extra];
  for (const f of set.failures) {
    const k = `${f.case}\0${f.node ?? ''}\0${f.kind}\0${f.detail}`;
    if (seen.has(k)) continue;
    seen.add(k);
    failures.push({ ...f, lane: STATE_LANE });
  }
  return { ...set, failures };
}

export const hitFile = (dir: string, id: string, dpr: number): string => join(dir, `${id}@${dpr}.hit`);

/** device-hit at one DPR: the device's hit answers of every layout case against the TS hit test's at that DPR. */
export function evaluateHits(dpr: number, dir: string, device: DeviceRecord, cases: readonly NativeCase[], expectedOf: (n: NativeCase) => string = (n) => expectedHitRuns(n, dpr), extra: readonly LaneFailure[] = []): DeviceSet {
  const failures: LaneFailure[] = [...extra];
  const h = createHash('sha256');
  let records = 0;
  let compared = 0;
  for (const n of cases) {
    const id = n.case.id;
    const file = hitFile(dir, id, dpr);
    if (!existsSync(file)) {
      failures.push({ lane: HIT_LANE, case: id, dpr, node: null, kind: 'hit-missing', detail: 'the device wrote no hit record' });
      continue;
    }
    const got = readFileSync(file, 'utf8');
    records++;
    h.update(id).update('\0').update(got).update('\0');
    const want = expectedOf(n);
    const gotRuns = got.split(';');
    const wantRuns = want.split(';');
    compared += wantRuns.length;
    if (got === want) continue;
    const at = wantRuns.findIndex((r, i) => r !== gotRuns[i]);
    const k = at < 0 ? wantRuns.length : at;
    failures.push({ lane: HIT_LANE, case: id, dpr, node: null, kind: 'hit-mismatch', detail: `run ${k}: device ${JSON.stringify(gotRuns[k] ?? '(none)')}, host ${JSON.stringify(wantRuns[k] ?? '(none)')} (${gotRuns.length} and ${wantRuns.length} runs)` });
  }
  return { dpr, device, cases: cases.length, dumps: records, compared: { a: 0, b: compared, c: 0, d: 0, breaks: 0 }, dumpsSha256: h.digest('hex'), failures, faults: [] };
}

/** Where a device comes from: booted and stopped by this process, or handed by the parent that boots and stops it (release null). */
export type DeviceSource = { readonly boot: () => Promise<DeviceHandle>; readonly release: ((h: DeviceHandle) => Promise<string | null>) | null };

/**
 * A device's outcome given what its stop reported (PR #42 finding 4149997382): a device that may still be running is a tooling fault,
 * so its results are not used: the outcome is blocked, naming the problem, never a pass.
 */
export function afterRelease(o: DeviceOutcome, problem: string | null): DeviceOutcome {
  if (problem === null) return o;
  return { device: o.device, set: null, trust: null, vectors: null, blocked: `${o.device}: the device could not be stopped after its run (tooling fault), so its results are not used: ${problem}${o.blocked === null ? '' : `; ${o.blocked}`}` };
}

/** One device of the matrix: boot, the batch launch and its checks, the capture-trust launch and, on the vectors device, the vectors lane. */
export async function runOneDevice(t: TargetConfig, spec: DeviceSpec, host: HostRun | null, artifact: string, casesOf: () => readonly NativeCase[], runVectors: boolean, log: RunLog, source: DeviceSource = { boot: () => boot(spec), release: (h) => release(h, log) }): Promise<DeviceOutcome> {
  const backend = BACKEND_OF[t.target];
  const none = { device: spec.name, set: null, trust: null, vectors: null };
  let h: DeviceHandle;
  const b0 = Date.now();
  // The boot runs while the cases are computed (a device process computes them itself).
  const booting = source.boot();
  let cases: readonly NativeCase[];
  try {
    cases = casesOf();
  } catch (e) {
    const stop = source.release;
    await booting.then((h) => (stop === null ? undefined : stop(h)), () => undefined);
    throw e;
  }
  try {
    h = await booting;
  } catch (e) {
    const blocked = e instanceof Error ? e.message : String(e);
    log(`${spec.name}: ${blocked}`);
    return { ...none, blocked };
  }
  log(`${spec.name}: booted (the cases computed meanwhile) in ${((Date.now() - b0) / 1000).toFixed(0)} s`);
  const work = async (): Promise<DeviceOutcome> => {
    const prof = deviceProfile(h);
    const dpr = prof.profileScale;
    if (!t.dprs.includes(dpr)) throw new Error(`${spec.name}: profile scale ${dpr} is not a ${t.target} device DPR`);
    const runFile = runFileText(cases.map((n) => ({ id: n.case.id, points: casePoints(n.programs[backend], n.case.environment.viewport, dpr) })), false);
    const outDir = join(nativeOut(t.target), 'lanes', spec.name);
    const t0 = Date.now();
    const r = await runApp(h, artifact, { runFile, caseCount: cases.length, outDir });
    const rec = deviceRecord(prof, r.record);
    const root = rasterSize(cases[0]?.case.environment.viewport ?? { width: 0, height: 0 }, dpr);
    const recProblems = recordProblems(rec, root);
    log(`${spec.name}: ${rec.os}, build ${rec.build}; scale ${rec.profileScale} (profile) / ${rec.appScale} (app); window ${rec.windowPx.join('x')} px, stage ${rec.stagePx.join('x')} px at ${rec.rootOriginPx.join(',')}; text scale ${rec.textScale}; ${dumpedIds(outDir, dpr).length} dumps in ${((Date.now() - t0) / 1000).toFixed(0)} s${r.error === null ? '' : `; host error: ${r.error}`}`);
    if (recProblems.some((p) => p.includes('device fit'))) return { ...none, blocked: recProblems.join('; ') };
    const extra: LaneFailure[] = [...recProblems, ...(r.error === null ? [] : [`the host did not finish: ${r.error}`])].flatMap((p) => DEVICE_CHECK_LANES.map((lane): LaneFailure => ({ lane, case: '-', dpr, node: null, kind: 'device-record', detail: p })));
    const e0 = Date.now();
    const set = evaluateSet(t.target, dpr, outDir, rec, cases, extra);
    log(`${spec.name}: checked ${set.dumps}/${set.cases} dumps in ${((Date.now() - e0) / 1000).toFixed(0)} s; compared a ${set.compared.a}, b ${set.compared.b}, c ${set.compared.c}, d ${set.compared.d}, breaks ${set.compared.breaks}; failures ${JSON.stringify(failuresByKind(set.failures))}`);
    // SELD-R1b: device-hit from the hit records the batch launch wrote beside its dumps, then device-states from a launch of the
    // case scripts.
    const h0 = Date.now();
    const hits = evaluateHits(dpr, outDir, rec, cases, (n) => expectedHitRuns(n, dpr), extra.map((f): LaneFailure => ({ ...f, lane: HIT_LANE })).filter((f, i, all) => all.findIndex((x) => x.detail === f.detail) === i));
    log(`${spec.name}: device-hit ${hits.dumps}/${hits.cases} records, ${hits.compared.b} runs compared in ${((Date.now() - h0) / 1000).toFixed(0)} s; failures ${JSON.stringify(failuresByKind(hits.failures))}`);
    const scripts = scriptCases(t.target);
    const statesDir = join(nativeOut(t.target), 'lanes', `${spec.name}-states`);
    const s0 = Date.now();
    const sr = await runApp(h, artifact, { runFile: runFileText(scripts.map((s) => ({ id: s.script.case.id, points: casePoints(s.end.programs[backend], s.end.case.environment.viewport, dpr) })), false), caseCount: scripts.length, outDir: statesDir });
    const stateExtra: LaneFailure[] = sr.error === null ? [] : [{ lane: STATE_LANE, case: '-', dpr, node: null, kind: 'device-record', detail: `the host did not finish the scripts: ${sr.error}` }];
    const states = evaluateStates(t.target, dpr, statesDir, rec, scripts, stateExtra);
    log(`${spec.name}: device-states ${states.dumps}/${states.cases} dumps in ${((Date.now() - s0) / 1000).toFixed(0)} s; failures ${JSON.stringify(failuresByKind(states.failures))}`);
    const trustDir = join(nativeOut(t.target), 'lanes', `${spec.name}-trust`);
    const trustCases: TrustCase[] = TRUST_CASES.map((id) => {
      const tc = cases.find((c) => c.case.id === id);
      if (tc === undefined) throw new Error(`no trust case ${id}`);
      return { id, points: casePoints(tc.programs[backend], tc.case.environment.viewport, dpr), size: rasterSize(tc.case.environment.viewport, dpr) };
    });
    const tr0 = Date.now();
    const tr = await runApp(h, artifact, { runFile: runFileText(trustCases, true), caseCount: trustCases.length, outDir: trustDir, onHold: async (_id, shot) => void (await shot()) });
    const rows = captureTrust(trustDir, trustCases, dpr, tr.record.rootOriginPx);
    // Trust mismatches are device-pixels failures of the set, so the failure lists and counts hold them.
    const trustFailures = trustFailuresOf(rows, dpr, spec.name, tr.error);
    log(`${spec.name}: capture trust ${rows.map((x) => `${x.case} ${x.points - x.mismatches.length}/${x.points}`).join(', ')} in ${((Date.now() - tr0) / 1000).toFixed(0)} s`);
    let vectors: (HostRun & { device: string }) | null = null;
    if (runVectors && spec.name === VECTOR_DEVICES[t.target]) {
      const v0 = Date.now();
      vectors = await runDeviceVectors(h, t, host);
      log(`${spec.name}: layout-vectors-device ${vectors.state}${vectors.reason === null ? '' : ` (${vectors.reason})`}; ${vectors.suites.map((s) => `${s.corpus}/${s.suite} ${s.pass ?? '-'}/${s.total ?? '-'}`).join(', ')}; digests ${vectors.digests.p1} ${vectors.digests.extended}; ${((Date.now() - v0) / 1000).toFixed(0)} s`);
    }
    return { device: spec.name, set: trustFailures.length > 0 ? { ...set, failures: [...set.failures, ...trustFailures] } : set, states, hits, trust: { device: spec.name, dpr, rows }, vectors, blocked: null };
  };
  const stop = source.release;
  if (stop === null) return work();
  let outcome: DeviceOutcome;
  try {
    outcome = await work();
  } catch (e) {
    // The run fails with its own error; a stop that also failed is logged by release and keeps the device's memory reserved.
    await stop(h);
    throw e;
  }
  const r0 = Date.now();
  const problem = await stop(h);
  log(`${spec.name}: released in ${((Date.now() - r0) / 1000).toFixed(0)} s`);
  return afterRelease(outcome, problem);
}
