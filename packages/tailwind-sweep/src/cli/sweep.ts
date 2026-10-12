// pnpm run tw:sweep: every utility of the pinned Tailwind through Dragon (web, ios, android) and Chrome 145; writes
// snapshot/tailwind-<version>.json and snapshot/summary.md. A compiler crash on any utility fails the run and writes nothing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { CHROME_VERSION } from '../../../parity/src/chrome.ts';
import { openChrome } from '../chrome.ts';
import { serialize, SNAPSHOT_DIR, SNAPSHOT_PATH, SUMMARY_PATH, summarize, summaryMarkdown } from '../snapshot.ts';
import { sweep } from '../sweep.ts';

const started = performance.now();
const result = await sweep(openChrome, (line) => console.log(`${line} (${((performance.now() - started) / 1000).toFixed(0)} s)`));
if (result.crashes.length > 0) {
  console.error(`${result.crashes.length} compiler crashes; nothing written:\n${result.crashes.join('\n\n')}`);
  process.exit(1);
}
mkdirSync(SNAPSHOT_DIR, { recursive: true });
writeFileSync(SNAPSHOT_PATH, serialize(result.records, { chrome: CHROME_VERSION }));
const summary = summarize(result.records);
writeFileSync(SUMMARY_PATH, summaryMarkdown(summary, { chrome: CHROME_VERSION }));
const line = (['web', 'ios', 'android'] as const).map((t) => `${t} ${summary.byTarget[t].supported} supported, ${summary.byTarget[t].refused} refused, ${summary.byTarget[t].invalid} invalid, ${summary.byTarget[t].mismatch} mismatch, ${summary.byTarget[t]['na-native']} not applicable on native`).join('; ');
console.log(`${summary.total} utilities: ${line}`);
