// Text decorations (TDEC-a, notes/T148J-tdec.md): the a:any-link UA rule and the decorations each text leaf draws. Propagation is
// written from css-text-decor-3 §2.1 (Blink's style_adjuster.cc and computed_style.cc are LGPL and are behaviour references only)
// and checked against Chrome by the decoration capture: a decoration propagates to in-flow block children, inline boxes and flex
// items, and never into out-of-flow boxes; atomic inlines (which take none either) have no Chrome case yet and are refused.
import type { CssValue } from '../css/values.ts';
import type { DecorationLine } from '../css/properties/text-decoration.ts';
import { DECORATION_LINES } from '../css/properties/text-decoration.ts';
import type { Longhand } from '../css/properties.ts';
/** The propagation plant: decorations reach absolutely positioned descendants too (css-text-decor-3 §2.1 says they do not). */
export type DecorationAnalysisFaults = { readonly propagatedIntoOutOfFlow: boolean };
export const NO_DECORATION_ANALYSIS_FAULTS: DecorationAnalysisFaults = { propagatedIntoOutOfFlow: false };
import type { Rgba8 } from '../css/color.ts';
import { TRANSPARENT } from '../css/color.ts';
import { usedColors } from '../lower/native-program.ts';
import type { Assignment } from '../types.ts';
import type { UaDataset } from '../ua/datasets.ts';
import type { ResolvedValue } from './computed.ts';
import { parseValueText, textFontOfProps, valueToString } from './computed.ts';
import type { LinkedElement } from './link.ts';
import type { ResolvedElement } from './resolve.ts';
import { caseByAssignment, internalRecord } from '../project.ts';

/** An a element with an href is a hyperlink (HTML §4.6.1): :any-link matches it, and :visited never does in Dragon. */
export const isAnyLink = (el: LinkedElement): boolean => el.tag === 'a' && el.attributes.has('href');

/**
 * html.css:1501-1505: a:-webkit-any-link { color: -webkit-link; text-decoration: underline }. Each longhand no author declaration
 * set takes the captured value (UaDataset.anyLink). An element that is not a hyperlink is left untouched.
 */
export function applyAnyLink(el: LinkedElement, props: Map<Longhand, ResolvedValue>, defaulted: ReadonlySet<Longhand>, ua: UaDataset): void {
  if (!isAnyLink(el)) return;
  const none = { span: null, declaration: null, declared: null, losing: [] } as const;
  const dir = valueToString((props.get('direction') as ResolvedValue).value) === 'rtl' ? 'rtl' : 'ltr';
  if (defaulted.has('color')) props.set('color', { value: parseValueText('color', ua.anyLink.color[dir]), origin: 'user-agent', ...none });
  if (defaulted.has('text-decoration-line')) props.set('text-decoration-line', { value: parseValueText('text-decoration-line', ua.anyLink.line), origin: 'user-agent', ...none });
}

/** One decoration a text leaf draws: its decorating box's lines, style, colour, thickness, underline offset and font. */
export type AppliedDecoration = {
  /** The decorating box: the element whose text-decoration-line set these lines. */
  readonly box: string;
  readonly lines: readonly DecorationLine[];
  readonly style: string;
  /** The used colour (currentcolor resolved against the decorating box's color). */
  readonly color: Rgba8;
  /** auto, or a computed px length or percentage of the decorating box's font size, as text. */
  readonly thickness: CssValue;
  readonly underlineOffset: CssValue;
  readonly skipInk: string;
  /** The decorating box's computed font (text_decoration_info.cc:205-255: the decoration's font is the decorating box's). */
  readonly font: { readonly family: string; readonly size: number; readonly weight: number; readonly style: string };
};

/** How a child of a decorated element takes part in its formatting context, for propagation (css-text-decor-3 §2.1). */
export type PropagationContext = 'block' | 'inline' | 'flex-item' | 'out-of-flow' | 'unproven';

const keyword = (el: ResolvedElement, p: Longhand): string => valueToString((el.props.get(p) as ResolvedValue).value);

