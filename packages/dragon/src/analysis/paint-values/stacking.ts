// The stacking refusal (T046 §1, lower/paint/stacking.ts): a box with an integer z-index whose layer would take it out of an overflow
// clip in its containing-block chain needs a clip-chain wrapper around its re-hosted view, which EMS's hosting hook does not have,
// so it is refused on the native targets. The web target paints it itself.
import { opacityOf, zIndexOf } from '../../css/properties/effects.ts';
import type { StackNode } from '../../lower/paint/stacking.ts';
import { isBlank, stackingOf } from '../../lower/paint/stacking.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import { shadowedIn } from './effects.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement, ResolvedText } from '../resolve.ts';
import { boxChildren } from '../../lower/ios-layout.ts';
import type { PaintCheck, PaintValues } from './types.ts';

const keyword = (el: ResolvedElement, p: 'display' | 'position' | 'overflow-x'): string => {
  const v = (el.props.get(p) as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

/** A flex item's computed order, which paints flex items in order-modified document order. */
function flexOrderOf(el: ResolvedElement): number {
  const v = el.props.get('order')?.value;
  if (v === undefined) throw new Error(`${el.element.address}: order did not resolve`);
  if (v.kind !== 'number') throw new Error(`${el.element.address}: order did not compute to a number`);
  return v.value;
}

/**
 * The stacking tree of a resolved document, with the layout tree's boxes (boxChildren): display: none subtrees generate no boxes,
 * text beside element boxes or in a flex container sits in an anonymous box (a flex item there), and text is never positioned.
 */
export function resolvedStackTree(root: ResolvedElement): StackNode {
  const text = (t: ResolvedText): StackNode => ({ id: t.node.address, position: 'static', z: null, opacity: 1, clips: false, text: true, atomic: false, flexOrder: 0, blank: isBlank(t.text), children: [] });
  const node = (el: ResolvedElement, parentFlex: boolean): StackNode => {
    const position = keyword(el, 'position');
    const z = zIndexOf((el.props.get('z-index') as ResolvedValue).value);
    const opacity = opacityOf((el.props.get('opacity') as ResolvedValue).value);
    if (opacity === null) throw new Error(`${el.element.address}: opacity did not compute to a number`);
    const flex = ['flex', 'inline-flex'].includes(keyword(el, 'display'));
    return {
      id: el.element.address,
      position: position === 'relative' || position === 'absolute' || position === 'fixed' || position === 'sticky' ? position : 'static',
      z: position !== 'static' || parentFlex ? z : null,
      opacity,
      clips: keyword(el, 'overflow-x') === 'hidden',
      text: false,
      atomic: parentFlex && position !== 'absolute' && position !== 'fixed',
      blank: false,
      flexOrder: parentFlex ? flexOrderOf(el) : 0,
      children: boxChildren(el).map((c): StackNode => {
        if (c.kind === 'element') return node(c.el, flex);
        if (c.kind === 'text') return text(c.text);
        // An anonymous box takes every non-inherited property's initial value: static, z-index auto, opacity 1, visible, order 0.
        return { id: c.id, position: 'static', z: null, opacity: 1, clips: false, text: false, atomic: flex, flexOrder: 0, blank: false, children: c.texts.map(text) };
      }),
    };
  };
  return node(root, false);
}

const checkStacking: PaintCheck = (el, targets, diagnostics, reported) => {
  if (el.element.tag !== 'html') return;
  const byId = new Map<string, ResolvedElement>();
  const parentOf = new Map<ResolvedElement, ResolvedElement>();
  const walk = (e: ResolvedElement): void => {
    byId.set(e.element.address, e);
    for (const c of e.children) {
      if (c.kind !== 'element') continue;
      parentOf.set(c, e);
      walk(c);
    }
  };
  walk(el);
  const stacking = stackingOf(resolvedStackTree(el));
  const refuse = (key: string, origin: ReturnType<typeof authored> | ResolvedElement['element']['node']['origin'], message: (t: string) => string, manual: string): void => {
    for (const t of targets) {
      if (t === 'web' || reported.has(`${t}|${key}`)) continue;
      reported.add(`${t}|${key}`);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message: message(t), manual, basis: 'computed-value' }));
    }
  };
  // A re-hosted layer item's shadows above a painted DOM ancestor it skips are refused (PNT1 stacking: its composite above that
  // ancestor is unproven). A flex item hosted in its root's foreground composites onto its DOM ancestors (emit/paint/shadow.ts), the
  // backdrop it had in place, and is not refused.
  for (const [id, w] of stacking.writes) {
    const d = byId.get(id);
    if (d === undefined) continue;
    const skipped: ResolvedElement[] = [];
    for (let a = parentOf.get(d); a !== undefined && a.element.address !== w.host; a = parentOf.get(a)) skipped.push(a);
    const painted = skipped.find((a) => usedColors(a)['background-color'].alpha > 0);
    if (painted === undefined) continue;
    for (const sh of shadowedIn(d)) {
      const v = sh.props.get('box-shadow') as ResolvedValue;
      refuse(`stacking-shadow|${sh.element.address}`, v.declaration === null ? sh.element.node.origin : authored(v.declaration.valueSpan),
        (t) => `${sh.element.address} has a box-shadow and paints above ${painted.element.address} in its stacking context, so ${t} hosts it outside that ancestor, whose background its shadow composites onto; PNT1 does not match that yet`,
        'Move the shadow to a box that is not positioned above a painted ancestor, or remove the background of the ancestor.');
    }
  }
  for (const { id, clip } of stacking.clipped) {
    const at = byId.get(id) as ResolvedElement;
    const z = at.props.get('z-index') as ResolvedValue;
    const origin = z.declaration === null ? at.element.node.origin : authored(z.declaration.valueSpan);
    for (const t of targets) {
      if (t === 'web') continue;
      const key = `${t}|stacking-clip|${id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin,
        target: t,
        message: `${id} has z-index ${valueText(z)} and paints in a stacking context outside ${clip}, whose overflow clip applies to it; ${t} would need a clip-chain view around it, which PNT1's hosting does not have yet`,
        manual: `Make ${clip} a stacking context (position: relative with a z-index), so the z-index box stacks inside its clip, or move the box out of the clipping element.`,
        basis: 'computed-value',
      }));
    }
  }
};

const valueText = (v: ResolvedValue): string => (v.value.kind === 'other' ? v.value.text : v.value.kind === 'keyword' ? v.value.value : '');

export const STACKING_VALUES: PaintValues = { name: 'stacking', compute: () => {}, check: checkStacking };
