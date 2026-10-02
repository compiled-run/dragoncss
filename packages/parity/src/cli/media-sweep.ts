// The web band sweep over the media fixture group (notes/T025 §3 B item 8): writes packages/parity/expected-media/*.json, or with
// --check requires a byte-identical sweep. Either way it exits 1 when any sample's renderings differ.
// Run with: node --conditions=dragon-internal packages/parity/src/cli/media-sweep.ts [--check]
import { launchChrome } from '../chrome.ts';
import type { SweepRecord } from '../media-sweep.ts';
import { checkRecords, mediaFixtures, recordPass, sweepFixture, writeRecords } from '../media-sweep.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--check');
if (unknown.length > 0) {
  console.error(`unknown argument ${unknown.join(' ')}; usage: media-sweep.ts [--check]`);
  process.exit(2);
}
const check = args.includes('--check');
requireReferencePlatform(hostPlatform());

const browser = await launchChrome();
const records: SweepRecord[] = [];
try {
  for (const spec of mediaFixtures()) records.push(...(await sweepFixture(spec, browser)));
} finally {
  await browser.close();
}
let failed = 0;
for (const r of records) {
  const bad = r.samples.filter((s) => !s.pass);
  if (!recordPass(r)) failed++;
  console.log(`${recordPass(r) ? 'pass' : 'FAIL'} ${r.fixture} ${r.direction}: ${r.bands.length} bands, ${r.samples.length} samples (${r.samples.map((s) => `${s.width}x${s.height}`).join(' ')})${r.problem === null ? '' : `; ${r.problem}`}`);
  for (const s of bad) console.log(`  ${s.width}x${s.height} band ${s.band}: ${s.problems.join('; ')}`);
}
if (check) {
  const problems = checkRecords(records);
  for (const p of problems) console.log(`CHECK ${p}`);
  if (problems.length > 0) process.exitCode = 1;
} else writeRecords(records);
console.log(`${records.length - failed}/${records.length} fixture environments equal at every sample, ${records.reduce((n, r) => n + r.samples.length, 0)} samples${check ? ', checked against the committed records' : ', written'}`);
if (failed > 0) process.exitCode = 1;
