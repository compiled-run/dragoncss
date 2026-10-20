// Fixture group display-contents (css-display-3 §2.5): a display: contents element's children take its place in its parent's box,
// in an inline formatting context (its text collapses with its neighbours'), among blocks, as flex and grid items, nested, with an
// inline and a block ::before/::after, and loose text that becomes an anonymous flex item, in both directions.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const DISPLAY_CONTENTS: readonly FixtureSpec[] = [both('display-contents')];
