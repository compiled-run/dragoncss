// css-writing-modes-4 in horizontal-tb (packages/dragon/src/css/properties/writing-mode.ts, shorthands/writing-mode.ts): writing-mode
// values Chrome computes to horizontal-tb (the SVG 1.1 legacy lr, lr-tb, rl and rl-tb included), declared, inherited and CSS-wide,
// with writing-mode's computed value compared in both renderings (computedExtra); text-orientation and text-combine-upright inert
// on Ahem text; and the vertical values, legacy tb and tb-rl included, and text-combine-upright digits refused.
import { WRITING_MODE_RESET_LONGHANDS } from 'dragon';
import type { WritingModeResetLonghand } from 'dragon';
import type { FixtureSpec } from '../fixtures.ts';
import { reject } from './define.ts';

const writingMode = (id: string): FixtureSpec => ({ id, format: 'html', kind: 'layout', gate: 'default', environments: ['ltr', 'rtl'], source: 'hand-written', rootFont: 'ahem', computedExtra: Object.keys(WRITING_MODE_RESET_LONGHANDS) as WritingModeResetLonghand[] });

export const WRITING_MODE: readonly FixtureSpec[] = [
  writingMode('writing-mode-horizontal'),
  writingMode('writing-mode-inert-text'),
  reject('reject-writing-mode-vertical-lr', 'DRAGON_UNSUPPORTED_VALUE', 'vertical-lr', 'writing-mode: vertical-lr is unsupported'),
  reject('reject-writing-mode-sideways-rl', 'DRAGON_UNSUPPORTED_VALUE', 'sideways-rl', 'writing-mode: sideways-rl is unsupported'),
  reject('reject-writing-mode-tb', 'DRAGON_UNSUPPORTED_VALUE', 'tb', 'writing-mode: tb is unsupported'),
  reject('reject-writing-mode-tb-rl', 'DRAGON_UNSUPPORTED_VALUE', 'tb-rl', 'writing-mode: tb-rl is unsupported'),
  reject('reject-text-combine-digits', 'DRAGON_UNSUPPORTED_VALUE', 'digits', 'text-combine-upright: digits 2 is unsupported'),
];
