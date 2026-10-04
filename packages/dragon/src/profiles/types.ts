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

/**
 * One support fact for a feature ("<property>:<keyword>" or "<property>:<value type>") in one formatting context. note: the
 * environment the claim is limited to, from PROFILE_NOTES (the proof holds there only).
 */
export type ProfileRow = { readonly feature: string; readonly context: string; readonly status: SupportStatus; readonly proofs: readonly Proof[]; readonly note?: string };

/**
 * Environment limits of support claims (T078 R1-R3, decisions.md overlay-scrollbar rule). overlayScrollbars: Chrome's scroll
 * metrics are captured with overlay scrollbars, the reference environment; with classic scrollbars Chrome reserves a gutter,
 * measured on Chrome 145.0.7632.6 at 15px for overflow: scroll, and for auto once its content overflows.
 */
export const PROFILE_NOTES = {
  overlayScrollbars: 'holds with overlay scrollbars only (the reference environment); classic scrollbars reserve a 15px gutter at the inline and block end (measured on Chrome 145), which this claim does not cover',
} as const;

export type ProfileNote = keyof typeof PROFILE_NOTES;

/** The note a target's row for a feature carries, or null: web overflow auto and scroll depend on the scrollbar environment (R3). */
export function profileNoteFor(target: Target, feature: string): ProfileNote | null {
  return target === 'web' && /^overflow-[xy]:(auto|scroll)$/.test(feature) ? 'overlayScrollbars' : null;
}

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
