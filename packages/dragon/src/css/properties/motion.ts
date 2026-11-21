// css-motion-1 §2: offset-path (initial none), offset-distance (0), offset-position (normal), offset-anchor (auto) and offset-rotate
// (auto), none inherited, with the offset shorthand of all five (Chrome 145 css_properties.json5, in Chrome's order). A box is
// moved along a path only where offset-path is not none, and offset-position, offset-anchor, offset-distance and offset-rotate then
// place and turn it; Dragon composes no offset transform yet (MOTION), so it accepts the initial values alone, where Chrome moves
// no box and makes no stacking context, and refuses every other value (analysis/motion.ts). offset takes none alone, which sets
// every longhand to its initial value.
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, kwInitial, nonInitial, spellsInitial, ZERO_LENGTH } from './initial-only.ts';

export const MOTION_LONGHANDS = ['offset-path', 'offset-distance', 'offset-position', 'offset-anchor', 'offset-rotate'] as const;
export const MOTION_SHORTHANDS = ['offset'] as const;
export const MOTION_INHERITED: readonly (typeof MOTION_LONGHANDS)[number][] = [];
export const MOTION_CONTAINER: readonly (typeof MOTION_LONGHANDS)[number][] = [];
export const MOTION_TEXT_ROLE: readonly (typeof MOTION_LONGHANDS)[number][] = [];

type MotionLonghand = (typeof MOTION_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
export const MOTION_ASPECTS = Object.fromEntries(MOTION_LONGHANDS.map((p) => [p, PAINT_ONLY])) as { readonly [P in MotionLonghand]: PropertyAspect };

/** Each longhand's initial value, the only one Dragon accepts. */
export const MOTION_INITIAL: { readonly [P in MotionLonghand]: CssValue } = {
  'offset-path': kwInitial('none'),
  'offset-distance': ZERO_LENGTH,
  'offset-position': kwInitial('normal'),
  'offset-anchor': kwInitial('auto'),
  'offset-rotate': kwInitial('auto'),
};

/** offset: none alone sets every longhand to its initial value; any other value is kept on all five and refused. */
const parseOffset: InitialOnlyParser = (tokens) => {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'offset needs a value' };
  const none = tokens.length === 1 && spellsInitial(MOTION_INITIAL['offset-path'], tokens[0]);
  return { kind: 'ok', longhands: MOTION_LONGHANDS.map((p) => ({ property: p, value: none ? MOTION_INITIAL[p] : nonInitial(tokens), explicit: true })) };
};

export const MOTION_VALUE_PARSERS: { readonly [P in MotionLonghand | (typeof MOTION_SHORTHANDS)[number]]: InitialOnlyParser } = {
  ...(Object.fromEntries(MOTION_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, MOTION_INITIAL[p])])) as { readonly [P in MotionLonghand]: InitialOnlyParser }),
  offset: parseOffset,
};
