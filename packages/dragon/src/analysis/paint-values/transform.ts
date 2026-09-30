// PNT2: the computed values of transform and transform-origin (lengths in px, as css-transforms-1 §5 and §7 compute them: em and
// rem against the element's font sizes, absolute units by their ratio), and the refusals that depend on where a transform sits in
// the tree: a transform (or will-change: transform) makes its element the containing block of positioned descendants
// (css-transforms-1 §3), which the layout engine does not model yet, so every case where that would move a box is refused.
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Longhand } from '../../css/properties.ts';
import type { TransformFnDecl, TransformLengthDecl, TransformOriginDecl } from '../../css/properties/transform.ts';
import { lengthText, originText, TRANSFORM_LIST_TYPE, TRANSFORM_ORIGIN_TYPE, transformFunctionsOf, transformListText, transformOriginOf, willChangeFeatures } from '../../css/properties/transform.ts';
import { lengthToPx } from '../../css/units.ts';
import type { Diagnostic, Origin } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import type { PaintValueContext, PaintValues } from './types.ts';

/** A declared length in px, or unchanged when its font base is unknown (the font-size pre-pass) or it is a percentage. */
function toPx(l: TransformLengthDecl, ctx: PaintValueContext): TransformLengthDecl {
  if (l.unit === '%' || l.unit === 'px') return l;
  const base = l.unit === 'em' ? ctx.em : l.unit === 'rem' ? ctx.rem : 0;
  if (base === null) return l;
  const px = lengthToPx(l.value, l.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
  return px === null ? l : { value: px, unit: 'px' };
}

/** A function with its lengths in px; the text of a translate function is rewritten from them. */
function computedFunction(f: TransformFnDecl, ctx: PaintValueContext): TransformFnDecl {
  if (f.kind !== 'translate') return f;
  const x = toPx(f.x, ctx);
  const y = toPx(f.y, ctx);
  const text = f.fn === 'translateX' ? `translatex(${lengthText(x)})` : f.fn === 'translateY' ? `translatey(${lengthText(y)})` : `translate(${lengthText(x)}, ${lengthText(y)})`;
  return { ...f, x, y, text };
}

export const TRANSFORM_VALUES: PaintValues = {
  name: 'transform',
  compute: (props, ctx) => {
    const t = props.get('transform');
    if (t !== undefined && t.value.kind === 'other' && t.value.type === TRANSFORM_LIST_TYPE) {
      const text = transformListText(transformFunctionsOf(t.value.text).map((f) => computedFunction(f, ctx)));
      props.set('transform', { ...t, value: { kind: 'other', type: TRANSFORM_LIST_TYPE, text } });
    }
    const o = props.get('transform-origin');
    // The initial value parses as a two-token list ("50% 50%"); every origin gets the one canonical form.
    if (o !== undefined && o.value.kind === 'other') {
      const d = transformOriginOf(o.value.text);
      const text = originText({ x: toPx(d.x, ctx), y: toPx(d.y, ctx) });
      props.set('transform-origin', { ...o, value: { kind: 'other', type: TRANSFORM_ORIGIN_TYPE, text } });
    }
  },
};

/** The computed transform functions of an element; [] for none. */
export function elementTransform(el: ResolvedElement): readonly TransformFnDecl[] {
  const v = (el.props.get('transform') as ResolvedValue).value;
  return v.kind === 'other' && v.type === TRANSFORM_LIST_TYPE ? transformFunctionsOf(v.text) : [];
}

/** The computed transform origin of an element. */
export function elementTransformOrigin(el: ResolvedElement): TransformOriginDecl {
  const v = (el.props.get('transform-origin') as ResolvedValue).value;
  if (v.kind !== 'other') throw new Error(`${el.element.address}: transform-origin did not compute (${v.kind})`);
  return transformOriginOf(v.text);
}

/** The will-change features of an element (transform, opacity). */
export function elementWillChange(el: ResolvedElement): readonly string[] {
  return willChangeFeatures((el.props.get('will-change') as ResolvedValue).value);
}

const keywordOf = (el: ResolvedElement, p: Longhand): string => {
  const v = (el.props.get(p) as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

/** Whether an element's transform or will-change makes it a containing block for positioned descendants (css-transforms-1 §3). */
export function transformsDescendants(el: ResolvedElement): boolean {
  return elementTransform(el).length > 0 || elementWillChange(el).includes('transform');
}

/** Where to report a transform refusal: the transform declaration, else the will-change one, else the element. */
function transformOrigin(el: ResolvedElement): Origin {
  for (const p of ['transform', 'will-change'] as const) {
    const v = el.props.get(p) as ResolvedValue;
    if (v.declaration !== null && (p === 'will-change' ? elementWillChange(el).includes('transform') : elementTransform(el).length > 0)) return authored(v.declaration.valueSpan);
  }
  return el.element.node.origin;
}

/**
 * The refusals of transforms by where they sit, on every target: on html and body (the canvas background and the viewport are
 * not transformed with them), on a box that is not block or flex (css-transforms-1: only transformable boxes), a static
 * transformed element that would become the containing block of an absolutely positioned descendant, and a fixed descendant of a
 * transformed element (POSX-f2). A transform extending a scroll container's scrollable overflow (PNT2-o) needs no check yet:
 * checkOverflow refuses every overflow that scrolls, and Dragon never scrolls an overflow: hidden box; OVFL adds it when it lifts
 * that refusal.
 */
export function checkTransformContexts(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const refuse = (el: ResolvedElement, what: string, message: string, manual: string): void => {
    const origin = transformOrigin(el);
    for (const t of targets) {
      const id = `${t}|transform-${what}|${JSON.stringify(origin)}|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
    }
  };
  const walk = (el: ResolvedElement, transformed: ResolvedElement | null): void => {
    const display = keywordOf(el, 'display');
    if (display === 'none') return;
    const position = keywordOf(el, 'position');
    const own = transformsDescendants(el);
    const address = el.element.address;
    if (own) {
      const tag = el.element.tag;
      if (tag === 'html' || tag === 'body') refuse(el, 'root', `a transform on <${tag}> ${address} is not supported: the canvas background and the viewport do not transform with it`, `Put the transform on an element inside <${tag}>.`);
      if (display !== 'block' && display !== 'flex') refuse(el, 'display', `a transform on ${address} with display: ${display} is not supported: Dragon transforms block and flex boxes`, `Give ${address} display: block or flex.`);
      if (position === 'static') {
        const cb = absoluteDescendant(el);
        if (cb !== null) refuse(el, 'containing-block', `a transform on ${address} makes it the containing block of the absolutely positioned ${cb.element.address} (css-transforms-1 §3), which Dragon's layout does not model yet`, `Set position: relative on ${address}, so it is the containing block with or without the transform.`);
      }
    }
    if (position === 'fixed' && transformed !== null) refuse(transformed, 'fixed', `a transform on ${transformed.element.address} makes it the containing block of the fixed ${address} (css-transforms-1 §3; package POSX-f2)`, `Move ${address} outside ${transformed.element.address}.`);
    for (const c of el.children) if (c.kind === 'element') walk(c, own ? el : transformed);
  };
  walk(root, null);
}

/** An absolutely positioned descendant whose containing block would be el (no positioned or transformed box between them), or null. */
function absoluteDescendant(el: ResolvedElement): ResolvedElement | null {
  for (const c of el.children) {
    if (c.kind !== 'element' || keywordOf(c, 'display') === 'none') continue;
    const position = keywordOf(c, 'position');
    if (position === 'absolute') return c;
    if (position !== 'static' || transformsDescendants(c)) continue;
    const deeper = absoluteDescendant(c);
    if (deeper !== null) return deeper;
  }
  return null;
}

