// FORM-b search field narrower than its cancel button and margins: Chrome 145 shrinks the editor to 0 and lets the cancel button
// overflow the content box from its inline start; the engine must place both parts where Chrome does at every device pixel ratio.
import type { Browser } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic } from 'dragon';
import * as dragon from 'dragon';
import { ahemMeasurer, layout as engineLayout } from '@dragon/layout';
import { captureFixture } from '../src/capture.ts';
import { launchChrome } from '../src/chrome.ts';
import { atDpr } from '../src/dpr.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';

const WIDTHS = [8, 10, 13, 18, 19, 20];
const html = `<!DOCTYPE html>
<html data-dragon-id="html">
<head>
<style>
body { margin: 0; font-family: Ahem; font-size: 10px; }
input { display: block; font: inherit; appearance: none; margin: 0 0 2px; color: #000; background-color: #fff; border: 2px solid #036; padding: 1px 2px; }
${WIDTHS.map((w) => `.w${w} { width: ${w}px; }`).join('\n')}
</style>
</head>
<body data-dragon-id="body">
${WIDTHS.map((w) => `<input data-dragon-id="n${w}" readonly="" type="search" class="w${w}" value="XX">`).join('\n')}
</body>
</html>
`;

type Rect = { x: number; y: number; width: number; height: number };
const errors = (c: Compiled<string>): string[] => c.diagnostics.filter((d: Diagnostic) => d.severity === 'error').map((d) => d.message);

function engineRects(dpr: number): Map<string, Rect> {
  const c = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem', hostTextEditing: true }).compile(fixtureToInput('search-cancel-narrow', html));
  expect(errors(c)).toEqual([]);
  const p = dragon.iosLayoutProjection(c, atDpr(ENVIRONMENT, dpr), []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const r = engineLayout(p.input, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  const u = 64 * dpr;
  return new Map(r.boxes.map((b) => [b.id, { x: b.x / u, y: b.y / u, width: b.width / u, height: b.height / u }]));
}

describe('a search field narrower than its cancel button and margins', () => {

  for (const dpr of [1, 2, 2.625, 3]) {
    it(`places the editor and the cancel button where Chrome 145 does at DPR ${dpr}`, async () => {
      // One launch per DPR with the device scale factor forced, as parity:dpr-capture takes the committed DPR captures.
      const browser: Browser = await launchChrome(dpr);
      let chrome;
      try {
        chrome = await captureFixture(browser, 'search-cancel-narrow', html, atDpr(ENVIRONMENT, dpr));
      } finally {
        await browser.close();
      }
      const byId = new Map(chrome.nodes.map((n) => [n.id, n]));
      const ours = engineRects(dpr);
      for (const w of WIDTHS) {
        const field = byId.get(`n${w}`);
        if (field === undefined) throw new Error(`n${w}: not captured`);
        for (const part of ['editor', 'cancel']) {
          const c = byId.get(`n${w}::${part}`);
          const e = ours.get(`n${w}::${part}`);
          if (c === undefined || e === undefined) throw new Error(`n${w}::${part}: missing (chrome ${c !== undefined}, engine ${e !== undefined})`);
          const rel = { x: c.x - field.x, y: c.y - field.y, width: c.width, height: c.height };
          expect([`n${w}::${part}`, e.x, e.y, e.width, e.height].map((v) => (typeof v === 'number' ? Math.round(v * 64) / 64 : v))).toEqual([`n${w}::${part}`, rel.x, rel.y, rel.width, rel.height].map((v) => (typeof v === 'number' ? Math.round(v * 64) / 64 : v)));
        }
      }
    }, 60_000);
  }
});
