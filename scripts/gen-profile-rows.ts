// Derives the support profile rows (packages/dragon/src/profiles/ios.ts, android.ts and web.ts) from the parity run: a row key
// ("<feature>@<context>", computed by the compiler's usedKeys) gets a row only when cases that use it passed the lane its
// proof names, against the committed authored captures. The profiles are never enforced while deriving. android.ts follows
// the iOS rule (native-strategy.md 3.9 item 13). It also writes packages/dragon/src/profiles/native-lanes.ts, the committed native
// lanes verdict that gates outputs.ready (P6a, Amendment T075J); the lanes never decide a profile status.
// Run with: pnpm run profile:rows
import { writeFileSync } from 'node:fs';
import { NO_ENGINE_FAULTS } from '../packages/layout/src/block.ts';
import { NO_FAULTS } from '../packages/dragon/src/faults.ts';
import { launchChrome } from '../packages/parity/src/chrome.ts';
import { committedAuthored } from '../packages/parity/src/committed.ts';
import { FIXTURES } from '../packages/parity/src/fixtures.ts';
import { FONT_FIXTURES } from '../packages/parity/src/fixture-groups/fonts.ts';
import { committedFontAuthored, runFontFixture } from '../packages/parity/src/fonts-run.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import type { CaseOutcome } from '../packages/parity/src/pipeline.ts';
import { runFixture } from '../packages/parity/src/pipeline.ts';
import { committedLanes, deriveAnimationRows, deriveRows, nativeLanesSource, profileSource } from '../packages/parity/src/profile-rows.ts';
import { animCasesOf, animFixtures } from '../packages/parity/src/anim-cases.ts';
import { animCaseReport } from '../packages/parity/src/frame-capture.ts';
import { animationFeatures } from '../packages/dragon/src/internal.ts';

const browser = await launchChrome();
const cases: CaseOutcome[] = [];
try {
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const outcome = await runFixture(spec, browser, { authored: committedAuthored, faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' });
    cases.push(...outcome.cases);
    for (const c of outcome.cases) if (c.status !== 'pass') console.log(`not passing, proves nothing: ${c.id}: ${c.reason}`);
  }
  // TXT1-C: the web-only fonts fixtures prove web rows through chrome-dual alone; their ios features are empty.
  for (const f of FONT_FIXTURES) {
    const outcomes = await runFontFixture(f, browser, { authored: committedFontAuthored, faults: NO_FAULTS, profiles: 'derive' });
    cases.push(...outcomes);
    for (const c of outcomes) if (c.status !== 'pass') console.log(`not passing, proves nothing: ${c.id}: ${c.reason}`);
  }
} finally {
  await browser.close();
}

// T065: the frame cases that pass the host frame lanes against the committed frame captures prove the animation rows.
const framePassing = animFixtures().flatMap(animCasesOf).flatMap((c) => {
  const r = animCaseReport(c);
  for (const f of r.failures.slice(0, 3)) console.log(`not passing, proves nothing: ${f}`);
  return r.failures.length === 0 ? [{ id: c.id, features: animationFeatures(c.compiled) }] : [];
});
for (const target of ['ios', 'android', 'web'] as const) {
  const rows = [...deriveRows(target, cases), ...deriveAnimationRows(target, framePassing)];
  writeFileSync(repoPath(`packages/dragon/src/profiles/${target}.ts`), profileSource(target, rows));
  console.log(`${target}: ${rows.length} rows from ${cases.length} cases`);
}
const committed = committedLanes();
const { lanes, stale } = committed;
writeFileSync(repoPath('packages/dragon/src/profiles/native-lanes.ts'), nativeLanesSource({ ios: committed.verdict('ios'), android: committed.verdict('android') }));
console.log(`native lanes: ${lanes === null ? 'no committed lanes.json' : `${stale.length} stale`}`);
