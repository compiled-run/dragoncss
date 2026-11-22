// REPL-r1: Chrome's capture of every case of every fixture with a runtimeSrc img, once per sample image (runtime-samples.ts), at
// DPR 1, 2, 2.625 and 3, into packages/parity/expected-runtime/<platform>/<case>~<sample>@<dpr>.web.json; and, for the fixtures
// RUNTIME_PIXEL_FIXTURES names, its ltr screenshot at each device DPR beside it (.png). One launch per DPR with the zoom guard, as
// parity:dpr-capture. Run with: pnpm run parity:runtime-capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Browser } from 'playwright';
// targets.ts first: it and dpr.ts import each other, and dpr.ts must finish before targets.ts runs.
import { deviceDprs } from '../targets.ts';
import { captureFixture, captureJson } from '../capture.ts';
import { atDpr, zoomGuard } from '../dpr.ts';
import { casesOf, fixtureInput } from '../cases.ts';
import type { ParityCase } from '../cases.ts';
import { launchChrome, openPage } from '../chrome.ts';
import { CHROME_PAGES, inOrder } from '../chrome-pool.ts';
import { FIXTURES } from '../fixtures.ts';
import { decodePng, rasterSize } from '../pixel-reference.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';
import type { RuntimeSample } from '../runtime-samples.ts';
import { RUNTIME_DPRS, RUNTIME_PIXEL_FIXTURES, runtimeCaptureDir, runtimeCapturePath, runtimeImgs, runtimePixelsPath, samplePrepare, samplesOf } from '../runtime-samples.ts';

const lanes = [1, ...new Set([...deviceDprs('ios'), ...deviceDprs('android')])].sort((a, b) => a - b);
if (JSON.stringify([...RUNTIME_DPRS].sort((a, b) => a - b)) !== JSON.stringify(lanes)) throw new Error(`RUNTIME_DPRS ${RUNTIME_DPRS.join(', ')} are not the lane DPRs ${lanes.join(', ')}`);
const platform = hostPlatform();
if (platform !== REFERENCE_PLATFORM) throw new Error(`runtime captures are taken on the reference platform ${REFERENCE_PLATFORM}, not ${platform}`);

type Job = { readonly c: ParityCase; readonly sample: RuntimeSample; readonly pixels: boolean };
const jobs: Job[] = [];
for (const spec of FIXTURES) {
  if (spec.format !== 'html') continue;
  const input = fixtureInput(spec);
  const imgs = runtimeImgs(input);
  if (imgs.length === 0) continue;
  for (const c of casesOf(spec, input)) {
    for (const sample of samplesOf(spec.id, imgs.some((i) => i.absent))) jobs.push({ c, sample, pixels: RUNTIME_PIXEL_FIXTURES.includes(spec.id) && c.environment.direction === 'ltr' });
  }
}
if (jobs.length === 0) throw new Error('no fixture has a runtimeSrc img');

async function shoot(browser: Browser, j: Job, dpr: number): Promise<Buffer> {
  const page = await openPage(browser, j.c.authoredHtml, atDpr(j.c.environment, dpr));
  try {
    await samplePrepare(j.sample)(page);
    const cdp = await page.context().newCDPSession(page);
    const png = Buffer.from(((await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string }).data, 'base64');
    const img = decodePng(png);
    const want = rasterSize(j.c.environment.viewport, dpr);
    if (img.width !== want.width || img.height !== want.height) throw new Error(`${j.c.id}~${j.sample.id}@${dpr}: Chrome captured ${img.width}x${img.height}, the raster rule is ${want.width}x${want.height}`);
    return png;
  } finally {
    await page.context().close();
  }
}

const dir = runtimeCaptureDir(platform);
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) rmSync(`${dir}/${f}`);
let written = 0;
for (const dpr of RUNTIME_DPRS) {
  const browser = await launchChrome(dpr);
  try {
    // DPR 1 needs no zoom guard: the flag at 1 is the plain launch the milestone-1 captures use.
    const guard = dpr === 1 ? 'none' : await zoomGuard(browser, dpr);
    await inOrder(jobs, CHROME_PAGES, async (j) => {
      const capture = await captureFixture(browser, j.c.id, j.c.authoredHtml, atDpr(j.c.environment, dpr), j.c.computedExtra, samplePrepare(j.sample));
      if (capture.devicePixelRatio !== dpr) throw new Error(`${j.c.id}~${j.sample.id}: captured at DPR ${capture.devicePixelRatio}, not ${dpr}`);
      // Only the boxes are compared (compareZoomedLayout); the computed values are the base capture's, which the lanes judge.
      writeFileSync(runtimeCapturePath(j.c.id, j.sample.id, dpr, platform), captureJson({ ...capture, nodes: capture.nodes.map((n) => ({ ...n, computed: null })) }));
      written++;
      if (j.pixels && dpr !== 1) {
        writeFileSync(runtimePixelsPath(j.c.id, j.sample.id, dpr, platform), await shoot(browser, j, dpr));
        written++;
      }
    });
    if (dpr !== 1) await zoomGuard(browser, dpr);
    console.log(`DPR ${dpr}: zoom guard 0.5px border -> ${guard}; ${jobs.length} sample captures`);
  } finally {
    await browser.close();
  }
}
console.log(`parity:runtime-capture: ${written} files -> packages/parity/expected-runtime/${platform}`);
