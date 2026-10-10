// Regenerates packages/parity/expected-frames/<case>/<rendering>-dpr<z>.json from live Chrome (T065 R18): every frame case's
// derived script on its authored rendering at DPR 1, 2, 2.625 and 3, and on its compiled web rendering at DPR 1 (chrome-dual).
// At each device DPR the authored run also writes breaks-dpr<z>.json (Chrome's breaks at every dump) and pixels-dpr<z>/<k>.png
// with a manifest (each R18 pixel sample, software raster required). Stale cases and files are removed.
// Run with: pnpm run parity:anim-capture
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { animCasesOf, animFixtures, frameScript, pixelSamples, pixelSampleTotal } from '../anim-cases.ts';
import { launchChrome } from '../chrome.ts';
import { DPRS, zoomGuard } from '../dpr.ts';
import { captureFrames, captureFramesWithRefs, frameBreaksJson, frameCaptureJson, framePixelManifestJson } from '../frame-capture.ts';
import { repoPath } from '../paths.ts';
import { requireSoftwareRaster } from '../pixel-reference.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';

export const FRAME_DPRS: readonly number[] = [1, 2, 2.625, 3];
export const expectedFramesDir = (): string => repoPath('packages/parity/expected-frames');

requireReferencePlatform(hostPlatform());
const dir = expectedFramesDir();
mkdirSync(dir, { recursive: true });
const cases = animFixtures().flatMap(animCasesOf);
const ids = new Set(cases.map((c) => c.id));
for (const d of readdirSync(dir)) if (!ids.has(d)) rmSync(join(dir, d), { recursive: true });
// The files a case directory holds; anything else is stale.
const wanted = new Set(FRAME_DPRS.flatMap((d) => [`authored-dpr${d}.json`, ...(d === 1 ? [`compiled-dpr${d}.json`] : []), ...(DPRS.includes(d) ? [`breaks-dpr${d}.json`, `pixels-dpr${d}`] : [])]));
for (const id of ids) if (existsSync(join(dir, id))) for (const f of readdirSync(join(dir, id))) if (!wanted.has(f)) rmSync(join(dir, id, f), { recursive: true });
const missing = DPRS.filter((d) => !FRAME_DPRS.includes(d));
if (missing.length > 0) throw new Error(`the device DPRs ${missing.join(', ')} are not frame DPRs`);
const perDpr = pixelSampleTotal(cases);
let samples = 0;
for (const dpr of FRAME_DPRS) {
  const browser = await launchChrome(dpr);
  try {
    const device = DPRS.includes(dpr);
    // The software-raster precondition (T085, P6a), as parity:pixel-capture: no pixel is captured unless SystemInfo proves it.
    const raster = device ? await requireSoftwareRaster(async () => {
      const cdp = await browser.newBrowserCDPSession();
      try {
        return await cdp.send('SystemInfo.getInfo');
      } finally {
        await cdp.detach();
      }
    }) : null;
    if (device) await zoomGuard(browser, dpr);
    for (const c of cases) {
      const steps = frameScript(c);
      mkdirSync(join(dir, c.id), { recursive: true });
      if (raster !== null) {
        const { capture, refs } = await captureFramesWithRefs(browser, c, steps, dpr, pixelSamples(c, steps));
        writeFileSync(join(dir, c.id, `authored-dpr${dpr}.json`), frameCaptureJson(capture));
        writeFileSync(join(dir, c.id, `breaks-dpr${dpr}.json`), frameBreaksJson(capture, refs.breaks));
        const px = join(dir, c.id, `pixels-dpr${dpr}`);
        rmSync(px, { recursive: true, force: true });
        mkdirSync(px);
        for (const [k, png] of refs.pixels) writeFileSync(join(px, `${k}.png`), png);
        writeFileSync(join(px, 'manifest.json'), framePixelManifestJson(capture, raster, refs.pixels));
        samples += capture.samples.length;
      }
      const renderings: ('authored' | 'compiled')[] = [...(raster === null ? ['authored' as const] : []), ...(dpr === 1 ? ['compiled' as const] : [])];
      for (const r of renderings) {
        const cap = await captureFrames(browser, c, steps, dpr, r, c.webCss);
        writeFileSync(join(dir, c.id, `${r}-dpr${dpr}.json`), frameCaptureJson(cap));
        samples += cap.samples.length;
      }
    }
  } finally {
    await browser.close();
  }
}
console.log(`parity:anim-capture: ${cases.length} frame cases, ${samples} samples over DPRs ${FRAME_DPRS.join(', ')} (compiled rendering at DPR 1); breaks at every authored sample and ${perDpr} pixel samples per DPR at DPRs ${DPRS.join(', ')}`);
