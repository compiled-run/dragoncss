// Fixture group block-in-inline (package BII, CSS2 §9.2.1.1): an inline box that holds only block-level boxes and collapsible white
// space, with no box of its own, lays out as their block box with its three line fragments (analysis/block-in-inline.ts, layout
// block.ts): margins collapse through it and its last line sits below the margin out of its bottom, white space between its blocks
// collapses away, a link (whose underline propagates) qualifies, and percentages resolve against its block container. An inline
// box with padding around a block, one beside text, and one holding another such inline box (pinned in packages/dragon/test) stay
// refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const BLOCK_IN_INLINE: readonly FixtureSpec[] = [
  // The coverage probe's shape: display: inline on a box of two blocks of text.
  both('block-in-inline-probe'),
  both('block-in-inline-cases'),
  // A border-box and border, margin, padding, background and outline reset, which give the inline box no box; a percentage height
  // of a block inside an inline element, against the block container; and the first empty line above a top margin.
  both('block-in-inline-reset'),
  // The sizes, block margins (an owl rule's among them) and ratio a non-replaced inline box ignores; and the first empty line,
  // above the blocks' top margin only where the inline boxes are their container's whole inline formatting context.
  both('block-in-inline-ignored'),
  reject('reject-block-in-inline-box', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="b">YY</div>', '<div> b is block-level inside the inline box <span> s'),
  reject('reject-block-in-inline-empty', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="e" class="e"></div>', '<div> e is block-level inside the inline box <span> s'),
  reject('reject-block-in-inline-beside', 'DRAGON_UNSUPPORTED_VALUE', '<span data-dragon-id="s"><div data-dragon-id="b">YY</div></span>', 'the inline box <span> s holds block-level boxes beside the text'),
];
