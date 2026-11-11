// The role module (lower/paint/role.ts) reads the element's tag, no longhand: it has no computed values.
import type { PaintValues } from './types.ts';
import { stubPaintValues } from './types.ts';

export const ROLE_VALUES: PaintValues = stubPaintValues('role');
