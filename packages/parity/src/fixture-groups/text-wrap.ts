// Fixture group text-wrap (css-text-4 §5.1): the text-wrap shorthand and text-wrap-style in Ahem, both directions: nowrap, wrap,
// stable, auto, both longhands at once, inherited, after white-space in the cascade, and on a flex row. TXT-TW: text-wrap-balance-ahem
// lays out balance and pretty with the engine's port of Chrome's passes (layout inline.ts wrapStyleLines): balance by the score
// pass (b1, b2, b4 centered through the shorthand, b8 inherited and aligned at the end, b9 at 13px, rb in a flex row), by bisection
// with too few break opportunities (b3), and greedy for one line (b10), more than six lines (b6) and an overflowing word (b7); b5
// scores the greedy lines best. pretty optimizes a paragraph's last four lines when the last is one short word (p1, p2 over five
// lines, p5 centered through the shorthand, rp in a flex row), and keeps the greedy lines otherwise (p3, p4). The rejects are the
// contexts Dragon does not prove: balance beside an inline box, and pretty with text-align: justify.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_WRAP: readonly FixtureSpec[] = [
  layout('text-wrap-ahem', ['ltr', 'rtl']),
  layout('text-wrap-balance-ahem', ['ltr', 'rtl']),
  reject('reject-text-wrap-balance', 'DRAGON_UNSUPPORTED_VALUE', 'balance', 'text-wrap-style: balance on b beside an inline box'),
  reject('reject-text-wrap-pretty-justify', 'DRAGON_UNSUPPORTED_VALUE', 'pretty', 'text-wrap-style: pretty on p with text-align: justify'),
];
