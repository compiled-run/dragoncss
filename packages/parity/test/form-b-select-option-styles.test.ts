// FORM-b: an option's box-sizing, which an app's `* { box-sizing: border-box }` sets, changes nothing Chrome 145 draws for a closed
// select, so it compiles; any other option style stays refused (computed-checks.ts OPTION_UNDRAWN).
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from 'dragon';
import { launchChrome } from '../src/chrome.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';

const page = (extra: string): string =>
  `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; font-family: Ahem; font-size: 10px; }\nselect { display: block; width: 120px; font: inherit; color: #000; border: 1px solid #036; background-color: #fff; padding: 2px; }\n${extra}\n</style>\n</head>\n<body data-dragon-id="body"><select data-dragon-id="s"><option data-dragon-id="o1">XX</option><option data-dragon-id="o2">XXXX</option></select></body>\n</html>\n`;
const errors = (html: string): string[] =>
  createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport })
    .compile(fixtureToInput('select-option-styles', html))
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message);

describe("an option's box-sizing", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchChrome(2);
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('changes neither the closed select\'s box nor its pixels in Chrome, and compiles', async () => {
    const shot = async (html: string): Promise<{ box: unknown; png: string }> => {
      const p = await browser.newPage({ viewport: { width: 200, height: 60 } });
      await p.setContent(html);
      const box = await p.locator('select').boundingBox();
      const png = (await p.screenshot()).toString('base64');
      await p.close();
      return { box, png };
    };
    const plain = await shot(page(''));
    for (const value of ['border-box', 'content-box']) {
      const styled = await shot(page(`option { box-sizing: ${value}; }`));
      expect(styled.box, value).toEqual(plain.box);
      expect(styled.png === plain.png, `${value}: the screenshots differ`).toBe(true);
    }
    expect(errors(page('* { box-sizing: border-box; }')).filter((m) => m.includes('<option>'))).toEqual([]);
  });

  it('keeps every other option style refused', () => {
    expect(errors(page('option { color: #c00; }'))).toContainEqual(expect.stringMatching(/^color on <option> o1 is not supported/));
  });
});
