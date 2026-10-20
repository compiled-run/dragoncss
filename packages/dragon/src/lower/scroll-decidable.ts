// OVFL-B: a native scroll view clamps to the scroll range the translated engine computes on the device (overflow.ts scrollRanges),
// and the engine refuses some scroll containers (OverflowRefusal). This finds, on the lowered tree, every auto or scroll container
// whose range the engine may refuse, so the compiler refuses it at build time. It mirrors overflowOf, propagated, refuseLineLevelBoxes,
// readFlow and readChild structurally; the one value-dependent rule (a percentage height whose end margins may collapse through it)
// is refused whenever it may apply. packages/parity/test/scroll-decidable.test.ts checks it against the engine.
import type { InlineChild, LayoutBox, LayoutNode, ReplacedLeaf } from '@dragon/layout';

export type ScrollUndecided = { readonly containerId: string; readonly nodeId: string; readonly detail: string };

type Child = LayoutBox | ReplacedLeaf | InlineChild;

const isNode = (k: Child): k is LayoutBox | ReplacedLeaf => k.kind === 'box' || k.kind === 'replaced';
const outOfFlow = (k: LayoutNode): boolean => k.style.position === 'absolute' || k.style.position === 'fixed';
const userScrolls = (b: LayoutNode): boolean => b.kind === 'box' && [b.style.overflowX, b.style.overflowY].some((o) => o === 'auto' || o === 'scroll');
const scrollContainer = (b: LayoutNode): boolean => [b.style.overflowX, b.style.overflowY].some((o) => o === 'hidden' || o === 'auto' || o === 'scroll');
const hasInlineContent = (b: LayoutBox): boolean => b.children.some((k) => k.kind === 'text' || k.kind === 'inline' || k.kind === 'br');
/** A length that may resolve against a percentage basis (a calculation is taken to, conservatively). */
const mayHavePercent = (v: { readonly kind: string }): boolean => v.kind === 'percent' || v.kind === 'calc';
const positivePx = (v: { readonly kind: string }): boolean => (v.kind === 'px' || v.kind === 'device-px') && 'value' in v && typeof v.value === 'number' && v.value > 0;

class Undecided {
  readonly nodeId: string;
  readonly detail: string;
  constructor(nodeId: string, detail: string) {
    this.nodeId = nodeId;
    this.detail = detail;
  }
}

/** refuseLineLevelBoxes: the first line item of an inline formatting context the engine does not place. */
function lineLevel(b: LayoutBox): void {
  if (!hasInlineContent(b)) return;
  for (const k of b.children) {
    if (k.kind === 'box' || k.kind === 'replaced') throw new Undecided(k.id, `an atomic inline in the inline formatting context of ${b.id}: its scrollable overflow is not decided here (R16, INL2)`);
    if (k.kind === 'inline') throw new Undecided(k.id, `an inline box in the inline formatting context of ${b.id}: its scrollable overflow is not decided here (R16, INL1a)`);
    if (k.kind === 'br') throw new Undecided(k.id, `a <br> in the inline formatting context of ${b.id}: its scrollable overflow is not decided here (R16, INL1a)`);
  }
}

/** overflow.ts refuseFloat: a float in a block container (FLT). */
function floatIn(b: LayoutBox): void {
  if (b.style.display !== 'block' && b.style.display !== 'inline-block') return;
  for (const k of b.children) if (isNode(k) && !outOfFlow(k) && k.style.float !== 'none') throw new Undecided(k.id, `a float in ${b.id}: its scrollable overflow is not decided here (FLT)`);
}

/** The absolutely positioned boxes whose containing block is b (none when b is static), as indexOf files them. */
function oofsOf(b: LayoutNode): LayoutNode[] {
  if (b.kind === 'replaced' || b.style.position === 'static') return [];
  const out: LayoutNode[] = [];
  const walk = (p: LayoutBox): void => {
    for (const k of p.children) {
      if (!isNode(k)) continue;
      // A fixed box's containing block is the viewport, and it is in no scrollable overflow (overflow.ts indexOf).
      if (outOfFlow(k)) {
        if (k.style.position === 'absolute') out.push(k);
      } else if (k.kind === 'box' && k.style.position === 'static') walk(k);
    }
  };
  walk(b);
  return out;
}

