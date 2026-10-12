// DIAGNOSTIC (temporary, removed before the PR): captures the R18 pixel samples of chosen frame cases several times, at the
// device DPRs, the way parity:anim-capture does, and prints each sample's hashes over the repeats. A deterministic capture gives
// one hash per sample.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { animCasesOf, animFixtures, frameScript, pixelSamples } from '../src/anim-cases.ts';
import { launchChrome } from '../src/chrome.ts';
import { captureFramesWithRefs } from '../src/frame-capture.ts';

const REPEATS = Number(process.env.DIAG_REPEATS ?? 6);
const ONLY = (process.env.DIAG_CASES ?? 'anim-layout-margin-rtl,anim-layout-margin').split(',');

describe('frame pixel capture determinism (diagnostic)', () => {
  it('gives one hash per pixel sample over repeated captures', async () => {
    const cases = animFixtures().flatMap(animCasesOf).filter((c) => ONLY.some((o) => c.id.startsWith(`${o}@`)));
    expect(cases.length).toBeGreaterThan(0);
    const unstable: string[] = [];
    for (const dpr of [2.625, 3]) {
      const browser = await launchChrome(dpr);
      try {
        for (const c of cases) {
          const steps = frameScript(c);
          const hashes = new Map<number, string[]>();
          for (let r = 0; r < REPEATS; r++) {
            const { refs } = await captureFramesWithRefs(browser, c, steps, dpr, pixelSamples(c, steps));
            for (const [k, png] of refs.pixels) hashes.set(k, [...(hashes.get(k) ?? []), createHash('sha256').update(png).digest('hex').slice(0, 8)]);
          }
          for (const [k, hs] of [...hashes].sort((a, b) => a[0] - b[0])) {
            const distinct = new Set(hs);
            console.log(`${c.id} dpr ${dpr} k${k}: ${[...distinct].map((h) => `${h}x${hs.filter((x) => x === h).length}`).join(' ')}`);
            if (distinct.size > 1) unstable.push(`${c.id} dpr ${dpr} k${k}: ${hs.join(' ')}`);
          }
        }
      } finally {
        await browser.close();
      }
    }
    for (const u of unstable) console.log(`UNSTABLE ${u}`);
    expect(unstable).toEqual([]);
  }, 3_000_000);
});
