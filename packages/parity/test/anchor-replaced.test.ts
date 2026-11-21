// A replaced element (img, svg, video, iframe) as the anchor an absolutely positioned box is placed against, laid out by Dragon
// and compared with live Chrome; an absolutely positioned replaced element is refused, never laid out without its anchor.
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

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAYElEQVR42u3PIREAIBAAMJKgPwSaxIQgBBpNBDK8eLe7FVi7EaVijVJNQEBAQEBAQEBAQEBAQEBAQEBAQEBAQCAdiHlKvd1LCQgICAgICAgICAgICAgICAgICAgICAikfa8BuTxFzbnwAAAAAElFTkSuQmCC';
const doc = (css: string, body: string): string =>
  `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; font-family: Ahem; font-size: 10px; }\n.cb { position: relative; width: 300px; height: 200px; padding: 6px; }\n.a { anchor-name: --a; margin: 20px 0 0 40px; }\n.p { position: absolute; position-anchor: --a; width: 30px; height: 10px; background: #f88; }\n.below { position-area: bottom; }\n.side { position-area: right span-bottom; }\n.sized { position-area: top; width: anchor-size(width); }\n${css}\n</style>\n</head>\n<body data-dragon-id="body">${body}</body>\n</html>\n`;
const placed = (anchor: string): string => `<div data-dragon-id="cb" class="cb"><div data-dragon-id="line">ab ${anchor} cd</div><div data-dragon-id="p1" class="p below"></div><div data-dragon-id="p2" class="p side"></div><div data-dragon-id="p3" class="p sized"></div></div>`;
const CASES: readonly { readonly name: string; readonly css: string; readonly anchor: string }[] = [
  { name: 'an inline <img>', css: '.a { width: 24px; height: 16px; }', anchor: `<img data-dragon-id="a" class="a" src="${PNG}">` },
  { name: 'a block <img> at its natural size', css: '.a { display: block; }', anchor: `<img data-dragon-id="a" class="a" src="${PNG}">` },
  { name: 'an inline <svg>', css: '.a { width: 50px; height: 20px; }', anchor: '<svg data-dragon-id="a" class="a"></svg>' },
  { name: 'a block <video> at the default object height', css: '.a { display: block; width: 100px; }', anchor: '<video data-dragon-id="a" class="a"></video>' },
  { name: 'an inline <iframe>', css: '.a { width: 60px; height: 30px; border: 2px solid #000; }', anchor: '<iframe data-dragon-id="a" class="a"></iframe>' },
];

const compileFor = (html: string) =>
  createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport }).compile(fixtureToInput('anchor-replaced', html));

describe('a replaced element as an anchor', () => {
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
        it(`${c.name}: the boxes anchored to it where Chrome puts them`, async () => {
          const html = doc(c.css, placed(c.anchor));
          const compiled = compileFor(html);
          expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
          const p = nativeProgramFor(compiled, [], 'ios');
          if (p.kind !== 'ready') throw new Error(p.reason);
          const parent = new Map(p.program.nodes.map((n) => [n.id, n.parent]));
          const env = { ...ENVIRONMENT, devicePixelRatio: dpr };
          const boxes = new Map(engineBoxes(p.program, env.viewport, dpr).map((b) => [b.id, b]));
          const absolute = (id: string): { x: number; y: number; width: number; height: number } => {
            const b = boxes.get(id);
            if (b === undefined) throw new Error(`no engine box ${id}`);
            const up = parent.get(id) ?? null;
            const o = up === null ? { x: 0, y: 0 } : absolute(up);
            return { x: o.x + b.x / 64, y: o.y + b.y / 64, width: b.width / 64, height: b.height / 64 };
          };
          const capture = await captureFixture(browser, 'anchor-replaced', html, env);
          const compared: string[] = [];
          for (const n of capture.nodes) {
            if (!n.hasBox || n.kind === 'line' || !['a', 'p1', 'p2', 'p3'].includes(n.id)) continue;
            const e = absolute(n.id);
            // Engine boxes are in device px; Chrome's in CSS px.
            const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(n[k] * dpr - e[k])));
            expect(delta, `${n.id}: Chrome ${JSON.stringify([n.x, n.y, n.width, n.height])}, Dragon ${JSON.stringify(e)}`).toBeLessThanOrEqual(GATE_DEVICE_PX);
            compared.push(n.id);
          }
          expect(compared.sort()).toEqual(['a', 'p1', 'p2', 'p3']);
          // The anchored boxes sit off their static position: below, beside and above the anchor.
          const a = absolute('a');
          expect(absolute('p1').y).toBeCloseTo(a.y + a.height, 3);
          expect(absolute('p2').x).toBeCloseTo(a.x + a.width, 3);
          expect(absolute('p3').y + absolute('p3').height).toBeCloseTo(a.y, 3);
          expect(absolute('p3').width).toBeCloseTo(a.width, 3);
        });
      }
    });
  }

  it('refuses an absolutely positioned replaced element placed against an anchor, naming it', () => {
    const html = doc('.k { anchor-name: --k; width: 20px; height: 10px; } .q { position: absolute; position-anchor: --k; position-area: top; width: 10px; height: 10px; }', `<div data-dragon-id="cb" class="cb"><div data-dragon-id="k" class="k"></div><img data-dragon-id="q" class="q" src="${PNG}"></div>`);
    const errors = compileFor(html).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    expect(errors).toContain('position: absolute on <img> q is not supported on a replaced element yet (CSS 2.2 §10.3.8, §10.6.5)');
  });
});
