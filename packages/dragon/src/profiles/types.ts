import type { SupportStatus, Target } from '../types.ts';

/**
 * What a proof covers (docs/api.md §4.1, §7). layout on linux-dragon-layout: Dragon's engine against Chrome's authored boxes.
 * layout or computed-value on chrome-dual: compiled web CSS against authored CSS in Chrome, boxes and getComputedStyle values,
 * plus Dragon's resolved colour channels against Chrome's. No lane proves native paint in milestone 1.
 */
export type ProofAspect = 'layout' | 'computed-value';
export type ProofLane = 'linux-dragon-layout' | 'chrome-dual';

/** docs/api.md §6.3: a proof names its value subset, context and the parity cases that passed its lane in the same run. */
export type Proof = {
  readonly aspect: ProofAspect;
  readonly lane: ProofLane;
  readonly valueSubset: string;
  readonly context: string;
  readonly cases: readonly string[];
};

/** One support fact for a feature ("<property>:<keyword>" or "<property>:<value type>") in one formatting context. */
export type ProfileRow = { readonly feature: string; readonly context: string; readonly status: SupportStatus; readonly proofs: readonly Proof[] };

export type SupportProfile = { readonly target: Target; readonly revision: string; readonly rows: readonly ProfileRow[] };

/** Missing data means unsupported (AGENTS.md). */
export function statusOf(profile: SupportProfile, feature: string, context: string): SupportStatus {
  const row = profile.rows.find((r) => r.feature === feature && r.context === context);
  return row === undefined ? 'unsupported' : row.status;
}

/** The contexts in which a feature has a supported row. */
export function provenContexts(profile: SupportProfile, feature: string): string[] {
  return profile.rows.filter((r) => r.feature === feature && r.status !== 'unsupported').map((r) => r.context);
}

export function supportedValuesFor(profile: SupportProfile, property: string): string[] {
  return [...new Set(profile.rows
    .filter((r) => r.status !== 'unsupported' && r.feature.startsWith(`${property}:`))
    .map((r) => r.feature.slice(property.length + 1)))];
}

/** The value subsets of a property with a supported row in one context, sorted (T005 rec 6: alternatives in context). */
export function supportedValuesIn(profile: SupportProfile, property: string, context: string): string[] {
  return [...new Set(profile.rows
    .filter((r) => r.status !== 'unsupported' && r.context === context && r.feature.startsWith(`${property}:`))
    .map((r) => r.feature.slice(property.length + 1)))].sort();
}
