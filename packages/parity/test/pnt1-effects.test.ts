// PNT1 opacity and stacking on the host (T046 §2): the effects fixtures' points against the committed Chrome PNGs at every device DPR.
// A paint model of Chrome 145's CPU raster predicts each sample: boxes, borders and glyphs painted in the program's Appendix E order
// (the stacking facts), moved by their whole-device-px translations, clipped by the overflow clips of their containing-block chain,
// and each opacity group composited as Chrome
// does: a group whose only drawing (in the raster tile of the pixel) is one foldable draw has the alpha folded into it (Chromium
// 145.0.7632.6 cc/paint/paint_op_buffer_iterator.cc:13-146) and is blitted as a solid colour (Skia 2ab8add5
// src/opts/SkBlitRow_opts.h:243-270 blit_row_color32: premultiplied colour + dst * (256 - a) >> 8); any other group is a layer
// composited with blit_row_s32a_blend (src/core/SkBlitRow_D32.cpp:204-301, src/core/SkColorData.h:134-137 SkAlphaMulInv256:
// (src * (a + 1) + dst * SkAlphaMulInv256(srcA, a + 1)) >> 8). The
// alpha byte is paint.ts opacityAlpha8, the one the device uses. Every sample colour must equal Chrome's exactly, which proves the
// paint order, the group opacity and the alpha byte before any device runs. Chrome's composite is measured, not assumed: the first
// test fits the two blits and the byte against a captured sweep of opacities.
import { describe, expect, it } from 'vitest';
import { groupComposite, groupFill, groupFilterComposite, groupFilterMatrices, groupFoldAlpha, groupTileFoldIndex, groupTileFolds, opacityAlpha8, snapEdges } from '@dragon/layout';
import { filterPairs } from '../../dragon/src/emit/paint/effects.ts';
import { ccTileEnd, ccTileIndex, ccTileSize, ccTileStart } from '../../layout/src/paint-dither.ts';
import type { NativeProgram, ProgramNode } from 'dragon';
import { androidProfile, borderDevicePx, createProjectWith, engineLayoutProjection, iosProfile, laneOnlyNative, nativePrograms, NO_FAULTS, programInput, webProfile } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS, FIXTURES as CORPUS } from '../src/fixtures.ts';
import { expectedEngine, nativeCompile, nativeCompileOnce } from '../src/native-host.ts';
import { casePoints, committedPixels, devicePoints, glyphLines } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import { shapedCaseIds } from '../src/text-latin-run.ts';

type Px = [number, number, number, number];
type FilterFunction = { readonly name: Parameters<typeof filterPairs>[0][number]['name']; readonly amount: number };

/** A packed pixel (paint-group.ts: r + g * 2^8 + b * 2^16 + a * 2^24) as bytes. */
const unpack = (v: number): Px => [v % 256, Math.floor(v / 256) % 256, Math.floor(v / 65536) % 256, Math.floor(v / 16777216) % 256];

/** SkMulDiv255Round. */
const mdr = (a: number, b: number): number => {
  const p = a * b + 128;
  return (p + (p >> 8)) >> 8;
};

/** Skia's SkBlitRow::Color32 (blit_row_color32): a premultiplied solid colour of alpha a over a premultiplied dst. */
export function color32(dst: Px, c: { r: number; g: number; b: number }, a: number): Px {
  if (a === 0) return dst;
  const src: Px = [mdr(c.r, a), mdr(c.g, a), mdr(c.b, a), a];
  if (a === 255) return src;
  const inv = 256 - a;
  return [0, 1, 2, 3].map((k) => (src[k] as number) + (((dst[k] as number) * inv) >> 8)) as Px;
}

/** Skia's blit_row_s32a_blend (NEON and portable give the same bytes for these inputs): a premultiplied layer pixel at alpha a over dst. */
export function s32aBlend(dst: Px, src: Px, a: number): Px {
  const a256 = a + 1;
  const prod = 0xffff - (src[3] as number) * a256;
  const ds = (prod + (prod >> 8)) >> 8;
  return [0, 1, 2, 3].map((k) => (((src[k] as number) * a256 + (dst[k] as number) * ds) & 0xffff) >> 8) as Px;
}

describe('Chrome 145 composites opacity with Skia\'s getAlpha byte and the Color32 or s32a blit', () => {
  // Bytes the pinned Chrome gave in a sweep of 300 opacities (a folded single rect of rgb(10, 220, 130) over rgb(200, 40, 90), and a
  // two-draw group of it and rgb(250, 120, 10)), pinned here; the fixtures below check the same blits at every DPR.
  it('opacityAlpha8 is floorf(float(o) * 255 + 0.5f), so 0.3 is 77 and 0.9 is 230', () => {
    expect([0, 0.3, 0.5, 0.9, 1, 1.5, -1].map(opacityAlpha8)).toEqual([0, 77, 128, 230, 255, 255, 0]);
    expect(opacityAlpha8(0.872549)).toBe(223);
    expect(opacityAlpha8(0.817647)).toBe(208);
  });
  it('a clear layer pixel leaves dst unchanged at every alpha byte, so a nested layer is built over its own extent only', () => {
    for (let a8 = 0; a8 <= 255; a8++) {
      for (let d = 0; d <= 255; d++) {
        const da = 255 - ((d * 37) % 256);
        const pack = d + d * 256 + d * 65536 + da * 16777216;
        expect(groupComposite(0, 0, 0, 0, d, d, d, da, a8, false)).toBe(pack);
        expect(groupComposite(0, 0, 0, 0, d, d, d, da, a8, true)).toBe(pack);
        expect(s32aBlend([d, d, d, da], [0, 0, 0, 0], a8)).toEqual([d, d, d, da]);
      }
    }
  });
  it('the blits give the bytes the capture shows', () => {
    expect(color32([200, 40, 90, 255], { r: 10, g: 220, b: 130 }, opacityAlpha8(0.01))).toEqual([197, 42, 90, 255]);
    expect(color32([200, 40, 90, 255], { r: 10, g: 220, b: 130 }, opacityAlpha8(0.3))).toEqual([142, 93, 101, 255]);
    expect(color32([200, 40, 90, 255], { r: 10, g: 220, b: 130 }, opacityAlpha8(0.9))).toEqual([29, 202, 126, 255]);
    expect(s32aBlend([200, 40, 90, 255], [10, 220, 130, 255], opacityAlpha8(0.001961))).toEqual([198, 41, 90, 255]);
  });
});

// ---------------------------------------------------------------- the model

type Box = { readonly node: ProgramNode; readonly l: number; readonly t: number; readonly r: number; readonly b: number; readonly border: readonly number[] };

/** A node's translation in device px: its own and its ancestors' translate functions, each a whole number of device px. */
function translationOf(p: NativeProgram, id: string, dpr: number): [number, number] {
  let dx = 0;
  let dy = 0;
  for (let n = p.nodes.find((x) => x.id === id); n !== undefined; n = n.parent === null ? undefined : p.nodes.find((x) => x.id === n?.parent)) {
    const w = n.writes.find((x) => x.kind === 'transform');
    if (w === undefined || w.kind !== 'transform') continue;
    for (const o of w.ops) {
      if (!o.fn.startsWith('translate') || o.x.kind !== 'px' || o.y.kind !== 'px') throw new Error(`${n.id}: the model moves boxes by px translations only`);
      const [x, y] = [o.x.px * dpr, o.y.px * dpr];
      if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`${n.id}: a translation of ${o.x.px}, ${o.y.px} px is not whole device px at ${dpr}`);
      dx += x;
      dy += y;
    }
  }
  return [dx, dy];
}

/** The boxes of a program at a DPR with their snapped edges (moved by their translations) and device-px borders. */
function boxes(p: NativeProgram, viewport: { width: number; height: number }, dpr: number): Box[] {
  const engine = expectedEngine();
  const input = programInput(p, viewport, dpr);
  const out = engine.layout(input, engine.measurer);
  if (out.kind !== 'ok') throw new Error('the engine refused the case');
  const snapped = snapEdges(out.boxes);
  const borders = borderDevicePx(engine, input);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const list: Box[] = [];
  out.boxes.forEach((r, i) => {
    const n = byId.get(r.id);
    if (n === undefined || n.kind === 'text') return;
    const s = snapped[i] as { left: number; top: number; right: number; bottom: number };
    const [dx, dy] = translationOf(p, n.id, dpr);
    list.push({ node: n, l: s.left + dx, t: s.top + dy, r: s.right + dx, b: s.bottom + dy, border: borders.get(r.id) ?? [0, 0, 0, 0] });
  });
  return list;
}

type Stacking = { paintOrder: number; clipChain: readonly string[] };
type Item =
  | { readonly kind: 'box'; readonly box: Box }
  | { readonly kind: 'text'; readonly node: ProgramNode; readonly glyphs: readonly { left: number; top: number; right: number; bottom: number }[] }
  | { readonly kind: 'group'; readonly box: Box; readonly opacity: number; readonly alpha8: number; readonly matrices: readonly number[] | null; readonly items: readonly Item[] };

const stackingOf = (n: ProgramNode): Stacking => {
  const s = n.facts['stacking'] as Stacking | undefined;
  if (s === undefined) throw new Error(`${n.id}: no stacking facts`);
  return s;
};

/**
 * Planted model faults the test must catch: the alpha ignored (alpha-ignored), tree order instead of the paint order (order-swap),
 * and a colour-matrix filter list ignored (filter-ignored).
 */
type ModelFaults = { readonly alphaIgnored: boolean; readonly treeOrder: boolean; readonly filterIgnored?: boolean };
const NO_MODEL_FAULTS: ModelFaults = { alphaIgnored: false, treeOrder: false };

/** The case's paint items in Appendix E order, each opacity context holding its subtree's items as a group. */
function paintItems(p: NativeProgram, viewport: { width: number; height: number }, dpr: number, faults: ModelFaults = NO_MODEL_FAULTS): Item[] {
  const list = boxes(p, viewport, dpr);
  const byId = new Map(list.map((b) => [b.node.id, b]));
  const children = new Map<string, ProgramNode[]>();
  for (const n of p.nodes) if (n.parent !== null) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const glyphsOf = new Map<string, { left: number; top: number; right: number; bottom: number }[]>();
  for (const l of glyphLines(p, viewport, dpr)) {
    const id = l.id.slice(0, l.id.lastIndexOf(':line'));
    const [dx, dy] = translationOf(p, id, dpr);
    glyphsOf.set(id, [...(glyphsOf.get(id) ?? []), ...l.glyphs.map((g) => ({ left: g.left + dx, top: g.top + dy, right: g.right + dx, bottom: g.bottom + dy }))]);
  }
  const subtree = (n: ProgramNode): ProgramNode[] => [n, ...(children.get(n.id) ?? []).flatMap(subtree)];
  const item = (n: ProgramNode): Item => (n.kind === 'text' ? { kind: 'text', node: n, glyphs: glyphsOf.get(n.id) ?? [] } : { kind: 'box', box: byId.get(n.id) as Box });
  // A text leaf paints right after its box (a box's children are all boxes or all text leaves), so only boxes are sorted.
  const withText = (n: ProgramNode): Item[] => [item(n), ...(children.get(n.id) ?? []).filter((c) => c.kind === 'text').map(item)];
  const build = (nodes: readonly ProgramNode[]): Item[] => {
    const tree = new Map(p.nodes.map((x, k) => [x.id, k]));
    const rank = (x: ProgramNode): number => (faults.treeOrder ? (tree.get(x.id) as number) : stackingOf(x).paintOrder);
    const sorted = nodes.filter((x) => x.kind !== 'text').sort((a, b) => rank(a) - rank(b));
    const out: Item[] = [];
    for (let k = 0; k < sorted.length; k++) {
      const n = sorted[k] as ProgramNode;
      const effects = n.facts['effects'] as { opacity: number; filter?: readonly FilterFunction[] } | undefined;
      if (effects === undefined) {
        out.push(...withText(n));
        continue;
      }
      const inside = new Set(subtree(n).map((x) => x.id));
      const members = sorted.filter((x) => inside.has(x.id));
      // A stacking context is atomic: its subtree is contiguous in the paint order.
      if (sorted.slice(k, k + members.length).some((x) => !inside.has(x.id))) throw new Error(`${n.id}: its subtree is not contiguous in the paint order`);
      const filter = effects.filter ?? [];
      const matrices = filter.length === 0 ? null : groupFilterMatrices(faults.filterIgnored ? [] : filterPairs(filter));
      out.push({ kind: 'group', box: byId.get(n.id) as Box, opacity: faults.alphaIgnored ? 1 : effects.opacity, alpha8: faults.alphaIgnored ? 255 : opacityAlpha8(effects.opacity), matrices, items: [...withText(n), ...build(members.filter((x) => x !== n))] });
      k += members.length - 1;
    }
    return out;
  };
  return build(p.nodes);
}

const inside = (x: number, y: number, l: number, t: number, r: number, b: number): boolean => x >= l && x < r && y >= t && y < b;

/**
 * The draw ops of a box's display item: a background rect, then its border: four solid sides in one colour are one op (Blink
 * box_border_painter.cc:1255-1278 PaintBorderFastPath: a stroked rect or FillDRRect), and any other set of solid sides one FillRect
 * each (:1696-1751, 841-866). cc folds a group's alpha into a lone op of any kind but text (paint_op_buffer_iterator.cc:13-38), so a
 * display item of one op folds.
 */
function boxOps(b: Box): { readonly count: number; readonly foldable: boolean } {
  const bg = b.node.writes.find((w) => w.kind === 'background-color');
  const hasBg = bg !== undefined && bg.kind === 'background-color' && bg.color.alpha > 0;
  const styles = b.node.writes.find((w) => w.kind === 'border-styles');
  const colours = b.node.writes.find((w) => w.kind === 'border-colors');
  const shown = styles !== undefined && styles.kind === 'border-styles' ? [0, 1, 2, 3].filter((k) => styles.styles[k] !== 'none' && styles.styles[k] !== 'hidden' && (b.border[k] as number) > 0) : [];
  const key = (k: number): string => {
    const c = colours !== undefined && colours.kind === 'border-colors' ? colours.colors[k] : undefined;
    return styles !== undefined && styles.kind === 'border-styles' && c !== undefined ? `${styles.styles[k]} ${c.r},${c.g},${c.b},${c.alpha}` : '';
  };
  const uniform = shown.length === 4 && new Set(shown.map(key)).size === 1 && key(0).startsWith('solid ');
  const count = (hasBg ? 1 : 0) + (uniform ? 1 : shown.length);
  return { count, foldable: count === 1 };
}

