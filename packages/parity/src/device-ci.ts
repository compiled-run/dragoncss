// Device lanes on CI (.github/workflows/device-lanes.yml): every matrix device runs in jobs of its own (cli/device-ci.ts one), each
// job one or more parts of the device's run (DEVICE_PARTS) on its own booted device, writing the part's outcome with the evidence
// stamp it was made under and the host that made it; cli/device-ci.ts combine makes each device's outcome from its parts. Every lane runs there, the android
// vectors lane too since a NaN matches any NaN in the corpus comparison (#147). The merge (cli/device-ci.ts merge) checks that
// every device of both targets ran exactly once on this tree's evidence, merges in matrix order as a local run does
// (mergeOutcomes), and writes the same lanes.json and device-failures-<target>.json records, each device lane naming the hosts
// that produced it (producedOn).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeviceEvidence } from './device-evidence.ts';
import { parseOutcome } from './device-jobs.ts';
import type { BlockReason, DeviceOutcome, DevicePart } from './device-lanes.ts';
import { BLOCK_REASONS, DEVICE_PARTS, mergeOutcomes } from './device-lanes.ts';
import type { DeviceSpec } from './device-run.ts';
import { DEVICE_MATRIX, VECTOR_DEVICES } from './device-run.ts';
import type { DeviceRun } from './lanes.ts';
import { nativeOut } from './native-host.ts';
import type { NativeTarget } from './targets.ts';

export const OUTCOME_SCHEMA = 'dragon.device-outcome/2';
/** device-ci.ts one's exit code for a device the tooling blocked (boot, settle, install): the job judges nothing of the tree. */
export const TOOLING_EXIT = 4;
/** device-ci.ts one's exit code for a device run that judged the tree (a failed run, or a block the tree caused): a verdict. */
export const VERDICT_EXIT = 1;

/**
 * The exit code of a blocked device: TOOLING_EXIT only when every reason is the tooling's; any reason of the tree's (a matrix
 * mismatch, a device record from an app that ran) or a block without its reasons (an older producer) is a verdict.
 */
export function blockedExit(reasons: readonly BlockReason[] | undefined): number {
  return reasons !== undefined && reasons.length > 0 && reasons.every((r) => BLOCK_REASONS[r] === 'tooling') ? TOOLING_EXIT : VERDICT_EXIT;
}

/**
 * sha256 of every dump and hit record a device wrote, by case, with the device header (model, ABI, OS build, toolchain) and the
 * timing removed, so two hosts' raw output can be compared case by case. Absent from an older outcome; null for a blocked device.
 */
export type CaseDumpHashes = { readonly dpr: number; readonly set: Readonly<Record<string, string>>; readonly states: Readonly<Record<string, string>>; readonly hits: Readonly<Record<string, string>>; readonly anim: Readonly<Record<string, string>> };

/** A dump's hash without its device header and timing; a dump that is not a JSON object is hashed as it is, marked unparseable. */
export function rawDumpHash(text: string): string {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    v = undefined;
  }
  const body = typeof v === 'object' && v !== null && !Array.isArray(v) ? JSON.stringify({ ...v, timing: null, device: null }) : `unparseable\0${text}`;
  return createHash('sha256').update(body).digest('hex');
}

/** A case id usable as a map key: never one of Object.prototype's names (__proto__, constructor, ...). */
const caseKey = (k: string): boolean => k !== '' && !(k in Object.prototype);

/** The hashes of the files <case>@<dpr><ext> in dir, by case id (a missing dir has none; a file named for a prototype key throws). */
export function dumpHashesIn(dir: string, ext: '.json' | '.hit', dpr: number): Record<string, string> {
  if (!existsSync(dir)) return {};
  const suffix = `@${dpr}${ext}`;
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(suffix)).sort()) {
    const text = readFileSync(join(dir, f), 'utf8');
    const id = f.slice(0, -suffix.length);
    if (!caseKey(id)) throw new Error(`${join(dir, f)}: ${JSON.stringify(id)} is not a case id`);
    out[id] = ext === '.hit' ? createHash('sha256').update(text).digest('hex') : rawDumpHash(text);
  }
  return out;
}

/** A device's per-case hashes at its DPR from the directories its run wrote (runOneDevice), or null when it ran no set (no DPR). */
export function caseDumpHashes(target: NativeTarget, device: string, dpr: number | null, root: string = nativeOut(target)): CaseDumpHashes | null {
  if (dpr === null) return null;
  const lanes = join(root, 'lanes');
  return { dpr, set: dumpHashesIn(join(lanes, device), '.json', dpr), states: dumpHashesIn(join(lanes, `${device}-states`), '.json', dpr), hits: dumpHashesIn(join(lanes, device), '.hit', dpr), anim: dumpHashesIn(join(lanes, `${device}-anim`), '.json', dpr) };
}

