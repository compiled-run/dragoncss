// GRID G-HIT: the hit lane models grid containers (rt-hit.ts gridOrders), so it leaves out no grid fixture by name; the list and its
// reason stay so hit-report.test.ts and lanes.test.ts keep their union shape. Before G-HIT it listed every grid fixture case.
export const GRID_OUT: readonly string[] = [];
export const GRID_REASON = /(^|: )\S+ is a grid container, which the hit table does not model yet \(GRID: atomic grid items in order-modified document order; no Chrome hit capture\)$/;
