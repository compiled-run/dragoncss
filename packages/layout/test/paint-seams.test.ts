// EMS (notes/T046-paint-spec.md §3 items 4 and 5): the engine's paint seam files exist, export no function yet (so they add no
// engine root), and each has an empty paint-vectors suite that pnpm run layout:paint-vectors writes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoxShape } from '../src/index.ts';

const layout = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURES = ['radius', 'shadow', 'gradient', 'transform', 'dash', 'scrollbar'];

describe('EMS: engine paint seams', () => {
  it('paint.ts and the six paint-<feature>.ts stubs exist; only paint.ts exports a function, REPL-a replacedPaint', () => {
    for (const f of FEATURES.map((x) => `paint-${x}.ts`)) {
      const text = readFileSync(join(layout, 'src', f), 'utf8');
      expect(text, f).not.toMatch(/export (async )?function/);
    }
    // REPL-a fills the seam with one engine root: the replaced image's paint rects, which the device runs after layout.
    expect([...readFileSync(join(layout, 'src/paint.ts'), 'utf8').matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])).toEqual(['replacedPaint']);
    const shape: BoxShape = { left: 0, top: 0, right: 10, bottom: 10, borders: [0, 0, 0, 0], radii: [0, 0, 0, 0, 0, 0, 0, 0] };
    expect(shape.radii).toHaveLength(8);
  });
  it('index.ts exports the paint seam: BoxShape and the REPL-a root', () => {
    const lines = readFileSync(join(layout, 'src/index.ts'), 'utf8').split('\n').filter((l) => l.includes("'./paint"));
    // REPL-a adds the replacedPaint root and its result type beside the seam's BoxShape.
    expect(lines).toEqual(["export type { ReplacedPaint } from './paint.ts';", "export { replacedPaint } from './paint.ts';", "export type { BoxShape } from './paint.ts';"]);
  });
  it('every feature has an empty paint-vectors suite', () => {
    for (const f of FEATURES) {
      const v = JSON.parse(readFileSync(join(layout, 'paint-vectors', f, 'vectors.json'), 'utf8')) as { feature: string; cases: number; lines: unknown[]; expected: unknown[] };
      expect(v, f).toMatchObject({ feature: f, cases: 0, lines: [], expected: [] });
    }
  });
});