/** The cases whose hashes differ between two hosts' outcomes, by kind (a case on one side only counts as differing). */
export function diffCaseHashes(a: CaseDumpHashes, b: CaseDumpHashes): { readonly set: string[]; readonly states: string[]; readonly hits: string[]; readonly anim: string[] } {
  const diff = (x: Readonly<Record<string, string>>, y: Readonly<Record<string, string>>): string[] => [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]).sort();
  return { set: diff(a.set, b.set), states: diff(a.states, b.states), hits: diff(a.hits, b.hits), anim: diff(a.anim, b.anim) };
}

/** One device job's result: the device, the evidence stamp of the tree it ran on, the host that ran it, its outcome and its per-case hashes. */
export type CiOutcome = { readonly schema: typeof OUTCOME_SCHEMA; readonly target: NativeTarget; readonly device: string; readonly evidence: DeviceEvidence; readonly producedOn: string; readonly outcome: DeviceOutcome; readonly dumps?: CaseDumpHashes | null };

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
  const dumps = parseCaseHashes(v['dumps'], file);
  return { schema: OUTCOME_SCHEMA, target, device, evidence, producedOn, outcome, ...(dumps === undefined ? {} : { dumps }) };
}

/** The per-case hashes of an outcome, checked: absent (an older outcome), null, or a DPR and three maps of case id to sha256. */
export function parseCaseHashes(v: unknown, file: string): CaseDumpHashes | null | undefined {
  if (v === undefined || v === null) return v;
  const map = (m: unknown): m is Record<string, string> => isObj(m) && Object.keys(m).every(caseKey) && Object.values(m).every((h) => typeof h === 'string' && HEX64.test(h));
  if (!isObj(v) || typeof v['dpr'] !== 'number' || !map(v['set']) || !map(v['states']) || !map(v['hits']) || !map(v['anim'])) throw new Error(`${file}: dumps is not a DPR and per-case sha256 maps of set, states, hits and anim (case ids, never a prototype key)`);
  return { dpr: v['dpr'], set: v['set'], states: v['states'], hits: v['hits'], anim: v['anim'] };
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

// ---------------------------------------------------------------- parts of a device's run (device-ci.ts one --parts)

export const PART_SCHEMA = 'dragon.device-part/1';

/** The parts a device's run is made of: cases and anim, and vectors on its target's vectors device only. */
export const partsOf = (d: DeviceSpec): DevicePart[] => DEVICE_PARTS.filter((p) => p !== 'vectors' || VECTOR_DEVICES[d.target] === d.name);

/** A list of a device's parts (device-ci.ts one --parts a,b): each a part of that device, named once; returned in DEVICE_PARTS order. */
export function parseParts(names: readonly string[], spec: DeviceSpec): DevicePart[] {
  const mine = partsOf(spec);
  const problems: string[] = [];
  if (names.length === 0) problems.push('no part');
  for (const p of names) if (!(mine as string[]).includes(p)) problems.push(`${JSON.stringify(p)} is not a part of ${spec.name} (${mine.join(', ')})`);
  if (new Set(names).size !== names.length) problems.push('a part is named twice');
  if (problems.length > 0) throw new Error(`parts ${JSON.stringify(names.join(','))}: ${problems.join('; ')}`);
  return mine.filter((p) => names.includes(p));
}

/** One device job's parts of a device's run: the part outcome (the other parts null), its evidence stamp, host and per-case hashes. */
export type PartOutcome = { readonly schema: typeof PART_SCHEMA; readonly target: NativeTarget; readonly device: string; readonly parts: readonly DevicePart[]; readonly evidence: DeviceEvidence; readonly producedOn: string; readonly outcome: DeviceOutcome; readonly dumps: CaseDumpHashes | null };

export const partOutcomeText = (o: PartOutcome): string => `${JSON.stringify(o)}\n`;

/** The fields each part fills in an outcome that is not blocked: a part that ran fills all of them, one that did not none. */
const PART_FIELDS: { readonly [P in DevicePart]: readonly (keyof DeviceOutcome)[] } = { cases: ['set', 'states', 'hits', 'traces', 'env', 'trust'], anim: ['anim'], vectors: ['vectors'] };

/** A part file, checked: schema, a matrix device, its parts, evidence, host, an outcome holding exactly its parts, and the hashes. */
export function parsePartOutcome(text: string, file: string): PartOutcome {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file}: not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isObj(v)) throw new Error(`${file}: not an object`);
  if (v['schema'] !== PART_SCHEMA) throw new Error(`${file}: schema ${JSON.stringify(v['schema'])}, not ${PART_SCHEMA}`);
  const target = v['target'];
  const device = v['device'];
  if (target !== 'ios' && target !== 'android') throw new Error(`${file}: target ${JSON.stringify(target)} is not ios or android`);
  const spec = DEVICE_MATRIX.find((d) => d.target === target && d.name === device);
  if (spec === undefined) throw new Error(`${file}: ${JSON.stringify(device)} is not a ${target} matrix device`);
  const names = v['parts'];
  if (!Array.isArray(names) || !names.every((p) => typeof p === 'string')) throw new Error(`${file}: parts is not a list of part names`);
  const parts = parseParts(names as string[], spec);
  if (JSON.stringify(parts) !== JSON.stringify(names)) throw new Error(`${file}: parts ${JSON.stringify(names)} are not in the order ${DEVICE_PARTS.join(', ')}`);
  const evidence = parseEvidence(v['evidence'], file);
  const producedOn = parseProducer(v['producedOn'], file);
  const outcome = parseOutcome(JSON.stringify(v['outcome'] ?? null), spec.name, false);
  if (outcome.blocked === null) {
    const wrong: string[] = [];
    for (const p of partsOf(spec)) for (const f of PART_FIELDS[p]) if ((outcome[f] !== undefined && outcome[f] !== null) !== parts.includes(p)) wrong.push(`${f} ${parts.includes(p) ? 'missing' : 'present'}`);
    if (wrong.length > 0) throw new Error(`${file}: the outcome does not hold exactly the parts ${parts.join(', ')}: ${wrong.join(', ')}`);
  }
  if (v['dumps'] === undefined) throw new Error(`${file}: no dumps (null or the per-case hashes)`);
  const dumps = parseCaseHashes(v['dumps'], file) ?? null;
  return { schema: PART_SCHEMA, target, device: spec.name, parts, evidence, producedOn, outcome, dumps };
}

