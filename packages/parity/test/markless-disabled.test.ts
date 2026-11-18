// A styled button bound to disabled, as @markless/mobile writes the u20 rung's input: :disabled selects on its state, and
// Chrome's button[disabled] UA colours apply where no author declaration sets them. Frames and colours are Chrome's.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome } from '../src/chrome.ts';
import { compareMarklessExport, marklessDocumentHtml } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/disabled.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const cell = input.states[0]!.cell;
const buttons = input.nodes.flatMap((n) => (n.kind === 'element' && n.element === 'button' ? [n.id] : []));
const [send, lock] = buttons as [string, string];

let browser: Browser;
beforeAll(async () => {
  browser = await launchChrome(1);
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

type Rgba8 = { r: number; g: number; b: number; alpha: number };
const rgba = (css: string): Rgba8 => {
  const [r, g, b, a] = css.slice(css.indexOf('(') + 1, -1).split(',').map((v) => Number(v.trim())) as [number, number, number, number | undefined];
  return { r, g, b, alpha: a === undefined ? 255 : Math.round(a * 255) };
};

/** Chrome's computed text colour and top border colour of each button, with the states at these values. */
async function chromeColours(values: Record<string, unknown>): Promise<Record<string, { text: Rgba8; border: Rgba8 }>> {
  const page = await browser.newPage();
  try {
    await page.setContent(marklessDocumentHtml(input, values));
    const out: Record<string, { text: Rgba8; border: Rgba8 }> = {};
    for (const id of buttons) {
      const [text, border] = await page.evaluate((id) => {
        const s = getComputedStyle(document.querySelector(`[data-dragon-id="${id}"]`)!);
        return [s.color, s.borderTopColor];
      }, id);
      out[id] = { text: rgba(text!), border: rgba(border!) };
    }
    return out;
  } finally {
    await page.close();
  }
}

describe('a disabled button in a Markless export', () => {
  const { exported } = marklessStyleExport(TEXT, PATH);

  it('gives each button the text and border colours Chrome computes, enabled and disabled', async () => {
    for (const t of ['ios', 'android'] as const) {
      for (const a of exported.targets[t]!.assignments) {
        const chrome = await chromeColours(a.values);
        const byId = new Map(a.nodes.map((n) => [n.id, n]));
        for (const id of buttons) {
          const border = (byId.get(id)!.writes.find((w) => w['kind'] === 'border-colors')!['colors'] as Rgba8[])[0];
          const text = byId.get(`${id}:text0`)!.writes.find((w) => w['kind'] === 'text-color')!['color'];
          expect({ text, border }, `${t} ${id} ${JSON.stringify(a.values)}`).toEqual(chrome[id]);
        }
      }
    }
  });

  it('switches only the disabled button, by its state', () => {
    const x = exported.targets.ios!;
    const text = (locked: boolean, id: string): unknown => x.assignments.find((a) => a.values[cell] === locked)!.nodes.find((n) => n.id === `${id}:text0`)!.writes.find((w) => w['kind'] === 'text-color')!['color'];
    expect(text(false, send)).toEqual({ r: 0, g: 0, b: 0, alpha: 255 });
    expect(text(true, send)).toEqual({ r: 16, g: 16, b: 16, alpha: 77 });
    expect(text(true, lock)).toEqual({ r: 0, g: 0, b: 0, alpha: 255 });
  });

  it('places every box of both assignments where Chrome does, within 1 device px', async () => {
    const report = await compareMarklessExport(input, exported);
    expect(report.compared).toBeGreaterThan(10);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
  });
});
