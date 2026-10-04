// Device lanes on CI (.github/workflows/device-lanes.yml): every matrix device runs in its own job (cli/device-ci.ts one), which
// writes its outcome with the evidence stamp it was made under and the host that made it. The hybrid (PM ruling, 2026-10-04):
// android layout-vectors-device stays on the Mac (cli/device-ci.ts vectors, under the device lease), because the x86_64 runner
// differs from the arm64 Mac in NaN sign bits on 5 units-m2 cases. The merge (cli/device-ci.ts merge) checks that every device of
// both targets ran exactly once on this tree's evidence, that the CI outcomes hold no android vectors run and the local record
// does, merges in matrix order as a local run does (mergeOutcomes), and writes the same lanes.json and
// device-failures-<target>.json records, each device lane naming the hosts that produced it (producedOn).
import type { DeviceEvidence } from './device-evidence.ts';
import { parseOutcome } from './device-jobs.ts';
import type { DeviceOutcome } from './device-lanes.ts';
import { mergeOutcomes } from './device-lanes.ts';
import type { DeviceSpec } from './device-run.ts';
import { DEVICE_MATRIX, VECTOR_DEVICES } from './device-run.ts';
import type { DeviceRun, HostRun } from './lanes.ts';
import type { NativeTarget } from './targets.ts';

export const OUTCOME_SCHEMA = 'dragon.device-outcome/2';
export const VECTORS_SCHEMA = 'dragon.device-vectors/1';
/** The one lane the hybrid keeps on the Mac: android layout-vectors-device, on the vectors device. */
export const LOCAL_VECTORS = { target: 'android', device: VECTOR_DEVICES.android } as const;

/** One device job's result: the device, the evidence stamp of the tree it ran on, the host that ran it, and its outcome. */
export type CiOutcome = { readonly schema: typeof OUTCOME_SCHEMA; readonly target: NativeTarget; readonly device: string; readonly evidence: DeviceEvidence; readonly producedOn: string; readonly outcome: DeviceOutcome };
/** The Mac's android layout-vectors-device run for the same tree. */
export type VectorsRecord = { readonly schema: typeof VECTORS_SCHEMA; readonly target: 'android'; readonly device: string; readonly evidence: DeviceEvidence; readonly producedOn: string; readonly vectors: HostRun & { readonly device: string } };

export const ciOutcomeText = (o: CiOutcome): string => `${JSON.stringify(o)}\n`;
export const vectorsRecordText = (v: VectorsRecord): string => `${JSON.stringify(v)}\n`;

