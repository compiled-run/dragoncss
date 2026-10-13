// The trace lane's Chrome (trace-capture.ts launchTraceChrome) keeps touch emulation's hover and pointer media through a
// WebPreferences update, and still gives (hover: hover) and (pointer: fine) without touch emulation. Chrome launched with
// Playwright's default --blink-settings pointer and hover types loses them on that update; that is what failed the regen's
// trace-capture step with "(hover: hover) matches under touch emulation", and checkTouchEmulationHolds refuses such a browser.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome } from '../src/chrome.ts';
import { checkTouchEmulationHolds, launchTraceChrome, sendWebPreferencesUpdate } from '../src/trace-capture.ts';

type Media = { hover: boolean; coarse: boolean; fine: boolean; maxTouchPoints: number };

/** The hover and pointer media of a fresh page with touch emulation on or off, before and after a WebPreferences update. */
async function mediaAround(browser: Browser, touch: boolean): Promise<{ before: Media; after: Media }> {
  const context = await browser.newContext({ viewport: { width: 100, height: 100 } });
  try {
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><head></head><body>x</body></html>');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', touch ? { enabled: true, maxTouchPoints: 1 } : { enabled: false });
    const read = (): Promise<Media> => page.evaluate(() => ({ hover: matchMedia('(hover: hover)').matches, coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches, maxTouchPoints: navigator.maxTouchPoints }));
    const before = await read();
    await sendWebPreferencesUpdate(page, cdp);
    return { before, after: await read() };
  } finally {
    await context.close();
  }
}

describe('the trace lane keeps touch emulation through a WebPreferences update', () => {
  let trace: Browser;
  let playwrightDefault: Browser;
  beforeAll(async () => {
    trace = await launchTraceChrome();
    playwrightDefault = await launchChrome(1);
  }, 120_000);
  afterAll(async () => {
    await trace?.close();
    await playwrightDefault?.close();
  });

  it('gives (hover: none) and (pointer: coarse) under touch emulation, before and after the update', async () => {
    // maxTouchPoints falling from 1 to 0 shows the update reached the page (Blink sets it from WebPreferences past the emulation).
    const touch = { hover: false, coarse: true, fine: false };
    expect(await mediaAround(trace, true)).toEqual({ before: { ...touch, maxTouchPoints: 1 }, after: { ...touch, maxTouchPoints: 0 } });
  });

  it('gives (hover: hover) and (pointer: fine) without touch emulation, before and after the update', async () => {
    const mouse: Media = { hover: true, coarse: false, fine: true, maxTouchPoints: 0 };
    expect(await mediaAround(trace, false)).toEqual({ before: mouse, after: mouse });
  });

  it("loses touch emulation's media on the update with Playwright's default flags, and the launch check refuses that browser", async () => {
    const m = await mediaAround(playwrightDefault, true);
    expect(m.before).toEqual({ hover: false, coarse: true, fine: false, maxTouchPoints: 1 });
    expect(m.after).toEqual({ hover: true, coarse: false, fine: true, maxTouchPoints: 0 });
    await expect(checkTouchEmulationHolds(playwrightDefault)).rejects.toThrow('after a WebPreferences update under touch emulation, Chrome reports (hover: hover)');
  });
});
