// Entry point: lays out a validated LayoutInput and returns boxes relative to the parent border box, in LU: the in-flow boxes in
// preorder, then each absolutely positioned box (after its parent and containing block) with its subtree.
import type { InsetValue, LayoutBox, LayoutInput, LayoutNode } from './input.ts';
import type { LU } from './units.ts';
import { add, fromCssPx, max, min, sub, ZERO } from './units.ts';
import type { Frag, OutOfFlow, StaticAxis } from './box.ts';
import { hasPercent, isScrollContainer, resolveBorder, resolveLength, resolveMarginWith, resolvePaddingWith } from './box.ts';
import type { EnvironmentDependencies } from './environment.ts';
import { applyEnvironment, environmentDependencies, resolveEnvironment } from './environment.ts';
import type { Ctx, EngineFaults } from './block.ts';
import { blockLevelInlineSize, directionOf, layoutContents, NO_ENGINE_FAULTS } from './block.ts';
import type { GridFaults } from './grid.ts';
import { NO_GRID_FAULTS } from './grid.ts';
import type { ContainingBlock, RelativeOffset } from './position.ts';
import { layoutAbsolute, relativeOffsetWith } from './position.ts';
import type { TextMeasurer } from './text.ts';
import { ahemMeasurerWith } from './text.ts';
import type { LayoutUnsupported } from './unsupported.ts';
import { unsupported, UnsupportedSignal } from './unsupported.ts';

