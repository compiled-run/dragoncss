// BG2-u: background-image url() against the committed Chrome PNGs of bg-image-web at every device DPR. The
// model draws each box's one url() layer at its natural size times the DPR, placed in its origin box by its px or % position
// (Chrome's BackgroundImageGeometry), tiled on each repeating axis, over the box's colour. Chrome must show the source pixel at
// every pixel of a flat quadrant and the colour over white at every pixel outside the tile on a no-repeat axis, each at least
// MARGIN device px from any tile, quadrant or padding edge (where snapping and filtering decide the pixel). Four model faults must
// each disagree with Chrome somewhere in every case: the position ignored, every axis repeated, the origin box ignored, and the
// tile left at its css px size. Part 2 draws the layer natively (dragon emit/paint/bg-image.ts) from a background-image write, and
// the device lanes sample it (paint-samples/bg-image.ts) on the device's own tile geometry: Chrome must show the flat source pixel at
// every image-flat tile point and every kept base point the image decides, and at every tile edge scanline Chrome's edge must lie
// within GATE_DEVICE_PX of the crisp drawing of that geometry, which is where the device draws it. The plant's host twin (every tile
// PLANT_DEVICE_PX device px right, bg-image-offset-1) must fail that edge check, as the device lanes judge it, on at least one tile
// edge scanline at every DPR.
import { describe, expect, it } from 'vitest';
import { layout, LU_PER_PX, measurerFor, NO_ENGINE_FAULTS, zoomInput } from '@dragon/layout';
import type { Compiled, NativeProgram } from 'dragon';
import { laneOnlyNative, nativePrograms, programInput } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';
import { PLANT_CASES, PLANT_RULES } from '../src/device-run.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { contrastChannel, edgeDistance } from '../src/native-compare.ts';
import { nativeCompile } from '../src/native-compile.ts';
import type { TileBox } from '../src/paint-samples/bg-image.ts';
import { flatSource, nearestSource, tileBoxes } from '../src/paint-samples/bg-image.ts';
import { paddings } from '../src/paint-samples/gradient.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { caseBoxes, casePoints, committedPixels, decodePng, rasterSize } from '../src/pixel-reference.ts';
import { isScanlineRule } from '../src/samples.ts';
import type { SamplePoint } from '../src/samples.ts';
import type { Rgba } from './paint-model.ts';
import { boxes, over } from './paint-model.ts';

const FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'bg-image')?.fixtures ?? []).filter((f) => f.kind === 'layout');
const URL_BOXES = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'];
/** Device px a judged pixel keeps from every tile, quadrant and padding edge. */
const MARGIN = 3;

type Fault = 'none' | 'position' | 'repeat' | 'origin' | 'unscaled';
type Offset = { readonly unit: 'px' | '%'; readonly value: number };
/** One box's url() layer as the compiler resolved it. */
type Layer = { readonly image: RgbaImage; readonly repeat: readonly [boolean, boolean]; readonly position: readonly [Offset, Offset]; readonly origin: 'border-box' | 'padding-box' | 'content-box'; readonly color: Rgba };

const KEYWORD: Readonly<Record<string, number>> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };

function offsetOf(text: string): Offset {
  const k = KEYWORD[text];
  if (k !== undefined) return { unit: '%', value: k };
  const m = /^(-?[\d.]+)(px|%)$/.exec(text);
  if (m === null) throw new Error(`a background position the model does not read: ${text}`);
  return { unit: m[2] as Offset['unit'], value: Number(m[1]) };
}

