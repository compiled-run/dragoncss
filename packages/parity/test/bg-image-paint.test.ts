// BG2-u part 1: background-image url() on the web, against the committed Chrome PNGs of bg-image-web at every device DPR. The
// model draws each box's one url() layer at its natural size times the DPR, placed in its origin box by its px or % position
// (Chrome's BackgroundImageGeometry), tiled on each repeating axis, over the box's colour. Chrome must show the source pixel at
// every pixel of a flat quadrant and the colour over white at every pixel outside the tile on a no-repeat axis, each at least
// MARGIN device px from any tile, quadrant or padding edge (where snapping and filtering decide the pixel). Four model faults must
// each disagree with Chrome somewhere in every case: the position ignored, every axis repeated, the origin box ignored, and the
// tile left at its css px size. Native draws no url() layer yet: the case is lane-only there, and no device sample point judges a
// url() box (paint-samples/gradient.ts keepsUndrawnImage).
import { describe, expect, it } from 'vitest';
import { layout, LU_PER_PX, measurerFor, NO_ENGINE_FAULTS, zoomInput } from '@dragon/layout';
import type { Compiled, NativeProgram } from 'dragon';
import { laneOnlyNative, nativePrograms, programInput } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { nativeCompile } from '../src/native-compile.ts';
import { paddings } from '../src/paint-samples/gradient.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { casePoints, committedPixels, decodePng } from '../src/pixel-reference.ts';
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

describe('BG2-u part 1 background-image url(): the web paint model at every judged pixel equals the committed Chrome pixels', () => {
  it('covers the bg-image-web fixture in both directions', () => {
    expect(FIXTURES.map((f) => f.id)).toEqual(['bg-image-web']);
  });
  for (const spec of FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}; the position, repeat, origin and unscaled faults are caught`, () => {
        const compiled = nativeCompile(spec, c.environment.direction);
        expect([laneOnlyNative(compiled, 'ios'), laneOnlyNative(compiled, 'android')]).toEqual([true, true]);
        const programs = nativePrograms(compiled, c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        const p = programs.programs.uikit;
        const undrawn = p.nodes.filter((n) => (n.facts['gradient'] as { undrawnImage?: unknown } | undefined)?.undrawnImage === true).map((n) => n.id);
        expect(undrawn).toEqual(URL_BOXES);
        expect(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'background-layers')).map((n) => n.id)).toEqual([]);
        // No device sample point names a url() box or lies in one.
        for (const dpr of DPRS) {
          const geo = geometry(p, c.environment.viewport, dpr);
          const inside = casePoints(p, c.environment.viewport, dpr).filter((pt) => URL_BOXES.some((id) => { const named = pt.rule.slice(pt.rule.indexOf(':') + 1); return named === id || named.startsWith(`${id}:`); }) || [...geo.values()].some((g) => pt.x + 1 > g.l && pt.x < g.r && pt.y + 1 > g.t && pt.y < g.b));
          expect(inside.map((pt) => `${pt.rule}@${dpr}`)).toEqual([]);
        }
        const v = judge(c.id, compiled, p, c.environment.viewport, 'none');
        expect(v.problems).toEqual([]);
        for (const id of URL_BOXES) {
          const n = v.counts.get(id);
          expect(n?.image ?? 0, `${id} image pixels`).toBeGreaterThan(300);
          if (id !== 'r1') expect(n?.outside ?? 0, `${id} pixels outside the tile`).toBeGreaterThan(100);
        }
        for (const fault of ['position', 'repeat', 'origin', 'unscaled'] as const) expect(judge(c.id, compiled, p, c.environment.viewport, fault).problems.length, fault).toBeGreaterThan(0);
      });
    }
  }
});
