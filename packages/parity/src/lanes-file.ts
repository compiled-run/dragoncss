// Reading packages/parity/out/lanes.json and judging whether it still describes the configuration (staleLanes), apart from the
// lane runners in lanes.ts: profile:rows reads only this, so a change to how the host or device lanes run does not re-key it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { GATE_CHANNEL_DELTA, GATE_DEVICE_PX } from './compare.ts';
import { EXTRA_DPRS, SHARED_DPRS } from './dpr.ts';
import type { DeviceEvidence } from './device-evidence.ts';
import { DUMP_FAULTS } from './dump-faults.ts';
import type { DeviceLaneRun, LaneRecord, LanesFile, LaneState, RanCases } from './lanes.ts';
import { repoPath } from './paths.ts';
import { SAMPLE_RULES } from './samples.ts';
import type { LaneConfig, LaneId, NativeTarget, TargetConfig } from './targets.ts';

export const caseCount = (l: LaneConfig): number => l.sets.reduce((n, s) => n + s.ids.length, 0);

export const LANES_JSON = 'packages/parity/out/lanes.json';

export const sha256 = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** The RanCases of a run of the lane as configured now. */
export function ranOf(l: LaneConfig): RanCases {
  return { sets: l.sets.map((s) => ({ dpr: s.dpr, role: s.role, extra: s.extra, list: sha256(s.ids) })), corpora: sha256(l.corpora) };
}

/** Whether a record's ran cases have the lane's configured shape (the same DPR sets in order, the same corpora) with every list known. */
export function ranFits(ran: RanCases | undefined, l: LaneConfig, lists: LanesFile['caseLists']): boolean {
  if (ran === undefined) return false;
  const want = ranOf(l);
  if (ran.corpora !== want.corpora || ran.sets.length !== want.sets.length) return false;
  return ran.sets.every((s, i) => {
    const w = want.sets[i]!;
    return s.dpr === w.dpr && s.role === w.role && s.extra === w.extra && Array.isArray(lists?.[s.list]);
  });
}

export function laneRecord(l: LaneConfig, state: LaneState, reason: string | null, run: LaneRecord['run'], device: DeviceLaneRun | null = null, evidence: DeviceEvidence | null = null): LaneRecord {
  const ids = l.sets.map((s) => ({ dpr: s.dpr, ids: s.ids }));
  return {
    lane: l.lane,
    where: l.where,
    state,
    reason,
    sets: l.sets.map((s) => ({ dpr: s.dpr, role: s.role, extra: s.extra, cases: s.ids.length })),
    corpora: l.corpora.map((c) => ({ corpus: c.corpus, suite: c.suite, cases: c.cases })),
    caseListSha256: createHash('sha256').update(JSON.stringify({ ids, corpora: l.corpora })).digest('hex'),
    totalCases: caseCount(l) + l.corpora.reduce((n, c) => n + c.cases, 0),
    run,
    device,
    evidence,
    // A run's record (it carries the run's evidence stamp) names the cases it ran.
    ...(evidence === null ? {} : { ran: ranOf(l) }),
  };
}

export const DEVICE_NOT_RUN = 'run pnpm run parity:lanes -- --run-device (simulators and emulators); the tools are installed, so this is not blocked';

/**
 * A device lane's record in a lanes run without a device run of its target (lanes.ts lanesFile): the committed record carried as
 * the last device evidence while keep (it ran and no staleLanes problem covers it), else not run.
 */
export function carriedDeviceRecord(l: LaneConfig, kept: LaneRecord | undefined, keep: boolean): LaneRecord {
  // A record from before RanCases whose case list is the configured one ran exactly the configured cases.
  if (keep && kept !== undefined) return { ...kept, device: kept.device ?? null, ...(kept.ran === undefined && kept.caseListSha256 === laneRecord(l, 'not run', null, null).caseListSha256 ? { ran: ranOf(l) } : {}) };
  return laneRecord(l, 'not run', DEVICE_NOT_RUN, null);
}

/**
 * The committed file with its device lanes as the next host lanes run writes them (carriedDeviceRecord), its host lanes and
 * parity as committed: the device evidence lanes-host will leave, before it runs. Every configured case list joins caseLists.
 */
