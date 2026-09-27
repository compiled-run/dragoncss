// Derives the support profile rows (packages/dragon/src/profiles/ios.ts and web.ts) from the parity run: a row key
// ("<feature>@<context>", computed by the compiler's usedKeys) gets a row only when cases that use it passed the lane its
// proof names, against the committed authored captures. The profiles are never enforced while deriving.
// Run with: pnpm run profile:rows
import { writeFileSync } from 'node:fs';
import { NO_FAULTS } from '../packages/dragon/src/faults.ts';
import { launchChrome } from '../packages/parity/src/chrome.ts';
import { committedAuthored } from '../packages/parity/src/committed.ts';
import { FIXTURES } from '../packages/parity/src/fixtures.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import type { CaseOutcome } from '../packages/parity/src/pipeline.ts';
import { runFixture } from '../packages/parity/src/pipeline.ts';
import { deriveRows, profileSource } from '../packages/parity/src/profile-rows.ts';

const browser = await launchChrome();
const cases: CaseOutcome[] = [];
try {
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const outcome = await runFixture(spec, browser, { authored: committedAuthored, faults: NO_FAULTS, profiles: 'derive' });
    cases.push(...outcome.cases);
    for (const c of outcome.cases) if (c.status !== 'pass') console.log(`not passing, proves nothing: ${c.id}: ${c.reason}`);
  }
} finally {
  await browser.close();
}
for (const target of ['ios', 'web'] as const) {
  const rows = deriveRows(target, cases);
  writeFileSync(repoPath(`packages/dragon/src/profiles/${target}.ts`), profileSource(target, rows));
  console.log(`${target}: ${rows.length} rows from ${cases.length} cases`);
}
