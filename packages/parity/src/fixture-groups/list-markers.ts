// Fixture group list-markers (GEN-c, notes/T151-gen-spec.md R14): outside disc and square markers beside text, nested blocks, a
// flex and an inline-block first child, a taller marker that pushes block content down, empty items, items without line boxes, a
// bordered item and a flex list (the family6-alignment cases), and the Tailwind list shapes, in both directions; text markers and
// ::marker colors (on symbol and text markers, through the cascade and currentcolor) left to right.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout } from './define.ts';

export const LIST_MARKERS: readonly FixtureSpec[] = [both('list-markers-disc'), both('list-markers-tailwind'), layout('list-markers-text'), layout('list-markers-pseudo')];
