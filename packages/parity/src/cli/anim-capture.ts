// Regenerates packages/parity/expected-frames/<case>/<rendering>-dpr<z>.json from live Chrome (T065 R18): every frame case's
// derived script on its authored rendering at DPR 1, 2, 2.625 and 3, and on its compiled web rendering at DPR 1 (chrome-dual).
// Directories of cases that no longer exist are removed. Run with: pnpm run parity:anim-capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { animCasesOf, animFixtures, frameScript } from '../anim-cases.ts';
import { launchChrome } from '../chrome.ts';
import { captureFrames, frameCaptureJson } from '../frame-capture.ts';
import { repoPath } from '../paths.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';

export const FRAME_DPRS: readonly number[] = [1, 2, 2.625, 3];
export const expectedFramesDir = (): string => repoPath('packages/parity/expected-frames');

requireReferencePlatform(hostPlatform());
const dir = expectedFramesDir();
mkdirSync(dir, { recursive: true });
const cases = animFixtures().flatMap(animCasesOf);
const ids = new Set(cases.map((c) => c.id));
for (const d of readdirSync(dir)) if (!ids.has(d)) rmSync(join(dir, d), { recursive: true });
let samples = 0;
for (const dpr of FRAME_DPRS) {
  const browser = await launchChrome(dpr);
  try {
    for (const c of cases) {
      const steps = frameScript(c);
      const renderings = dpr === 1 ? (['authored', 'compiled'] as const) : (['authored'] as const);
      for (const r of renderings) {
        const cap = await captureFrames(browser, c, steps, dpr, r, c.webCss);
        mkdirSync(join(dir, c.id), { recursive: true });
        writeFileSync(join(dir, c.id, `${r}-dpr${dpr}.json`), frameCaptureJson(cap));
        samples += cap.samples.length;
      }
    }
  } finally {
    await browser.close();
  }
}
console.log(`parity:anim-capture: ${cases.length} frame cases, ${samples} samples over DPRs ${FRAME_DPRS.join(', ')} (compiled rendering at DPR 1)`);
