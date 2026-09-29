// TXT1-S (docs/goals/milestone-2-proof/notes/T056-txt1a-spec.md §3): the engine's shaping core (src/shaping.ts) over a WASM
// GlyphShaper must give Chrome 145's LayoutUnit width for every line and nowrap span of the 1,260 TXT1-0 gate cases, equal to the
// text-shaper reference (packages/text-shaper/src/blink.ts) case by case; every planted fault must change a width. Also R5's metric
// rounding against its Chrome capture, and Ahem through HarfBuzz against Chrome and ahemMeasurer.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TextFont } from '../src/input.ts';
import type { GlyphShaper, HanKerningFontData, ShapedFace, ShapedText, ShapingFaults } from '../src/shaping.ts';
import { FEATURE_STRIDE, HK_CLOSE, HK_MIDDLE, HK_OPEN, HK_OTHER, NO_HAN_KERNING, NO_SHAPING_FAULTS, segmentText, shapedMeasurer, shapedText } from '../src/shaping.ts';
import type { FontData } from '../src/text.ts';
import { AHEM_FONT_DATA, ahemMeasurer } from '../src/text.ts';
import { fromRaw } from '../src/units.ts';

// packages/text-shaper is loaded by relative path at run time (no package.json change); these are the parts the test uses.
type Feature = { readonly tag: string; readonly value: number; readonly start?: number; readonly end?: number };
type HB = {
  createFace(bytes: Uint8Array): number;
  createFont(face: number, o: { size: number }): number;
  shape(font: number, text: string, offset: number, length: number, o: { script: string; language: string; direction?: 'ltr' | 'rtl'; features?: readonly Feature[] }): Int32Array;
  faceFeatureTags(face: number, table: 'GPOS'): string[];
  glyphExtents(font: number, glyph: number): [number, number, number, number] | undefined;
  nominalGlyph(font: number, cp: number): number;
};
type Reference = {
  readonly fonts: Readonly<Record<string, { readonly file: string; readonly sha256: string }>>;
  readonly paragraphs: Readonly<Record<string, string>>;
  readonly opportunities: Readonly<Record<string, readonly number[]>>;
  readonly cases: ReadonlyArray<{ readonly id: string; readonly font: string; readonly paragraph: string; readonly lang: string; readonly size: number; readonly width: number; readonly lines: ReadonlyArray<readonly [number, number, number, number]>; readonly nowrap: number }>;
};
type Ctx = object;
type BlinkResult = { readonly width: number };
const load = async (rel: string): Promise<Record<string, unknown>> => (await import(new URL(rel, import.meta.url).href)) as Record<string, unknown>;
const wasm = await load('../../text-shaper/src/wasm.ts');
const blink = await load('../../text-shaper/src/blink.ts');
const gate = await load('../../text-shaper/src/gate.ts');
const han = await load('../../text-shaper/src/han-kerning.ts');
const script = await load('../../text-shaper/src/script.ts');
const hb = (wasm.DragonHB as { load(): HB }).load();
const tagToString = wasm.tagToString as (tag: number) => string;
const fromFloatCeil = blink.fromFloatCeil as (v: number) => number;
const makeContext = blink.makeContext as (hb: HB, font: number, text: string, lang: string, extra?: object) => Ctx;
const shape = blink.shape as (ctx: Ctx, start: number, end: number) => BlinkResult;
const viewWidth = blink.viewWidth as (segments: ReadonlyArray<{ result: BlinkResult; start: number; end: number }>) => number;
const lineView = blink.lineView as (ctx: Ctx, p: BlinkResult, start: number, end: number, o: { available: number; isBreakable: (o: number) => boolean; maybeHanKerningClose: (cp: number) => boolean }) => { lu: number };
const fontPath = gate.fontPath as (file: string) => string;
const loadReference = gate.loadReference as (path: string) => Reference;
const GATE_REFERENCES = gate.GATE_REFERENCES as ReadonlyArray<{ reference: string }>;
const hanKerningFor = han.hanKerningFor as (hb: HB, face: number, font: number, text: string, lang: string) => { rangeFeatures: unknown } | undefined;
const maybeHanKerningClose = han.maybeHanKerningClose as (cp: number) => boolean;
const referenceSegments = script.segmentText as (text: string) => Array<{ start: number; end: number; script: string }>;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const refs: readonly Reference[] = GATE_REFERENCES.map((g) => loadReference(g.reference));

