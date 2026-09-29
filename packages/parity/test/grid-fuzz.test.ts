// The grid differential fuzzer (PR #23 round 4): 3000 seeded grid-family declarations (packages/parity/test/grid-fuzz/generate.ts,
// committed as packages/dragon/test/data/grid-fuzz-corpus.json), each compared with the pinned Chrome through the whole parse driver
// and through the grid hook alone. Every disagreement must be a documented refusal or gap; a bug fails the suite. Two plants, an
// accept-everything hook and an invalid-everything hook, must each be caught.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRID_FUZZ_COUNT, GRID_FUZZ_SEED, generateGridDeclarations } from './grid-fuzz/generate.ts';
import type { ChromeSeen, FuzzItem } from './grid-fuzz/compare.ts';
import { chromeExpression, documentedGap, fuzzItem, report } from './grid-fuzz/compare.ts';

type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };
const load = async <T>(file: string): Promise<T> => (await import(new URL(`../src/${file}`, import.meta.url).href)) as T;

const corpus = JSON.parse(readFileSync(new URL('../../dragon/test/data/grid-fuzz-corpus.json', import.meta.url), 'utf8')) as { seed: number; count: number; declarations: [string, string][] };

describe('grid differential fuzzer against Chrome 145', () => {
  it('the committed corpus is the generator\'s output for the pinned seed', () => {
    expect({ seed: corpus.seed, count: corpus.count }).toEqual({ seed: GRID_FUZZ_SEED, count: GRID_FUZZ_COUNT });
    expect(corpus.declarations).toEqual(generateGridDeclarations());
  });

  it('every declaration agrees with Chrome, or is a documented refusal or gap, through the driver and through the hook alone; the plants are caught', async () => {
    const items = corpus.declarations.map(fuzzItem);
    const acceptEverything: FuzzItem[] = items.filter((it) => it.hook !== null && it.hook.kind === 'invalid').map((it) => ({ ...it, hook: { kind: 'ok', longhands: [[it.p, it.v]] } }));
    const invalidEverything: FuzzItem[] = items.filter((it) => it.hook !== null && it.hook.kind === 'ok' && !documentedGap(it.p, it.v)).map((it) => ({ ...it, hook: { kind: 'invalid' } }));
    const { launchChrome } = await load<{ launchChrome: () => Promise<Browser> }>('chrome.ts');
    const browser = await launchChrome();
    let seen: ChromeSeen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div id="a" style="font-size:10px"></div><div id="c" style="font-size:10px"></div>');
      seen = [];
      for (const set of [items, acceptEverything, invalidEverything]) seen.push((await page.evaluate(chromeExpression(set))) as ChromeSeen[]);
    } finally {
      await browser.close();
    }
    const r = report(items, seen[0] as ChromeSeen[]);
    expect(r.bugs).toEqual([]);
    expect(r.full).toEqual({ 'agree-accept': 914, 'agree-drop': 1859, 'refused-chrome-drops': 37, 'documented-refusal': 189, 'documented-gap': 1 });
    expect(r.hook).toEqual({ 'agree-accept': 845, 'agree-drop': 1152, 'refused-chrome-drops': 720, 'documented-refusal': 165 });
    const caught = (r2: ReturnType<typeof report>): number => Object.entries(r2.hook).filter(([k]) => k.startsWith('bug:')).reduce((n, [, c]) => n + c, 0);
    expect(caught(report(acceptEverything, seen[1] as ChromeSeen[]))).toBe(acceptEverything.length);
    expect(caught(report(invalidEverything, seen[2] as ChromeSeen[]))).toBe(invalidEverything.length);
  });
});
