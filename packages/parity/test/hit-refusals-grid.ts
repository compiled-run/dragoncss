// The hit lane leaves out, by name, the GRID G1a fixture cases (rt-hit.ts hitRefusal): Blink paints grid items atomically in
// order-modified document order, which the hit table does not model yet. Shared by hit-report.test.ts and lanes.test.ts.
export const GRID_OUT: readonly string[] = [
  'grid-placement', 'grid-placement-rtl', 'grid-named-areas', 'grid-named-areas-rtl', 'grid-fr', 'grid-fr-rtl', 'grid-intrinsic', 'grid-intrinsic-rtl',
  'grid-alignment', 'grid-alignment-rtl', 'grid-sizing', 'grid-sizing-rtl', 'grid-nested', 'grid-nested-rtl',
];
export const GRID_REASON = /^\S+ is a grid container, which the hit table does not model yet \(GRID: atomic grid items in order-modified document order; no Chrome hit capture\)$/;