function colorOf(text: string): Rgba {
  if (text === 'transparent') return [0, 0, 0, 0];
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(text);
  if (m === null) throw new Error(`a background colour the model does not read: ${text}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), 255];
}

const REPEAT: Readonly<Record<string, readonly [boolean, boolean]>> = { repeat: [true, true], 'repeat-x': [true, false], 'repeat-y': [false, true], 'no-repeat': [false, false] };

function layerOf(compiled: Compiled<'ios' | 'android'>, id: string): Layer {
  const value = (property: string): string => {
    const r = compiled.explain({ target: 'ios', at: { node: id, instance: 'doc' }, property });
    if (r.kind !== 'found' || r.cases.length !== 1) throw new Error(`${id} ${property}: ${JSON.stringify(r)}`);
    return String(r.cases[0]?.value);
  };
  const url = /^url\("data:image\/png;base64,([A-Za-z0-9+/=]+)"\)$/.exec(value('background-image'));
  if (url === null) throw new Error(`${id}: background-image is not one PNG data: url()`);
  expect(value('background-size'), id).toBe('auto');
  const repeat = REPEAT[value('background-repeat')];
  if (repeat === undefined) throw new Error(`${id}: background-repeat ${value('background-repeat')}`);
  const origin = value('background-origin');
  if (origin !== 'border-box' && origin !== 'padding-box' && origin !== 'content-box') throw new Error(`${id}: background-origin ${origin}`);
  return { image: decodePng(new Uint8Array(Buffer.from(url[1] as string, 'base64'))), repeat, position: [offsetOf(value('background-position-x')), offsetOf(value('background-position-y'))], origin, color: colorOf(value('background-color')) };
}

/** Each url() box's snapped border box, device-px borders and device-px paddings (top, right, bottom, left). */
function geometry(p: NativeProgram, viewport: { width: number; height: number }, dpr: number) {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  const input = programInput(p, viewport, dpr);
  const out = layout(input, m.measurer);
  if (out.kind !== 'ok') throw new Error(`the engine refused the program at ${dpr}`);
  const zoomed = zoomInput(input, NO_ENGINE_FAULTS);
  const pads = paddings(zoomed.root, new Map(out.boxes.map((r) => [r.id, r] as const)), zoomed.viewport.width, dpr);
  return new Map(boxes(p, viewport, dpr).filter((b) => URL_BOXES.includes(b.node.id)).map((b) => {
    const pad = pads.get(b.node.id);
    if (pad === undefined) throw new Error(`${b.node.id}: no padding`);
    return [b.node.id, { l: b.l, t: b.t, r: b.r, b: b.b, border: b.border, padding: pad.map((v) => v / LU_PER_PX) }] as const;
  }));
}

type Verdict = { readonly problems: string[]; readonly counts: Map<string, { image: number; outside: number }> };

/** The model's verdict on one case's url() boxes at every DPR against the committed Chrome PNGs. */
function judge(caseId: string, compiled: Compiled<'ios' | 'android'>, p: NativeProgram, viewport: { width: number; height: number }, fault: Fault): Verdict {
  const problems: string[] = [];
  const counts = new Map<string, { image: number; outside: number }>();
  for (const dpr of DPRS) {
    const chrome = committedPixels(caseId, dpr);
    if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
    for (const [id, g] of geometry(p, viewport, dpr)) {
      const layer = layerOf(compiled, id);
      const [bt, br, bb, bl] = g.border as [number, number, number, number];
      const [pt, pr, pb, pl] = g.padding as [number, number, number, number];
      const origin = fault === 'origin' ? 'padding-box' : layer.origin;
      const inset = origin === 'border-box' ? [0, 0, 0, 0] : origin === 'padding-box' ? [bt, br, bb, bl] : [bt + pt, br + pr, bb + pb, bl + pl];
      const area = { x: g.l + (inset[3] as number), y: g.t + (inset[0] as number), w: g.r - g.l - (inset[1] as number) - (inset[3] as number), h: g.b - g.t - (inset[0] as number) - (inset[2] as number) };
      const scale = fault === 'unscaled' ? 1 : dpr;
      const tile = [layer.image.width * scale, layer.image.height * scale] as const;
      const repeat = fault === 'repeat' ? [true, true] : layer.repeat;
      const start = [0, 1].map((k) => {
        const o = layer.position[k] as Offset;
        const at = k === 0 ? area.x : area.y;
        if (fault === 'position') return at;
        return at + (o.unit === 'px' ? o.value * dpr : (o.value / 100) * ((k === 0 ? area.w : area.h) - (tile[k] as number)));
      });
      const count = counts.get(id) ?? { image: 0, outside: 0 };
      counts.set(id, count);
      // The pixels inside the inner border edge, MARGIN clear of it.
      for (let y = Math.ceil(g.t + bt + MARGIN); y + 1 <= g.b - bb - MARGIN; y++) {
        for (let x = Math.ceil(g.l + bl + MARGIN); x + 1 <= g.r - br - MARGIN; x++) {
          // Per axis: the position in the tile (the tile repeated on a repeating axis), or null outside it, or 'near' an edge.
          const local = [x + 0.5, y + 0.5].map((c, k) => {
            const d = c - (start[k] as number);
            const t = tile[k] as number;
            const u = repeat[k] === true ? d - Math.floor(d / t) * t : d;
            if (repeat[k] !== true && (u <= -MARGIN || u >= t + MARGIN)) return null;
            if ([0, t / 2, t].some((e) => Math.abs(u - e) < MARGIN)) return 'near' as const;
            return u;
          });
          if (local.includes('near')) continue;
          let want: Rgba;
          const [ux, uy] = local as [number | null, number | null];
          if (ux === null || uy === null) {
            want = over([255, 255, 255, 255], layer.color);
            count.outside++;
          } else {
            const sx = Math.floor((ux / tile[0]) * layer.image.width);
            const sy = Math.floor((uy / tile[1]) * layer.image.height);
            const i = (sy * layer.image.width + sx) * 4;
            want = over(over([255, 255, 255, 255], layer.color), [layer.image.data[i], layer.image.data[i + 1], layer.image.data[i + 2], layer.image.data[i + 3]] as unknown as Rgba);
            count.image++;
          }
          const j = (y * chrome.width + x) * 4;
          const got = [chrome.data[j], chrome.data[j + 1], chrome.data[j + 2], chrome.data[j + 3]];
          if (got.some((v, k) => v !== want[k])) problems.push(`${id} at ${x},${y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
        }
      }
    }
  }
  return { problems, counts };
}