type Tile = { l: number; t: number; r: number; b: number };
const meets = (tile: Tile, l: number, t: number, r: number, b: number): boolean => l < tile.r && r > tile.l && t < tile.b && b > tile.t;

/** The display items of a group's content in a tile: each box with ops, each text run, and nested groups as their own items. */
function tileItems(items: readonly Item[], tile: Tile): { direct: Item[]; nested: number } {
  const direct: Item[] = [];
  let nested = 0;
  for (const it of items) {
    if (it.kind === 'box' && boxOps(it.box).count > 0 && meets(tile, it.box.l, it.box.t, it.box.r, it.box.b)) direct.push(it);
    if (it.kind === 'text' && it.glyphs.some((g) => meets(tile, Math.floor(g.left), Math.floor(g.top), Math.ceil(g.right), Math.ceil(g.bottom)))) direct.push(it);
    if (it.kind === 'group') {
      const inner = tileItems(it.items, tile);
      nested += inner.direct.length + inner.nested;
    }
  }
  return { direct, nested };
}

/** Whether a pixel centre is outside a clip that applies to the node: a text leaf is clipped by its box's chain and the box itself. */
function clippedOut(n: ProgramNode, byId: ReadonlyMap<string, Box>, cx: number, cy: number): boolean {
  const parent = n.parent === null ? undefined : byId.get(n.parent);
  const chain = n.kind !== 'text' ? stackingOf(n).clipChain : parent === undefined ? [] : [...(parent.node.clips ? [parent.node.id] : []), ...stackingOf(parent.node).clipChain];
  for (const id of chain) {
    const a = byId.get(id) as Box;
    if (!inside(cx, cy, a.l + (a.border[3] as number), a.t + (a.border[0] as number), a.r - (a.border[1] as number), a.b - (a.border[2] as number))) return true;
  }
  return false;
}

/** One item painted onto a premultiplied pixel. */
function paintItem(dst: Px, it: Item, x: number, y: number, tile: Tile, byId: ReadonlyMap<string, Box>): Px {
  const cx = x + 0.5;
  const cy = y + 0.5;
  if (it.kind === 'text') {
    if (clippedOut(it.node, byId, cx, cy) || !it.glyphs.some((g) => cx > g.left && cx < g.right && cy > g.top && cy < g.bottom)) return dst;
    const c = it.node.writes.find((w) => w.kind === 'text-color');
    if (c === undefined || c.kind !== 'text-color') throw new Error(`${it.node.id}: no text colour`);
    return color32(dst, c.color, c.color.alpha);
  }
  if (it.kind === 'box') return paintBox(dst, it.box, cx, cy, byId, null);
  if (it.alpha8 === 0) return dst;
  // A filtered group is a layer drawn through the filter's colour matrices, then composited at its alpha; it never folds
  // (paint-group.ts groupFilterComposite, measured against Chrome 145).
  if (it.matrices !== null) {
    let layer: Px = [0, 0, 0, 0];
    for (const inner of it.items) layer = paintItem(layer, inner, x, y, tile, byId);
    return unpack(groupFilterComposite(layer[0], layer[1], layer[2], layer[3], dst[0], dst[1], dst[2], dst[3], it.matrices, it.alpha8));
  }
  // The group's one drawing in this tile, when it is a background rect, takes the alpha itself (cc folds the layer into it).
  const content = tileItems(it.items, tile);
  const only = content.direct[0];
  if (content.direct.length === 1 && content.nested === 0 && only !== undefined && only.kind === 'box' && boxOps(only.box).foldable) return paintBox(dst, only.box, cx, cy, byId, it.opacity);
  let layer: Px = [0, 0, 0, 0];
  for (const inner of it.items) layer = paintItem(layer, inner, x, y, tile, byId);
  return s32aBlend(dst, layer, it.alpha8);
}

/**
 * A box's background and solid border sides at a pixel centre; with fold, the opacity of the group folded into the box's one op,
 * which takes the colour's alpha times it in float (cc ScopedRasterFlags, measured: groupFoldAlpha).
 */
function paintBox(dst: Px, b: Box, cx: number, cy: number, byId: ReadonlyMap<string, Box>, fold: number | null): Px {
  if (clippedOut(b.node, byId, cx, cy) || !inside(cx, cy, b.l, b.t, b.r, b.b)) return dst;
  let out = dst;
  const bg = b.node.writes.find((w) => w.kind === 'background-color');
  if (bg !== undefined && bg.kind === 'background-color' && bg.color.alpha > 0) {
    out = color32(out, bg.color, fold === null ? bg.color.alpha : groupFoldAlpha(bg.color.alpha, fold));
  }
  const [bt, br, bb, bl] = b.border as [number, number, number, number];
  if (inside(cx, cy, b.l + bl, b.t + bt, b.r - br, b.b - bb)) return out;
  const styles = b.node.writes.find((w) => w.kind === 'border-styles');
  const colours = b.node.writes.find((w) => w.kind === 'border-colors');
  if (styles === undefined || styles.kind !== 'border-styles' || colours === undefined || colours.kind !== 'border-colors') return out;
  const side = cy < b.t + bt ? 0 : cy >= b.b - bb ? 2 : cx < b.l + bl ? 3 : 1;
  if (styles.styles[side] !== 'solid') throw new Error(`${b.node.id}: the model paints solid borders only`);
  const c = colours.colors[side] as { r: number; g: number; b: number; alpha: number };
  // A folded border is the box's one op (boxOps): its colour at the folded alpha.
  return color32(out, c, fold === null ? c.alpha : groupFoldAlpha(c.alpha, fold));
}

/** The model's colour at the centre of pixel (x, y). */
export function effectsModelAt(items: readonly Item[], byId: ReadonlyMap<string, Box>, x: number, y: number, dpr: number): Px {
  const size = ccTileSize(true, dpr);
  const ix = ccTileIndex(x, size);
  const iy = ccTileIndex(y, size);
  const tile: Tile = { l: ccTileStart(ix, size), t: ccTileStart(iy, size), r: ccTileEnd(ix, size), b: ccTileEnd(iy, size) };
  let out: Px = [255, 255, 255, 255];
  for (const it of items) out = paintItem(out, it, x, y, tile, byId);
  return out;
}

// ---------------------------------------------------------------- the device's group composite (PNT1-opacity-b)

type GroupPlan = { readonly opacity: number; readonly alpha8: number; readonly matrices: readonly number[] | null; readonly painters: readonly string[] };

/** The plan of a node the compiler pre-composites (an opacity-group or filter-group write), or null. */
function groupPlanOf(n: ProgramNode): GroupPlan | null {
  for (const w of n.writes) {
    if (w.kind === 'opacity-group') return { opacity: w.opacity, alpha8: opacityAlpha8(w.opacity), matrices: null, painters: w.painters };
    // The matrices the device builds from the emitted (code, amount) pairs (EFFECTS_EMITTER, DragonGroupView).
    if (w.kind === 'filter-group') return { opacity: w.opacity, alpha8: opacityAlpha8(w.opacity), matrices: groupFilterMatrices(filterPairs(w.filter)), painters: w.painters };
  }
  return null;
}

/** Every item of a paint list by node id, nested groups' items included. */
function itemsById(items: readonly Item[], into = new Map<string, Item>()): Map<string, Item> {
  for (const it of items) {
    // A group's own box is the first of its items; the id names the group.
    if (it.kind === 'group') itemsById(it.items, into);
    into.set(it.kind === 'text' ? it.node.id : it.box.node.id, it);
  }
  return into;
}

/** A backdrop painter box as the device paints it (DragonGroupView): its opaque fill and solid opaque sides, unclipped. */
function backdropBox(dst: Px, b: Box, cx: number, cy: number): Px {
  if (!inside(cx, cy, b.l, b.t, b.r, b.b)) return dst;
  if (b.node.writes.some((w) => w.kind === 'visibility')) return dst;
  let out = dst;
  const bg = b.node.writes.find((w) => w.kind === 'background-color');
  if (bg !== undefined && bg.kind === 'background-color' && bg.color.alpha > 0) {
    if (bg.color.alpha !== 255) throw new Error(`${b.node.id}: a translucent backdrop fill`);
    out = [bg.color.r, bg.color.g, bg.color.b, 255];
  }
  const [bt, br, bb, bl] = b.border as [number, number, number, number];
  if (inside(cx, cy, b.l + bl, b.t + bt, b.r - br, b.b - bb)) return out;
  const styles = b.node.writes.find((w) => w.kind === 'border-styles');
  const colours = b.node.writes.find((w) => w.kind === 'border-colors');
  if (styles === undefined || styles.kind !== 'border-styles' || colours === undefined || colours.kind !== 'border-colors') return out;
  // The device fills the sides top, right, bottom, left, each over the last.
  let c: { r: number; g: number; b: number; alpha: number } | null = null;
  const hit = [cy < b.t + bt, cx >= b.r - br, cy >= b.b - bb, cx < b.l + bl];
  for (let k = 0; k < 4; k++) {
    if (!hit[k] || (b.border[k] as number) <= 0 || styles.styles[k] === 'none' || styles.styles[k] === 'hidden') continue;
    const s = colours.colors[k] as { r: number; g: number; b: number; alpha: number };
    if (s.alpha === 0) continue;
    if (styles.styles[k] !== 'solid' || s.alpha !== 255) throw new Error(`${b.node.id}: a backdrop side that is not solid and opaque`);
    c = s;
  }
  return c === null ? out : [c.r, c.g, c.b, 255];
}

type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number };

/** A box's background colour, transparent for none. */
const bgOf = (b: Box): Rgba => {
  const w = b.node.writes.find((x) => x.kind === 'background-color');
  return w !== undefined && w.kind === 'background-color' ? w.color : { r: 0, g: 0, b: 0, alpha: 0 };
};

/** A box's shown border sides (a width and a drawn style) and their colours, top, right, bottom, left. */
function sidesOf(b: Box): { readonly shown: readonly boolean[]; readonly colours: readonly Rgba[] } {
  const styles = b.node.writes.find((w) => w.kind === 'border-styles');
  const colours = b.node.writes.find((w) => w.kind === 'border-colors');
  const shown = [0, 1, 2, 3].map((k) => styles !== undefined && styles.kind === 'border-styles' && styles.styles[k] !== 'none' && styles.styles[k] !== 'hidden' && (b.border[k] as number) > 0);
  return { shown, colours: [0, 1, 2, 3].map((k) => (colours !== undefined && colours.kind === 'border-colors' ? (colours.colors[k] as Rgba) : { r: 0, g: 0, b: 0, alpha: 0 })) };
}

/**
 * The display items the device counts for the per-tile fold and each item's one colour: each painting box (a lone op folds), each
 * glyph, and every item of a nested group, which never folds the group it is in (DragonGroupView.dragonSoftwareDraws).
 */
function groupDraws(items: readonly Item[], nested = false, colours: Rgba[] = []): number[] {
  return items.flatMap((it) => {
    if (it.kind === 'box') {
      const ops = boxOps(it.box);
      if (ops.count === 0) return [];
      const bg = bgOf(it.box);
      const sides = sidesOf(it.box);
      colours.push(bg.alpha > 0 ? bg : (sides.colours[Math.max(sides.shown.indexOf(true), 0)] as Rgba));
      return [it.box.l, it.box.t, it.box.r, it.box.b, ops.foldable && !nested ? 1 : 0];
    }
    if (it.kind === 'text') {
      const c = it.node.writes.find((w) => w.kind === 'text-color');
      for (const _ of it.glyphs) colours.push(c !== undefined && c.kind === 'text-color' ? c.color : { r: 0, g: 0, b: 0, alpha: 0 });
      return it.glyphs.flatMap((g) => [Math.floor(g.left), Math.floor(g.top), Math.ceil(g.right), Math.ceil(g.bottom), 0]);
    }
    return groupDraws(it.items, true, colours);
  });
}

/** Whether a box paints a translucent colour (DragonGroupView's dragonGroupTranslucent). */
function translucentBox(b: Box): boolean {
  const bg = bgOf(b).alpha;
  const sides = sidesOf(b);
  return (bg > 0 && bg < 255) || [0, 1, 2, 3].some((k) => sides.shown[k] && (sides.colours[k] as Rgba).alpha > 0 && (sides.colours[k] as Rgba).alpha < 255);
}

/** Whether the device builds a group's layer in software: translucent paint or a nested group in it (dragonNeedsSoftware). */
const softwareGroup = (items: readonly Item[]): boolean => items.some((it) => it.kind === 'group' || (it.kind === 'box' && translucentBox(it.box)));

/** A box's own paint as the device's software layer draws it: its background over the box, then one side's colour, each with groupFill. */
function softwareBox(dst: Px, b: Box, x: number, y: number): Px {
  if (!(x >= b.l && x < b.r && y >= b.t && y < b.b) || b.node.writes.some((w) => w.kind === 'visibility')) return dst;
  let out = dst;
  const bg = bgOf(b);
  if (bg.alpha > 0) out = unpack(groupFill(out[0], out[1], out[2], out[3], bg.r, bg.g, bg.b, bg.alpha));
  const { shown, colours } = sidesOf(b);
  const [bt, br, bb, bl] = b.border as [number, number, number, number];
  const side = shown[0] && y < b.t + bt ? 0 : shown[1] && x >= b.r - br ? 1 : shown[2] && y >= b.b - bb ? 2 : shown[3] && x < b.l + bl ? 3 : -1;
  const c = colours[side];
  return c === undefined || c.alpha === 0 ? out : unpack(groupFill(out[0], out[1], out[2], out[3], c.r, c.g, c.b, c.alpha));
}

