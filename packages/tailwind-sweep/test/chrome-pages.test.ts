// The sweep's Chrome session serves overlapping calls on its pages: each verdict equals the one-page session's, in any order.
import { describe, expect, it } from 'vitest';
import { launchChrome } from '../../parity/src/chrome.ts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FONT_WAIT_MS, fromPageJson, openChrome } from '../src/chrome.ts';
import { fixtureHtml } from '../src/dragon.ts';
import { flatten } from '../src/flatten.ts';
import { publishedCss } from '../src/tailwind.ts';

describe('the sweep Chrome session', () => {
  it('reads a page result from its tagged JSON string exactly as Playwright returns the value itself, -0, NaN and infinities included', async () => {
    const value = `[{ id: 'u', box: [-0, 0, NaN, Infinity, -Infinity, 0.1 + 0.2, -1.5e-7], computed: [['a', 'x\\ud800y'], ['b', '\\u00e9\\u{1F600}']] }]`;
    const tagged = `JSON.stringify(${value}, (k, v) => typeof v === 'number' && (Object.is(v, -0) || !Number.isFinite(v)) ? { __dragonNumber: Object.is(v, -0) ? '-0' : String(v) } : v)`;
    const browser = await launchChrome();
    try {
      const page = await browser.newPage();
      const direct = await page.evaluate(value);
      const viaJson = fromPageJson(await page.evaluate(tagged));
      expect(viaJson).toEqual(direct);
      const box = (viaJson as { box: number[] }[])[0]!.box;
      expect(Object.is(box[0], -0)).toBe(true);
      expect(Object.is(box[1], 0)).toBe(true);
    } finally {
      await browser.close();
    }
    expect(() => fromPageJson([1])).toThrow(/not a JSON string/);
    expect(() => fromPageJson('[{"__dragonNumber":"7"}]')).toThrow(/unknown number/);
  }, 60_000);

  it('measures ch and ex on Ahem, not a fallback font, on 8 cold pages at once', async () => {
    // Ahem: 1ch = 1em and 1ex = 0.8em at the 16px root, so these equal the px sides only once Ahem has loaded.
    const doc = (css: string): string => fixtureHtml(['u'], `.u { ${css} }\n`);
    const pairs = Array.from({ length: 16 }, (_, i) => ({ key: `k${i}`, authoredHtml: doc(`width: ${i + 1}ch; height: ${(i + 1) * 5}ex`), compiledHtml: doc(`width: ${(i + 1) * 16}px; height: ${(i + 1) * 64}px`) }));
    const chrome = await openChrome(8);
    try {
      const out = await Promise.all(pairs.map((p) => chrome.dual(p)));
      // Only the boxes are compared here: the computed width and height keep their authored units.
      expect(out.map((problems) => problems.filter((x) => x.includes(': box '))), 'a box measured on a fallback font').toEqual(pairs.map(() => []));
    } finally {
      await chrome.close();
    }
  }, 120_000);

  it('fails a capture whose fonts are still loading after FONT_WAIT_MS, rather than measuring a fallback font or hanging', async () => {
    // A font server that accepts the request and never answers keeps the page's FontFaceSet loading.
    const server = createServer(() => {});
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    // The font starts loading at the load event, so setContent returns and the capture's own wait is what meets it.
    const hang = `<script>addEventListener('load', () => { const f = new FontFace('Hang', 'url(http://127.0.0.1:${port}/hang.ttf)'); document.fonts.add(f); f.load(); });</script>`;
    const html = fixtureHtml(['u'], '.u { font-family: Hang; }\n').replace('</head>', `${hang}</head>`);
    const chrome = await openChrome(1);
    const t = Date.now();
    try {
      await expect(chrome.dual({ key: 'hang', authoredHtml: html, compiledHtml: html })).rejects.toThrow(/fonts are "still loading after 10000 ms", not loaded/);
      expect(Date.now() - t).toBeGreaterThanOrEqual(FONT_WAIT_MS);
    } finally {
      await chrome.close();
      server.closeAllConnections();
      server.close();
    }
  }, 60_000);

  it('rejects a page count that is not a whole number of at least 1', async () => {
    await expect(openChrome(0)).rejects.toThrow(/whole number of pages/);
    await expect(openChrome(1.5)).rejects.toThrow(/whole number of pages/);
  });

  it('gives overlapping calls on 3 pages the verdicts of one page, called one at a time', async () => {
    const cases = await Promise.all(
      ['flex', 'p-4', 'hidden', 'grid', 'mt-2', 'block'].map(async (u) => {
        const css = await publishedCss([u]);
        // Every other case planted: the compiled side loses its rule, so Chrome sees a difference.
        const compiled = u.length % 2 === 0 ? flatten(css).css : '';
        return { key: u, authoredHtml: fixtureHtml([u], css), compiledHtml: fixtureHtml([u], compiled) };
      }),
    );
    const conditions = ['display: flex', 'display: flexx', 'selector(:hover)', 'selector(::nope)'];
    const one = await openChrome(1);
    let sequential: { duals: string[][]; parses: boolean[] };
    try {
      const duals: string[][] = [];
      for (const c of cases) duals.push(await one.dual(c));
      const parses: boolean[] = [];
      for (const c of conditions) parses.push(await one.supports(c));
      sequential = { duals, parses };
    } finally {
      await one.close();
    }
    const three = await openChrome(3);
    try {
      expect(three.pages).toBe(3);
      const [duals, parses] = await Promise.all([Promise.all(cases.map((c) => three.dual(c))), Promise.all(conditions.map((c) => three.supports(c)))]);
      expect({ duals, parses }).toEqual(sequential);
    } finally {
      await three.close();
    }
    expect(sequential.duals.some((d) => d.length > 0)).toBe(true);
    expect(sequential.duals.some((d) => d.length === 0)).toBe(true);
    expect(sequential.parses).toEqual([true, false, true, false]);
  }, 120_000);
});
