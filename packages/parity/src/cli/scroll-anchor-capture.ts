// REPL-r2a ruling 2: Chrome's scroll offset after an img that follows its image loads, for each scroll-anchor.ts case at each DPR:
// scrolled first, then the src set and decoded. Run with: pnpm run parity:scroll-anchor-capture
import { writeFileSync } from 'node:fs';
import { launchChrome } from '../chrome.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';
import type { ScrollAnchorCapture } from '../scroll-anchor.ts';
import { pngUrl, SCROLL_ANCHOR_CASES, SCROLL_ANCHOR_DPRS, SCROLL_ANCHOR_VIEWPORT, scrollAnchorHtml, scrollAnchorPath } from '../scroll-anchor.ts';

const platform = hostPlatform();
if (platform !== REFERENCE_PLATFORM) throw new Error(`scroll-anchor captures are taken on the reference platform ${REFERENCE_PLATFORM}, not ${platform}`);
const out: ScrollAnchorCapture['cases'][number][] = [];
let chrome = '';
for (const dpr of SCROLL_ANCHOR_DPRS) {
  const browser = await launchChrome(dpr);
  chrome = browser.version();
  try {
    for (const c of SCROLL_ANCHOR_CASES) {
      const context = await browser.newContext({ viewport: SCROLL_ANCHOR_VIEWPORT, deviceScaleFactor: dpr });
      try {
        const page = await context.newPage();
        await page.setContent(scrollAnchorHtml(c));
        const r = await page.evaluate(async (s: { first: string | null; offset: number; then: string }) => {
          const frames = (): Promise<void> => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
          const img = document.querySelector('img') as HTMLImageElement;
          if (s.first !== null) {
            img.src = s.first;
            await img.decode();
          }
          await frames();
          window.scrollTo(0, s.offset);
          await frames();
          const before = window.scrollY;
          const top = img.getBoundingClientRect().top + before;
          const was = img.getBoundingClientRect().height;
          img.src = s.then;
          await img.decode();
          await frames();
          return { before, after: window.scrollY, top, was, now: img.getBoundingClientRect().height, dpr: window.devicePixelRatio };
        }, { first: c.first === null ? null : pngUrl(c.first), offset: c.offset, then: pngUrl(c.then) });
        if (r.dpr !== dpr) throw new Error(`${c.id}: captured at DPR ${r.dpr}, not ${dpr}`);
        out.push({ id: c.id, dpr, before: r.before, after: r.after, top: r.top, was: r.was, now: r.now });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
const capture: ScrollAnchorCapture = { chrome, cases: out };
writeFileSync(scrollAnchorPath(platform), `${JSON.stringify(capture, null, 2)}\n`);
console.log(`parity:scroll-anchor-capture: ${out.length} cases -> ${scrollAnchorPath(platform)}`);