/**
 * A group composited onto dst by the device's software layer (DragonGroupView.dragonSoftwareGroup): its boxes drawn with groupFill,
 * its text as the platform draws it (the model's glyph), nested groups composited into it, then the tile's fold (groupTileFoldIndex:
 * the one op at groupFoldAlpha) or the layer at its alpha byte (groupComposite), or the filter (groupFilterComposite).
 */
function deviceSoftware(dst: Px, items: readonly Item[], opacity: number, alpha8: number, matrices: readonly number[] | null, x: number, y: number, tile: Tile, byId: ReadonlyMap<string, Box>): Px {
  let layer: Px = [0, 0, 0, 0];
  for (const it of items) {
    if (it.kind === 'box') layer = softwareBox(layer, it.box, x, y);
    else if (it.kind === 'text') layer = paintItem(layer, it, x, y, tile, byId);
    // The device builds a nested group's layer over the nested group's own extent only; outside it the layer is clear.
    else if (inExtent(it.items, x, y)) layer = deviceSoftware(layer, it.items, it.opacity, it.alpha8, null, x, y, tile, byId);
  }
  if (matrices !== null) return unpack(groupFilterComposite(layer[0], layer[1], layer[2], layer[3], dst[0], dst[1], dst[2], dst[3], matrices, alpha8));
  const colours: Rgba[] = [];
  const k = groupTileFoldIndex(groupDraws(items, false, colours), tile.l, tile.t, tile.r, tile.b);
  if (k >= 0) {
    const c = colours[k] as Rgba;
    return layer[3] === 0 ? dst : unpack(groupFill(dst[0], dst[1], dst[2], dst[3], c.r, c.g, c.b, groupFoldAlpha(c.alpha, opacity)));
  }
  return unpack(groupComposite(layer[0], layer[1], layer[2], layer[3], dst[0], dst[1], dst[2], dst[3], alpha8, false));
}

/** Whether a pixel lies in a group's extent: its boxes and its glyphs, widened to whole device px. */
function inExtent(items: readonly Item[], x: number, y: number): boolean {
  return items.some((it) => (it.kind === 'box' ? x >= it.box.l && x < it.box.r && y >= it.box.t && y < it.box.b : it.kind === 'text' ? it.glyphs.some((g) => x >= Math.floor(g.left) && x < Math.ceil(g.right) && y >= Math.floor(g.top) && y < Math.ceil(g.bottom)) : inExtent(it.items, x, y)));
}

/**
 * The device's composite Q of a pre-composited group at pixel (x, y), null outside its extent: the layer (the group's content
 * drawn opaque into a transparent bitmap), the backdrop (white, then each painter: a box's fill and sides, an earlier group's Q),
 * and layout paint-group.ts groupComposite with the tile's fold (groupTileFolds), as DragonGroupView computes it.
 */
function deviceQ(g: Item & { kind: 'group' }, plan: GroupPlan, x: number, y: number, tile: Tile, all: ReadonlyMap<string, Item>, byId: ReadonlyMap<string, Box>, programs: ReadonlyMap<string, ProgramNode>): Px | null {
  // paintItems puts the group's own box first among its items.
  const members = g.items;
  if (!inExtent(members, x, y)) return null;
  let d: Px = [255, 255, 255, 255];
  for (const id of plan.painters) {
    const it = all.get(id);
    const node = programs.get(id);
    if (it === undefined || node === undefined) throw new Error(`${g.box.node.id}: painter ${id} is not painted`);
    const inner = groupPlanOf(node);
    if (inner !== null) {
      if (it.kind !== 'group') throw new Error(`${id}: a planned group that is not a group item`);
      d = deviceQ(it, inner, x, y, tile, all, byId, programs) ?? d;
      continue;
    }
    if (it.kind === 'text') throw new Error(`${id}: a text painter`);
    d = backdropBox(d, it.box, x + 0.5, y + 0.5);
  }
  if (softwareGroup(members)) return deviceSoftware(d, members, plan.opacity, plan.alpha8, plan.matrices, x, y, tile, byId);
  let layer: Px = [0, 0, 0, 0];
  for (const it of members) layer = paintItem(layer, it, x, y, tile, byId);
  if (plan.matrices !== null) return unpack(groupFilterComposite(layer[0], layer[1], layer[2], layer[3], d[0], d[1], d[2], d[3], plan.matrices, plan.alpha8));
  const fold = groupTileFolds(groupDraws(members), tile.l, tile.t, tile.r, tile.b);
  return unpack(groupComposite(layer[0], layer[1], layer[2], layer[3], d[0], d[1], d[2], d[3], plan.alpha8, fold));
}

/** The device's colour at the centre of pixel (x, y): the model, with each pre-composited group shown as its Q over its extent. */
function deviceAt(p: NativeProgram, items: readonly Item[], byId: ReadonlyMap<string, Box>, x: number, y: number, dpr: number): Px {
  const size = ccTileSize(true, dpr);
  const ix = ccTileIndex(x, size);
  const iy = ccTileIndex(y, size);
  const tile: Tile = { l: ccTileStart(ix, size), t: ccTileStart(iy, size), r: ccTileEnd(ix, size), b: ccTileEnd(iy, size) };
  const all = itemsById(items);
  const programs = new Map(p.nodes.map((n) => [n.id, n]));
  let out: Px = [255, 255, 255, 255];
  for (const it of items) {
    const plan = it.kind === 'group' ? groupPlanOf(it.box.node) : null;
    if (it.kind !== 'group' || plan === null) {
      out = paintItem(out, it, x, y, tile, byId);
      continue;
    }
    if (clippedOut(it.box.node, byId, x + 0.5, y + 0.5)) continue;
    out = deviceQ(it, plan, x, y, tile, all, byId, programs) ?? out;
  }
  return out;
}

// ---------------------------------------------------------------- the fixtures

const GROUPS = ['effects', 'filter'];
const FIXTURES = FIXTURE_GROUPS.filter((g) => GROUPS.includes(g.id)).flatMap((g) => g.fixtures).filter((f) => f.kind === 'layout');

/** The mismatches of the model against the committed Chrome PNGs at every non-edge point of a program, and the points compared. */
function modelProblems(caseId: string, p: NativeProgram, viewport: { width: number; height: number }): { problems: string[]; compared: number } {
  const problems: string[] = [];
  let compared = 0;
  for (const dpr of DPRS) {
    const chrome = committedPixels(caseId, dpr);
    if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
    const items = paintItems(p, viewport, dpr);
    const byId = new Map(boxes(p, viewport, dpr).map((b) => [b.node.id, b]));
    for (const pt of casePoints(p, viewport, dpr)) {
      if (ruleKind(pt.rule) === 'edge') continue;
      compared++;
      const i = (pt.y * chrome.width + pt.x) * 4;
      const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
      const want = effectsModelAt(items, byId, pt.x, pt.y, dpr);
      if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
    }
  }
  return { problems, compared };
}

describe('PNT1 effects: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the opacity, stacking and filter fixtures', () => {
    expect(FIXTURES.map((f) => f.id)).toEqual(['opacity-basic', 'opacity-cascade', 'opacity-web', 'opacity-fold', 'opacity-group-text', 'opacity-group-border', 'opacity-group-border-only', 'opacity-group-over-rects', 'opacity-group-over-group', 'opacity-group-clipped', 'opacity-group-nested', 'opacity-group-translucent', 'stacking-basic', 'stacking-context', 'stacking-escape', 'stacking-transform', 'stacking-grid-items', 'stacking-isolation', 'stacking-backface', 'filter-none', 'filter-matrix-text', 'filter-matrix-over-rects']);
  });
  it('every opacity group lies inside one cc raster tile at every DPR, so a device composite of the whole group can match', () => {
    let groups = 0;
    for (const spec of FIXTURES) {
      for (const c of casesOf(spec, fixtureInput(spec))) {
        const r = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (r.kind !== 'ready') throw new Error(r.reason);
        const p = r.programs.uikit;
        const children = new Map<string, ProgramNode[]>();
        for (const n of p.nodes) if (n.parent !== null) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
        const subtree = (n: ProgramNode): ProgramNode[] => [n, ...(children.get(n.id) ?? []).flatMap(subtree)];
        for (const dpr of DPRS) {
          const size = ccTileSize(true, dpr);
          const byId = new Map(boxes(p, c.environment.viewport, dpr).map((b) => [b.node.id, b]));
          for (const n of p.nodes.filter((x) => x.facts['effects'] !== undefined)) {
            groups++;
            const bs = subtree(n).flatMap((x) => (byId.has(x.id) ? [byId.get(x.id) as Box] : []));
            const tiles = new Set(bs.flatMap((b) => [`${ccTileIndex(b.l, size)},${ccTileIndex(b.t, size)}`, `${ccTileIndex(b.r - 1, size)},${ccTileIndex(b.b - 1, size)}`]));
            expect(tiles.size, `${c.id} ${n.id} @${dpr}`).toBe(1);
          }
        }
      }
    }
    expect(groups).toBeGreaterThan(0);
  });
  for (const spec of FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        const p = programs.programs.uikit;
        const { problems, compared } = modelProblems(c.id, p, c.environment.viewport);
        expect(problems).toEqual([]);
        expect(compared, 'compared points').toBeGreaterThan(0);
        // The points see what the device must get right: each planted fault changes the model at some point of the case.
        const caught = (faults: ModelFaults): boolean => DPRS.some((dpr) => {
          const items = paintItems(p, c.environment.viewport, dpr);
          const planted = paintItems(p, c.environment.viewport, dpr, faults);
          const byId = new Map(boxes(p, c.environment.viewport, dpr).map((b) => [b.node.id, b]));
          return casePoints(p, c.environment.viewport, dpr).some((pt) => effectsModelAt(items, byId, pt.x, pt.y, dpr).join() !== effectsModelAt(planted, byId, pt.x, pt.y, dpr).join());
        });
        // opacity-fold's groups fold into their fills, so it has no opacity write for the plant to ignore: its alpha is the fills'
        // (of-f's 0.00196 rounds to byte 0, of-g's 0.999 to 255, and of-i has no fill).
        if (spec.id === 'opacity-fold') {
          expect(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'opacity')).map((n) => n.id)).toEqual([]);
          expect(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'background-color' && w.color.alpha > 0 && w.color.alpha < 255)).map((n) => n.id)).toEqual(['of-a', 'of-b', 'of-d', 'of-e', 'of-h', 'of-j']);
          // Every one sits in a row of leaves in a column of rows, so its backdrop is provably the stage's and rows' colours alone.
          expect(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'background-color' && w.folded === true)).map((n) => n.id)).toEqual(['of-a', 'of-b', 'of-d', 'of-e', 'of-h', 'of-j']);
        } else if (spec.id.startsWith('opacity-')) expect(caught({ alphaIgnored: true, treeOrder: false }), 'alpha-ignored').toBe(true);
        if (spec.id.startsWith('stacking-')) expect(caught({ alphaIgnored: false, treeOrder: true }), 'order-swap').toBe(true);
        if (spec.id.startsWith('filter-matrix-')) expect(caught({ alphaIgnored: false, treeOrder: false, filterIgnored: true }), 'filter-ignored').toBe(true);
      });
    }
  }
});

