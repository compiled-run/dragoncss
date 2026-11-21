// NA-NATIVE: how the refusal of a property on profiles/not-applicable-native.ts becomes per-target. The parse driver marks the
// target-less refusal; splitNotApplicable then scopes it to the web target and adds a DRAGON_NOT_APPLICABLE_NATIVE info per native target.
// BROWSER-ONLY: a marked refusal of an at-rule on profiles/browser-only-native.ts is scoped to web the same way, and each native
// target gets a DRAGON_BROWSER_ONLY_NATIVE error instead.
import { diagnostic } from '../diagnostics/catalogue.ts';
import type { BrowserOnlyEntry } from '../profiles/browser-only-native.ts';
import type { NotApplicableEntry } from '../profiles/not-applicable-native.ts';
import { notApplicableSentence } from '../profiles/not-applicable-native.ts';
import type { Diagnostic } from '../types.ts';

const MARKS = new WeakMap<Diagnostic, NotApplicableEntry>();
const BROWSER_ONLY_MARKS = new WeakMap<Diagnostic, BrowserOnlyEntry>();

export function markBrowserOnly(d: Diagnostic, entry: BrowserOnlyEntry): void {
  BROWSER_ONLY_MARKS.set(d, entry);
}

/** The DRAGON_BROWSER_ONLY_NATIVE error of a browser-only entry on one native target. */
export function browserOnlyDiagnostic(entry: BrowserOnlyEntry, origin: Diagnostic['origin'], target: string, what: string): Diagnostic {
  return diagnostic('DRAGON_BROWSER_ONLY_NATIVE', { origin, target, message: `${what} cannot build for ${target}: ${entry.reason}`, manual: `Remove ${entry.name} from the ${target} build, or move it to a stylesheet only the web target compiles.` });
}

export function markNotApplicable(d: Diagnostic, entry: NotApplicableEntry): void {
  MARKS.set(d, entry);
}

/** The listed entry of a target-less refusal the parse driver marked, or null. */
export function notApplicableMark(d: Diagnostic): NotApplicableEntry | null {
  return d.target === null ? (MARKS.get(d) ?? null) : null;
}

const NATIVE = ['ios', 'android'] as const;

/**
 * Scopes every marked refusal to web and reports each listed property or at-rule once per configured native target. A project without a native
 * target keeps the refusals as they are.
 */
export function splitNotApplicable(diagnostics: readonly Diagnostic[], targets: readonly string[]): Diagnostic[] {
  const native = NATIVE.filter((t) => targets.includes(t));
  if (native.length === 0) return [...diagnostics];
  const web = targets.includes('web');
  return diagnostics.flatMap((d) => {
    const only = d.target === null ? (BROWSER_ONLY_MARKS.get(d) ?? null) : null;
    if (only !== null) return [...(web ? [{ ...d, target: 'web' }] : []), ...native.map((t) => browserOnlyDiagnostic(only, d.origin, t, only.name))];
    const entry = notApplicableMark(d);
    if (entry === null) return [d];
    const out: Diagnostic[] = web ? [{ ...d, target: 'web' }] : [];
    for (const t of native) out.push(diagnostic('DRAGON_NOT_APPLICABLE_NATIVE', { origin: d.origin, target: t, message: `${notApplicableSentence(entry, t)}; the ${t} output leaves it out` }));
    return out;
  });
}

const spanKey = (d: Diagnostic): string | null => (d.origin.kind === 'authored' ? `${d.code}|${d.target}|${d.origin.span.source.uri}|${d.origin.span.start}|${d.origin.span.end}` : null);

/** The value check's diagnostics without a DRAGON_BROWSER_ONLY_NATIVE that the analysis already reported for the same target and span. */
export function withoutRepeatedBrowserOnly(values: readonly Diagnostic[], reported: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set(reported.filter((d) => d.code === 'DRAGON_BROWSER_ONLY_NATIVE').map(spanKey));
  return values.filter((d) => d.code !== 'DRAGON_BROWSER_ONLY_NATIVE' || spanKey(d) === null || !seen.has(spanKey(d)));
}
