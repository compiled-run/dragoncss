// Computed box-shadow (css-backgrounds-3 §7.1, css-values-4 §6, css-color-4 §4.4): every shadow length computes to px (em against
// the element's font size, rem against the root's) and currentcolor to the element's computed color, as Chrome 145 serializes it.
import type { Rgba8 } from '../../css/color.ts';
import type { Shadow, ShadowLength } from '../../css/properties/shadow.ts';
import { SHADOW_LIST, shadowsOf, shadowValue } from '../../css/properties/shadow.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../computed.ts';
import { isReplacedTag } from '../elements/replaced.ts';
import type { ResolvedElement } from '../resolve.ts';
import { elementTransform, elementWillChange } from './transform.ts';
import type { PaintCheck, PaintValueContext, PaintValues } from './types.ts';

function computeLength(l: ShadowLength, ctx: PaintValueContext): ShadowLength | null {
  if (l.unit === CANONICAL_LENGTH_UNIT) return l;
  const needs = l.unit === 'em' ? ctx.em : l.unit === 'rem' ? ctx.rem : 0;
  if (needs === null) return null;
  const px = lengthToPx(l.value, l.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
  return px === null ? null : { value: px, unit: CANONICAL_LENGTH_UNIT };
}

const keyword = (el: ResolvedElement, p: 'display' | 'position'): string => {
  const v = (el.props.get(p) as ResolvedValue | undefined)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};

/** The authored box-shadow declaration of an element with at least one shadow, or null. */
function shadowDeclaration(el: ResolvedElement): ResolvedValue | null {
  const v = el.props.get('box-shadow') as ResolvedValue | undefined;
  if (v === undefined || v.declaration === null) return null;
  const shadows = shadowsOf(v.value);
  return shadows !== null && shadows.length > 0 ? v : null;
}

/** A composited group in Chrome (cc raster of its own): a transform, or will-change naming transform or opacity. */
function groupOf(el: ResolvedElement): string | null {
  if (elementTransform(el).length > 0) return 'a transform';
  const w = elementWillChange(el).find((f) => f === 'transform' || f === 'opacity');
  return w === undefined ? null : `will-change: ${w}`;
}

/** Why a shadowed element is refused on a native target, with its fix, or null: what PNT1 does not draw as Chrome does. */
function unshadowed(el: ResolvedElement, t: string): { readonly what: string; readonly message: string; readonly manual: string } | null {
  const tag = el.element.tag;
  const address = el.element.address;
  // css-backgrounds-3 §2.11.2: their background paints the canvas, which the shadow backdrop (dragonShadowBackdrop) does not model.
  if (tag === 'html' || tag === 'body') return { what: 'root', message: `<${tag}> ${address} has a box-shadow, but its background paints the canvas, which ${t}'s shadow backdrop does not model yet`, manual: 'Put the shadow on a wrapper element inside body.' };
  if (isReplacedTag(tag)) return { what: 'replaced', message: `<${tag}> ${address} has a box-shadow; ${t} does not draw shadows of replaced elements yet (no comparison proves them)`, manual: 'Put the shadow on a wrapper element around the image or frame.' };
  // The native runtime places inline box views unpainted (their decorations are INL1b), and Chrome paints one shadow per line fragment.
  if (keyword(el, 'display') === 'inline') return { what: 'inline', message: `<${tag}> ${address} is an inline box with a box-shadow; ${t} does not paint inline boxes until INL1b (inline box decorations), so the shadow would be dropped`, manual: `Move the shadow to a block, or remove it from ${address}, until INL1b.` };
  // Chrome paints a positioned box (and its shadow) after the in-flow content of its stacking context (CSS2 Appendix E); the shadow's
  // companion view sits at the box's tree place, and the stacking sort that would move both (PNT1-effects) is not on this target yet.
  const position = keyword(el, 'position');
  if (position !== 'static') return { what: 'positioned', message: `${address} has a box-shadow and position: ${position}; Chrome paints it after the in-flow content of its stacking context, and ${t} keeps its shadow at its tree place until the stacking sort lands`, manual: `Put the shadow on an in-flow (position: static) element, or remove position from ${address}.` };
  const group = groupOf(el);
  if (group !== null) return { what: 'group', message: `${address} has a box-shadow and ${group}; ${t} draws the outer shadows in a companion view that the box's transform and compositing group do not cover`, manual: `Put the shadow on a wrapper element around ${address}.` };
  return null;
}

/** The shadowed elements below el that generate boxes, in tree order. */
function shadowedBelow(el: ResolvedElement): ResolvedElement[] {
  const out: ResolvedElement[] = [];
  for (const c of el.children) {
    if (c.kind !== 'element' || keyword(c, 'display') === 'none') continue;
    if (shadowDeclaration(c) !== null) out.push(c);
    out.push(...shadowedBelow(c));
  }
  return out;
}

/**
 * A shadow the native targets cannot draw as Chrome does is refused there at its box-shadow declaration: on html and body, on a
 * replaced element, on an inline box, on a positioned box, on a box with a transform or a compositing will-change, and inside such
 * a box (Chrome blits the shadow into the group's own raster, not onto the page backdrop paint-shadow.ts composites over). The web
 * target draws all of them itself.
 */
const checkShadowedElement: PaintCheck = (el, targets, diagnostics, reported) => {
  const refuse = (at: ResolvedElement, why: (t: string) => { readonly what: string; readonly message: string; readonly manual: string } | null): void => {
    const v = shadowDeclaration(at);
    if (v === null || v.declaration === null) return;
    const span = v.declaration.valueSpan;
    for (const t of targets) {
      if (t === 'web') continue;
      const w = why(t);
      if (w === null) continue;
      const id = `${t}|shadow-${w.what}|${span.source.uri}|${span.start}|${at.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(span), target: t, message: w.message, manual: w.manual, basis: 'computed-value' }));
    }
  };
  refuse(el, (t) => unshadowed(el, t));
  const group = groupOf(el);
  if (group === null) return;
  for (const s of shadowedBelow(el)) {
    refuse(s, (t) => ({
      what: 'in-group',
      message: `${s.element.address} has a box-shadow inside ${el.element.address}, whose ${group} makes it a compositing group in Chrome; ${t} composites the shadow onto the page backdrop, which PNT1 does not match inside a group yet`,
      manual: `Move the shadow outside ${el.element.address}, or remove its ${group}.`,
    }));
  }
};

export const SHADOW_VALUES: PaintValues = {
  name: 'shadow',
  check: checkShadowedElement,
  compute: (props, ctx) => {
    const v = props.get('box-shadow');
    if (v === undefined || v.value.kind !== 'other' || v.value.type !== SHADOW_LIST) return;
    const colorValue = props.get('color')?.value;
    const own: Rgba8 | null = colorValue !== undefined && colorValue.kind === 'color' ? colorValue.value : null;
    const shadows = shadowsOf(v.value);
    if (shadows === null) return;
    const out: Shadow[] = [];
    for (const s of shadows) {
      const [x, y, blur, spread] = [s.x, s.y, s.blur, s.spread].map((l) => computeLength(l, ctx));
      // The font-size pre-pass has no font sizes and no color yet: it leaves the value as written.
      if (x == null || y == null || blur == null || spread == null) return;
      if (s.color === 'currentcolor' && own === null) return;
      out.push({ color: s.color === 'currentcolor' ? (own as Rgba8) : s.color, x, y, blur, spread, inset: s.inset });
    }
    props.set('box-shadow', { ...v, value: shadowValue(out) });
  },
};