// PNT1-opacity-b: native pre-composites an admitted group itself (DragonGroupView, layout paint-group.ts). The device's composite,
// simulated as the runtime computes it (the group's layer, the backdrop from the planned painters, the per-tile fold), equals the
// model at every point of every case, and the model equals Chrome above; so a device that renders the layer as Chrome does shows
// Chrome's bytes. What stays unproven until a device run: that CALayer.render(in:) and View.draw give Chrome's layer bytes.
/** Chrome 145's captured cells for colour-matrix filters: [(code, amount) pairs, opacity, layer L (premultiplied), backdrop D, pixel]. */
const FILTER_CELLS: readonly (readonly [number[], number, Px, [number, number, number], [number, number, number]])[] = [
  [[0,0.36063], 0.872, [0,0,0,255], [204,72,233], [26,9,30]], [[0,0.36063], 0.872, [30,30,30,30], [249,7,147], [249,32,158]], [[0,0.79603], 0.922, [0,0,0,255], [3,73,107], [0,5,8]],
  [[0,0.79603], 0.922, [64,64,64,64], [221,162,174], [229,183,192]], [[0,0.9726], 0.814, [0,0,0,255], [28,17,112], [5,3,20]], [[0,0.9726], 0.814, [29,29,29,29], [188,212,92], [194,216,107]],
  [[0,0.9727], 0.655, [0,0,0,255], [12,80,113], [4,27,38]], [[0,0.9727], 0.655, [115,115,115,115], [225,186,163], [234,206,190]], [[0,0.11774], 1, [0,0,0,255], [111,94,243], [0,0,0]],
  [[0,0.11774], 1, [128,128,128,128], [236,38,228], [246,147,242]], [[0,0.5724], 0.618, [0,0,0,255], [243,4,151], [92,1,57]], [[0,0.5724], 0.618, [253,253,253,253], [53,136,158], [177,209,218]],
  [[0,0.64378], 1, [0,0,0,255], [150,147,104], [0,0,0]], [[0,0.64378], 1, [78,78,78,78], [126,106,229], [165,152,237]], [[0,0.07638], 1, [0,0,0,255], [238,171,81], [0,0,0]],
  [[0,0.07638], 1, [178,178,178,178], [228,172,132], [247,230,218]], [[0,0.12264], 0.795, [0,0,0,255], [40,50,89], [8,10,18]], [[0,0.12264], 0.795, [152,152,152,152], [57,71,161], [151,158,206]],
  [[0,0.48564], 1, [0,0,0,255], [100,74,191], [0,0,0]], [[0,0.48564], 1, [219,219,219,219], [167,49,169], [243,226,243]], [[0,1], 1, [0,0,0,255], [184,75,185], [0,0,0]],
  [[0,1], 1, [141,141,141,141], [118,207,222], [194,234,240]], [[0,0.5], 1, [0,0,0,255], [157,177,96], [0,0,0]], [[0,0.5], 1, [220,220,220,220], [42,204,176], [226,248,244]],
  [[1,0.2273], 0.336, [0,0,0,255], [178,44,154], [117,29,101]], [[1,0.2273], 0.336, [15,15,15,15], [33,114,71], [37,116,74]], [[1,0.58034], 1, [0,0,0,255], [31,188,122], [0,0,0]],
  [[1,0.58034], 1, [20,20,20,20], [84,215,187], [97,218,192]], [[1,0.17652], 1, [0,0,0,255], [251,20,179], [0,0,0]], [[1,0.17652], 1, [216,216,216,216], [61,211,38], [225,248,219]],
  [[1,0.7178], 0.786, [0,0,0,255], [204,124,242], [43,26,51]], [[1,0.7178], 0.786, [155,155,155,155], [75,244,60], [160,249,147]], [[1,0.43192], 1, [0,0,0,255], [27,235,91], [0,0,0]],
  [[1,0.43192], 1, [214,214,214,214], [70,36,234], [225,220,246]], [[1,0.97963], 1, [0,0,0,255], [47,87,195], [0,0,0]], [[1,0.97963], 1, [132,132,132,132], [23,69,203], [143,165,222]],
  [[1,0.59937], 0.8, [0,0,0,255], [224,202,215], [44,40,42]], [[1,0.59937], 0.8, [8,8,8,8], [112,115,64], [115,118,68]], [[1,0.69725], 0.414, [0,0,0,255], [44,103,57], [25,59,33]],
  [[1,0.69725], 0.414, [226,226,226,226], [235,57,253], [243,130,250]], [[1,0.87312], 0.601, [0,0,0,255], [98,215,94], [39,85,37]], [[1,0.87312], 0.601, [101,101,101,101], [158,236,167], [181,241,185]],
  [[1,0.73771], 0.559, [0,0,0,255], [167,21,190], [73,9,83]], [[1,0.73771], 0.559, [33,33,33,33], [79,43,176], [92,58,181]], [[1,1], 1, [0,0,0,255], [88,87,114], [0,0,0]],
  [[1,1], 1, [49,49,49,49], [78,100,182], [112,130,193]], [[1,0.5], 1, [0,0,0,255], [17,255,125], [0,0,0]], [[1,0.5], 1, [133,133,133,133], [1,213,116], [133,235,184]],
  [[3,0.87828], 0.281, [0,0,0,255], [28,250,118], [83,242,148]], [[3,0.87828], 0.281, [4,4,4,4], [166,76,155], [165,75,154]], [[3,0.19211], 1, [0,0,0,255], [169,82,97], [49,49,49]],
  [[3,0.19211], 1, [70,70,70,70], [14,133,52], [67,153,94]], [[3,0.21966], 1, [0,0,0,255], [252,88,255], [56,56,56]], [[3,0.21966], 1, [131,131,131,131], [73,105,247], [138,153,222]],
  [[3,0.14917], 0.672, [0,0,0,255], [122,42,93], [65,39,56]], [[3,0.14917], 0.672, [152,152,152,152], [120,152,118], [158,178,157]], [[3,0.01629], 1, [0,0,0,255], [73,69,32], [4,4,4]],
  [[3,0.01629], 1, [246,246,246,246], [74,36,176], [245,243,248]], [[3,0.34497], 0.358, [0,0,0,255], [54,30,232], [66,50,180]], [[3,0.34497], 0.358, [219,219,219,219], [16,105,182], [62,123,177]],
  [[3,0.9938], 1, [0,0,0,255], [56,147,222], [253,253,253]], [[3,0.9938], 1, [86,86,86,86], [223,26,61], [148,18,41]], [[3,0.05005], 1, [0,0,0,255], [171,134,149], [13,13,13]],
  [[3,0.05005], 1, [163,163,163,163], [153,240,38], [210,241,169]], [[3,0.90515], 1, [0,0,0,255], [247,252,39], [231,231,231]], [[3,0.90515], 1, [112,112,112,112], [35,135,130], [30,86,84]],
  [[3,0.38743], 0.813, [0,0,0,255], [92,177,242], [97,113,125]], [[3,0.38743], 0.813, [1,1,1,1], [60,0,127], [60,0,127]], [[3,1], 1, [0,0,0,255], [37,156,114], [255,255,255]],
  [[3,1], 1, [6,6,6,6], [214,251,133], [209,245,130]], [[3,0.5], 1, [0,0,0,255], [222,235,51], [128,128,128]], [[3,0.5], 1, [167,167,167,167], [45,181,80], [99,146,111]],
  [[4,0.56063], 1, [0,0,0,255], [116,77,25], [51,34,11]], [[4,0.56063], 1, [236,236,236,236], [160,221,67], [209,239,165]], [[4,0.56858], 1, [0,0,0,255], [242,213,142], [104,92,61]],
  [[4,0.56858], 1, [157,157,157,157], [55,35,152], [125,112,188]], [[4,0.76868], 0.604, [0,0,0,255], [165,148,37], [88,79,19]], [[4,0.76868], 0.604, [64,64,64,64], [122,142,12], [137,155,40]],
  [[4,0.03152], 1, [0,0,0,255], [6,193,198], [6,187,192]], [[4,0.03152], 1, [230,230,230,230], [183,126,181], [185,130,183]], [[4,0.29963], 0.373, [0,0,0,255], [205,195,15], [182,173,13]],
  [[4,0.29963], 0.373, [241,241,241,241], [149,247,46], [160,247,68]], [[4,0.57561], 0.739, [0,0,0,255], [159,208,183], [91,120,105]], [[4,0.57561], 0.739, [171,171,171,171], [96,123,234], [141,160,240]],
  [[4,0.33854], 0.663, [0,0,0,255], [57,6,219], [44,4,170]], [[4,0.33854], 0.663, [140,140,140,140], [20,190,28], [48,198,55]], [[4,0.22775], 0.309, [0,0,0,255], [185,108,144], [171,100,133]],
  [[4,0.22775], 0.309, [96,96,96,96], [10,158,207], [16,161,209]], [[4,0.0935], 1, [0,0,0,255], [168,59,105], [152,53,95]], [[4,0.0935], 1, [155,155,155,155], [19,249,76], [32,249,86]],
  [[4,0.88121], 1, [0,0,0,255], [13,154,1], [2,18,0]], [[4,0.88121], 1, [10,10,10,10], [26,223,192], [34,224,194]], [[4,1], 1, [0,0,0,255], [89,46,71], [0,0,0]],
  [[4,1], 1, [158,158,158,158], [74,240,1], [186,249,158]], [[4,0.5], 1, [0,0,0,255], [210,168,57], [105,84,29]], [[4,0.5], 1, [247,247,247,247], [228,52,230], [241,150,242]],
  [[2,3.56063], 1, [0,0,0,255], [18,119,141], [0,0,0]], [[2,3.56063], 1, [242,242,242,242], [119,153,49], [248,250,244]], [[2,3.15681], 0.926, [0,0,0,255], [213,130,173], [15,9,12]],
  [[2,3.15681], 0.926, [161,161,161,161], [204,66,220], [234,176,241]], [[2,2.48632], 1, [0,0,0,255], [117,154,114], [0,0,0]], [[2,2.48632], 1, [174,174,174,174], [204,162,40], [239,225,187]],
  [[2,0.38839], 1, [0,0,0,255], [197,116,174], [0,0,0]], [[2,0.38839], 1, [109,109,109,109], [159,223,232], [200,237,242]], [[2,2.23888], 1, [0,0,0,255], [105,61,75], [0,0,0]],
  [[2,2.23888], 1, [136,136,136,136], [182,23,102], [221,147,184]], [[2,1.8398], 1, [0,0,0,255], [103,226,36], [0,0,0]], [[2,1.8398], 1, [192,192,192,192], [213,179,232], [245,236,249]],
  [[2,3.97253], 0.516, [0,0,0,255], [218,182,3], [104,87,1]], [[2,3.97253], 0.516, [78,78,78,78], [209,126,88], [216,146,114]], [[2,2.20868], 1, [0,0,0,255], [182,175,152], [0,0,0]],
  [[2,2.20868], 1, [174,174,174,174], [207,140,54], [240,218,191]], [[2,1.42096], 0.259, [0,0,0,255], [132,134,210], [97,98,155]], [[2,1.42096], 0.259, [95,95,95,95], [39,174,160], [60,182,169]],
  [[2,1.4083], 1, [0,0,0,255], [179,38,71], [0,0,0]], [[2,1.4083], 1, [26,26,26,26], [18,110,27], [42,125,50]], [[2,1], 1, [0,0,0,255], [23,86,18], [0,0,0]],
  [[2,1], 1, [56,56,56,56], [186,136,77], [201,162,116]], [[2,2], 1, [0,0,0,255], [49,157,201], [0,0,0]], [[2,2], 1, [88,88,88,88], [178,214,236], [205,228,243]],
  [[5,0.84691], 1, [0,0,0,255], [193,236,165], [0,0,0]], [[5,0.84691], 1, [58,58,58,58], [107,67,177], [132,101,186]], [[5,2.67838], 1, [0,0,0,255], [29,135,66], [0,0,0]],
  [[5,2.67838], 1, [30,30,30,30], [153,13,13], [165,41,41]], [[5,0.20397], 0.275, [0,0,0,255], [186,103,148], [134,74,106]], [[5,0.20397], 0.275, [15,15,15,15], [194,25,91], [191,25,90]],
  [[5,1.1374], 0.312, [0,0,0,255], [70,104,53], [47,71,36]], [[5,1.1374], 0.312, [182,182,182,182], [237,181,113], [241,198,145]], [[5,0.40014], 1, [0,0,0,255], [135,11,189], [0,0,0]],
  [[5,0.40014], 1, [250,250,250,250], [187,129,163], [104,103,103]], [[5,2.68519], 1, [0,0,0,255], [38,28,145], [0,0,0]], [[5,2.68519], 1, [254,254,254,254], [171,185,118], [255,255,254]],
  [[5,1.85013], 0.485, [0,0,0,255], [135,249,185], [69,127,94]], [[5,1.85013], 0.485, [121,121,121,121], [16,81,30], [71,121,82]], [[5,2.19338], 0.223, [0,0,0,255], [95,179,118], [73,138,91]],
  [[5,2.19338], 0.223, [28,28,28,28], [159,96,19], [161,100,24]], [[5,2.04142], 1, [0,0,0,255], [213,108,2], [0,0,0]], [[5,2.04142], 1, [51,51,51,51], [198,190,36], [209,203,80]],
  [[5,1.3415], 1, [0,0,0,255], [164,142,129], [0,0,0]], [[5,1.3415], 1, [210,210,210,210], [116,103,154], [230,228,237]], [[5,1], 1, [0,0,0,255], [60,161,219], [0,0,0]],
  [[5,1], 1, [20,20,20,20], [9,55,253], [28,71,253]], [[5,1.5], 1, [0,0,0,255], [71,162,221], [0,0,0]], [[5,1.5], 1, [133,133,133,133], [245,100,65], [250,181,164]],
  [[6,0.97632], 0.332, [0,0,0,255], [131,215,215], [88,143,143]], [[6,0.97632], 0.332, [132,132,132,132], [39,135,79], [75,155,109]], [[6,2.17642], 0.862, [0,0,0,255], [159,107,164], [21,14,22]],
  [[6,2.17642], 0.862, [194,194,194,194], [38,44,124], [180,182,210]], [[6,0.26672], 1, [0,0,0,255], [89,223,218], [93,93,93]], [[6,0.26672], 1, [170,170,170,170], [245,88,132], [189,137,152]],
  [[6,1.96486], 1, [0,0,0,255], [149,30,170], [0,0,0]], [[6,1.96486], 1, [192,192,192,192], [15,130,184], [196,224,237]], [[6,1.69151], 1, [0,0,0,255], [224,174,180], [0,0,0]],
  [[6,1.69151], 1, [197,197,197,197], [36,100,174], [205,220,237]], [[6,2.64413], 1, [0,0,0,255], [249,108,53], [0,0,0]], [[6,2.64413], 1, [11,11,11,11], [196,44,225], [199,53,226]],
  [[6,1.65513], 1, [0,0,0,255], [133,121,72], [0,0,0]], [[6,1.65513], 1, [178,178,178,178], [200,123,29], [238,215,187]], [[6,2.07258], 1, [0,0,0,255], [137,253,163], [0,0,0]],
  [[6,2.07258], 1, [203,203,203,203], [234,11,48], [251,205,213]], [[6,2.289], 1, [0,0,0,255], [176,131,5], [0,0,0]], [[6,2.289], 1, [217,217,217,217], [241,191,42], [253,245,223]],
  [[6,0.11244], 0.567, [0,0,0,255], [152,220,229], [129,158,162]], [[6,0.11244], 0.567, [69,69,69,69], [58,86,148], [70,94,147]], [[6,1], 1, [0,0,0,255], [140,10,156], [0,0,0]],
  [[6,1], 1, [2,2,2,2], [18,119,195], [20,120,195]], [[6,1.5], 1, [0,0,0,255], [23,52,62], [0,0,0]], [[6,1.5], 1, [100,100,100,100], [57,187,98], [135,214,160]],
  [[6,0.817,0,0.704,4,0.044,3,0.803], 1, [0,0,0,255], [234,247,50], [232,245,56]], [[6,0.817,0,0.704,4,0.044,3,0.803], 1, [50,50,50,50], [238,238,96], [237,237,96]], [[3,0.251,4,0.202,3,0.764], 1, [0,0,0,255], [65,7,18], [84,38,47]],
  [[3,0.251,4,0.202,3,0.764], 1, [25,25,25,25], [140,19,175], [139,20,173]], [[0,0.016,3,0.09], 0.55, [0,0,0,255], [61,88,144], [40,52,77]], [[0,0.016,3,0.09], 0.55, [47,47,47,47], [121,123,139], [132,134,149]],
  [[3,0.29,4,0.421], 1, [0,0,0,255], [54,111,89], [62,95,83]], [[3,0.29,4,0.421], 1, [167,167,167,167], [210,56,180], [202,90,180]], [[5,0.41,4,0.106], 1, [0,0,0,255], [72,77,171], [64,69,153]],
  [[5,0.41,4,0.106], 1, [98,98,98,98], [15,65,128], [19,67,127]], [[4,0.843,3,0.199,4,0.39,4,0.451], 1, [0,0,0,255], [47,230,146], [48,203,132]], [[4,0.843,3,0.199,4,0.39,4,0.451], 1, [203,203,203,203], [170,39,201], [174,59,201]],
  [[4,0.816,0,0.293], 1, [0,0,0,255], [154,128,241], [28,24,44]], [[4,0.816,0,0.293], 1, [244,244,244,244], [43,9,119], [209,201,225]], [[2,0.447,0,0.381,2,3.836,2,3.721], 1, [0,0,0,255], [0,174,52], [0,0,0]],
  [[2,0.447,0,0.381,2,3.836,2,3.721], 1, [252,252,252,252], [236,211,73], [255,254,253]], [[0,0.516,0,0.539], 1, [0,0,0,255], [35,141,231], [0,0,0]], [[0,0.516,0,0.539], 1, [57,57,57,57], [167,95,199], [187,131,212]],
  [[5,1.451,0,0.436,6,2.859,0,0.352], 0.55, [0,0,0,255], [52,152,18], [23,68,8]], [[5,1.451,0,0.436,6,2.859,0,0.352], 0.55, [202,202,202,202], [122,13,121], [180,118,179]], [[1,0.639,6,0.349], 1, [0,0,0,255], [199,221,204], [83,83,83]],
  [[1,0.639,6,0.349], 1, [29,29,29,29], [17,240,147], [35,232,149]], [[0,0.125,6,1.11], 0.55, [0,0,0,255], [18,142,200], [8,63,89]], [[0,0.125,6,1.11], 0.55, [51,51,51,51], [142,236,8], [154,238,35]],
];

