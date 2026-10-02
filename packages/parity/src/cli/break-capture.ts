// pnpm run parity:break-capture (notes/T015-p4-review-p5-plan.md section 4 item 4 (ii)): Chrome's line breaks of every text node of
// every layout case at every device DPR, from single-code-unit Range rects grouped by line, into
// packages/parity/expected-breaks/<platform>/dpr-<d>/<case>.breaks.json; one launch per DPR with chrome.ts flags (imported, unchanged)
// and the zoom guard. Then the committed break vectors against these: equal on N/N, or every break-mismatch listed (exit 1).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { CHROME_VERSION, launchChrome, openPage } from '../chrome.ts';
import { atDpr, DPRS, zoomGuard } from '../dpr.ts';
import { chromeBreaksText, captureBreakTexts, compareVectorWithChrome, expectedBreaksDir, expectedBreaksPath, leafTexts, readBreakVector } from '../line-breaks.ts';
import type { ChromeBreaks } from '../line-breaks.ts';
import { nativeCases } from '../native-host.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';

const platform = hostPlatform();
if (platform !== REFERENCE_PLATFORM) throw new Error(`break captures are taken on the reference platform ${REFERENCE_PLATFORM}, not ${platform}`);
const cases = nativeCases();
console.log(`parity:break-capture: ${cases.length} cases per DPR; DPRs ${DPRS.join(', ')}`);
const captured = new Map<string, ChromeBreaks>();
for (const dpr of DPRS) {
  const dir = expectedBreaksDir(dpr, platform);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.breaks.json')) rmSync(`${dir}/${f}`);
  const browser = await launchChrome(dpr);
  try {
    await zoomGuard(browser, dpr);
    const t = Date.now();
    for (const n of cases) {
      const page = await openPage(browser, n.case.authoredHtml, atDpr(n.case.environment, dpr));
      try {
        if (n.case.authoredPrepare !== null) await n.case.authoredPrepare(page);
        const b: ChromeBreaks = { case: n.case.id, chrome: CHROME_VERSION, dpr, texts: await captureBreakTexts(page) };
        captured.set(`${n.case.id}@${dpr}`, b);
        writeFileSync(expectedBreaksPath(n.case.id, dpr, platform), chromeBreaksText(b));
      } finally {
        await page.context().close();
      }
    }
    await zoomGuard(browser, dpr);
    const written = readdirSync(dir).filter((f) => f.endsWith('.breaks.json')).length;
    if (written !== cases.length) throw new Error(`DPR ${dpr}: ${written} break captures written, ${cases.length} cases`);
    console.log(`parity:break-capture: DPR ${dpr}: ${written} cases in ${((Date.now() - t) / 1000).toFixed(1)} s -> packages/parity/expected-breaks/${platform}/dpr-${dpr}`);
  } finally {
    await browser.close();
  }
}

let equal = 0;
let texts = 0;
const mismatches: string[] = [];
for (const dpr of DPRS) {
  for (const n of cases) {
    const v = readBreakVector(n.case.id, dpr);
    const c = captured.get(`${n.case.id}@${dpr}`);
    if (v === null || c === undefined) {
      mismatches.push(`${n.case.id}@${dpr}: break-mismatch: ${v === null ? 'no break vector (pnpm run layout:break-vectors)' : 'no Chrome capture'}`);
      continue;
    }
    const r = compareVectorWithChrome(v, c, leafTexts(n.programs.uikit.root));
    texts += r.compared;
    if (r.problems.length === 0) equal++;
    for (const p of r.problems) mismatches.push(`${n.case.id}@${dpr}: ${p.kind}: ${p.detail}`);
  }
}
const total = cases.length * DPRS.length;
console.log(`parity:break-capture: engine break vectors against Chrome: equal on ${equal}/${total} cases (${texts} text nodes compared)`);
for (const m of mismatches) console.log(`  ${m}`);
if (mismatches.length > 0) process.exitCode = 1;