/** How far the bg-image-offset-1 plant draws every tile right of its place (dragon emit/paint/bg-image.ts BG_IMAGE_PLANT). */
const PLANT_DEVICE_PX = 2;

type DeviceVerdict = { readonly problems: string[]; readonly flat: Map<string, number>; readonly edges: Map<string, number>; readonly caught: Map<number, number>; readonly worst: number };

/**
 * The device lanes' samples of the url() boxes at every DPR against the committed Chrome PNGs: the colour Chrome must show at each
 * image-flat tile point and each kept base point the image decides, and each tile edge scanline's edge position, Chrome's against the
 * crisp drawing of the device geometry (each pixel the source pixel nearest its centre, or the colour outside the tiles).
 */
function judgeDevice(caseId: string, p: NativeProgram, viewport: { width: number; height: number }): DeviceVerdict {
  const problems: string[] = [];
  const flat = new Map<string, number>();
  const edges = new Map<string, number>();
  const caught = new Map<number, number>();
  let worst = 0;
  const colors = new Map(p.nodes.map((n) => {
    const w = n.writes.find((x) => x.kind === 'background-color');
    const c = w !== undefined && w.kind === 'background-color' ? w.color : { r: 0, g: 0, b: 0, alpha: 0 };
    return [n.id, over([255, 255, 255, 255], [c.r, c.g, c.b, c.alpha])] as const;
  }));
  for (const dpr of DPRS) {
    const chrome = committedPixels(caseId, dpr);
    if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
    const points = casePoints(p, viewport, dpr);
    const tiles = tileBoxes({ program: p, viewport, dpr, size: rasterSize(viewport, dpr), boxes: caseBoxes(p, viewport, dpr), base: [] });
    const byId = new Map(tiles.map((t) => [t.id, t] as const));
    const at = (x: number, y: number): Rgba => {
      const j = (y * chrome.width + x) * 4;
      return [chrome.data[j], chrome.data[j + 1], chrome.data[j + 2], chrome.data[j + 3]] as unknown as Rgba;
    };
    const crisp = (t: TileBox, x: number, y: number): Rgba => {
      const s = nearestSource(t, x, y);
      const under = colors.get(t.id) as Rgba;
      return s === null ? under : over(under, s as Rgba);
    };
    const shifted = (t: TileBox): TileBox => ({ ...t, tile: [(t.tile[0] as number) + PLANT_DEVICE_PX, t.tile[1], t.tile[2], t.tile[3]] });
    for (let i = 0; i < points.length;) {
      const pt = points[i] as SamplePoint;
      const named = pt.rule.slice(pt.rule.indexOf(':') + 1).split(':')[0] as string;
      if (isScanlineRule(pt.rule)) {
        let j = i;
        while (j < points.length && (points[j] as SamplePoint).rule === pt.rule) j++;
        const line = points.slice(i, j);
        i = j;
        const t = byId.get(named);
        if (t === undefined || !pt.rule.includes(':tile-')) continue;
        edges.set(t.id, (edges.get(t.id) ?? 0) + 1);
        const got = line.map((q) => at(q.x, q.y));
        const want = line.map((q) => crisp(t, q.x, q.y));
        const channel = contrastChannel(got);
        const a = edgeDistance(got, channel);
        const b = edgeDistance(want, channel);
        if (a === null || b === null) problems.push(`${pt.rule} @${dpr}: no edge (Chrome ${a}, the device geometry ${b})`);
        else {
          worst = Math.max(worst, Math.abs(a - b));
          if (Math.abs(a - b) > GATE_DEVICE_PX) problems.push(`${pt.rule} @${dpr}: Chrome's edge ${a.toFixed(3)} device px along the scanline, the device geometry's ${b.toFixed(3)}`);
        }
        // The twin fails the scanline as the device lanes judge it: no edge where Chrome shows one, or one more than GATE_DEVICE_PX off.
        if (a !== null && PLANT_RULES['bg-image-offset-1'].test(pt.rule)) {
          const planted = shifted(t);
          const c = edgeDistance(line.map((q) => crisp(planted, q.x, q.y)), channel);
          if (c === null || Math.abs(c - a) > GATE_DEVICE_PX) caught.set(dpr, (caught.get(dpr) ?? 0) + 1);
        }
        continue;
      }
      i++;
      for (const t of tiles) {
        const s = flatSource(t, pt.x, pt.y, true);
        const own = pt.rule.startsWith(`image-flat:${t.id}:tile-`);
        if (own) flat.set(t.id, (flat.get(t.id) ?? 0) + 1);
        if (s === null) {
          if (own) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: not flat image content`);
          continue;
        }
        // A kept base point inside the clip box on flat content shows the source pixel, as an image-flat point does.
        if (!own && !(pt.x >= t.clip[0] + 1 && pt.x + 1 <= t.clip[2] - 1 && pt.y >= t.clip[1] + 1 && pt.y + 1 <= t.clip[3] - 1 && pt.x >= t.visible[0] && pt.x + 1 <= t.visible[2] && pt.y >= t.visible[1] && pt.y + 1 <= t.visible[3])) continue;
        const want = over(colors.get(t.id) as Rgba, s as Rgba);
        const got = at(pt.x, pt.y);
        if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, the source ${JSON.stringify(want)}`);
      }
    }
  }
  return { problems, flat, edges, caught, worst };
}

