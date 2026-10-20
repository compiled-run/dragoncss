// TXT-FX (compat §5): -webkit-text-stroke. Chrome strokes each glyph outline after filling the text fragment (GraphicsContext
// DrawTextPasses: the fill pass, then a stroke pass with the stroke width, a miter join and miter limit 4) in
// -webkit-text-stroke-color. The web target leaves it to Chrome. The native text view strokes each line's Ahem outlines the same
// way after filling them (native-program.ts text-stroke). It draws what Chrome draws only where checkTextStrokes finds nothing in
// the way: a px width up to TEXT_STROKE_MAX_PX, an opaque stroke colour (Chrome composites each glyph's stroke on its own, the
// device one path per line), upright regular Ahem text without small caps, decoration, text shadow, ellipsis or line clamp, the
// fill painted first, and no box after it in tree order painting a background, border or box shadow (Chrome paints a stacking
// context's text over its block backgrounds; the native views of later boxes are above the stroke that reaches past the glyphs).
// Planted fault textStrokeAccepted accepts every stroke on every target and draws none.
import type { Rgba8 } from '../css/color.ts';
import { paintsStrokeFirst } from '../css/properties/svg-paint-order.ts';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { TxtFillFaults } from '../faults/txt-fill.ts';
import type { Diagnostic } from '../types.ts';
import { synthesizesBold, synthesizesOblique } from './computed.ts';
import { lineClampOf } from './line-clamp.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';
import { analyzeDecorations } from './text-decoration.ts';
import { paintsBox } from './text-shadow.ts';

/** The widest stroke the native targets draw, in css px (text-stroke-ahem draws it). */
export const TEXT_STROKE_MAX_PX = 8;

/** One element's stroke as the native view draws it: the width in css px and an opaque sRGB colour. */
export type TextStrokeValue = { readonly width: number; readonly color: Rgba8 };

const NATIVE = ['ios', 'android'];

const prop = (el: ResolvedElement, p: string): ResolvedValue => {
  const v = (el.props as ReadonlyMap<string, ResolvedValue>).get(p);
  if (v === undefined) throw new Error(`${el.element.address}: ${p} did not resolve`);
  return v;
};
const keyword = (el: ResolvedElement, p: string): string => valueToString(prop(el, p).value);

/** An element's computed stroke width in css px: 0 for none, null for a value other than a px length (a keyword scales with the font in Chrome). */
export function strokeWidthOf(el: ResolvedElement): number | null {
  const v = prop(el, '-webkit-text-stroke-width').value;
  if (v.kind === 'number' && v.value === 0) return 0;
  return v.kind === 'length' && v.unit === 'px' ? v.value : null;
}

/** An element's used stroke colour: -webkit-text-stroke-color, or color where it is currentcolor. */
export function strokeColorOf(el: ResolvedElement): Rgba8 {
  const c = prop(el, '-webkit-text-stroke-color').value;
  const v = c.kind === 'keyword' && c.value === 'currentcolor' ? prop(el, 'color').value : c;
  if (v.kind === 'color') return v.value;
  if (v.kind === 'keyword' && v.value === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 };
  throw new Error(`${el.element.address}: -webkit-text-stroke-color did not resolve to channels`);
}

/** parent: the element whose computed font and stroke the text takes; container: the block container whose lines hold it. */
type Stroked = { readonly text: ResolvedText; readonly parent: ResolvedElement; readonly container: ResolvedElement; readonly clamped: boolean; readonly order: number };

/** Every text drawn with a stroke wider than 0 (or with a width other than px), in tree order, and every box-painting element's tree order. */
function survey(root: ResolvedElement): { readonly stroked: Stroked[]; readonly painters: number[] } {
  const stroked: Stroked[] = [];
  const painters: number[] = [];
  let order = 0;
  const walk = (el: ResolvedElement, outer: ResolvedElement, clampedAbove: boolean): void => {
    if (keyword(el, 'display') === 'none') return;
    const clamped = clampedAbove || lineClampOf(el) !== 0;
    const container = keyword(el, 'display') === 'inline' ? outer : el;
    order++;
    if (el !== root && paintsBox(el)) painters.push(order);
    const width = strokeWidthOf(el);
    for (const c of el.children) {
      if (c.kind === 'element') walk(c, container, clamped);
      else {
        order++;
        if (width !== 0) stroked.push({ text: c, parent: el, container, clamped, order });
      }
    }
  };
  walk(root, root, false);
  return { stroked, painters };
}

