// EMS (notes/T046-paint-spec.md §3 items 4 and 5): the engine's paint seam files exist, export no function yet (so they add no
// engine root), and each has an empty paint-vectors suite that pnpm run layout:paint-vectors writes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoxShape } from '../src/index.ts';

const layout = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURES = ['radius', 'shadow', 'gradient', 'transform', 'dash', 'scrollbar'];
/**
 * The seams a package has filled: dash by P6a (paint-dash.ts, its index.ts line and its vectors), transform by PNT2
 * (paint-transform.ts, its index.ts lines and its suite, packages/layout/test/paint-transform.test.ts), gradient by BG2
 * (paint-gradient.ts, its index.ts lines and its vectors), radius and shadow by PNT1 (paint-radius.ts and paint-shadow.ts, their index.ts lines and their vectors).
 */
const FILLED = ['dash', 'gradient', 'radius', 'shadow', 'transform'];
const STUBS = FEATURES.filter((f) => !FILLED.includes(f));

describe('EMS: engine paint seams', () => {
  it('paint.ts and the paint-<feature>.ts stubs no package has filled exist and export no function yet, but paint.ts\'s REPL-a root', () => {
    for (const f of FEATURES) readFileSync(join(layout, 'src', `paint-${f}.ts`), 'utf8');
    for (const f of STUBS.map((x) => `paint-${x}.ts`)) {
      const text = readFileSync(join(layout, 'src', f), 'utf8');
      expect(text, f).not.toMatch(/export (async )?function/);
    }
    // REPL-a fills the seam with one engine root: the replaced image's paint rects, which the device runs after layout; PNT1 adds
    // Skia's paint alpha byte of an opacity, which the device and the host share.
    expect([...readFileSync(join(layout, 'src/paint.ts'), 'utf8').matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])).toEqual(['replacedPaint', 'opacityAlpha8']);
    const shape: BoxShape = { left: 0, top: 0, right: 10, bottom: 10, borders: [0, 0, 0, 0], radii: [0, 0, 0, 0, 0, 0, 0, 0] };
    expect(shape.radii).toHaveLength(8);
  });
  it('index.ts exports the paint seam with one line, and each filled seam with its own lines', () => {
    const lines = readFileSync(join(layout, 'src/index.ts'), 'utf8').split('\n').filter((l) => l.includes("'./paint"));
    // REPL-a adds the replacedPaint root and its result type beside the seam's BoxShape; PNT1 adds opacityAlpha8 to its line.
    expect(lines).toEqual([
      "export type { ReplacedPaint } from './paint.ts';",
      "export { opacityAlpha8, replacedPaint } from './paint.ts';",
      "export type { BoxShape } from './paint.ts';",
      "export type { RadiusFaults, RadiusLength } from './paint-radius.ts';",
      "export { hasRoundedCorner, NO_RADIUS_FAULTS, outlineOffsetPx, outlineRings, outlineWidthPx, roundedShape } from './paint-radius.ts';",
      "export type { BackdropFill, ShadowFaults, ShadowInput, ShadowLayer, ShadowShape } from './paint-shadow.ts';",
      "export { insetShadowLayer, insetShadowLayerOver, NO_SHADOW_FAULTS, outerShadowLayer, outerShadowLayerOver } from './paint-shadow.ts';",
      "export type { BorderOp, BorderOpKind, DashFaults } from './paint-dash.ts';",
      "export { borderNeedsSidePainter, borderPaintOps, NO_DASH_FAULTS, selectBestDashGap } from './paint-dash.ts';",
      "export type { OriginPoint, TransformOrigin } from './paint-transform.ts';",
      "export { mapPoint, paintTransformMatrix, resolveTransformOrigin, transformAboutPoint, transformFunctionsMatrix } from './paint-transform.ts';",
      "export type { BackgroundBox, BackgroundLayer, BackgroundPaint, BackgroundPlan, CssStop, GradientFaults, GradientImage, LayerGeometry, LengthPct, StopColor } from './paint-gradient.ts';",
      "export { backgroundPixelExact, backgroundRow, gradientFaults, NO_GRADIENT_FAULTS, planBackground, referenceTileSize } from './paint-gradient.ts';",
    ]);
  });
  it('every feature no package has filled has an empty paint-vectors suite', () => {
    for (const f of STUBS) {
      const v = JSON.parse(readFileSync(join(layout, 'paint-vectors', f, 'vectors.json'), 'utf8')) as { feature: string; cases: number; lines: unknown[]; expected: unknown[] };
      expect(v, f).toMatchObject({ feature: f, cases: 0, lines: [], expected: [] });
    }
  });
});
