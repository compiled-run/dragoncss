// Fixture group touch-action (pointerevents-3 §10.2): every value native compiles, auto, manipulation and pan-x pan-y in either
// order, with pinch-zoom (which computes to manipulation), any case, var(), inherit, initial and unset, on blocks, flex items and
// positioned boxes, plus none on an inline span and pan-y on a display: none box, where Chrome ignores it (touch-action-values, web
// and native rows). Every layout fixture runs on native, so the values that stop a pan direction, which native refuses on or in
// a box that scrolls natively on that axis (analysis/touch-action.ts), are proven in packages/dragon/test/touch-action.test.ts.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const TOUCH_ACTION: readonly FixtureSpec[] = [
  both('touch-action-values'),
];