describe('BG2-u background-image url(): the web paint model and the device samples at every judged pixel equal the committed Chrome pixels', () => {
  it('covers the bg-image-web fixture in both directions, and the plant runs on it', () => {
    expect(FIXTURES.map((f) => f.id)).toEqual(['bg-image-web']);
    expect(PLANT_CASES['bg-image-offset-1']).toEqual(['bg-image-web']);
  });
  for (const spec of FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}; the position, repeat, origin and unscaled faults and the offset plant's twin are caught`, () => {
        const compiled = nativeCompile(spec, c.environment.direction);
        expect([laneOnlyNative(compiled, 'ios'), laneOnlyNative(compiled, 'android')]).toEqual([false, false]);
        const programs = nativePrograms(compiled, c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        const p = programs.programs.uikit;
        for (const prog of [p, programs.programs['android-views']]) {
          expect(prog.nodes.filter((n) => n.writes.some((w) => w.kind === 'background-image')).map((n) => n.id)).toEqual(URL_BOXES);
          expect(prog.nodes.filter((n) => n.writes.some((w) => w.kind === 'background-layers')).map((n) => n.id)).toEqual([]);
        }
        const v = judge(c.id, compiled, p, c.environment.viewport, 'none');
        expect(v.problems).toEqual([]);
        for (const id of URL_BOXES) {
          const n = v.counts.get(id);
          expect(n?.image ?? 0, `${id} image pixels`).toBeGreaterThan(300);
          if (id !== 'r1') expect(n?.outside ?? 0, `${id} pixels outside the tile`).toBeGreaterThan(100);
        }
        for (const fault of ['position', 'repeat', 'origin', 'unscaled'] as const) expect(judge(c.id, compiled, p, c.environment.viewport, fault).problems.length, fault).toBeGreaterThan(0);
        const d = judgeDevice(c.id, p, c.environment.viewport);
        expect(d.problems).toEqual([]);
        for (const id of URL_BOXES) {
          // At every DPR: at least one image-flat point and one tile edge scanline per box.
          expect(d.flat.get(id) ?? 0, `${id} image-flat tile points`).toBeGreaterThanOrEqual(DPRS.length);
          expect(d.edges.get(id) ?? 0, `${id} tile edge scanlines`).toBeGreaterThanOrEqual(DPRS.length);
        }
        for (const dpr of DPRS) expect(d.caught.get(dpr) ?? 0, `the bg-image-offset-1 twin's failing tile edge scanlines @${dpr}`).toBeGreaterThan(0);
        expect(d.worst, 'the largest tile edge difference from Chrome').toBeLessThanOrEqual(GATE_DEVICE_PX);
      });
    }
  }
});
