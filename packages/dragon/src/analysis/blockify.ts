// css-display-3 §2.7 blockification, as Blink 145 does it (StyleAdjuster::AdjustStyleForDisplay, EquivalentBlockDisplay): the
// root, a flex or grid item (its layout parent skips display: contents), and an absolutely positioned box take the block-level
// equivalent of their display. Table verified against Chrome 145.0.7632.6 on every display value (notes/T057-inl-bf.md).
import type { Longhand } from '../css/properties.ts';
import { diagnostic } from '../diagnostics/catalogue.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedValue } from './computed.ts';
import { parseValueText, valueToString } from './computed.ts';
import type { ResolvedElement } from './resolve.ts';

/** The computed display a blockified box takes, keyed by the display's keywords in sorted order. Other values are unchanged. */
const BLOCKIFIED: ReadonlyMap<string, string> = new Map([
  ['inline', 'block'], ['inline-block', 'block'], ['flow inline', 'block'], ['flow-root inline', 'block'], ['math', 'block'], ['inline math', 'block'],
  ['inline-flex', 'flex'], ['flex inline', 'flex'], ['inline-grid', 'grid'], ['grid inline', 'grid'], ['inline-table', 'table'], ['inline table', 'table'],
  ['ruby', 'block ruby'], ['inline ruby', 'block ruby'], ['-webkit-inline-box', '-webkit-box'],
  ['inline list-item', 'list-item'], ['flow inline list-item', 'list-item'], ['flow-root inline list-item', 'flow-root list-item'],
  ['table-row-group', 'block'], ['table-header-group', 'block'], ['table-footer-group', 'block'], ['table-row', 'block'], ['table-cell', 'block'],
  ['table-column-group', 'block'], ['table-column', 'block'], ['table-caption', 'block'], ['ruby-base', 'block'], ['ruby-text', 'block'],
]);

/** Displays whose boxes blockify their children (css-flexbox-1 §4, css-grid-2 §6). */
const BLOCKIFYING_PARENTS: ReadonlySet<string> = new Set(['flex', 'inline-flex', 'block flex', 'flex inline', 'grid', 'inline-grid', 'block grid', 'grid inline']);

const keysOf = (v: ResolvedValue): string | null => {
  if (v.value.kind === 'keyword') return v.value.value;
  if (v.value.kind === 'other' && v.value.type === 'list') return v.value.text.trim().split(/\s+/).sort().join(' ');
  return null;
};

/** The computed display of a blockified box, or null when blockification leaves it unchanged. */
export function blockifiedDisplay(display: ResolvedValue, faults: CompilerFaults): ResolvedValue | null {
  const keys = keysOf(display);
  const to = keys === null ? undefined : BLOCKIFIED.get(keys);
  if (to === undefined) return null;
  // Planted fault inlineFlexToBlock: inline-flex blockifies to block instead of flex.
  const text = faults.inlineFlexToBlock && to === 'flex' ? 'block' : to;
  return { ...display, value: parseValueText('display', text) };
}

// The display of each element's layout parent for its children: display: contents boxes pass their own layout parent's through.
const layoutParentDisplay = new WeakMap<ReadonlyMap<Longhand, ResolvedValue>, string | null>();

/**
 * Blockifies props' display in place when the element is the root, a flex or grid item, or absolutely positioned, and records
 * what its children's layout parent is. parent: the element's parent's props, or null at the root.
 */
export function blockify(props: Map<Longhand, ResolvedValue>, parent: ReadonlyMap<Longhand, ResolvedValue> | null, faults: CompilerFaults): void {
  const display = props.get('display') as ResolvedValue;
  if (parent !== null && !layoutParentDisplay.has(parent)) throw new Error('blockify: the parent was not blockified first');
  const layoutParent = parent === null ? null : (layoutParentDisplay.get(parent) as string | null);
  const position = keysOf(props.get('position') as ResolvedValue);
  const blockifies = parent === null || (layoutParent !== null && BLOCKIFYING_PARENTS.has(layoutParent)) || position === 'absolute' || position === 'fixed';
  // Blink leaves display: contents unblockified; its box does not exist.
  if (blockifies && keysOf(display) !== 'contents' && !faults.blockifySkipped) {
    const to = blockifiedDisplay(display, faults);
    if (to !== null) props.set('display', to);
  }
  const own = keysOf(props.get('display') as ResolvedValue);
  layoutParentDisplay.set(props, own === 'contents' ? layoutParent : own);
}

/**
 * An element whose display no author declaration set and which stayed inline-level (span, a and label in a block container)
 * would be an inline box, which Dragon does not lay out yet (INL1a). A declared display is keyed by its formatting context in the
 * support profile instead. Called for every element outside display: none subtrees.
 */
export function checkInlineLevel(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const display = el.props.get('display') as ResolvedValue;
  if (display.declaration !== null) return;
  const keys = keysOf(display);
  if (keys === null || !BLOCKIFIED.has(keys)) return;
  const tag = el.element.tag;
  const message = `display: ${valueToString(display.value)} on <${tag}> ${el.element.address} makes it an inline-level box (only the root, flex and grid items, and absolutely positioned boxes are blockified, css-display-3 §2.7); Dragon does not lay out inline formatting contexts yet`;
  for (const t of targets) {
    const id = `${t}|inline-level|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: el.element.node.origin, target: t, message, manual: `Set display: block (or flex) on <${tag}> ${el.element.address}, or make it a flex item or absolutely positioned.`, basis: 'computed-value' }));
  }
}
