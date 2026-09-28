// TXT1-0 gate: shape every spike paragraph through dragon_hb.wasm, apply Blink's arithmetic, and compare
// each line's LayoutUnit width (and each nowrap width) with Chrome 145's measurement.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromFloatCeil, lineView, makeContext, shape, viewWidth } from './blink.ts';
import type { GateFaults, ShapeContext, ShapeResult } from './blink.ts';
import { hanKerningFor, maybeHanKerningClose } from './han-kerning.ts';
import { DragonHB } from './wasm.ts';

export const SPIKE_DIR = fileURLToPath(new URL('../../../docs/research/text-spike/', import.meta.url));
export const FONT_DIR = `${SPIKE_DIR}fonts`;
export const REFERENCE_PATH = `${SPIKE_DIR}gate/chrome-145.json`;
/** SHA-256 of the font files Chrome loaded during the spike's capture (not of the repo copies). */
export const LOADED_FONTS_PATH = `${SPIKE_DIR}chrome/loaded-fonts.sha256`;

/** [start, end, width in LayoutUnits, rect count]. */
export type ReferenceLine = readonly [number, number, number, number];

export interface ReferenceCase {
  readonly id: string;
  readonly font: string;
  readonly paragraph: string;
  readonly lang: string;
  readonly size: number;
  readonly width: number;
  readonly lines: readonly ReferenceLine[];
  readonly nowrap: number;
}

export interface Reference {
  readonly source: string;
  readonly fonts: Readonly<Record<string, { readonly file: string; readonly sha256: string }>>;
  readonly paragraphs: Readonly<Record<string, string>>;
  readonly opportunities: Readonly<Record<string, readonly number[]>>;
  readonly cases: readonly ReferenceCase[];
}

export interface LineDiff {
  readonly line: number;
  readonly text: string;
  readonly chrome: number;
  readonly dragon: number;
}

export interface CaseResult {
  readonly id: string;
  readonly exact: boolean;
  readonly lines: number;
  readonly lineDiffs: readonly LineDiff[];
  readonly nowrap: { readonly chrome: number; readonly dragon: number };
  /** Set when the Blink model could not follow Chrome's break (a model error, counted as a mismatch). */
  readonly error?: string;
}

export function loadReference(path = REFERENCE_PATH): Reference {
  return JSON.parse(readFileSync(path, 'utf8')) as Reference;
}

const SOFT_HYPHEN = 0xad;

export interface GateOptions {
  readonly faults?: GateFaults;
  /** Leave out HanKerning (text-spacing-trim: space-all's shaping), as a planted fault. */
  readonly noHanKerning?: boolean;
}

export function runGate(ref: Reference = loadReference(), hb: DragonHB = DragonHB.load(), options: GateOptions = {}): CaseResult[] {
  const faults = options.faults ?? {};
  const faces = new Map<string, number>();
  const fonts = new Map<string, number>();
  const faceFor = (name: string): number => {
    let f = faces.get(name);
    if (f === undefined) {
      const meta = ref.fonts[name];
      if (meta === undefined) throw new Error(`no font ${name}`);
      f = hb.createFace(readFileSync(`${FONT_DIR}/${meta.file}`));
      faces.set(name, f);
    }
    return f;
  };
  const fontFor = (name: string, size: number): number => {
    const key = `${name}/${size}`;
    let f = fonts.get(key);
    if (f === undefined) {
      f = hb.createFont(faceFor(name), { size });
      fonts.set(key, f);
    }
    return f;
  };

  interface Paragraph {
    readonly ctx: ShapeContext;
    readonly result: ShapeResult;
    readonly nowrap: number;
    readonly hyphen: number;
  }
  const paragraphs = new Map<string, Paragraph>();
  const out: CaseResult[] = [];
  for (const c of ref.cases) {
    const text = ref.paragraphs[c.paragraph];
    const opps = ref.opportunities[c.paragraph];
    if (text === undefined || opps === undefined) throw new Error(`no paragraph ${c.paragraph}`);
    const key = `${c.font}/${c.paragraph}/${c.size}`;
    let p = paragraphs.get(key);
    if (p === undefined) {
      const font = fontFor(c.font, c.size);
      const kerning = options.noHanKerning === true ? undefined : hanKerningFor(hb, faceFor(c.font), font, text, c.lang);
      const ctx = makeContext(hb, font, text, c.lang, kerning === undefined ? { faults } : { rangeFeatures: kerning.rangeFeatures, faults });
      const result = shape(ctx, 0, text.length);
      // ComputedStyle::HyphenString: U+2010 if the primary font has it, else U+002D; shaped on its own.
      const hyphenText = hb.nominalGlyph(font, 0x2010) !== 0 ? '\u2010' : '-';
      const hyphen = fromFloatCeil(shape(makeContext(hb, font, hyphenText, c.lang, { faults }), 0, hyphenText.length).width);
      // A nowrap span: one line, the item's whole ShapeResultView.
      const nowrap = fromFloatCeil(viewWidth([{ result, start: 0, end: text.length }], faults));
      p = { ctx, result, nowrap, hyphen };
      paragraphs.set(key, p);
    }
    const breakable = new Set(opps);
    const diffs: LineDiff[] = [];
    let error: string | undefined;
    try {
      c.lines.forEach(([start, end, chrome], i) => {
        const para = p as Paragraph;
        const m = lineView(para.ctx, para.result, start, end, {
          available: c.width * 64,
          isBreakable: (offset) => offset === text.length || breakable.has(offset),
          maybeHanKerningClose,
        });
        let dragon = m.lu;
        // A soft hyphen break adds the generated hyphen's fragment right after the text.
        if (end < text.length && text.charCodeAt(end - 1) === SOFT_HYPHEN) dragon += para.hyphen;
        if (dragon !== chrome) diffs.push({ line: i, text: text.slice(start, end), chrome, dragon });
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const nowrap = { chrome: c.nowrap, dragon: p.nowrap };
    const exact = error === undefined && diffs.length === 0 && nowrap.chrome === nowrap.dragon;
    out.push({ id: c.id, exact, lines: c.lines.length, lineDiffs: diffs, nowrap, ...(error !== undefined ? { error } : {}) });
  }
  return out;
}
