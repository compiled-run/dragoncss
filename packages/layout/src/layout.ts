// Entry point: lays out a validated LayoutInput and returns boxes relative to the parent border box, in LU: the in-flow boxes in
// preorder, then each absolutely positioned box (after its parent and containing block) with its subtree.
import type { Auto, BorderWidthValue, ContentValue, GridContainerStyle, LayoutBox, LayoutInput, LayoutStyle, LineHeightValue, NoneValue, NormalValue, NumberValue, Percent, Px, TextLeaf, TrackBreadth, TrackRepeater, TrackSize } from './input.ts';
import type { LU } from './units.ts';
import { add, fromCssPx, sub, zoomCssPx, zoomFontSize, zoomViewportPx, ZERO } from './units.ts';
import type { Frag, OutOfFlow, StaticAxis } from './box.ts';
import { resolveBorder } from './box.ts';
import type { Ctx, EngineFaults } from './block.ts';
import { blockLevelInlineSize, directionOf, layoutContents, NO_ENGINE_FAULTS } from './block.ts';
import type { ContainingBlock } from './position.ts';
import { layoutAbsolute, relativeOffset } from './position.ts';
import type { TextMeasurer } from './text.ts';
import { ahemMeasurerWith } from './text.ts';
import type { LayoutUnsupported } from './unsupported.ts';
import { UnsupportedSignal } from './unsupported.ts';