// S2: Chrome 145 (chrome-headless-shell, software raster) drew random trees of absolutely positioned 1 px boxes in 4 x 4 px cells
// over an opaque backdrop D at DPR 1: each box a background and a 1 px border on all four sides or one, colours opaque, translucent
// or transparent (border colours never transparent: the compiler refuses that side), an opacity of 1 or a fraction, up to four
// levels deep, every cell inside one cc raster tile. A cell is [D, tree, the 16 pixels row by row], a tree node [x, y, w, h,
// background r, g, b, a, the shown sides as a bit mask (top 1, right 2, bottom 4, left 8), border r, g, b, a, opacity, children].
// Pinned here: cells with groups nested two levels or more, cells with translucent paint, and border-only groups. The full sweeps
// (about 3.1 million device px over DPR 1, 2 and 3, translucent alpha bytes and two-decimal authored alphas) matched at every px.
type CellNode = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, CellNode[]];
const GROUP_CELLS: readonly (readonly [readonly number[], CellNode, readonly number[]])[] = [
  [[159,210,148],[2,2,1,2,92,64,112,133,0,0,0,0,0,0.37,[[3,0,1,4,242,66,186,92,0,0,0,0,0,1,[[3,1,1,1,97,63,97,60,0,0,0,0,0,1,[[2,0,2,1,74,56,60,170,0,0,0,0,0,0.3381,[]],[1,3,2,1,93,0,191,154,0,0,0,0,0,0.5043,[]]]]]]]],[159,210,148,159,210,148,152,197,140,160,182,144,159,210,148,159,210,148,159,210,148,162,182,147,159,210,148,159,210,148,146,182,141,170,191,153,159,210,148,151,186,152,142,166,147,170,191,153]],
  [[180,218,164],[1,1,2,2,7,151,167,132,8,196,188,236,82,0.7071,[[0,1,2,1,230,110,147,0,0,0,0,0,0,1,[[0,1,2,1,98,55,215,212,0,0,0,0,0,0.6227,[[3,2,1,2,233,53,169,255,0,0,0,0,0,0.3293,[]]]]]],[1,2,2,2,66,79,129,255,0,0,0,0,0,0.0338,[[1,3,2,1,49,158,190,186,0,0,0,0,0,1,[[2,3,1,1,37,162,153,120,0,0,0,0,0,0.5481,[]],[1,2,3,1,74,82,23,42,0,0,0,0,0,1,[]]]],[0,0,1,3,29,15,45,97,0,0,0,0,0,1,[[2,1,2,3,75,141,179,255,2,104,114,26,255,0.7106,[]]]]]]]],[178,216,162,180,218,164,180,218,164,180,218,164,147,156,180,131,148,191,116,192,165,178,216,161,178,216,162,139,191,179,116,192,164,185,192,161,180,218,164,177,216,164,177,216,164,186,192,162]],
  [[105,56,199],[2,2,2,1,246,104,231,102,0,0,0,0,0,0.37,[[3,2,1,2,83,105,254,10,0,0,0,0,0,0.0496,[[1,0,2,2,169,71,225,14,0,0,0,0,0,0.3851,[]],[1,0,3,2,213,180,1,0,2,134,188,6,255,0.1382,[[3,0,1,2,219,43,167,255,0,0,0,0,0,0.7009,[]]]]]],[2,1,1,2,96,146,22,255,0,0,0,0,0,0.6389,[[2,1,2,1,109,106,149,181,0,0,0,0,0,1,[[3,2,1,1,144,214,18,184,0,0,0,0,0,0.4664,[]],[0,1,2,1,76,26,217,161,0,0,0,0,0,0.5573,[]]]],[1,3,2,1,251,35,166,205,0,0,0,0,0,1,[[1,1,2,1,137,127,78,9,0,0,0,0,0,1,[]]]]]]]],[105,56,199,105,56,199,105,56,199,105,56,199,102,53,200,103,53,200,105,70,178,105,64,190,105,56,199,105,56,199,110,79,158,124,74,188,105,56,199,133,51,193,133,51,193,105,56,199]],
  [[77,29,58],[2,0,2,1,14,43,253,3,0,0,0,0,0,0.7409,[[2,0,1,1,245,241,84,255,0,0,0,0,0,1,[[2,2,1,1,15,119,28,255,0,0,0,0,0,0.0609,[[3,2,1,1,232,146,35,0,0,0,0,0,0,1,[]]]]]],[2,2,1,2,115,16,82,0,0,0,0,0,0,1,[[2,2,1,2,110,3,82,162,0,0,0,0,0,0.7038,[]],[0,3,2,1,107,219,115,203,0,0,0,0,0,0.4792,[[3,2,1,1,46,80,230,127,0,0,0,0,0,0.8693,[]],[1,1,3,1,108,1,3,198,0,0,0,0,0,0.0875,[]]]]]]]],[77,29,58,77,29,58,201,186,77,76,29,59,77,29,58,77,28,56,77,28,56,77,28,56,77,29,58,77,29,58,86,21,65,72,36,84,85,82,74,85,82,74,88,20,66,77,29,58]],
  [[91,45,18],[3,1,1,1,134,73,112,31,0,0,0,0,0,0.37,[[3,3,1,1,41,220,169,255,0,0,0,0,0,0.7811,[]],[3,2,1,1,220,244,15,117,0,0,0,0,0,0.0892,[[2,3,1,1,199,132,154,179,0,0,0,0,0,0.5872,[]],[2,3,1,1,213,139,46,255,0,0,0,0,0,0.0491,[]]]]]],[91,45,18,91,45,18,91,45,18,91,45,18,91,45,18,91,45,18,91,45,18,93,46,22,91,45,18,91,45,18,91,45,18,93,48,17,91,45,18,91,45,18,92,46,19,76,95,61]],
  [[174,235,185],[2,3,2,1,161,104,223,255,0,0,0,0,0,0.37,[[0,2,2,1,88,213,223,0,0,0,0,0,0,0.65,[[3,1,1,3,239,4,35,217,0,0,0,0,0,1,[]]]],[3,1,1,3,13,130,155,255,0,0,0,0,0,1,[[2,2,2,2,180,89,221,122,1,33,165,63,255,0.1147,[]],[0,0,4,4,217,1,171,255,0,0,0,0,0,1,[]]]]]],[189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179,189,148,179]],
  [[11,201,67],[1,3,1,1,184,74,201,29,0,0,0,0,0,0.6092,[[1,2,3,1,11,152,17,180,0,0,0,0,0,1,[[0,3,3,1,130,147,187,191,0,0,0,0,0,1,[]],[1,3,2,1,28,13,208,255,0,0,0,0,0,0.8175,[]]]]]],[11,201,67,11,201,67,11,201,67,11,201,67,11,201,67,11,201,67,11,201,67,11,201,67,11,201,67,11,179,45,11,179,45,11,179,45,65,176,121,30,103,148,29,103,147,11,201,67]],
  [[55,97,10],[0,3,3,1,87,177,13,0,0,0,0,0,0,0.3701,[[1,0,3,2,61,106,237,255,8,199,79,55,151,0.9367,[[1,2,3,1,251,56,2,91,0,0,0,0,0,1,[[3,2,1,1,231,87,82,255,0,0,0,0,0,0.5336,[]],[1,1,2,1,96,53,208,255,0,0,0,0,0,1,[]]]]]]]],[55,97,10,85,94,51,57,100,88,57,100,88,55,97,10,69,81,78,69,81,78,57,100,88,55,97,10,79,91,8,79,91,8,99,92,22,55,97,10,55,97,10,55,97,10,55,97,10]],
  [[30,193,129],[3,3,1,1,9,15,207,255,0,0,0,0,0,0.734,[[1,2,3,1,241,71,7,255,0,0,0,0,0,0.7462,[[1,3,2,1,172,209,91,255,0,0,0,0,0,0.9655,[[2,3,2,1,121,35,50,146,0,0,0,0,0,0.069,[]]]],[2,1,2,2,128,101,16,115,4,249,17,241,65,1,[[3,2,1,2,97,183,35,0,0,0,0,0,0,1,[]],[1,0,1,1,8,152,99,63,0,0,0,0,0,1,[]]]]]]]],[30,193,129,26,187,124,30,193,129,30,193,129,30,193,129,30,193,129,54,171,101,54,171,101,30,193,129,145,125,62,125,123,95,125,123,95,30,193,129,104,201,108,103,196,107,16,61,182]],
  [[251,219,167],[2,3,1,1,5,15,108,150,0,0,0,0,0,0.37,[[3,1,1,3,88,208,221,134,0,0,0,0,0,1,[[2,0,1,2,226,0,194,0,0,0,0,0,0,1,[[3,0,1,1,76,34,58,96,0,0,0,0,0,1,[]],[0,3,2,1,251,95,123,83,0,0,0,0,0,1,[]]]],[3,2,1,2,225,161,123,255,0,0,0,0,0,0.4493,[[0,1,4,3,112,25,66,162,15,117,199,14,151,0.2576,[]]]]]]]],[251,219,167,251,219,167,251,219,167,227,193,152,246,216,161,246,216,161,246,216,161,217,214,171,246,216,161,247,213,163,247,213,163,225,207,161,246,202,156,246,202,156,198,176,150,225,207,161]],
  [[105,203,111],[0,1,4,1,53,32,53,108,0,0,0,0,0,0.5,[[1,3,1,1,74,163,138,80,0,0,0,0,0,0.3902,[[1,3,2,1,168,179,150,255,0,0,0,0,0,0.3745,[[2,1,2,2,27,108,181,8,2,9,96,119,83,1,[]],[2,3,2,1,249,188,163,195,0,0,0,0,0,0.6063,[]]]]]],[2,3,1,1,127,237,121,255,0,0,0,0,0,0.0423,[[2,0,1,3,55,155,4,255,0,0,0,0,0,0.4184,[[3,2,1,2,78,192,116,255,0,0,0,0,0,1,[]]]]]]]],[105,203,111,105,203,111,104,202,110,105,203,111,93,167,98,93,167,98,93,167,97,91,166,99,105,203,111,105,203,111,104,202,110,102,200,111,105,203,111,108,200,114,112,202,114,109,202,113]],
  [[95,50,125],[0,0,2,4,221,52,234,0,8,229,109,96,11,0.37,[[1,0,3,1,79,16,198,255,0,0,0,0,0,0.8452,[[0,2,1,2,29,116,151,69,0,0,0,0,0,0.2105,[]]]],[1,1,2,1,62,156,60,61,0,0,0,0,0,1,[[0,3,1,1,54,103,41,159,0,0,0,0,0,0.1904,[]],[1,0,3,3,252,17,87,255,0,0,0,0,0,0.0773,[]]]]]],[97,51,124,94,38,144,94,38,144,94,38,144,97,51,124,96,57,118,96,57,118,99,49,124,96,52,125,99,49,124,99,49,124,99,49,124,93,53,121,95,50,125,95,50,125,95,50,125]],
  [[14,15,187],[2,3,2,1,54,55,113,255,0,0,0,0,0,0.6362,[[2,2,2,2,39,154,201,0,2,26,147,242,212,0.9056,[[2,0,2,2,31,47,139,255,0,0,0,0,0,1,[]],[3,0,1,3,161,129,76,0,0,0,0,0,0,0.9292,[]]]]]],[14,15,187,14,15,187,23,33,159,23,33,159,14,15,187,14,15,187,23,33,159,23,33,159,14,15,187,14,15,187,14,15,187,19,77,213,14,15,187,14,15,187,39,40,139,26,84,201]],
  [[115,23,16],[2,0,2,3,138,205,20,166,0,0,0,0,0,0.5,[[2,0,1,3,62,93,111,255,0,0,0,0,0,0.4694,[[3,2,1,1,163,127,175,237,0,0,0,0,0,1,[[2,1,2,1,189,122,224,20,0,0,0,0,0,1,[]],[2,0,2,4,13,194,40,201,4,114,20,84,235,0.9695,[]]]]]],[1,2,3,1,225,33,224,11,0,0,0,0,0,0.6145,[[3,1,1,1,153,182,80,255,0,0,0,0,0,1,[]],[1,2,2,1,104,40,95,255,0,0,0,0,0,1,[[3,3,1,1,156,63,19,255,0,0,0,0,0,0.8658,[]],[2,0,2,3,173,63,62,97,4,55,142,181,154,0.3155,[]]]]]]]],[115,23,16,115,23,16,100,85,27,103,88,21,115,23,16,115,23,16,101,85,27,122,94,37,115,23,16,111,27,40,102,59,48,103,87,38,115,23,16,115,23,16,113,24,30,125,34,23]],
  [[119,126,113],[3,2,1,1,231,182,151,243,0,0,0,0,0,0.37,[[3,1,1,2,2,78,147,23,0,0,0,0,0,1,[]],[2,2,1,1,30,39,243,101,0,0,0,0,0,1,[[0,0,2,1,124,148,69,255,0,0,0,0,0,0.8768,[[1,2,3,1,54,68,236,230,0,0,0,0,0,1,[]],[2,0,2,4,252,11,247,0,4,244,139,47,255,1,[]]]]]]]],[120,133,98,120,133,98,119,126,113,119,126,113,119,126,113,119,126,113,119,126,113,115,124,114,119,126,113,100,108,149,97,105,153,106,112,152,119,126,113,119,126,113,159,130,91,159,130,91]],
  [[164,27,120],[1,1,2,1,243,121,222,38,0,0,0,0,0,0.5978,[[2,3,2,1,128,113,212,255,0,0,0,0,0,0.3606,[[0,0,4,1,189,39,28,28,0,0,0,0,0,0.802,[[2,1,1,3,176,250,75,172,0,0,0,0,0,0.4723,[]],[1,2,3,1,178,124,99,0,0,0,0,0,0,0.0801,[]]]]]]]],[164,27,118,164,27,118,164,27,118,164,27,118,164,27,120,171,35,129,171,46,125,164,27,120,164,27,120,164,27,120,165,38,117,164,27,120,164,27,120,164,27,120,158,52,132,156,45,140]],
  [[1,134,91],[3,1,1,3,104,23,91,255,0,0,0,0,0,0.5,[[3,3,1,1,102,165,248,255,0,0,0,0,0,0.2279,[]],[3,2,1,1,102,85,46,204,0,0,0,0,0,1,[[3,3,1,1,59,90,121,120,0,0,0,0,0,0.5544,[[0,3,1,1,29,39,100,0,0,0,0,0,0,1,[]]]],[3,0,1,4,187,6,103,190,0,0,0,0,0,1,[]]]]]],[1,134,91,1,134,91,1,134,91,70,85,95,1,134,91,1,134,91,1,134,91,83,71,95,1,134,91,1,134,91,1,134,91,83,77,91,1,134,91,1,134,91,1,134,91,82,76,100]],
  [[73,154,197],[2,2,1,2,161,106,192,169,0,0,0,0,0,0.37,[[1,1,3,2,141,197,123,165,1,54,78,67,49,0.8931,[[3,3,1,1,85,206,247,28,0,0,0,0,0,0.1965,[[0,3,4,1,120,152,112,1,0,0,0,0,0,1,[]]]],[1,2,2,2,117,83,189,179,4,116,183,42,255,1,[[3,1,1,3,138,2,125,189,0,0,0,0,0,1,[]]]]]]]],[73,154,197,73,154,197,73,154,197,73,154,197,73,154,197,83,156,176,83,156,176,91,117,174,73,154,197,87,140,191,92,138,190,92,118,175,73,154,197,87,163,146,89,162,145,89,117,180]],
  [[224,208,109],[1,2,3,1,164,62,24,0,0,0,0,0,0,0.5,[[3,3,1,1,181,200,38,73,0,0,0,0,0,1,[[0,2,4,2,179,159,39,255,0,0,0,0,0,1,[[1,2,3,2,99,147,240,92,8,118,131,146,29,0.7906,[]],[3,0,1,4,177,98,56,0,0,0,0,0,0,1,[]]]],[0,1,3,2,62,116,46,10,8,146,159,27,216,0.738,[[3,3,1,1,228,228,18,76,0,0,0,0,0,1,[]]]]]]]],[224,208,109,224,208,109,224,208,109,224,208,109,199,192,83,221,207,108,221,207,108,224,208,109,190,183,69,186,179,103,188,180,101,189,181,102,201,183,73,188,180,104,189,181,102,197,189,93]],
  [[148,17,57],[2,1,2,1,133,156,71,255,0,0,0,0,0,0.37,[[1,0,3,4,87,47,71,203,15,153,209,34,105,1,[[0,1,2,3,170,184,240,0,0,0,0,0,0,0.4922,[]],[0,1,3,3,0,242,73,112,15,58,116,25,234,0.1961,[[3,0,1,2,171,91,29,194,0,0,0,0,0,0.111,[]]]]]]]],[148,17,57,138,51,55,138,51,55,138,50,55,141,24,54,133,51,54,125,39,58,137,57,55,141,24,54,134,55,56,126,31,58,138,51,55,141,24,54,133,51,54,133,51,54,138,51,55]],
  [[193,112,137],[2,0,2,4,84,67,192,45,0,0,0,0,0,0.5,[[0,3,3,1,139,157,209,166,0,0,0,0,0,1,[[2,1,2,3,247,147,172,0,8,5,212,211,80,0.1415,[[1,3,3,1,26,94,188,0,0,0,0,0,0,1,[]],[1,3,2,1,121,17,83,218,0,0,0,0,0,0.269,[]]]],[3,3,1,1,111,87,180,0,0,0,0,0,0,1,[]]]],[2,0,2,1,188,214,181,158,0,0,0,0,0,1,[]]]],[193,112,137,193,112,137,187,142,152,187,142,152,193,112,137,193,112,137,179,110,143,183,108,142,193,112,137,193,112,137,179,110,143,183,108,142,175,127,161,174,124,159,168,124,160,183,108,142]],
  [[22,135,104],[2,3,2,1,201,242,197,3,0,0,0,0,0,0.37,[[1,3,2,1,191,137,134,255,0,0,0,0,0,0.7882,[[1,2,1,1,176,209,88,206,0,0,0,0,0,1,[]]]]]],[22,135,104,22,135,104,22,135,104,22,135,104,22,135,104,22,135,104,22,135,104,22,135,104,22,135,104,58,152,100,22,135,104,22,135,104,22,135,104,71,136,112,71,136,113,22,135,104]],
  [[53,159,180],[2,0,2,2,113,238,43,255,1,10,238,215,201,0.37,[[0,0,3,1,250,16,169,181,0,0,0,0,0,1,[[3,0,1,3,192,133,168,255,0,0,0,0,0,1,[[0,0,2,1,36,68,191,255,0,0,0,0,0,0.4615,[]],[0,1,1,1,195,225,248,8,0,0,0,0,0,0.7411,[]]]],[0,1,1,2,182,127,93,3,0,0,0,0,0,1,[]]]],[2,0,2,3,203,181,209,89,2,111,210,110,255,1,[[1,3,3,1,128,137,111,0,0,0,0,0,0,0.8081,[[3,1,1,2,86,153,230,13,0,0,0,0,0,0.6891,[]],[2,1,2,3,226,5,35,226,0,0,0,0,0,0.0825,[]]]],[0,2,2,1,182,131,21,135,0,0,0,0,0,1,[]]]]]],[78,122,180,78,122,180,104,142,181,74,177,154,54,159,180,53,159,180,88,176,149,76,172,153,78,153,148,78,153,148,75,158,181,76,172,153,53,159,180,53,159,180,56,155,177,56,155,177]],
  [[217,249,229],[0,2,1,1,68,253,231,195,0,0,0,0,0,0.5,[[1,1,1,1,166,88,155,255,0,0,0,0,0,1,[[2,2,2,1,73,26,18,31,0,0,0,0,0,0.6117,[]],[1,3,1,1,161,53,66,66,0,0,0,0,0,0.7585,[]]]],[2,1,2,2,193,86,197,177,2,40,6,52,255,1,[]]]],[217,249,229,217,249,229,217,249,229,217,249,229,217,249,229,191,167,191,209,192,218,127,126,139,160,250,230,217,249,229,207,189,215,127,126,139,217,249,229,211,229,213,217,249,229,217,249,229]],
  [[35,87,16],[2,3,2,1,44,243,28,89,0,0,0,0,0,0.37,[]],[35,87,16,35,87,16,35,87,16,35,87,16,35,87,16,35,87,16,35,87,16,35,87,16,35,87,16,35,87,16,35,87,16,35,87,16,35,87,16,35,87,16,36,106,17,36,106,17]],
  [[128,121,248],[3,3,1,1,254,85,200,241,0,0,0,0,0,0.7392,[[3,1,1,2,137,169,178,255,0,0,0,0,0,1,[]]]],[128,121,248,128,121,248,128,121,248,128,121,248,128,121,248,128,121,248,128,121,248,134,156,196,128,121,248,128,121,248,128,121,248,134,156,196,128,121,248,128,121,248,128,121,248,216,95,215]],
  [[3,93,238],[1,2,1,1,96,171,39,172,0,0,0,0,0,0.8685,[[2,1,2,3,113,240,16,255,0,0,0,0,0,0.349,[]],[1,3,1,1,218,112,16,255,0,0,0,0,0,1,[[2,3,2,1,135,159,195,255,0,0,0,0,0,1,[]]]]]],[3,93,238,3,93,238,3,93,238,3,93,238,3,93,238,3,93,238,35,137,171,35,137,171,3,93,238,57,138,122,35,137,171,35,137,171,3,93,238,189,109,45,117,150,200,117,150,200]],
  [[160,60,105],[2,1,1,3,222,155,141,45,0,0,0,0,0,0.37,[[2,2,1,1,215,33,37,93,0,0,0,0,0,0.039,[]],[0,2,1,2,242,92,147,87,0,0,0,0,0,1,[[0,2,4,2,38,133,239,255,0,0,0,0,0,0.2747,[]]]]]],[160,60,105,160,60,105,160,60,105,160,60,105,160,60,105,160,60,105,164,66,107,160,60,105,155,70,122,147,67,118,150,71,120,147,67,118,155,70,122,147,67,118,150,71,120,147,67,118]],
  [[67,213,252],[2,1,1,1,194,128,92,192,0,0,0,0,0,0.37,[]],[67,213,252,67,213,252,67,213,252,67,213,252,67,213,252,67,213,252,102,189,208,67,213,252,67,213,252,67,213,252,67,213,252,67,213,252,67,213,252,67,213,252,67,213,252,67,213,252]],
  [[123,90,218],[1,3,2,1,148,159,172,255,0,0,0,0,0,0.5,[[3,2,1,1,44,85,154,41,0,0,0,0,0,0.8132,[[1,0,2,2,11,65,75,0,1,176,123,163,18,1,[[3,0,1,2,38,182,13,186,0,0,0,0,0,1,[]]]],[1,3,2,1,79,185,83,255,0,0,0,0,0,0.8124,[[3,3,1,1,70,183,24,255,0,0,0,0,0,1,[]]]]]]]],[123,90,218,124,91,216,124,91,216,97,117,156,123,90,218,123,90,218,123,90,218,97,117,156,123,90,218,123,90,218,123,90,218,117,89,214,123,90,218,112,133,165,112,133,165,105,120,154]],
  [[65,68,9],[0,1,1,1,218,158,48,248,0,0,0,0,0,0.5,[[2,1,2,3,224,149,139,42,8,139,4,22,255,1,[]]]],[65,68,9,65,68,9,65,68,9,65,68,9,140,112,28,65,68,9,102,35,15,78,75,19,65,68,9,65,68,9,102,35,15,78,75,19,65,68,9,65,68,9,102,35,15,78,75,19]],
  [[173,96,209],[0,1,1,2,133,104,202,185,0,0,0,0,0,0.5,[]],[173,96,209,173,96,209,173,96,209,173,96,209,159,99,207,173,96,209,173,96,209,173,96,209,159,99,207,173,96,209,173,96,209,173,96,209,173,96,209,173,96,209,173,96,209,173,96,209]],
  [[239,155,135],[2,3,1,1,253,144,69,255,0,0,0,0,0,0.1236,[[1,0,2,3,226,66,198,196,4,80,169,21,103,0.2649,[]]]],[239,155,135,239,153,136,239,153,136,239,155,135,239,155,135,239,153,136,239,153,136,239,155,135,239,155,135,237,154,134,237,154,134,239,155,135,239,155,135,239,155,135,240,153,126,239,155,135]],
  [[158,75,231],[1,1,2,3,85,52,78,144,4,219,81,15,31,0.5,[]],[158,75,231,158,75,231,158,75,231,158,75,231,158,75,231,137,68,188,137,68,188,158,75,231,158,75,231,137,68,188,137,68,188,158,75,231,158,75,231,144,69,179,144,69,179,158,75,231]],
  [[17,134,96],[0,1,4,2,212,29,79,94,0,0,0,0,0,0.5,[]],[17,134,96,17,134,96,17,134,96,17,134,96,52,114,93,52,114,93,52,114,93,52,114,93,52,114,93,52,114,93,52,114,93,52,114,93,17,134,96,17,134,96,17,134,96,17,134,96]],
  [[200,125,159],[3,3,1,1,244,204,70,213,0,0,0,0,0,0.072,[[0,1,1,3,234,12,34,74,0,0,0,0,0,1,[]],[1,1,3,1,15,147,252,148,0,0,0,0,0,1,[[3,1,1,3,48,64,94,140,0,0,0,0,0,0.9243,[]],[2,1,1,1,74,137,147,16,0,0,0,0,0,1,[[2,3,1,1,64,94,68,0,0,0,0,0,0,0.276,[]],[3,3,1,1,159,56,59,255,0,0,0,0,0,0.6313,[]]]]]]]],[200,125,159,200,125,159,200,125,159,200,125,159,201,122,156,192,125,163,192,126,162,190,123,158,201,122,156,200,125,159,200,125,159,194,122,156,201,122,156,200,125,159,200,125,159,196,122,152]],
  [[225,26,178],[1,3,2,1,187,196,60,255,0,0,0,0,0,0.5,[[3,0,1,3,133,229,80,229,0,0,0,0,0,0.8663,[[0,1,1,2,243,46,128,172,0,0,0,0,0,0.4311,[[0,2,1,1,210,253,213,70,0,0,0,0,0,0.7751,[]]]],[2,1,2,2,60,13,173,255,0,0,0,0,0,0.3368,[[0,1,2,3,76,78,149,255,2,162,67,2,6,0.6496,[]],[2,3,2,1,12,13,163,255,0,0,0,0,0,0.4346,[]]]]]]]],[225,26,178,225,26,178,225,26,178,189,105,139,213,32,170,210,30,174,201,23,177,176,76,152,212,38,172,210,30,174,201,23,177,176,76,152,210,30,174,194,100,126,194,100,125,210,24,176]],
  [[23,255,59],[0,1,3,3,66,9,193,238,15,129,227,199,243,0.5,[[1,2,3,1,64,3,81,116,0,0,0,0,0,0.3025,[[0,2,1,1,229,165,2,255,0,0,0,0,0,1,[[3,1,1,2,46,35,190,255,0,0,0,0,0,0.0316,[]],[2,0,1,4,97,166,136,20,0,0,0,0,0,0.6691,[]]]],[1,3,1,1,18,197,209,54,0,0,0,0,0,0.5812,[[0,1,1,2,183,118,71,9,0,0,0,0,0,0.1444,[]],[3,0,1,3,132,225,70,84,0,0,0,0,0,0.5572,[]]]]]]]],[23,255,59,23,255,59,23,255,59,24,254,59,74,235,129,74,235,129,74,234,129,24,253,59,90,227,98,43,138,114,70,220,121,26,238,60,74,235,129,72,234,129,74,234,129,23,255,59]],
  [[247,139,16],[0,0,3,3,124,204,94,101,0,0,0,0,0,0.37,[[0,3,3,1,47,111,236,253,0,0,0,0,0,1,[]]]],[229,148,27,229,148,27,229,148,27,247,139,16,229,148,27,229,148,27,229,148,27,247,139,16,229,148,27,229,148,27,229,148,27,247,139,16,173,128,96,173,128,96,173,128,96,247,139,16]],
  [[229,36,129],[0,2,3,1,50,72,149,229,0,0,0,0,0,0.6226,[]],[229,36,129,229,36,129,229,36,129,229,36,129,229,36,129,229,36,129,229,36,129,229,36,129,129,55,140,129,55,140,129,55,140,229,36,129,229,36,129,229,36,129,229,36,129,229,36,129]],
  [[166,221,57],[0,0,4,4,0,0,0,0,15,150,23,115,90,0.5,[]],[162,186,66,162,186,66,162,186,66,162,186,66,162,186,66,166,221,57,166,221,57,162,186,66,162,186,66,166,221,57,166,221,57,162,186,66,162,186,66,162,186,66,162,186,66,162,186,66]],
  [[197,176,93],[0,0,4,4,0,0,0,0,15,236,17,134,227,0.37,[]],[210,124,106,210,124,106,210,124,106,210,124,106,210,124,106,197,176,93,197,176,93,210,124,106,210,124,106,197,176,93,197,176,93,210,124,106,210,124,106,210,124,106,210,124,106,210,124,106]],
  [[149,33,190],[0,0,4,4,0,0,0,0,15,209,67,180,220,0.37,[]],[167,43,186,167,43,186,167,43,186,167,43,186,167,43,186,149,33,190,149,33,190,167,43,186,167,43,186,149,33,190,149,33,190,167,43,186,167,43,186,167,43,186,167,43,186,167,43,186]],
  [[90,244,189],[0,0,4,4,0,0,0,0,15,96,227,145,34,0.37,[]],[90,243,186,90,243,186,90,243,186,90,243,186,90,243,186,90,244,189,90,244,189,90,243,186,90,243,186,90,244,189,90,244,189,90,243,186,90,243,186,90,243,186,90,243,186,90,243,186]],
  [[245,106,198],[0,0,4,4,0,0,0,0,15,219,203,73,65,0.5,[]],[241,118,181,241,118,181,241,118,181,241,118,181,241,118,181,245,106,198,245,106,198,241,118,181,241,118,181,245,106,198,245,106,198,241,118,181,241,118,181,241,118,181,241,118,181,241,118,181]],
  [[117,66,123],[0,0,4,4,0,0,0,0,15,21,148,250,162,0.37,[]],[94,85,153,94,85,153,94,85,153,94,85,153,94,85,153,117,66,123,117,66,123,94,85,153,94,85,153,117,66,123,117,66,123,94,85,153,94,85,153,94,85,153,94,85,153,94,85,153]],
  [[250,33,159],[0,0,4,4,0,0,0,0,2,218,146,255,76,0.5,[]],[250,33,159,250,33,159,250,33,159,244,50,173,250,33,159,250,33,159,250,33,159,244,50,173,250,33,159,250,33,159,250,33,159,244,50,173,250,33,159,250,33,159,250,33,159,244,50,173]],
  [[200,79,69],[0,0,4,4,0,0,0,0,1,160,144,7,46,0.37,[]],[197,83,64,197,83,64,197,83,64,197,83,64,200,79,69,200,79,69,200,79,69,200,79,69,200,79,69,200,79,69,200,79,69,200,79,69,200,79,69,200,79,69,200,79,69,200,79,69]],
  [[176,3,17],[0,0,4,4,0,0,0,0,4,204,214,154,75,0.5,[]],[176,3,17,176,3,17,176,3,17,176,3,17,176,3,17,176,3,17,176,3,17,176,3,17,176,3,17,176,3,17,176,3,17,176,3,17,179,34,37,179,34,37,179,34,37,179,34,37]],
  [[245,0,95],[0,0,4,4,0,0,0,0,4,21,249,76,181,0.5,[]],[245,0,95,245,0,95,245,0,95,245,0,95,245,0,95,245,0,95,245,0,95,245,0,95,245,0,95,245,0,95,245,0,95,245,0,95,164,89,88,164,89,88,164,89,88,164,89,88]],
  [[255,131,191],[0,0,4,4,0,0,0,0,2,234,5,44,38,0.5,[]],[255,131,191,255,131,191,255,131,191,253,121,179,255,131,191,255,131,191,255,131,191,253,121,179,255,131,191,255,131,191,255,131,191,253,121,179,255,131,191,255,131,191,255,131,191,253,121,179]],
  [[190,37,113],[0,0,4,4,0,0,0,0,1,89,95,82,203,0.5,[]],[150,60,100,150,60,100,150,60,100,150,60,100,190,37,113,190,37,113,190,37,113,190,37,113,190,37,113,190,37,113,190,37,113,190,37,113,190,37,113,190,37,113,190,37,113,190,37,113]],
];

