// Captures every fixture live in pinned Chrome, runs both lanes and writes packages/parity/out/. Run with: pnpm run parity:report
import { readFileSync } from 'node:fs';
import { NO_FAULTS } from 'dragon';
import { captureFixture } from '../capture.ts';
import { launchChrome } from '../chrome.ts';
import { ENVIRONMENT, FIXTURES } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import type { FixtureOutcome } from '../pipeline.ts';
import { runFixture } from '../pipeline.ts';
import { buildReport, writeReport } from '../report.ts';

const browser = await launchChrome();
const outcomes: FixtureOutcome[] = [];
try {
  for (const spec of FIXTURES) {
    const html = readFileSync(repoPath(`packages/parity/fixtures/${spec.id}.html`), 'utf8');
    const authored = spec.kind === 'layout' ? await captureFixture(browser, spec.id, html, ENVIRONMENT) : null;
    outcomes.push(await runFixture(spec, browser, { authored, faults: NO_FAULTS }));
  }
} finally {
  await browser.close();
}
const report = buildReport(outcomes);
writeReport(report);
const d = report.summary.dual;
console.log(`${report.summary.passed}/${report.summary.fixtures} fixtures pass; layout ${report.summary.exactLuNodes}/${report.summary.comparedNodes} nodes exact at 1/64 px; dual boxes ${d.boxesEqual}/${d.boxesCompared}, values ${d.valuesEqual}/${d.valuesCompared}, channels ${d.channelsEqual}/${d.channelsCompared}`);
for (const o of outcomes) if (o.status === 'fail') console.log(`FAIL ${o.id}: ${o.reason}`);
if (report.summary.failed > 0) process.exitCode = 1;