/** Font files by face id: every gate font, plus Ahem. */
const files = new Map<string, string>([['Ahem', join(root, 'vendor/fonts/Ahem.ttf')]]);
for (const r of refs) for (const [id, meta] of Object.entries(r.fonts)) files.set(id, fontPath(meta.file));

/** The host side of R1: one DragonHB, faces and fonts created on first use. It records how often it was called. */
class WasmShaper implements GlyphShaper {
  calls = 0;
  private readonly faces = new Map<string, number>();
  private readonly fonts = new Map<string, number>();
  face(id: string): number {
    let f = this.faces.get(id);
    if (f === undefined) {
      f = hb.createFace(readFileSync(files.get(id) as string));
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
    this.calls++;
    const fs = [];
    for (let i = 0; i < features.length; i += FEATURE_STRIDE) {
      fs.push({ tag: tagToString(features[i] as number), value: features[i + 1] as number, start: features[i + 2] as number, end: features[i + 3] as number });
    }
    return Array.from(hb.shape(this.font(face, size), text, start, end - start, { script, direction: rtl ? 'rtl' : 'ltr', language, features: fs }));
  }
}

/** head.unitsPerEm and hhea ascender, descender and lineGap, read from the font file as a device host reads them. */
function fontData(id: string): FontData {
  const b = readFileSync(files.get(id) as string);
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < d.getUint16(4); i++) tables.set(b.toString('latin1', 12 + i * 16, 16 + i * 16), d.getUint32(12 + i * 16 + 8));
  const head = tables.get('head') as number;
  const hhea = tables.get('hhea') as number;
  return { unitsPerEm: d.getUint16(head + 18), ascent: d.getInt16(hhea + 4), descent: -d.getInt16(hhea + 6), lineGap: d.getInt16(hhea + 8), advances: [] };
}

/**
 * HanKerning::FontData as a host derives it (han_kerning.cc; text-shaper's han-kerning.ts): GPOS `halt` and `chws`, and the char
 * types of the fullwidth punctuation from their shaped glyph bounds at a given size.
 */
function hanKerningData(id: string, size: number, language: string): HanKerningFontData {
  const face = shaper.face(id);
  const gpos = new Set(hb.faceFeatureTags(face, 'GPOS'));
  if (!gpos.has('halt')) return NO_HAN_KERNING;
  const font = shaper.font(id, size);
  const chars = '、。，．：；“‘”’';
  const script = language === 'ja' ? 'Hrkt' : 'Hani';
  const g = hb.shape(font, chars, 0, chars.length, { script, language });
  const none = { ...NO_HAN_KERNING, hasContextualSpacing: gpos.has('chws') };
  if (g.length / 7 !== chars.length) return none;
  const glyphs: Array<{ glyph: number; advance: number; left: number; right: number }> = [];
  for (let i = 0; i < chars.length; i++) {
    const o = i * 7;
    if (g[o + 1] !== i) return none;
    const e = hb.glyphExtents(font, g[o] as number);
    const x = (g[o + 4] as number) / 65536;
    glyphs.push({ glyph: g[o] as number, advance: Math.fround((g[o + 2] as number) / 65536), left: (e === undefined ? 0 : e[0] / 65536) + x, right: (e === undefined ? 0 : (e[0] + e[2]) / 65536) + x });
  }
  const typeOne = (half: number, b: { left: number; right: number }): number =>
    b.right <= half ? HK_CLOSE : b.left >= half ? HK_OPEN : b.right - b.left <= half && b.left >= half / 2 ? HK_MIDDLE : HK_OTHER;
  const typeOf = (gs: typeof glyphs): number => {
    const live = gs.filter((x) => x.glyph !== 0);
    if (live.length === 0) return HK_OTHER;
    const a0 = (live[0] as (typeof glyphs)[number]).advance;
    const t0 = typeOne(a0 / 2, live[0] as (typeof glyphs)[number]);
    return live.every((x) => x.advance === a0 && typeOne(a0 / 2, x) === t0) ? t0 : HK_OTHER;
  };
  return {
    hasAlternateSpacing: true,
    hasContextualSpacing: gpos.has('chws'),
    typeForDot: typeOf(glyphs.slice(0, 4)),
    typeForColon: typeOf(glyphs.slice(4, 5)),
    typeForSemicolon: typeOf(glyphs.slice(5, 6)),
    isQuoteFullwidth: typeOf(glyphs.slice(6, 8)) === HK_OPEN && typeOf(glyphs.slice(8, 10)) === HK_CLOSE,
  };
}

