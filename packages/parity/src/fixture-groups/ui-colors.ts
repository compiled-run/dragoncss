// Fixture group ui-colors (css-ui-4 §6.2, §6.3): caret-color and accent-color at auto and the colour subset, inherited, reset to
// auto under a set colour, through var(), inherit, initial and unset, on blocks, flex items and positioned boxes (ui-colors-values,
// web and native rows). No supported tag is editable or a form control, so neither draws anything.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const UI_COLORS: readonly FixtureSpec[] = [
  both('ui-colors-values'),
];
