// Fixture group text-justify (TXT2, text-align: justify; css-text-3 §7.3 and §7.4 with text-align-last and text-justify auto):
// Ahem lines the engine expands at their spaces to the LayoutUnit (even splits, the 16.16 remainder, spaces in inline boxes, a
// forced break, an overflowing line, the last line), and real-font Latin paragraphs in the reference sans-serif, in both directions.
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

export const TEXT_JUSTIFY: readonly FixtureSpec[] = [
  layout('text-justify-ahem', ['ltr', 'rtl']),
  layout('text-justify-latin', ['ltr', 'rtl']),
];
