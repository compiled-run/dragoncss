// The text decoration rects the device places (TDEC-b, dragon emit/paint/text-decoration.ts dragonPlaceTextDecorations), on the
// host: the program's text-decoration writes, the engine's lines of each decorated text (line-breaks.ts engineTextLines, the
// decoration capture's geometry), the text's and the decorating font's ascent and zoomed size, lengths in css px times the DPR, and
// for skip-ink auto the Ahem clips (layout text-decoration.ts ahemLineInk and skipInkClips over the shaped pens, letter-spacing included). Kept apart from
// text-decoration.ts, which reads pixel-reference.ts (whose registry reads it), so a test can import it first.
import type { InlineChild, LayoutBox, TextFont } from '@dragon/layout';
import { NO_ENGINE_FAULTS, pieceGlyphs, textDecoration as td, zoomInput } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { programInput } from 'dragon';
import type { TextDecorationEntry } from '../../../dragon/src/lower/paint/text-decoration.ts';
import { engineTextLines } from '../line-breaks.ts';
import { referenceMeasurer } from '../native-host.ts';

/** One rect the device places, in absolute device px, with its decoration's colour and the skip-ink clips it leaves out. */
export type PlacedDecoration = td.DecorationRect & {
  readonly text: string;
  /** The text's line index, and the rect's index among that line's rects of the text. */
  readonly lineIndex: number;
  readonly index: number;
  readonly color: td.Rgba;
  readonly clips: readonly number[];
};

/** The text-decoration writes of a program, in node order. */
export function decorationEntries(p: NativeProgram): TextDecorationEntry[] {
  const out: TextDecorationEntry[] = [];
  for (const n of p.nodes) {
    for (const w of n.writes) if (w.kind === 'text-decoration') out.push(...(w as unknown as { readonly entries: readonly TextDecorationEntry[] }).entries);
  }
  return out;
}

const lengthAt = (l: TextDecorationEntry['thickness'], dpr: number): td.DecorationLength => (l.kind === 'px' ? { kind: 'px', value: l.value * dpr } : l);

/**
 * The decoration rects of a program at a DPR as the device places them (dragonPlaceTextDecorations), per text in program order,
 * per entry, line and rect in Blink's order. faults plant the geometry (none on the device).
 */
export function placedDecorations(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number, faults: td.DecorationFaults = td.NO_DECORATION_FAULTS): PlacedDecoration[] {
  const entries = decorationEntries(p);
  if (entries.length === 0) return [];
  const input = programInput(p, viewport, dpr);
  const m = referenceMeasurer();
  const texts = engineTextLines(input, m);
  // The zoomed input's fonts: an inline box's own, and each formatting context root's strut.
  const fonts = new Map<string, TextFont>();
  const inline = (k: InlineChild): void => {
    if (k.kind !== 'inline') return;
    fonts.set(k.id, { family: k.font.family, size: k.font.size, letterSpacing: 0, wordSpacing: 0 });
    for (const x of k.children) inline(x);
  };
  const walk = (b: LayoutBox): void => {
    if (b.strut !== null) fonts.set(b.id, { family: b.strut.font.family, size: b.strut.font.size, letterSpacing: 0, wordSpacing: 0 });
    for (const k of b.children) {
      if (k.kind === 'box') walk(k);
      else if (k.kind !== 'replaced') inline(k);
    }
  };
  walk(zoomInput(input, NO_ENGINE_FAULTS).root);
  const metricsOf = (font: TextFont): td.DecorationFont => {
    const a = m.metrics(font).ascent / 64;
    return { floatAscent: a, ascent: a, size: font.size, underlineThickness: 0 };
  };
  const out: PlacedDecoration[] = [];
  for (const t of texts) {
    const mine = entries.filter((e) => e.text === t.id);
    if (mine.length === 0) continue;
    const textFont = metricsOf(t.textFont);
    const counts = new Map<number, number>();
    for (const e of mine) {
      const boxFont = fonts.get(e.box ?? t.container);
      if (boxFont === undefined) throw new Error(`${t.id}: no font for the decorating box ${e.box ?? t.container}`);
      const font = metricsOf(boxFont);
      for (const [j, line] of t.lines.entries()) {
        const textTop = line.rect.y / 64;
        const baseline = textTop + textFont.ascent;
        const input: td.DecorationInput = {
          lines: e.lines, thickness: lengthAt(e.thickness, dpr), underlineOffset: lengthAt(e.underlineOffset, dpr),
          font, textFont, left: line.rect.x / 64, width: line.rect.width / 64, textTop, decoratingTop: baseline - font.ascent, double: e.style === 'double',
        };
        for (const r of td.decorationRects(input, faults)) {
          let clips: number[] = [];
          if (e.skipInk && r.line !== 'line-through') {
            // TDEC-d: the compiler accepts skip-ink auto on Ahem only, one glyph per code point.
            if (t.font.family !== 'Ahem' || input.double) throw new Error(`${t.id}: skip-ink auto on a ${e.style} line in ${t.font.family} reached a program`);
            const g = pieceGlyphs(m, String.fromCodePoint(...line.cps), t.textFont, 0, line.cps.length);
            if (!g.ok || g.xs.length !== line.cps.length) throw new Error(`${t.id} line ${j}: no glyph per code point: ${g.ok ? g.xs.length : g.reason}`);
            clips = td.skipInkClips(r, td.ahemLineInk(line.cps, g.xs.map((x) => input.left + x), t.font.size, baseline), faults);
          }
          const index = counts.get(j) ?? 0;
          counts.set(j, index + 1);
          out.push({ ...r, text: t.id, lineIndex: j, index, color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.alpha }, clips });
        }
      }
    }
  }
  return out;
}
