// The native targets and their lanes (docs/research/native-strategy.md 3.6). Every case list is derived from the constants: the
// layout cases, SHARED_DPRS and EXTRA_DPRS, and the committed corpus manifests. Tolerances, sample rules, dump faults and the
// layout projection are imported, so no target can hold a weaker copy.
import { readdirSync, readFileSync } from 'node:fs';
import { nativeLayoutProjection } from 'dragon';
import { GATE_CHANNEL_DELTA, GATE_DEVICE_PX } from './compare.ts';
import { DPRS, EXTRA_DPRS, layoutCases, SHARED_DPRS } from './dpr.ts';
import { DUMP_FAULTS } from './native-compare.ts';
import { repoPath } from './paths.ts';
import { SAMPLE_RULES } from './samples.ts';
import { shapedCaseIds } from './text-latin-run.ts';

export const LANES = ['layout-vectors-host', 'layout-vectors-device', 'device-frames', 'device-applied', 'device-lines', 'device-pixels'] as const;
export type LaneId = (typeof LANES)[number];
export type NativeTarget = 'ios' | 'android';
export const NATIVE_TARGETS: readonly NativeTarget[] = ['ios', 'android'];

/** One DPR's case ids: the top-level vectors (DPR 1), a shared DPR, or an extra named in EXTRA_DPRS. */
export type CaseSet = { readonly dpr: number; readonly role: 'top-level' | 'shared' | 'extra'; readonly extra: string | null; readonly ids: readonly string[] };
/** A differential corpus suite beside the vectors, with its case count from the committed manifest. */
export type CorpusSuite = { readonly corpus: 'p1' | 'extended'; readonly suite: string; readonly cases: number };

export type LaneConfig = {
  readonly lane: LaneId;
  /** vectors: the platform-free engine vectors and corpora; device: the layout cases at the target's device DPRs. */
  readonly kind: 'vectors' | 'device';
  readonly where: 'host' | 'device';
  readonly sets: readonly CaseSet[];
  readonly corpora: readonly CorpusSuite[];
};

export type Tolerances = { readonly gateDevicePx: number; readonly channelDelta: number };

export type TargetConfig = {
  readonly target: NativeTarget;
  /** The device pixel ratios the target's devices run: the shared set, then its named extras. */
  readonly dprs: readonly number[];
  readonly lanes: readonly LaneConfig[];
  readonly tolerances: Tolerances;
  readonly sampleRules: readonly string[];
  readonly plantedFaults: readonly string[];
  readonly projection: typeof nativeLayoutProjection;
  /** The package script that runs the generated engine on the host. */
  readonly hostCli: 'native:swift' | 'native:kotlin';
};

type P1Manifest = { readonly unitsPerFunction: number; readonly unitsFunctions: readonly string[]; readonly mutatedVectors: number; readonly generatedTrees: number; readonly cases: Readonly<Record<string, number>>; readonly digest: string };
type ExtendedManifest = { readonly dprSets: readonly number[]; readonly unitsPerFunction: number; readonly unitsFunctions: readonly string[]; readonly calcUnitsPerFunction: number; readonly calcUnitsFunctions: readonly string[]; readonly engineCalc: number; readonly engineInline: number; readonly snapGenerated: number; readonly snapVectors: number; readonly cases: Readonly<Record<string, number>>; readonly digest: string };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(repoPath(path), 'utf8')) as T;
export const p1Manifest = (): P1Manifest => readJson<P1Manifest>('packages/translate/corpus.json');
export const extendedManifest = (): ExtendedManifest => readJson<ExtendedManifest>('packages/translate/corpus-dpr.json');
/** The milestone-1 case ids the P1 vectors suite reads, in order (corpus-m1-cases.json). */
export const m1CaseIds = (): readonly string[] => readJson<{ readonly cases: readonly string[] }>('packages/translate/corpus-m1-cases.json').cases;

let topLevel: readonly string[] | null = null;
/** Every layout case id, in fixture order: the top-level vectors, and the ids of every DPR set. */
export function layoutCaseIds(): readonly string[] {
  if (topLevel === null) topLevel = layoutCases().flatMap((f) => f.cases.map((c) => c.id));
  return topLevel;
}

let vectorIds: readonly string[] | null = null;
/** The layout case ids whose vectors are plain (no shape transcript): every layout case but the shaped ones (text-latin-run.ts). */
export function vectorCaseIds(): readonly string[] {
  if (vectorIds === null) {
    const shaped = shapedCaseIds();
    vectorIds = layoutCaseIds().filter((id) => !shaped.has(id));
  }
  return vectorIds;
}

const extraName = (dpr: number): string | null => EXTRA_DPRS.find((e) => e.dpr === dpr)?.name ?? null;

function dprSet(dpr: number, ids: readonly string[]): CaseSet {
  const shared = SHARED_DPRS.includes(dpr);
  return { dpr, role: shared ? 'shared' : 'extra', extra: shared ? null : extraName(dpr), ids };
}

/** The target's device DPRs: SHARED_DPRS, then the EXTRA_DPRS named for its platform. */
export function deviceDprs(target: NativeTarget): readonly number[] {
  return [...SHARED_DPRS, ...EXTRA_DPRS.filter((e) => e.platform === target).map((e) => e.dpr)];
}

