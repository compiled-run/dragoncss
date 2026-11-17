// The Markless native-styles ladder (docs/markless-native-styles.md): component CSS in a .tsrx <style> block, smallest first. box
// covers padding, margin, border sides and radii and background colour; text covers size, weight and colour; flex covers row and
// column with gap and alignment; toggle covers a class switched by a component state, radius included; press covers :active on a
// pressable element. :disabled is refused on every target with a build error naming the selector; :active on a <button> is refused
// on native (form-control hit testing), which test/markless-native-styles.test.ts checks.
import type { FixtureSpec } from '../fixtures.ts';
import { rejectTree, tree } from './define.ts';

export const MARKLESS_STYLES: readonly FixtureSpec[] = [
  tree('ms-box'),
  tree('ms-text'),
  tree('ms-flex'),
  tree('ms-toggle'),
  tree('ms-press'),
  rejectTree('reject-ms-button-disabled', 'DRAGON_UNSUPPORTED_SELECTOR', ':disabled'),
];
