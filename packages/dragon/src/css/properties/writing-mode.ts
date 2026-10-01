// Writing modes (css-writing-modes-4 §2-§3, §9) in horizontal-tb only. Dragon lays out horizontal-tb, so writing-mode accepts only
// the values Chrome 145 computes to horizontal-tb (horizontal-tb and the SVG 1.1 legacy lr, lr-tb, rl and rl-tb) and refuses every
// vertical one (shorthands/writing-mode.ts). text-orientation and text-combine-upright apply only in vertical typographic mode
// (css-writing-modes-4 §5.1, §9.1), so in horizontal-tb they are inert. None of them has a longhand of its own: each is a surrogate
// shorthand that sets nothing, and the parity lane compares writing-mode's computed value in both renderings (computedExtra).
import type { PropertyAspect } from '../properties.ts';

export const WRITING_MODE_LONGHANDS = [] as const;
export const WRITING_MODE_SHORTHANDS = ['writing-mode', 'text-orientation', 'text-combine-upright'] as const;
export const WRITING_MODE_INHERITED: readonly (typeof WRITING_MODE_LONGHANDS)[number][] = [];
export const WRITING_MODE_CONTAINER: readonly (typeof WRITING_MODE_LONGHANDS)[number][] = [];
export const WRITING_MODE_TEXT_ROLE: readonly (typeof WRITING_MODE_LONGHANDS)[number][] = [];

export const WRITING_MODE_ASPECTS: { readonly [P in (typeof WRITING_MODE_LONGHANDS)[number]]: PropertyAspect } = {};

/** The writing-mode keywords Chrome 145 computes to horizontal-tb (dual computed check: fixtures/writing-mode-*.html). */
export const HORIZONTAL_WRITING_MODES = ['horizontal-tb', 'lr', 'lr-tb', 'rl', 'rl-tb'] as const;

/**
 * The properties Dragon holds at one computed value, as Chrome 145 serializes it in getComputedStyle: the parity lane captures
 * each in both renderings of a writing-mode fixture and requires this value in both.
 */
export const WRITING_MODE_RESET_LONGHANDS = {
  'writing-mode': 'horizontal-tb',
} as const;

export type WritingModeResetLonghand = keyof typeof WRITING_MODE_RESET_LONGHANDS;
