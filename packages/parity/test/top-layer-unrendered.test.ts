// A <dialog> that is display: none, or inside a display: none element, renders nothing in Chrome even when shown with showModal():
// neither the dialog nor its ::backdrop. Dragon keeps it out of the top layer, so the native program draws neither.
import type { Browser, Page } from 'playwright';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from 'dragon';
import { nativeProgramFor } from '../../dragon/src/internal.ts';
import { launchChrome } from '../src/chrome.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { engineBoxes } from '../src/native-host.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';

const doc = (body: string): string =>
  `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; font-family: Ahem; font-size: 10px; }\n.none { display: none; }\ndialog::backdrop { background: rgb(255, 0, 0); }\n</style>\n</head>\n<body data-dragon-id="body">${body}</body>\n</html>\n`;
const DIALOG = (attributes: string): string => `<dialog data-dragon-id="d"${attributes}><p data-dragon-id="t">Hi</p></dialog>`;
const CASES: readonly { readonly name: string; readonly body: string; readonly shown: boolean }[] = [
  { name: 'a dialog shown modal', body: DIALOG(''), shown: true },
  { name: 'a dialog inside a display: none element', body: `<div data-dragon-id="w" class="none">${DIALOG('')}</div>`, shown: false },
  { name: 'a dialog inside a hidden element', body: `<div data-dragon-id="w" hidden="">${DIALOG('')}</div>`, shown: false },
  { name: 'a display: none dialog', body: DIALOG(' class="none"'), shown: false },
  { name: 'a hidden dialog', body: DIALOG(' hidden=""'), shown: false },
];

/** The colour of the CSS pixel at (x, y) of a page screenshot, as "r,g,b". */
async function pixel(page: Page, x: number, y: number): Promise<string> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const data: Buffer[] = [];
  for (let i = 8; i < png.length; ) {
    const length = png.readUInt32BE(i);
    if (png.toString('ascii', i + 4, i + 8) === 'IDAT') data.push(png.subarray(i + 8, i + 8 + length));
    i += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  // Every PNG filter predicts 0 for the one pixel of a one-pixel image, so the bytes after the filter byte are its colour.
  return `${raw[1]},${raw[2]},${raw[3]}`;
}

describe('a dialog Chrome does not render, the host presenting the top layer', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchChrome(1);
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });
  for (const c of CASES) {
    it(`${c.name}: ${c.shown ? 'the dialog and its backdrop drawn' : 'neither the dialog nor its backdrop drawn'}, as in Chrome`, async () => {
      const html = doc(c.body);
      const page = await browser.newPage({ viewport: ENVIRONMENT.viewport });
      try {
        await page.setContent(html);
        const chrome = await page.evaluate(async () => {
          const d = document.querySelector('dialog') as HTMLDialogElement;
          d.showModal();
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { modal: d.matches(':modal'), boxes: d.getClientRects().length };
        });
        expect(chrome).toEqual({ modal: true, boxes: c.shown ? 1 : 0 });
        expect(await pixel(page, 1, 1)).toBe(c.shown ? '255,0,0' : '255,255,255');
      } finally {
        await page.close();
      }
      const compiled = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport, hostTopLayer: true }).compile(fixtureToInput('top-layer-unrendered', html));
      expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
      const p = nativeProgramFor(compiled, [], 'ios');
      if (p.kind !== 'ready') throw new Error(p.reason);
      const boxes = new Set(engineBoxes(p.program, ENVIRONMENT.viewport, 1).map((b) => b.id));
      expect([boxes.has('d'), boxes.has('d::backdrop')]).toEqual([c.shown, c.shown]);
      const backdrop = p.program.nodes.find((n) => n.id === 'd::backdrop');
      expect(backdrop === undefined ? null : backdrop.parent).toBe(c.shown ? 'html' : null);
    }, 120_000);
  }
});
