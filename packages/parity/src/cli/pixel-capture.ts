// pnpm run parity:pixel-capture [-- --recheck <n>] (notes/T015-p4-review-p5-plan.md section 4 item 5): Chrome's pixels of every layout
// case at every device DPR, by CDP Page.captureScreenshot with chrome.ts flags (imported, unchanged) and the zoom guard, into
// packages/parity/expected-pixels/<platform>/dpr-<d>/<case>.png with a manifest (sha256, Chrome, flags, size, the raster rule).
// --recheck n re-captures every n-th case per DPR and requires it byte-identical to the committed PNG; nothing is written. Every
// launch first requires CDP SystemInfo to report the software raster path (requireSoftwareRaster) and records it in the manifest.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { launchChrome, openPage } from '../chrome.ts';
import type { ParityCase } from '../cases.ts';
import { atDpr, DPRS, zoomGuard } from '../dpr.ts';
import { nativeCases } from '../native-host.ts';
import { repoPath } from '../paths.ts';
import type { RasterPath } from '../pixel-reference.ts';
import { decodePng, expectedPixelsDir, expectedPixelsPath, manifestText, PIXEL_MANIFEST, pixelManifest, rasterSize, requireSoftwareRaster } from '../pixel-reference.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';

const args = process.argv.slice(2);
const recheckAt = args.indexOf('--recheck');
const recheck = recheckAt >= 0 ? Number(args[recheckAt + 1]) : null;
if (recheck !== null && !(Number.isInteger(recheck) && recheck > 0)) throw new Error('--recheck takes a positive whole number');
const platform = hostPlatform();
if (platform !== REFERENCE_PLATFORM) throw new Error(`pixel captures are taken on the reference platform ${REFERENCE_PLATFORM}, not ${platform}`);
const cases = nativeCases();

async function shoot(browser: Browser, c: ParityCase, dpr: number): Promise<Buffer> {
  const page = await openPage(browser, c.authoredHtml, atDpr(c.environment, dpr));
  try {
    if (c.authoredPrepare !== null) await c.authoredPrepare(page);
    const cdp = await page.context().newCDPSession(page);
    const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
    const png = Buffer.from(r.data, 'base64');
    const img = decodePng(png);
    const want = rasterSize(c.environment.viewport, dpr);
    if (img.width !== want.width || img.height !== want.height) throw new Error(`${c.id}@${dpr}: Chrome captured ${img.width}x${img.height}, the raster rule is ${want.width}x${want.height}`);
    return png;
  } finally {
    await page.context().close();
  }
}

function dirBytes(dir: string): number {
  let n = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    n += s.isDirectory() ? dirBytes(p) : s.size;
  }
  return n;
}

let exit = 0;
const sets: { dpr: number; raster: RasterPath; cases: { case: string; png: Uint8Array }[] }[] = [];
for (const dpr of DPRS) {
  const dir = expectedPixelsDir(dpr, platform);
  const browser = await launchChrome(dpr);
  try {
    // The software-raster precondition (T085, P6a): no pixel is captured unless SystemInfo proves the CPU raster path.
    const raster = await requireSoftwareRaster(async () => {
      const cdp = await browser.newBrowserCDPSession();
      try {
        return await cdp.send('SystemInfo.getInfo');
      } finally {
        await cdp.detach();
      }
    });
    console.log(`parity:pixel-capture: DPR ${dpr}: SystemInfo rasterization ${raster.rasterization}, gpu_compositing ${raster.gpu_compositing}`);
    await zoomGuard(browser, dpr);
    const t = Date.now();
    if (recheck !== null) {
      let same = 0;
      const subset = cases.filter((_, i) => i % recheck === 0);
      for (const n of subset) {
        const png = await shoot(browser, n.case, dpr);
        const committed = readFileSync(expectedPixelsPath(n.case.id, dpr, platform));
        if (Buffer.compare(png, committed) === 0) same++;
        else {
          console.log(`parity:pixel-capture --recheck: ${n.case.id}@${dpr}: the re-capture differs from the committed PNG`);
          exit = 1;
        }
      }
      console.log(`parity:pixel-capture --recheck ${recheck}: DPR ${dpr}: ${same}/${subset.length} re-captures byte-identical`);
    } else {
      mkdirSync(dir, { recursive: true });
      for (const f of readdirSync(dir)) if (f.endsWith('.png')) rmSync(join(dir, f));
      const set: { case: string; png: Uint8Array }[] = [];
      for (const n of cases) {
        const png = await shoot(browser, n.case, dpr);
        writeFileSync(expectedPixelsPath(n.case.id, dpr, platform), png);
        set.push({ case: n.case.id, png });
      }
      sets.push({ dpr, raster, cases: set });
      const written = readdirSync(dir).filter((f) => f.endsWith('.png')).length;
      if (written !== cases.length) throw new Error(`DPR ${dpr}: ${written} PNGs written, ${cases.length} cases`);
      console.log(`parity:pixel-capture: DPR ${dpr}: ${written} cases in ${((Date.now() - t) / 1000).toFixed(1)} s -> packages/parity/expected-pixels/${platform}/dpr-${dpr}`);
    }
    await zoomGuard(browser, dpr);
  } finally {
    await browser.close();
  }
}
if (recheck === null) writeFileSync(PIXEL_MANIFEST(platform), manifestText(pixelManifest(sets)));
const bytes = dirBytes(repoPath(`packages/parity/expected-pixels/${platform}`));
console.log(`parity:pixel-capture: committed size ${(bytes / 1e6).toFixed(2)} MB (${bytes} bytes; limit 50 MB)`);
if (bytes > 50e6) exit = 1;
process.exitCode = exit;
