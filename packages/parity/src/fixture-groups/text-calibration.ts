// Fixture group text-calibration (TXT1a-2, notes/T056-txt1a-spec.md R10): real-font text the R10 coverage threshold is measured on
// once. The set is disjoint from the proof set (text-latin): its texts, sizes and widths appear in no text-latin fixture. Each case
// also runs every lane a FIXTURES case runs, with the reference font map (fonts.ts MAPS).
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

export const TEXT_CALIBRATION: readonly FixtureSpec[] = [
  layout('text-calibration-lato', ['ltr']),
  layout('text-calibration-sans', ['ltr']),
  layout('text-calibration-mono', ['ltr']),
];

/** data-dragon-id to postScriptName: the face Chrome must draw each listed element's text with, in both documents. */
export const TEXT_CALIBRATION_FACES: ReadonlyMap<string, { readonly [id: string]: string }> = new Map([
  ['text-calibration-lato', { p1: 'Lato-Regular', p2: 'Lato-Regular', p3: 'Lato-Bold' }],
  ['text-calibration-sans', { p1: 'Inter-Regular', p2: 'Inter-Regular', p3: 'Inter-Bold' }],
  ['text-calibration-mono', { p1: 'NotoSansMono-Regular', p2: 'NotoSansMono-Regular' }],
]);
