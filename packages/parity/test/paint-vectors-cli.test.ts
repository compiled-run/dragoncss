// The paint-vectors CLI (EMS): features come from the paint-<feature>.ts roots, a result that is not ok stops the write, and a
// directory no root names is refused, so the committed suites are exactly the features'.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { PAINT_VECTORS_DIR, paintFeatures, strayEntries, vectorsText } from '../src/cli/paint-vectors.ts';
import { repoPath } from '../src/paths.ts';

// Loaded at run time as the CLI does: translate/src is outside this package's project.
const { PAINT_ROOT_FILES } = (await import(pathToFileURL(repoPath('packages/translate/src/generate.ts')).href)) as { PAINT_ROOT_FILES: readonly string[] };

describe('layout:paint-vectors', () => {
  it('takes the features from the paint-<feature>.ts roots, in order, and paint.ts is not one', () => {
    expect(paintFeatures(['paint.ts', 'paint-radius.ts', 'paint-dash.ts', 'units.ts'])).toEqual(['radius', 'dash']);
  });
  it('refuses a result that is not ok, naming the line and the feature', () => {
    expect(() => vectorsText('dash', ['["paint:dash:x"]'], () => '["fail","no"]')).toThrow('paint vector ["paint:dash:x"] of dash gives ["fail","no"]');
    const text = vectorsText('dash', ['["paint:dash:x"]'], () => '["ok",1]');
    expect(JSON.parse(text)).toMatchObject({ feature: 'dash', cases: 1, lines: ['["paint:dash:x"]'], expected: ['["ok",1]'] });
  });
  it('names every directory no feature has, and the committed directory holds exactly the features', () => {
    expect(strayEntries(['dash', 'old', 'radius', 'Dash'], ['radius', 'dash'])).toEqual(['Dash', 'old']);
    const features = paintFeatures(PAINT_ROOT_FILES);
    expect(strayEntries(readdirSync(repoPath(PAINT_VECTORS_DIR)), features)).toEqual([]);
    expect(readdirSync(repoPath(PAINT_VECTORS_DIR)).sort()).toEqual([...features].sort());
  });
});