export function carryDeviceLanes(f: LanesFile, targets: readonly TargetConfig[]): LanesFile {
  const stale = staleLanes(f, targets);
  const caseLists: Record<string, readonly string[]> = { ...(f.caseLists ?? {}) };
  for (const t of targets) for (const l of t.lanes) for (const s of l.sets) caseLists[sha256(s.ids)] = s.ids;
  return {
    ...f,
    caseLists,
    targets: f.targets.map((ft) => {
      const t = targets.find((x) => x.target === ft.target);
      if (t === undefined) return ft;
      return {
        ...ft,
        lanes: t.lanes.flatMap((l) => {
          const kept = ft.lanes.find((x) => x.lane === l.lane);
          if (l.where === 'host') return kept === undefined ? [] : [kept];
          return [carriedDeviceRecord(l, kept, kept !== undefined && kept.state !== 'not run' && !stale.some((p) => staleCovers(p, t.target, l.lane)))];
        }),
      };
    }),
  };
}

export function readLanesFile(): LanesFile | null {
  return existsSync(repoPath(LANES_JSON)) ? (JSON.parse(readFileSync(repoPath(LANES_JSON), 'utf8')) as LanesFile) : null;
}

/** Whether a staleLanes problem invalidates a lane: its own case list, its target (missing, other projection), or every lane (a constant). */
export function staleCovers(problem: string, target: NativeTarget, lane: LaneId): boolean {
  const lanePrefix = /^\S+: (ios|android) (\S+) does not match/.exec(problem);
  if (lanePrefix !== null) return lanePrefix[1] === target && lanePrefix[2] === lane;
  const targetLevel = /^\S+(?: has no target |: )(ios|android)(?: projection |$)/.exec(problem);
  if (targetLevel !== null) return targetLevel[1] === target;
  return true;
}

/** Problems when a committed lanes file does not describe the current configuration (a stale file proves nothing). */
export function staleLanes(f: LanesFile, targets: readonly TargetConfig[]): string[] {
  const out: string[] = [];
  // The constants every lane is judged by: a file written under others describes another configuration.
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (f.schema !== 'dragon.lanes/2') out.push(`${LANES_JSON}: schema ${String(f.schema)}, not dragon.lanes/2`);
  if (!same(f.tolerances, { gateDevicePx: GATE_DEVICE_PX, channelDelta: GATE_CHANNEL_DELTA })) out.push(`${LANES_JSON}: tolerances ${JSON.stringify(f.tolerances)} are not the current gates`);
  if (!same(f.sampleRules, SAMPLE_RULES)) out.push(`${LANES_JSON}: sample rules ${JSON.stringify(f.sampleRules)} are not SAMPLE_RULES`);
  if (!same(f.dumpFaults, DUMP_FAULTS)) out.push(`${LANES_JSON}: dump faults ${JSON.stringify(f.dumpFaults)} are not DUMP_FAULTS`);
  if (!same(f.sharedDprs, SHARED_DPRS) || !same(f.extras, EXTRA_DPRS)) out.push(`${LANES_JSON}: the DPR sets are not SHARED_DPRS and EXTRA_DPRS`);
  for (const t of targets) {
    const ft = f.targets.find((x) => x.target === t.target);
    if (ft === undefined) {
      out.push(`${LANES_JSON} has no target ${t.target}`);
      continue;
    }
    if (ft.projection !== t.projection.name) out.push(`${LANES_JSON}: ${t.target} projection ${ft.projection}, configured ${t.projection.name}`);
    for (const l of t.lanes) {
      const fl = ft.lanes.find((x) => x.lane === l.lane);
      if (fl === undefined) {
        out.push(`${LANES_JSON}: ${t.target} ${l.lane} does not match the configured case list`);
        continue;
      }
      if (fl.caseListSha256 === laneRecord(l, 'not run', null, null).caseListSha256) continue;
      // A device lane that ran cases of the configured shape is carried per case (casesNotRun names the cases it did not run).
      if (l.where === 'device' && fl.state !== 'not run' && ranFits(fl.ran, l, f.caseLists)) continue;
      out.push(`${LANES_JSON}: ${t.target} ${l.lane} does not match the configured case list`);
    }
  }
  return out;
}

/** The ids a carried device lane ran at a DPR (its RanCases list), or null when the record names none. */
export function ranIds(f: LanesFile, rec: LaneRecord, dpr: number): ReadonlySet<string> | null {
  const s = rec.ran?.sets.find((x) => x.dpr === dpr);
  const ids = s === undefined ? undefined : f.caseLists?.[s.list];
  return Array.isArray(ids) ? new Set(ids) : null;
}