/**
 * overflow.ts paddingKnown: the boxes whose percentage padding resolves against a grid area (a grid item, or an absolutely
 * positioned child of a positioned grid container), or against a content box that one of them sets.
 */
function unknownPadding(root: LayoutBox): ReadonlySet<string> {
  const out = new Set<string>();
  const hasPercentPadding = (b: LayoutNode): boolean => [b.style.paddingTop, b.style.paddingRight, b.style.paddingBottom, b.style.paddingLeft].some(mayHavePercent);
  const walk = (b: LayoutNode, basisKnown: boolean): void => {
    const known = basisKnown || !hasPercentPadding(b);
    if (!known) out.add(b.id);
    if (b.kind === 'replaced') return;
    const grid = b.style.display === 'grid' || b.style.display === 'inline-grid';
    for (const k of b.children) {
      if (!isNode(k)) continue;
      walk(k, k.style.position === 'fixed' || (outOfFlow(k) ? !(grid && b.style.position !== 'static') : known && !grid));
    }
  };
  walk(root, true);
  return out;
}

/** overflowOf, without the scroll container's own flow (flow below). */
function overflowOf(b: LayoutNode, unknown: ReadonlySet<string>): void {
  if (b.kind === 'replaced') return;
  if (unknown.has(b.id)) throw new Undecided(b.id, 'a percentage padding against a grid area: its basis is not decided here');
  lineLevel(b);
  floatIn(b);
  for (const k of b.children) if (isNode(k) && !outOfFlow(k)) propagated(k, unknown);
  for (const k of oofsOf(b)) propagated(k, unknown);
}

function propagated(n: LayoutNode, unknown: ReadonlySet<string>): void {
  if (n.kind === 'replaced' || scrollContainer(n) || (n.style.overflowX === 'clip' && n.style.overflowY === 'clip')) return;
  overflowOf(n, unknown);
}

const fcRoot = (b: LayoutNode): boolean => b.kind === 'replaced' || b.style.display !== 'block' || scrollContainer(b);

/** readFlow and readChild from a block flow: a percentage height whose end margins may collapse through it is refused. */
function flow(b: LayoutBox): void {
  if (b.style.display !== 'block' || hasInlineContent(b)) return;
  floatIn(b);
  for (const k of b.children) {
    if (!isNode(k) || outOfFlow(k) || k.kind === 'replaced' || fcRoot(k)) continue;
    flow(k);
    const endMayCollapse = !positivePx(k.style.borderBottomWidth) && !positivePx(k.style.paddingBottom) && k.children.some((c) => isNode(c) && !outOfFlow(c));
    if (k.style.height.kind !== 'auto' && mayHavePercent(k.style.height) && endMayCollapse) {
      throw new Undecided(k.id, 'a percentage height on a box whose end margins may collapse through it: its basis is not decided here');
    }
  }
}

/** Every auto or scroll container of a lowered tree whose scroll range the engine may refuse, in preorder, with the first reason. */
export function undecidedScrollContainers(root: LayoutBox): ScrollUndecided[] {
  const out: ScrollUndecided[] = [];
  const unknown = unknownPadding(root);
  const walk = (b: LayoutNode): void => {
    if (userScrolls(b) && b.kind === 'box') {
      try {
        overflowOf(b, unknown);
        if (b.children.some((k) => isNode(k) && !outOfFlow(k))) flow(b);
      } catch (e) {
        if (!(e instanceof Undecided)) throw e;
        out.push({ containerId: b.id, nodeId: e.nodeId, detail: e.detail });
      }
    }
    if (b.kind === 'box') for (const k of b.children) if (isNode(k)) walk(k);
  };
  walk(root);
  return out;
}
