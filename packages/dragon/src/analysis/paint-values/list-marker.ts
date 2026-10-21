// Seam (EMS): the list-marker module's computed paint values. list-style-type computes in css/properties/lists.ts; GEN-c draws
// with the list item's color (computed-checks.ts markerRefusal rules on the marker per target).
import type { PaintValues } from './types.ts';
import { stubPaintValues } from './types.ts';

export const LIST_MARKER_VALUES: PaintValues = stubPaintValues('list-marker');