/** The context of child in parent, judged on the computed values. */
export function propagationContext(child: ResolvedElement, parent: ResolvedElement): PropagationContext {
  const position = keyword(child, 'position');
  if (position === 'absolute') return 'out-of-flow';
  if (position === 'fixed' || position === 'sticky') return 'unproven';
  const display = keyword(child, 'display');
  if (display === 'inline') return 'inline';
  // An atomic inline takes no decoration (§2.1), but no Chrome case lays one out natively yet, so it is unproven.
  if (display === 'inline-flex' || display === 'inline-block' || display === 'inline-grid') return 'unproven';
  if (keyword(parent, 'display') === 'flex' || keyword(parent, 'display') === 'inline-flex') return display === 'block' || display === 'flex' ? 'flex-item' : 'unproven';
  return display === 'block' || display === 'flex' ? 'block' : 'unproven';
}

/** The decorations of one element of its own, or null when its text-decoration-line is none. */
function ownDecoration(el: ResolvedElement, colorOf: (el: ResolvedElement) => Rgba8): AppliedDecoration | null {
  const line = keyword(el, 'text-decoration-line');
  if (line === 'none') return null;
  const lines = DECORATION_LINES.filter((l) => line.split(' ').includes(l));
  const c = (el.props.get('text-decoration-color') as ResolvedValue).value;
  const color = c.kind === 'color' ? c.value : c.kind === 'keyword' && c.value === 'transparent' ? TRANSPARENT : colorOf(el);
  const font = textFontOfProps(el.props);
  const size = (el.props.get('font-size') as ResolvedValue).value;
  return {
    box: el.element.address,
    lines,
    style: keyword(el, 'text-decoration-style'),
    color,
    thickness: (el.props.get('text-decoration-thickness') as ResolvedValue).value,
    underlineOffset: (el.props.get('text-underline-offset') as ResolvedValue).value,
    skipInk: keyword(el, 'text-decoration-skip-ink'),
    font: { family: keyword(el, 'font-family'), size: size.kind === 'length' ? size.value : Number.NaN, weight: font.weight, style: valueToString((el.props.get('font-style') as ResolvedValue).value) },
  };
}

export type DecorationAnalysis = {
  /** Every laid-out text leaf with a non-empty list, outermost decorating box first. */
  readonly applied: ReadonlyMap<string, readonly AppliedDecoration[]>;
  /** Children of a decorated element in a context no Chrome case proves: the child's address and its context. */
  readonly unproven: readonly { readonly address: string; readonly box: string }[];
};

/**
 * css-text-decor-3 §2.1: each text leaf's applied decorations. colorOf gives an element's used color (currentcolor of
 * text-decoration-color). The propagatedIntoOutOfFlow plant propagates into absolutely positioned boxes as well.
 */
export function analyzeDecorations(root: ResolvedElement, colorOf: (el: ResolvedElement) => Rgba8 = (el) => usedColors(el).color, faults: DecorationAnalysisFaults = NO_DECORATION_ANALYSIS_FAULTS): DecorationAnalysis {
  const applied = new Map<string, readonly AppliedDecoration[]>();
  const unproven: { address: string; box: string }[] = [];
  const walk = (el: ResolvedElement, inherited: readonly AppliedDecoration[]): void => {
    if (keyword(el, 'display') === 'none') return;
    const own = ownDecoration(el, colorOf);
    const list = own === null ? inherited : [...inherited, own];
    for (const c of el.children) {
      if (c.kind === 'text') {
        if (list.length > 0) applied.set(c.node.address, list);
        continue;
      }
      const context = propagationContext(c, el);
      if (list.length > 0 && context === 'unproven') unproven.push({ address: c.element.address, box: (list[list.length - 1] as AppliedDecoration).box });
      const propagates = context === 'block' || context === 'inline' || context === 'flex-item' || (context === 'out-of-flow' && faults.propagatedIntoOutOfFlow);
      walk(c, propagates ? list : []);
    }
  };
  walk(root, []);
  return { applied, unproven };
}

/** The decorations of a compiled case (null when it did not resolve), for the decoration capture. */
export function appliedDecorationsOf(compiled: object, assignment: Assignment, faults: DecorationAnalysisFaults = NO_DECORATION_ANALYSIS_FAULTS): DecorationAnalysis | null {
  const record = internalRecord(compiled);
  const c = record === undefined ? undefined : caseByAssignment(record, assignment);
  return c === undefined || c.resolved === null ? null : analyzeDecorations(c.resolved, undefined, faults);
}
