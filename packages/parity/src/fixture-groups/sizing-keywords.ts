// Fixture group sizing-keywords (SIZE-KW): css-sizing-3 §3.2 min-content, max-content and fit-content, css-sizing-4 §3.1 stretch
// and Chrome's prefixed forms of all four, as width, min-width and max-width on a block-level box in block flow, as Chrome 145 resolves them (text, block children, flex and grid content, auto
// margins, box-sizing and a new formatting context), in both directions. The reject names where Dragon has not proven them.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const SIZING_KEYWORDS: readonly FixtureSpec[] = [
  both('sizing-keywords-block'),
  // The same keywords inside a min-content or max-content contribution: under a max-content, min-content or fit-content parent, an
  // absolutely positioned box and a flex item, each of which sizes to its children's contributions.
  both('sizing-keywords-contribution'),
  both('sizing-stretch-block'),
  // height, min-height and max-height of stretch and -webkit-fill-available on a block-level box in block flow: the margins that
  // count, box-sizing, indefinite containing blocks, nesting, relative offsets and a block inside an inline box; and the body
  // inside a root of definite height.
  both('sizing-stretch-height'),
  both('sizing-stretch-height-body'),
  reject('reject-stretch-height-flex-item', 'DRAGON_UNSUPPORTED_VALUE', 'stretch', 'height: stretch on s inside a flex item'),
  reject('reject-sizing-keyword-flex-item', 'DRAGON_UNPROVEN_CONTEXT', 'min-content', 'width:min-content on i is used in the flex-row'),
];
