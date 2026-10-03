// EMS (notes/T046-paint-spec.md §3 items 4 and 5): the engine's paint seam files exist, export no function yet (so they add no
// engine root), and each has an empty paint-vectors suite that pnpm run layout:paint-vectors writes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoxShape } from '../src/index.ts';

const layout = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURES = ['radius', 'shadow', 'gradient', 'transform', 'dash', 'scrollbar'];
/** The seams a package has filled: dash by P6a, radius and shadow by PNT1 (each paint-<feature>.ts, its index.ts lines and its vectors). */
const FILLED = ['dash', 'radius', 'shadow'];
const STUBS = FEATURES.filter((f) => !FILLED.includes(f));
/** The functions paint.ts exports (PNT1 effects: Skia's paint alpha byte of an opacity, which the device and the host share). */
const PAINT_FUNCTIONS = ['opacityAlpha8'];

describe('EMS: engine paint seams', () => {
  it('the paint-<feature>.ts stubs no package has filled exist and export no function yet, and paint.ts exports only opacityAlpha8', () => {
    for (const f of FEATURES) readFileSync(join(layout, 'src', `paint-${f}.ts`), 'utf8');
    for (const f of STUBS.map((x) => `paint-${x}.ts`)) {
      const text = readFileSync(join(layout, 'src', f), 'utf8');
      expect(text, f).not.toMatch(/export (async )?function/);
    }
    const paint = readFileSync(join(layout, 'src', 'paint.ts'), 'utf8');
    expect([...paint.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])).toEqual(PAINT_FUNCTIONS);
    const shape: BoxShape = { left: 0, top: 0, right: 10, bottom: 10, borders: [0, 0, 0, 0], radii: [0, 0, 0, 0, 0, 0, 0, 0] };
    expect(shape.radii).toHaveLength(8);
  });
  it('index.ts exports the paint seam with one line, and each filled seam with its own lines', () => {
    const lines = readFileSync(join(layout, 'src/index.ts'), 'utf8').split('\n').filter((l) => l.includes("'./paint"));
    expect(lines).toEqual([
      "export type { BoxShape } from './paint.ts';",
      "export { opacityAlpha8 } from './paint.ts';",
      "export type { RadiusFaults, RadiusLength } from './paint-radius.ts';",
      "export { hasRoundedCorner, NO_RADIUS_FAULTS, outlineOffsetPx, outlineRings, outlineWidthPx, roundedShape } from './paint-radius.ts';",
      "export type { BackdropFill, ShadowFaults, ShadowInput, ShadowLayer, ShadowShape } from './paint-shadow.ts';",
      "export { insetShadowLayer, insetShadowLayerOver, NO_SHADOW_FAULTS, outerShadowLayer, outerShadowLayerOver } from './paint-shadow.ts';",
      "export type { BorderOp, BorderOpKind, DashFaults } from './paint-dash.ts';",
      "export { borderNeedsSidePainter, borderPaintOps, NO_DASH_FAULTS, selectBestDashGap } from './paint-dash.ts';",
    ]);
  });
  it('every feature no package has filled has an empty paint-vectors suite', () => {
    for (const f of STUBS) {
      const v = JSON.parse(readFileSync(join(layout, 'paint-vectors', f, 'vectors.json'), 'utf8')) as { feature: string; cases: number; lines: unknown[]; expected: unknown[] };
      expect(v, f).toMatchObject({ feature: f, cases: 0, lines: [], expected: [] });
    }
  });
});
