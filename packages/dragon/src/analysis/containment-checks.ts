// CONTAIN: the containment Dragon refuses (css-contain-2 §3), apart from containment.ts so that the paint value modules that ask
// where containment applies do not import the line-clamp and replaced-element analyses.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { containmentOf } from '../css/properties/containment.ts';
import type { Diagnostic, Origin } from '../types.ts';
import { appliedContainment, containsDescendants, displayOf } from './containment.ts';
import { isReplacedTag, SVG_SHAPE_TAGS } from './elements/replaced.ts';
import { lineClampOf } from './line-clamp.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

const FLEX_OR_GRID = ['flex', 'inline-flex', 'grid', 'inline-grid'];

function containOrigin(el: ResolvedElement): Origin {
  const v = el.props.get('contain') as ResolvedValue;
  return v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
}

/**
 * The containment Dragon refuses, on every target: contain on html or body (it stops the viewport taking body's overflow, css-overflow-3
 * §3.3), on a replaced element or inside an <svg>; size containment without layout containment, on a flex or grid container or item,
 * or on a line-clamp container, which the engine does not size yet; and a fixed descendant of a layout- or paint-contained box,
 * whose containing block it would become.
 */
export function checkContainment(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const refuse = (el: ResolvedElement, what: string, message: string, manual: string): void => {
    for (const t of targets) {
      const id = `${t}|contain-${what}|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: containOrigin(el), target: t, message, manual, basis: 'computed-value' }));
    }
  };
  const walk = (el: ResolvedElement, parent: ResolvedElement | null, inSvg: boolean, contained: ResolvedElement | null): void => {
    const display = displayOf(el);
    if (display === 'none') return;
    const asked = containmentOf(el);
    const any = asked.size !== 'none' || asked.layout || asked.style || asked.paint;
    const tag = el.element.tag;
    const at = `<${tag}> ${el.element.address}`;
    const written = valueText(el);
    if (any && (tag === 'html' || tag === 'body')) {
      refuse(el, 'root', `contain: ${written} on ${at} is unsupported: containment on the root or body stops the viewport taking body's overflow (css-overflow-3 §3.3), which Dragon does not model`, `Put contain on an element inside <body>.`);
    } else if (any && (inSvg || isReplacedTag(tag) || SVG_SHAPE_TAGS.includes(tag))) {
      refuse(el, 'replaced', `contain: ${written} on ${at} is unsupported: Dragon does not contain a replaced element or SVG content`, `Remove contain from ${el.element.address}, or put it on a wrapper element.`);
    } else {
      const own = appliedContainment(el);
      if (own.size !== 'none') {
        const item = parent !== null && FLEX_OR_GRID.includes(displayOf(parent)) && !['absolute', 'fixed'].includes(keyword(el, 'position'));
        const why = !own.layout
          ? 'size containment without layout containment'
          : FLEX_OR_GRID.includes(display)
            ? `size containment on a ${display} container`
            : item
              ? `size containment on a ${displayOf(parent as ResolvedElement)} item`
              : lineClampOf(el) > 0 ? 'size containment on a line-clamp container' : null;
        if (why !== null) refuse(el, 'size', `contain: ${written} on ${at} is unsupported: Dragon does not lay out ${why} yet (css-contain-2 §3.1)`, `Use contain: strict or size layout on a block or inline-block outside flex and grid, or remove the size containment from ${el.element.address}.`);
      }
      if (keyword(el, 'position') === 'fixed' && contained !== null) {
        refuse(contained, 'fixed', `contain: ${valueText(contained)} on <${contained.element.tag}> ${contained.element.address} is unsupported: it makes the box the containing block of the fixed ${el.element.address} (css-contain-2 §3.2), which Dragon does not model`, `Move ${el.element.address} outside ${contained.element.address}.`);
      }
    }
    const next = containsDescendants(el) ? el : contained;
    for (const c of el.children) if (c.kind === 'element') walk(c, el, inSvg || tag === 'svg', next);
  };
  walk(root, null, false, null);
}

const keyword = (el: ResolvedElement, p: 'position'): string => {
  const v = (el.props.get(p) as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

const valueText = (el: ResolvedElement): string => {
  const v = (el.props.get('contain') as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};
