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

/** The stacking tree of a resolved document: display: none subtrees generate no boxes; text is never positioned. */
export function resolvedStackTree(root: ResolvedElement): StackNode {
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
      clips: keyword(el, 'overflow-x') === 'hidden',
      text: false,
      children: el.children.flatMap((c): StackNode[] => {
        if (c.kind === 'text') return [{ id: `${el.element.address}:text#${texts++}`, position: 'static', z: null, opacity: 1, transformed: false, clips: false, text: true, children: [] }];
        return keyword(c, 'display') === 'none' ? [] : [node(c, flex)];
      }),
    };
  };
  return node(root, false);
}

const valueText = (v: ResolvedValue): string => (v.value.kind === 'other' ? v.value.text : v.value.kind === 'keyword' ? v.value.value : '');

/** The refusal above over a case's resolved tree, on the native targets. */
export function checkStackingClips(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const byId = new Map<string, ResolvedElement>();
  const walk = (e: ResolvedElement): void => {
    byId.set(e.element.address, e);
    for (const c of e.children) if (c.kind === 'element') walk(c);
  };
  walk(el);
  for (const { id, clip } of stackingOf(resolvedStackTree(el)).clipped) {
    const at = byId.get(id);
    if (at === undefined) throw new Error(`${id}: a clipped stacking item that is not an element`);
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
}

export const STACKING_VALUES: PaintValues = { name: 'stacking', compute: () => {} };
