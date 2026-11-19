// position-visibility: anchors-visible, the initial value, makes Chrome hide an anchored box whose default anchor is invisible or
// clipped by a box between it and the anchored box's containing block. Dragon refuses each such anchor on the native targets
// (lower/anchor-layout.ts), and every anchored box it lays out is drawn where Chrome draws it.
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

const doc = (css: string, body: string): string =>
  `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; font-family: Ahem; font-size: 10px; }\n.s { height: 100px; }\n.a { anchor-name: --a; width: 10px; height: 10px; }\n.p { position: absolute; position-anchor: --a; width: 20px; height: 20px; background: rgb(0, 0, 255); }\n${css}\n</style>\n</head>\n<body data-dragon-id="body">${body}</body>\n</html>\n`;
const OUTSIDE = '<div data-dragon-id="c" class="c"><div data-dragon-id="s" class="s"></div><div data-dragon-id="a" class="a"></div></div><div data-dragon-id="p" class="p"></div>';
const INSIDE = '<div data-dragon-id="o" class="o"><div data-dragon-id="c" class="c"><div data-dragon-id="s" class="s"></div><div data-dragon-id="a" class="a"></div><div data-dragon-id="p" class="p"></div></div></div>';
const CASES: readonly { readonly name: string; readonly css: string; readonly body: string; readonly drawn: boolean; readonly refused: boolean }[] = [
  { name: 'an anchor clipped out of view by a box outside the containing block', css: '.c { position: relative; width: 50px; height: 50px; overflow: clip; } .p { top: anchor(bottom); left: 0; }', body: OUTSIDE, drawn: false, refused: true },
  { name: 'an anchor scrolled out of view in a scroll container', css: '.c { position: relative; width: 50px; height: 50px; overflow: hidden; } .p { top: anchor(bottom); left: 0; }', body: OUTSIDE, drawn: false, refused: true },
  { name: 'an anchor clipped out of view by paint containment', css: '.c { position: relative; width: 50px; height: 50px; contain: paint; } .p { top: anchor(bottom); left: 0; }', body: OUTSIDE, drawn: false, refused: true },
  { name: 'an anchor clipped out of view inside the containing block', css: '.o { position: relative; } .c { width: 50px; height: 50px; overflow: clip; } .p { top: 0; left: anchor(right); }', body: INSIDE, drawn: false, refused: true },
  { name: 'an invisible anchor', css: '.a { visibility: hidden; } .p { top: anchor(bottom); left: 30px; }', body: '<div data-dragon-id="a" class="a"></div><div data-dragon-id="p" class="p"></div>', drawn: false, refused: true },
  { name: 'an anchor partly in view, which Dragon cannot tell at build time', css: '.c { position: relative; width: 50px; height: 105px; overflow: clip; } .p { top: anchor(bottom); left: 0; }', body: OUTSIDE, drawn: true, refused: true },
  { name: 'an anchor clipped by the containing block itself', css: '.o { position: relative; } .c { position: relative; width: 50px; height: 50px; overflow: clip; } .s { height: 0; } .a { margin-top: 20px; } .p { top: anchor(bottom); left: anchor(left); }', body: INSIDE, drawn: true, refused: false },
  { name: 'an anchor in view', css: '.c { position: relative; width: 50px; height: 50px; } .p { top: anchor(bottom); left: 0; }', body: OUTSIDE, drawn: true, refused: false },
];

describe('an anchored box whose default anchor may be hidden from view', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchChrome(1);
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });
  for (const c of CASES) {
    it(`${c.name}: ${c.drawn ? 'Chrome draws it' : 'Chrome hides it'}, and Dragon ${c.refused ? 'refuses it by name' : 'lays it out where Chrome draws it'}`, async () => {
      const html = doc(c.css, c.body);
      let hidden: boolean | null = null;
      const capture = await captureFixture(browser, 'anchor-visibility', html, ENVIRONMENT, [], async (page) => {
        hidden = await page.evaluate(() => {
          const p = document.querySelector('.p') as Element;
          const r = p.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== p;
        });
      });
      expect(hidden).toBe(!c.drawn);
      const compiled = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport }).compile(fixtureToInput('anchor-visibility', html));
      const errors = compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
      if (c.refused) {
        expect(errors.length, errors.join(' | ')).toBe(1);
        expect(errors[0]).toMatch(/^the default anchor a of p is (not visible|inside c, which clips its overflow inside p's containing block): Chrome hides an anchored box whose default anchor is invisible or clipped out of view \(position-visibility: anchors-visible/);
        return;
      }
      expect(errors).toEqual([]);
      const p = nativeProgramFor(compiled, [], 'ios');
      if (p.kind !== 'ready') throw new Error(p.reason);
      const parent = new Map(p.program.nodes.map((n) => [n.id, n.parent]));
      const boxes = new Map(engineBoxes(p.program, ENVIRONMENT.viewport, 1).map((b) => [b.id, b]));
      const absolute = (id: string): readonly number[] => {
        const b = boxes.get(id);
        if (b === undefined) throw new Error(`no engine box ${id}`);
        const up = parent.get(id) ?? null;
        const o = up === null ? [0, 0] : absolute(up);
        return [(o[0] as number) + b.x / 64, (o[1] as number) + b.y / 64, b.width / 64, b.height / 64];
      };
      const chrome = capture.nodes.find((n) => n.id === 'p' && n.hasBox);
      expect(chrome === undefined ? null : [chrome.x, chrome.y, chrome.width, chrome.height]).toEqual(absolute('p'));
    }, 120_000);
  }
});
