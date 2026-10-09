// Regenerates packages/parity/expected-resize/<case>/<rendering>-dpr<z>.json from live Chrome (notes/T067 R7 (a)): every resize
// case's script on its authored rendering at DPR 1, 2, 2.625 and 3, and on its compiled web rendering at DPR 1 (chrome-dual).
// Directories of cases that no longer exist are removed. Run with: pnpm run parity:resize-capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launchChrome } from '../chrome.ts';
import { zoomGuard } from '../dpr.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';
import type { Browser } from 'playwright';
import type { PointerReadings } from 'dragon';
import { blinkPointerArgs, captureResize, expectedResizeDir, RESIZE_DPRS, resizeCaptureJson, resizeCapturePath, resizeCases, resizePixelsPath } from '../resize-capture.ts';
import { requireSoftwareRaster } from '../pixel-reference.ts';

requireReferencePlatform(hostPlatform());
const dir = expectedResizeDir();
mkdirSync(dir, { recursive: true });
const cases = resizeCases();
const ids = new Set(cases.map((c) => c.id));
for (const d of readdirSync(dir)) if (!ids.has(d)) rmSync(join(dir, d), { recursive: true });
// Each case's pixels are rewritten whole, so a step a script no longer has leaves no stale PNG behind.
for (const d of readdirSync(dir)) for (const p of readdirSync(join(dir, d))) if (p.startsWith('pixels-dpr')) rmSync(join(dir, d, p), { recursive: true });
let samples = 0;
for (const dpr of RESIZE_DPRS) {
  // MQ-R2: one more Chrome per set of pointer readings a script's pointers step names, each held to the same DPR and raster checks.
  const launched: Browser[] = [];
  const pixels = dpr !== 1;
  const launch = async (extra: readonly string[]): Promise<Browser> => {
    const b = await launchChrome(dpr, extra);
    launched.push(b);
    // The launch must lay out at the DPR, not only report it (dpr.ts zoomGuard); DPR 1 has no guard value and needs none.
    if (dpr !== 1) await zoomGuard(b, dpr);
    // MQ-R1 PR 2: at the device DPRs, Chrome's pixels after every step, on the software raster path as the pixel lane requires.
    if (pixels) await requireSoftwareRaster(async () => {
      const cdp = await b.newBrowserCDPSession();
      try {
        return await cdp.send('SystemInfo.getInfo');
      } finally {
        await cdp.detach();
      }
    });
    return b;
  };
  const byReadings = new Map<string, Promise<Browser>>();
  const browserFor = (p: PointerReadings): Promise<Browser> => {
    const args = blinkPointerArgs(p);
    const key = args.join(' ');
    let b = byReadings.get(key);
    if (b === undefined) {
      b = launch(args);
      byReadings.set(key, b);
    }
    return b;
  };
  try {
    const browser = await launch([]);
    for (const c of cases) {
      for (const r of dpr === 1 ? (['authored', 'compiled'] as const) : (['authored'] as const)) {
        const shot = pixels && r === 'authored' ? (step: number, png: Buffer): void => {
          const path = resizePixelsPath(c.id, dpr, step);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, png);
        } : null;
        const cap = await captureResize(browser, c, dpr, r, shot, browserFor);
        const path = resizeCapturePath(c.id, r, dpr);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, resizeCaptureJson(cap));
        samples += cap.samples.length;
      }
    }
  } finally {
    for (const b of launched) await b.close();
  }
}
console.log(`parity:resize-capture: ${cases.length} resize cases, ${samples} samples over DPRs ${RESIZE_DPRS.join(', ')} (compiled rendering at DPR 1)`);