/**
 * A pinned cell's pixel as the device's software layer computes it (DragonGroupView.dragonSoftwareGroup) with the layout functions:
 * each op a groupFill, a group a layer composited with groupComposite into whatever is below it, or, when its subtree holds exactly
 * one op and no nested group with ops (one draw between SaveLayerAlpha and Restore), that op at groupFoldAlpha.
 */
function cellPixel(d: Px, n: CellNode, x: number, y: number, foldAt: (a: number, o: number) => number = groupFoldAlpha): Px {
  const ops = (m: CellNode): number => (m[7] > 0 ? 1 : 0) + (m[8] !== 0 && m[12] > 0 ? 1 : 0);
  const all = (m: CellNode): number => ops(m) + m[14].reduce((t, k) => t + all(k), 0);
  const groupsIn = (m: CellNode): boolean => m[14].some((k) => (k[13] < 1 && all(k) > 0) || groupsIn(k));
  const fill = (p: Px, r: number, g: number, b: number, a: number): Px => unpack(groupFill(p[0], p[1], p[2], p[3], r, g, b, a));
  const own = (p: Px, m: CellNode, fold: number | null): Px => {
    const [mx, my, w, h, r, g, b, a, sides, br, bg, bb, ba] = m;
    if (!(x >= mx && x < mx + w && y >= my && y < my + h)) return p;
    let out = a > 0 ? fill(p, r, g, b, fold === null ? a : foldAt(a, fold)) : p;
    const edge = ((sides & 1) !== 0 && y === my) || ((sides & 2) !== 0 && x === mx + w - 1) || ((sides & 4) !== 0 && y === my + h - 1) || ((sides & 8) !== 0 && x === mx);
    if (edge && ba > 0) out = fill(out, br, bg, bb, fold === null ? ba : foldAt(ba, fold));
    return out;
  };
  const paint = (p: Px, m: CellNode): Px => {
    const o = m[13];
    if (o < 1) {
      if (all(m) === 0) return p;
      if (all(m) === 1 && !groupsIn(m)) {
        const folded = (q: Px, k: CellNode): Px => k[14].reduce(folded, own(q, k, ops(k) > 0 ? o : null));
        return folded(p, m);
      }
      const l = m[14].reduce(paint, own([0, 0, 0, 0], m, null));
      return unpack(groupComposite(l[0], l[1], l[2], l[3], p[0], p[1], p[2], p[3], opacityAlpha8(o), false));
    }
    return m[14].reduce(paint, own(p, m, null));
  };
  return paint(d, n);
}

