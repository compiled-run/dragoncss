// Regenerates packages/parity/expected-traces/<group>.trace.json from live Chrome: every interaction group's derived trace driven
// through CDP mouse, touch, key and forced-pseudo input, with Chrome's matches and hover media after every step and R2's style
// check on Dragon's web output after every touch step (SELD-R2 R2, R14). Files of groups that no longer exist are removed.
// Run with: pnpm run parity:trace-capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { CHROME_PAGES, inOrder } from '../chrome-pool.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';
import { captureTraces, expectedTraceDir, expectedTracePath, hoverMediaLags, launchTraceChrome, touchPrefsUpdates, traceCaptureJson, traceGroups, TRACE_MEMO } from '../trace-capture.ts';

if (process.argv.slice(2).some((a) => a !== '--')) throw new Error(`parity:trace-capture takes no arguments, got ${JSON.stringify(process.argv.slice(2))}`);
requireReferencePlatform(hostPlatform());
const dir = expectedTraceDir();
mkdirSync(dir, { recursive: true });
const groups = traceGroups();
const keep = new Set(groups.map((g) => expectedTracePath(g.id).slice(dir.length + 1)));
for (const f of readdirSync(dir)) if (f.endsWith('.trace.json') && !keep.has(f)) rmSync(`${dir}/${f}`);
const browser = await launchTraceChrome();
console.log('parity:trace-capture: touch emulation keeps (hover: none) and (pointer: coarse) through a WebPreferences update');
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
console.log(`parity:trace-capture: ${groups.length} groups, ${steps} steps into packages/parity/expected-traces (${TRACE_MEMO.hits} runs remembered, ${TRACE_MEMO.misses} read; chrome-memo.ts)`);
// How often (counted over the runs read, not the remembered ones) Chrome's hover media lagged the emulated context and the capture waited for it (trace-capture.ts awaitHoverMedia).
console.log(`parity:trace-capture: hover media lagged the emulated context ${hoverMediaLags.length} times${hoverMediaLags.length === 0 ? '' : ` (${hoverMediaLags.map((l) => `${l.at} ${l.frames} frames`).join(', ')})`}`);
// How often Chrome sent a page new WebPreferences during a touch step, which Playwright's --blink-settings turned into hover media.
console.log(`parity:trace-capture: WebPreferences updates seen under touch emulation ${touchPrefsUpdates.length} times, with the hover media held${touchPrefsUpdates.length === 0 ? '' : ` (${touchPrefsUpdates.join(', ')})`}`);
