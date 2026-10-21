// SELD-R2 PR 5 follow-up: which overflow makes a box Chrome 145 can focus (analysis/interaction.ts rulesMayScroll). Chrome 130 and
// later keyboard-focus a scroll container with no focusable child, so the native gate refuses forced-only :focus wherever a rule may
// make one. Each document below is read back in Chrome 145: Tab twice, Shift+Tab once and a click on the box, recording every
// element any of them focuses. The device traces press no Tab key, so this readback is the keyboard proof. Every document Dragon
// calls focus-unreachable must take no focus in Chrome, Dragon's and Chrome's verdicts are pinned, and both plants must be caught.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import type { CompilerFaults } from 'dragon';
import { createProjectWith, focusReachableIn, NO_FAULTS } from 'dragon';
import { launchChrome } from '../src/chrome.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';

type Doc = {
  readonly name: string;
  readonly css: string;
  /** The body's content; by default a 50px box s around a 400px child. */
  readonly body?: string;
  /** Whether Dragon may let an input focus some element (focusReachable). */
  readonly dragon: boolean;
  /** The ids Chrome 145 focuses by Tab, Shift+Tab or a click on s. */
  readonly chrome: readonly string[];
};

const BOX = '<div data-dragon-id="s" class="s"><div data-dragon-id="tall" class="tall"></div></div>';
const PAGE = '<div data-dragon-id="s" class="s"></div><div data-dragon-id="tall" class="tall"></div><div data-dragon-id="tall2" class="tall"></div>';

const DOCS: readonly Doc[] = [
  // A box hidden on both axes is no scroller Chrome focuses (hidden beside clip computes hidden).
  { name: 'hidden', css: '.s { overflow: hidden; }', dragon: false, chrome: [] },
  { name: 'hidden longhands', css: '.s { overflow-x: hidden; overflow-y: hidden; }', dragon: false, chrome: [] },
  { name: 'hidden beside clip', css: '.s { overflow-x: hidden; overflow-y: clip; }', dragon: false, chrome: [] },
  { name: 'clip beside hidden', css: '.s { overflow: clip hidden; }', dragon: false, chrome: [] },
  { name: 'hidden, then visible on both axes', css: '.s { overflow: hidden; } .s.s { overflow: visible; }', dragon: false, chrome: [] },
  // The viewport's scroller: html's overflow, and body's while html is visible, propagate to it, and Chrome never focuses it.
  { name: 'html auto', css: 'html { overflow: auto; }', body: PAGE, dragon: false, chrome: [] },
  { name: 'html scroll', css: 'html { overflow: scroll; }', body: PAGE, dragon: false, chrome: [] },
  { name: ':root scroll on x', css: ':root { overflow-x: scroll; }', body: PAGE, dragon: false, chrome: [] },
  { name: 'html hidden on x', css: 'html { overflow-x: hidden; }', body: PAGE, dragon: false, chrome: [] },
  { name: 'body auto under a visible html', css: 'body { overflow: auto; height: 100px; }', body: PAGE, dragon: false, chrome: [] },
  { name: 'body scroll under a visible html', css: 'body { overflow-y: scroll; height: 100px; } html { overflow: visible; }', body: PAGE, dragon: false, chrome: [] },
  // Refused: Chrome focuses these, so Dragon must count them.
  { name: 'hidden beside visible', css: '.s { overflow-x: hidden; }', dragon: true, chrome: ['s'] },
  { name: 'hidden, then visible on y', css: '.s { overflow: hidden; } .s.s { overflow-y: visible; }', dragon: true, chrome: ['s'] },
  { name: 'auto', css: '.s { overflow: auto; }', dragon: true, chrome: ['s'] },
  { name: 'body under a hidden html', css: 'html { overflow: hidden; } body { overflow: auto; height: 100px; }', body: PAGE, dragon: true, chrome: ['body'] },
  { name: 'body under a clipped html', css: 'html { overflow: clip; } body { overflow: auto; height: 100px; }', body: PAGE, dragon: true, chrome: ['body'] },
  { name: 'body under html clipped on y', css: 'html { overflow-y: clip; } body { overflow: auto; height: 100px; }', body: PAGE, dragon: true, chrome: ['body'] },
  { name: 'body with paint containment', css: 'body { overflow: auto; height: 100px; contain: paint; }', body: PAGE, dragon: true, chrome: ['body'] },
  { name: 'body under a size container html', css: 'html { container-type: size; } body { overflow: auto; height: 100px; }', body: PAGE, dragon: true, chrome: ['body'] },
  // hr's UA overflow is hidden, so visible on y alone computes auto, and its generated content overflows it.
  { name: 'hr visible on y', css: 'hr { overflow-y: visible; } hr::before { content: "X"; display: block; height: 400px; }', body: '<hr data-dragon-id="s" class="s">', dragon: true, chrome: ['s'] },
];

