import type { SupportStatus, Target } from '../types.ts';

/**
 * What a proof covers (docs/api.md §4.1, §7). layout on linux-dragon-layout: Dragon's engine against Chrome's authored boxes.
 * layout or computed-value on chrome-dual: compiled web CSS against authored CSS in Chrome, boxes and getComputedStyle values,
 * plus Dragon's resolved colour channels against Chrome's. No lane proves native paint in milestone 1.
 */
export type ProofAspect = 'layout' | 'computed-value';
export type ProofLane = 'linux-dragon-layout' | 'chrome-dual';
export type Proof = { readonly aspect: ProofAspect; readonly lane: ProofLane; readonly fixtures: readonly string[] };

/** One support fact. `feature` is "<property>:<keyword>" or "<property>:<value type>", e.g. "width:<percentage>". */
export type ProfileRow = { readonly feature: string; readonly status: SupportStatus; readonly proofs: readonly Proof[] };

export type SupportProfile = { readonly target: Target; readonly revision: string; readonly rows: readonly ProfileRow[] };

/** Missing data means unsupported (AGENTS.md). */
export function statusOf(profile: SupportProfile, feature: string): SupportStatus {
  const row = profile.rows.find((r) => r.feature === feature);
  return row === undefined ? 'unsupported' : row.status;
}

export function supportedValuesFor(profile: SupportProfile, property: string): string[] {
  return profile.rows
    .filter((r) => r.status !== 'unsupported' && r.feature.startsWith(`${property}:`))
    .map((r) => r.feature.slice(property.length + 1));
}
