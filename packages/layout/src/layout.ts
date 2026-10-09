// Entry point: lays out a validated LayoutInput and returns boxes relative to the parent border box, in LU: the in-flow boxes in
// preorder, then each absolutely positioned box (after its parent and containing block) with its subtree.
import type { LayoutBox, LayoutInput } from './input.ts';
import type { LU } from './units.ts';
import { add, fromCssPx, sub, ZERO } from './units.ts';
import type { Frag, OutOfFlow, StaticAxis } from './box.ts';
import { resolveBorder } from './box.ts';
import type { EnvironmentDependencies } from './environment.ts';
import { applyEnvironment, environmentDependencies, resolveEnvironment } from './environment.ts';
import type { Ctx, EngineFaults } from './block.ts';
import { blockLevelInlineSize, directionOf, layoutContents, NO_ENGINE_FAULTS } from './block.ts';
import type { GridFaults } from './grid.ts';
import { NO_GRID_FAULTS } from './grid.ts';
import type { ContainingBlock } from './position.ts';
import { layoutAbsolute, relativeOffsetWith } from './position.ts';
import type { TextMeasurer } from './text.ts';
import { ahemMeasurerWith } from './text.ts';
import type { LayoutUnsupported } from './unsupported.ts';
import { UnsupportedSignal } from './unsupported.ts';

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

type Placement = { readonly boxes: LayoutRect[]; readonly absolute: Map<string, AbsoluteRect>; readonly pending: Pending[] };

/** layout with seeded engine errors; only the parity harness's planted tests pass anything but NO_ENGINE_FAULTS. */
export function layoutWithFaults(given: LayoutInput, measurer: TextMeasurer, faults: EngineFaults): LayoutResult {
  return layoutWithGridFaults(given, measurer, faults, NO_GRID_FAULTS);
}

/** layoutWithFaults with seeded grid errors; only the G-P differential test passes anything but NO_GRID_FAULTS. */
export function layoutWithGridFaults(given: LayoutInput, measurer: TextMeasurer, faults: EngineFaults, gridFaults: GridFaults): LayoutResult {
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
    const out: Placement = { boxes: [], absolute: new Map(), pending: [] };
    flatten(r.frag, null, add(inline.x, offset.dx), add(inline.marginTop, offset.dy), ZERO, ZERO, out);
    placeOutOfFlow(ctx, input, out, { x: ZERO, y: ZERO, width: icbWidth, height: icbHeight, direction: icbDirection });
    return { kind: 'ok', boxes: out.boxes, dependencies: environmentDependencies(given) };
  } catch (e) {
    if (e instanceof UnsupportedSignal) return { kind: 'unsupported', unsupported: e.unsupported };
    throw e;
  }
}

function flatten(frag: Frag, parent: string | null, x: LU, y: LU, parentX: LU, parentY: LU, out: Placement): void {
  const absX = add(parentX, x);
  const absY = add(parentY, y);
  out.boxes.push({ id: frag.id, parent, x, y, width: frag.width, height: frag.height });
  out.absolute.set(frag.id, { x: absX, y: absY, width: frag.width, height: frag.height });
  for (const oof of frag.outOfFlow) out.pending.push({ oof, parent: frag.id, originX: absX, originY: absY });
  for (const c of frag.children) flatten(c.frag, frag.id, c.x, c.y, absX, absY, out);
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
// ancestor, or the initial containing block (planted fault cbIgnoresPadding uses the content box, px padding only).
function containingBlock(ctx: Ctx, box: LayoutBox, parentOf: Map<string, LayoutBox>, out: Placement, icb: ContainingBlock): ContainingBlock {
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
    const cb = containingBlock(ctx, p.oof.box, parentOf, out, icb);
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
