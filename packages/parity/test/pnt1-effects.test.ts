// PNT1 opacity and stacking on the host (T046 §2): the effects fixtures' points against the committed Chrome PNGs at every device DPR.
// A paint model of Chrome 145's CPU raster predicts each sample: boxes, borders and glyphs painted in the program's Appendix E order
// (the stacking facts), clipped by the overflow clips of their containing-block chain, and each opacity group composited as Chrome
// does: a group whose only drawing (in the raster tile of the pixel) is one foldable draw has the alpha folded into it (Chromium
// 145.0.7632.6 cc/paint/paint_op_buffer_iterator.cc:13-146) and is blitted as a solid colour (Skia 2ab8add5
// src/opts/SkBlitRow_opts.h:243-270 blit_row_color32: premultiplied colour + dst * (256 - a) >> 8); any other group is a layer
// composited with blit_row_s32a_blend (src/core/SkBlitRow_D32.cpp:204-301, src/core/SkColorData.h:134-137 SkAlphaMulInv256:
// (src * (a + 1) + dst * SkAlphaMulInv256(srcA, a + 1)) >> 8). The
// alpha byte is paint.ts opacityAlpha8, the one the device uses. Every sample colour must equal Chrome's exactly, which proves the
// paint order, the group opacity and the alpha byte before any device runs. Chrome's composite is measured, not assumed: the first
// test fits the two blits and the byte against a captured sweep of opacities.
import { describe, expect, it } from 'vitest';
import { opacityAlpha8, outlineOffsetPx, outlineRings, outlineWidthPx } from '@dragon/layout';
import { ccTileEnd, ccTileIndex, ccTileSize, ccTileStart } from '../../layout/src/paint-dither.ts';
import type { NativeProgram, ProgramNode } from 'dragon';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS, FIXTURES as CORPUS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels, glyphLines } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import type { Box } from './paint-model.ts';
import { boxes, insideRounded } from './paint-model.ts';

type Px = [number, number, number, number];

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

type Stacking = { paintOrder: number; clipChain: readonly string[]; layer: string; context: string | null; textPaintOrder: readonly number[] };
type Item =
  | { readonly kind: 'box'; readonly box: Box }
  | { readonly kind: 'outline'; readonly box: Box; readonly rings: readonly number[]; readonly color: { r: number; g: number; b: number; alpha: number } }
  | { readonly kind: 'text'; readonly node: ProgramNode; readonly glyphs: readonly { left: number; top: number; right: number; bottom: number }[] }
  | { readonly kind: 'group'; readonly box: Box; readonly alpha8: number; readonly items: readonly Item[] };

const stackingOf = (n: ProgramNode): Stacking => {
  const s = n.facts['stacking'] as Stacking | undefined;
  if (s === undefined) throw new Error(`${n.id}: no stacking facts`);
  return s;
};

/**
 * Planted model faults the test must catch: the alpha ignored (alpha-ignored), tree order instead of the paint order (order-swap),
 * outlines one device px to the right (outline-offset-1), and hosted text sorted beneath its host's flow children
 * (foreground-under).
 */
type ModelFaults = { readonly alphaIgnored: boolean; readonly treeOrder: boolean; readonly outlineShifted?: boolean; readonly foregroundUnder?: boolean };
const NO_MODEL_FAULTS: ModelFaults = { alphaIgnored: false, treeOrder: false };

/**
 * The case's paint items in Appendix E order (the compiler's paint-order facts, text included: each paint root's block backgrounds,
 * then its foreground), each opacity context holding its subtree's items as a group.
 */
