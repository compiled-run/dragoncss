// A <dialog> shown with showModal() when the host presents the top layer (compileNativeStyles topLayer: 'host', InternalOptions
// hostTopLayer): Dragon lays it out from Chrome's captured :modal UA values in the top layer, a child of the root box after its
// ::backdrop box, and both are compared with live Chrome, where every dialog of the page is opened with showModal().
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from 'dragon';
import { nativeProgramFor } from '../../dragon/src/internal.ts';
import { captureFixture } from '../src/capture.ts';
import { launchChrome } from '../src/chrome.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { engineBoxes } from '../src/native-host.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';

const doc = (css: string, body: string): string =>
  `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; font-family: Ahem; font-size: 10px; }\n${css}\n</style>\n</head>\n<body data-dragon-id="body">${body}</body>\n</html>\n`;
const BODY = '<main data-dragon-id="m"><p data-dragon-id="p">Page</p><dialog data-dragon-id="d"><h2 data-dragon-id="t">Delete it?</h2><div data-dragon-id="k" class="k">Keep</div></dialog></main>';
const CASES: readonly { readonly name: string; readonly css: string }[] = [
  { name: 'the UA look', css: '' },
  { name: 'author styles on the dialog and its ::backdrop', css: 'main { padding: 20px; }\ndialog { padding: 12px; border: 4px solid #333; background: #fffbe6; border-radius: 0; }\ndialog::backdrop { background: rgba(10, 20, 30, 0.5); }\n.k { padding: 4px; background: #ddd; }' },
  { name: 'a fixed width and an author font size the em padding follows', css: 'dialog { width: 200px; font-size: 20px; }' },
  { name: 'content taller than the viewport, clamped by the UA max-height', css: '.k { height: 600px; }' },
];

type Rgba = { r: number; g: number; b: number; alpha: number };
const compileFor = (html: string, hostTopLayer: boolean) =>
  createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport, hostTopLayer }).compile(fixtureToInput('top-layer-dialog', html));

describe('a modal <dialog> and its ::backdrop, the host presenting the top layer', () => {
  for (const dpr of [1, 3]) {
    describe(`at DPR ${dpr}`, () => {
      let browser: Browser;
      beforeAll(async () => {
        browser = await launchChrome(dpr);
      }, 120_000);
      afterAll(async () => {
        await browser?.close();
      });
      for (const c of CASES) {
        it(`${c.name}: the dialog and its contents where Chrome puts them, the backdrop over the viewport in Chrome's colour`, async () => {
          const html = doc(c.css, BODY);
          const compiled = compileFor(html, true);
          expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
          const p = nativeProgramFor(compiled, [], 'ios');
          if (p.kind !== 'ready') throw new Error(p.reason);
          const program = p.program;
          const parent = new Map(program.nodes.map((n) => [n.id, n.parent]));
          expect([parent.get('d'), parent.get('d::backdrop')]).toEqual(['html', 'html']);
          const order = program.nodes.map((n) => n.id);
          expect(order.indexOf('d::backdrop')).toBeLessThan(order.indexOf('d'));
          const env = { ...ENVIRONMENT, devicePixelRatio: dpr };
          const boxes = new Map(engineBoxes(program, env.viewport, dpr).map((b) => [b.id, b]));
          const absolute = (id: string): { x: number; y: number; width: number; height: number } => {
            const b = boxes.get(id);
            if (b === undefined) throw new Error(`no engine box ${id}`);
            const up = parent.get(id) ?? null;
            const o = up === null ? { x: 0, y: 0 } : absolute(up);
            return { x: o.x + b.x / 64, y: o.y + b.y / 64, width: b.width / 64, height: b.height / 64 };
          };
          let chromeBackdrop = '';
          const capture = await captureFixture(browser, 'top-layer-dialog', html, env, [], async (page) => {
            chromeBackdrop = await page.evaluate(() => {
              const d = document.querySelector('dialog') as HTMLDialogElement;
              d.showModal();
              return getComputedStyle(d, '::backdrop').backgroundColor;
            });
          });
          const compared: string[] = [];
          for (const n of capture.nodes) {
            if (!n.hasBox || n.kind === 'line' || !['d', 't', 'k'].includes(n.id)) continue;
            const e = absolute(n.id);
            // Engine boxes are in device px; Chrome's in CSS px.
            const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(n[k] * dpr - e[k])));
            expect(delta, `${n.id}: Chrome ${JSON.stringify([n.x, n.y, n.width, n.height])}, Dragon ${JSON.stringify(e)}`).toBeLessThanOrEqual(GATE_DEVICE_PX);
            compared.push(n.id);
          }
          expect(compared.sort()).toEqual(['d', 'k', 't']);
          expect(absolute('d::backdrop')).toEqual({ x: 0, y: 0, width: env.viewport.width * dpr, height: env.viewport.height * dpr });
          const backdrop = program.nodes.find((n) => n.id === 'd::backdrop')?.writes.find((w) => w.kind === 'background-color') as { color: Rgba } | undefined;
          const css = (x: Rgba): string => (x.alpha === 255 ? `rgb(${x.r}, ${x.g}, ${x.b})` : `rgba(${x.r}, ${x.g}, ${x.b}, ${Number((x.alpha / 255).toFixed(2))})`);
          expect(backdrop === undefined ? null : css(backdrop.color)).toBe(chromeBackdrop);
        });
      }
    });
  }

  it('refuses <dialog> when the host does not present the top layer, naming why', () => {
    const compiled = compileFor(doc('', BODY), false);
    expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toContain("<dialog> d is not supported: it renders in the top layer with a ::backdrop, which Dragon lays out only when the host presents the top layer itself (compileNativeStyles topLayer: 'host')");
  });
});