/**
 * Each matrix device's outcome from its parts' files, in matrix order: every part of every device exactly once, the parts of a
 * device made under one evidence stamp at one DPR. The outcome is the one a single run of every part makes: the cases part's sets
 * and trust rows, the anim part's frame samples, the vectors part's run; a blocked part blocks the device, with each blocked
 * part's reason. Throws naming every missing, repeated or mismatched part; nothing is combined from a subset.
 */
export function combineParts(files: readonly PartOutcome[], matrix: readonly DeviceSpec[] = DEVICE_MATRIX): CiOutcome[] {
  const problems: string[] = [];
  const owner = new Map<string, PartOutcome>();
  const key = (t: string, d: string, p: DevicePart): string => `${t}/${d} ${p}`;
  for (const f of files) {
    for (const p of f.parts) {
      const k = key(f.target, f.device, p);
      if (owner.has(k)) problems.push(`${k}: two outcomes`);
      else owner.set(k, f);
    }
  }
  const out: CiOutcome[] = [];
  for (const d of matrix) {
    const need = partsOf(d);
    const missing = need.filter((p) => !owner.has(key(d.target, d.name, p)));
    for (const p of missing) problems.push(`${key(d.target, d.name, p)}: no outcome`);
    if (missing.length > 0) continue;
    const of = (p: DevicePart): PartOutcome => owner.get(key(d.target, d.name, p)) as PartOutcome;
    const mine = [...new Set(need.map(of))];
    const first = mine[0] as PartOutcome;
    for (const f of mine.slice(1)) for (const e of ['laneCode', 'referenceData', 'app'] as const) if (f.evidence[e] !== first.evidence[e]) problems.push(`${d.target}/${d.name}: the parts ${first.parts.join(',')} and ${f.parts.join(',')} have evidence ${e} ${first.evidence[e].slice(0, 12)} and ${f.evidence[e].slice(0, 12)}`);
    const [cases, anim] = [of('cases'), of('anim')];
    const casesDpr = cases.outcome.set?.dpr ?? null;
    const animDpr = anim.outcome.anim?.dpr ?? null;
    if (casesDpr !== null && animDpr !== null && casesDpr !== animDpr) problems.push(`${d.target}/${d.name}: the cases part ran at DPR ${casesDpr}, the anim part at ${animDpr}`);
    const blocked = mine.filter((f) => f.outcome.blocked !== null);
    const blockedBy = [...new Set(blocked.flatMap((f) => f.outcome.blockedBy ?? []))];
    const outcome: DeviceOutcome =
      blocked.length > 0
        ? { device: d.name, set: null, trust: null, vectors: null, blocked: [...new Set(blocked.map((f) => f.outcome.blocked as string))].join('; '), ...(blockedBy.length > 0 ? { blockedBy } : {}) }
        : { device: d.name, set: cases.outcome.set, states: cases.outcome.states ?? null, hits: cases.outcome.hits ?? null, anim: anim.outcome.anim ?? null, traces: cases.outcome.traces ?? null, env: cases.outcome.env ?? null, trust: cases.outcome.trust, vectors: need.includes('vectors') ? of('vectors').outcome.vectors : null, blocked: null };
    let dumps: CaseDumpHashes | null = null;
    if (blocked.length === 0 && cases.dumps !== null && anim.dumps !== null) {
      if (cases.dumps.dpr !== anim.dumps.dpr) problems.push(`${d.target}/${d.name}: the parts' dump hashes are at DPR ${cases.dumps.dpr} and ${anim.dumps.dpr}`);
      dumps = { dpr: cases.dumps.dpr, set: cases.dumps.set, states: cases.dumps.states, hits: cases.dumps.hits, anim: anim.dumps.anim };
    }
    out.push({ schema: OUTCOME_SCHEMA, target: d.target, device: d.name, evidence: first.evidence, producedOn: [...new Set(mine.map((f) => f.producedOn))].join(' + '), outcome, dumps });
  }
  if (problems.length > 0) throw new Error(`device parts cannot be combined:\n  ${problems.join('\n  ')}`);
  return out;
}