/** A box, text leaf or line fragment (<leaf>:line<j>), relative to its parent's border box; parent is null for the root. */
export type LayoutRect = { readonly id: string; readonly parent: string | null; readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

/** dependencies: the environment inputs the input reads (environment.ts), so a host re-lays out only when one of them changes. */
export type LayoutResult =
  | { readonly kind: 'ok'; readonly boxes: readonly LayoutRect[]; readonly dependencies: EnvironmentDependencies }
  | { readonly kind: 'unsupported'; readonly unsupported: LayoutUnsupported };

// CSS2 §10.1 and §10.3.3: the root box is block-level in the initial containing block (the viewport), whose direction is the
// root's own; root margins never collapse.
export function layout(input: LayoutInput, measurer: TextMeasurer): LayoutResult {
  return layoutWithFaults(input, measurer, NO_ENGINE_FAULTS);
}

/** An absolutely positioned box waiting for placement: its parent's absolute border-box origin and its static position there. */
type Pending = { readonly oof: OutOfFlow; readonly parent: string; readonly originX: LU; readonly originY: LU };

/** A border box in absolute LU. */
type AbsoluteRect = { readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

/** A sticky box and its parent, whose content box is its containing block (css-position-3 §3.4). */
type Sticky = { readonly box: LayoutNode; readonly parent: LayoutBox };

/** The sticky boxes by id, with the layout context and the viewport, their scrollport at scroll offset 0. */
type StickyIndex = { readonly ctx: Ctx; readonly boxes: Map<string, Sticky>; readonly width: LU; readonly height: LU };

type Placement = {
  readonly boxes: LayoutRect[];
  readonly absolute: Map<string, AbsoluteRect>;
  readonly pending: Pending[];
  readonly inflow: InflowBounds[];
  readonly sticky: StickyIndex;
};

/** A grid scroll container's inflow bounds (Frag.inflow) in its border box; overflow.ts reads them for its scrollable overflow. */
export type InflowBounds = { readonly id: string; readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

/** A layout with the inflow bounds its grid scroll containers set (empty when it is refused). */
export type LayoutWithInflow = { readonly result: LayoutResult; readonly inflow: readonly InflowBounds[] };

/** layout with seeded engine errors; only the parity harness's planted tests pass anything but NO_ENGINE_FAULTS. */
export function layoutWithFaults(given: LayoutInput, measurer: TextMeasurer, faults: EngineFaults): LayoutResult {
  return layoutWithGridFaults(given, measurer, faults, NO_GRID_FAULTS);
}

/** layoutWithFaults with seeded grid errors; only the G-P differential test passes anything but NO_GRID_FAULTS. */
export function layoutWithGridFaults(given: LayoutInput, measurer: TextMeasurer, faults: EngineFaults, gridFaults: GridFaults): LayoutResult {
  return layoutWithInflow(given, measurer, faults, gridFaults).result;
}

/** layoutWithGridFaults with the inflow bounds of its grid scroll containers (overflow.ts). */
export function layoutWithInflow(given: LayoutInput, measurer: TextMeasurer, faults: EngineFaults, gridFaults: GridFaults): LayoutWithInflow {
  const m = layoutMeasurer(measurer, faults);
  try {
    const input = resolvedInput(given, measurer, faults);
    const root = input.root;
    const icbWidth = fromCssPx(input.viewport.width);
    const icbHeight = fromCssPx(input.viewport.height);
    const ctx: Ctx = { measurer: m, devicePixelRatio: input.devicePixelRatio, faults, gridFaults };
    const icbDirection = directionOf(ctx, root);
    // The root element establishes a block formatting context in the initial containing block.
    const inline = blockLevelInlineSize(ctx, root, icbWidth, icbDirection, { bfcLineOffset: ZERO, borderBoxWidth: icbWidth, lineLeft: ZERO, newFormattingContext: true });
    const r = layoutContents(ctx, root, {
      cbInline: icbWidth,
      borderBoxWidth: inline.borderBoxWidth,
      forcedBorderBoxHeight: null,
      forcedHeightDefinite: false,
      heightBasis: { kind: 'definite', value: icbHeight },
      formattingContextRoot: true,
      bfcLineOffset: ZERO,
    });
    const offset = relativeOffsetWith(root, icbWidth, { kind: 'definite', value: icbHeight }, icbDirection, ctx.faults);
    if (root.style.position === 'sticky') unsupported('sticky', root.id, 'css-position-3 §3.4', `the root box ${root.id} has no containing block to stick in`);
    const sticky = new Map<string, Sticky>();
    collectSticky(root, null, null, sticky);
    const out: Placement = { boxes: [], absolute: new Map(), pending: [], inflow: [], sticky: { ctx, boxes: sticky, width: icbWidth, height: icbHeight } };
    flatten(r.frag, null, add(inline.x, offset.dx), add(inline.marginTop, offset.dy), ZERO, ZERO, out);
    placeOutOfFlow(ctx, input, out, { x: ZERO, y: ZERO, width: icbWidth, height: icbHeight, direction: icbDirection });
    return { result: { kind: 'ok', boxes: out.boxes, dependencies: environmentDependencies(given) }, inflow: out.inflow };
  } catch (e) {
    if (e instanceof UnsupportedSignal) return { result: { kind: 'unsupported', unsupported: e.unsupported }, inflow: [] };
    throw e;
  }
}

function flatten(frag: Frag, parent: string | null, inFlowX: LU, inFlowY: LU, parentX: LU, parentY: LU, out: Placement): void {
  let x = inFlowX;
  let y = inFlowY;
  const st = out.sticky.boxes.get(frag.id);
  if (st !== undefined) {
    const shift = stickyOffset(out.sticky, st, add(parentX, x), add(parentY, y), frag.width, frag.height, out);
    x = add(x, shift.dx);
    y = add(y, shift.dy);
  }
  const absX = add(parentX, x);
  const absY = add(parentY, y);
  out.boxes.push({ id: frag.id, parent, x, y, width: frag.width, height: frag.height });
  out.absolute.set(frag.id, { x: absX, y: absY, width: frag.width, height: frag.height });
  if (frag.inflow !== null) out.inflow.push({ id: frag.id, x: frag.inflow.x, y: frag.inflow.y, width: frag.inflow.width, height: frag.inflow.height });
  for (const oof of frag.outOfFlow) out.pending.push({ oof, parent: frag.id, originX: absX, originY: absY });
  for (const c of frag.children) flatten(c.frag, frag.id, c.x, c.y, absX, absY, out);
}

/**
 * The sticky boxes under b by id. The engine offsets a sticky box against the viewport only: one inside a scroll container (whose
 * scroll offset would move it) or inside another sticky box is refused, and so are an inline-level one (placed by a line box) and
 * a percentage padding on its parent (its containing block, resolved after layout here).
 */
function collectSticky(b: LayoutBox, scroller: string | null, within: string | null, out: Map<string, Sticky>): void {
  for (const c of b.children) {
    if (c.kind !== 'box' && c.kind !== 'replaced') continue;
    let sticky = within;
    if (c.style.position === 'sticky') {
      const spec = 'css-position-3 §3.4';
      if (scroller !== null) unsupported('sticky', c.id, spec, `the sticky ${c.id} inside the scroll container ${scroller} would follow its scroll offset`);
      if (within !== null) unsupported('sticky', c.id, spec, `the sticky ${c.id} inside the sticky ${within}`);
      if (c.style.display !== 'block' && c.style.display !== 'flex' && c.style.display !== 'grid') unsupported('sticky', c.id, spec, `the sticky ${c.id} in the inline formatting context of ${b.id}`);
      const s = b.style;
      if (hasPercent(s.paddingTop) || hasPercent(s.paddingRight) || hasPercent(s.paddingBottom) || hasPercent(s.paddingLeft)) {
        unsupported('sticky', c.id, spec, `a percentage padding on ${b.id}, the containing block of the sticky ${c.id}`);
      }
      out.set(c.id, { box: c, parent: b });
      sticky = c.id;
    }
    if (c.kind === 'box') collectSticky(c, isScrollContainer(c.style) ? c.id : scroller, sticky, out);
  }
}

function stickyInset(v: InsetValue, basis: LU, ctx: Ctx): LU | null {
  return v.kind === 'auto' ? null : resolveLength(v, basis, ctx.faults);
}

/**
 * css-position-3 §3.4 at scroll offset 0 (Blink StickyPositionScrollingConstraints::ComputeStickyOffset, measured against Chrome
 * 145 in fixture group sticky): the shift that keeps a sticky border box (at x, y in absolute LU, in flow) inside the viewport less
 * its insets (percentages of the viewport), as far as its containing block, the parent's content box less the box's own margins
 * (auto as 0, percentages of that content box's width), lets it go. right then left, bottom then top, each against the in-flow box.
 */
function stickyOffset(st: StickyIndex, s: Sticky, x: LU, y: LU, width: LU, height: LU, out: Placement): RelativeOffset {
  const ctx = st.ctx;
  const r = out.absolute.get(s.parent.id);
  if (r === undefined) throw new Error(`containing block ${s.parent.id} of the sticky ${s.box.id} is not placed yet`);
  const ps = s.parent.style;
  const bor = resolveBorder(ps, ctx.devicePixelRatio);
  const pad = resolvePaddingWith(ps, ZERO, ctx.faults);
  const contentLeft = add(add(r.x, bor.left), pad.left);
  const contentRight = sub(sub(add(r.x, r.width), bor.right), pad.right);
  const contentWidth = sub(contentRight, contentLeft);
  const bs = s.box.style;
  const cbLeft = add(contentLeft, resolveMarginWith(bs.marginLeft, contentWidth, ctx.faults).value);
  const cbRight = sub(contentRight, resolveMarginWith(bs.marginRight, contentWidth, ctx.faults).value);
  const cbTop = add(add(add(r.y, bor.top), pad.top), resolveMarginWith(bs.marginTop, contentWidth, ctx.faults).value);
  const cbBottom = sub(sub(sub(add(r.y, r.height), bor.bottom), pad.bottom), resolveMarginWith(bs.marginBottom, contentWidth, ctx.faults).value);
  const right = stickyInset(bs.right, st.width, ctx);
  const left = stickyInset(bs.left, st.width, ctx);
  const bottom = stickyInset(bs.bottom, st.height, ctx);
  const top = stickyInset(bs.top, st.height, ctx);
  let dx = ZERO;
  let dy = ZERO;
  if (right !== null) {
    const delta = max(sub(sub(st.width, right), add(x, width)), sub(cbLeft, x));
    if (delta < 0) dx = add(dx, delta);
  }
  if (left !== null) {
    const delta = min(sub(left, x), sub(cbRight, add(x, width)));
    if (delta > 0) dx = add(dx, delta);
  }
  if (bottom !== null) {
    const delta = max(sub(sub(st.height, bottom), add(y, height)), sub(cbTop, y));
    if (delta < 0) dy = add(dy, delta);
  }
  if (top !== null) {
    const delta = min(sub(top, y), sub(cbBottom, add(y, height)));
    if (delta > 0) dy = add(dy, delta);
  }
  return { dx, dy };
}

/** Every box's parent in the input tree. */
function parents(root: LayoutBox): Map<string, LayoutBox> {
  const out = new Map<string, LayoutBox>();
  const walk = (b: LayoutBox): void => {
    for (const c of b.children) {
      if (c.kind !== 'box') continue;
      out.set(c.id, b);
      walk(c);
    }
  };
  walk(root);
  return out;
}

// CSS2 §10.1 items 4 and 1: the containing block of an absolutely positioned box is the padding box of its nearest positioned
// ancestor, or the initial containing block (planted fault cbIgnoresPadding uses the content box, px padding only). Item 3: a
// fixed box's is the viewport, which at scroll offset 0 is the initial containing block (POSX-f).
function containingBlock(ctx: Ctx, box: LayoutBox, parentOf: Map<string, LayoutBox>, out: Placement, icb: ContainingBlock): ContainingBlock {
  if (box.style.position === 'fixed') return icb;
  let at = parentOf.get(box.id);
  while (at !== undefined && at.style.position === 'static') at = parentOf.get(at.id);
  if (at === undefined) return icb;
  const r = out.absolute.get(at.id);
  if (r === undefined) throw new Error(`containing block ${at.id} of ${box.id} is not placed yet`);
  const bor = resolveBorder(at.style, ctx.devicePixelRatio);
  const s = at.style;
  const pad = (v: typeof s.paddingLeft): LU => (ctx.faults.cbIgnoresPadding && v.kind === 'px' ? fromCssPx(v.value) : ZERO);
  const left = add(bor.left, pad(s.paddingLeft));
  const top = add(bor.top, pad(s.paddingTop));
  const right = add(bor.right, pad(s.paddingRight));
  const bottom = add(bor.bottom, pad(s.paddingBottom));
  return {
    x: add(r.x, left),
    y: add(r.y, top),
    width: sub(sub(r.width, left), right),
    height: sub(sub(r.height, top), bottom),
    direction: directionOf(ctx, at),
  };
}

/** The measurer a layout reads: planted platform-rule faults replace the Ahem measurer's two macOS rules (platform-rules.ts). */
export function layoutMeasurer(measurer: TextMeasurer, faults: EngineFaults): TextMeasurer {
  return faults.metricHalfUp || faults.untruncatedFontSize ? ahemMeasurerWith({ metricHalfUp: faults.metricHalfUp, untruncatedFontSize: faults.untruncatedFontSize }) : measurer;
}

/**
 * The input resolved for its environment as layoutWithFaults lays it out: ex, ch, cap and lh read the measurer's faces; a planted
 * platform rule reads the Ahem font data, as zoomInput (the device's) does. Post-layout passes (scroll metrics, the hit table)
 * resolve with it too. A face the measurer does not hold throws the text-glyph UnsupportedSignal.
 */
export function resolvedInput(given: LayoutInput, measurer: TextMeasurer, faults: EngineFaults): LayoutInput {
  return faults.metricHalfUp || faults.untruncatedFontSize ? zoomInput(given, faults) : resolveEnvironment(given, faults, layoutMeasurer(measurer, faults));
}

/** Places each pending absolutely positioned box in order; boxes found inside one are queued after it. */
function placeOutOfFlow(ctx: Ctx, input: LayoutInput, out: Placement, icb: ContainingBlock): void {
  const parentOf = parents(input.root);
  for (let i = 0; i < out.pending.length; i++) {
    const p = out.pending[i] as Pending;
    const area = p.oof.area;
    const own = containingBlock(ctx, p.oof.box, parentOf, out, icb);
    // css-grid-2 §9.1: a positioned grid parent is the containing block, and the child's grid area its rectangle.
    const cb: ContainingBlock = area === null ? own : { x: add(p.originX, area.x), y: add(p.originY, area.y), width: area.width, height: area.height, direction: own.direction };
    const staticX: StaticAxis = { offset: add(p.originX, p.oof.x.offset), edge: p.oof.x.edge };
    const staticY: StaticAxis = { offset: add(p.originY, p.oof.y.offset), edge: p.oof.y.edge };
    const r = layoutAbsolute(ctx, p.oof.box, cb, staticX, staticY);
    flatten(r.frag, p.parent, sub(r.x, p.originX), sub(r.y, p.originY), p.originX, p.originY, out);
  }
}

/**
 * The input in zoomed px, with devicePixelRatio 1 (a zoomed px is a device px), and every length and font resolved for its
 * environment with the Ahem font data and the planted font rules (environment.ts applyEnvironment): the engine lays out only
 * Ahem, and a device's bridge measurer is self-checked equal to it.
 */
export function zoomInput(input: LayoutInput, faults: EngineFaults): LayoutInput {
  return applyEnvironment(input, faults);
}

/** Absolute border-box edges in LU: parent offsets are summed in integers before any conversion. */
export function absoluteRects(boxes: readonly LayoutRect[]): Map<string, LayoutRect> {
  const abs = new Map<string, LayoutRect>();
  for (const b of boxes) {
    const parent = b.parent === null ? undefined : abs.get(b.parent);
    const px0 = parent === undefined ? (0 as LU) : parent.x;
    const py0 = parent === undefined ? (0 as LU) : parent.y;
    abs.set(b.id, { id: b.id, parent: b.parent, x: add(px0, b.x), y: add(py0, b.y), width: b.width, height: b.height });
  }
  return abs;
}
