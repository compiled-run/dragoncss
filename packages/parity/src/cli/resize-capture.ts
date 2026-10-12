// Regenerates packages/parity/expected-resize/<case>/<rendering>-dpr<z>.json from live Chrome (notes/T067 R7 (a)): every resize
// case's script on its authored rendering at DPR 1, 2, 2.625 and 3, and on its compiled web rendering at DPR 1 (chrome-dual).
// Directories of cases that no longer exist are removed. Run with: pnpm run parity:resize-capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launchChrome } from '../chrome.ts';
import { zoomGuard } from '../dpr.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';
import { captureResize, expectedResizeDir, RESIZE_DPRS, resizeCaptureJson, resizeCapturePath, resizeCases } from '../resize-capture.ts';

requireReferencePlatform(hostPlatform());
const dir = expectedResizeDir();
mkdirSync(dir, { recursive: true });
const cases = resizeCases();
const ids = new Set(cases.map((c) => c.id));
for (const d of readdirSync(dir)) if (!ids.has(d)) rmSync(join(dir, d), { recursive: true });
let samples = 0;
for (const dpr of RESIZE_DPRS) {
  const browser = await launchChrome(dpr);
  try {
    // The launch must lay out at the DPR, not only report it (dpr.ts zoomGuard); DPR 1 has no guard value and needs none.
    if (dpr !== 1) await zoomGuard(browser, dpr);
    for (const c of cases) {
      for (const r of dpr === 1 ? (['authored', 'compiled'] as const) : (['authored'] as const)) {
        const cap = await captureResize(browser, c, dpr, r);
        const path = resizeCapturePath(c.id, r, dpr);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, resizeCaptureJson(cap));
        samples += cap.samples.length;
      }
    }
  } finally {
    await browser.close();
  }
}
console.log(`parity:resize-capture: ${cases.length} resize cases, ${samples} samples over DPRs ${RESIZE_DPRS.join(', ')} (compiled rendering at DPR 1)`);
