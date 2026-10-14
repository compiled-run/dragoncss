// pnpm run parity:decoration-capture (TDEC-a, notes/T148J-tdec.md, T148J-1): every decorated web-only case at DPR 1, 2, 3 and 2.625,
// rendered by Chrome as authored and with the strip rule (decoration-capture.ts), by CDP Page.captureScreenshot with chrome.ts
// flags and the zoom guard, into packages/parity/expected-decorations/<platform>/dpr-<d>/<case>[.stripped].png with a manifest.
// The two renderings must lay out the same frames and lines (no tolerance): if any case differs, nothing is trusted and it exits 1.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import { captureFixture } from '../capture.ts';
import type { ParityCase } from '../cases.ts';
import { CHROME_VERSION, launchChrome, openPage } from '../chrome.ts';
import { DECORATION_DPRS, DECORATION_MANIFEST, decorationCases, decorationDir, decorationPath, sha256, strippedHtml } from '../decoration-capture.ts';
import type { DecorationManifest } from '../decoration-capture.ts';
import { atDpr, zoomGuard } from '../dpr.ts';
import { referenceTransform } from '../fonts-run.ts';
import { repoPath } from '../paths.ts';
import { decodePng, rasterSize } from '../pixel-reference.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';

if (hostPlatform() !== REFERENCE_PLATFORM) throw new Error(`decoration captures are taken on ${REFERENCE_PLATFORM}`);

async function shoot(browser: Browser, html: string, c: ParityCase, dpr: number, prepare: ((page: Page) => Promise<void>) | undefined): Promise<Buffer> {
  const page = await openPage(browser, html, atDpr(c.environment, dpr));
  try {
    if (prepare !== undefined) await prepare(page);
    const cdp = await page.context().newCDPSession(page);
    const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
    const png = Buffer.from(r.data, 'base64');
    const img = decodePng(png);
    const want = rasterSize(c.environment.viewport, dpr);
    if (img.width !== want.width || img.height !== want.height) throw new Error(`${c.id}@${dpr}: ${img.width}x${img.height}, the raster rule is ${want.width}x${want.height}`);
    return png;
  } finally {
    await page.context().close();
  }
}

const frames = (nodes: readonly { id: string; kind: string; hasBox: boolean; x: number; y: number; width: number; height: number }[]): string =>
  JSON.stringify(nodes.map((n) => [n.id, n.kind, n.hasBox, n.x, n.y, n.width, n.height]));

const cases = decorationCases();
const out: DecorationManifest['cases'][number][] = [];
let exit = 0;
for (const dpr of DECORATION_DPRS) {
  const dir = decorationDir(dpr);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const browser = await launchChrome(dpr);
  try {
    if (dpr !== 1) await zoomGuard(browser, dpr);
    for (const { fixture, case: c } of cases) {
      const prepare = referenceTransform(fixture);
      const stripped = strippedHtml(c.authoredHtml);
      const a = await captureFixture(browser, c.id, c.authoredHtml, atDpr(c.environment, dpr), [], prepare);
      const b = await captureFixture(browser, c.id, stripped, atDpr(c.environment, dpr), [], prepare);
      const sameLayout = frames(a.nodes) === frames(b.nodes);
      if (!sameLayout) {
        console.log(`parity:decoration-capture: ${c.id}@${dpr}: the stripped copy lays out different frames or lines; stop (T148J-1 ruling 4)`);
        exit = 1;
      }
      const decorated = await shoot(browser, c.authoredHtml, c, dpr, prepare);
      const plain = await shoot(browser, stripped, c, dpr, prepare);
      writeFileSync(decorationPath(c.id, dpr, false), decorated);
      writeFileSync(decorationPath(c.id, dpr, true), plain);
      out.push({ case: c.id, dpr, decorated: sha256(decorated), stripped: sha256(plain), sameLayout });
    }
  } finally {
    await browser.close();
  }
  console.log(`parity:decoration-capture: DPR ${dpr}: ${cases.length} cases`);
}
const manifest: DecorationManifest = { chrome: CHROME_VERSION, cases: out };
writeFileSync(DECORATION_MANIFEST(), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`parity:decoration-capture: ${out.length} captures into ${repoPath('packages/parity/expected-decorations')}`);
process.exitCode = exit;
