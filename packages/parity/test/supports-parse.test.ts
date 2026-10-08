// CASC: @supports decisions against Chrome 145 itself. Every condition Dragon decides (css/at-rules/supports.ts) must equal
// CSS.supports in the pinned Chrome, and the legacy values Chrome keeps but the grammar lacks must stay undecided (refused).
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LONGHANDS } from 'dragon';
import { evaluateSupports, parseSupportsCondition } from '../../dragon/src/css/at-rules/supports.ts';
import { grammarKeywords } from '../../dragon/src/css/stylesheet.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

let browser: Browser;

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});

afterAll(async () => {
  await browser.close();
});

/** Conditions Dragon decides: proven kept and dropped values, grammar-only invalid forms, operators, custom properties and var(). */
const DECIDED = [
  '(display: flex)', '(display: block)', '(display: none)', '(display: grid flex)', '(width: 10px)', '(width: 50%)', '(height: auto)',
  '(position: relative)', '(overflow: hidden)', '(text-align: center)', '(width: 1px 2px)', '(color: 12px)', '(margin-left: auto auto)',
  '(overflow: hidden hidden hidden)', '(color: red !important)', '(--x: 1)', '(--x:)', '(width: var(--w))', '(grid-template-columns: 1fr)',
  '(aspect-ratio: 16 / 9)', '(inset: 1px)', '(margin-inline-start: 4px)', '(DISPLAY: Flex)', '((display: block))', '(not (display: block))',
  'not (color: 12px)', '(display: flex) and (width: 10px)', '(display: flex) and (color: 12px)', '(width: 1px 2px) or (margin-left: 3px)',
  '(margin-left: auto auto) or (color: 12px)', '(grid-template-columns: 1fr) and (not (width: 1px 2px))',
];

/** Legacy values the grammar rejects; Chrome 145 keeps most of them, so Dragon must not decide any. */
const LEGACY = ['overflow: overlay', 'height: -webkit-fill-available', 'width: -webkit-fit-content', 'width: -webkit-min-content', 'text-align: -webkit-center', 'text-align: -webkit-left', 'color: -webkit-link', 'position: -webkit-sticky'];

/** Grammar-valid values Chrome 145 has not shipped (CSS.supports false). */
const UNSHIPPED = ['text-align: match-parent', 'text-align: justify-all'];

const decide = (c: string): boolean | 'undecided' => {
  const p = parseSupportsCondition(c);
  if (typeof p === 'string') return 'undecided';
  const v = evaluateSupports(p);
  return typeof v === 'string' ? 'undecided' : v;
};

describe('@supports against Chrome 145', () => {
  it('every condition Dragon decides equals CSS.supports in the pinned Chrome', async () => {
    const page = await browser.newPage();
    const chrome = await page.evaluate((cs) => cs.map((c) => CSS.supports(c)), DECIDED);
    await page.close();
    const dragon = DECIDED.map(decide);
    expect(dragon.filter((d) => d === 'undecided')).toEqual([]);
    expect(Object.fromEntries(DECIDED.map((c, i) => [c, dragon[i]]))).toEqual(Object.fromEntries(DECIDED.map((c, i) => [c, chrome[i]])));
    // Both outcomes are exercised.
    expect(chrome).toContain(true);
    expect(chrome).toContain(false);
  });

  it('grammar-valid values Chrome 145 has not shipped stay undecided, and Chrome rejects them', async () => {
    const page = await browser.newPage();
    const chrome = await page.evaluate((ds) => ds.map((d) => CSS.supports(`(${d})`)), UNSHIPPED);
    await page.close();
    for (const d of UNSHIPPED) expect(decide(`(${d})`), d).toBe('undecided');
    expect(chrome).toEqual(UNSHIPPED.map(() => false));
  });

  it('a value whose grammar names an undefined type (calc-size) is undecided, and Chrome keeps it', async () => {
    const page = await browser.newPage();
    const chrome = await page.evaluate(() => CSS.supports('(width: calc-size(auto, size))'));
    await page.close();
    expect(decide('(width: calc-size(auto, size))')).toBe('undecided');
    expect(chrome).toBe(true);
  });

  it('every grammar keyword of every longhand that Dragon decides, decides as Chrome does', async () => {
    const conds = LONGHANDS.flatMap((p) => [...(grammarKeywords(p) ?? [])].map((k) => `(${p}: ${k})`));
    const decided = conds.map((c) => [c, decide(c)] as const).filter(([, d]) => d !== 'undecided');
    const page = await browser.newPage();
    const chrome = await page.evaluate((cs) => cs.map((c) => CSS.supports(c)), decided.map(([c]) => c));
    await page.close();
    expect(Object.fromEntries(decided)).toEqual(Object.fromEntries(decided.map(([c], i) => [c, chrome[i]])));
    expect(decided.length).toBeGreaterThan(50);
  });

  it('the legacy values stay undecided, and Chrome keeps at least one of them (so deciding them false would be wrong)', async () => {
    const page = await browser.newPage();
    const chrome = await page.evaluate((ds) => ds.map((d) => CSS.supports(`(${d})`)), LEGACY);
    await page.close();
    for (const d of LEGACY) expect(decide(`(${d})`), d).toBe('undecided');
    expect(chrome.filter((k) => k).length).toBeGreaterThan(0);
  });
});