/** The corpus suites beside the vectors, counted from the manifests' own parameters. */
export function corpusSuites(): readonly CorpusSuite[] {
  const p1 = p1Manifest();
  const x = extendedManifest();
  return [
    { corpus: 'p1', suite: 'units', cases: p1.unitsPerFunction * p1.unitsFunctions.length },
    { corpus: 'p1', suite: 'engine', cases: p1.mutatedVectors + p1.generatedTrees },
    { corpus: 'p1', suite: 'library', cases: p1.cases['library'] ?? 0 },
    // ANIM-a2 (notes/T047 section 3.2): one rt case per rt vector record (timing, easing, hold and interpolation).
    { corpus: 'p1', suite: 'rt', cases: ['timing', 'easing', 'hold', 'interp'].reduce((n, f) => n + readJson<{ readonly records: readonly unknown[] }>(`packages/layout/rt-vectors/${f}.json`).records.length, 0) },
    { corpus: 'extended', suite: 'engine-dpr', cases: vectorCaseIds().length * x.dprSets.length },
    { corpus: 'extended', suite: 'units-m2', cases: x.unitsPerFunction * x.unitsFunctions.length },
    { corpus: 'extended', suite: 'snap', cases: x.snapVectors + x.snapGenerated },
    // V1 value model (notes/T006): the values cases' snap vectors, the calc engine goldens, generated calc trees and calc units.
    { corpus: 'extended', suite: 'snap-values', cases: vectorCaseIds().filter((id) => id.startsWith('values-')).length * x.dprSets.length },
    { corpus: 'extended', suite: 'calc-goldens', cases: readdirSync(repoPath('packages/layout/vectors/calc')).filter((f) => f.endsWith('.json')).length },
    { corpus: 'extended', suite: 'engine-calc', cases: x.engineCalc },
    { corpus: 'extended', suite: 'units-calc', cases: x.calcUnitsPerFunction * x.calcUnitsFunctions.length },
    // INL1a: generated inline formatting contexts (corpus-dpr.ts engineInlineCases).
    { corpus: 'extended', suite: 'engine-inline', cases: x.engineInline },
    // TXT1a-2: every shaped case's vector with its shape transcript, at DPR 1 and every DPR set (corpus-dpr.ts textLatinVectorCases).
    { corpus: 'extended', suite: 'text-latin', cases: shapedCaseIds().size * (1 + x.dprSets.length) },
  ];
}

/** The declared lane: vectors lanes hold every top-level and DPR vector plus the corpora; device lanes the cases at the device DPRs. */
export function declaredLane(target: NativeTarget, lane: LaneId): LaneConfig {
  const where = lane === 'layout-vectors-host' ? 'host' : 'device';
  if (lane === 'layout-vectors-host' || lane === 'layout-vectors-device') {
    // A shaped case's vectors are the text-latin suite's (they carry a shape transcript), not a vectors set's.
    const vectors = vectorCaseIds();
    return { lane, kind: 'vectors', where, sets: [{ dpr: 1, role: 'top-level', extra: null, ids: vectors }, ...DPRS.map((d) => dprSet(d, vectors))], corpora: corpusSuites() };
  }
  // TXT1a-2: a shaped case is not a device case until phase R gives the device runtime its shaper (the device measures only Ahem).
  return { lane, kind: 'device', where, sets: deviceDprs(target).map((d) => dprSet(d, vectorCaseIds())), corpora: [] };
}

function targetConfig(target: NativeTarget): TargetConfig {
  return {
    target,
    dprs: deviceDprs(target),
    lanes: LANES.map((l) => declaredLane(target, l)),
    tolerances: { gateDevicePx: GATE_DEVICE_PX, channelDelta: GATE_CHANNEL_DELTA },
    sampleRules: SAMPLE_RULES,
    plantedFaults: DUMP_FAULTS,
    projection: nativeLayoutProjection,
    hostCli: target === 'ios' ? 'native:swift' : 'native:kotlin',
  };
}

let targets: readonly TargetConfig[] | null = null;
/** The configured native targets (compiles every layout fixture once, on first use). */
export function nativeTargets(): readonly TargetConfig[] {
  if (targets === null) targets = NATIVE_TARGETS.map(targetConfig);
  return targets;
}

/** The P1 and extended suite counts a vectors lane declares, keyed as the native CLIs print them. */
export function declaredSuites(lane: LaneConfig): { readonly corpus: 'p1' | 'extended'; readonly suite: string; readonly cases: number }[] {
  const m1 = new Set(m1CaseIds());
  const top = lane.sets.filter((s) => s.role === 'top-level').flatMap((s) => s.ids);
  const dpr = lane.sets.filter((s) => s.role !== 'top-level').reduce((n, s) => n + s.ids.length, 0);
  return [
    { corpus: 'p1', suite: 'vectors', cases: top.filter((id) => m1.has(id)).length },
    ...lane.corpora.filter((c) => c.corpus === 'p1'),
    { corpus: 'extended', suite: 'vectors-m2', cases: top.filter((id) => !m1.has(id)).length },
    { corpus: 'extended', suite: 'vectors-dpr', cases: dpr },
    ...lane.corpora.filter((c) => c.corpus === 'extended'),
  ];
}
