// The sweep's Chrome session serves overlapping calls on its pages: each verdict equals the one-page session's, in any order.
import { describe, expect, it } from 'vitest';
import { openChrome } from '../src/chrome.ts';
import { fixtureHtml } from '../src/dragon.ts';
import { flatten } from '../src/flatten.ts';
import { publishedCss } from '../src/tailwind.ts';

describe('the sweep Chrome session', () => {
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
