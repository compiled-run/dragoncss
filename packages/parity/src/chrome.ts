// Pinned Chrome for the parity lane: Playwright 1.58.2 with its cached chromium-1208, DPR 1, Ahem as a data URI.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { repoPath } from './paths.ts';
import { hostPlatform, REFERENCE_PLATFORM } from './platform.ts';

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

/** The flags of a launch at a forced device scale factor: CHROME_ARGS with only --force-device-scale-factor set to N. */
export function chromeArgsAt(forceDeviceScaleFactor: number): readonly string[] {
  return CHROME_ARGS.map((a) => (a === '--force-device-scale-factor=1' ? `--force-device-scale-factor=${forceDeviceScaleFactor}` : a));
}

let ahemFace: string | null = null;

export function ahemFontFace(): string {
  if (ahemFace === null) {
    const b64 = readFileSync(repoPath('vendor/fonts/Ahem.ttf')).toString('base64');
    ahemFace = `@font-face{font-family:Ahem;src:url(data:font/ttf;base64,${b64}) format("truetype")}`;
  }
  return ahemFace;
}

const launchArgs = new WeakMap<Browser, readonly string[]>();

/** The flags a browser was started with (launchChrome, or recordLaunchArgs for another launcher), or null when unknown (chrome-memo.ts keys by them). */
export const launchArgsOf = (browser: Browser): readonly string[] | null => launchArgs.get(browser) ?? null;

/** Records the flags of a browser started by another launcher over launchChrome's (scroll-metrics.ts launchOverlayChrome). */
export function recordLaunchArgs(browser: Browser, args: readonly string[]): void {
  launchArgs.set(browser, args);
}

/**
 * The pointer and hover types Playwright's headless launch passes to Blink. Blink writes --blink-settings straight into the page
 * settings on every WebPreferences update (WebViewImpl::UpdateWebPreferences, ApplyCommandLineToSettings), past DevTools touch
 * emulation, so a page under Emulation.setTouchEmulationEnabled gets (hover: hover) and (pointer: fine) back.
 */
export const PLAYWRIGHT_POINTER_SETTINGS = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';

/**
 * Launches the pinned Chrome; forceDeviceScaleFactor is 1 for every milestone-1 lane and N for a device-DPR capture.
 * withoutPointerSettings drops PLAYWRIGHT_POINTER_SETTINGS, so the page's pointer and hover come from Chrome alone (or from extra).
 * extra: more flags after CHROME_ARGS (MQ-R2: a resize capture's --blink-settings pointer readings).
 */
/**
 * On the reference platform every launch with Playwright's pointer settings has overlay scrollbars (launchOverlayChrome
 * below), so a scroll case captured through any caller (profile:rows, vectors, report) meets the overlay-scrollbar
 * rule (capture.ts). --hide-scrollbars already hides every scrollbar, so no other capture changes.
 */
export async function launchChrome(forceDeviceScaleFactor: number = 1, opts: { readonly withoutPointerSettings?: boolean; readonly extra?: readonly string[] } = {}): Promise<Browser> {
  const args = [...chromeArgsAt(forceDeviceScaleFactor), ...(opts.extra ?? [])];
  const without = opts.withoutPointerSettings === true;
  if (!without && hostPlatform() === REFERENCE_PLATFORM) return launchOverlayChrome(forceDeviceScaleFactor);
  const browser = await chromium.launch({ args: [...args], ...(without ? { ignoreDefaultArgs: [PLAYWRIGHT_POINTER_SETTINGS] } : {}) });
  launchArgs.set(browser, without ? [...args, `!${PLAYWRIGHT_POINTER_SETTINGS}`] : args);
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
  /** 'ahem': the fixture environment sets the root font-family to Ahem (docs/api.md §10.1); 'ua-default' keeps Chrome's. */
  readonly rootFont: 'ahem' | 'ua-default';
};

/**
 * The environment root font and direction (docs/api.md §7, §10.1), injected identically into the authored and the compiled
 * rendering. Zero-specificity rules on the root set only font-family and direction: a dir attribute would also set unicode-bidi,
 * and any authored rule on html wins over them.
 */
export function harnessStyle(env: PageEnvironment): string {
  return `${ahemFontFace()}${env.rootFont === 'ahem' ? ':where(html){font-family:Ahem}' : ''}${env.direction === 'rtl' ? ':where(html){direction:rtl}' : ''}`;
}

