// T154 slice 1 against Chrome 145 (packages/dragon/src/analysis/selection.ts): on iOS and Android an author user-select compiles when
// it computes to none or its used value is text under a text parent, so native, which selects nothing yet (P6c), stands for the page
// with every rule but the none ones removed. For each case Chrome selects all (Ctrl+A), drags a selection across the page both ways
// (so one starts outside a none subtree, from the later sibling) and inside each block; a case Dragon compiles on native selects
// exactly what that model page selects, and each case it refuses selects something else, so every refusal is needed.
import { describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from '../../dragon/src/internal.ts';
import type { Targets } from '../../dragon/src/types.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';

type Rule = readonly [string, string];
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; line-height: 10px; } div { width: 300px; }';

// The tree: a holds b, b holds c; d is a's sibling. Each block has its own text on its first line.
const CASES: readonly (readonly Rule[])[] = [
  [['.a', 'auto']],
  [['.a', 'text']],
  [['.b', 'unset']],
  [['.a', 'text'], ['.b', 'inherit']],
  [['.a', 'none'], ['.b', 'auto']],
  [['.a', 'none'], ['.b', 'initial']],
  [['.a', 'none'], ['.b', 'inherit']],
  [['.a', 'none'], ['.b', 'unset']],
  [['.b', 'none'], ['.c', 'auto']],
  [['.a', 'none'], ['.d', 'text']],
  [['.a', 'none'], ['.b', 'text']],
  [['.b', 'none'], ['.c', 'text']],
  [['.a', 'all']],
  [['.c', 'all']],
  [['.a', 'all'], ['.b', 'auto']],
  [['.a', 'none'], ['.b', 'all']],
];

const css = (rules: readonly Rule[]): string => `${BASE} ${rules.map(([s, v]) => `${s} { user-select: ${v}; }`).join(' ')}`;
const model = (rules: readonly Rule[]): readonly Rule[] => rules.filter(([, v]) => v === 'none');

const html = (rules: readonly Rule[]): string =>
  `<!DOCTYPE html><html data-dragon-id="html"><head><style>${css(rules)}</style></head><body data-dragon-id="body"><div data-dragon-id="a" class="a">AAAA AAAA<div data-dragon-id="b" class="b">BBBB BBBB<div data-dragon-id="c" class="c">CCCC CCCC</div></div></div><div data-dragon-id="d" class="d">DDDD DDDD</div></body></html>`;

function compilesOnNative(rules: readonly Rule[]): boolean {
  const c = createProjectWith({ projectId: 'dragon-parity', targets: NATIVE }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(fixtureToInput('user-select-noop', html(rules)));
  return c.diagnostics.every((d) => d.severity !== 'error');
}

type Page = {
  setContent(html: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  mouse: { move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void>; click(x: number, y: number): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
};
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };

/**
 * What each selection selects: the selected text and its client rects. Ctrl+A first, then drags across the page both ways and inside
 * each block's first line.
 */
async function selections(page: Page, rules: readonly Rule[]): Promise<string[]> {
  await page.setContent(html(rules));
  // Ahem: each glyph is 10px square, so a block's first line spans y 0..10 from its top and its text from x 0.
  const tops = (await page.evaluate(`['a', 'b', 'c', 'd'].map((id) => document.querySelector('[data-dragon-id="' + id + '"]').getBoundingClientRect().top)`)) as number[];
  const end = (tops[3] as number) + 5;
  const drags: [number, number, number, number][] = [[1, 1, 95, end], [95, end, 1, 1], ...tops.map((t): [number, number, number, number] => [22, t + 5, 68, t + 5])];
  const out: string[] = [];
  const selected = `(() => { const s = getSelection(); const rects = s.rangeCount === 0 ? [] : [...s.getRangeAt(0).getClientRects()].map((r) => [r.x, r.y, r.width, r.height].map(Math.round).join(',')); return JSON.stringify([s.toString(), rects]); })()`;
  await page.mouse.click(250, 200);
  await page.keyboard.press('Control+A');
  out.push(String(await page.evaluate(selected)));
  for (const [x0, y0, x1, y1] of drags) {
    await page.mouse.click(250, 200);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2);
    await page.mouse.move(x1, y1);
    await page.mouse.up();
    out.push(String(await page.evaluate(selected)));
  }
  return out;
}

describe('user-select slice 1: the values native compiles select in Chrome what native stands for', () => {
  it('each compiled case selects as its none-only model does, each refused case differently', async () => {
    const compiled = CASES.filter(compilesOnNative);
    const refused = CASES.filter((r) => !compilesOnNative(r));
    expect(compiled.length).toBeGreaterThanOrEqual(7);
    expect(refused.length).toBeGreaterThanOrEqual(8);
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    const problems: string[] = [];
    try {
      const page = await browser.newPage();
      for (const rules of CASES) {
        const [actual, standIn] = [await selections(page, rules), await selections(page, model(rules))];
        const same = JSON.stringify(actual) === JSON.stringify(standIn);
        if (compiled.includes(rules) && !same) problems.push(`${css(rules)}: compiles on native, but Chrome selects ${actual.join(' ')} where native stands for ${standIn.join(' ')}`);
        if (refused.includes(rules) && same) problems.push(`${css(rules)}: refused on native, but Chrome selects as the none-only model does`);
      }
      // A drag selects something on the default page, so the comparison sees selection at all.
      const plain = await selections(page, []);
      expect(plain[0]).toContain('AAAA');
      expect(plain[1]).toContain('AAAA');
    } finally {
      await browser.close();
    }
    expect(problems).toEqual([]);
  }, 300_000);
});
