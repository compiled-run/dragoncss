// NA-NATIVE ::-webkit-scrollbar (notes/PM-2026-10-04.md, deferred there): the rules that hide a scroll container's scrollbar. In
// Chrome 145 a ::-webkit-scrollbar rule on an element turns its scrollbars into custom ones: display: none removes both, and a zero
// width (vertical) or height (horizontal) removes that one; either way no gutter is reserved and nothing is drawn, exactly as with
// scrollbar-width: none. An unset thickness keeps the platform's (15px classic), and any other value draws a custom scrollbar in
// the gutter it reserves, which the overlay-scrollbar layout does not model. scrollbar-width other than auto makes Chrome ignore
// every ::-webkit-scrollbar rule (so does scrollbar-color, which native leaves out by owner ruling, profiles/not-applicable-native.ts).
// So when the matching rules of a scroll container hide every scrollbar it can show, the web output writes ::-webkit-scrollbar
// { display: none } on its class (emit/web-css.ts) and native hides its scroll indicators (lower/paint/scroll.ts), both reading the
// verdict webkit-scrollbar-state.ts records. Its -thumb, -track and other part rules then style nothing. Every other matching
// scrollbar rule on a scroll container is refused on every target; on a box that is no scroll container they style nothing.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { ScrollbarPseudo, Selector } from '../css/selectors.ts';
import type { Longhand } from '../css/properties.ts';
import type { Declaration, Rule } from '../css/stylesheet.ts';
import type { CssValue } from '../css/values.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Diagnostic, Span } from '../types.ts';
import { selectorIsInteractive } from './interaction.ts';
import type { LinkedElement } from './link.ts';
import { scrollbarSelectorMatches } from './match.ts';
import { recordScrollbarVerdict, scrollbarVerdict } from './webkit-scrollbar-state.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

/** The scrollbar rules that reach an element: hidden, with the declaration that hides it; refused, with why; or none. */
export type ScrollbarStyle =
  | { readonly kind: 'none' }
  | { readonly kind: 'hidden'; readonly declaration: Declaration }
  | { readonly kind: 'refused'; readonly span: Span; readonly message: string };

const isZero = (v: CssValue): boolean => (v.kind === 'length' || v.kind === 'percentage') && v.value === 0;
const keyword = (v: CssValue): string | null => (v.kind === 'keyword' ? v.value : null);

const pseudoOf = (sel: Selector): ScrollbarPseudo | null => (sel.pseudoElement !== null && sel.pseudoElement.kind === 'scrollbar' ? sel.pseudoElement.name : null);

/** Whether any rule names a scrollbar pseudo-element, so elements need no scan otherwise. */
export const hasScrollbarRules = (rules: readonly Rule[]): boolean => rules.some((r) => r.selectors.some((s) => pseudoOf(s) !== null));

/**
 * The ::-webkit-scrollbar style of the element chain[chain.length - 1], which scrolls on x and y (auto or scroll), under the
 * matching rules. Hidden only when every axis it scrolls on loses its scrollbar and no matching declaration could bring one back.
 */