/** The fixture HTML with the harness style injected first in its head: the one place the harness environment reaches a page. */
export function injectHarness(html: string, env: PageEnvironment): string {
  const injected = html.replace(/<head>/i, `<head><style data-dragon-harness>${harnessStyle(env)}</style>`);
  if (injected === html) throw new Error('fixture HTML has no <head>');
  return injected;
}

/** Opens a page in the case environment, loads the HTML with the harness style injected, and waits for fonts and two frames. */
export async function openPage(browser: Browser, html: string, env: PageEnvironment): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: env.viewport.width, height: env.viewport.height },
    deviceScaleFactor: env.devicePixelRatio,
  });
  const page = await context.newPage();
  const injected = injectHarness(html, env);
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

/**
 * T065 R2: openPage for a frame fixture, with every animation held by the frozen document timeline (CDP
 * Animation.setPlaybackRate 0 before the content loads), so a frame capture moves time only by setting currentTime. The page
 * navigates to a fresh document (a routed URL) rather than setContent: setContent rewrites about:blank, whose timeline ran
 * before the rate was set, so it froze at a few milliseconds instead of 0.
 */
const FROZEN_URL = 'http://dragon.test/frame';

export async function openFrozenPage(browser: Browser, html: string, env: PageEnvironment): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: env.viewport.width, height: env.viewport.height }, deviceScaleFactor: env.devicePixelRatio });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  const injected = injectHarness(html, env);
  await page.route(FROZEN_URL, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: injected }));
  await page.goto(FROZEN_URL);
  await page.evaluate(async () => {
    await document.fonts.load('10px Ahem');
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  if (dpr !== env.devicePixelRatio) throw new Error(`device pixel ratio must be ${env.devicePixelRatio}, got ${dpr}`);
  const t = await page.evaluate(() => document.timeline.currentTime);
  if (t !== 0) throw new Error(`the document timeline is not frozen at 0: ${String(t)}`);
  return page;
}

/**
 * NSUserDefaults argument-domain pair that makes this Chrome process use overlay scrollbars whatever the machine's setting or
 * mouse; it changes no system setting. Playwright refuses a launch argument that does not start with "-", so a wrapper script
 * appends the pair when it execs the headless shell Playwright would launch.
 */
export const SCROLLBAR_ARGS: readonly string[] = ['-AppleShowScrollBars', 'WhenScrolling'];

/** The chromium-headless-shell executable Playwright launches by default (its registry). */
function headlessShellPath(): string {
  const own = createRequire(import.meta.url);
  const pw = createRequire(own.resolve('playwright'));
  const core = pw.resolve('playwright-core');
  // Under vitest playwright-core resolves to index.mjs, so take its directory rather than rewriting the file name.
  const { registry } = pw(join(dirname(core), 'lib/server/registry/index.js')) as { registry: { findExecutable(n: string): { executablePath(): string | undefined } | undefined } };
  const path = registry.findExecutable('chromium-headless-shell')?.executablePath();
  if (path === undefined) throw new Error(`Playwright ${PLAYWRIGHT_VERSION} names no chromium-headless-shell executable`);
  return path;
}

/** launchChrome (chrome.ts) with SCROLLBAR_ARGS; the wrapper directory is removed once Chrome has started or failed to. */
export async function launchOverlayChrome(forceDeviceScaleFactor: number): Promise<Browser> {
  const dir = mkdtempSync(`${tmpdir()}/dragon-scroll-chrome-`);
  try {
    const wrapper = `${dir}/chrome`;
    const quoted = (a: string): string => `'${a.replaceAll("'", "'\\''")}'`;
    writeFileSync(wrapper, `#!/bin/sh\nexec ${quoted(headlessShellPath())} "$@" ${SCROLLBAR_ARGS.map(quoted).join(' ')}\n`);
    chmodSync(wrapper, 0o755);
    const browser = await chromium.launch({ executablePath: wrapper, args: [...chromeArgsAt(forceDeviceScaleFactor)] });
    if (browser.version() !== CHROME_VERSION) {
      await browser.close();
      throw new Error(`Chrome must be ${CHROME_VERSION} (Playwright ${PLAYWRIGHT_VERSION}), got ${browser.version()}`);
    }
    launchArgs.set(browser, [...chromeArgsAt(forceDeviceScaleFactor), ...SCROLLBAR_ARGS]);
    return browser;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
