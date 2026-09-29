// Profile rows derived from a parity run (M1): the single definition used by scripts/gen-profile-rows.ts and by the
// committed profile-proof test in parity.test.ts.
import type { Longhand, ProfileRow, Proof } from 'dragon';
import { PROPERTY_ASPECTS } from 'dragon';
import { existsSync, readFileSync } from 'node:fs';
import type { LaneFailure } from './device-lanes.ts';
import type { LanesFile } from './lanes.ts';
import { readLanesFile, staleLanes } from './lanes.ts';
import { repoPath } from './paths.ts';
import type { CaseOutcome } from './pipeline.ts';
import type { NativeTarget, TargetConfig } from './targets.ts';
import { nativeTargets } from './targets.ts';

export const PROFILE_REVISION = 'm2-p6a';

type Lane = 'linux-dragon-layout' | 'chrome-dual';

/**
 * A native target's committed device evidence (P6a promotion rule, oracle clause 4): per device lane of the target, the cases
 * it runs at every one of the target's DPRs and the cases it failed at some DPR. unavailable names why no row of the target can
 * be exact (no committed lanes.json, a stale or failed parity record, a lane that did not run, a failure list that disagrees).
 */
export type DeviceEvidence = {
  readonly target: NativeTarget;
  readonly unavailable: string | null;
  readonly lanes: readonly { readonly lane: string; readonly perCase: boolean; readonly passed: boolean; readonly cases: ReadonlySet<string>; readonly failing: ReadonlySet<string> }[];
};

/** The device evidence of one target from the committed lanes.json, its full failure list and the configured lanes. */
export function deviceEvidence(target: NativeTarget, lanes: LanesFile | null, failures: readonly LaneFailure[] | null, configured: readonly TargetConfig[], stale: readonly string[]): DeviceEvidence {
  const none = (why: string): DeviceEvidence => ({ target, unavailable: why, lanes: [] });
  if (lanes === null) return none('no committed packages/parity/out/lanes.json');
  if (!lanes.parity.pass) return none(`lanes.json records a lane-parity failure: ${lanes.parity.problems.join('; ')}`);
  if (stale.length > 0) return none(`lanes.json is stale: ${stale.join('; ')}`);
  const t = lanes.targets.find((x) => x.target === target);
  const c = configured.find((x) => x.target === target);
  if (t === undefined || c === undefined) return none(`lanes.json has no ${target} record`);
  if (failures === null) return none(`no committed packages/parity/out/device-failures-${target}.json`);
  const out: DeviceEvidence['lanes'][number][] = [];
  for (const lc of c.lanes) {
    if (lc.kind !== 'device') continue;
    const rec = t.lanes.find((l) => l.lane === lc.lane);
    if (rec === undefined || rec.state === 'not run' || rec.state === 'blocked (owner tooling)') return none(`${target} ${lc.lane} did not run`);
    const listed = failures.filter((f) => f.lane === lc.lane);
    const recorded = rec.device === null ? 0 : rec.device.sets.reduce((n, x) => n + x.failures, 0);
    if (listed.length !== recorded) return none(`device-failures-${target}.json lists ${listed.length} ${lc.lane} failures, lanes.json records ${recorded}`);
    const perCase = rec.device !== null;
    if (!perCase && rec.state !== 'pass') return none(`${target} ${lc.lane}: ${rec.state}`);
    // A case proves nothing on a lane unless the lane runs it at every DPR of the target.
    const sets = lc.sets.filter((x) => c.dprs.includes(x.dpr));
    const cases = new Set(c.dprs.every((d) => sets.some((x) => x.dpr === d)) ? (sets[0]?.ids ?? []).filter((id) => sets.every((x) => x.ids.includes(id))) : []);
    out.push({ lane: lc.lane, perCase, passed: rec.state === 'pass', cases, failing: new Set(listed.map((f) => f.case)) });
  }
  return { target, unavailable: null, lanes: out };
}

/** Why a native row is not exact under the promotion rule, or null when every proving case passes every device lane it needs. */
export function promotionBlocker(ev: DeviceEvidence, proving: readonly string[], paint: boolean): string | null {
  if (ev.unavailable !== null) return ev.unavailable;
  if (proving.length === 0) return 'no proving case';
  for (const l of ev.lanes) {
    if (l.lane === 'device-pixels' && !paint) continue;
    if (!l.perCase) continue;
    for (const id of proving) {
      if (!l.cases.has(id)) return `${id} is not run by ${ev.target} ${l.lane} at every DPR`;
      if (l.failing.has(id)) return `${id} fails ${ev.target} ${l.lane}`;
    }
  }
  return null;
}

/**
 * The rows for one target from the cases of one run: exactly the passing cases that use each key, per lane. A native row (ios,
 * android; both use the compiler's native keys) is exact only when its device evidence shows every proving case passing every
 * device lane of the target at every DPR, device-pixels included for rows with a paint aspect (P6a promotion rule); otherwise
 * it is caveat. Without device evidence no native row is exact.
 */