function paintItems(p: NativeProgram, viewport: { width: number; height: number }, dpr: number, faults: ModelFaults = NO_MODEL_FAULTS): Item[] {
  const list = boxes(p, viewport, dpr);
  const byId = new Map(list.map((b) => [b.node.id, b]));
  const children = new Map<string, ProgramNode[]>();
  for (const n of p.nodes) if (n.parent !== null) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const glyphsOf = new Map<string, { left: number; top: number; right: number; bottom: number }[]>();
  for (const l of glyphLines(p, viewport, dpr)) {
    const id = l.id.slice(0, l.id.lastIndexOf(':line'));
    glyphsOf.set(id, [...(glyphsOf.get(id) ?? []), ...l.glyphs]);
  }
  const subtree = (n: ProgramNode): ProgramNode[] => [n, ...(children.get(n.id) ?? []).flatMap(subtree)];
  const byNode = new Map(p.nodes.map((n) => [n.id, n]));
  const tree = new Map(p.nodes.map((x, k) => [x.id, k]));
  // A text leaf's Appendix E index is in its box's facts (textPaintOrder, in child order).
  const textOrder = new Map<string, number>();
  for (const n of p.nodes) {
    if (n.kind === 'text') continue;
    const texts = (children.get(n.id) ?? []).filter((c) => c.kind === 'text');
    const at = stackingOf(n).textPaintOrder;
    if (at.length !== texts.length) throw new Error(`${n.id}: ${texts.length} text leaves, ${at.length} text paint orders`);
    texts.forEach((t, k) => textOrder.set(t.id, at[k] as number));
  }
  // foreground-under: a text leaf hosted out of its box sorts right after its host box, beneath the host's flow children.
  const hostedText = new Map<string, string>();
  for (const n of p.nodes) for (const w of n.writes) if (w.kind === 'paint-foreground') for (const e of w.entries) if (byNode.get(e.id)?.kind === 'text') hostedText.set(e.id, w.host);
  const orderOf = (n: ProgramNode): number => {
    if (n.kind !== 'text') return stackingOf(n).paintOrder;
    const h = hostedText.get(n.id);
    if (faults.foregroundUnder === true && h !== undefined) return stackingOf(byNode.get(h) as ProgramNode).paintOrder + 0.25 + (tree.get(n.id) as number) / (p.nodes.length + 1) / 8;
    return textOrder.get(n.id) as number;
  };
  // An outline paints in its paint root L's outline phase: after L's background, flow content and foreground (and the subtrees of
  // L's negative z items), before L's other layer items; outlines of one root in tree order (Blink PaintLayerPainter, and a flex
  // item's atomic pass: BoxFragmentPainter::PaintAllPhasesAtomically).
  const contentEnd = (layer: ProgramNode): number => {
    let last = stackingOf(layer).paintOrder;
    const visit = (x: ProgramNode): void => {
      if (x.kind === 'text') {
        last = Math.max(last, orderOf(x));
        return;
      }
      const s = stackingOf(x);
      if (x !== layer && (s.layer === 'positioned' || s.layer === 'positive')) return;
      last = Math.max(last, s.paintOrder);
      for (const c of children.get(x.id) ?? []) visit(c);
    };
    visit(layer);
    return last;
  };
  const outlineKey = new Map<string, number>();
  for (const n of p.nodes) {
    const f = n.facts['outline'] as { layer: string } | undefined;
    if (f === undefined) continue;
    outlineKey.set(n.id, contentEnd(byNode.get(f.layer) as ProgramNode) + 0.5 + (tree.get(n.id) as number) / (p.nodes.length + 1) / 2);
  }
  const ringsOf = (n: ProgramNode): Item => {
    const w = n.writes.find((x) => x.kind === 'outline');
    if (w === undefined || w.kind !== 'outline') throw new Error(`${n.id}: outline facts without an outline write`);
    const b = byId.get(n.id) as Box;
    const radii = b.radii === null ? [0, 0, 0, 0, 0, 0, 0, 0] : b.radii.slice(0, 8);
    const shift = faults.outlineShifted === true ? 1 : 0;
    return { kind: 'outline', box: b, rings: outlineRings(b.l + shift, b.t, b.r + shift, b.b, radii, outlineWidthPx(w.width, dpr), outlineOffsetPx(w.offset, dpr), w.style === 'double'), color: w.color };
  };
  type Entry = { readonly node: ProgramNode; readonly outline: boolean };
  // skip: the group whose box its caller already holds (its outline still sorts here, among its members).
  const build = (nodes: readonly ProgramNode[], skip: string | null = null): Item[] => {
    const rank = (x: Entry): number => (faults.treeOrder ? (tree.get(x.node.id) as number) + (x.outline ? 0.5 : 0) : x.outline ? (outlineKey.get(x.node.id) as number) : orderOf(x.node));
    const entries: Entry[] = nodes.flatMap((x) => [...(x.id === skip ? [] : [{ node: x, outline: false }]), ...(outlineKey.has(x.id) ? [{ node: x, outline: true }] : [])]);
    const sorted = entries.sort((a, b) => rank(a) - rank(b));
    const out: Item[] = [];
    for (let k = 0; k < sorted.length; k++) {
      const e = sorted[k] as Entry;
      const n = e.node;
      if (e.outline) {
        out.push(ringsOf(n));
        continue;
      }
      if (n.kind === 'text') {
        out.push({ kind: 'text', node: n, glyphs: glyphsOf.get(n.id) ?? [] });
        continue;
      }
      const effects = n.facts['effects'] as { opacity: number } | undefined;
      if (effects === undefined) {
        out.push({ kind: 'box', box: byId.get(n.id) as Box });
        continue;
      }
      const inside = new Set(subtree(n).map((x) => x.id));
      const members = sorted.filter((x) => inside.has(x.node.id));
      // A stacking context is atomic: its subtree (and its outlines) are contiguous in the paint order.
      if (sorted.slice(k, k + members.length).some((x) => !inside.has(x.node.id))) throw new Error(`${n.id}: its subtree is not contiguous in the paint order`);
      out.push({ kind: 'group', box: byId.get(n.id) as Box, alpha8: faults.alphaIgnored ? 255 : opacityAlpha8(effects.opacity), items: [{ kind: 'box', box: byId.get(n.id) as Box }, ...build([...new Set(members.map((x) => x.node))], n.id)] });
      k += members.length - 1;
    }
    return out;
  };
  return build(p.nodes);
}

