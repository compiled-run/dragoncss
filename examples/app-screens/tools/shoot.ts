// Shoots each screen in Chrome 145 (the reference) at an iPhone and a Pixel viewport: full-page PNGs in out/chrome/.
// Usage: CHROME=<chrome-headless-shell path> node examples/app-screens/tools/shoot.ts
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../../packages/parity/package.json', import.meta.url))('playwright') as { chromium: { launch(o: object): Promise<any> } };
const SCREENS = ['onboarding', 'settings', 'signup', 'article', 'feed'];
const DEVICES = [{ id: 'ios-390x844', width: 390, height: 844, dpr: 3 }, { id: 'android-412x915', width: 412, height: 915, dpr: 2.625 }];
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--force-color-profile=srgb', '--allow-file-access-from-files'] });
mkdirSync('examples/app-screens/out/chrome', { recursive: true });
for (const d of DEVICES) {
  const ctx = await browser.newContext({ viewport: { width: d.width, height: d.height }, deviceScaleFactor: d.dpr, isMobile: false, hasTouch: true });
  for (const s of SCREENS) {
    const page = await ctx.newPage();
    await page.goto(new URL(`../pages/${s}.html`, import.meta.url).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `examples/app-screens/out/chrome/${s}-${d.id}.png`, fullPage: false });
    await page.close();
  }
}
console.log(browser.version());
await browser.close();
