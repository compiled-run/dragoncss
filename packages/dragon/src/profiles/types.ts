import type { SupportStatus, Target } from '../types.ts';

/**
 * What a proof covers (docs/api.md §4.1, §7). layout on linux-dragon-layout: Dragon's engine against Chrome's authored boxes.
 * layout or computed-value on chrome-dual: compiled web CSS against authored CSS in Chrome, boxes and getComputedStyle values,
 * plus Dragon's resolved colour channels against Chrome's. computed-value on device-anim (T065 R18): every frame sample's device
 * dump against Chrome's frame capture through the four device checks. No other lane proves native paint in milestone 1.
 */
export type ProofAspect = 'layout' | 'computed-value';
export type ProofLane = 'linux-dragon-layout' | 'chrome-dual' | 'device-anim';

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

/**
 * PNT1 outline: the native targets draw solid and double outlines only, and refuse every other painted style by name
 * (analysis/paint-values/outline.ts checkOutline). A zero-width outline in such a style paints nothing and compiles, but that proves
 * no paint, so a native target claims no row for these styles and the value check leaves them to checkOutline.
 */
export function nativeOutlinePending(feature: string): boolean {
  return /^outline-style:(dotted|dashed|groove|ridge|inset|outset|auto)$/.test(feature);
}

/** The note a target's row for a feature carries, or null: web overflow auto and scroll depend on the scrollbar environment (R3). */
export function profileNoteFor(target: Target, feature: string): ProfileNote | null {
  return target === 'web' && /^overflow-[xy]:(auto|scroll)$/.test(feature) ? 'overlayScrollbars' : null;
}

export type SupportProfile = { readonly target: Target; readonly revision: string; readonly rows: readonly ProfileRow[] };

/** Each frozen row list's rows by feature, in row order; a list that can still change is scanned whole on every lookup. */
const rowIndexes = new WeakMap<readonly ProfileRow[], ReadonlyMap<string, readonly ProfileRow[]>>();
function rowsOf(profile: SupportProfile, feature: string): readonly ProfileRow[] {
  const rows = profile.rows;
  let index = rowIndexes.get(rows);
  if (index === undefined) {
    if (!Object.isFrozen(rows) || !rows.every((r) => Object.isFrozen(r))) return rows.filter((r) => r.feature === feature);
    const built = new Map<string, ProfileRow[]>();
    for (const r of rows) {
      const list = built.get(r.feature);
      if (list === undefined) built.set(r.feature, [r]);
      else list.push(r);
    }
    index = built;
    rowIndexes.set(rows, index);
  }
  return index.get(feature) ?? [];
}

/** Missing data means unsupported (AGENTS.md). */
export function statusOf(profile: SupportProfile, feature: string, context: string): SupportStatus {
  const row = rowsOf(profile, feature).find((r) => r.context === context);
  return row === undefined ? 'unsupported' : row.status;
}

/** The contexts in which a feature has a supported row. */
export function provenContexts(profile: SupportProfile, feature: string): string[] {
  return rowsOf(profile, feature).filter((r) => r.status !== 'unsupported').map((r) => r.context);
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
