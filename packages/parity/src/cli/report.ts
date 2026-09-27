// Captures every fixture live in pinned Chrome, runs the lane and writes packages/parity/out/. Run with: pnpm run parity:report
import { readFileSync } from 'node:fs';
import { captureFixture } from '../capture.ts';
import { launchChrome } from '../chrome.ts';
import { FIXTURES, VIEWPORT } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import type { FixtureOutcome } from '../pipeline.ts';
import { runFixture } from '../pipeline.ts';
import { buildReport, writeReport } from '../report.ts';

const browser = await launchChrome();
const outcomes: FixtureOutcome[] = [];
try {
  for (const spec of FIXTURES) {
    const html = readFileSync(repoPath(`packages/parity/fixtures/${spec.id}.html`), 'utf8');
    const capture = spec.kind === 'layout' ? await captureFixture(browser, spec.id, html, VIEWPORT) : null;
    outcomes.push(runFixture(spec, capture));
  }
} finally {
  await browser.close();
}
const report = buildReport(outcomes);
writeReport(report);
console.log(`${report.summary.passed}/${report.summary.fixtures} fixtures pass; ${report.summary.exactLuNodes}/${report.summary.comparedNodes} nodes exact at 1/64 px`);
if (report.summary.failed > 0) process.exitCode = 1;
