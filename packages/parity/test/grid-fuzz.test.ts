// The grid differential fuzzer (PR #23 round 4): 3000 seeded grid-family declarations (packages/parity/test/grid-fuzz/generate.ts,
// committed as packages/dragon/test/data/grid-fuzz-corpus.json), each compared with the pinned Chrome through the whole parse driver
// and through the grid hook alone, and Dragon's computed text compared byte for byte with Chrome's computed string (numbers as Chrome
// displays them). Every disagreement must be a documented refusal or gap; a bug fails the suite. Three plants, an accept-everything
// hook, an invalid-everything hook and computed text keeping a unitless zero, must each be caught.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRID_FUZZ_COUNT, GRID_FUZZ_SEED, generateGridDeclarations } from './grid-fuzz/generate.ts';
import type { ChromeSeen, FuzzItem } from './grid-fuzz/compare.ts';
import { chromeExpression, documentedGap, fuzzItem, report, serializationProblems } from './grid-fuzz/compare.ts';

type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };
const load = async <T>(file: string): Promise<T> => (await import(new URL(`../src/${file}`, import.meta.url).href)) as T;

const corpus = JSON.parse(readFileSync(new URL('../../dragon/test/data/grid-fuzz-corpus.json', import.meta.url), 'utf8')) as { seed: number; count: number; declarations: [string, string][] };

const dataFile = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../dragon/test/data/${name}`, import.meta.url), 'utf8'));
const openChrome = async (): Promise<{ run: (set: readonly FuzzItem[]) => Promise<ChromeSeen[]>; close: () => Promise<void> }> => {
  const { launchChrome } = await load<{ launchChrome: () => Promise<Browser> }>('chrome.ts');
  const browser = await launchChrome();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><div id="a" style="font-size:10px"></div><div id="c" style="font-size:10px"></div>');
  return { run: async (set) => (await page.evaluate(chromeExpression(set))) as ChromeSeen[], close: () => browser.close() };
};

describe('grid differential fuzzer against Chrome 145', () => {
  it('the G-P corpus and edge declarations pass the hook-alone and byte-exact computed-text comparisons too', async () => {
    const corpusDecls = Object.entries((dataFile('grid-corpus-declarations.json') as { declarations: Record<string, string[]> }).declarations).flatMap(([p, vs]) => vs.map((v) => [p, v] as [string, string]));
    const edges = (dataFile('grid-edge-declarations.json') as { declarations: [string, string][] }).declarations;
    const items = [...corpusDecls, ...edges].map(fuzzItem);
    const chrome = await openChrome();
    try {
      const r = report(items, await chrome.run(items));
      expect(r.bugs).toEqual([]);
      expect(r.serialization).toBe(0);
    } finally {
      await chrome.close();
    }
  });

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
    expect(r.full).toEqual({ 'agree-accept': 883, 'agree-drop': 1898, 'refused-chrome-drops': 27, 'documented-refusal': 191, 'documented-gap': 1 });
    expect(r.hook).toEqual({ 'agree-accept': 817, 'agree-drop': 1160, 'refused-chrome-drops': 738, 'documented-refusal': 163 });
    expect(r.serialization).toBe(0);
    // Plant unitlessZero (PR #23 round 5): Dragon's computed text keeping a unitless zero is caught by the byte-exact comparison.
    const zeros = items.map((it, i) => [it, (seen[0] as ChromeSeen[])[i] as ChromeSeen] as const).filter(([it]) => it.resolved?.some((t) => /(^|[ (])0px/.test(t)) ?? false);
    expect(zeros.length).toBeGreaterThan(0);
    for (const [it, s] of zeros) expect(serializationProblems({ ...it, resolved: (it.resolved as string[]).map((t) => t.replace(/(^|[ (])0px/g, '$10')) }, s).length, `${it.p}: ${it.v}`).toBeGreaterThan(0);
    const caught = (r2: ReturnType<typeof report>): number => Object.entries(r2.hook).filter(([k]) => k.startsWith('bug:')).reduce((n, [, c]) => n + c, 0);
    expect(caught(report(acceptEverything, seen[1] as ChromeSeen[]))).toBe(acceptEverything.length);
    expect(caught(report(invalidEverything, seen[2] as ChromeSeen[]))).toBe(invalidEverything.length);
  });
});
