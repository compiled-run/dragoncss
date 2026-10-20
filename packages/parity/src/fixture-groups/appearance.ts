// Fixture group appearance (css-ui-4 §7.1): every keyword Dragon accepts, through appearance and its -webkit-appearance alias in
// either order, any case, var(), inherit, initial and unset, on blocks, flex items and positioned boxes
// (appearance-values, web and native rows). No supported tag has a native appearance, so each computes as written and paints nothing.
// The rejects: appearance other than none on an inline box and on a list item, whose display Chrome turns into inline-block and
// block, which Dragon does not model.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const APPEARANCE: readonly FixtureSpec[] = [
  both('appearance-values'),
  reject('reject-appearance-inline', 'DRAGON_UNSUPPORTED_VALUE', 'button', 'sp has appearance button on display inline'),
  reject('reject-appearance-list-item', 'DRAGON_UNSUPPORTED_VALUE', 'textfield', 'li has appearance textfield on display list-item'),
];
