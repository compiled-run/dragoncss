// Captures every case live in pinned Chrome, runs both lanes and writes packages/parity/out/ (report.json, index.html, summary.md).
// Run with: pnpm run parity:report
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { launchChrome } from '../chrome.ts';
import { FIXTURES } from '../fixtures.ts';
import type { FixtureOutcome } from '../pipeline.ts';
import { liveAuthored, runFixture } from '../pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';
import { buildReport, writeReport } from '../report.ts';

requireReferencePlatform(hostPlatform());

const browser = await launchChrome();
const outcomes: FixtureOutcome[] = [];
try {
  for (const spec of FIXTURES) outcomes.push(await runFixture(spec, browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' }));
} finally {
  await browser.close();
}
const report = buildReport(outcomes);
writeReport(report);
const s = report.summary;
const d = s.dual;
console.log(`${s.passed}/${s.fixtures} fixtures pass, ${s.layoutFixtures} layout (${s.handWrittenLayoutFixtures} hand-written, ${s.generatedLayoutFixtures} generated; ${s.cases} cases, ${s.casesPassed} pass; ${s.casesByDirection.map((x) => `${x.direction} ${x.passed}/${x.cases}`).join(', ')}); layout ${s.exactLuNodes}/${s.comparedNodes} nodes exact at 1/64 px (text ${s.textNodesExact}/${s.textNodes}, lines ${s.lineNodesExact}/${s.lineNodes}, ${s.anonymousBoxes.length} anonymous boxes); dual boxes ${d.boxesEqual}/${d.boxesCompared}, values ${d.valuesEqual}/${d.valuesCompared}, channels ${d.channelsEqual}/${d.channelsCompared}`);
console.log(`failed ${s.failed}; unsupportedCodes ${JSON.stringify(s.unsupportedCodes)}; platform ${report.run.platform}; ${report.run.unavailableLanes.map((l) => `${l.lane} (${l.platform}): ${l.status}`).join('; ')}`);
for (const o of outcomes) if (o.status === 'fail') console.log(`FAIL ${o.id}: ${o.reason}`);
const n = report.nativeLanes;
console.log(n.present ? `native lanes (${n.source}): ${n.lanes.filter((l) => l.met).length}/${n.lanes.length} met; ${n.lanes.filter((l) => !l.met).map((l) => `${l.target} ${l.lane} ${l.state}`).join(', ')}` : `native lanes: ${n.source} is absent, none met`);
if (s.failed > 0) process.exitCode = 1;
