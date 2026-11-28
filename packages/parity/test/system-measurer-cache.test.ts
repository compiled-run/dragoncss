// systemMeasurer keeps each face's metrics and lengths per size: a measurer asked again and again, as a layout plan asks it at every
// width, answers and records exactly what fresh measurers do, and asks the target's provider once per face and size.
import { describe, expect, it } from 'vitest';
import type { FontLengths, FontMetrics, TextFont } from '@dragon/layout';
import { AHEM_FACE_ID, AHEM_FONT_DATA } from '@dragon/layout';
import { SYSTEM_FACES } from 'dragon';
import type { MeasurerRecorder } from '../src/system-fonts/measurer.ts';
import { systemMeasurer } from '../src/system-fonts/measurer.ts';
import type { SystemFonts } from '../src/system-fonts/provider.ts';

const [sans, serif] = [...SYSTEM_FACES.keys()] as [string, string];

/** A provider whose answers follow the face and size, counting what reaches it; serif keeps the engine's own line metrics. */
function countingFonts(): { readonly fonts: SystemFonts; readonly asked: string[] } {
  const asked: string[] = [];
  const fonts: SystemFonts = {
    target: 'ios',
    descriptor: () => {
      throw new Error('not asked');
    },
    fontData: () => AHEM_FONT_DATA,
    lengths(id, sizePx): FontLengths {
      asked.push(`lengths ${id} ${sizePx}`);
      return { xHeight: sizePx / 2 + id.length, capHeight: sizePx * 0.7, zeroWidth: sizePx * 0.6 };
    },
    metrics(id, sizePx, dpr): FontMetrics | null {
      asked.push(`metrics ${id} ${sizePx}`);
      if (id === serif) return null;
      return { ascent: sizePx * 64 * dpr, descent: sizePx * 16, lineGap: 0, normalGapAbove: 0 } as unknown as FontMetrics;
    },
    authorFace: () => false,
    shaper: { shape: () => [], fallback: (): string => '' },
  };
  return { fonts, asked };
}

/** What the plan's recorder keeps: one entry per face and size. */
function mapRecorder(): { readonly recorder: MeasurerRecorder; readonly metrics: Map<string, unknown>; readonly lengths: Map<string, unknown> } {
  const metrics = new Map<string, unknown>();
  const lengths = new Map<string, unknown>();
  return {
    metrics,
    lengths,
    recorder: {
      shape: () => {},
      fallback: () => {},
      metrics: (family, size, m) => metrics.set(`${family}@${size}`, m === null ? [family, size] : [family, size, m.ascent, m.descent, m.lineGap, m.normalGapAbove]),
      lengths: (family, size, l) => lengths.set(`${family}@${size}`, [family, size, l.xHeight, l.capHeight, l.zeroWidth]),
    },
  };
}

const program = { a: { font: { family: sans } }, b: { font: { family: serif } } };
const font = (family: string, size: number, spacing = 0): TextFont => ({ family, size, letterSpacing: spacing, wordSpacing: spacing, smallCaps: spacing > 0, variantNumeric: { figure: 'normal', spacing: 'normal', fraction: 'normal', ordinal: false, slashedZero: false } }) as unknown as TextFont;
// Fonts that differ only in spacing and caps share a face and size, so they share its metrics and lengths.
const asks = [sans, serif, AHEM_FACE_ID].flatMap((family) => [10, 13.5, 16, 28].flatMap((size) => [font(family, size), font(family, size, 2)]));

describe('systemMeasurer asked again answers and records as fresh measurers do', () => {
  it('metrics and lengths of system and engine faces, five rounds in two orders, on one measurer and on a fresh one per ask', () => {
    const shared = countingFonts();
    const kept = mapRecorder();
    const m = systemMeasurer(shared.fonts, program, [], 3, new Map(), kept.recorder);
    const each = mapRecorder();
    for (let round = 0; round < 5; round++) {
      for (const f of round % 2 === 0 ? asks : [...asks].reverse()) {
        const once = systemMeasurer(countingFonts().fonts, program, [], 3, new Map(), each.recorder);
        expect(m.metrics(f), `${f.family} ${f.size}`).toEqual(once.metrics(f));
        expect(m.lengths(f), `${f.family} ${f.size}`).toEqual(once.lengths(f));
      }
    }
    // The same entries in the same order, which is the order the plan writes them.
    expect([...kept.metrics]).toEqual([...each.metrics]);
    expect([...kept.lengths]).toEqual([...each.lengths]);
    // Each system face and size reaches the provider once per kind; the engine's face never does.
    expect(shared.asked.length).toBe(2 * 2 * 4);
    expect(new Set(shared.asked).size).toBe(shared.asked.length);
  });

  it('a recorder that refuses what it has not seen is told of each face and size, so the plan still refuses', () => {
    const missed: string[] = [];
    const check: MeasurerRecorder = { shape: () => {}, fallback: () => {}, metrics: (family, size) => missed.push(`metrics ${family}@${size}`), lengths: (family, size) => missed.push(`lengths ${family}@${size}`) };
    const m = systemMeasurer(countingFonts().fonts, program, [], 1, new Map(), check);
    for (let round = 0; round < 3; round++) for (const f of asks) m.metrics(f);
    expect(new Set(missed)).toEqual(new Set(asks.map((f) => `metrics ${f.family}@${f.size}`)));
  });
});