const html = (d: Doc): string =>
  `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; }\n.s { width: 50px; height: 50px; }\n.tall { height: 400px; }\n${d.css}\n.s:focus { width: 80px; }\n</style>\n</head>\n<body data-dragon-id="body">${d.body ?? BOX}</body>\n</html>\n`;

function dragonReaches(d: Doc, faults: Partial<CompilerFaults> = {}): boolean {
  const project = createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: { ...NO_FAULTS, ...faults }, profiles: 'enforce', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: { width: 200, height: 200 } });
  return focusReachableIn(project.compile(fixtureToInput(`focus-scroller-${d.name.replace(/[^a-z0-9]+/g, '-')}`, html(d))));
}

let browser: Browser | null = null;
const seen = new Map<string, readonly string[]>();

/** Every data-dragon-id Chrome 145 focuses in the document by Tab, Tab, Shift+Tab, then a click on s's top left. */
async function chromeFocuses(d: Doc): Promise<readonly string[]> {
  if (browser === null) throw new Error('Chrome did not launch');
  const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
  try {
    await page.setContent(html(d));
    const focused = new Set<string>();
    const read = async (): Promise<void> => {
      const id = await page.evaluate(() => document.querySelector('[data-dragon-id]:focus')?.getAttribute('data-dragon-id') ?? null);
      if (id !== null) focused.add(id);
    };
    for (const key of ['Tab', 'Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      await read();
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const box = await page.evaluate(() => {
      const r = document.querySelector('[data-dragon-id="s"]')?.getBoundingClientRect();
      return r === undefined ? null : { x: r.left + 2, y: r.top + 2 };
    });
    if (box === null) throw new Error(`${d.name}: no element s`);
    await page.mouse.click(box.x, box.y);
    await read();
    return [...focused].sort();
  } finally {
    await page.close();
  }
}

describe('focusable scrollers against Chrome 145 (rulesMayScroll)', () => {
  beforeAll(async () => {
    browser = await launchChrome();
    for (const d of DOCS) seen.set(d.name, await chromeFocuses(d));
  }, 300_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('reads back what Chrome 145 focuses in each document', () => {
    expect(DOCS.map((d) => [d.name, seen.get(d.name)])).toEqual(DOCS.map((d) => [d.name, d.chrome]));
  });

  it('gives each document the pinned Dragon verdict, and lets no input focus only where Chrome focuses nothing', () => {
    expect(DOCS.map((d) => [d.name, dragonReaches(d)])).toEqual(DOCS.map((d) => [d.name, d.dragon]));
    expect(DOCS.filter((d) => !dragonReaches(d) && (seen.get(d.name) ?? ['?']).length > 0).map((d) => d.name)).toEqual([]);
  });

  for (const fault of ['hiddenAxisUnpaired', 'bodyPropagationAssumed'] as const) {
    it(`catches the ${fault} plant: it calls a document Chrome focuses unreachable`, () => {
      expect(DOCS.filter((d) => !dragonReaches(d, { [fault]: true }) && (seen.get(d.name) ?? []).length > 0).length).toBeGreaterThan(0);
    });
  }
});
