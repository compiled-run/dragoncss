// Dashed and dotted borders as Blink 145 paints them in device px (P6a, notes/T008-p5-review.md): fitted dash gaps at each
// thickness ratio, square and round dots, and mixed-style corners. The box widths are chosen so that at every device DPR the
// middle of some side sits on a crisp dash or dot boundary, where a 1 device px phase shift or an unfitted gap changes the pixel.
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

export const BORDER_PAINT: readonly FixtureSpec[] = [layout('border-dash-fit'), layout('border-dot-fit')];
