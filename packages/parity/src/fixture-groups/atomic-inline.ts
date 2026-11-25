// Fixture group atomic-inline (INL2a, notes/T059J-inl2.md): inline-block and inline-flex boxes on the lines of their block
// container, from INL-P family 5 (docs/research/inline-spike/probe/family5-atomic.json): baselines, breaks around U+FFFC and
// shrink-to-fit widths, plus the music-player shapes (an inline-flex icon in a blockified flex item, inline-block links with rem
// margins). G-INL adds inline-grid: its first baseline beside text (one and two rows, align-items: baseline, overflow: hidden,
// none when empty) and shrink-to-fit widths. Two atomic inlines in a paragraph without letters would be reordered in rtl (UAX #9, refused), so links runs ltr only.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const ATOMIC_INLINE: readonly FixtureSpec[] = [
  both('atomic-inline-block'),
  both('atomic-inline-flex'),
  both('atomic-inline-grid'),
  both('atomic-inline-breaks'),
  both('atomic-inline-shrink'),
  both('atomic-inline-north-star'),
  layout('atomic-inline-links'),
  // The music-player disclosure shape: a block span and two inline-block links, so an anonymous box holds only atomic inlines.
  layout('atomic-inline-disclosure'),
  // HIT-atomic-inline: atomic inlines hit in their line's paint order (notes/HIT-atomic-inline-spec.md).
  both('hit-atomic-inline'),
  // HIT-INL2c: an atomic inline forming a stacking context hits as its own layer (notes/HIT-INL2c-spec.md), split to fit the viewport.
  layout('hit-atomic-inline-context', ['ltr', 'rtl']),
  layout('hit-atomic-inline-context-nest', ['ltr', 'rtl']),
  layout('hit-atomic-inline-notes', ['ltr', 'rtl']),
  reject('reject-atomic-in-inline-box', 'DRAGON_UNPROVEN_CONTEXT', '<span data-dragon-id="a" class="ib">X</span>', 'inline-block <span> a is an atomic inline inside the inline box <span> s'),
  reject('reject-atomic-beside-shaped-text', 'DRAGON_UNPROVEN_CONTEXT', '<span data-dragon-id="a" class="ib"></span>', 'inline-block <span> a shares an inline formatting context of d with text d:text0 in a real face'),
];
