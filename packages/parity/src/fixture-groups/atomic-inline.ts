// Fixture group atomic-inline (INL2a, notes/T059J-inl2.md): inline-block and inline-flex boxes on the lines of their block
// container, from INL-P family 5 (docs/research/inline-spike/probe/family5-atomic.json): baselines, breaks around U+FFFC and
// shrink-to-fit widths, plus the music-player shapes (an inline-flex icon in a blockified flex item, inline-block links with rem
// margins). Two atomic inlines in a paragraph without letters would be reordered in rtl (UAX #9, refused), so links runs ltr only.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const ATOMIC_INLINE: readonly FixtureSpec[] = [
  both('atomic-inline-block'),
  both('atomic-inline-flex'),
  both('atomic-inline-breaks'),
  both('atomic-inline-shrink'),
  both('atomic-inline-north-star'),
  layout('atomic-inline-links'),
  reject('reject-atomic-in-inline-box', 'DRAGON_UNPROVEN_CONTEXT', '<span data-dragon-id="a" class="ib">X</span>', 'inline-block <span> a is an atomic inline inside the inline box <span> s'),
];