/** A box, text leaf or line fragment (<leaf>:line<j>), relative to its parent's border box; parent is null for the root. */
export type LayoutRect = { readonly id: string; readonly parent: string | null; readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

export type LayoutResult =
  | { readonly kind: 'ok'; readonly boxes: readonly LayoutRect[] }
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
  const input = zoomInput(given, faults);
  const root = input.root;
  const icbWidth = fromCssPx(input.viewport.width);
  const icbHeight = fromCssPx(input.viewport.height);
  try {
    // Planted platform-rule faults replace the Ahem measurer's two macOS rules (platform-rules.ts).
    const m = faults.metricHalfUp || faults.untruncatedFontSize ? ahemMeasurerWith({ metricHalfUp: faults.metricHalfUp, untruncatedFontSize: faults.untruncatedFontSize }) : measurer;
    const ctx: Ctx = { measurer: m, devicePixelRatio: input.devicePixelRatio, faults };
    const icbDirection = directionOf(ctx, root);
    const inline = blockLevelInlineSize(ctx, root, icbWidth, icbDirection);
    const r = layoutContents(ctx, root, {
      cbInline: icbWidth,
      borderBoxWidth: inline.borderBoxWidth,
      forcedBorderBoxHeight: null,
      forcedHeightDefinite: false,
      heightBasis: { kind: 'definite', value: icbHeight },
      formattingContextRoot: true,
    });
    const offset = relativeOffset(root, icbWidth, { kind: 'definite', value: icbHeight }, icbDirection);
    const out: Placement = { boxes: [], absolute: new Map(), pending: [] };
    flatten(r.frag, null, add(inline.marginLeft, offset.dx), add(inline.marginTop, offset.dy), ZERO, ZERO, out);
    placeOutOfFlow(ctx, input, out, { x: ZERO, y: ZERO, width: icbWidth, height: icbHeight, direction: icbDirection });
    return { kind: 'ok', boxes: out.boxes };
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

// Device zoom (vectors/README.md, Device pixel ratios): at DPR N every CSS length and font size is multiplied by N on entry, the
// font rules apply to the zoomed size, and the engine lays out in zoomed px, where borders snap to whole px. Output LU are 1/64
// device px; CSS px = LU / (64 * N). An initial line width (device-px, R5) is already in device px and is not multiplied. At DPR 1
// the input is returned as given.

/** The input in zoomed px, with devicePixelRatio 1 (a zoomed px is a device px); the input itself at DPR 1. */
export function zoomInput(input: LayoutInput, faults: EngineFaults): LayoutInput {
  const z = input.devicePixelRatio;
  if (z === 1) return input;
  return {
    viewport: { width: zoomViewportPx(input.viewport.width, z), height: zoomViewportPx(input.viewport.height, z) },
    devicePixelRatio: 1,
    root: zoomBox(input.root, z, faults),
  };
}

function zoomBox(b: LayoutBox, z: number, faults: EngineFaults): LayoutBox {
  const children = b.children.map((c): LayoutBox | TextLeaf => (c.kind === 'box' ? zoomBox(c, z, faults) : zoomText(c, z)));
  return { kind: 'box', id: b.id, boxType: b.boxType, style: zoomStyle(b.style, z, faults), children };
}

function zoomText(t: TextLeaf, z: number): TextLeaf {
  return { ...t, font: { family: t.font.family, size: zoomFontSize(t.font.size, z) }, lineHeight: zoomLineHeight(t.lineHeight, z) };
}

function zoomStyle(s: LayoutStyle, z: number, faults: EngineFaults): LayoutStyle {
  return {
    ...s,
    top: zoomLength(s.top, z),
    right: zoomLength(s.right, z),
    bottom: zoomLength(s.bottom, z),
    left: zoomLength(s.left, z),
    width: zoomLength(s.width, z),
    height: zoomLength(s.height, z),
    minWidth: zoomLength(s.minWidth, z),
    minHeight: zoomLength(s.minHeight, z),
    maxWidth: zoomMax(s.maxWidth, z),
    maxHeight: zoomMax(s.maxHeight, z),
    marginTop: zoomLength(s.marginTop, z),
    marginRight: zoomLength(s.marginRight, z),
    marginBottom: zoomLength(s.marginBottom, z),
    marginLeft: zoomLength(s.marginLeft, z),
    paddingTop: zoomPadding(s.paddingTop, z),
    paddingRight: zoomPadding(s.paddingRight, z),
    paddingBottom: zoomPadding(s.paddingBottom, z),
    paddingLeft: zoomPadding(s.paddingLeft, z),
    borderTopWidth: zoomBorder(s.borderTopWidth, z, faults),
    borderRightWidth: zoomBorder(s.borderRightWidth, z, faults),
    borderBottomWidth: zoomBorder(s.borderBottomWidth, z, faults),
    borderLeftWidth: zoomBorder(s.borderLeftWidth, z, faults),
    flexBasis: zoomBasis(s.flexBasis, z),
    rowGap: zoomGap(s.rowGap, z),
    columnGap: zoomGap(s.columnGap, z),
    grid: s.grid === null ? null : zoomGrid(s.grid, z),
  };
}

/** Grid track sizes: px breadths and fit-content limits are zoomed; %, fr and the keywords are not. */
function zoomGrid(g: GridContainerStyle, z: number): GridContainerStyle {
  const repeaters = (rs: readonly TrackRepeater[]): TrackRepeater[] => rs.map((r): TrackRepeater => ({ count: r.count, sizes: r.sizes.map((t) => zoomTrack(t, z)) }));
  return {
    ...g,
    templateColumns: repeaters(g.templateColumns),
    templateRows: repeaters(g.templateRows),
    autoColumns: g.autoColumns.map((t) => zoomTrack(t, z)),
    autoRows: g.autoRows.map((t) => zoomTrack(t, z)),
  };
}

function zoomTrack(t: TrackSize, z: number): TrackSize {
  if (t.kind === 'breadth') return { kind: 'breadth', breadth: zoomBreadth(t.breadth, z) };
  if (t.kind === 'minmax') return { kind: 'minmax', min: zoomBreadth(t.min, z), max: zoomBreadth(t.max, z) };
  return { kind: 'fit-content', limit: t.limit.kind === 'px' ? zoomPx(t.limit, z) : t.limit };
}

function zoomBreadth(b: TrackBreadth, z: number): TrackBreadth {
  return b.kind === 'px' ? zoomPx(b, z) : b;
}

function zoomPx(v: Px, z: number): Px {
  return { kind: 'px', value: zoomCssPx(v.value, z) };
}

/** R5: a device-px initial line width keeps its value at every zoom; the planted spec reading zooms it like CSS px. */
function zoomBorder(v: BorderWidthValue, z: number, faults: EngineFaults): BorderWidthValue {
  if (v.kind === 'px') return zoomPx(v, z);
  if (faults.initialLineWidthZoomed) return { kind: 'device-px', value: zoomCssPx(v.value, z) };
  return v;
}

function zoomLength(v: Px | Percent | Auto, z: number): Px | Percent | Auto {
  return v.kind === 'px' ? zoomPx(v, z) : v;
}

function zoomMax(v: Px | Percent | NoneValue, z: number): Px | Percent | NoneValue {
  return v.kind === 'px' ? zoomPx(v, z) : v;
}

function zoomPadding(v: Px | Percent, z: number): Px | Percent {
  return v.kind === 'px' ? zoomPx(v, z) : v;
}

function zoomBasis(v: Px | Percent | Auto | ContentValue, z: number): Px | Percent | Auto | ContentValue {
  return v.kind === 'px' ? zoomPx(v, z) : v;
}

function zoomGap(v: Px | Percent | NormalValue, z: number): Px | Percent | NormalValue {
  return v.kind === 'px' ? zoomPx(v, z) : v;
}

/** Numbers multiply the zoomed font size, so only px line heights are zoomed. */
function zoomLineHeight(v: NormalValue | NumberValue | Px, z: number): LineHeightValue {
  return v.kind === 'px' ? zoomPx(v, z) : v;
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
