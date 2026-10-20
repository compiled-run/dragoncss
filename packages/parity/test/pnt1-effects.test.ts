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
import { groupComposite, groupFilterComposite, groupFilterMatrices, groupTileFolds, opacityAlpha8, snapEdges } from '@dragon/layout';
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
  | { readonly kind: 'group'; readonly box: Box; readonly alpha8: number; readonly matrices: readonly number[] | null; readonly items: readonly Item[] };

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
      out.push({ kind: 'group', box: byId.get(n.id) as Box, alpha8: faults.alphaIgnored ? 255 : opacityAlpha8(effects.opacity), matrices, items: [...withText(n), ...build(members.filter((x) => x !== n))] });
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
  if (it.kind === 'box') return paintBox(dst, it.box, cx, cy, byId, 255);
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
  if (content.direct.length === 1 && content.nested === 0 && only !== undefined && only.kind === 'box' && boxOps(only.box).foldable) return paintBox(dst, only.box, cx, cy, byId, it.alpha8);
  let layer: Px = [0, 0, 0, 0];
  for (const inner of it.items) layer = paintItem(layer, inner, x, y, tile, byId);
  return s32aBlend(dst, layer, it.alpha8);
}

/** A box's background and solid border sides at a pixel centre, the box's one op at a folded alpha when alpha is below 255. */
function paintBox(dst: Px, b: Box, cx: number, cy: number, byId: ReadonlyMap<string, Box>, alpha: number): Px {
  if (clippedOut(b.node, byId, cx, cy) || !inside(cx, cy, b.l, b.t, b.r, b.b)) return dst;
  let out = dst;
  const bg = b.node.writes.find((w) => w.kind === 'background-color');
  if (bg !== undefined && bg.kind === 'background-color' && bg.color.alpha > 0) {
    // A folded translucent colour would take Skia's float alpha product, which the fixtures do not use.
    if (alpha !== 255 && bg.color.alpha !== 255) throw new Error(`${b.node.id}: the model folds opaque backgrounds only`);
    out = color32(out, bg.color, alpha === 255 ? bg.color.alpha : alpha);
  }
  const [bt, br, bb, bl] = b.border as [number, number, number, number];
  if (inside(cx, cy, b.l + bl, b.t + bt, b.r - br, b.b - bb)) return out;
  const styles = b.node.writes.find((w) => w.kind === 'border-styles');
  const colours = b.node.writes.find((w) => w.kind === 'border-colors');
  if (styles === undefined || styles.kind !== 'border-styles' || colours === undefined || colours.kind !== 'border-colors') return out;
  const side = cy < b.t + bt ? 0 : cy >= b.b - bb ? 2 : cx < b.l + bl ? 3 : 1;
  if (styles.styles[side] !== 'solid') throw new Error(`${b.node.id}: the model paints solid borders only`);
  const c = colours.colors[side] as { r: number; g: number; b: number; alpha: number };
  // A folded border is the box's one op (boxOps): its opaque colour at the group's alpha.
  if (alpha !== 255 && c.alpha !== 255) throw new Error(`${b.node.id}: the model folds opaque borders only`);
  return color32(out, c, alpha === 255 ? c.alpha : alpha);
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

type GroupPlan = { readonly alpha8: number; readonly matrices: readonly number[] | null; readonly painters: readonly string[] };

/** The plan of a node the compiler pre-composites (an opacity-group or filter-group write), or null. */
function groupPlanOf(n: ProgramNode): GroupPlan | null {
  for (const w of n.writes) {
    if (w.kind === 'opacity-group') return { alpha8: opacityAlpha8(w.opacity), matrices: null, painters: w.painters };
    // The matrices the device builds from the emitted (code, amount) pairs (EFFECTS_EMITTER, DragonGroupView).
    if (w.kind === 'filter-group') return { alpha8: opacityAlpha8(w.opacity), matrices: groupFilterMatrices(filterPairs(w.filter)), painters: w.painters };
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

/** The display items the device counts for the per-tile fold: each painting box (a lone fill folds) and each glyph. */
function groupDraws(items: readonly Item[]): number[] {
  return items.flatMap((it) => {
    if (it.kind === 'box') {
      const ops = boxOps(it.box);
      return ops.count === 0 ? [] : [it.box.l, it.box.t, it.box.r, it.box.b, ops.foldable ? 1 : 0];
    }
    if (it.kind === 'text') return it.glyphs.flatMap((g) => [Math.floor(g.left), Math.floor(g.top), Math.ceil(g.right), Math.ceil(g.bottom), 0]);
    return groupDraws(it.items);
  });
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
    expect(FIXTURES.map((f) => f.id)).toEqual(['opacity-basic', 'opacity-cascade', 'opacity-web', 'opacity-fold', 'opacity-group-text', 'opacity-group-border', 'opacity-group-border-only', 'opacity-group-over-rects', 'opacity-group-over-group', 'opacity-group-clipped', 'stacking-basic', 'stacking-context', 'stacking-escape', 'stacking-transform', 'stacking-grid-items', 'stacking-isolation', 'stacking-backface', 'filter-none', 'filter-matrix-text', 'filter-matrix-over-rects']);
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
          // Each shares the stage with other painted fills, which no geometry-free proof keeps from under it, so none is drawn as
          // Chrome's bytes: they keep the platform blend of the translucent colour.
          expect(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'background-color' && w.folded === true)).map((n) => n.id)).toEqual([]);
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
    expect(groupFixtures.length).toBe(8);
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
          expect(translucent.filter((n) => groupPlanOf(n) === null).map((n) => n.id), c.id).toEqual([]);
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
// pinned in OUT below, so a new case outside the model is seen: an image, a web view, background layers (gradients) or a url() layer, a transform
// other than a whole-device-px translation, a border style other than solid, or flow siblings the engine lays out in another order than the tree's (flex order and
// reversed directions: Chrome paints them in order-modified document order, which the native views follow and the model does not).
function modelOut(p: NativeProgram, viewport: { width: number; height: number }): string | null {
  for (const n of p.nodes) {
    for (const w of n.writes) {
      if (w.kind === 'replaced-image' || w.kind === 'foreign-view' || w.kind === 'background-layers' || w.kind === 'background-image') return `${n.id} draws ${w.kind}`;
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
      // ow-fold and ow-pct fold, but other fills paint beside them, so neither has a provable backdrop and both keep the platform blend.
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