/** Who produced a record: the GitHub Actions run (runner OS, architecture and run URL), or this machine. */
export function producerLabel(env: Readonly<Record<string, string | undefined>> = process.env, platform: string = process.platform, arch: string = process.arch): string {
  if (env['GITHUB_ACTIONS'] === 'true') return `GitHub Actions ${env['RUNNER_OS'] ?? '?'} ${env['RUNNER_ARCH'] ?? '?'} (${env['ImageOS'] ?? 'image ?'}) run ${env['GITHUB_SERVER_URL'] ?? ''}/${env['GITHUB_REPOSITORY'] ?? ''}/actions/runs/${env['GITHUB_RUN_ID'] ?? '?'}`;
  return `local ${platform}-${arch}`;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const HEX64 = /^[0-9a-f]{64}$/;

function parseEvidence(ev: unknown, file: string): DeviceEvidence {
  if (!isObj(ev) || !['laneCode', 'referenceData', 'app'].every((k) => typeof ev[k] === 'string' && HEX64.test(ev[k] as string))) throw new Error(`${file}: evidence is not a stamp of three sha256 digests`);
  return { laneCode: ev['laneCode'] as string, referenceData: ev['referenceData'] as string, app: ev['app'] as string };
}

function parseProducer(v: unknown, file: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${file}: producedOn is not a host label`);
  return v;
}

/** The Mac's vectors record, checked: schema, the vectors device, a full stamp, a host label and a vectors run of that device. */
export function parseVectorsRecord(text: string, file: string): VectorsRecord {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file}: not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isObj(v)) throw new Error(`${file}: not an object`);
  if (v['schema'] !== VECTORS_SCHEMA) throw new Error(`${file}: schema ${JSON.stringify(v['schema'])}, not ${VECTORS_SCHEMA}`);
  if (v['target'] !== LOCAL_VECTORS.target || v['device'] !== LOCAL_VECTORS.device) throw new Error(`${file}: ${JSON.stringify(v['target'])}/${JSON.stringify(v['device'])} is not ${LOCAL_VECTORS.target}/${LOCAL_VECTORS.device}`);
  const evidence = parseEvidence(v['evidence'], file);
  const producedOn = parseProducer(v['producedOn'], file);
  const r = v['vectors'];
  const okDigest = (d: unknown): boolean => d === null || typeof d === 'string';
  if (!isObj(r) || r['device'] !== LOCAL_VECTORS.device || typeof r['state'] !== 'string' || !(r['reason'] === null || typeof r['reason'] === 'string') || !(r['toolchain'] === null || typeof r['toolchain'] === 'string') || !Array.isArray(r['suites']) || !isObj(r['digests']) || !okDigest(r['digests']['p1']) || !okDigest(r['digests']['extended'])) {
    throw new Error(`${file}: vectors is not the ${LOCAL_VECTORS.device} vectors run`);
  }
  return { schema: VECTORS_SCHEMA, target: LOCAL_VECTORS.target, device: LOCAL_VECTORS.device, evidence, producedOn, vectors: r as unknown as VectorsRecord['vectors'] };
}

/** A device job's file, checked: schema, a matrix device of its target, a full evidence stamp and a well-formed outcome. */
export function parseCiOutcome(text: string, file: string): CiOutcome {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file}: not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isObj(v)) throw new Error(`${file}: not an object`);
  if (v['schema'] !== OUTCOME_SCHEMA) throw new Error(`${file}: schema ${JSON.stringify(v['schema'])}, not ${OUTCOME_SCHEMA}`);
  const target = v['target'];
  const device = v['device'];
  if (target !== 'ios' && target !== 'android') throw new Error(`${file}: target ${JSON.stringify(target)} is not ios or android`);
  if (typeof device !== 'string' || !DEVICE_MATRIX.some((d) => d.target === target && d.name === device)) throw new Error(`${file}: ${JSON.stringify(device)} is not a ${target} matrix device`);
  const evidence = parseEvidence(v['evidence'], file);
  const producedOn = parseProducer(v['producedOn'], file);
  const outcome = parseOutcome(JSON.stringify(v['outcome'] ?? null), device);
  return { schema: OUTCOME_SCHEMA, target, device, evidence, producedOn, outcome };
}

/**
 * The runs of both targets from the device jobs' outcomes and the Mac's vectors record: every matrix device exactly once, each made
 * under this tree's evidence stamp (evidenceOf), merged in matrix order; android's vectors run is the local record's, and no CI
 * outcome may hold one. local 'ci-half' merges the CI outcomes alone (the workflow's own check), leaving that lane not run.
 * Throws naming every missing, repeated, foreign or misplaced half; nothing is merged from a subset.
 */
export function mergeCiOutcomes(outcomes: readonly CiOutcome[], local: VectorsRecord | 'ci-half' | null, evidenceOf: (t: NativeTarget) => DeviceEvidence, matrix: readonly DeviceSpec[] = DEVICE_MATRIX): Map<NativeTarget, DeviceRun> {
  const problems: string[] = [];
  const key = (t: string, d: string): string => `${t}/${d}`;
  const stamp = (k: string, got: DeviceEvidence, want: DeviceEvidence): void => {
    for (const f of ['laneCode', 'referenceData', 'app'] as const) if (got[f] !== want[f]) problems.push(`${k}: evidence ${f} ${got[f].slice(0, 12)} is not this tree's ${want[f].slice(0, 12)}`);
  };
  const seen = new Map<string, CiOutcome>();
  for (const o of outcomes) {
    const k = key(o.target, o.device);
    if (seen.has(k)) problems.push(`${k}: two outcomes`);
    seen.set(k, o);
    stamp(k, o.evidence, evidenceOf(o.target));
    if (o.target === LOCAL_VECTORS.target && o.outcome.vectors !== null) problems.push(`${k}: the CI outcome holds an android vectors run; the hybrid runs that lane on the Mac only`);
  }
  for (const d of matrix) if (!seen.has(key(d.target, d.name))) problems.push(`${key(d.target, d.name)}: no outcome`);
  if (local === null) problems.push(`${key(LOCAL_VECTORS.target, LOCAL_VECTORS.device)} layout-vectors-device: no local record (cli/device-ci.ts vectors, run on the Mac under the device lease)`);
  else if (local !== 'ci-half') stamp(`${key(LOCAL_VECTORS.target, LOCAL_VECTORS.device)} local vectors`, local.evidence, evidenceOf(LOCAL_VECTORS.target));
  if (problems.length > 0) throw new Error(`device outcomes cannot be merged:\n  ${problems.join('\n  ')}`);
  const runs = new Map<NativeTarget, DeviceRun>();
  for (const t of ['ios', 'android'] as const) {
    const mine = matrix.filter((d) => d.target === t).map((d) => seen.get(key(t, d.name))!);
    const merged = mergeOutcomes(mine.map((o) => o.outcome), evidenceOf(t));
    const devices = Object.fromEntries(mine.map((o) => [o.device, o.producedOn]));
    if (t !== LOCAL_VECTORS.target) {
      const v = mine.find((o) => o.outcome.vectors !== null);
      runs.set(t, { ...merged, producedOn: { devices, vectors: v?.producedOn ?? null } });
    } else if (local === 'ci-half' || local === null) runs.set(t, { ...merged, producedOn: { devices, vectors: null } });
    else runs.set(t, { ...merged, vectors: local.vectors, producedOn: { devices, vectors: local.producedOn } });
  }
  return runs;
}
