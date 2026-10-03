// Captures Chrome's scroll metrics of every overflow and viewport-prop case at DPR 1, 2, 3 and 2.625 (one launch per DPR under
// chromeArgsAt, with the zoom guard before and after, each page checked for overlay scrollbars first) into
// packages/parity/expected-scroll/<platform>/dpr-<N>/<case>.scroll.json.
// Run with: pnpm run parity:scroll-capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { launchChrome } from '../chrome.ts';
import { atDpr, zoomGuard } from '../dpr.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';
import { captureScrollMetrics, expectedScrollDir, expectedScrollPath, SCROLL_DPRS, scrollCaptureJson, scrollCases } from '../scroll-metrics.ts';

const platform = hostPlatform();
if (platform !== REFERENCE_PLATFORM) throw new Error(`scroll captures are taken on the reference platform ${REFERENCE_PLATFORM}, not ${platform}`);
const cases = scrollCases().flatMap((f) => f.cases);
console.log(`parity:scroll-capture: ${cases.length} cases per DPR; DPRs ${SCROLL_DPRS.join(', ')}`);
for (const dpr of SCROLL_DPRS) {
  const dir = expectedScrollDir(dpr, platform);
  const browser = await launchChrome(dpr);
  try {
    if (dpr !== 1) await zoomGuard(browser, dpr);
    // Every case is captured before the committed files are replaced, so a failed run leaves them as they were.
    const captured: [string, string][] = [];
    for (const c of cases) {
      const capture = await captureScrollMetrics(browser, c.id, c.authoredHtml, atDpr(c.environment, dpr));
      captured.push([expectedScrollPath(c.id, dpr, platform), scrollCaptureJson(capture)]);
    }
    if (dpr !== 1) await zoomGuard(browser, dpr);
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (f.endsWith('.scroll.json')) rmSync(`${dir}/${f}`);
    for (const [path, json] of captured) writeFileSync(path, json);
    const written = readdirSync(dir).filter((f) => f.endsWith('.scroll.json')).length;
    if (written !== cases.length) throw new Error(`DPR ${dpr}: ${written} captures written, ${cases.length} cases`);
    console.log(`DPR ${dpr}: ${written} captures -> packages/parity/expected-scroll/${platform}/dpr-${dpr}`);
  } finally {
    await browser.close();
  }
}
