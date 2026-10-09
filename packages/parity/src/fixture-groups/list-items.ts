// Fixture group list-items (GEN-b, notes/T151-gen-spec.md R13): content and the list-style longhands on elements, where they
// generate no box, and list items whose list-style-type and list-style-image are none, which Chrome lays out as blocks with no
// ::marker (the Tailwind preflight shape), in both directions. The rejects name what GEN-c and the GEN-d packages own.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const LIST_ITEMS: readonly FixtureSpec[] = [
  both('list-items-preflight'),
  both('list-items-shorthand-none'),
  both('list-items-div'),
  both('list-items-flex'),
  both('content-on-elements'),
  both('list-style-values'),
  reject('reject-list-item-decimal', 'DRAGON_UNSUPPORTED_VALUE', '<li data-dragon-id="li" class="a"></li>', 'display: list-item on <li> li generates a decimal marker'),
  reject('reject-list-style-image', 'DRAGON_UNSUPPORTED_VALUE', 'url(x.png)', 'list-style-image: url(x.png) is not supported yet: images in generated content and list-style-image (GEN-d4)'),
  reject('reject-content-element-counter', 'DRAGON_UNSUPPORTED_VALUE', 'counter(x)', 'content: counter(x) is not supported yet: counters and their scopes (GEN-d1)'),
];
