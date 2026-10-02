// Fixture group attributes (notes/T025 §2 TREE item 8): every attribute is element data for matching. #id specificity against
// classes, HTML's case-insensitive attribute values by name, presence tests, the rendering-neutral attribute pairs (each
// attr-neutral-<name> fixture equals attr-neutral-none in Chrome, packages/dragon/test/attributes.test.ts), a rule Chrome drops
// for a selector it does not parse, and refusals that name the package owning an attribute's rendering effect.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const ATTRIBUTES: readonly FixtureSpec[] = [
  both('attr-id-specificity'),
  both('attr-value-case'),
  both('attr-presence'),
  both('attr-drop-invalid'),
  both('attr-neutral-none'),
  both('attr-neutral-id'),
  both('attr-neutral-data'),
  both('attr-neutral-aria'),
  both('attr-neutral-role'),
  both('attr-neutral-title'),
  both('attr-neutral-ui'),
  both('attr-neutral-rel'),
  both('attr-neutral-target'),
  reject('reject-attr-href', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<div data-dragon-id="a" class="a" href="https://example.com/">', 'attribute href on a is not supported: its rendering effect belongs to the inline and link package INL1'),
  reject('reject-attr-lang', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<div data-dragon-id="a" class="a" lang="en">', 'attribute lang on a is not supported: its rendering effect belongs to the text package TXT1-C'),
  reject('reject-attr-style', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<div data-dragon-id="a" class="a" style="width: 20px">', 'attribute style on a is not supported: its rendering effect belongs to the style-attribute package SOV'),
  // REPL-a handles src on img: an unmapped src is now refused as an image Dragon cannot read at build time.
  reject('reject-attr-img-src', 'DRAGON_REMOTE_IMAGE', '<img data-dragon-id="a" class="a" src="cover.png">', '<img> a: src cover.png is not mapped'),
];
