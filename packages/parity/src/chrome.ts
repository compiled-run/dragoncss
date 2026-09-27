// Pinned Chrome for the parity lane: Playwright 1.58.2 with its cached chromium-1208, DPR 1, Ahem as a data URI.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { repoPath } from './paths.ts';

export const CHROME_VERSION = '145.0.7632.6';
export const PLAYWRIGHT_VERSION = '1.58.2';

/** T001 §5 flags. */
export const CHROME_ARGS: readonly string[] = [
  '--force-device-scale-factor=1',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--hide-scrollbars',
];

let ahemFace: string | null = null;

export function ahemFontFace(): string {
  if (ahemFace === null) {
    const b64 = readFileSync(repoPath('vendor/fonts/Ahem.ttf')).toString('base64');
    ahemFace = `@font-face{font-family:Ahem;src:url(data:font/ttf;base64,${b64}) format("truetype")}`;
  }
  return ahemFace;
}

export async function launchChrome(): Promise<Browser> {
  const browser = await chromium.launch({ args: [...CHROME_ARGS] });
  const version = browser.version();
  if (version !== CHROME_VERSION) {
    await browser.close();
    throw new Error(`Chrome must be ${CHROME_VERSION} (Playwright ${PLAYWRIGHT_VERSION}), got ${version}`);
  }
  return browser;
}

/** Opens a page at the given viewport, loads the HTML with the Ahem face injected, and waits for fonts and two frames. */
export async function openPage(browser: Browser, html: string, viewport: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const injected = html.replace(/<head>/i, `<head><style data-dragon-harness>${ahemFontFace()}</style>`);
  if (injected === html) throw new Error('fixture HTML has no <head>');
  await page.setContent(injected);
  await page.evaluate(async () => {
    await document.fonts.load('10px Ahem');
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  if (dpr !== 1) throw new Error(`device pixel ratio must be 1, got ${dpr}`);
  return page;
}
