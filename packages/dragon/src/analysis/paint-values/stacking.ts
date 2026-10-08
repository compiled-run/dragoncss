// The stacking refusal (T046 §1, lower/paint/stacking.ts): a box with an integer z-index whose layer would take it out of an overflow
// clip in its containing-block chain needs a clip-chain wrapper around its re-hosted view, which EMS's hosting hook does not have,
// so it is refused on the native targets. The web target paints it itself.
import { opacityOf, zIndexOf } from '../../css/properties/effects.ts';
import type { StackNode } from '../../lower/paint/stacking.ts';
import { stackingOf, transformedForStacking } from '../../lower/paint/stacking.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import type { Diagnostic } from '../../types.ts';
import type { PaintValues } from './types.ts';

const keyword = (el: ResolvedElement, p: 'display' | 'position' | 'overflow-x'): string => {
  const v = (el.props.get(p) as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

/**
 * The stacking tree of a resolved document: display: none subtrees generate no boxes; text is never positioned. A box clips as the
 * native tree's does (lower/paint/clip.ts: any overflow but visible), except an inline box and the element whose overflow the
 * viewport takes (propagated; css-overflow-3 §3.3), which use visible.
 */
export function resolvedStackTree(root: ResolvedElement, propagated: ResolvedElement | null): StackNode {
  let texts = 0;
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
      transformed: transformedForStacking(el),
      clips: el !== propagated && keyword(el, 'display') !== 'inline' && keyword(el, 'overflow-x') !== 'visible',
      text: false,
      children: el.children.flatMap((c): StackNode[] => {
        if (c.kind === 'text') return [{ id: `${el.element.address}:text#${texts++}`, position: 'static', z: null, opacity: 1, transformed: false, clips: false, text: true, children: [] }];
        return keyword(c, 'display') === 'none' ? [] : [node(c, flex)];
      }),
    };
  };
  return node(root, false);
}

/** Where to report a stacking refusal: the declaration that makes the box a layer item (z-index, position, opacity, transform). */
function itemOrigin(el: ResolvedElement): ReturnType<typeof authored> | ResolvedElement['element']['node']['origin'] {
  for (const p of ['z-index', 'position', 'opacity', 'transform', 'will-change'] as const) {
    const v = el.props.get(p) as ResolvedValue | undefined;
    if (v === undefined || v.declaration === null) continue;
    if (p === 'z-index' && zIndexOf(v.value) === null) continue;
    if (p === 'position' && v.value.kind === 'keyword' && v.value.value === 'static') continue;
    return authored(v.declaration.valueSpan);
  }
  return el.element.node.origin;
}

/** The refusals above over a case's resolved tree, on the native targets. */
export function checkStackingClips(el: ResolvedElement, propagated: ResolvedElement | null, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const byId = new Map<string, ResolvedElement>();
  const walk = (e: ResolvedElement): void => {
    byId.set(e.element.address, e);
    for (const c of e.children) if (c.kind === 'element') walk(c);
  };
  walk(el);
  for (const { id, clip, kind } of stackingOf(resolvedStackTree(el, propagated)).clipped) {
    const at = byId.get(id);
    if (at === undefined) throw new Error(`${id}: a clipped stacking item that is not an element`);
    for (const t of targets) {
      if (t === 'web') continue;
      const key = `${t}|stacking-${kind}|${id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: itemOrigin(at),
        target: t,
        message: kind === 'order'
          ? `${id} paints in a stacking context outside ${clip}, whose overflow clip applies to it, and Chrome paints it after content ${t} would paint above it under that clip; ${t} would need a clip-chain view around it, which PNT1's hosting does not have yet`
          : `${id} is not clipped by ${clip} in Chrome (its containing block is outside it), but ${t} hosts it under a stacking context inside ${clip}'s clip view, which would clip it; PNT1's hosting cannot take it out of that clip yet`,
        manual: kind === 'order'
          ? `Make ${clip} a stacking context (position: relative with a z-index), so the box stacks inside its clip, or move the box out of the clipping element.`
          : `Make the stacking context between ${clip} and ${id} its containing block (position: relative), or move ${id} out of ${clip}.`,
        basis: 'computed-value',
      }));
    }
  }
}

export const STACKING_VALUES: PaintValues = { name: 'stacking', compute: () => {} };
