// Derives the support profile rows (packages/dragon/src/profiles/ios.ts, android.ts and web.ts) from the parity run: a row key
// ("<feature>@<context>", computed by the compiler's usedKeys) gets a row only when cases that use it passed the lane its
// proof names, against the committed authored captures. The profiles are never enforced while deriving. The native rows (ios,
// android, both on the compiler's native keys) take the committed device lanes as input (P6a promotion rule): a row is exact
// only when every proving case passes every device lane of that target at every DPR in packages/parity/out/lanes.json and its
// device-failures list, device-pixels included for rows with a paint aspect; otherwise it is caveat.
// Run with: pnpm run profile:rows
import { writeFileSync } from 'node:fs';
import { NO_ENGINE_FAULTS } from '../packages/layout/src/block.ts';
import { NO_FAULTS } from '../packages/dragon/src/faults.ts';
import { launchChrome } from '../packages/parity/src/chrome.ts';
import { committedAuthored } from '../packages/parity/src/committed.ts';
import { FIXTURES } from '../packages/parity/src/fixtures.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import type { CaseOutcome } from '../packages/parity/src/pipeline.ts';
import { runFixture } from '../packages/parity/src/pipeline.ts';
import { committedLanes, deriveRows, nativeLanesSource, profileSource } from '../packages/parity/src/profile-rows.ts';

const browser = await launchChrome();
const cases: CaseOutcome[] = [];
try {
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const outcome = await runFixture(spec, browser, { authored: committedAuthored, faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' });
    cases.push(...outcome.cases);
    for (const c of outcome.cases) if (c.status !== 'pass') console.log(`not passing, proves nothing: ${c.id}: ${c.reason}`);
  }
} finally {
  await browser.close();
}

const { lanes, stale, evidence: evidenceOf } = committedLanes();

for (const target of ['ios', 'android', 'web'] as const) {
  const evidence = target === 'web' ? null : evidenceOf(target);
  const rows = deriveRows(target, cases, evidence);
  writeFileSync(repoPath(`packages/dragon/src/profiles/${target}.ts`), profileSource(target, rows));
  const exact = rows.filter((r) => r.status === 'exact').length;
  console.log(`${target}: ${rows.length} rows (${exact} exact) from ${cases.length} cases${evidence?.unavailable ? `; no device evidence: ${evidence.unavailable}` : ''}`);
}
writeFileSync(repoPath('packages/dragon/src/profiles/native-lanes.ts'), nativeLanesSource(lanes, stale));
console.log(`native lanes: ${lanes === null ? 'no committed lanes.json' : `${stale.length} stale`}`);