const shaper = new WasmShaper();
const faceIds = [...files.keys()];
const facesFor = (language: string): Map<string, ShapedFace> =>
  new Map(faceIds.map((id) => [id, { id, data: id === 'Ahem' ? AHEM_FONT_DATA : fontData(id), hanKerning: language === 'ja' ? hanKerningData(id, 16, language) : NO_HAN_KERNING }]));
const faceFont = (id: string, size: number): TextFont => ({ family: id, size }) as unknown as TextFont;

type CaseWidths = { readonly id: string; readonly lines: readonly number[]; readonly nowrap: number; readonly error: string };

/** Every case through the engine: nowrap through the TextMeasurer, lines through ShapedText.line. Stops at the first case failing `stop`. */
function engineWidths(faults: ShapingFaults, stop?: (c: CaseWidths, chrome: CaseWidths) => boolean): { results: CaseWidths[]; chrome: CaseWidths[] } {
  const byLang = new Map<string, ShapedText>();
  const results: CaseWidths[] = [];
  const chrome: CaseWidths[] = [];
  for (const ref of refs) {
    for (const c of ref.cases) {
      let st = byLang.get(c.lang);
      if (st === undefined) {
        st = shapedText(facesFor(c.lang), shaper, faults, c.lang);
        byLang.set(c.lang, st);
      }
      const text = ref.paragraphs[c.paragraph] as string;
      const opps = new Set(ref.opportunities[c.paragraph]);
      const m = st.measurer.measure(text, faceFont(c.font, c.size));
      const item = st.item(text, c.font, c.size);
      const lines: number[] = [];
      let error = m.ok ? '' : m.reason;
      for (const [start, end] of c.lines) {
        const l = st.line(item, start, end, fromRaw(c.width * 64), (o) => o === text.length || opps.has(o));
        if (!l.ok) error = l.reason;
        lines.push(l.ok ? l.width : Number.NaN);
      }
      const got = { id: c.id, lines, nowrap: m.ok ? m.measure.width : Number.NaN, error };
      const want = { id: c.id, lines: c.lines.map((l) => l[2]), nowrap: c.nowrap, error: '' };
      results.push(got);
      chrome.push(want);
      if (stop !== undefined && stop(got, want)) return { results, chrome };
    }
  }
  return { results, chrome };
}

/** The text-shaper reference (the TXT1-0 gate's arithmetic in blink.ts), per case. */
function blinkWidths(): CaseWidths[] {
  const out: CaseWidths[] = [];
  for (const ref of refs) {
    for (const c of ref.cases) {
      const text = ref.paragraphs[c.paragraph] as string;
      const opps = new Set(ref.opportunities[c.paragraph]);
      const font = shaper.font(c.font, c.size);
      const kerning = hanKerningFor(hb, shaper.face(c.font), font, text, c.lang);
      const ctx = makeContext(hb, font, text, c.lang, kerning === undefined ? {} : { rangeFeatures: kerning.rangeFeatures });
      const result = shape(ctx, 0, text.length);
      const hyphenText = hb.nominalGlyph(font, 0x2010) !== 0 ? '‐' : '-';
      const hyphen = fromFloatCeil(shape(makeContext(hb, font, hyphenText, c.lang), 0, hyphenText.length).width);
      const lines = c.lines.map(([start, end]) => {
        const m = lineView(ctx, result, start, end, { available: c.width * 64, isBreakable: (o) => o === text.length || opps.has(o), maybeHanKerningClose });
        return end < text.length && text.charCodeAt(end - 1) === 0xad ? m.lu + hyphen : m.lu;
      });
      out.push({ id: c.id, lines, nowrap: fromFloatCeil(viewWidth([{ result, start: 0, end: text.length }])), error: '' });
    }
  }
  return out;
}

