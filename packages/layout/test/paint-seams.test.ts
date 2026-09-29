// EMS (notes/T046-paint-spec.md §3 items 4 and 5): the engine's paint seam files exist, export no function yet (so they add no
// engine root), and each has an empty paint-vectors suite that pnpm run layout:paint-vectors writes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoxShape } from '../src/index.ts';

const layout = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURES = ['radius', 'shadow', 'gradient', 'transform', 'dash', 'scrollbar'];
// PNT2 filled paint-transform.ts and its suite (packages/layout/test/paint-transform.test.ts); the other seams stay stubs.
const STUBS = FEATURES.filter((f) => f !== 'transform');

describe('EMS: engine paint seams', () => {
  it('paint.ts and the unfilled paint-<feature>.ts stubs exist and export no function yet', () => {
    for (const f of ['paint.ts', ...STUBS.map((x) => `paint-${x}.ts`)]) {
      const text = readFileSync(join(layout, 'src', f), 'utf8');
      expect(text, f).not.toMatch(/export (async )?function/);
    }
    const shape: BoxShape = { left: 0, top: 0, right: 10, bottom: 10, borders: [0, 0, 0, 0], radii: [0, 0, 0, 0, 0, 0, 0, 0] };
    expect(shape.radii).toHaveLength(8);
  });
  it('index.ts exports the paint seam: BoxShape, and the transform reference (PNT2)', () => {
    const lines = readFileSync(join(layout, 'src/index.ts'), 'utf8').split('\n').filter((l) => l.includes("'./paint"));
    expect(lines).toEqual([
      "export type { BoxShape } from './paint.ts';",
      "export type { OriginPoint, TransformOrigin } from './paint-transform.ts';",
      "export { mapPoint, paintTransformMatrix, resolveTransformOrigin, transformAboutPoint, transformFunctionsMatrix } from './paint-transform.ts';",
    ]);
  });
  it('every unfilled feature has an empty paint-vectors suite', () => {
    for (const f of STUBS) {
      const v = JSON.parse(readFileSync(join(layout, 'paint-vectors', f, 'vectors.json'), 'utf8')) as { feature: string; cases: number; lines: unknown[]; expected: unknown[] };
      expect(v, f).toMatchObject({ feature: f, cases: 0, lines: [], expected: [] });
    }
  });
});
