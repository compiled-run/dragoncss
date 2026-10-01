// Regenerates packages/parity/expected-hit/<case>.hit.json from live Chrome: document.elementFromPoint at every point of each
// layout case's derived hit grid, on its authored rendering (SELD-R1b). Files of cases that no longer exist are removed.
// Run with: pnpm run parity:hit-capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { launchChrome } from '../chrome.ts';
import { captureHits, expectedHitDir, expectedHitPath, hitCaptureJson, hitCases } from '../hit-capture.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';

requireReferencePlatform(hostPlatform());
const dir = expectedHitDir();
mkdirSync(dir, { recursive: true });
const cases = hitCases();
const keep = new Set(cases.map((n) => expectedHitPath(n.case.id).slice(dir.length + 1)));
for (const f of readdirSync(dir)) if (f.endsWith('.hit.json') && !keep.has(f)) rmSync(`${dir}/${f}`);
const browser = await launchChrome();
let points = 0;
try {
  for (const n of cases) {
    const c = await captureHits(browser, n);
    points += c.points.length;
    writeFileSync(expectedHitPath(n.case.id), hitCaptureJson(c));
  }
} finally {
  await browser.close();
}
console.log(`parity:hit-capture: ${cases.length} cases, ${points} points into packages/parity/expected-hit`);
