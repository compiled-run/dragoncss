// The Markless native-styles ladder (docs/markless-native-styles.md): component CSS in a .tsrx <style> block, smallest first. box
// covers padding, margin, border sides and radii and background colour; text covers size, weight and colour; flex covers row and
// column with gap and alignment; toggle covers a class switched by a component state, radius included; press covers :active on a
// pressable element; button-disabled covers :disabled on a button bound to a disabled state. :active on a <button> is refused on
// native (form-control hit testing), which test/markless-native-styles.test.ts checks.
import type { FixtureSpec } from '../fixtures.ts';
import { tree } from './define.ts';

export const MARKLESS_STYLES: readonly FixtureSpec[] = [
  tree('ms-box'),
  tree('ms-text'),
  tree('ms-flex'),
  tree('ms-toggle'),
  tree('ms-press'),
  tree('ms-button-disabled'),
];
