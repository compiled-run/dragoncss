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

export type PageEnvironment = {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly direction: 'ltr' | 'rtl';
};

/**
 * The environment direction as the document's base direction (docs/api.md §7), injected identically into the authored and the
 * compiled rendering. A zero-specificity rule on the root sets only direction: a dir attribute would also set unicode-bidi.
 */
export function harnessStyle(env: PageEnvironment): string {
  return `${ahemFontFace()}${env.direction === 'rtl' ? ':where(html){direction:rtl}' : ''}`;
}

/** Opens a page in the case environment, loads the HTML with the harness style injected, and waits for fonts and two frames. */
export async function openPage(browser: Browser, html: string, env: PageEnvironment): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: env.viewport.width, height: env.viewport.height },
    deviceScaleFactor: env.devicePixelRatio,
  });
  const page = await context.newPage();
  const injected = html.replace(/<head>/i, `<head><style data-dragon-harness>${harnessStyle(env)}</style>`);
  if (injected === html) throw new Error('fixture HTML has no <head>');
  await page.setContent(injected);
  await page.evaluate(async () => {
    await document.fonts.load('10px Ahem');
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  if (dpr !== env.devicePixelRatio) throw new Error(`device pixel ratio must be ${env.devicePixelRatio}, got ${dpr}`);
  return page;
}
