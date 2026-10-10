// The evidence stamp of a device lane run (PR #10, finding 4131217867): digests of everything that decides a device lane's
// verdict besides the device itself. These are the lane code that judges the dumps, the committed reference data it judges
// them against (Chrome captures, break vectors, Chrome breaks, Chrome pixels, Ahem), and the source of the app that produced the
// dumps (the generated engine, support code and every case). A device run writes the stamp. A committed device lane is carried
// into a later file only while its stamp equals the current one; a record without a stamp is never carried.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hostSources, sourceTreeSha256 } from './native-host.ts';
import { repoPath } from './paths.ts';
import type { NativeTarget } from './targets.ts';

export type DeviceEvidence = { readonly laneCode: string; readonly referenceData: string; readonly app: string };

/** The source files whose code decides a device lane verdict. */
export const EVIDENCE_CODE: readonly string[] = [
  'packages/parity/src/compare.ts',
  'packages/parity/src/device-ci.ts',
  'packages/parity/src/cli/device-ci.ts',
  'packages/parity/src/device-evidence.ts',
  'packages/parity/src/device-exec.ts',
  'packages/parity/src/device-jobs.ts',
  'packages/parity/src/device-lanes.ts',
  'packages/parity/src/device-run.ts',
  'packages/parity/src/device-vectors.ts',
  'packages/parity/src/dpr.ts',
  'packages/parity/src/lanes.ts',
  'packages/parity/src/line-breaks.ts',
  'packages/parity/src/native-compare.ts',
  'packages/parity/src/native-dump.ts',
  'packages/parity/src/native-host.ts',
  'packages/parity/src/pixel-reference.ts',
  'packages/parity/src/samples.ts',
  'packages/parity/src/targets.ts',
  'packages/parity/src/trace-lane.ts',
];

/** The committed reference data the device lanes are judged against. */
export const EVIDENCE_DATA: readonly string[] = [
  'packages/parity/expected-dpr',
  'packages/parity/expected-breaks',
  'packages/parity/expected-pixels',
  'packages/layout/break-vectors',
  'vendor/fonts/Ahem.ttf',
];

/** The toolchain label the app digest is taken with: the version is a fact of the run (recorded apart), not of the sources. */
const TOOLCHAIN_PLACEHOLDER = 'evidence';

function files(path: string): string[] {
  const abs = repoPath(path);
  if (!statSync(abs).isDirectory()) return [path];
  return readdirSync(abs).sort().flatMap((f) => files(join(path, f)));
}

function digest(paths: readonly string[]): string {
  const h = createHash('sha256');
  for (const p of paths.flatMap(files)) h.update(p).update('\0').update(readFileSync(repoPath(p))).update('\0');
  return h.digest('hex');
}

const cache = new Map<NativeTarget, DeviceEvidence>();

/** The current evidence stamp of a target (computed once per process). */
export function deviceEvidence(target: NativeTarget): DeviceEvidence {
  const hit = cache.get(target);
  if (hit !== undefined) return hit;
  const e: DeviceEvidence = { laneCode: digest(EVIDENCE_CODE), referenceData: digest(EVIDENCE_DATA), app: sourceTreeSha256(hostSources(target, TOOLCHAIN_PLACEHOLDER)) };
  cache.set(target, e);
  return e;
}

/** Why a recorded stamp is not the current one; empty when it is. A missing stamp is never current. */
export function evidenceProblems(recorded: DeviceEvidence | null | undefined, current: DeviceEvidence): string[] {
  if (recorded === null || recorded === undefined) return ['the record has no evidence stamp'];
  const out: string[] = [];
  for (const k of ['laneCode', 'referenceData', 'app'] as const) if (recorded[k] !== current[k]) out.push(`${k} ${recorded[k].slice(0, 12)} is not the current ${current[k].slice(0, 12)}`);
  return out;
}
