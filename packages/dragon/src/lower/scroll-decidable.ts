// OVFL-B: a native scroll view clamps to the scroll range the translated engine computes on the device (overflow.ts scrollRanges),
// and the engine refuses some scroll containers (OverflowRefusal). This finds, on the lowered tree, every auto or scroll container
// whose range the engine may refuse, so the compiler refuses it at build time. It mirrors overflowOf, propagated, refuseLineLevelBoxes,
// readFlow and readChild structurally; the one value-dependent rule (a percentage height whose end margins may collapse through it)
// is refused whenever it may apply. packages/parity/test/scroll-decidable.test.ts checks it against the engine.
import type { ControlBox, InlineChild, LayoutBox, LayoutNode, LayoutStyle, ReplacedLeaf } from '@dragon/layout';

/** Whether a box is the containing block of its absolutely positioned descendants: positioned, or layout- or paint-contained (the
 * engine's box.ts containsAbsolute; the core imports @dragon/layout for types only). */
const containsAbsolute = (s: LayoutStyle): boolean => s.position !== 'static' || s.containLayout || s.containPaint;

export type ScrollUndecided = { readonly containerId: string; readonly nodeId: string; readonly detail: string };

type Child = LayoutBox | ControlBox | ReplacedLeaf | InlineChild;

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

/** The absolutely positioned boxes whose containing block is b (none when b is static and not contained), as indexOf files them. */
function oofsOf(b: LayoutNode): LayoutNode[] {
  if (b.kind !== 'box' || !containsAbsolute(b.style)) return [];
  const out: LayoutNode[] = [];
  const walk = (p: LayoutBox): void => {
    for (const k of p.children) {
      if (!isNode(k)) continue;
      // A fixed box's containing block is the viewport, and it is in no scrollable overflow (overflow.ts indexOf).
      if (outOfFlow(k)) {
        if (k.style.position === 'absolute') out.push(k);
      } else if (k.kind === 'box' && !containsAbsolute(k.style)) walk(k);
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
      walk(k, k.style.position === 'fixed' || (outOfFlow(k) ? !(grid && containsAbsolute(b.style)) : known && !grid));
    }
  };
  walk(root, true);
  return out;
}

/** overflowOf, without the scroll container's own flow (flow below). */
function overflowOf(b: LayoutNode, unknown: ReadonlySet<string>): void {
  // Form controls arrive as their plain boxes (controlsAsBoxes).
  if (b.kind !== 'box') return;
  if (unknown.has(b.id)) throw new Undecided(b.id, 'a percentage padding against a grid area: its basis is not decided here');
  lineLevel(b);
  floatIn(b);
  for (const k of b.children) if (isNode(k) && !outOfFlow(k)) propagated(k, unknown);
  for (const k of oofsOf(b)) propagated(k, unknown);
}

function propagated(n: LayoutNode, unknown: ReadonlySet<string>): void {
  if (n.kind === 'replaced' || scrollContainer(n) || (n.style.overflowX === 'clip' && n.style.overflowY === 'clip') || n.style.containLayout) return;
  overflowOf(n, unknown);
}

/** The plain boxes controlsAsBoxes made of controls, which lay their contents out in a new formatting context (block.ts). */
const buttons = new WeakSet<object>();

/** box.ts establishesFormattingContext, without the planted engine fault; overflow.ts isFcRoot also counts a block button. */
const fcRoot = (b: LayoutNode): boolean =>
  b.kind === 'replaced' || buttons.has(b) || b.style.display !== 'block' || scrollContainer(b) || b.style.containLayout || b.style.containPaint || b.style.containSize !== 'none';

/** readFlow and readChild from a block flow: a percentage or stretch height whose end margins may collapse through it is refused. */
function flow(b: LayoutBox): void {
  if (b.style.display !== 'block' || hasInlineContent(b)) return;
  floatIn(b);
  for (const k of b.children) {
    if (!isNode(k) || outOfFlow(k) || k.kind === 'replaced' || fcRoot(k)) continue;
    flow(k);
    const endMayCollapse = !positivePx(k.style.borderBottomWidth) && !positivePx(k.style.paddingBottom) && k.children.some((c) => isNode(c) && !outOfFlow(c));
    const h = k.style.height;
    if (h.kind !== 'auto' && (h.kind === 'stretch' || mayHavePercent(h)) && endMayCollapse) {
      throw new Undecided(k.id, 'a percentage or stretch height on a box whose end margins may collapse through it: its basis is not decided here');
    }
  }
}

/**
 * overflow.ts controlChecked: a block button, fieldset or legend is its plain box, so the walk sees it as one, and so is a placeholder
 * or a text field, textarea or editor that clips on both axes; any other control, or a control that is a scroll container, is
 * refused (FORM-a).
 */
function controlsAsBoxes(b: LayoutBox): { readonly root: LayoutBox; readonly refused: Undecided | null } {
  let refused: Undecided | null = null;
  const plain = (x: LayoutBox | ControlBox, hidden: boolean): LayoutBox => {
    if (x.kind === 'control' && refused === null && !hidden) {
      const k = x.control.kind;
      // A placeholder, and a text field, textarea or editor that clips on both axes (as the native lowering makes them), add their border box.
      if (k === 'text-placeholder' || k === 'select-menulist' || ((k === 'text-field' || k === 'text-area' || k === 'text-editor') && x.style.overflowX === 'clip' && x.style.overflowY === 'clip')) {
        // Its border box, as a plain box's.
      } else if (k !== 'button-block' && k !== 'fieldset' && k !== 'legend' && k !== 'theme-leaf') refused = new Undecided(x.id, `a ${x.control.kind} form control: its scrollable overflow is not decided here (FORM-a)`);
      else if (scrollContainer(x)) refused = new Undecided(x.id, 'a form control that is a scroll container: its scrollable overflow is not decided here (FORM-a)');
    }
    // A clipping textarea's or menulist select's parts are in no box's scrollable overflow, so they are not checked; checkSelect
    // refuses a select's own overflow, so a menulist is never a scroll container here or in the engine.
    const menuList = x.kind === 'control' && x.control.kind === 'select-menulist';
    const inner = hidden || menuList || (x.kind === 'control' && x.control.kind === 'text-area' && x.style.overflowX === 'clip' && x.style.overflowY === 'clip');
    const children = x.children.map((k) => (k.kind === 'box' || k.kind === 'control' ? plain(k, inner) : k));
    // Chrome clips a menulist select's contents (its control clip), as overflow: clip does.
    const style: LayoutStyle = menuList ? { ...x.style, overflowX: 'clip', overflowY: 'clip' } : x.style;
    const box = { kind: 'box', id: x.id, boxType: x.boxType, style, strut: x.strut, marker: x.kind === 'box' ? x.marker : null, children } as LayoutBox;
    if (x.kind === 'control') buttons.add(box);
    return box;
  };
  const root = plain(b, false);
  return { root, refused };
}

/** Every auto or scroll container of a lowered tree whose scroll range the engine may refuse, in preorder, with the first reason. */
export function undecidedScrollContainers(root: LayoutBox): ScrollUndecided[] {
  const out: ScrollUndecided[] = [];
  const { root: plainRoot, refused: control } = controlsAsBoxes(root);
  root = plainRoot;
  const unknown = unknownPadding(root);
  const walk = (b: LayoutNode): void => {
    if (userScrolls(b) && b.kind === 'box') {
      try {
        if (control !== null) throw control;
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
