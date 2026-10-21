// Fixture group container-query (CQ): container-type: inline-size in Ahem, both directions. container-inline-size puts it on a block
// whose child's margins no longer collapse through it, inline-blocks (one with a width), an absolutely positioned box (the containing
// block of its own absolutely positioned child), a static container, which is no containing block for an absolutely positioned
// child, flex items, grid items in auto tracks, grids that keep their explicit tracks, a min-content width, nested containers and a
// flex container, through the container shorthand, var() and another ASCII case, with container-name beside it. cq-rules has
// @container rules on a named container that follows the viewport (with an @media rule that moves it) and on an unnamed one clamped
// by max-width inside it, a rule on an element outside every container and on a container itself, which is not its own query
// container; its resize script (media-runtime.ts RESIZE_SCRIPTS) crosses every width they query. cq-units sizes boxes in cqw and cqi
// (plain, in calc() and min(), on margins, padding and a height) against the same two containers and a px-wide one, resized across
// the @media band and card's 340px clamp. The rejects: size containment, inline-size on an inline box, a query on height, a query
// container behind a left border (whose width Chrome rounds to device pixels), a cqw with no query container and a cqh.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const CONTAINER_QUERY: readonly FixtureSpec[] = [
  both('container-inline-size'),
  both('cq-rules'),
  both('cq-units'),
  reject('reject-container-type', 'DRAGON_UNSUPPORTED_VALUE', 'size', 'container-type: size'),
  reject('reject-container-type-inline', 'DRAGON_UNSUPPORTED_VALUE', 'inline-size', 'container-type: inline-size on <span>'),
  reject('reject-cq-height', 'DRAGON_UNSUPPORTED_AT_RULE', '@container (height > 10px) { .a { background-color: #00cc00; } }', '@container (height > 10px) in the stylesheet is not supported: height is not supported'),
  reject('reject-cq-unit-none', 'DRAGON_UNSUPPORTED_VALUE', '50cqw', 'width: 50cqw is not supported here: <div> has no query container'),
  reject('reject-cq-unit-block', 'DRAGON_UNSUPPORTED_VALUE', '10cqh', 'height: 10cqh is unsupported: an inline-size query container answers only the inline axis'),
  reject('reject-cq-border', 'DRAGON_UNSUPPORTED_AT_RULE', '@container (min-width: 200px) { .a { background-color: #00cc00; } }', '@container (min-width: 200px) is not supported here: the width of its query container cannot be read: <div> has a left border'),
];
