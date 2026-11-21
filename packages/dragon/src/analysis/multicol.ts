// The multicol family (css/properties/multicol.ts). column-width as a px length and column-count as a positive integer make a block a
// multi-column container, which the engine lays out (lower/ios-layout.ts multicolOf, LayoutStyle.multicol) where Chrome's columns are
// proven: an unfloated block, static or relatively positioned, in a chain of such blocks, holding collapsible text and inline <br>s
// alone, with an auto block size and aspect ratio, visible overflow, a px or normal column gap, the initial orphans and widows and
// effective zoom 1. Every other multi-column container is refused on every target, as is any column rule, span or fill other than the initial one and any column-width or column-count
// spelling the parser keeps as written. Each element is refused once.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { MULTICOL_INITIAL, MULTICOL_LONGHANDS } from '../css/properties/multicol.ts';
import type { Longhand } from '../css/properties.ts';
import type { MulticolFaults } from '../faults/multicol.ts';
import type { Diagnostic } from '../types.ts';
import { lineClampOf } from './line-clamp.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';
import type { InitialOnlyFamily } from './scroll-containment.ts';
import { refuseNonInitial } from './scroll-containment.ts';
import { effectiveZoom } from './zoom.ts';

// css-multicol-1 §6 and §7: column-span: all spans the columns, column-fill changes how their content is balanced, and a column rule
// is drawn between them; Dragon builds none of it yet.
const MULTICOL_EXTRAS: InitialOnlyFamily = {
  id: 'multicol',
  longhands: MULTICOL_LONGHANDS.filter((p) => p !== 'column-width' && p !== 'column-count'),
  initial: MULTICOL_INITIAL,
  reason: 'Dragon draws no column rule and lays out no spanning element or unbalanced column fill yet',
};

const value = (el: ResolvedElement, p: Longhand) => (el.props.get(p) as ResolvedValue).value;
const keyword = (el: ResolvedElement, p: Longhand): string => {
  const v = value(el, p);
  return v.kind === 'keyword' ? v.value : '';
};
const pxLength = (el: ResolvedElement, p: Longhand): boolean => {
  const v = value(el, p);
  return v.kind === 'length' && v.unit === 'px';
};

/** Whether the element's computed column-width or column-count makes it a multi-column container the engine reads. */
export function isMulticolContainer(el: ResolvedElement): boolean {
  return value(el, 'column-width').kind === 'length' || value(el, 'column-count').kind === 'number';
}

/** Why a box in a multi-column container's chain is sized otherwise than by its containing block's width, or null. */
function flowRefusal(el: ResolvedElement, what: string): string | null {
  if (keyword(el, 'display') !== 'block') return `${what} is display: ${valueToString(value(el, 'display'))}, not block`;
  const position = keyword(el, 'position');
  if (position !== 'static' && position !== 'relative') return `${what} is positioned ${valueToString(value(el, 'position'))}`;
  if (keyword(el, 'float') !== 'none') return `${what} floats`;
  for (const p of ['width', 'min-width', 'max-width'] as const) {
    const v = value(el, p);
    const sized = (v.kind === 'keyword' && (v.value === 'auto' || v.value === 'none')) || (v.kind === 'length' && v.unit === 'px') || v.kind === 'percentage';
    if (!sized) return `${what} has ${p}: ${valueToString(v)}`;
  }
  return null;
}

/**
 * Why Dragon does not lay out el as a multi-column container, or null when it does. chain: el's ancestors, outermost first, which
 * lay the container out at their width (an intrinsic size of a multi-column container is not proven against Chrome).
 */
function refusal(el: ResolvedElement, chain: readonly ResolvedElement[]): string | null {
  const own = flowRefusal(el, 'the container');
  if (own !== null) return own;
  for (const a of chain) {
    const why = flowRefusal(a, `its ancestor <${a.element.tag}> ${a.element.address}`);
    if (why !== null) return why;
  }
  if (keyword(el, 'overflow-x') !== 'visible' || keyword(el, 'overflow-y') !== 'visible') return 'it clips its overflow';
  const minHeight = value(el, 'min-height');
  const zeroMin = (minHeight.kind === 'keyword' && minHeight.value === 'auto') || (minHeight.kind === 'length' && minHeight.value === 0);
  if (keyword(el, 'height') !== 'auto' || keyword(el, 'max-height') !== 'none' || !zeroMin) return 'it has a specified block size';
  if (keyword(el, 'aspect-ratio') !== 'auto') return `it has aspect-ratio: ${valueToString(value(el, 'aspect-ratio'))}`;
  if (keyword(el, 'column-gap') !== 'normal' && !pxLength(el, 'column-gap')) return 'its column gap is not a px length or normal';
  if (!pxLength(el, 'text-indent')) return 'its text-indent is not a px length';
  if (keyword(el, 'white-space-collapse') !== 'collapse') return 'it preserves white space';
  if (keyword(el, 'text-wrap-mode') !== 'wrap') return 'its lines do not wrap';
  for (const p of ['orphans', 'widows'] as const) {
    const v = value(el, p);
    if (!(v.kind === 'number' && v.value === 2)) return `its ${p} is not 2`;
  }
  if (keyword(el, 'contain') !== 'none' || keyword(el, 'container-type') !== 'normal') return 'it is contained';
  if (lineClampOf(el) > 0) return 'it clamps its lines';
  // ZOOM: no case proves the columns' balancing or gap at an effective zoom other than the device scale.
  const zoom = [...chain, el].reduce((z, e) => effectiveZoom(e, z), 1);
  if (zoom !== 1) return `it is under zoom (effective zoom ${zoom})`;
  for (const c of el.children) {
    if (c.kind !== 'element') continue;
    if (c.element.tag !== 'br') return `it holds <${c.element.tag}> ${c.element.address}, and only text and <br> are proven`;
    // A <br> that is not an inline line break (display other than inline or none, or a float) is a block-level box or an atomic
    // inline in the columns, which the engine does not lay out.
    const display = keyword(c, 'display');
    if ((display !== 'inline' && display !== 'none') || keyword(c, 'float') !== 'none') {
      return `it holds <br> ${c.element.address} with display: ${valueToString(value(c, 'display'))} and float: ${valueToString(value(c, 'float'))}, and only an inline <br> is proven`;
    }
  }
  return null;
}

/**
 * Refuses the element's first non-initial column rule, span or fill longhand, a column-width or column-count spelling the parser
 * keeps as written, and a multi-column container the engine does not lay out; the planted fault accepts them all. chain: el's
 * ancestors, outermost first. hidden: el is in a display: none subtree, where no container is laid out.
 */
export function checkMulticol(el: ResolvedElement, chain: readonly ResolvedElement[], hidden: boolean, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: MulticolFaults): void {
  if (faults.multicolAccepted) return;
  refuseNonInitial(el, targets, diagnostics, reported, MULTICOL_EXTRAS);
  const width = value(el, 'column-width');
  const count = value(el, 'column-count');
  const unread = width.kind === 'other' ? 'column-width' : count.kind === 'other' ? 'column-count' : null;
  const why = unread !== null
    ? `${unread} is a px length or auto (column-width), or a positive integer or auto (column-count), in Dragon`
    : isMulticolContainer(el) && !hidden ? refusal(el, chain) : null;
  if (why === null) return;
  const p: Longhand = unread ?? (width.kind === 'length' ? 'column-width' : 'column-count');
  const id = `multicol|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const v = el.props.get(p) as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${p}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} makes a multi-column container Dragon does not lay out: ${why}`,
      manual: `Remove ${p} from ${el.element.address}, or set ${p}: auto.`,
      basis: 'computed-value',
    }));
  }
}
