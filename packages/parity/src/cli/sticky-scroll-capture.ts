// Captures Chrome's sticky boxes at scroll offsets (sticky-scroll.ts) into packages/parity/expected-sticky-scroll/dpr-<N>/<case>.json.
// Run with: pnpm run parity:sticky-scroll-capture
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchChrome } from '../chrome.ts';
import { zoomGuard } from '../dpr.ts';
import { captureStickyScroll, STICKY_SCROLL_DPRS, stickyScrollCases, stickyScrollPath } from '../sticky-scroll.ts';

const cases = stickyScrollCases();
for (const dpr of STICKY_SCROLL_DPRS) {
  const browser = await launchChrome(dpr);
  try {
    if (dpr !== 1) await zoomGuard(browser, dpr);
    for (const c of cases) {
      const capture = await captureStickyScroll(browser, c, dpr);
      const path = stickyScrollPath(c.id, dpr);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(capture)}\n`);
    }
    console.log(`DPR ${dpr}: ${cases.length} sticky scroll captures`);
  } finally {
    await browser.close();
  }
}
