// Device lanes on CI (.github/workflows/device-lanes.yml): every matrix device runs in its own job (cli/device-ci.ts one), which
// writes its outcome with the evidence stamp it was made under and the host that made it. Every lane runs there, the android
// vectors lane too since a NaN matches any NaN in the corpus comparison (#147). The merge (cli/device-ci.ts merge) checks that
// every device of both targets ran exactly once on this tree's evidence, merges in matrix order as a local run does
// (mergeOutcomes), and writes the same lanes.json and device-failures-<target>.json records, each device lane naming the hosts
// that produced it (producedOn).
import type { DeviceEvidence } from './device-evidence.ts';
import { parseOutcome } from './device-jobs.ts';
import type { DeviceOutcome } from './device-lanes.ts';
import { mergeOutcomes } from './device-lanes.ts';
import type { DeviceSpec } from './device-run.ts';
import { DEVICE_MATRIX } from './device-run.ts';
import type { DeviceRun } from './lanes.ts';
import type { NativeTarget } from './targets.ts';

export const OUTCOME_SCHEMA = 'dragon.device-outcome/2';

/** One device job's result: the device, the evidence stamp of the tree it ran on, the host that ran it, and its outcome. */
export type CiOutcome = { readonly schema: typeof OUTCOME_SCHEMA; readonly target: NativeTarget; readonly device: string; readonly evidence: DeviceEvidence; readonly producedOn: string; readonly outcome: DeviceOutcome };

export const ciOutcomeText = (o: CiOutcome): string => `${JSON.stringify(o)}\n`;

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
 * The runs of both targets from the device jobs' outcomes: every matrix device exactly once, each made under this tree's evidence
 * stamp (evidenceOf), merged in matrix order. Throws naming every missing, repeated or foreign outcome; nothing is merged from a
 * subset.
 */
export function mergeCiOutcomes(outcomes: readonly CiOutcome[], evidenceOf: (t: NativeTarget) => DeviceEvidence, matrix: readonly DeviceSpec[] = DEVICE_MATRIX): Map<NativeTarget, DeviceRun> {
  const problems: string[] = [];
  const key = (t: string, d: string): string => `${t}/${d}`;
  const seen = new Map<string, CiOutcome>();
  for (const o of outcomes) {
    const k = key(o.target, o.device);
    if (seen.has(k)) problems.push(`${k}: two outcomes`);
    seen.set(k, o);
    const want = evidenceOf(o.target);
    for (const f of ['laneCode', 'referenceData', 'app'] as const) if (o.evidence[f] !== want[f]) problems.push(`${k}: evidence ${f} ${o.evidence[f].slice(0, 12)} is not this tree's ${want[f].slice(0, 12)}`);
  }
  for (const d of matrix) if (!seen.has(key(d.target, d.name))) problems.push(`${key(d.target, d.name)}: no outcome`);
  if (problems.length > 0) throw new Error(`device outcomes cannot be merged:\n  ${problems.join('\n  ')}`);
  const runs = new Map<NativeTarget, DeviceRun>();
  for (const t of ['ios', 'android'] as const) {
    const mine = matrix.filter((d) => d.target === t).map((d) => seen.get(key(t, d.name))!);
    const merged = mergeOutcomes(mine.map((o) => o.outcome), evidenceOf(t));
    const v = mine.find((o) => o.outcome.vectors !== null);
    runs.set(t, { ...merged, producedOn: { devices: Object.fromEntries(mine.map((o) => [o.device, o.producedOn])), vectors: v?.producedOn ?? null } });
  }
  return runs;
}

type LanesRecords = { readonly targets: readonly { readonly target: string; readonly lanes: readonly { readonly lane: string; readonly where: string; readonly state: string; readonly reason: string | null }[] }[] };
type Failure = { readonly lane: string; readonly case: string; readonly dpr: number; readonly node: string | null; readonly kind: string; readonly detail: string };
export type LaneComparison = { readonly target: string; readonly lane: string; readonly committed: string; readonly ci: string; readonly set: string; readonly detail: string; readonly same: boolean };

/**
 * Every device lane of the merged CI records against the records committed at the tested commit: the state, and the failure set
 * (lane, case, DPR, node, kind) with and without its detail text. It informs a run made for review (the `devices` label); a run
 * the landing driver dispatches is judged by the driver against the previous position, since its tree's own committed records
 * are the "not run" ones its regen wrote (judgeCommitted false).
 */
export function compareWithCommitted(committed: { readonly lanes: LanesRecords; readonly failures: (t: string) => readonly Failure[] }, ci: { readonly lanes: LanesRecords; readonly failures: (t: string) => readonly Failure[] }): { readonly rows: readonly LaneComparison[]; readonly same: boolean } {
  const rows: LaneComparison[] = [];
  const key = (f: Failure): string => JSON.stringify([f.lane, f.case, f.dpr, f.node, f.kind]);
  for (const t of committed.lanes.targets) {
    const mine = ci.lanes.targets.find((x) => x.target === t.target);
    for (const l of t.lanes.filter((x) => x.where === 'device')) {
      const m = mine?.lanes.find((x) => x.lane === l.lane);
      const a = committed.failures(t.target).filter((f) => f.lane === l.lane);
      const b = ci.failures(t.target).filter((f) => f.lane === l.lane);
      const [ka, kb] = [a.map(key).sort(), b.map(key).sort()];
      const [da, db] = [a.map((f) => key(f) + f.detail).sort(), b.map((f) => key(f) + f.detail).sort()];
      const setSame = JSON.stringify(ka) === JSON.stringify(kb);
      const detailSame = JSON.stringify(da) === JSON.stringify(db);
      const fmt = (x: { state: string; reason: string | null } | undefined): string => (x === undefined ? 'missing' : `${x.state}${x.reason === null ? '' : ` (${x.reason})`}`);
      rows.push({ target: t.target, lane: l.lane, committed: fmt(l), ci: fmt(m), set: setSame ? `same (${ka.length})` : `differs: ${ka.filter((k) => !kb.includes(k)).length} only committed, ${kb.filter((k) => !ka.includes(k)).length} only CI`, detail: detailSame ? 'same' : 'differs', same: m?.state === l.state && setSame && detailSame });
    }
  }
  return { rows, same: rows.every((r) => r.same) };
}

/** The comparison as a markdown table, with its verdict line. */
export const comparisonText = (c: ReturnType<typeof compareWithCommitted>): string =>
  `${['| target | lane | committed | CI | failure set (lane, case, dpr, node, kind) | detail text |', '|---|---|---|---|---|---|', ...c.rows.map((r) => `| ${r.target} | ${r.lane} | ${r.committed} | ${r.ci} | ${r.set} | ${r.detail} |`)].join('\n')}\n\n${c.same ? 'Every device lane judges exactly as the committed records.' : 'Some device lanes differ from the committed records.'}\n`;
