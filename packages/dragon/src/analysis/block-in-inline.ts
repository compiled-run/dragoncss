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

/** A child of the inline box, as the resolver holds it: a resolved element's display, or a text and whether it collapses away. */
export type BlockInInlineChild =
  | { readonly kind: 'block' }
  | { readonly kind: 'inline-level' }
  | { readonly kind: 'none' }
  | { readonly kind: 'text'; readonly blank: boolean }
  | { readonly kind: 'nested'; readonly address: string };

/**
 * Why an inline box holding a block-level child does not lay out as a block box, or null when it does: a non-inherited longhand
 * (other than ALLOWED) away from its initial value, text that does not collapse away, or inline-level content beside the blocks.
 */
export function blockInInlineBlocker(props: ReadonlyMap<Longhand, ResolvedValue>, kids: readonly BlockInInlineChild[], ua: UaDataset): string | null {
  if (!kids.some((k) => k.kind === 'block' || k.kind === 'nested')) return 'it holds no block-level box';
  if (kids.some((k) => k.kind === 'inline-level')) return 'it holds inline-level content beside its block-level boxes';
  // Each inline box inside it would end the line of blocks before it and start its own (its tags take empty lines between them).
  const nested = kids.find((k) => k.kind === 'nested');
  if (nested !== undefined && nested.kind === 'nested') return `it holds the inline box ${nested.address}, laid out the same way`;
  const collapse = (props.get('white-space-collapse') as ResolvedValue).value;
  const collapses = collapse.kind === 'keyword' && collapse.value === 'collapse';
  if (kids.some((k) => k.kind === 'text' && (!k.blank || !collapses))) return 'it holds text beside its block-level boxes';
  for (const p of LONGHANDS) {
    if (INHERITED.has(p) || ALLOWED.has(p)) continue;
    const v = props.get(p) as ResolvedValue;
    // A defaulted longhand holds its initial value (in whatever form the resolver computed it); any other must spell it.
    if (v.origin !== 'initial' && valueToString(v.value) !== valueToString(initialValue(p, ua))) return `${p}: ${valueToString(v.value)}`;
  }
  return null;
}
