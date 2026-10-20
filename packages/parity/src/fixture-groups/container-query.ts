// Fixture group container-query (CQ): container-type: inline-size in Ahem, both directions. container-inline-size puts it on a block
// whose child's margins no longer collapse through it, inline-blocks (one with a width), an absolutely positioned box (the containing
// block of its own absolutely positioned child), a static container, which is no containing block for an absolutely positioned
// child, flex items, grid items in auto tracks, grids that keep their explicit tracks, a min-content width, nested containers and a
// flex container, through the container shorthand, var() and another ASCII case, with container-name beside
// it. The rejects: size containment, and inline-size on an inline box.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const CONTAINER_QUERY: readonly FixtureSpec[] = [
  both('container-inline-size'),
  reject('reject-container-type', 'DRAGON_UNSUPPORTED_VALUE', 'size', 'container-type: size'),
  reject('reject-container-type-inline', 'DRAGON_UNSUPPORTED_VALUE', 'inline-size', 'container-type: inline-size on <span>'),
];
