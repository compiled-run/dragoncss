// ENV-SAFE: env() is read before var() is substituted. Chrome takes only a literal env() name, so a var() name drops the declaration
// (or, in a custom property, makes it invalid at computed-value time), and it never uses a safe-area name's fallback. Each shape is
// rendered live in Chrome under non-zero insets, and Dragon must refuse it with a message that says what Chrome does.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from 'dragon';
import { launchChrome, openPage } from '../src/chrome.ts';
import { withSafeArea } from '../src/env-run.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { hostPlatform, REFERENCE_PLATFORM, requireReferencePlatform } from '../src/platform.ts';

const INSETS = { top: 47, right: 7, bottom: 34, left: 3 };

const doc = (css: string): string => `<!DOCTYPE html>
<html data-dragon-id="html">
<head>
<style>
body { margin: 0; }
${css}
</style>
</head>
<body data-dragon-id="body">
<div data-dragon-id="x" class="x"></div>
</body>
</html>
`;

/** Each shape: its CSS, the padding-top Chrome computes under INSETS, and how Dragon's refusal must describe it. */
const SHAPES: readonly { readonly name: string; readonly css: string; readonly chrome: string; readonly message: RegExp }[] = [
  { name: 'a var() name', css: '.x { --a: safe-area-inset-top; padding-top: 9px; padding-top: env(var(--a)); }', chrome: '9px', message: /names its variable with var\(\), and Chrome takes only a literal name, so it drops the declaration/ },
  { name: 'a var() name inside calc()', css: '.x { --a: safe-area-inset-top; padding-top: 9px; padding-top: calc(env(var(--a)) + 1px); }', chrome: '9px', message: /names its variable with var\(\)/ },
  { name: 'a var() name in a var() fallback', css: '.x { --a: safe-area-inset-top; padding-top: 9px; padding-top: var(--q, env(var(--a))); }', chrome: '9px', message: /names its variable with var\(\)/ },
  { name: 'a var() name through a custom property', css: '.x { --a: safe-area-inset-top; --p: env(var(--a)); padding-top: 9px; padding-top: var(--p); }', chrome: '0px', message: /in a custom property, makes it invalid at computed-value time/ },
  { name: 'a var() in a safe-area name\'s fallback', css: '.x { padding-top: env(safe-area-inset-top, var(--missing)); }', chrome: '47px', message: /Chrome never uses a safe-area name's fallback and renders the inset, but Dragon does not substitute var\(\) inside env\(\)/ },
];

let browser: Browser;
beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
});
afterAll(async () => {
  await browser.close();
});

describe('env() holding var(): Chrome under non-zero insets, and Dragon refuses', () => {
  for (const s of SHAPES) {
    it(s.name, async () => {
      const html = doc(s.css);
      const page = await openPage(browser, html, ENVIRONMENT);
      try {
        await withSafeArea(INSETS)(page);
        expect(await page.evaluate(() => getComputedStyle(document.querySelector('.x') as Element).paddingTop)).toBe(s.chrome);
      } finally {
        await page.context().close();
      }
      const project = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem' });
      const c = project.compile(fixtureToInput('env-var', html));
      expect(c.outputs.web.kind).toBe('blocked');
      const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE' && s.message.test(x.message));
      expect(d, c.diagnostics.map((x) => `${x.code} ${x.message}`).join('\n')).toBeDefined();
    });
  }
});