export function scrollbarStyleOf(rules: readonly Rule[], chain: readonly LinkedElement[], x: boolean, y: boolean, faults: CompilerFaults): ScrollbarStyle {
  const bar: { span: Span; declaration: Declaration }[] = [];
  let part: Span | null = null;
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      const pseudo = pseudoOf(sel);
      if (pseudo === null || !scrollbarSelectorMatches(rule, sel, chain, faults)) continue;
      const span = (sel.pseudoElement as { span: Span }).span;
      if (selectorIsInteractive(sel)) return { kind: 'refused', span, message: 'a ::-webkit-scrollbar rule that depends on :hover, :active or :focus is unsupported' };
      if (rule.condition !== undefined) return { kind: 'refused', span, message: 'a ::-webkit-scrollbar rule inside @media is unsupported' };
      if (pseudo === '-webkit-scrollbar') for (const d of rule.declarations) bar.push({ span, declaration: d });
      else part ??= span;
      break;
    }
  }
  if (bar.length === 0) return part === null ? { kind: 'none' } : { kind: 'refused', span: part, message: 'a ::-webkit-scrollbar part rule styles the custom scrollbar Chrome draws, which Dragon does not draw' };
  let none: Declaration | null = null;
  let width: Declaration | null = null;
  let height: Declaration | null = null;
  // A thickness that draws a scrollbar, refused unless display: none removes the scrollbar anyway.
  let drawn: Declaration | null = null;
  for (const { declaration: d } of bar) {
    if (d.pending !== undefined || d.custom !== undefined) return { kind: 'refused', span: d.span, message: `${d.property}: ${d.text} in a ::-webkit-scrollbar rule is unsupported: only display: none and a zero width or height, which hide the scrollbar, are` };
    for (const l of d.longhands) {
      const v = l.value;
      if (l.property === 'display' && keyword(v) !== 'none') return { kind: 'refused', span: d.span, message: `${d.property}: ${d.text} in a ::-webkit-scrollbar rule is unsupported: only display: none and a zero width or height, which hide the scrollbar, are` };
      if (l.property === 'display') none ??= d;
      else if (l.property === 'width' && isZero(v)) width ??= d;
      else if (l.property === 'height' && isZero(v)) height ??= d;
      else if (l.property === 'width' || l.property === 'height') drawn ??= d;
    }
  }
  if (none === null && drawn !== null) {
    return { kind: 'refused', span: drawn.span, message: `${drawn.property}: ${drawn.text} in a ::-webkit-scrollbar rule draws a custom scrollbar in a gutter it reserves, which Dragon does not draw; only display: none and a zero width or height, which hide it, are supported` };
  }
  if (none !== null) return { kind: 'hidden', declaration: none };
  const at = width ?? height;
  if (at !== null && (!y || width !== null) && (!x || height !== null)) return { kind: 'hidden', declaration: at };
  return { kind: 'refused', span: (bar[0] as { span: Span }).span, message: `a ::-webkit-scrollbar rule that leaves the ${y && width === null ? 'vertical' : 'horizontal'} scrollbar at its platform thickness makes it a custom scrollbar in a gutter it reserves, which Dragon does not draw; hide it with display: none, or a zero width and height` };
}

const scrolls = (v: ResolvedValue): boolean => v.value.kind === 'keyword' && (v.value.value === 'auto' || v.value.value === 'scroll');

/**
 * Records, for the element chain[chain.length - 1] with its props after computeOverflowPair, whether its ::-webkit-scrollbar rules
 * hide its scrollbars (scrollbar-width auto only: any other value makes Chrome ignore them) or are refused. A box that scrolls on
 * neither axis is read as if it scrolled on both, so the web output hides the scrollbar in every band where it does scroll; its
 * rules are refused only where it scrolls.
 */
export function applyWebkitScrollbar(props: ReadonlyMap<Longhand, ResolvedValue>, chain: readonly LinkedElement[], rules: readonly Rule[], faults: CompilerFaults): void {
  const width = props.get('scrollbar-width') as ResolvedValue;
  if (width.value.kind !== 'keyword' || width.value.value !== 'auto') return;
  const x = scrolls(props.get('overflow-x') as ResolvedValue);
  const y = scrolls(props.get('overflow-y') as ResolvedValue);
  const style = scrollbarStyleOf(rules, chain, x || !y, y || !x, faults);
  if (style.kind === 'hidden') recordScrollbarVerdict(props, { kind: 'hidden' });
  else if (style.kind === 'refused' && (x || y)) recordScrollbarVerdict(props, { kind: 'refused', span: style.span, message: style.message });
}

/** Refuses, on every target, the scrollbar rules that would draw a custom scrollbar on the scroll container el (applyWebkitScrollbar). */
export function checkWebkitScrollbar(el: ResolvedElement, diagnostics: Diagnostic[], reported: Set<string>): void {
  const r = scrollbarVerdict(el);
  if (r === null || r.kind !== 'refused') return;
  const id = `webkit-scrollbar|${JSON.stringify(r.span)}|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', { origin: authored(r.span), message: `${r.message} (on the scroll container ${el.element.address})`, manual: 'Hide the scrollbar with ::-webkit-scrollbar { display: none } or scrollbar-width: none, or remove the rule.' }));
}
