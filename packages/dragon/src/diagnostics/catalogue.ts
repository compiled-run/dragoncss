// The diagnostic catalogue (docs/api.md §6.1): one entry per code with its severity, message, reason and fix kind, gathered from
// each feature's diagnostics/codes/<feature>.ts. Diagnostics take their severity, why and fix kind from here; only the located detail
// varies per diagnostic.
import type { Diagnostic, Fix, Origin, ProofRef, Span } from '../types.ts';
import type { DiagnosticCode } from './codes.ts';
import { DIAGNOSTIC_FEATURE_ORDER, DIAGNOSTIC_FEATURES } from './codes.ts';
import type { CatalogueEntry } from './entry.ts';

export type { CatalogueEntry, CatalogueFix } from './entry.ts';

/** Every feature's entries (diagnostics/codes/<feature>.ts), in code order. */
export const CATALOGUE: { readonly [C in DiagnosticCode]: CatalogueEntry } = Object.assign({}, ...DIAGNOSTIC_FEATURE_ORDER.map((id) => DIAGNOSTIC_FEATURES[id].catalogue)) as { readonly [C in DiagnosticCode]: CatalogueEntry };

export type DiagnosticInit = {
  readonly origin: Origin;
  readonly message: string;
  readonly target?: string | null;
  readonly related?: readonly { readonly origin: Origin; readonly message: string }[];
  /** Required for edit codes: the guarded span edits. */
  readonly edits?: readonly { readonly span: Span; readonly replacement: string }[];
  /** Replaces the catalogue's manual instruction with a located one. */
  readonly manual?: string;
  /** 'computed-value' for a refusal of a computed value: the diagnostic takes the catalogue's computedWhy. */
  readonly basis?: 'profile' | 'computed-value';
  readonly profile?: ProofRef | null;
};

/** Builds a diagnostic from its catalogue entry; the fix kind always matches the catalogue. */
export function diagnostic(code: DiagnosticCode, init: DiagnosticInit): Diagnostic {
  const entry = CATALOGUE[code];
  let fix: Fix;
  if (entry.fix.kind === 'edit') {
    if (init.edits === undefined || init.edits.length === 0) throw new Error(`${code} needs guarded edits`);
    fix = { title: entry.fix.title, edits: init.edits };
  } else {
    fix = { title: entry.fix.title, manual: init.manual === undefined ? entry.fix.manual : init.manual };
  }
  return {
    code,
    severity: entry.severity,
    target: init.target === undefined ? null : init.target,
    origin: init.origin,
    message: init.message,
    why: init.basis === 'computed-value' ? computedWhyOf(code) : entry.why,
    related: init.related === undefined ? [] : init.related,
    fix,
    profile: init.profile === undefined ? null : init.profile,
  };
}

export const authored = (span: Span): Origin => ({ kind: 'authored', span });
export const unlocated = (reason: string): Origin => ({ kind: 'unlocated', reason });

function computedWhyOf(code: DiagnosticCode): string {
  const w = CATALOGUE[code].computedWhy;
  if (w === null) throw new Error(`${code} has no computed-value why in the catalogue`);
  return w;
}
