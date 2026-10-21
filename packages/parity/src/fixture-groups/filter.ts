// Fixture group filter (FX): filter: none in Ahem, both directions, on bordered boxes with backgrounds, in another ASCII case, through
// -webkit-filter, beside filter in the same rule in both orders and on a flex row, so every target proves none. A refused filter
// list is refused even where a later none wins (the support profile checks every declaration), so none of those is here.
// PNT1-filter: the colour-matrix functions native pre-composites on a group (analysis paint-values/effects.ts opacityGroupPlans; layout
// paint-group.ts groupFilterComposite): text groups under each function, lists, percentages, a default amount, -webkit-filter and a
// filter with opacity (filter-matrix-text), and groups over earlier flow rects, with a border and a child (filter-matrix-over-rects).
// Every group sits clear of the cc raster tile seams as the opacity-group fixtures do (fixture-groups/effects.ts).
// The reject: blur(1px), a filter no target draws (opacity(0) is a colour-matrix function now drawn).
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const FILTER: readonly FixtureSpec[] = [
  layout('filter-none', ['ltr', 'rtl']),
  both('filter-matrix-text'),
  both('filter-matrix-over-rects'),
  reject('reject-filter-function', 'DRAGON_UNSUPPORTED_VALUE', 'blur(1px)', 'filter: blur(1px)'),
];
