// The north star's per-declaration support accounting (examples/music-player/tools/check.ts). A declaration is blocked on a target
// when an error for that target (or for every target) lands on it, on its rule's selector, or is an unsupported-at-rule diagnostic
// on its enclosing at-rule; otherwise not-applicable when a DRAGON_NOT_APPLICABLE_NATIVE info for that target lands there (NA-NATIVE);
// otherwise supported. Not-applicable declarations are counted on their own and left out of the denominator, never as supported.

type Span = { readonly start: number; readonly end: number };

export type AccountedDeclaration = { readonly span: Span; readonly selectorSpan: Span; readonly atRuleSpan: Span | null };

export type AccountedDiagnostic = {
  readonly code: string;
  readonly severity: string;
  readonly target: string | null;
  /** The diagnostic's stylesheet span, or null when it is not located in the stylesheet. */
  readonly css: Span | null;
};

export const ACCOUNTED_TARGETS = ['web', 'ios', 'android'] as const;
export type AccountedTarget = (typeof ACCOUNTED_TARGETS)[number];
export type DeclarationStatus = 'supported' | 'blocked' | 'not-applicable';

const overlaps = (a: Span, b: Span): boolean => b.start < a.end && b.end > a.start;
const applies = (target: string | null, t: AccountedTarget): boolean => target === null || target === t;

/** The diagnostics landing on a declaration (its span, its selector, or the unsupported at-rule around it). */
export function hitsOf(decl: AccountedDeclaration, diagnostics: readonly AccountedDiagnostic[]): AccountedDiagnostic[] {
  return diagnostics.filter((d) => d.css !== null && (overlaps(decl.span, d.css) || overlaps(decl.selectorSpan, d.css)
    || (d.code === 'DRAGON_UNSUPPORTED_AT_RULE' && decl.atRuleSpan !== null && d.css.start === decl.atRuleSpan.start)));
}

export function statusOn(hits: readonly AccountedDiagnostic[], t: AccountedTarget): DeclarationStatus {
  if (hits.some((d) => d.severity === 'error' && applies(d.target, t))) return 'blocked';
  // The compiler reports the info only for a native target; one for every target would be a compiler bug, so it is not trusted.
  if (hits.some((d) => d.code === 'DRAGON_NOT_APPLICABLE_NATIVE' && d.severity === 'info' && d.target === t)) return 'not-applicable';
  return 'supported';
}

export type StatusRow = { readonly [T in AccountedTarget]: DeclarationStatus };

/**
 * The support numbers. supportPercent: declarations supported on web and ios over the declarations not-applicable on neither
 * (a declaration on the not-applicable list is left out on every target, so it is neither supported nor in the denominator).
 */
export function supportNumbers(rows: readonly StatusRow[]) {
  const count = (t: AccountedTarget, s: DeclarationStatus): number => rows.filter((r) => r[t] === s).length;
  const notApplicable = rows.filter((r) => r.ios === 'not-applicable' || r.android === 'not-applicable').length;
  const applicable = rows.length - notApplicable;
  const supportedBoth = rows.filter((r) => r.web === 'supported' && r.ios === 'supported').length;
  return {
    declarations: rows.length,
    notApplicableNative: notApplicable,
    notApplicableIos: count('ios', 'not-applicable'),
    notApplicableAndroid: count('android', 'not-applicable'),
    applicableDeclarations: applicable,
    supportedBothTargets: supportedBoth,
    supportedWeb: count('web', 'supported'),
    supportedIos: count('ios', 'supported'),
    supportedAndroid: count('android', 'supported'),
    supportPercent: applicable === 0 ? 0 : Math.round((supportedBoth / applicable) * 1000) / 10,
  };
}
