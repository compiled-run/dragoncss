// Regenerates packages/parity/expected-traces/<group>.trace.json from live Chrome: every interaction group's derived trace driven
// through CDP mouse, touch, key and forced-pseudo input, with Chrome's matches and hover media after every step and R2's style
// check on Dragon's web output after every touch step (SELD-R2 R2, R14). Files of groups that no longer exist are removed.
// Run with: pnpm run parity:trace-capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { launchChrome } from '../chrome.ts';
import { CHROME_PAGES, inOrder } from '../chrome-pool.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';
import { captureTraces, expectedTraceDir, expectedTracePath, traceCaptureJson, traceGroups } from '../trace-capture.ts';

if (process.argv.slice(2).some((a) => a !== '--')) throw new Error(`parity:trace-capture takes no arguments, got ${JSON.stringify(process.argv.slice(2))}`);
requireReferencePlatform(hostPlatform());
const dir = expectedTraceDir();
mkdirSync(dir, { recursive: true });
const groups = traceGroups();
const keep = new Set(groups.map((g) => expectedTracePath(g.id).slice(dir.length + 1)));
for (const f of readdirSync(dir)) if (f.endsWith('.trace.json') && !keep.has(f)) rmSync(`${dir}/${f}`);
const browser = await launchChrome();
let steps = 0;
try {
  // Each group's pages in their own contexts (captureTraces), CHROME_PAGES groups at a time.
  for (const c of await inOrder(groups, CHROME_PAGES, (g) => captureTraces(browser, g))) {
    steps += c.runs.reduce((n, r) => n + r.steps.length, 0);
    writeFileSync(expectedTracePath(c.case), traceCaptureJson(c));
  }
} finally {
  await browser.close();
}
console.log(`parity:trace-capture: ${groups.length} groups, ${steps} steps into packages/parity/expected-traces`);
