import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import {
  band,
  bandAt,
  compareMedia,
  emulatedDevicePx,
  emulatedMediaViewport,
  evaluateInBand,
  evaluateMediaQueryList,
  iframeDevicePx,
  MAX_BANDS,
  MEDIA_EPSILON,
  mediaSize,
  NO_MEDIA_FAULTS,
  parseMediaPrelude,
  parseMediaQueryList,
  serialiseMediaQueryList,
} from '../../src/media/index.ts';
import { compareCapture, frameViewport } from './compare.ts';
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
    const scheme = evaluateMediaQueryList(parseMediaQueryList('(max-width: 600px), (prefers-color-scheme: dark)'), { width: 400, height: 300 });
    expect(scheme).toEqual({ kind: 'refused', refusals: [{ feature: '(prefers-color-scheme: dark)', reason: 'environment' }] });
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

describe('MQ-R0: Chrome 145 at fractional media sizes (notes/T067 R2, R3)', () => {
  const frac = capture.fractional;
  const frameIndex = (kind: 'iframe' | 'main', width: number, height: number, dpr: number): number => {
    const k = frac.frames.findIndex((f) => f[0] === kind && f[1] === width && f[2] === height && f[3] === dpr);
    if (k < 0) throw new Error(`no captured ${kind} ${width}x${height} at DPR ${dpr}`);
    return k;
  };
  const chrome = (query: string, k: number): boolean => {
    const row = frac.queries.find((q) => q.query === query);
    if (row === undefined) throw new Error(`${query} is not captured`);
    return row.matches[k] === '1';
  };

  it('captures every fractional query and band sheet of the corpus, one bit per frame', () => {
    expect(frac.queries.map((q) => q.query)).toEqual(CORPUS.fractional.queries);
    expect(frac.bands.map((b) => b.sheet)).toEqual(CORPUS.fractional.bandSheets.map((s) => s.name));
    for (const [w, h, dpr] of CORPUS.fractional.iframes) frameIndex('iframe', w, h, dpr);
    for (const [w, h, dpr] of CORPUS.fractional.mainFrames) frameIndex('main', w, h, dpr);
    for (const dpr of [1, 2, 2.625, 3]) expect(frac.frames.some((f) => f[3] === dpr && f[0] === 'iframe'), `DPR ${dpr}`).toBe(true);
  });

  it('M2: <=, >= and = allow 1/64 px at a 640 px root; < and > are exact', () => {
    const k = frameIndex('iframe', 640, 300, 1);
    for (const q of ['(max-width: 639.99px)', '(max-width: 639.984375px)', '(min-width: 640.01px)', '(min-width: 640.015625px)', '(width: 640.01px)', '(width: 639.99px)', '(width <= 639.99px)', '(639.99px >= width)', '(width > 639.99px)', '(width < 640.01px)']) {
      expect(chrome(q, k), q).toBe(true);
    }
    for (const q of ['(max-width: 639.98px)', '(min-width: 640.02px)']) expect(chrome(q, k), q).toBe(false);
    expect([compareMedia(640, '<=', 640 - MEDIA_EPSILON), compareMedia(640, '<=', 640 - 2 * MEDIA_EPSILON), compareMedia(640, '>', 639.99), compareMedia(640, '<', 640)]).toEqual([true, false, true, false]);
  });

  it('M3: orientation and aspect-ratio read whole px, and a square is portrait', () => {
    for (const [w, h, dpr] of [[801, 800, 2], [1202, 1201, 3]] as const) {
      const k = frameIndex('iframe', w, h, dpr);
      expect([chrome('(orientation: portrait)', k), chrome('(aspect-ratio: 1/1)', k)], `${w}x${h}@${dpr}`).toEqual([true, true]);
    }
    expect(chrome('(orientation: landscape)', frameIndex('iframe', 1203, 1201, 3))).toBe(true);
    expect(chrome('(min-aspect-ratio: 2/1)', frameIndex('iframe', 1921, 961, 3))).toBe(true);
  });

  it('M4: the media width of 1080 device px at DPR 2.625 is fround(fround(1080) * fround(1 / 2.625))', () => {
    expect(mediaSize(1080, 2.625)).toBe(411.4285888671875);
    const k = frameIndex('iframe', 1080, 2208, 2.625);
    expect([chrome('(width > 411.4285888px)', k), chrome('(width < 411.4285889px)', k), chrome('(height > 841.1428833px)', k)]).toEqual([true, true, true]);
    expect(1080 / 2.625).not.toBe(mediaSize(1080, 2.625));
  });

  it('M5: an emulated main frame rounds its device px up, so 400x300 at DPR 2.625 is 400 x 300.19', () => {
    expect([emulatedDevicePx(402, 2.625), emulatedDevicePx(300, 2.625), emulatedDevicePx(400, 3)]).toEqual([1056, 788, 1200]);
    expect(emulatedMediaViewport({ width: 400, height: 300 }, 2.625).height).toBeCloseTo(300.1905, 4);
    expect(chrome('(width > 402px)', frameIndex('main', 402, 300, 2.625))).toBe(true);
    expect(chrome('(height > 300px)', frameIndex('main', 400, 300, 2.625))).toBe(true);
    expect(chrome('(height > 300px)', frameIndex('main', 400, 300, 3))).toBe(false);
  });

  it('M1: an iframe snaps to whole device px, rounding half up', () => {
    expect([iframeDevicePx(640.5, 3), iframeDevicePx(640.25, 2), iframeDevicePx(640.5, 2.625), iframeDevicePx(1080 / 2.625, 2.625)]).toEqual([1922, 1281, 1681, 1080]);
  });

  it('a negative query value is false except for > and >=, even at a zero-size frame', () => {
    const k = frameIndex('iframe', 0, 300, 1);
    for (const q of ['(max-width: -0.01px)', '(width: -0.01px)', '(width <= -0.01px)', '(-0.01px >= width)']) expect(chrome(q, k), q).toBe(false);
    for (const q of ['(min-width: -0.01px)', '(width > -0.01px)', '(-0.01px < width)', '(max-width: 0.01px)', '(min-width: 0.01px)']) expect(chrome(q, k), q).toBe(true);
  });

  it('every frame is evaluated at its own media size', () => {
    for (const f of frac.frames) {
      const v = frameViewport(f, NO_MEDIA_FAULTS);
      expect(v.width >= 0 && v.height >= 0, String(f)).toBe(true);
    }
    expect(() => frameViewport(['other' as 'iframe', 1, 1, 1], NO_MEDIA_FAULTS)).toThrow(/unknown frame kind/);
    expect(() => mediaSize(10.5, 2)).toThrow(/whole device px/);
    expect(() => mediaSize(10, 0)).toThrow(/positive/);
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

  it('MQ-R0: orientation and aspect-ratio add a ratio factor, and a truth vector no whole-px size reaches is dropped', () => {
    const p = band(['(max-width: 300px)', '(min-height: 600px)', '(orientation: landscape)'].map((q) => parseMediaQueryList(q)));
    if (p.kind !== 'bands') throw new Error(p.detail);
    expect(p.atoms.map((a) => a.axis)).toEqual(['width', 'height', 'ratio']);
    expect(p.bands.map((b) => b.truth.map(Number).join(''))).toEqual(['101', '100', '110', '001', '000', '011', '010']);
    expect(bandAt(p, { width: 300.01, height: 299 })?.truth).toEqual([true, false, true]);
    expect(bandAt(p, { width: 300.01, height: 300.9 })?.truth).toEqual([true, false, false]);
    const square = band([parseMediaQueryList('(orientation: portrait)'), parseMediaQueryList('(orientation: landscape)')]);
    expect(square.kind === 'bands' ? square.bands.map((b) => b.condition) : square).toEqual([
      '(orientation: portrait) and (not (orientation: landscape))',
      '(not (orientation: portrait)) and (orientation: landscape)',
    ]);
  });

  it('MQ-R0: a band end sits 1/64 px past a max-width threshold, and keeps the authored threshold as its nominal end', () => {
    const p = band([parseMediaQueryList('(max-width: 400px)'), parseMediaQueryList('(width: 500px)')]);
    if (p.kind !== 'bands') throw new Error(p.detail);
    const ends = p.bands.flatMap((b) => b.width.map((i) => [i.lo, i.hi, i.nominalLo, i.nominalHi]));
    expect(ends).toEqual([[0, 400.015625, 0, 400], [400.015625, 499.984375, 400, 500], [500.015625, Infinity, 500, Infinity], [499.984375, 500.015625, 500, 500]]);
    expect(bandAt(p, { width: 400.015625, height: 1 })?.index).toBe(0);
    expect(bandAt(p, { width: 400.02, height: 1 })?.index).toBe(1);
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
    for (const sheet of CORPUS.fractional.bandSheets) {
      const lists = sheet.queries.map((q) => parseMediaQueryList(q));
      const p = band(lists);
      if (p.kind !== 'bands') throw new Error(p.detail);
      for (const f of capture.fractional.frames) {
        const v = frameViewport(f, NO_MEDIA_FAULTS);
        const b = bandAt(p, v);
        if (b === null) throw new Error(`${sheet.name}: ${String(f)} is in no band`);
        for (const list of lists) expect(evaluateInBand(list, p, b), `${sheet.name} ${String(f)}`).toEqual(evaluateMediaQueryList(list, v));
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
