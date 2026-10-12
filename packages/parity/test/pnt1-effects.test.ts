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
import { opacityAlpha8, snapEdges } from '@dragon/layout';
import { ccTileEnd, ccTileIndex, ccTileSize, ccTileStart } from '../../layout/src/paint-dither.ts';
import type { NativeProgram, ProgramNode } from 'dragon';
import { androidProfile, borderDevicePx, createProjectWith, iosProfile, laneOnlyNative, nativePrograms, NO_FAULTS, programInput, webProfile } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS, FIXTURES as CORPUS } from '../src/fixtures.ts';
import { expectedEngine, nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels, devicePoints, glyphLines } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';

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
  | { readonly kind: 'group'; readonly box: Box; readonly alpha8: number; readonly items: readonly Item[] };

const stackingOf = (n: ProgramNode): Stacking => {
  const s = n.facts['stacking'] as Stacking | undefined;
  if (s === undefined) throw new Error(`${n.id}: no stacking facts`);
  return s;
};

/** Planted model faults the test must catch: the alpha ignored (alpha-ignored), and tree order instead of the paint order (order-swap). */
type ModelFaults = { readonly alphaIgnored: boolean; readonly treeOrder: boolean };
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
      const effects = n.facts['effects'] as { opacity: number } | undefined;
      if (effects === undefined) {
        out.push(...withText(n));
        continue;
      }
      const inside = new Set(subtree(n).map((x) => x.id));
      const members = sorted.filter((x) => inside.has(x.id));
      // A stacking context is atomic: its subtree is contiguous in the paint order.
      if (sorted.slice(k, k + members.length).some((x) => !inside.has(x.id))) throw new Error(`${n.id}: its subtree is not contiguous in the paint order`);
      out.push({ kind: 'group', box: byId.get(n.id) as Box, alpha8: faults.alphaIgnored ? 255 : opacityAlpha8(effects.opacity), items: [...withText(n), ...build(members.filter((x) => x !== n))] });
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

const GROUPS = ['effects'];
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
  it('covers the opacity and stacking fixtures', () => {
    expect(FIXTURES.map((f) => f.id)).toEqual(['opacity-basic', 'opacity-cascade', 'opacity-web', 'stacking-basic', 'stacking-context', 'stacking-escape', 'stacking-transform']);
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
        if (spec.id.startsWith('opacity-')) expect(caught({ alphaIgnored: true, treeOrder: false }), 'alpha-ignored').toBe(true);
        if (spec.id.startsWith('stacking-')) expect(caught({ alphaIgnored: false, treeOrder: true }), 'order-swap').toBe(true);
      });
    }
  }
});

// The cases of the rest of the corpus whose paint order PNT1 changes (every layer item gets a placement): the model in the Appendix E
// order equals Chrome at every non-edge point. A case is left out only for paint the model does not draw, each named by modelOut and
// pinned in OUT below, so a new case outside the model is seen: an image or a web view, a transform other than a whole-device-px
// translation, a border style other than solid, or flow siblings the engine lays out in another order than the tree's (flex order and
// reversed directions: Chrome paints them in order-modified document order, which the native views follow and the model does not).
function modelOut(p: NativeProgram, viewport: { width: number; height: number }): string | null {
  for (const n of p.nodes) {
    for (const w of n.writes) {
      if (w.kind === 'replaced-image' || w.kind === 'foreign-view') return `${n.id} draws ${w.kind}`;
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
  'hit-order', 'hit-order-rtl', 'overflow-replaced', 'overflow-replaced-rtl', 'replaced-block', 'replaced-block-rtl', 'replaced-demo', 'replaced-demo-rtl', 'replaced-intrinsic', 'replaced-intrinsic-rtl',
  'transform-clip', 'transform-demo', 'transform-direction', 'transform-direction-rtl', 'transform-flex', 'transform-matrix', 'transform-nested',
  'transform-origin', 'transform-rotate', 'transform-scale', 'transform-text', 'transform-translate', 'transform-will-change', 'var-logical',
  'var-logical-rtl',
];

describe('PNT1 stacking: the corpus cases the placements reach paint in Chrome\'s order', () => {
  const reached = CORPUS.filter((f) => f.kind === 'layout' && !GROUPS.some((g) => FIXTURE_GROUPS.find((x) => x.id === g)?.fixtures.includes(f))).flatMap((spec) =>
    casesOf(spec, fixtureInput(spec)).flatMap((c) => {
      const r = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
      if (r.kind !== 'ready') throw new Error(`${c.id}: ${r.reason}`);
      const p = r.programs.uikit;
      return p.nodes.some((n) => n.writes.some((w) => w.kind === 'paint-order')) ? [{ spec, c, p, out: modelOut(p, c.environment.viewport) }] : [];
    }),
  );
  it('reaches the positioned, flex-abspos, context, phrasing and values cases, and leaves out exactly the pinned cases', () => {
    expect(reached.filter((r) => r.out === null).length).toBeGreaterThan(80);
    expect(reached.filter((r) => r.out !== null).map((r) => r.c.id).sort()).toEqual(OUT);
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

// The fractional opacity cases (opacity-web): native refuses a fraction (PNT1-opacity-b), so the lanes compile the fixture as a
// lane-only case, which proves web rows only, and the device pixel lanes skip what its translucent groups paint.
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
      for (const dpr of DPRS) {
        const all = casePoints(r.programs.uikit, c.environment.viewport, dpr);
        const kept = devicePoints(r.programs.uikit, c.environment.viewport, dpr);
        // Every point named for a group's node goes; the stage, rows and spacers keep theirs.
        expect(kept.filter((q) => /^[a-z-]+:ow-/.test(q.rule)), `${c.id}@${dpr}`).toEqual([]);
        expect(kept.some((q) => q.rule.startsWith('interior:stage') || q.rule.startsWith('interior:sp')), `${c.id}@${dpr}`).toBe(true);
        expect(kept.length, `${c.id}@${dpr}`).toBeLessThan(all.length);
      }
    }
  });
  it('drops no point of a case without a translucent group', () => {
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