/** Why every target refuses a text's stroke, or null. */
function allRefusal(el: ResolvedElement): string | null {
  return strokeWidthOf(el) === null ? `-webkit-text-stroke-width: ${keyword(el, '-webkit-text-stroke-width')} is not a px length` : null;
}

/** Why the native targets refuse a text's stroke, or null when the text view strokes it as Chrome does. */
function nativeRefusal(s: Stroked, painters: readonly number[], decorated: ReadonlySet<string>, realFaceAt: (address: string) => boolean): string | null {
  const { text, parent, container, clamped, order } = s;
  const width = strokeWidthOf(parent) as number;
  if (width > TEXT_STROKE_MAX_PX) return `a stroke ${width}px wide is over the ${TEXT_STROKE_MAX_PX}px the native stroke draws`;
  if (strokeColorOf(parent).alpha !== 255) return 'the stroke colour is not opaque: Chrome composites each glyph\'s stroke on its own, the native view one path per line';
  if (realFaceAt(text.node.address)) return 'the text is in a real face; the native stroke is drawn over Ahem only';
  if (synthesizesBold(parent.props)) return 'the text is drawn in synthetic bold, whose stroke the native view does not combine with this one';
  if (synthesizesOblique(parent.props)) return 'the text is drawn in synthetic oblique, which shears the native stroke with the outline';
  if (keyword(parent, 'font-variant-caps') !== 'normal') return 'the text has small caps, whose runs the native view does not stroke';
  if (paintsStrokeFirst(prop(parent, 'paint-order').value)) return `paint-order: ${keyword(parent, 'paint-order')} strokes before the fill, and the native view fills first`;
  if (keyword(parent, 'text-shadow') !== 'none') return 'the text has a text shadow, which the native shadow draws without the stroke';
  if (decorated.has(text.node.address)) return 'the text is decorated, and the native decorations do not follow the stroke';
  if (keyword(container, 'text-overflow') !== 'clip') return 'the text may end in an ellipsis, which the native view does not stroke';
  if (clamped) return 'the text is inside a -webkit-line-clamp container, whose clamp may end its line in an ellipsis the native view does not stroke';
  if (painters.some((p) => p > order)) return 'a box after the text paints a background, border or box shadow, which Chrome paints beneath the stroke and the native views paint over it';
  return null;
}

/** Refuses each stroked text a target does not draw as Chrome does, once per text and target, at the width's declaration. */
export function checkTextStrokes(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, realFaceAt: (address: string) => boolean, faults: TxtFillFaults): void {
  if (faults.textStrokeAccepted) return;
  const { stroked, painters } = survey(root);
  if (stroked.length === 0) return;
  const decorated = new Set([...analyzeDecorations(root).applied].filter(([, l]) => l.length > 0).map(([a]) => a));
  for (const s of stroked) {
    const all = allRefusal(s.parent);
    const native = all === null ? nativeRefusal(s, painters, decorated, realFaceAt) : null;
    const v = prop(s.parent, '-webkit-text-stroke-width');
    const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : s.text.node.node.origin;
    for (const t of targets) {
      const why = all ?? (NATIVE.includes(t) ? native : null);
      if (why === null) continue;
      const id = `${t}|text-stroke|${s.text.node.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin,
        target: t,
        message: `-webkit-text-stroke-width: ${valueToString(v.value)} over text ${s.text.node.address} is unsupported on ${t}: ${why} (TXT-FX)`,
        manual: all !== null ? 'Give -webkit-text-stroke-width in px.' : `Remove the stroke from the text of ${s.parent.element.address}, or build for web.`,
        basis: 'computed-value',
      }));
    }
  }
}