const inside = (x: number, y: number, l: number, t: number, r: number, b: number): boolean => x >= l && x < r && y >= t && y < b;

/** The drawing ops of a box (a background rect, border sides); a box with both is one display item of several ops. */
function boxOps(b: Box): { readonly count: number; readonly foldable: boolean } {
  const bg = b.node.writes.find((w) => w.kind === 'background-color');
  const hasBg = bg !== undefined && bg.kind === 'background-color' && bg.color.alpha > 0;
  const styles = b.node.writes.find((w) => w.kind === 'border-styles');
  const borders = styles !== undefined && styles.kind === 'border-styles' ? styles.styles.filter((s, k) => s !== 'none' && s !== 'hidden' && (b.border[k] as number) > 0).length : 0;
  return { count: (hasBg ? 1 : 0) + borders, foldable: hasBg && borders === 0 };
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
    if (it.kind === 'outline' && meets(tile, it.rings[0] as number, it.rings[1] as number, it.rings[2] as number, it.rings[3] as number)) direct.push(it);
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
    if (!insideRounded(cx, cy, a.l + (a.border[3] as number), a.t + (a.border[0] as number), a.r - (a.border[1] as number), a.b - (a.border[2] as number), a.radii === null ? null : a.radii.slice(8, 16))) return true;
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
  if (it.kind === 'outline') {
    if (clippedOut(it.box.node, byId, cx, cy)) return dst;
    const r = it.rings;
    for (let k = 0; k + 24 <= r.length; k += 24) {
      const v = (j: number): number => r[k + j] as number;
      const ring = insideRounded(cx, cy, v(0), v(1), v(2), v(3), r.slice(k + 8, k + 16)) && !insideRounded(cx, cy, v(4), v(5), v(6), v(7), r.slice(k + 16, k + 24));
      if (ring) return color32(dst, it.color, it.color.alpha);
    }
    return dst;
  }
  if (it.alpha8 === 0) return dst;
  // The group's one drawing in this tile, when it is a background rect, takes the alpha itself (cc folds the layer into it).
  const content = tileItems(it.items, tile);
  const only = content.direct[0];
  if (content.direct.length === 1 && content.nested === 0 && only !== undefined && only.kind === 'box' && boxOps(only.box).foldable) return paintBox(dst, only.box, cx, cy, byId, it.alpha8);
  let layer: Px = [0, 0, 0, 0];
  for (const inner of it.items) layer = paintItem(layer, inner, x, y, tile, byId);
  return s32aBlend(dst, layer, it.alpha8);
}

