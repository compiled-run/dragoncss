// NA-NATIVE: how a refusal of an entry of profiles/not-applicable-native.ts becomes per-target. The parse driver marks the target-less
// refusal of a listed property or pseudo-element rule (and the refusals inside such a rule); splitNotApplicable then scopes each
// marked refusal to the web target, and adds a DRAGON_NOT_APPLICABLE_NATIVE info per native target for the listed item itself.
import type { CssNode } from 'css-tree';
import { diagnostic } from '../diagnostics/catalogue.ts';
import type { NotApplicableEntry } from '../profiles/not-applicable-native.ts';
import { notApplicableEntry } from '../profiles/not-applicable-native.ts';
import type { Diagnostic, Span } from '../types.ts';
import { list, spanOf } from './ast.ts';
import { asciiLower } from './escapes.ts';

/** 'item': the refusal of the listed property or rule itself; 'inside': a refusal inside a listed rule, which native never reads. */
type Mark = { readonly entry: NotApplicableEntry; readonly role: 'item' | 'inside' };

const MARKS = new WeakMap<Diagnostic, Mark>();

export function markNotApplicable(d: Diagnostic, entry: NotApplicableEntry, role: Mark['role']): void {
  MARKS.set(d, { entry, role });
}

/** The mark of a target-less refusal the parse driver made, or null. */
export function notApplicableMark(d: Diagnostic): Mark | null {
  return d.target === null ? (MARKS.get(d) ?? null) : null;
}

/**
 * The listed pseudo-element entry of each refusal of a style rule whose selector list was refused, when every selector of the list
 * ends in a listed pseudo-element and the refusals are exactly those pseudo-elements; otherwise null (the rule stays refused).
 */
export function notApplicableRule(prelude: CssNode, base: Span, refusals: readonly Diagnostic[]): NotApplicableEntry[] | null {
  const selectors = list(prelude, 'children');
  if (selectors.length === 0 || refusals.length !== selectors.length) return null;
  const entries: NotApplicableEntry[] = [];
  for (const [i, sel] of selectors.entries()) {
    const parts = list(sel, 'children');
    const pseudos = parts.filter((n) => n.type === 'PseudoElementSelector');
    const pseudo = pseudos[0];
    if (pseudos.length !== 1 || pseudo === undefined || pseudo['children'] !== null || parts.at(-1) !== pseudo) return null;
    const entry = notApplicableEntry('pseudo-element', asciiLower(String(pseudo['name'])));
    const r = refusals[i] as Diagnostic;
    const at = spanOf(pseudo, base);
    if (entry === null || r.code !== 'DRAGON_UNSUPPORTED_SELECTOR' || r.origin.kind !== 'authored' || r.origin.span.start !== at.start || r.origin.span.end !== at.end) return null;
    entries.push(entry);
  }
  return entries;
}

/** A positive length written as a plain number and unit, such as 5px; anything else could hide the scrollbar or need resolving. */
const POSITIVE_LENGTH = /^(?:\d+\.?\d*|\.\d+)(?:px|em|rem)$/i;

/**
 * Whether a scrollbar pseudo-element rule may hide the scrollbar (display, visibility, or a width or height that is not a positive
 * length): hiding it is visible on native too (like scrollbar-width: none), so such a rule is not on the list.
 */
export function scrollbarRuleMayHide(declarations: readonly { readonly property: string; readonly text: string }[]): boolean {
  return declarations.some((d) => d.property === 'display' || d.property === 'visibility'
    || ((d.property === 'width' || d.property === 'height') && !(POSITIVE_LENGTH.test(d.text.trim()) && Number.parseFloat(d.text) > 0)));
}

const NATIVE = ['ios', 'android'] as const;

/**
 * Scopes every marked refusal to web and reports each listed item once per configured native target. A project without a native
 * target keeps the refusals as they are.
 */
export function splitNotApplicable(diagnostics: readonly Diagnostic[], targets: readonly string[]): Diagnostic[] {
  const native = NATIVE.filter((t) => targets.includes(t));
  if (native.length === 0) return [...diagnostics];
  const web = targets.includes('web');
  return diagnostics.flatMap((d) => {
    const mark = notApplicableMark(d);
    if (mark === null) return [d];
    const out: Diagnostic[] = web ? [{ ...d, target: 'web' }] : [];
    if (mark.role === 'item') {
      const { entry } = mark;
      const what = entry.kind === 'property' ? entry.name : `the ::${entry.name} rule`;
      for (const t of native) out.push(diagnostic('DRAGON_NOT_APPLICABLE_NATIVE', { origin: d.origin, target: t, message: `${what} has no effect on ${t}: ${entry.reason}; the ${t} output leaves it out` }));
    }
    return out;
  });
}
