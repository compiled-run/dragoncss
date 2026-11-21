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
  { name: 'font size, line height, letter spacing and text fill colour inherited from the dialog\'s DOM ancestors', css: 'main { font-size: 15px; line-height: 2; letter-spacing: 1px; -webkit-text-fill-color: #036; }' },
];

type Rgba = { r: number; g: number; b: number; alpha: number };
const css = (x: Rgba): string => (x.alpha === 255 ? `rgb(${x.r}, ${x.g}, ${x.b})` : `rgba(${x.r}, ${x.g}, ${x.b}, ${Number((x.alpha / 255).toFixed(2))})`);
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
          let chromeText = { fontSize: '', fill: '' };
          const capture = await captureFixture(browser, 'top-layer-dialog', html, env, [], async (page) => {
            [chromeBackdrop, chromeText] = await page.evaluate(() => {
              const d = document.querySelector('dialog') as HTMLDialogElement;
              d.showModal();
              const t = getComputedStyle(document.querySelector('h2') as HTMLElement);
              return [getComputedStyle(d, '::backdrop').backgroundColor, { fontSize: t.fontSize, fill: t.webkitTextFillColor }] as const;
            });
          });
          const textWrites = program.nodes.find((n) => n.id === 't:text0')?.writes ?? [];
          const font = textWrites.find((w) => w.kind === 'font') as { font: { size: number } } | undefined;
          const fill = textWrites.find((w) => w.kind === 'text-color') as { color: Rgba } | undefined;
          expect({ fontSize: font === undefined ? null : `${font.font.size}px`, fill: fill === undefined ? null : css(fill.color) }).toEqual(chromeText);
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
          expect(backdrop === undefined ? null : css(backdrop.color)).toBe(chromeBackdrop);
        });
      }
    });
  }

  // A modal dialog's overflow is forced to auto, and native does not zoom a scroll container yet, so a dialog under zoom is refused
  // with the effective zoom Chrome gives it, which it takes from its DOM ancestors though its box is the root's child.
  describe('a dialog under zoom inherited from its DOM ancestors', () => {
    let browser: Browser;
    beforeAll(async () => {
      browser = await launchChrome(1);
    }, 120_000);
    afterAll(async () => {
      await browser?.close();
    });
    for (const [name, zoomCss] of [['the body at zoom 2', 'body { zoom: 2; }'], ['the body at zoom 2 and main at 1.5', 'body { zoom: 2; }\nmain { zoom: 1.5; }']] as const) {
      it(`${name}: refused at Chrome's effective zoom, naming the scroll container`, async () => {
        const html = doc(`${zoomCss}\ndialog { width: 100px; height: 50px; padding: 0; border: 0; margin: 0; inset: 0; }`, BODY);
        let chromeZoom = 0;
        await captureFixture(browser, 'top-layer-dialog-zoom', html, ENVIRONMENT, [], async (page) => {
          chromeZoom = await page.evaluate(() => {
            const d = document.querySelector('dialog') as HTMLDialogElement;
            d.showModal();
            return (d as HTMLElement & { currentCSSZoom: number }).currentCSSZoom;
          });
        });
        expect(chromeZoom).toBeGreaterThan(1);
        const errors = compileFor(html, true).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
        expect(errors).toContain(`<dialog> d is laid out at zoom ${chromeZoom} and overflow-x: auto makes it a scroll container, which native does not zoom yet (ZOOM)`);
      });
    }
  });

  it('refuses an em the dialog inherits through a DOM ancestor with its own font size, as for a box in place', () => {
    const css = 'main { font-size: 4vw; letter-spacing: 0.1em; }\n.s { font-size: 20px; }';
    const inherited = (tag: string): string[] =>
      compileFor(doc(css, `<main data-dragon-id="m"><section data-dragon-id="s" class="s"><${tag} data-dragon-id="d">Text</${tag}></section></main>`), true)
        .diagnostics.filter((d) => d.severity === 'error' && d.message.includes('inherits an em')).map((d) => d.message);
    expect(inherited('div')).toEqual(['letter-spacing on <div> d inherits an em an ancestor took of a font-size that follows the viewport, which the native targets do not resolve yet']);
    expect(inherited('dialog')).toEqual(['letter-spacing on <dialog> d inherits an em an ancestor took of a font-size that follows the viewport, which the native targets do not resolve yet']);
  });

  it('refuses <dialog> when the host does not present the top layer, naming why', () => {
    const compiled = compileFor(doc('', BODY), false);
    expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toContain("<dialog> d is not supported: it renders in the top layer with a ::backdrop, which Dragon lays out only when the host presents the top layer itself (compileNativeStyles topLayer: 'host')");
  });
});
