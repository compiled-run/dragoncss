// TXT2-tj offline: the engine's glyph positions on the justified lines of text-justify-values-ahem (fixture group text-justify), as
// Blink 145 places them by CheckJustificationOpportunity and ExpansionSetup over 10px Ahem; text-justify-values.test.ts proves the
// same positions in a live Chrome. Each line lists the left of every non-space character from the block's left, in css px.
import { describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { BLOCKS, engineGlyphs } from './text-justify-glyphs.ts';

// 5px over "XX XX": the one space under auto and inter-word, none under none, 1.25px after each character but the last under
// inter-character. rem and dist share 7.296875px (67.3px snapped to 1/64) over 5 and 2 opportunities, each the share truncated to
// 16.16 and the last the remainder. mixn expands only its auto space, 13px; mixc gives 5.75px to each of its 4 inter-character
// characters before the span's auto X. off is not justified.
const CHAR = [[0, 11.25, 33.75, 45], [0, 10, 20, 40]];
const NONE = [[0, 10, 30, 40], [0, 10, 20, 40]];
const AUTO = [[0, 10, 35, 45], [0, 10, 20, 40]];
const EXPECTED: Record<(typeof BLOCKS)[number], number[][]> = {
  auto: AUTO,
  word: AUTO,
  none: NONE,
  char: CHAR,
  rem: [[0, 11.459365844726562, 22.918731689453125, 45.83746337890625, 57.296875], [0, 22.918731689453125, 34.37809753417969, 45.83746337890625, 57.296875], [0, 10]],
  dist: [[0, 38.197906494140625, 57.296875], [0, 28.6484375, 57.296875], [0, 14.32421875, 28.6484375, 42.97265625, 57.296875], [0]],
  mixn: [[0, 10, 43, 63], [0, 10, 20, 30, 53, 63], [0]],
  mixc: [[0, 15.75, 47.25, 63], [0, 10, 34.34375, 48.67707824707031, 63.01042175292969], [0, 20, 30]],
  inhc: [[0, 11.25, 22.5, 45], [0, 45], [0, 15, 30, 45], [0]],
  off: NONE,
  rc: CHAR,
  rn: NONE,
};

describe('TXT2-tj: text-justify glyph positions in the engine', () => {
  it('places every glyph of text-justify-values-ahem as Blink does', () => {
    expect(engineGlyphs()).toEqual(EXPECTED);
  });

  it('planted fault textJustifyAuto moves the glyphs of every block but auto, inter-word and the unjustified one', () => {
    const planted = engineGlyphs({ ...NO_ENGINE_FAULTS, textJustifyAuto: true });
    expect(BLOCKS.filter((id) => JSON.stringify(planted[id]) !== JSON.stringify(EXPECTED[id]))).toEqual(['none', 'char', 'rem', 'dist', 'mixn', 'mixc', 'inhc', 'rc', 'rn']);
  });
});
