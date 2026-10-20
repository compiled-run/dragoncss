// Fixture group table (CSS2 §17): border-collapse, border-spacing and its two -webkit- longhands, caption-side, empty-cells and
// table-layout at every keyword, with px, em, rem, calc() and var() spacings, any case, inherit, initial and unset, on blocks, a
// list item, flex items, positioned boxes and an inline span. None is a table box, so Chrome lays out and paints them as it would
// without the properties, and every value compiles on every target (table-properties, web and native rows).
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const TABLE: readonly FixtureSpec[] = [
  both('table-properties'),
  reject('reject-display-table', 'DRAGON_UNSUPPORTED_VALUE', 'table', 'display: table is unsupported'),
];
