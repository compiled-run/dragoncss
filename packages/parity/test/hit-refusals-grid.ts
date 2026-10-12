// The hit lane leaves out, by name, the GRID G1a, G1c and G2 fixture cases (rt-hit.ts hitRefusal): Blink paints grid items atomically in
// order-modified document order, which the hit table does not model yet. A HitError carries it after "hit test: ". Shared by
// hit-report.test.ts and lanes.test.ts.
export const GRID_OUT: readonly string[] = [
  'grid-placement', 'grid-placement-rtl', 'grid-named-areas', 'grid-named-areas-rtl', 'grid-fr', 'grid-fr-rtl', 'grid-intrinsic', 'grid-intrinsic-rtl',
  'grid-alignment', 'grid-alignment-rtl', 'grid-sizing', 'grid-sizing-rtl', 'grid-nested', 'grid-nested-rtl',
  'grid-aspect-ratio', 'grid-aspect-ratio-rtl', 'grid-self-values', 'grid-self-values-rtl', 'grid-place', 'grid-place-rtl',
  'grid-template-shorthands', 'grid-template-shorthands-rtl', 'grid-auto-repeat', 'grid-auto-repeat-rtl',
];
export const GRID_REASON = /(^|: )\S+ is a grid container, which the hit table does not model yet \(GRID: atomic grid items in order-modified document order; no Chrome hit capture\)$/;
