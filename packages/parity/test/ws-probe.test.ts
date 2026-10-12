// Scratch probe (removed before the PR): Chrome's line rects for white-space preserve modes.
import { expect, it } from 'vitest';
import { captureFixture } from '../src/capture.ts';
import { launchChrome } from '../src/chrome.ts';
import { ENVIRONMENT, RTL_ENVIRONMENT } from '../src/fixtures.ts';
import { fontDataUrl, vendorFontBytes } from '../src/font-reference.ts';

const CASES: readonly (readonly [string, string, string])[] = [
  ['pw-hang', 'white-space:pre-wrap', 'XXXXXXXX    XX'],
  ['bs', 'white-space:break-spaces', 'XXXXXXXX    XX'],
  ['pre-nl', 'white-space:pre', 'XX  XX\nXXXXXXXXXXXXX'],
  ['pl', 'white-space:pre-line', '  XX   XX  \n  XX'],
  ['pw-lead-nl', 'white-space:pre-wrap', '\n\nXX'],
  ['pw-trail-nl', 'white-space:pre-wrap', 'XX\n'],
  ['pre-edge', 'white-space:pre', '   XX   '],
  ['pw-sp-nl', 'white-space:pre-wrap', 'XX  \nXX'],
  ['pw-over-nl', 'white-space:pre-wrap', 'XXXXXXXXX   \nXX'],
  ['pw-long', 'white-space:pre-wrap', 'XXXXXXXXXXXX  XX'],
  ['pw-lead', 'white-space:pre-wrap', '    XXXXXXXXXX'],
  ['pw-center', 'white-space:pre-wrap;text-align:center', 'XX  '],
  ['pw-right', 'white-space:pre-wrap;text-align:right', 'XX    XX  '],
  ['pw-words', 'white-space:pre-wrap', 'XX XX XX XX XX'],
  ['pw-only', 'white-space:pre-wrap', '   '],
  ['pw-sp2', 'white-space:pre-wrap', 'XXXXXXXXXX  XX'],
  ['pw-sp3', 'white-space:pre-wrap', 'XXXXXXX     XXXXXXX'],
  ['pre-ib', 'white-space:pre-wrap;display:inline-block;width:auto', 'XX   '],
  ['bs-ib', 'white-space:break-spaces;display:inline-block;width:auto', 'XX   '],
  ['pre-ib2', 'white-space:pre;display:inline-block;width:auto', 'XX   '],
  ['pl-ib', 'white-space:pre-line;display:inline-block;width:auto', 'XX   XX\nX'],
  ['pre-nl-nl', 'white-space:pre', 'XX\n\nXX\n'],
  ['pw-nl-sp', 'white-space:pre-wrap', 'XX\n   XX'],
  ['pre-nowrap-long', 'white-space:pre', 'XX XX XX XX XX XX'],
  ['lato-pw', 'white-space:pre-wrap;font-family:Lato;font-size:16px', 'Hello  world  again  and  more'],
  ['lato-pre', 'white-space:pre;font-family:Lato;font-size:16px', 'Hi  there\nfriend  '],
  ['lato-pl', 'white-space:pre-line;font-family:Lato;font-size:16px', ' Hi   there \n  friend'],
];

const html = (): string => {
  const lato = `@font-face{font-family:Lato;src:url("${fontDataUrl(vendorFontBytes('Lato/Lato-Regular.ttf'))}")}`;
  const divs = CASES.map(([id, css, text]) => `<div data-dragon-id="${id}" style="width:100px;${css}">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('');
  return `<!DOCTYPE html><html data-dragon-id="html"><head><style>${lato} body{margin:0;font-family:Ahem;font-size:10px}</style></head><body data-dragon-id="body">${divs}</body></html>`;
};

it('dumps Chrome rects', async () => {
  const browser = await launchChrome();
  const out: string[] = [];
  try {
    for (const env of [ENVIRONMENT, RTL_ENVIRONMENT]) {
      const cap = await captureFixture(browser, 'ws-probe', html(), env);
      for (const n of cap.nodes) {
        if (n.id === 'html' || n.id === 'body') continue;
        out.push(`${env.direction} ${n.id} ${n.kind} x=${n.x} y=${n.y} w=${n.width} h=${n.height}`);
      }
    }
  } finally {
    await browser.close();
  }
  expect(out.join('\n')).toBe('');
}, 120_000);
