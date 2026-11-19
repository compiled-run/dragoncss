// A tree laid out where it is not the page: a system sheet's content area, sized per target by the input's `viewports`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MarklessStyleExport } from '../src/markless-style-input.ts';
import { marklessCompiledTargets, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import type { RootProbe } from '../src/markless-style-compare.ts';
import { checkCoverage } from '../src/markless-style-compare.ts';
import { checkBrowserPage, webColumn } from '../src/markless-web-column.ts';
import { EXPORT_DEVICES } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/attributes.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const SHEET = { ios: { width: 386, height: 418 }, android: { width: 411, height: 371 } };
const withViewports = (viewports: unknown): string => JSON.stringify({ ...JSON.parse(TEXT), viewports });
const system = (e: MarklessStyleExport): MarklessStyleExport => ({ ...e, fontMode: 'system' });
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
    expect(() => marklessStyleExport(withViewports({ ...SHEET, android: { width: 0, height: 10 } }), PATH)).toThrow(/viewports.android is not a \{ width, height \} of positive whole CSS px/);
    expect(() => marklessStyleExport(withViewports({ ...SHEET, android: { width: 411.5, height: 371 } }), PATH)).toThrow(/viewports.android is not a/);
  });

  it('the web column refuses an export laid out at another size than the input asks for, before it opens the device', async () => {
    await expect(webColumn(parseMarklessStyleInput(withViewports(SHEET)), system(page), { target: 'android', serial: 'no-device' })).rejects.toThrow('ios: viewport {"width":402,"height":778} at 3x is not the input\'s {"width":386,"height":418} at 3x');
    await expect(webColumn(parseMarklessStyleInput(TEXT), system(sheet), { target: 'android', serial: 'no-device' })).rejects.toThrow('ios: viewport {"width":386,"height":418} at 3x is not the input\'s {"width":402,"height":778} at 3x');
  });

  it('the web column refuses an export whose fonts are not the phone\'s system fonts, before it opens the device', async () => {
    await expect(webColumn(parseMarklessStyleInput(TEXT), page, { target: 'android', serial: 'no-device' })).rejects.toThrow('the export resolved fonts as pinned; the web column measures the phone\'s own system fonts');
  });

  it('the web column refuses a browser that lays the page out at another height, preference or used colour scheme than the export', () => {
    const t = sheet.targets.android!;
    const a = t.assignments[0]!;
    const probe: RootProbe = { vh: 371, viewportHeight: 371, innerHeight: 371, prefersDark: false, canvas: 'rgb(255, 255, 255)', lightCanvas: 'rgb(255, 255, 255)', darkCanvas: 'rgb(18, 18, 18)' };
    const check = (p: Partial<RootProbe>, innerWidth = 411.43): void => checkBrowserPage('android', t, a, { dpr: t.dpr, innerWidth, probe: { ...probe, ...p } }, 0);
    expect(() => check({})).not.toThrow();
    expect(() => check({ vh: 371.4, viewportHeight: 370.6 })).not.toThrow();
    expect(() => check({ vh: 818, viewportHeight: 818, innerHeight: 818 })).toThrow('android: the browser lays out 100vh at 818 and its viewport at 818 CSS px tall (innerHeight 818), the export at 371; use the export\'s proof device');
    expect(() => check({ vh: 818 })).toThrow('the browser lays out 100vh at 818 and its viewport at 371 CSS px tall');
    expect(() => check({ viewportHeight: 762 })).toThrow('the browser lays out 100vh at 371 and its viewport at 762 CSS px tall');
    expect(() => check({}, 380)).toThrow('android: the browser lays out 380 CSS px at 2.625x, the export 411 at 2.625x');
    expect(() => check({ prefersDark: true })).toThrow('android assignment 0: the browser prefers dark, and this assignment is laid out for light; set the device\'s appearance to light');
    expect(() => check({ canvas: 'rgb(18, 18, 18)' })).toThrow('android assignment 0: the browser\'s root uses the dark colour scheme, the export\'s colorScheme is light');
  });

  it('takes an export laid out at a phone\'s own size exactly when that size was asked for', async () => {
    const at = { viewport: { width: 412, height: 870 }, dpr: 2.625 };
    const both = { ios: at, android: at };
    const input = parseMarklessStyleInput(TEXT);
    const sized = marklessStyleExport(TEXT, PATH, undefined, 'system', both).exported;
    const compiled = marklessCompiledTargets(input, [], 'system', both);
    for (const t of ['ios', 'android'] as const) expect(() => checkCoverage(input, compiled[t], t, sized.targets[t]!)).not.toThrow();
    await expect(webColumn(input, sized, { target: 'android', serial: 'no-device' })).rejects.toThrow('ios: viewport {"width":412,"height":870} at 2.625x is not the input\'s {"width":402,"height":778} at 3x');
    const other = { viewport: { width: 412, height: 860 }, dpr: 2.625 };
    await expect(webColumn(input, sized, { target: 'android', serial: 'no-device' }, [], undefined, { kind: 'proof', at: { ios: other, android: other } })).rejects.toThrow('ios: viewport {"width":412,"height":870} at 2.625x is not the input\'s {"width":412,"height":860} at 2.625x');
    await expect(webColumn(input, system(page), { target: 'android', serial: 'no-device' }, [], undefined, { kind: 'proof', at: both })).rejects.toThrow('ios: viewport {"width":402,"height":778} at 3x is not the input\'s {"width":412,"height":870} at 2.625x');
  });

  it('checks the browser against the size the compared boxes were laid out at: the export\'s at size, the phone\'s, or none when scaled', () => {
    const at = { viewport: { width: 412, height: 870 }, dpr: 2.625 };
    const t = marklessStyleExport(TEXT, PATH, undefined, 'system', { ios: at, android: at }).exported.targets.android!;
    const a = t.assignments[0]!;
    const probe: RootProbe = { vh: 870, viewportHeight: 870, innerHeight: 800, prefersDark: false, canvas: 'rgb(255, 255, 255)', lightCanvas: 'rgb(255, 255, 255)', darkCanvas: 'rgb(18, 18, 18)' };
    const sized = { viewport: t.viewport, dpr: t.dpr, by: 'the export laid out at size', fix: 'lay the export out at this device\'s own size' };
    const check = (p: Partial<RootProbe>, laid: Parameters<typeof checkBrowserPage>[5], innerWidth = 412): void => checkBrowserPage('android', t, a, { dpr: 2.625, innerWidth, probe: { ...probe, ...p } }, 0, laid);
    expect(() => check({}, sized)).not.toThrow();
    expect(() => check({ vh: 818, viewportHeight: 818 }, sized)).toThrow('android: the browser lays out 100vh at 818 and its viewport at 818 CSS px tall (innerHeight 800), the export laid out at size at 870; lay the export out at this device\'s own size');
    expect(() => check({}, sized, 390)).toThrow('android: the browser lays out 390 CSS px at 2.625x, the export laid out at size 412 at 2.625x');
    const phone = { viewport: { width: 412, height: 818 }, dpr: 2.625, by: 'the phone', fix: 'measure on the device the phone drew on' };
    expect(() => check({}, phone)).toThrow('android: the browser lays out 100vh at 870 and its viewport at 870 CSS px tall (innerHeight 800), the phone at 818');
    expect(() => check({ vh: 818, viewportHeight: 818 }, phone)).not.toThrow();
    expect(() => check({ vh: 600, viewportHeight: 600 }, null, 300)).not.toThrow();
    expect(() => check({ prefersDark: true }, null)).toThrow('android assignment 0: the browser prefers dark, and this assignment is laid out for light');
    expect(() => check({ canvas: 'rgb(18, 18, 18)' }, null)).toThrow('android assignment 0: the browser\'s root uses the dark colour scheme, the export\'s colorScheme is light');
  });
});
