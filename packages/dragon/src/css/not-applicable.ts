// NA-NATIVE: how a refusal of an entry of profiles/not-applicable-native.ts becomes per-target. The parse driver marks the target-less
// refusal of a listed property, or of a pseudo-element rule whose block is only allowlisted colours and shapes; splitNotApplicable
// then scopes each marked refusal to the web target, and adds a DRAGON_NOT_APPLICABLE_NATIVE info per native target.
import type { CssNode } from 'css-tree';
import { diagnostic } from '../diagnostics/catalogue.ts';
import type { NotApplicableEntry } from '../profiles/not-applicable-native.ts';
import { notApplicableEntry } from '../profiles/not-applicable-native.ts';
import type { Diagnostic, Span } from '../types.ts';
import { list, spanOf } from './ast.ts';
import { asciiLower } from './escapes.ts';
import type { Declaration } from './stylesheet.ts';
import type { CssValue } from './values.ts';
import { tokenValue } from './values.ts';

/** The listed property or pseudo-element rule whose refusal this is. */
type Mark = { readonly entry: NotApplicableEntry };

const MARKS = new WeakMap<Diagnostic, Mark>();

export function markNotApplicable(d: Diagnostic, entry: NotApplicableEntry): void {
  MARKS.set(d, { entry });
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

/** The colour and shape properties a scrollbar pseudo-element rule may set and still be not applicable on native. */
const COSMETIC: ReadonlySet<string> = new Set(['background-color', 'background', 'border-radius', 'border-color', 'color']);

/** A colour that is visible: an opaque or translucent colour, or currentcolor. transparent, alpha 0 and anything unresolved are not. */
function visibleColor(v: CssValue): boolean {
  return (v.kind === 'color' && v.value.alpha > 0) || (v.kind === 'keyword' && v.value === 'currentcolor');
}

/**
 * Whether a scrollbar pseudo-element rule only recolours or reshapes the scrollbar: every declaration is on the allowlist, a
 * background sets only its colour, every colour is visible (a transparent or alpha-0 colour is a hiding idiom) and every radius is
 * a length or percentage. Anything else (a size, display, var(), a CSS-wide keyword) could hide it, which is visible on native.
 */
export function scrollbarRuleIsCosmetic(declarations: readonly Declaration[]): boolean {
  return declarations.every((d) => COSMETIC.has(d.property) && d.pending === undefined && d.custom === undefined && d.longhands.length > 0
    && d.longhands.filter((lh) => lh.explicit).every((lh) => (lh.property.endsWith('color') ? visibleColor(lh.value) : lh.property.endsWith('radius') && (lh.value.kind === 'length' || lh.value.kind === 'percentage')))
    && (d.property !== 'background' || d.longhands.filter((lh) => lh.explicit).every((lh) => lh.property === 'background-color')));
}

/** Whether a scrollbar-color value may hide the scrollbar: anything but auto or two visible colours (transparent thumb or track). */
export function scrollbarColorMayHide(valueNode: CssNode): boolean {
  const tokens = list(valueNode, 'children').filter((n) => n.type !== 'WhiteSpace');
  if (tokens.length === 1 && tokens[0]?.type === 'Identifier' && asciiLower(String(tokens[0]['name'])) === 'auto') return false;
  return tokens.length !== 2 || !tokens.every((t) => {
    const v = tokenValue(t, 'color');
    return typeof v !== 'string' && visibleColor(v);
  });
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
    const { entry } = mark;
    const what = entry.kind === 'property' ? entry.name : `the ::${entry.name} rule`;
    for (const t of native) out.push(diagnostic('DRAGON_NOT_APPLICABLE_NATIVE', { origin: d.origin, target: t, message: `${what} has no effect on ${t}: ${entry.reason}; the ${t} output leaves it out` }));
    return out;
  });
}
