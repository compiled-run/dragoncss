import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import {
  band,
  bandAt,
  evaluateInBand,
  evaluateMediaQueryList,
  MAX_BANDS,
  NO_MEDIA_FAULTS,
  parseMediaPrelude,
  parseMediaQueryList,
  serialiseMediaQueryList,
} from '../../src/media/index.ts';
import { compareCapture } from './compare.ts';
import { chromeNumber } from './chrome-number.ts';
import { CAPTURE as capture, CORPUS, QUERIES } from './corpus.ts';

describe('media queries against Chrome 145 matchMedia', () => {
  it('is captured on Chrome 145.0.7632.6 over the whole corpus, with the root at 16px and 20px', () => {
    expect(capture.chrome).toBe('145.0.7632.6');
    expect(capture.roots).toEqual([16, 20]);
    expect(capture.queries.map((q) => q.query)).toEqual(QUERIES);
    expect(capture.bands.map((b) => b.sheet)).toEqual(CORPUS.bandSheets.filter((s) => s.refused === undefined).map((s) => s.name));
  });

  it('writes numbers exactly by default, so a serialised threshold evaluates as the authored one', () => {
    const list = parseMediaQueryList('(max-width: 1234.5678px) and (min-width: calc(1e-7px + 10em))');
    expect(serialiseMediaQueryList(list)).toBe('(max-width: 1234.5678px) and (min-width: calc(10em + 1e-7px))');
    expect(serialiseMediaQueryList(list, chromeNumber)).toBe('(max-width: 1234.57px) and (min-width: calc(10em + 1e-07px))');
  });

  it('matches every captured mediaText, matchMedia result and band', () => {
    const r = compareCapture(capture, NO_MEDIA_FAULTS);
    expect(r.mismatches).toEqual([]);
    expect(r.comparisons).toBeGreaterThan(40_000);
  });

  it('refuses exactly the environment features and the values Dragon does not evaluate', () => {
    const r = compareCapture(capture, NO_MEDIA_FAULTS);
    expect(r.refused).toEqual(CORPUS.refusedQueries);
    const hover = evaluateMediaQueryList(parseMediaQueryList('(max-width: 600px), (hover)'), { width: 400, height: 300 });
    expect(hover).toEqual({ kind: 'refused', refusals: [{ feature: '(hover)', reason: 'environment' }] });
  });

  it('treats em and rem in a media query as the initial 16px, whatever the root', () => {
    const list = parseMediaQueryList('(max-width: 25em)');
    expect(evaluateMediaQueryList(list, { width: 400, height: 300, rootFontSize: 20 })).toEqual({ kind: 'matches', matches: true });
    expect(evaluateMediaQueryList(list, { width: 401, height: 300, rootFontSize: 20 })).toEqual({ kind: 'matches', matches: false });
  });

  it('parses an @media prelude from css-tree, raw or parsed', () => {
    const css = '@media screen and (max-width: 768px), (400px <= width < 700px) { a { color: red } }';
    for (const parseAtrulePrelude of [false, true]) {
      const options = { positions: false, parseAtrulePrelude };
      const sheet = parse(css, options) as unknown as { children: { toArray(): { prelude: CssNode }[] } };
      const rule = sheet.children.toArray()[0] as { prelude: CssNode };
      expect(serialiseMediaQueryList(parseMediaPrelude(rule.prelude))).toBe('screen and (max-width: 768px), (400px <= width < 700px)');
    }
  });
});

describe('band partition', () => {
  it('derives the north-star bands from the authored atoms and their negations', () => {
    const p = band(['screen and (max-width: 768px)', 'screen and (max-width: 640px)'].map((q) => parseMediaQueryList(q)));
    if (p.kind !== 'bands') throw new Error(p.detail);
    expect(p.bands.map((b) => b.condition)).toEqual([
      '(max-width: 768px) and (max-width: 640px)',
      '(max-width: 768px) and (not (max-width: 640px))',
      '(not (max-width: 768px)) and (not (max-width: 640px))',
    ]);
    expect(bandAt(p, { width: 640, height: 300 })?.index).toBe(0);
    expect(bandAt(p, { width: 768, height: 300 })?.index).toBe(1);
    expect(bandAt(p, { width: 769, height: 300 })?.index).toBe(2);
  });

  it('refuses the sheets it cannot partition, with a typed reason', () => {
    for (const sheet of CORPUS.bandSheets.filter((s) => s.refused !== undefined)) {
      const p = band(sheet.queries.map((q) => parseMediaQueryList(q)));
      expect(p.kind === 'refused' ? p.reason : 'bands', sheet.name).toBe(sheet.refused);
    }
    expect(MAX_BANDS).toBe(16);
  });

  it('evaluates each sheet list in a band exactly as at every captured viewport inside it', () => {
    for (const sheet of CORPUS.bandSheets.filter((s) => s.refused === undefined)) {
      const lists = sheet.queries.map((q) => parseMediaQueryList(q));
      const p = band(lists);
      if (p.kind !== 'bands') throw new Error(p.detail);
      for (const [width, height] of capture.points) {
        const b = bandAt(p, { width, height });
        if (b === null) throw new Error(`${sheet.name}: ${width}x${height} is in no band`);
        for (const list of lists) expect(evaluateInBand(list, p, b), `${sheet.name} ${width}x${height}`).toEqual(evaluateMediaQueryList(list, { width, height }));
      }
    }
  });
});

describe('media module', () => {
  it('is pure TypeScript with no node: imports', () => {
    const dir = new URL('../../src/media/', import.meta.url);
    for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(/from 'node:/);
  });

  it('folds names ASCII case-insensitively: U+212A KELVIN SIGN stays, as in Chrome 145 matchMedia().media (probed)', () => {
    const cases = [['(prefers-color-scheme: dar\u212a)', '(prefers-color-scheme: dar\u212a)'], ['A\u212a', 'a\u212a'], ['A\u212a and (width > 1px)', 'a\u212a and (width > 1px)'], ['(prefers-color-scheme: DARK)', '(prefers-color-scheme: dark)'], ['SCREEN', 'screen']];
    for (const [query, chrome] of cases) expect(serialiseMediaQueryList(parseMediaQueryList(query as string)), query).toBe(chrome);
  });
});