/** A box's background and solid border sides at a pixel centre, the background at a folded alpha when alpha is below 255. */
function paintBox(dst: Px, b: Box, cx: number, cy: number, byId: ReadonlyMap<string, Box>, alpha: number): Px {
  if (clippedOut(b.node, byId, cx, cy) || !insideRounded(cx, cy, b.l, b.t, b.r, b.b, b.radii === null ? null : b.radii.slice(0, 8))) return dst;
  let out = dst;
  const bg = b.node.writes.find((w) => w.kind === 'background-color');
  if (bg !== undefined && bg.kind === 'background-color' && bg.color.alpha > 0) {
    // A folded translucent colour would take Skia's float alpha product, which the fixtures do not use.
    if (alpha !== 255 && bg.color.alpha !== 255) throw new Error(`${b.node.id}: the model folds opaque backgrounds only`);
    out = color32(out, bg.color, alpha === 255 ? bg.color.alpha : alpha);
  }
  const [bt, br, bb, bl] = b.border as [number, number, number, number];
  if (insideRounded(cx, cy, b.l + bl, b.t + bt, b.r - br, b.b - bb, b.radii === null ? null : b.radii.slice(8, 16))) return out;
  const styles = b.node.writes.find((w) => w.kind === 'border-styles');
  const colours = b.node.writes.find((w) => w.kind === 'border-colors');
  if (styles === undefined || styles.kind !== 'border-styles' || colours === undefined || colours.kind !== 'border-colors') return out;
  const side = cy < b.t + bt ? 0 : cy >= b.b - bb ? 2 : cx < b.l + bl ? 3 : 1;
  if (styles.styles[side] !== 'solid') throw new Error(`${b.node.id}: the model paints solid borders only`);
  const c = colours.colors[side] as { r: number; g: number; b: number; alpha: number };
  return color32(out, c, c.alpha);
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

// ---------------------------------------------------------------- the fixtures

const GROUPS = ['outline', 'opacity', 'stacking', 'color-scheme'];
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
  it('covers the outline, opacity, stacking and color-scheme fixtures', () => {
    expect(FIXTURES.map((f) => f.id)).toEqual(['outline-values', 'outline-solid', 'outline-double', 'color-scheme-basic', 'opacity-basic', 'opacity-cascade', 'stacking-basic', 'stacking-context', 'stacking-escape', 'stacking-foreground']);
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
        if (spec.id.startsWith('opacity-') || spec.id === 'stacking-context') expect(caught({ alphaIgnored: true, treeOrder: false }), 'alpha-ignored').toBe(true);
        if (spec.id.startsWith('stacking-')) expect(caught({ alphaIgnored: false, treeOrder: true }), 'order-swap').toBe(true);
        if (spec.id === 'outline-solid' || spec.id === 'outline-double') expect(caught({ alphaIgnored: false, treeOrder: false, outlineShifted: true }), 'outline-offset-1').toBe(true);
        if (spec.id === 'stacking-foreground') expect(caught({ alphaIgnored: false, treeOrder: false, foregroundUnder: true }), 'foreground-under').toBe(true);
      });
    }
  }
});

// The cases of the rest of the corpus whose paint order PNT1 changes (every layer item and every hosted foreground gets a placement):
// the model in the Appendix E order equals Chrome at every non-edge point. Left out, by name and checked to be exactly these: the
// cases with box shadows (the model draws no shadow rasters; pnt1-reference.test.ts proves them against Chrome), those with dashed
// or dotted border sides, which the model does not draw, and rounded boxes with a border side next to a side without one (the model
// does not split a corner between the outer and inner curves).
const MODEL_OUT = ['var-logical', 'radius-borders', 'radius-clip', 'shadow-basic', 'shadow-rounded', 'shadow-inset', 'shadow-cascade', 'calib-shadow-blur', 'calib-shadow-colors'];
/** Why a program is outside the model, or null: a box shadow, a border side that is not solid, or a rounded box with mixed sides. */
const outOfModel = (p: NativeProgram): string | null => {
  if (p.nodes.some((n) => n.writes.some((w) => w.kind === 'box-shadow'))) return 'box-shadow';
  for (const n of p.nodes) {
    for (const w of n.writes) {
      if (w.kind !== 'border-styles') continue;
      const painted = w.styles.map((st) => st !== 'none' && st !== 'hidden');
      if (w.styles.some((st, k) => painted[k] === true && st !== 'solid')) return 'border style';
      if (n.writes.some((x) => x.kind === 'border-radius') && painted.some((x) => x) && painted.some((x) => !x)) return 'rounded mixed sides';
    }
  }
  return null;
};

describe('PNT1 stacking: the corpus cases the placements reach paint in Chrome\'s order', () => {
  const reached = CORPUS.filter((f) => f.kind === 'layout' && !GROUPS.some((g) => FIXTURE_GROUPS.find((x) => x.id === g)?.fixtures.includes(f))).flatMap((spec) =>
    casesOf(spec, fixtureInput(spec)).flatMap((c) => {
      const r = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
      if (r.kind !== 'ready') throw new Error(`${c.id}: ${r.reason}`);
      const p = r.programs.uikit;
      return p.nodes.some((n) => n.writes.some((w) => w.kind === 'paint-order' || w.kind === 'paint-foreground')) ? [{ spec, c, p }] : [];
    }),
  );
  it('reaches the positioned, flex-abspos, context, phrasing and values cases', () => {
    expect(reached.length).toBeGreaterThan(80);
    expect(MODEL_OUT.every((id) => reached.some((r) => r.spec.id === id))).toBe(true);
    expect([...new Set(reached.filter((r) => outOfModel(r.p) !== null).map((r) => r.spec.id))].sort()).toEqual([...MODEL_OUT].sort());
  });
  for (const { spec, c, p } of reached) {
    if (MODEL_OUT.includes(spec.id)) continue;
    it(`${c.id}`, () => {
      const { problems, compared } = modelProblems(c.id, p, c.environment.viewport);
      expect(problems).toEqual([]);
      expect(compared).toBeGreaterThan(0);
    });
  }
});
