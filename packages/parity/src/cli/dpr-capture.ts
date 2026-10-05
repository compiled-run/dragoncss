// Captures every milestone-1 layout case in Chrome at DPR 2, 3 and 2.625 (the Android extra) into
// packages/parity/expected-dpr/<platform>/dpr-<N>/<case>.web.json: one browser launch per DPR with --force-device-scale-factor=N
// and a context deviceScaleFactor of N. The zoom guard runs first on every launch, and a planted launch with the flag at 1 and
// deviceScaleFactor N must be rejected by it. Run with: pnpm run parity:dpr-capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { captureFixture, captureJson } from '../capture.ts';
import { launchChrome } from '../chrome.ts';
import { CHROME_PAGES, inOrder } from '../chrome-pool.ts';
import { atDpr, DPRS, EXTRA_DPRS, expectedDprDir, expectedDprPath, layoutCases, zoomGuard } from '../dpr.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';

const platform = hostPlatform();
if (platform !== REFERENCE_PLATFORM) throw new Error(`DPR captures are taken on the reference platform ${REFERENCE_PLATFORM}, not ${platform}`);
const all = layoutCases();
const ids = all.flatMap((f) => f.cases.map((c) => c.id));
console.log(`parity:dpr-capture: ${ids.length} cases per DPR; DPRs ${DPRS.join(', ')} (${EXTRA_DPRS.map((e) => `${e.dpr} is the ${e.platform} extra ${e.name}`).join('; ')})`);

// The planted launch: flag 1 with a context deviceScaleFactor of N reports devicePixelRatio N but lays out at zoom 1.
for (const dpr of DPRS) {
  const planted = await launchChrome(1);
  try {
    await zoomGuard(planted, dpr);
    throw new Error(`planted flag-1 capture at DPR ${dpr} was NOT rejected by the zoom guard`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (!m.startsWith('zoom guard:')) throw e;
    console.log(`planted flag-1 capture at DPR ${dpr} rejected: ${m}`);
  } finally {
    await planted.close();
  }
}

for (const dpr of DPRS) {
  const dir = expectedDprDir(dpr, platform);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.web.json')) rmSync(`${dir}/${f}`);
  const browser = await launchChrome(dpr);
  try {
    const guard = await zoomGuard(browser, dpr);
    const t = Date.now();
    // Each case in its own context (captureFixture), CHROME_PAGES at a time.
    const n = (
      await inOrder(all.flatMap((f) => f.cases), CHROME_PAGES, async (c) => {
        const capture = await captureFixture(browser, c.id, c.authoredHtml, atDpr(c.environment, dpr));
        if (capture.devicePixelRatio !== dpr) throw new Error(`${c.id}: captured at DPR ${capture.devicePixelRatio}, not ${dpr}`);
        writeFileSync(expectedDprPath(c.id, dpr, platform), captureJson(capture));
      })
    ).length;
    // The guard again after the last case: the launch never fell back to zoom 1.
    await zoomGuard(browser, dpr);
    const written = readdirSync(dir).filter((f) => f.endsWith('.web.json')).length;
    if (written !== ids.length || n !== ids.length) throw new Error(`DPR ${dpr}: ${written} captures written, ${ids.length} cases`);
    console.log(`DPR ${dpr}: zoom guard 0.5px border -> ${guard}; devicePixelRatio ${dpr}; ${n} captures in ${((Date.now() - t) / 1000).toFixed(1)} s -> packages/parity/expected-dpr/${platform}/dpr-${dpr}`);
  } finally {
    await browser.close();
  }
}
