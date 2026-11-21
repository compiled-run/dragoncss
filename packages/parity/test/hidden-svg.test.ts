// The UA rule [hidden] { display: none } is in the HTML namespace's sheet, so Chrome draws an <svg> or an SVG shape that has the
// hidden attribute; Dragon draws it too, where an HTML element with hidden has no box.
import { inflateSync } from 'node:zlib';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from 'dragon';
import { nativeProgramFor } from '../../dragon/src/internal.ts';
import { captureFixture } from '../src/capture.ts';
import { launchChrome } from '../src/chrome.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { engineBoxes } from '../src/native-host.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';

const doc = (body: string): string =>
  `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; font-family: Ahem; font-size: 10px; }\n</style>\n</head>\n<body data-dragon-id="body">${body}</body>\n</html>\n`;
const CASES: readonly { readonly name: string; readonly body: string; readonly boxes: readonly string[]; readonly shapes: number }[] = [
  { name: 'an <svg> with hidden', body: '<svg data-dragon-id="s" hidden="" width="10" height="10"><rect data-dragon-id="r" width="10" height="10" fill="blue"></rect></svg>', boxes: ['s'], shapes: 1 },
  { name: 'a <rect> with hidden', body: '<svg data-dragon-id="s" width="10" height="10"><rect data-dragon-id="r" hidden="" width="10" height="10" fill="blue"></rect></svg>', boxes: ['s'], shapes: 1 },
  { name: 'a <div> with hidden around an <svg>', body: '<div data-dragon-id="w" hidden=""><svg data-dragon-id="s" width="10" height="10"><rect data-dragon-id="r" width="10" height="10" fill="blue"></rect></svg></div>', boxes: [], shapes: 0 },
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

describe('the hidden attribute on SVG elements', () => {
  for (const c of CASES) {
    it(`${c.name}: the boxes and shapes Chrome draws`, async () => {
      const html = doc(c.body);
      const browser = await launchChrome(1);
      let chrome: readonly { id: string; x: number; y: number; width: number; height: number }[];
      let drawn = '';
      try {
        const capture = await captureFixture(browser, 'hidden-svg', html, ENVIRONMENT, [], async (page) => {
          drawn = await pixel(page, 5, 5);
        });
        chrome = capture.nodes.filter((n) => n.hasBox && ['w', 's'].includes(n.id));
      } finally {
        await browser.close();
      }
      expect(chrome.map((n) => n.id)).toEqual(c.boxes);
      expect(drawn).toBe(c.shapes === 1 ? '0,0,255' : '255,255,255');
      const compiled = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport }).compile(fixtureToInput('hidden-svg', html));
      expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
      const p = nativeProgramFor(compiled, [], 'ios');
      if (p.kind !== 'ready') throw new Error(p.reason);
      const engine = new Map(engineBoxes(p.program, ENVIRONMENT.viewport, 1).map((b) => [b.id, b]));
      for (const n of chrome) expect([engine.get(n.id)?.width, engine.get(n.id)?.height].map((v) => (v === undefined ? null : v / 64)), n.id).toEqual([n.width, n.height]);
      expect(['w', 's'].filter((id) => engine.has(id))).toEqual(c.boxes);
      const svg = p.program.nodes.find((n) => n.id === 's')?.writes.find((w) => w.kind === 'svg-shapes') as { shapes: readonly unknown[] } | undefined;
      expect(svg?.shapes.length ?? 0).toBe(c.shapes);
    }, 120_000);
  }
});
