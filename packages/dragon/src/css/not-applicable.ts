// NA-NATIVE: how the refusal of a property on profiles/not-applicable-native.ts becomes per-target. The parse driver marks the
// target-less refusal; splitNotApplicable then scopes it to the web target and adds a DRAGON_NOT_APPLICABLE_NATIVE info per native target.
import { diagnostic } from '../diagnostics/catalogue.ts';
import type { NotApplicableEntry } from '../profiles/not-applicable-native.ts';
import type { Diagnostic } from '../types.ts';

const MARKS = new WeakMap<Diagnostic, NotApplicableEntry>();

export function markNotApplicable(d: Diagnostic, entry: NotApplicableEntry): void {
  MARKS.set(d, entry);
}

/** The listed entry of a target-less refusal the parse driver marked, or null. */
export function notApplicableMark(d: Diagnostic): NotApplicableEntry | null {
  return d.target === null ? (MARKS.get(d) ?? null) : null;
}

const NATIVE = ['ios', 'android'] as const;

/**
 * Scopes every marked refusal to web and reports each listed property once per configured native target. A project without a native
 * target keeps the refusals as they are.
 */
export function splitNotApplicable(diagnostics: readonly Diagnostic[], targets: readonly string[]): Diagnostic[] {
  const native = NATIVE.filter((t) => targets.includes(t));
  if (native.length === 0) return [...diagnostics];
  const web = targets.includes('web');
  return diagnostics.flatMap((d) => {
    const entry = notApplicableMark(d);
    if (entry === null) return [d];
    const out: Diagnostic[] = web ? [{ ...d, target: 'web' }] : [];
    for (const t of native) out.push(diagnostic('DRAGON_NOT_APPLICABLE_NATIVE', { origin: d.origin, target: t, message: `${entry.name} has no effect on ${t}: ${entry.reason}; the ${t} output leaves it out` }));
    return out;
  });
}
