// PNT2: the computed values of transform, translate and transform-origin (lengths in px, as css-transforms-1 §5 and §7 compute them: em and
// rem against the element's font sizes, absolute units by their ratio), and the refusals that depend on where a transform sits in
// the tree: a transform (or will-change: transform) makes its element the containing block of positioned descendants
// (css-transforms-1 §3), which the layout engine does not model yet, so every case where that would move a box is refused.
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Longhand } from '../../css/properties.ts';
import type { TransformFnDecl, TransformLengthDecl, TransformOriginDecl } from '../../css/properties/transform.ts';
import { individualTransformOf, INDIVIDUAL_TRANSFORM_TYPE, INDIVIDUAL_TRANSFORMS, inFloatRange, lengthText, originText, skewsBox, TRANSFORM_LIST_TYPE, TRANSFORM_ORIGIN_TYPE, transformFunctionsOf, transformListText, transformOriginOf, willChangeFeatures } from '../../css/properties/transform.ts';
import { filterApplies } from '../../css/properties/filter.ts';
import { hasBackdropFilter } from '../../css/properties/fx.ts';
import { lengthToPx } from '../../css/units.ts';
import type { Diagnostic, Origin } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import type { PaintValueContext, PaintValues } from './types.ts';

/** A declared length in px, or unchanged when its font base is unknown (the font-size pre-pass), it is a percentage or it overflows. */
function toPx(l: TransformLengthDecl, ctx: PaintValueContext): TransformLengthDecl {
  if (l.unit === '%' || l.unit === 'px') return l;
  const base = l.unit === 'em' ? ctx.em : l.unit === 'rem' ? ctx.rem : 0;
  if (base === null) return l;
  const px = lengthToPx(l.value, l.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
  // A px value past the float range (lengths are stored as floats) stays in its unit, so the native lowering blocks on it (lower/paint/transform.ts).
  return px === null || !inFloatRange(px) ? l : { value: px, unit: 'px' };
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
  check: null,
  compute: (props, ctx) => {
    const t = props.get('transform');
    if (t !== undefined && t.value.kind === 'other' && t.value.type === TRANSFORM_LIST_TYPE) {
      const text = transformListText(transformFunctionsOf(t.value.text).map((f) => computedFunction(f, ctx)));
      props.set('transform', { ...t, value: { kind: 'other', type: TRANSFORM_LIST_TYPE, text } });
    }
    const tr = props.get('translate');
    if (tr !== undefined && tr.value.kind === 'other' && tr.value.type === INDIVIDUAL_TRANSFORM_TYPE) {
      const f = individualTransformOf('translate', tr.value.text);
      if (f.kind === 'translate') props.set('translate', { ...tr, value: { kind: 'other', type: INDIVIDUAL_TRANSFORM_TYPE, text: `${lengthText(toPx(f.x, ctx))} ${lengthText(toPx(f.y, ctx))}` } });
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

/** The functions of an element's translate, rotate and scale, in that order (css-transforms-2 §4); [] where all are none. */
export function elementIndividualTransforms(el: ResolvedElement): readonly TransformFnDecl[] {
  return INDIVIDUAL_TRANSFORMS.flatMap((p) => {
    const v = (el.props.get(p) as ResolvedValue).value;
    return v.kind === 'other' && v.type === INDIVIDUAL_TRANSFORM_TYPE ? [individualTransformOf(p, v.text)] : [];
  });
}

/** The computed transform functions of an element: translate, rotate and scale, then transform (css-transforms-2 §4); [] for none. */
export function elementTransform(el: ResolvedElement): readonly TransformFnDecl[] {
  const v = (el.props.get('transform') as ResolvedValue).value;
  return [...elementIndividualTransforms(el), ...(v.kind === 'other' && v.type === TRANSFORM_LIST_TYPE ? transformFunctionsOf(v.text) : [])];
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

/**
 * Whether an element's perspective is not none. With Dragon's 2D transforms below it, a perspective projects nothing (a point of the
 * z = 0 plane keeps w = 1), so it acts as an identity transform: a stacking context and a containing block, measured pixel-identical
 * to transform: translateX(0) in Chrome 145 with rotated, scaled and translated children at DPR 1 and 2.625 (css-transforms-2 §5).
 */
export function hasPerspective(el: ResolvedElement): boolean {
  const v = el.props.get('perspective')?.value;
  return v !== undefined && !(v.kind === 'keyword' && v.value === 'none');
}

/** What makes el transform its descendants, as the messages name it: a transform, or a perspective or backdrop-filter alone. */
export function transformWord(el: ResolvedElement): string {
  if (elementTransform(el).length > 0 || elementWillChange(el).includes('transform')) return 'a transform';
  if (hasPerspective(el)) return 'a perspective';
  return hasBackdropFilter(el.props.get('backdrop-filter')?.value) ? 'a backdrop-filter' : 'a transform';
}

/**
 * Whether an element's transform, perspective, will-change or backdrop-filter makes it a containing block for positioned
 * descendants (css-transforms-1 §3, filter-effects-2 §3: a backdrop-filter other than none does, as a filter does).
 */
export function transformsDescendants(el: ResolvedElement): boolean {
  return elementTransform(el).length > 0 || elementWillChange(el).includes('transform') || hasPerspective(el) || hasBackdropFilter(el.props.get('backdrop-filter')?.value);
}

/** Where to report a transform refusal: the transform declaration, else the will-change, perspective or backdrop-filter one, else the element. */
function transformOrigin(el: ResolvedElement): Origin {
  for (const p of ['transform', ...INDIVIDUAL_TRANSFORMS, 'will-change', 'perspective', 'backdrop-filter'] as const) {
    const v = el.props.get(p) as ResolvedValue | undefined;
    if (v === undefined) continue;
    const set = p === 'will-change' ? elementWillChange(el).includes('transform') : p === 'perspective' ? hasPerspective(el) : p === 'backdrop-filter' ? hasBackdropFilter(v.value) : !(v.value.kind === 'keyword' && v.value.value === 'none');
    if (v.declaration !== null && set) return authored(v.declaration.valueSpan);
  }
  return el.element.node.origin;
}

/**
 * The refusals of transforms by where they sit, on every target: a box whose individual transforms and transform compose to a skew, on html and body (the canvas background and the viewport are
 * not transformed with them), on a box that is not block or flex (css-transforms-1: only transformable boxes), a static
 * transformed element that would become the containing block of an absolutely positioned descendant, and a fixed descendant of a
 * transformed element (POSX-f2). A transform extending a scroll container's scrollable overflow (PNT2-o) needs no check yet:
 * checkOverflow refuses every overflow that scrolls, and Dragon never scrolls an overflow: hidden box; OVFL adds it when it lifts
 * that refusal.
 */
export function checkTransformContexts(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const refuse = (el: ResolvedElement, what: string, message: string, manual: string, origin: Origin = transformOrigin(el)): void => {
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
    // A filter other than none makes its box the containing block of absolute and fixed descendants too (filter-effects-1, the filter property).
    const creator = own ? transformWord(el) : filtered(el) ? 'a filter' : null;
    const address = el.element.address;
    if (own) {
      const what = transformWord(el);
      const tag = el.element.tag;
      // The properties are each accepted alone; together a rotation after a non-uniform scale can skew the box (css/properties/transform.ts).
      if (skewsBox(elementTransform(el))) refuse(el, 'skew', `the translate, rotate, scale and transform of ${address} compose to a rotation after a non-uniform scale, which skews the box: Android's View transform cannot express it (package PNT2-m)`, `Rotate ${address} before scaling it unevenly, or scale it evenly.`);
      if (tag === 'html' || tag === 'body') refuse(el, 'root', `${what} on <${tag}> ${address} is not supported: the canvas background and the viewport do not transform with it`, `Put the transform on an element inside <${tag}>.`);
      if (display !== 'block' && display !== 'flex') refuse(el, 'display', `${what} on ${address} with display: ${display} is not supported: Dragon transforms block and flex boxes`, `Give ${address} display: block or flex.`);
    }
    if (creator !== null && position === 'static') {
      const cb = absoluteDescendant(el);
      if (cb !== null) refuse(el, 'containing-block', `${creator} on ${address} makes it the containing block of the absolutely positioned ${cb.element.address} (${creator === 'a filter' ? 'filter-effects-1, the filter property' : 'css-transforms-1 §3'}), which Dragon's layout does not model yet`, `Set position: relative on ${address}, so it is the containing block with or without the ${creator.slice(2)}.`, own ? transformOrigin(el) : filterOrigin(el));
    }
    if (position === 'fixed' && transformed !== null) {
      const what = transformsDescendants(transformed) ? transformWord(transformed) : 'a filter';
      refuse(transformed, 'fixed', `${what} on ${transformed.element.address} makes it the containing block of the fixed ${address} (${what === 'a filter' ? 'filter-effects-1, the filter property' : 'css-transforms-1 §3'}; package POSX-f2)`, `Move ${address} outside ${transformed.element.address}.`, what === 'a filter' ? filterOrigin(transformed) : transformOrigin(transformed));
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, creator !== null ? el : transformed);
  };
  walk(root, null);
}

/** The filter declaration's value, or the element when the filter is not authored on it. */
function filterOrigin(el: ResolvedElement): Origin {
  const f = el.props.get('filter') as ResolvedValue | undefined;
  return f !== undefined && f.declaration !== null ? authored(f.declaration.valueSpan) : el.element.node.origin;
}

/** Whether an element has a filter other than none (a hand-built element may carry no filter value). */
function filtered(el: ResolvedElement): boolean {
  const f = el.props.get('filter') as ResolvedValue | undefined;
  return f !== undefined && filterApplies(f.value);
}

/** An absolutely positioned descendant whose containing block would be el (no positioned or transformed box between them), or null. */
function absoluteDescendant(el: ResolvedElement): ResolvedElement | null {
  for (const c of el.children) {
    if (c.kind !== 'element' || keywordOf(c, 'display') === 'none') continue;
    const position = keywordOf(c, 'position');
    if (position === 'absolute') return c;
    if (position !== 'static' || transformsDescendants(c) || filtered(c)) continue;
    const deeper = absoluteDescendant(c);
    if (deeper !== null) return deeper;
  }
  return null;
}

