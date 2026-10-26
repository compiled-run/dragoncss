// pnpm run parity:decoration-capture (TDEC-a, notes/T148J-tdec.md, T148J-1): every decorated web-only case at DPR 1, 2, 3 and 2.625,
// rendered by Chrome as authored and with the strip rule (decoration-capture.ts), by CDP Page.captureScreenshot with chrome.ts
// flags and the zoom guard, into packages/parity/expected-decorations/<platform>/dpr-<d>/<case>[.stripped].png with a manifest.
// The two renderings must lay out the same frames and lines (no tolerance): if any case differs, nothing is trusted and it exits 1.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { captureFixture } from '../capture.ts';
import { CHROME_VERSION, launchChrome } from '../chrome.ts';
import { CHROME_PAGES, inOrder } from '../chrome-pool.ts';
import { DECORATION_DPRS, DECORATION_MANIFEST, decorationCases, decorationDir, decorationPath, sha256, strippedHtml } from '../decoration-capture.ts';
import type { DecorationManifest } from '../decoration-capture.ts';
import { atDpr, zoomGuard } from '../dpr.ts';
import { layoutFrames as frames, shootDecoration as shoot } from '../decoration-shoot.ts';
import { referenceTransform } from '../fonts-run.ts';
import { repoPath } from '../paths.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';

if (hostPlatform() !== REFERENCE_PLATFORM) throw new Error(`decoration captures are taken on ${REFERENCE_PLATFORM}`);

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
    // Each capture opens its own context, so cases run CHROME_PAGES at a time; the manifest keeps case order.
    const rows = await inOrder(cases, CHROME_PAGES, async ({ fixture, case: c }) => {
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
      return { case: c.id, dpr, decorated: sha256(decorated), stripped: sha256(plain), sameLayout };
    });
    out.push(...rows);
  } finally {
    await browser.close();
  }
  console.log(`parity:decoration-capture: DPR ${dpr}: ${cases.length} cases`);
}
const manifest: DecorationManifest = { chrome: CHROME_VERSION, cases: out };
writeFileSync(DECORATION_MANIFEST(), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`parity:decoration-capture: ${out.length} captures into ${repoPath('packages/parity/expected-decorations')}`);
process.exitCode = exit;
