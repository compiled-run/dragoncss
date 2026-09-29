// DTXT-0 (docs/goals/milestone-2-proof/notes/T068-dtxt-spec.md DT-3(a)): the exhaustive Chrome width oracle. shapedMeasurer over the
// WASM GlyphShaper must give Chrome 145's nowrap LayoutUnit width for every '{m}:{s:02}' string in Lato 400 and Dragon Sans 400
// (Inter 4.1) at 16px, and for the boundary list at 14, 16 and 20px, at DPR 1, 2, 2.625 and 3 (docs/research/dtxt/widths.json).
// Chrome lays out at DPR N in zoomed LayoutUnits (1/64 device px), so the engine measures at zoomFontSize(size, N), as the DPR lanes do.
// widthCacheByLength, a memo keyed by length, must be caught on Dragon Sans.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TextFont } from '../src/input.ts';
import type { GlyphShaper, ShapedFace, ShapingFaults } from '../src/shaping.ts';
import { FEATURE_STRIDE, NO_HAN_KERNING, NO_SHAPING_FAULTS, shapedMeasurer } from '../src/shaping.ts';
import type { TextFormatFaults } from '../src/rt-text-format.ts';
import { NO_TEXT_FORMAT_FAULTS, widthMemoKey } from '../src/rt-text-format.ts';
import type { FontData, TextMeasurer } from '../src/text.ts';
import { zoomFontSize } from '../src/units.ts';

// packages/text-shaper is loaded by relative path at run time (no package.json change), as in shaping-gate.test.ts.
type Feature = { readonly tag: string; readonly value: number; readonly start?: number; readonly end?: number };
type HB = {
  createFace(bytes: Uint8Array): number;
  createFont(face: number, o: { size: number }): number;
  shape(font: number, text: string, offset: number, length: number, o: { script: string; language: string; direction?: 'ltr' | 'rtl'; features?: readonly Feature[] }): Int32Array;
  faceFeatureTags(face: number, table: 'GPOS'): string[];
};
const load = async (rel: string): Promise<Record<string, unknown>> => (await import(new URL(rel, import.meta.url).href)) as Record<string, unknown>;
const wasm = await load('../../text-shaper/src/wasm.ts');
const hb = (wasm.DragonHB as { load(): HB }).load();
const tagToString = wasm.tagToString as (tag: number) => string;

type Run = { readonly family: string; readonly size: number; readonly dpr: number };
type Widths = {
  readonly chrome: string;
  readonly zoomGuards: Readonly<Record<string, string>>;
  readonly faces: Readonly<Record<string, { readonly weight: number; readonly file: string; readonly sha256: string }>>;
  readonly boundaryStrings: readonly string[];
  readonly exhaustive: ReadonlyArray<Run & { readonly rows: readonly (readonly number[])[] }>;
  readonly boundary: ReadonlyArray<Run & { readonly widths: readonly number[] }>;
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const oracle = JSON.parse(readFileSync(join(root, 'docs/research/dtxt/widths.json'), 'utf8')) as Widths;
const strings = (JSON.parse(readFileSync(join(root, 'packages/layout/rt-vectors/text-format/format-time.json'), 'utf8')) as { strings: string[] }).strings;
const FAMILIES = ['Lato', 'Dragon Sans'];
/** Boundary widths at DPR 2, 2.625 or 3 whose CSS px value differs from DPR 1. */
const DPR_DEPENDENT_ROWS = 147;
const bytes = new Map(FAMILIES.map((f) => [f, readFileSync(join(root, (oracle.faces[f] as { file: string }).file))]));

/** The host side of R1: one DragonHB, faces and fonts created on first use. */
class WasmShaper implements GlyphShaper {
  private readonly faces = new Map<string, number>();
  private readonly fonts = new Map<string, number>();
  face(id: string): number {
    let f = this.faces.get(id);
    if (f === undefined) {
      f = hb.createFace(bytes.get(id) as Buffer);
      this.faces.set(id, f);
    }
    return f;
  }
  font(id: string, size: number): number {
    const key = `${id}/${size}`;
    let f = this.fonts.get(key);
    if (f === undefined) {
      f = hb.createFont(this.face(id), { size });
      this.fonts.set(key, f);
    }
    return f;
  }
  shape(face: string, size: number, text: string, start: number, end: number, script: string, rtl: boolean, language: string, features: readonly number[]): readonly number[] {
    const fs = [];
    for (let i = 0; i < features.length; i += FEATURE_STRIDE) {
      fs.push({ tag: tagToString(features[i] as number), value: features[i + 1] as number, start: features[i + 2] as number, end: features[i + 3] as number });
    }
    return Array.from(hb.shape(this.font(face, size), text, start, end - start, { script, direction: rtl ? 'rtl' : 'ltr', language, features: fs }));
  }
}

/** head.unitsPerEm and hhea ascender, descender and lineGap, read from the font file as a device host reads them. */
function fontData(id: string): FontData {
  const b = bytes.get(id) as Buffer;
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < d.getUint16(4); i++) tables.set(b.toString('latin1', 12 + i * 16, 16 + i * 16), d.getUint32(12 + i * 16 + 8));
  const head = tables.get('head') as number;
  const hhea = tables.get('hhea') as number;
  return { unitsPerEm: d.getUint16(head + 18), ascent: d.getInt16(hhea + 4), descent: -d.getInt16(hhea + 6), lineGap: d.getInt16(hhea + 8), advances: [] };
}

