// T065 ANIM-mq: the web output writes one transition and animation list per element and case (emit/web-css.ts), and its @media
// blocks carry the milestone longhands only. Chrome decides between the two documents below: a transition declared inside @media
// changes the element's lists between viewport widths, so Dragon refuses it on web; a transition declared outside @media, with a
// banded width, keeps one list, and the compiled web CSS gives Chrome's computed lists of the authored CSS at both widths.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS, webClassMap } from 'dragon';
import { launchChrome, openPage } from '../src/chrome.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { compiledFixtureHtml, fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { spanText, webCssOf } from '../src/pipeline.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';

const LISTS = ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'animation-name', 'animation-duration'];
const doc = (css: string): string =>
  `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; }\n${css}\n</style>\n</head>\n<body data-dragon-id="body">\n<div data-dragon-id="a" class="a"></div>\n</body>\n</html>\n`;
const compile = (html: string) =>
  createProjectWith(
    { projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } },
    { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport },
  ).compile(fixtureToInput('anim-bands', html));

let browser: Browser;
beforeAll(async () => {
  browser = await launchChrome(1);
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

const listsAt = async (html: string, width: number): Promise<Record<string, string>> => {
  const page = await openPage(browser, html, { ...ENVIRONMENT, viewport: { width, height: 300 } });
  try {
    return await page.evaluate((props) => {
      const cs = getComputedStyle(document.querySelector('[data-dragon-id="a"]') as Element);
      return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    }, LISTS);
  } finally {
    await page.context().close();
  }
};

describe('transition and animation lists across @media bands on web (ANIM-mq)', () => {
  it('refuses on web a transition declared inside @media, whose lists Chrome changes between the bands; ios is not refused for it', async () => {
    const html = doc('.a { width: 10px; height: 4px; transition: none; }\n@media (min-width: 600px) { .a { width: 20px; transition: width 1s; } }');
    const narrow = await listsAt(html, 400);
    const wide = await listsAt(html, 800);
    expect([narrow['transition-property'], wide['transition-property']]).toEqual(['none', 'width']);
    const compiled = compile(html);
    const input = fixtureToInput('anim-bands', html);
    const banded = compiled.diagnostics.filter((d) => d.message.includes('(package ANIM-mq)'));
    expect(banded.map((d) => [d.code, d.target, spanText(input, d.origin)])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'web', 'width 1s']]);
    expect(compiled.outputs.web.kind).toBe('blocked');
    expect(compiled.outputs.ios.kind).not.toBe('blocked');
  }, 120_000);

  it('keeps a transition declared outside @media, with a banded width: the compiled lists equal the authored ones in Chrome at both widths', async () => {
    const html = doc('.a { width: 10px; height: 4px; transition: width 1s ease-in 0.5s; }\n@media (min-width: 600px) { .a { width: 20px; } }');
    const compiled = compile(html);
    expect(compiled.diagnostics.filter((d) => d.message.includes('(package ANIM-mq)'))).toEqual([]);
    const css = webCssOf(compiled);
    if (css === null) throw new Error(`web output blocked: ${compiled.diagnostics.map((d) => d.message).join('; ')}`);
    const classOf = webClassMap(compiled, []);
    if (classOf === null) throw new Error('no web class map');
    const built = compiledFixtureHtml(html, css, classOf);
    for (const width of [400, 800]) expect(await listsAt(built, width), `${width}px`).toEqual(await listsAt(html, width));
  }, 120_000);
});
