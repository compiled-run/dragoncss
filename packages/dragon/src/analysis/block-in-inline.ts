// CSS2 §9.2.1.1 block-in-inline (package BII). An inline box holding block-level boxes is split around them: Blink 145 (LayoutNG
// block-in-inline) puts each block in its own line of the inline formatting context. When the inline box has no box of its own (no
// margin, border, padding, background or other non-inherited value but its display and text decoration) and holds nothing but
// block-level boxes and collapsible white space, its fragments beside the blocks are empty lines of zero height, so the blocks lay out,
// collapse their margins and hit test exactly as the children of a block box in the inline box's place, whose border box is their
// union (measured against Chrome 145.0.7632.6: getBoundingClientRect, elementFromPoint, and a background that paints nothing). The
// resolver gives such an element display: block (resolve.ts); every other block-in-inline stays refused (computed-checks.ts).
import { INHERITED, LONGHANDS } from '../css/properties.ts';
import type { Longhand } from '../css/properties.ts';
import type { UaDataset } from '../ua/datasets.ts';
import type { CssValue } from '../css/values.ts';
import type { ResolvedValue } from './computed.ts';
import { initialValue, valueToString } from './computed.ts';
import type { ResolvedElement } from './resolve.ts';

/** The elements the resolver made block boxes under BII (resolve.ts): computed display inline, laid out as block. */
const BLOCK_IN_INLINE = new WeakSet<ResolvedElement>();

export function markBlockInInline(el: ResolvedElement): void {
  BLOCK_IN_INLINE.add(el);
}

/** Whether the resolver laid el out as the block box of the blocks it holds; the web output writes its computed display inline. */
export function isBlockInInline(el: ResolvedElement): boolean {
  return BLOCK_IN_INLINE.has(el);
}

/** The non-inherited longhands an inline box may set and still lay out as its blocks' block box: decorations propagate to them. */
const ALLOWED: ReadonlySet<Longhand> = new Set<Longhand>(['display', 'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness']);

/**
 * Non-inherited longhands that do not apply to a non-replaced inline box (their "Applies to" lines in CSS2, css-sizing-3,
 * css-box-4, css-flexbox-1, css-grid-2, css-align-3, css-transforms-1 and -2, css-overflow-3 and -4, css-ui-4, css-masking-1
 * clip, css-images-3 object-*, SVG geometry), and ones that only qualify another: a border's colour and radius, the outline's
 * colour and offset, and the background and mask layer geometry. None of them gives the inline box a box of its own. The lowering
 * drops the sizes, block margins and ratio from the block-in-inline box (ios-layout.ts INLINE_IGNORES), as Chrome ignores them.
 */
const NOT_A_BOX: ReadonlySet<Longhand> = new Set<Longhand>([
  'top', 'right', 'bottom', 'left', 'z-index', 'overflow-x', 'overflow-y', 'box-sizing', 'width', 'height', 'min-width', 'min-height',
  'max-width', 'max-height', 'aspect-ratio', 'margin-top', 'margin-bottom', 'object-fit', 'object-position',
  'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius',
  'border-bottom-left-radius', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'justify-content',
  'align-items', 'align-self', 'align-content', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows',
  'grid-template-areas', 'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow', 'grid-row-start', 'grid-row-end',
  'grid-column-start', 'grid-column-end', 'justify-items', 'justify-self', 'outline-color', 'outline-width', 'outline-offset',
  'transform', 'transform-origin', 'background-position-x', 'background-position-y', 'background-size', 'background-repeat',
  'background-attachment', 'background-origin', 'background-clip', 'content', 'clear', 'cx', 'cy', 'r', 'x', 'y', 'rx', 'ry',
  'vector-effect', 'text-overflow', 'resize', 'backface-visibility', 'transform-style', 'transform-box', 'perspective',
  'perspective-origin', '-webkit-box-orient', '-webkit-line-clamp', 'touch-action', 'clip', '-webkit-mask-position-x',
  '-webkit-mask-position-y', 'mask-size', 'mask-repeat', 'mask-origin', 'mask-clip', 'mask-composite', 'mask-mode',
  'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat',
] as Longhand[]);

const BORDER_WIDTH = /^border-(top|right|bottom|left)-width$/;
const BORDER_STYLE = /^border-(top|right|bottom|left)-style$/;

/** Whether a computed value is a zero length or percentage, or a fully transparent colour: no box, whatever its property. */
function isNothing(v: CssValue): boolean {
  if (v.kind === 'length' || v.kind === 'percentage') return v.value === 0;
  if (v.kind === 'color') return v.value.alpha === 0;
  return v.kind === 'keyword' && v.value === 'transparent';
}

/** A child of the inline box, as the resolver holds it: a resolved element's display, or a text and whether it collapses away. */
export type BlockInInlineChild =
  | { readonly kind: 'block' }
  | { readonly kind: 'inline-level' }
  | { readonly kind: 'none' }
  | { readonly kind: 'out-of-flow' }
  | { readonly kind: 'text'; readonly blank: boolean }
  | { readonly kind: 'nested'; readonly address: string };

/**
 * Why an inline box holding a block-level child does not lay out as a block box, or null when it does: a box of its own (a
 * non-inherited longhand that applies to an inline box, other than ALLOWED, that draws or moves something), text that does not
 * collapse away, or inline-level content beside the blocks.
 */
export function blockInInlineBlocker(props: ReadonlyMap<Longhand, ResolvedValue>, kids: readonly BlockInInlineChild[], ua: UaDataset): string | null {
  if (!kids.some((k) => k.kind === 'block' || k.kind === 'nested')) return 'it holds no in-flow block-level box';
  if (kids.some((k) => k.kind === 'inline-level')) return 'it holds inline-level content beside its block-level boxes';
  // Each inline box inside it would end the line of blocks before it and start its own (its tags take empty lines between them).
  const nested = kids.find((k) => k.kind === 'nested');
  if (nested !== undefined && nested.kind === 'nested') return `it holds the inline box ${nested.address}, laid out the same way`;
  const collapse = (props.get('white-space-collapse') as ResolvedValue).value;
  const collapses = collapse.kind === 'keyword' && collapse.value === 'collapse';
  if (kids.some((k) => k.kind === 'text' && (!k.blank || !collapses))) return 'it holds text beside its block-level boxes';
  const value = (p: Longhand): CssValue => (props.get(p) as ResolvedValue).value;
  const none = (v: CssValue): boolean => v.kind === 'keyword' && (v.value === 'none' || v.value === 'hidden');
  for (const p of LONGHANDS) {
    if (INHERITED.has(p) || ALLOWED.has(p) || NOT_A_BOX.has(p)) continue;
    const v = props.get(p) as ResolvedValue;
    // A defaulted longhand holds its initial value (in whatever form the resolver computed it); any other must spell it.
    if (v.origin === 'initial' || valueToString(v.value) === valueToString(initialValue(p, ua)) || isNothing(v.value)) continue;
    // A border side or the outline is a box only when it is drawn: a line style and a computed width that is not zero (an initial
    // medium width is 3px, so border-style: solid alone draws one).
    const side = BORDER_WIDTH.exec(p);
    if (side !== null && none(value(`border-${side[1]}-style` as Longhand))) continue;
    const styled = BORDER_STYLE.exec(p);
    if (styled !== null && (none(v.value) || isNothing(value(`border-${styled[1]}-width` as Longhand)))) continue;
    if (p === 'outline-style' && isNothing(value('outline-width'))) continue;
    return `${p}: ${valueToString(v.value)}`;
  }
  return null;
}
