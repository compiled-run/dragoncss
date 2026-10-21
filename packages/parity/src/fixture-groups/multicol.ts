// Fixture group multicol (MULTICOL): column-width, column-count, the column rule longhands, column-span and column-fill at their
// initial values in Ahem, both directions, on bordered and padded boxes with backgrounds: through columns and column-rule in each
// spelling Chrome reads as all initial, every longhand, another ASCII case, a colour change under currentcolor, every -webkit- alias,
// the CSS-wide keywords, inherit and a flex row, so every target proves the initial values. multicol-ahem lays out multi-column
// containers of Ahem text (css-multicol-1 §3, §7) through column-count, column-width, columns and their -webkit- aliases: normal,
// px and zero gaps, a column-width that caps the count, padding and borders, line heights that are not whole px, contents the
// balancer stretches for orphans and widows, <br>s (n has one in every column), centred text, a word wider than its column, a
// text-indent, one line over three columns, a percentage width, one column, and a relatively positioned container in a relatively
// positioned block. The rejects are the multi-column containers no target lays out (one holding an inline box, one holding a block,
// a flex item, one with a height, a column-width in em) and a drawn column rule.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const MULTICOL: readonly FixtureSpec[] = [
  both('multicol-initial'),
  layout('multicol-ahem', ['ltr', 'rtl']),
  reject('reject-multicol-column-count', 'DRAGON_UNSUPPORTED_VALUE', '2', 'column-count: 2 on <div> s makes a multi-column container Dragon does not lay out'),
  reject('reject-multicol-nested', 'DRAGON_UNSUPPORTED_VALUE', '2', 'column-count: 2 on <div> s makes a multi-column container Dragon does not lay out'),
  reject('reject-multicol-flex-item', 'DRAGON_UNSUPPORTED_VALUE', '50px', 'column-width: 50px on <div> s makes a multi-column container Dragon does not lay out'),
  reject('reject-multicol-height', 'DRAGON_UNSUPPORTED_VALUE', '2', 'column-count: 2 on <div> s makes a multi-column container Dragon does not lay out'),
  reject('reject-multicol-em-width', 'DRAGON_UNSUPPORTED_VALUE', '5em', 'column-width: 5em on <div> s makes a multi-column container Dragon does not lay out'),
  reject('reject-multicol-column-rule', 'DRAGON_UNSUPPORTED_VALUE', '1px solid red', 'column-rule-width: 1px solid red on <div> s is unsupported'),
];