const shaper = new WasmShaper();
const faces = new Map<string, ShapedFace>(FAMILIES.map((id) => [id, { id, data: fontData(id), hanKerning: NO_HAN_KERNING }]));
const faceFont = (id: string, size: number): TextFont => ({ family: id, size }) as unknown as TextFont;
const sha = (id: string): string => (oracle.faces[id] as { sha256: string }).sha256;

/** DT-2's width memo in front of the measurer, keyed by widthMemoKey. */
function memoized(m: TextMeasurer, faults: TextFormatFaults): (text: string, family: string, size: number) => number {
  const memo = new Map<string, number>();
  return (text, family, size) => {
    const key = widthMemoKey(sha(family), size, text, faults);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const r = m.measure(text, faceFont(family, size));
    const w = r.ok ? r.measure.width : Number.NaN;
    memo.set(key, w);
    return w;
  };
}

type Miss = { readonly family: string; readonly size: number; readonly dpr: number; readonly text: string; readonly chrome: number; readonly engine: number };

/** Every oracle width against `width`, in capture order: the 60,000 strings per face, then the boundary rows. */
function misses(width: (text: string, family: string, size: number) => number): { exhaustive: Miss[]; boundary: Miss[]; count: number } {
  const exhaustive: Miss[] = [];
  const boundary: Miss[] = [];
  let count = 0;
  for (const r of oracle.exhaustive) {
    r.rows.flat().forEach((chrome, i) => {
      const text = strings[i] as string;
      const engine = width(text, r.family, r.size);
      count++;
      if (engine !== chrome) exhaustive.push({ family: r.family, size: r.size, dpr: r.dpr, text, chrome, engine });
    });
  }
  for (const r of oracle.boundary) {
    r.widths.forEach((chrome, i) => {
      const text = oracle.boundaryStrings[i] as string;
      const engine = width(text, r.family, zoomFontSize(r.size, r.dpr));
      count++;
      if (engine !== chrome) boundary.push({ family: r.family, size: r.size, dpr: r.dpr, text, chrome, engine });
    });
  }
  return { exhaustive, boundary, count };
}

const direct = (faults: ShapingFaults): ((text: string, family: string, size: number) => number) => {
  const m = shapedMeasurer(faces, shaper, faults, 'en');
  return (text, family, size) => {
    const r = m.measure(text, faceFont(family, size));
    return r.ok ? r.measure.width : Number.NaN;
  };
};

