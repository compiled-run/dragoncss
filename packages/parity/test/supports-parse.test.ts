// CASC: @supports decisions against Chrome 145 itself. Every condition Dragon decides (css/at-rules/supports.ts) must equal
// CSS.supports in the pinned Chrome, and the legacy values Chrome keeps but the grammar lacks must stay undecided (refused).
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateSupports, parseSupportsCondition } from '../../dragon/src/css/at-rules/supports.ts';
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

/** Conditions Dragon decides: kept and dropped values, grammar-only invalid forms, operators, custom properties and var(). */
const DECIDED = [
  '(display: grid)', '(display: grid flex)', '(display: contents)', '(display: flow-root)', '(width: fit-content)', '(width: min-content)',
  '(height: stretch)', '(overflow: clip)', '(text-align: center)', '(position: sticky)', '(width: 1px 2px)', '(color: 12px)',
  '(margin-left: auto auto)', '(overflow: hidden hidden hidden)', '(color: red !important)', '(--x: 1)', '(--x:)', '(width: var(--w))',
  '(grid-template-columns: 1fr)', '(aspect-ratio: 16 / 9)', '(inset: 1px)', '(margin-inline-start: 4px)', '(DISPLAY: Flex)',
  '((display: block))', '(not (display: block))', 'not (color: 12px)', '(display: flex) and (width: 10px)', '(display: flex) and (color: 12px)',
  '(width: 1px 2px) or (margin-left: 3px)', '(margin-left: auto auto) or (color: 12px)', '(grid-template-columns: 1fr) and (not (width: 1px 2px))',
];

/** Legacy values the grammar rejects; Chrome 145 keeps most of them, so Dragon must not decide any. */
const LEGACY = ['overflow: overlay', 'height: -webkit-fill-available', 'width: -webkit-fit-content', 'width: -webkit-min-content', 'text-align: -webkit-center', 'text-align: -webkit-left', 'color: -webkit-link', 'position: -webkit-sticky'];

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

  it('the legacy values stay undecided, and Chrome keeps at least one of them (so deciding them false would be wrong)', async () => {
    const page = await browser.newPage();
    const chrome = await page.evaluate((ds) => ds.map((d) => CSS.supports(`(${d})`)), LEGACY);
    await page.close();
    for (const d of LEGACY) expect(decide(`(${d})`), d).toBe('undecided');
    expect(chrome.filter((k) => k).length).toBeGreaterThan(0);
  });
});
