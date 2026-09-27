import type { SupportStatus, Target } from '../types.ts';

/** What a proof covers: milestone 1 proves layout geometry on the Linux lane only, never colour or paint. */
export type Proof = { readonly aspect: 'layout'; readonly lane: 'linux-dragon-layout'; readonly fixtures: readonly string[] };

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