describe('DTXT-0: the Chrome width oracle for {m}:{s:02}', () => {
  it('was captured in Chrome 145.0.7632.6 from the vendored faces, over every string and the boundary grid', () => {
    expect(oracle.chrome).toBe('145.0.7632.6');
    for (const f of FAMILIES) expect(createHash('sha256').update(bytes.get(f) as Buffer).digest('hex'), f).toBe(sha(f));
    expect(oracle.exhaustive.map((r) => `${r.family}/${r.size}/${r.dpr}/${r.rows.flat().length}`)).toEqual(['Lato/16/1/60000', 'Dragon Sans/16/1/60000']);
    expect(oracle.boundaryStrings).toEqual(['0:00', '0:09', '0:10', '1:11', '3:07', '8:08', '9:59', '10:00', '59:59', '99:59', '100:00', '999:59']);
    expect(oracle.boundary.length).toBe(2 * 3 * 4);
    for (const f of FAMILIES) for (const size of [14, 16, 20]) expect(oracle.boundary.filter((r) => r.family === f && r.size === size).map((r) => r.dpr), `${f} ${size}`).toEqual([1, 2, 2.625, 3]);
  });

  it('was captured at zoom: the 0.5px border guard of parity:dpr-capture held at every DPR above 1', () => {
    expect(oracle.zoomGuards).toEqual({ '2': '0.5px', '2.625': '0.380952px', '3': '0.333333px' });
  });

  it('finding: Chrome widths depend on DPR in CSS px (layout is in device units); the DPR 1 boundary rows equal the exhaustive capture', () => {
    let differ = 0;
    let rows = 0;
    for (const f of FAMILIES) {
      for (const size of [14, 16, 20]) {
        const one = (oracle.boundary.find((r) => r.family === f && r.size === size && r.dpr === 1) as { widths: readonly number[] }).widths;
        for (const r of oracle.boundary.filter((x) => x.family === f && x.size === size && x.dpr !== 1)) {
          r.widths.forEach((w, i) => {
            rows++;
            if (w / r.dpr !== one[i]) differ++;
            // Never more than one device px from the DPR 1 width.
            expect(Math.abs(w - (one[i] as number) * r.dpr), `${f} ${size} ${r.dpr} ${oracle.boundaryStrings[i]}`).toBeLessThan(64);
          });
        }
      }
      const full = (oracle.exhaustive.find((r) => r.family === f) as unknown as { rows: number[][] }).rows.flat();
      const b = oracle.boundary.find((r) => r.family === f && r.size === 16 && r.dpr === 1) as unknown as { widths: number[] };
      expect(oracle.boundaryStrings.map((t) => full[strings.indexOf(t)]), f).toEqual(b.widths);
    }
    expect(rows).toBe(2 * 3 * 3 * 12);
    expect(differ).toBe(DPR_DEPENDENT_ROWS);
  });

  const exact = misses(direct(NO_SHAPING_FAULTS));

  it('shapedMeasurer equals Chrome on every string: 120,000 exhaustive and 288 boundary widths exact, in zoomed LU', () => {
    expect(exact.count).toBe(120000 + 288);
    expect(exact.exhaustive).toEqual([]);
    expect(exact.boundary).toEqual([]);
  });

  it('the DT-2 memo keyed by (face sha256, size, string) changes nothing', () => {
    const m = misses(memoized(shapedMeasurer(faces, shaper, NO_SHAPING_FAULTS, 'en'), NO_TEXT_FORMAT_FAULTS));
    expect(m.exhaustive.length + m.boundary.length).toBe(0);
  });

  it('catches widthCacheByLength on Dragon Sans: each caught string has the length of an earlier string with another width', () => {
    const faults = { ...NO_TEXT_FORMAT_FAULTS, widthCacheByLength: true };
    const m = misses(memoized(shapedMeasurer(faces, shaper, NO_SHAPING_FAULTS, 'en'), faults));
    const caught = [...m.exhaustive, ...m.boundary];
    const onDragonSans = caught.filter((x) => x.family === 'Dragon Sans');
    expect(onDragonSans.length).toBeGreaterThan(0);
    // Lato's digits are tabular and its colon is not kerned against them: one width per length, so the fault is invisible there.
    expect(caught.filter((x) => x.family === 'Lato')).toEqual([]);
    const full = (oracle.exhaustive.find((r) => r.family === 'Dragon Sans') as unknown as { rows: number[][] }).rows.flat();
    for (const x of m.exhaustive) {
      // The stale width is the Chrome width of the first string of that length, which has the same length and another width.
      const first = strings.findIndex((t) => t.length === x.text.length);
      expect(strings[first]?.length, x.text).toBe(x.text.length);
      expect(x.engine, x.text).toBe(full[first]);
      expect(x.engine, x.text).not.toBe(x.chrome);
    }
  });

  it('finding: Lato has GPOS kern but kerns no digit or colon pair (one width per length); Dragon Sans kerns them', () => {
    for (const f of FAMILIES) expect(hb.faceFeatureTags(shaper.face(f), 'GPOS'), f).toContain('kern');
    const k = misses(direct({ ...NO_SHAPING_FAULTS, kerningDropped: true }));
    const byFace = (xs: readonly Miss[]): number[] => FAMILIES.map((f) => xs.filter((x) => x.family === f).length);
    expect(byFace(k.exhaustive)).toEqual([0, 18557]);
    expect(byFace(k.boundary)).toEqual([0, 12]);
    const lato = (oracle.exhaustive.find((r) => r.family === 'Lato') as unknown as { rows: number[][] }).rows.flat();
    const byLength = new Map<number, number[]>();
    lato.forEach((w, i) => {
      const n = (strings[i] as string).length;
      const ws = byLength.get(n) ?? [];
      if (!ws.includes(w)) byLength.set(n, [...ws, w]);
    });
    expect([...byLength]).toEqual([[4, [2038]], [5, [2632]], [6, [3226]]]);
  });

  // The shaping plants that can act on a single-run nowrap string; advanceNot16_16 and doubleAccumulation change no width here.
  const plants: ReadonlyArray<keyof ShapingFaults> = ['kerningDropped', 'wholePixelPositions'];
  for (const plant of plants) {
    it(`catches the shaping fault ${plant} on these strings`, () => {
      const m = misses(direct({ ...NO_SHAPING_FAULTS, [plant]: true }));
      expect(m.exhaustive.length + m.boundary.length, plant).toBeGreaterThan(0);
    });
  }
});
