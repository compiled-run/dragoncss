// Fixture group text-wrap-break (TXT2-a, notes/T149J-txt2.md): overflow-wrap anywhere and break-word and word-break: break-word
// against Chrome. An overflowing word breaks at grapheme clusters only when no opportunity fits (Blink's anywhere-if-overflow
// retry), an earlier opportunity wins, nowrap keeps the word, and only anywhere and word-break: break-word shrink min-content (a
// flex item's automatic minimum). Ahem and Lato 400 and 700, with the music-player shapes (a 20rem h2 with anywhere in a column flex
// container, the disclosure span). Combining marks have no fixture: Ahem has no glyph for them and the shaping core refuses them
// (ScriptRunIterator), so grapheme clusters are proven by test/grapheme.test.ts and the engine test inline-wrap.test.ts.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const TEXT_WRAP_BREAK: readonly FixtureSpec[] = [
  both('text-wrap-break-ahem'),
  both('text-wrap-break-flex'),
  both('text-wrap-break-lato'),
  reject('reject-text-wrap-break-all', 'DRAGON_UNSUPPORTED_VALUE', 'break-all', null),
  reject('reject-text-wrap-keep-all', 'DRAGON_UNSUPPORTED_VALUE', 'keep-all', null),
  reject('reject-text-wrap-letter-spacing', 'DRAGON_UNSUPPORTED_VALUE', '2px', 'letter-spacing: 2px on d spaces glyphs apart'),
];