export function deriveRows(target: 'ios' | 'android' | 'web', cases: readonly CaseOutcome[], device: DeviceEvidence | null = null): ProfileRow[] {
  const keyTarget = target === 'web' ? 'web' : 'ios';
  const keys = [...new Set(cases.flatMap((c) => c.features[keyTarget]))].sort();
  const rows: ProfileRow[] = [];
  for (const key of keys) {
    const at = key.lastIndexOf('@');
    const feature = key.slice(0, at);
    const context = key.slice(at + 1);
    const colon = feature.indexOf(':');
    const property = feature.slice(0, colon) as Longhand;
    const valueSubset = feature.slice(colon + 1);
    const aspects = PROPERTY_ASPECTS[property];
    const passing = (lane: Lane): string[] => cases.filter((c) => c.lanes[lane] === 'pass' && c.features[keyTarget].includes(key)).map((c) => c.id);
    const proof = (aspect: Proof['aspect'], lane: Lane, ids: readonly string[]): Proof => ({ aspect, lane, valueSubset, context, cases: ids });
    const proofs: Proof[] = [];
    if (target !== 'web') {
      const layout = passing('linux-dragon-layout');
      const dual = passing('chrome-dual');
      if (aspects.layout && layout.length === 0) continue;
      if (aspects.paint && dual.length === 0) continue;
      if (aspects.layout) proofs.push(proof('layout', 'linux-dragon-layout', layout));
      if (aspects.paint) proofs.push(proof('computed-value', 'chrome-dual', dual));
      const proving = [...new Set(proofs.flatMap((p) => p.cases))];
      const exact = device !== null && device.target === target && promotionBlocker(device, proving, aspects.paint) === null;
      rows.push({ feature, context, status: exact ? 'exact' : 'caveat', proofs });
    } else {
      const dual = passing('chrome-dual');
      if (dual.length === 0) continue;
      if (aspects.layout) proofs.push(proof('layout', 'chrome-dual', dual));
      proofs.push(proof('computed-value', 'chrome-dual', dual));
      rows.push({ feature, context, status: 'exact', proofs });
    }
  }
  return rows;
}

export function profileSource(target: 'ios' | 'android' | 'web', rows: readonly ProfileRow[]): string {
  const name = `${target}Profile`;
  const q = (s: string): string => JSON.stringify(s);
  const lines = rows.map((r) => {
    const proofs = r.proofs.map((p) => `{ aspect: ${q(p.aspect)}, lane: ${q(p.lane)}, valueSubset: ${q(p.valueSubset)}, context: ${q(p.context)}, cases: [${p.cases.map(q).join(', ')}] }`);
    return `    { feature: ${q(r.feature)}, context: ${q(r.context)}, status: ${q(r.status)}, proofs: [${proofs.join(', ')}] },`;
  });
  return [
    '// Generated by scripts/gen-profile-rows.ts (pnpm run profile:rows) from the parity cases that passed each proof\'s lane',
    target === 'web'
      ? '// against the committed captures. Do not edit. Missing rows mean unsupported.'
      : '// against the committed captures; a row is exact only when every proving case passes every device lane of the target in the committed packages/parity/out/lanes.json (P6a). Do not edit. Missing rows mean unsupported.',
    "import type { SupportProfile } from './types.ts';",
    '',
    `export const ${name}: SupportProfile = {`,
    `  target: ${q(target)},`,
    `  revision: ${q(PROFILE_REVISION)},`,
    '  rows: [',
    ...lines,
    '  ],',
    '};',
    '',
  ].join('\n');
}

/** Every lane of a target that did not pass in a lanes record, named with its state and reason. */
export function notPassingLanes(lanes: LanesFile, target: NativeTarget): string[] {
  const t = lanes.targets.find((x) => x.target === target);
  if (t === undefined) return [`${target}: no lanes record`];
  return t.lanes.filter((l) => l.state !== 'pass').map((l) => `${l.lane} ${l.state}${l.reason === null ? '' : ` (${l.reason})`}`);
}

const NATIVE_TARGET_NAMES: readonly NativeTarget[] = ['ios', 'android'];

/** The committed native lanes verdict the compiler reads for outputs.ios and outputs.android (P6a): packages/dragon/src/profiles/native-lanes.ts. */
export function nativeLanesSource(lanes: LanesFile | null, stale: readonly string[]): string {
  const q = (s: string): string => JSON.stringify(s);
  const verdict = (target: NativeTarget): string => {
    const notPassing = lanes === null ? [] : [...(lanes.parity.pass ? [] : [`lane parity (${lanes.parity.problems.join('; ')})`]), ...notPassingLanes(lanes, target)];
    const mine = stale.filter((x) => x.includes(` ${target} `) || !NATIVE_TARGET_NAMES.some((t) => x.includes(` ${t} `)));
    return `  ${target}: { recorded: ${lanes !== null}, stale: [${mine.map(q).join(', ')}], notPassing: [${notPassing.map(q).join(', ')}] },`;
  };
  return [
    '// Generated by scripts/gen-profile-rows.ts (pnpm run profile:rows) from packages/parity/out/lanes.json. Do not edit.',
    '// A native output is ready only when its target has a recorded lanes run, none stale, in which every lane passes (P6a).',
    '',
    '/** One native target\'s committed lanes verdict. */',
    'export type NativeLanesVerdict = { readonly recorded: boolean; readonly stale: readonly string[]; readonly notPassing: readonly string[] };',
    '',
    "export const NATIVE_LANES: { readonly ios: NativeLanesVerdict; readonly android: NativeLanesVerdict } = {",
    verdict('ios'),
    verdict('android'),
    '};',
    '',
  ].join('\n');
}

/** The committed inputs of the promotion rule: packages/parity/out/lanes.json, its staleness and each target's failure list. */
export function committedLanes(): { readonly lanes: LanesFile | null; readonly stale: readonly string[]; readonly evidence: (target: NativeTarget) => DeviceEvidence } {
  const lanes = readLanesFile();
  const configured = nativeTargets();
  const stale = lanes === null ? [] : staleLanes(lanes, configured);
  const failuresOf = (target: NativeTarget): readonly LaneFailure[] | null => {
    const path = repoPath(`packages/parity/out/device-failures-${target}.json`);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as LaneFailure[]) : null;
  };
  return { lanes, stale, evidence: (target) => deviceEvidence(target, lanes, failuresOf(target), configured, stale) };
}