const differs = (a: CaseWidths, b: CaseWidths): boolean => a.error !== b.error || a.nowrap !== b.nowrap || a.lines.some((w, i) => w !== b.lines[i]);

describe('TXT1-S: the engine shaping core on the TXT1-0 gate', () => {
  const run = engineWidths(NO_SHAPING_FAULTS);

  it('covers all 1,260 gate cases (620 spike cases and 640 Lato cases), Japanese included', () => {
    expect(refs.map((r) => r.cases.length)).toEqual([620, 640]);
    expect(run.results.length).toBe(1260);
    expect(run.results.filter((r) => r.id.startsWith('NotoSansJP/')).length).toBe(80);
    // ja/ja, ja/jamix and ja/jakinsoku: script runs (Hani, Hira, Latn) and HanKerning; ja/prose is English on NotoSansJP.
    expect(run.results.filter((r) => /^NotoSansJP\/(ja|jamix|jakinsoku)\//.test(r.id)).length).toBe(60);
  });

  it('gives Chrome 145\'s width on every line and nowrap span: 1260/1260 cases exact', () => {
    const failed = run.results.filter((r, i) => differs(r, run.chrome[i] as CaseWidths)).map((r) => r.id);
    expect(failed).toEqual([]);
    expect(run.results.reduce((n, r) => n + r.lines.length, 0)).toBe(refs.reduce((n, r) => n + r.cases.reduce((k, c) => k + c.lines.length, 0), 0));
  });

  it('equals the text-shaper reference (blink.ts) case by case', () => {
    const blink = blinkWidths();
    expect(blink.length).toBe(run.results.length);
    const failed = run.results.filter((r, i) => differs(r, blink[i] as CaseWidths)).map((r) => r.id);
    expect(failed).toEqual([]);
  });

  it('segments every gate paragraph into the reference\'s script runs, and Latin text around Common code points with other extensions', () => {
    const texts = [...refs.flatMap((r) => Object.values(r.paragraphs)), 'abc ー def', 'abc । def', 'abc 、 def', '—… “', '「English」と(括弧)'];
    for (const t of texts) {
      const got = segmentText(t);
      expect(got.ok, t).toBe(true);
      if (got.ok) expect(got.segments, t).toEqual(referenceSegments(t));
    }
    expect(segmentText('a 😀 b')).toMatchObject({ ok: false });
  });

  it('reads HanKerning font data per face, the same at every gate size', () => {
    for (const id of ['NotoSansJP', 'Inter', 'Lato']) {
      const at = [12, 16, 17, 24].map((s) => JSON.stringify(hanKerningData(id, s, 'ja')));
      expect(new Set(at).size, id).toBe(1);
    }
    expect(hanKerningData('NotoSansJP', 16, 'ja').hasAlternateSpacing).toBe(true);
  });

  const plants: ReadonlyArray<keyof ShapingFaults> = ['advanceNot16_16', 'doubleAccumulation', 'noReshapeAtBreak', 'kerningDropped', 'wholePixelPositions', 'softHyphenWidthMissing'];
  for (const plant of plants) {
    it(`catches the planted fault ${plant}`, () => {
      const faults = { ...NO_SHAPING_FAULTS, [plant]: true };
      const { results, chrome } = engineWidths(faults, (got, want) => differs(got, want));
      const last = results.length - 1;
      expect(differs(results[last] as CaseWidths, chrome[last] as CaseWidths), plant).toBe(true);
    });
  }
});

describe('TXT1-S: R5 metric rounding through shapedMeasurer', () => {
  type Row = { face: string; deviceSize: number; chrome: { range: { ascent: number; descent: number } } };
  const capture = JSON.parse(readFileSync(join(root, 'docs/research/text-spike/metric-rounding/captures/chrome.json'), 'utf8')) as { rows: Row[] };
  const ids: Record<string, string> = { 'Ahem.ttf': 'Ahem', 'Inter/Inter-Regular.ttf': 'Inter', 'Lato/Lato-Regular.ttf': 'Lato', 'Lato/Lato-Bold.ttf': 'LatoBold' };

  it('gives Chrome\'s ascent and descent on every captured row of the faces the gate bundles', () => {
    const m = shapedMeasurer(facesFor('en'), shaper, NO_SHAPING_FAULTS, 'en');
    const rows = capture.rows.filter((r) => ids[r.face] !== undefined);
    expect(rows.length).toBeGreaterThan(80);
    const wrong = rows.filter((r) => {
      const got = m.metrics(faceFont(ids[r.face] as string, r.deviceSize));
      return got.ascent !== r.chrome.range.ascent * 64 || got.descent !== r.chrome.range.descent * 64;
    });
    expect(wrong).toEqual([]);
  });
});

describe('TXT1-S: Ahem through HarfBuzz (R2)', () => {
  const hbAhem = shapedMeasurer(facesFor('en'), shaper, NO_SHAPING_FAULTS, 'en');
  const capture = JSON.parse(readFileSync(join(root, 'docs/research/text-spike/metric-rounding/captures/ahem-advances.json'), 'utf8')) as {
    font: { sha256: string };
    sizes: number[];
    widthsLayoutUnits: Record<string, number[]>;
  };
  const rows = capture.sizes.flatMap((size) => (capture.widthsLayoutUnits[String(size)] as number[]).map((chrome, i) => ({ size, n: i + 1, chrome })));

  it('gives Chrome\'s nowrap width for every captured Ahem run, at whole and fractional sizes', () => {
    expect(capture.font.sha256).toBe(createHash('sha256').update(readFileSync(files.get('Ahem') as string)).digest('hex'));
    expect(rows.length).toBe(14 * 120);
    const wrong = rows.filter((r) => {
      const m = hbAhem.measure('X'.repeat(r.n), faceFont('Ahem', r.size));
      return !m.ok || m.measure.width !== r.chrome;
    });
    expect(wrong).toEqual([]);
  });

  it('finding for TXT1a-1: ahemMeasurer\'s float-accumulation model misses Chrome on 40 of these runs, at six fractional sizes', () => {
    const wrong = rows.filter((r) => {
      const m = ahemMeasurer.measure('X'.repeat(r.n), faceFont('Ahem', r.size));
      return !m.ok || m.measure.width !== r.chrome;
    });
    expect(wrong.length).toBe(40);
    expect([...new Set(wrong.map((r) => r.size))].sort((a, b) => a - b)).toEqual([7.77, 9.99, 11.1111, 17.3, 23.3, 33.33]);
  });

  it('measures ranges as the difference of cached positions, like ahemMeasurer on whole-px sizes', () => {
    const t = 'pppp pppp​pppp XX';
    const wrong: string[] = [];
    for (const size of [1, 7, 10, 12.5, 16, 37, 64, 100]) {
      const n = [...t].length;
      for (let s = 0; s <= n; s++) {
        for (let e = s; e <= n; e++) {
          const a = JSON.stringify(ahemMeasurer.measureRange(t, s, e, faceFont('Ahem', size)));
          const b = JSON.stringify(hbAhem.measureRange(t, s, e, faceFont('Ahem', size)));
          if (a !== b) wrong.push(`${size} [${s},${e}) ${a} ${b}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('gives ahemMeasurer\'s metrics at every size in hundredths up to 256 px', () => {
    const wrong: number[] = [];
    for (let h = 1; h <= 25600; h++) {
      const font = faceFont('Ahem', h / 100);
      if (JSON.stringify(ahemMeasurer.metrics(font)) !== JSON.stringify(hbAhem.metrics(font))) wrong.push(h / 100);
    }
    expect(wrong).toEqual([]);
  });

  it('calls the WASM shaper', () => {
    expect(shaper.calls).toBeGreaterThan(1000);
  });
});
