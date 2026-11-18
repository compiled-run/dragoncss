// A tree laid out where it is not the page: a system sheet's content area, sized per target by the input's `viewports`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import { EXPORT_DEVICES } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/attributes.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const SHEET = { ios: { width: 386, height: 418 }, android: { width: 1080 / 2.625, height: 975 / 2.625 } };
const withViewports = (viewports: unknown): string => JSON.stringify({ ...JSON.parse(TEXT), viewports });
const widest = (exported: ReturnType<typeof marklessStyleExport>['exported'], t: 'ios' | 'android'): number =>
  Math.max(...exported.targets[t]!.assignments[0]!.nodes.map((n) => n.frame?.width ?? 0));

describe('viewports in a Markless style input', () => {
  const page = marklessStyleExport(TEXT, PATH).exported;
  const sheet = marklessStyleExport(withViewports(SHEET), PATH).exported;

  it('lays each target out in its own size and records it', () => {
    for (const t of ['ios', 'android'] as const) {
      expect(page.targets[t]!.viewport).toEqual(EXPORT_DEVICES[t].viewport);
      expect(sheet.targets[t]!.viewport).toEqual(SHEET[t]);
      expect(sheet.targets[t]!.dpr).toBe(EXPORT_DEVICES[t].dpr);
      // Within one device pixel: the engine snaps boxes to device pixels.
      expect(Math.abs(widest(sheet, t) - SHEET[t].width * EXPORT_DEVICES[t].dpr)).toBeLessThanOrEqual(1);
      expect(Math.abs(widest(page, t) - EXPORT_DEVICES[t].viewport.width * EXPORT_DEVICES[t].dpr)).toBeLessThanOrEqual(1);
    }
  });

  it('refuses a size for only one target, or one that is not a positive size', () => {
    expect(() => marklessStyleExport(withViewports({ ios: SHEET.ios }), PATH)).toThrow(/one size per target/);
    expect(() => marklessStyleExport(withViewports({ ...SHEET, android: { width: 0, height: 10 } }), PATH)).toThrow(/viewports.android is not a positive/);
  });
});