describe('PNT1-opacity-b: the device\'s group composite equals the paint model', () => {
  it('groupComposite is the measured Color32 and s32a blits', () => {
    let seed = 7;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let k = 0; k < 4000; k++) {
      const a8 = [0, 1, 77, 128, 254, 255][k % 6] ?? next(256);
      const d: Px = [next(256), next(256), next(256), 255];
      const la = [0, 255, next(256)][k % 3] as number;
      const l: Px = [Math.min(la, next(256)), Math.min(la, next(256)), Math.min(la, next(256)), la];
      expect(unpack(groupComposite(l[0], l[1], l[2], l[3], d[0], d[1], d[2], d[3], a8, false)), `s32a ${l} ${d} ${a8}`).toEqual(a8 === 0 ? d : a8 === 255 ? color32(d, { r: l[0], g: l[1], b: l[2] }, 255).map((v, i) => (la === 255 ? v : (l[i] as number) + (((d[i] as number) * (256 - la)) >> 8))) : s32aBlend(d, l, a8));
      if (la === 255) expect(unpack(groupComposite(l[0], l[1], l[2], 255, d[0], d[1], d[2], d[3], a8, true)), `fold ${l} ${d} ${a8}`).toEqual(color32(d, { r: l[0], g: l[1], b: l[2] }, a8));
    }
  });
  // Chrome 145 (chrome-headless-shell, software raster, x86-64 with FMA) drew a 1px box filled with the premultiplied colour L over a
  // 1px opaque box D, the box carrying filter: <the (code, amount) list> and the opacity; got is the captured pixel. Two cells of each
  // of 96 filters (single functions at random, rounding-edge, default and percentage amounts, with and without an opacity, and lists
  // of two to four), one opaque and one translucent. The full sweeps (about 125,000 cells across seeds, DPR 1 to 3, translucent
  // layers and filter with opacity) matched groupFilterComposite at every cell; an unfused mad misses 410 of 6,000 invert cells.
  it('groupFilterComposite gives the bytes Chrome drew for each colour-matrix filter, with and without an opacity', () => {
    for (const [pairs, opacity, l, d, got] of FILTER_CELLS) {
      const v = unpack(groupFilterComposite(l[0], l[1], l[2], l[3], d[0], d[1], d[2], 255, groupFilterMatrices(pairs), opacityAlpha8(opacity)));
      expect(v, `${pairs} ${opacity} ${l} ${d}`).toEqual([...got, 255]);
    }
    expect(FILTER_CELLS.length).toBe(192);
  });
  it('the software layer gives the bytes Chrome drew for nested groups and translucent paint (groupFill, groupFoldAlpha, groupComposite)', () => {
    const problems: string[] = [];
    let nested = 0;
    let translucent = 0;
    const depth = (m: CellNode): number => (m[13] < 1 ? 1 : 0) + Math.max(0, ...m[14].map(depth));
    const clear = (m: CellNode): boolean => (m[7] > 0 && m[7] < 255) || (m[12] > 0 && m[12] < 255) || m[14].some(clear);
    for (const [d, tree, px] of GROUP_CELLS) {
      if (depth(tree) >= 2) nested++;
      if (clear(tree)) translucent++;
      for (let k = 0; k < 16; k++) {
        const got = cellPixel([d[0] as number, d[1] as number, d[2] as number, 255], tree, k % 4, Math.floor(k / 4));
        const want = [px[3 * k], px[3 * k + 1], px[3 * k + 2], 255];
        if (got.join() !== want.join()) problems.push(`${JSON.stringify(tree)} at ${k}: model ${got}, Chrome ${want}`);
      }
    }
    expect(problems).toEqual([]);
    expect([GROUP_CELLS.length, nested > 20, translucent > 30]).toEqual([52, true, true]);
    // Planted: the fold at the product of the two bytes (mulDiv255Round) instead of cc's float product misses some cell.
    const missed = GROUP_CELLS.some(([d, tree, px]) => [...Array(16).keys()].some((k) => cellPixel([d[0] as number, d[1] as number, d[2] as number, 255], tree, k % 4, Math.floor(k / 4), (a, o) => mdr(a, opacityAlpha8(o)))[0] !== px[3 * k]));
    expect(missed, 'byte-product fold').toBe(true);
  });
  it('folds a border-only group whose border is one op: four solid sides in one colour or a lone side, and no text group', () => {
    const spec = FIXTURES.find((f) => f.id === 'opacity-group-border-only');
    if (spec === undefined) throw new Error('no opacity-group-border-only fixture');
    for (const c of casesOf(spec, fixtureInput(spec))) {
      const r = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
      if (r.kind !== 'ready') throw new Error(r.reason);
      for (const dpr of DPRS) {
        // Each group lies inside one raster tile (above), so its box stands for the tile.
        const folds: Record<string, boolean> = {};
        for (const g of paintItems(r.programs.uikit, c.environment.viewport, dpr)) {
          if (g.kind === 'group') folds[g.box.node.id] = groupTileFolds(groupDraws(g.items), g.box.l, g.box.t, g.box.r, g.box.b);
        }
        expect(folds, `${c.id} @${dpr}`).toEqual({ 'ob-a': true, 'ob-b': true, 'ob-d': true, 'ob-e': false, 'ob-f': false, 'ob-g': false });
      }
    }
    // cc never folds a DrawTextBlob (paint_op_buffer_iterator.cc:20-25): a text-only group composites as a layer.
    const text = FIXTURES.find((f) => f.id === 'opacity-group-text');
    if (text === undefined) throw new Error('no opacity-group-text fixture');
    const c = casesOf(text, fixtureInput(text))[0];
    if (c === undefined) throw new Error('no opacity-group-text case');
    const r = nativePrograms(nativeCompile(text, c.environment.direction), c.assignment);
    if (r.kind !== 'ready') throw new Error(r.reason);
    for (const it of paintItems(r.programs.uikit, c.environment.viewport, 2)) {
      if (it.kind !== 'group' || !['og-b', 'og-f'].includes(it.box.node.id)) continue;
      expect(groupTileFolds(groupDraws(it.items), it.box.l, it.box.t, it.box.r, it.box.b), it.box.node.id).toBe(false);
    }
  });
  const precomposited = (id: string): boolean => id.startsWith('opacity-group-') || id.startsWith('filter-matrix-');
  const groupFixtures = FIXTURES.filter((f) => precomposited(f.id));
  it('admits every translucent or filtered group of the opacity-group and filter-matrix fixtures, which compile on native as user cases', () => {
    expect(groupFixtures.length).toBe(10);
    for (const spec of groupFixtures) {
      for (const c of casesOf(spec, fixtureInput(spec))) {
        const lanes = nativeCompile(spec, c.environment.direction);
        expect(laneOnlyNative(lanes, 'ios'), c.id).toBe(false);
        expect(laneOnlyNative(lanes, 'android'), c.id).toBe(false);
        const r = nativePrograms(lanes, c.assignment);
        if (r.kind !== 'ready') throw new Error(r.reason);
        for (const p of [r.programs.uikit, r.programs['android-views']]) {
          const translucent = p.nodes.filter((n) => {
            const e = n.facts['effects'] as { opacity: number; filter?: readonly unknown[] } | undefined;
            return e !== undefined && e.opacity > 0 && (e.opacity < 1 || (e.filter ?? []).length > 0);
          });
          expect(translucent.length, c.id).toBeGreaterThan(0);
          // A group nested in an admitted group has an opacity-nested write: its outer group's overlay composites it.
          const nested = (n: ProgramNode): boolean => n.writes.some((w) => w.kind === 'opacity-nested');
          expect(translucent.filter((n) => groupPlanOf(n) === null && !nested(n)).map((n) => n.id), c.id).toEqual([]);
          if (spec.id === 'opacity-group-nested') expect(p.nodes.filter(nested).map((n) => n.id), c.id).toEqual(['on-a-in', 'on-b-in', 'on-c-mid', 'on-c-deep', 'on-d-in', 'on-e-in', 'on-f-in']);
          if (spec.id === 'opacity-group-nested' || spec.id === 'opacity-group-translucent') {
            // Every group of these fixtures holds a nested group or translucent paint, so the device builds its layer in software.
            for (const dpr of DPRS) for (const it of paintItems(p, c.environment.viewport, dpr)) if (it.kind === 'group') expect(softwareGroup(it.items), `${c.id} ${it.box.node.id}`).toBe(true);
          }
          expect(p.nodes.some((n) => n.writes.some((w) => w.kind === 'opacity')), c.id).toBe(false);
        }
      }
    }
  });
  for (const spec of FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id}: the device composite at every point`, () => {
        const r = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (r.kind !== 'ready') throw new Error(r.reason);
        const p = r.programs.uikit;
        let groups = 0;
        for (const dpr of DPRS) {
          const items = paintItems(p, c.environment.viewport, dpr);
          const byId = new Map(boxes(p, c.environment.viewport, dpr).map((b) => [b.node.id, b]));
          const problems: string[] = [];
          for (const pt of casePoints(p, c.environment.viewport, dpr)) {
            const want = effectsModelAt(items, byId, pt.x, pt.y, dpr);
            const got = deviceAt(p, items, byId, pt.x, pt.y, dpr);
            if (got.join() !== want.join()) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: device ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
          }
          expect(problems).toEqual([]);
          groups += p.nodes.filter((n) => groupPlanOf(n) !== null).length;
        }
        if (precomposited(spec.id)) expect(groups, 'pre-composited groups').toBeGreaterThan(0);
      });
    }
  }
});

// The cases of the rest of the corpus whose paint order PNT1 changes (every layer item gets a placement): the model in the Appendix E
// order equals Chrome at every non-edge point. A case is left out only for paint the model does not draw, each named by modelOut and
// pinned in OUT below, so a new case outside the model is seen: an image, a web view or background layers (gradients), a transform
// other than a whole-device-px translation, a border style other than solid, or flow siblings the engine lays out in another order than the tree's (flex order and
// reversed directions: Chrome paints them in order-modified document order, which the native views follow and the model does not).
function modelOut(p: NativeProgram, viewport: { width: number; height: number }): string | null {
  for (const n of p.nodes) {
    for (const w of n.writes) {
      if (w.kind === 'replaced-image' || w.kind === 'foreign-view' || w.kind === 'background-layers') return `${n.id} draws ${w.kind}`;
      if (w.kind === 'border-styles' && w.styles.some((x) => x !== 'solid' && x !== 'none' && x !== 'hidden')) return `${n.id} has a ${w.styles.join(' ')} border`;
    }
  }
  for (const dpr of DPRS) {
    try {
      translationOf(p, p.nodes[p.nodes.length - 1]?.id ?? '', dpr);
      for (const n of p.nodes) translationOf(p, n.id, dpr);
    } catch (e) {
      return (e as Error).message;
    }
  }
  const engine = expectedEngine();
  const out = engine.layout(programInput(p, viewport, 2), engine.measurer);
  if (out.kind !== 'ok') throw new Error('the engine refused the case');
  // Only the flow siblings of each parent: the layer items are sorted into Appendix E order on the device, whatever order the engine
  // lays them out in.
  const at = new Map(out.boxes.map((r, k) => [r.id, k]));
  const flow = p.nodes.filter((n) => n.kind !== 'text' && (n.facts['stacking'] as { layer: string } | undefined)?.layer === 'flow');
  for (const parent of new Set(flow.map((n) => n.parent))) {
    const siblings = flow.filter((n) => n.parent === parent).map((n) => n.id);
    const laidOut = [...siblings].sort((x, y) => (at.get(x) as number) - (at.get(y) as number));
    if (laidOut.join() !== siblings.join()) return `the engine lays out the flow children of ${parent} in another order than the tree`;
  }
  return null;
}

/** The corpus cases outside the model (modelOut), pinned: a change here is a decision, not drift. */
const OUT = [
  'alias-paint', 'gradient-abspos', 'gradient-abspos-rtl', 'gradient-north-star', 'hit-order', 'hit-order-rtl', 'overflow-replaced', 'overflow-replaced-rtl', 'replaced-block', 'replaced-block-rtl', 'replaced-demo', 'replaced-demo-rtl', 'replaced-intrinsic', 'replaced-intrinsic-rtl',
  'transform-clip', 'transform-demo', 'transform-direction', 'transform-direction-rtl', 'transform-flex', 'transform-matrix', 'transform-nested',
  'transform-origin', 'transform-rotate', 'transform-scale', 'transform-text', 'transform-translate', 'transform-will-change', 'var-logical',
  'var-logical-rtl',
];

describe('PNT1 stacking: the corpus cases the placements reach paint in Chrome\'s order', () => {
  // A case native refuses only for its real faces (deferred to TXT1a-2 phase R) gets the engine lowering instead; it is left out here.
  const refusedFaces = new Map<string, string>();
  const reached = CORPUS.filter((f) => f.kind === 'layout' && !GROUPS.some((g) => FIXTURE_GROUPS.find((x) => x.id === g)?.fixtures.includes(f))).flatMap((spec) =>
    casesOf(spec, fixtureInput(spec)).flatMap((c) => {
      const compiled = nativeCompileOnce(spec, c.environment.direction);
      const r = nativePrograms(compiled, c.assignment);
      if (r.kind !== 'ready') {
        if (engineLayoutProjection(compiled, c.environment, c.assignment).kind !== 'ready') throw new Error(`${c.id}: ${r.reason}`);
        refusedFaces.set(c.id, r.reason);
        return [];
      }
      const p = r.programs.uikit;
      return p.nodes.some((n) => n.writes.some((w) => w.kind === 'paint-order')) ? [{ spec, c, p, out: modelOut(p, c.environment.viewport) }] : [];
    }),
  );
  it('reaches the positioned, flex-abspos, context, phrasing and values cases, and leaves out exactly the pinned cases', () => {
    expect(reached.filter((r) => r.out === null).length).toBeGreaterThan(80);
    expect(reached.filter((r) => r.out !== null).map((r) => r.c.id).sort()).toEqual(OUT);
  });
  it('leaves out only shaped cases native refuses for their faces', () => {
    expect(refusedFaces.size).toBeGreaterThan(0);
    expect([...refusedFaces.keys()].filter((id) => !shapedCaseIds().has(id))).toEqual([]);
    for (const [id, reason] of refusedFaces) expect(reason, id).toMatch(/^the (ios|android) target is blocked$/);
  });
  for (const { c, p, out } of reached) {
    if (out !== null) continue;
    it(`${c.id}`, () => {
      const { problems, compared } = modelProblems(c.id, p, c.environment.viewport);
      expect(problems).toEqual([]);
      expect(compared).toBeGreaterThan(0);
    });
  }
});

// The fractional opacity cases (opacity-web): native refuses a fraction on a group of more than one fill (PNT1-opacity-b), so the
// lanes compile the fixture as a lane-only case, which proves web rows only, and the device pixel lanes skip what its translucent
// groups paint. opacity-fold holds only groups of one opaque fill, which native draws folded into the fill.
describe('PNT1 opacity: fractions are proven on web only', () => {
  const spec = FIXTURES.find((f) => f.id === 'opacity-web');
  it('is lane-only on native, refused by name in a user compile, and its groups are the device lanes\' blind spot alone', () => {
    if (spec === undefined || spec.kind !== 'layout') throw new Error('no opacity-web fixture');
    for (const c of casesOf(spec, fixtureInput(spec))) {
      const lanes = nativeCompile(spec, c.environment.direction);
      expect(laneOnlyNative(lanes, 'ios'), c.id).toBe(true);
      expect(laneOnlyNative(lanes, 'android'), c.id).toBe(true);
      const user = createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: c.environment.direction }).compile(fixtureInput(spec));
      const errs = user.diagnostics.filter((d) => d.severity === 'error');
      expect(errs.length, c.id).toBeGreaterThan(0);
      for (const d of errs) expect([d.target, d.message], c.id).toEqual(['ios', expect.stringMatching(/^ow-[a-z]+ has opacity [0-9.]+; ios composites a translucent view with its own rounding/)]);
      const r = nativePrograms(lanes, c.assignment);
      if (r.kind !== 'ready') throw new Error(r.reason);
      // ow-fold and ow-pct fold, but row2's ow-text holds text, whose glyphs no layout-free proof keeps out of row1, so neither has a
      // provable backdrop and both keep the platform blend of the translucent colour.
      expect(r.programs.uikit.nodes.filter((n) => n.writes.some((w) => w.kind === 'background-color' && w.folded === true)).map((n) => n.id), c.id).toEqual([]);
      for (const dpr of DPRS) {
        const all = casePoints(r.programs.uikit, c.environment.viewport, dpr);
        const kept = devicePoints(r.programs.uikit, c.environment.viewport, dpr);
        // Every point named for a group's node goes; the stage, rows and spacers keep theirs, and so do ow-fold and ow-pct, whose
        // groups of one opaque fill fold into the fill (PNT1-opacity-b, first part), so native draws them without a group.
        expect(kept.filter((q) => /^[a-z-]+:ow-/.test(q.rule) && !/^[a-z-]+:ow-(fold|pct)(:|$)/.test(q.rule)), `${c.id}@${dpr}`).toEqual([]);
        expect(kept.some((q) => /^[a-z-]+:ow-fold(:|$)/.test(q.rule)), `${c.id}@${dpr}`).toBe(true);
        expect(kept.some((q) => q.rule.startsWith('interior:stage') || q.rule.startsWith('interior:sp')), `${c.id}@${dpr}`).toBe(true);
        expect(kept.length, `${c.id}@${dpr}`).toBeLessThan(all.length);
      }
    }
  });
  // A pre-composited group (an opacity-group write) keeps its points: the device shows Chrome's bytes for it.
  it('drops no point of a case without a refused translucent group', () => {
    for (const spec of FIXTURES.filter((f) => f.id !== 'opacity-web')) {
      if (spec.kind !== 'layout') continue;
      for (const c of casesOf(spec, fixtureInput(spec))) {
        const r = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (r.kind !== 'ready') throw new Error(r.reason);
        for (const dpr of DPRS) expect(devicePoints(r.programs.uikit, c.environment.viewport, dpr), `${c.id}@${dpr}`).toEqual(casePoints(r.programs.uikit, c.environment.viewport, dpr));
      }
    }
  });
  it('cites opacity-web for the web opacity rows and never for a native one', () => {
    const cites = (rows: typeof webProfile.rows): string[] => rows.filter((r) => r.feature.startsWith('opacity:')).flatMap((r) => r.proofs.flatMap((p) => p.cases));
    expect(cites(webProfile.rows)).toEqual(expect.arrayContaining(['opacity-web', 'opacity-web-rtl']));
    for (const profile of [iosProfile, androidProfile]) expect(cites(profile.rows).filter((id) => id.startsWith('opacity-web'))).toEqual([]);
  });
});
