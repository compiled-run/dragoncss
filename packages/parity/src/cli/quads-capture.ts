// pnpm run parity:quads-capture [-- --check] (PNT2, transform-capture.ts): Chrome's computed transform and DOM.getContentQuads
// border-box quad of every transformed element of every transforms case, at DPR 1, 2, 3 and 2.625 (one launch per DPR with the
// chrome.ts flags and the zoom guard), into packages/parity/expected-quads/<platform>/dpr-<N>/<case>.json. --check writes nothing
// and fails when a committed file differs from a fresh capture or names no case.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CHROME_VERSION, launchChrome, openPage } from '../chrome.ts';
import { atDpr, zoomGuard } from '../dpr.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';
import { captureTransformQuads, dprLabel, QUAD_DPRS, quadsDir, quadsJson, quadsPath, transformCases } from '../transform-capture.ts';

const platform = hostPlatform();
if (platform !== REFERENCE_PLATFORM) throw new Error(`quads are captured on the reference platform ${REFERENCE_PLATFORM}, not ${platform}`);
const check = process.argv.includes('--check');
const cases = await transformCases();
const stale: string[] = [];
for (const dpr of QUAD_DPRS) {
  const dir = quadsDir(dpr);
  if (!check) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(`${dir}/${f}`);
  } else if (existsSync(dir)) {
    const want = new Set(cases.map((c) => `${c.id}.json`));
    for (const f of readdirSync(dir)) if (f.endsWith('.json') && !want.has(f)) stale.push(`${dir}/${f} (no such case)`);
  }
  const browser = await launchChrome(dpr);
  try {
    if (dpr !== 1) await zoomGuard(browser, dpr);
    for (const c of cases) {
      const env = atDpr(c.environment, dpr);
      const page = await openPage(browser, c.authoredHtml, env);
      try {
        const text = quadsJson({ case: c.id, chrome: CHROME_VERSION, dpr, direction: env.direction, nodes: await captureTransformQuads(page) });
        const path = quadsPath(c.id, dpr);
        if (check) {
          if (!existsSync(path) || readFileSync(path, 'utf8') !== text) stale.push(path);
        } else writeFileSync(path, text);
      } finally {
        await page.context().close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`parity:quads-capture: DPR ${dpr}: ${cases.length} cases${check ? ' checked' : ` -> packages/parity/expected-quads/${platform}/${dprLabel(dpr)}`}`);
}
if (stale.length > 0) {
  console.log(`parity:quads-capture: stale (run pnpm run parity:quads-capture):\n  ${stale.join('\n  ')}`);
  process.exitCode = 1;
}
