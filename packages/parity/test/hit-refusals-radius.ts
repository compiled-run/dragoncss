// The hit lane leaves out, by name, the radius fixture cases (hit-capture.ts hitRefusal): Blink clips a hit to the rounded border
// box, which the hit table does not model yet. Shared by hit-report.test.ts and lanes.test.ts.
export const RADIUS_OUT: readonly string[] = ['radius-basic', 'radius-basic-rtl', 'radius-borders', 'radius-borders-rtl', 'radius-clip', 'radius-clip-rtl', 'radius-clamp', 'radius-clamp-rtl', 'radius-cascade', 'radius-cascade-rtl', 'radius-longhands', 'radius-longhands-rtl'];
export const RADIUS_REASON = /^border-radius on .+: hit testing through rounded corners is not modelled yet \(PNT1\)$/;
