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
import { CHROME_PAGES, inOrder } from '../packages/parity/src/chrome-pool.ts';
import { committedAuthored } from '../packages/parity/src/committed.ts';
import { FIXTURES } from '../packages/parity/src/fixtures.ts';
import { FONT_FIXTURES } from '../packages/parity/src/fixture-groups/fonts.ts';
import { committedFontAuthored, runFontFixture } from '../packages/parity/src/fonts-run.ts';
import { ENV_FIXTURES } from '../packages/parity/src/fixture-groups/env.ts';
import { committedEnvAuthored, runEnvFixture } from '../packages/parity/src/env-run.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import type { CaseOutcome } from '../packages/parity/src/pipeline.ts';
import { compileFixture, forcedCases, runFixture } from '../packages/parity/src/pipeline.ts';
import { INTERACTION_FORCED } from '../packages/parity/src/fixture-groups/interaction.ts';
import { committedLanes, deriveAnimationRows, deriveInteractionRows, deriveMediaRows, deriveRows, nativeLanesSource, profileSource } from '../packages/parity/src/profile-rows.ts';
import { resizeReport } from '../packages/parity/src/resize-capture.ts';
import { animCasesOf, animFixtures } from '../packages/parity/src/anim-cases.ts';
import { animSamples } from '../packages/parity/src/anim-samples.ts';
import { animCaseReport } from '../packages/parity/src/frame-capture.ts';
import { animationFeatures, interactionPartitionOf, interactionRowFeature, mediaFeatures } from '../packages/dragon/src/internal.ts';

const browser = await launchChrome();
const cases: CaseOutcome[] = [];
try {
  // CHROME_PAGES fixtures at a time, so one fixture's Chrome reads overlap another's compile; the outcomes come back in fixture order.
  const layoutSpecs = FIXTURES.filter((spec) => spec.kind === 'layout');
  for (const outcome of await inOrder(layoutSpecs, CHROME_PAGES, (spec) => runFixture(spec, browser, { authored: committedAuthored, faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' }))) {
    cases.push(...outcome.cases);
    for (const c of outcome.cases) if (c.status !== 'pass') console.log(`not passing, proves nothing: ${c.id}: ${c.reason}`);
  }
  // TXT1-C: the web-only fonts fixtures prove web rows through chrome-dual alone; their ios features are empty. CHROME_PAGES at a
  // time, the outcomes in fixture order, as the layout fixtures.
  for (const outcomes of await inOrder(FONT_FIXTURES, CHROME_PAGES, (f) => runFontFixture(f, browser, { authored: committedFontAuthored, faults: NO_FAULTS, profiles: 'derive' }))) {
    cases.push(...outcomes);
    for (const c of outcomes) if (c.status !== 'pass') console.log(`not passing, proves nothing: ${c.id}: ${c.reason}`);
  }
  // ENV-SAFE: the web-only env() fixtures prove web rows through chrome-dual alone, under their insets; their ios features are empty.
  for (const outcomes of await inOrder(ENV_FIXTURES, CHROME_PAGES, (f) => runEnvFixture(f, browser, { authored: committedEnvAuthored(f), faults: NO_FAULTS, profiles: 'derive' }))) {
    cases.push(...outcomes);
    for (const c of outcomes) if (c.status !== 'pass') console.log(`not passing, proves nothing: ${c.id}: ${c.reason}`);
  }
} finally {
  await browser.close();
}

// T065: the frame cases that pass the host frame lanes against the committed frame captures prove the animation rows; on a native
// target only when every sample passes its committed device-anim lane (R18).
const sampleIds = (target: 'ios' | 'android'): Map<string, string[]> => new Map(animSamples(target).flatMap((xs) => (xs[0] === undefined ? [] : [[xs[0].case.id, xs.map((s) => s.id)] as const])));
const iosSamples = sampleIds('ios');
const androidSamples = sampleIds('android');
const framePassing = animFixtures().flatMap(animCasesOf).flatMap((c) => {
  const r = animCaseReport(c);
  for (const f of r.failures.slice(0, 3)) console.log(`not passing, proves nothing: ${f}`);
  return r.failures.length === 0 ? [{ id: c.id, features: animationFeatures(c.compiled), samples: { ios: iosSamples.get(c.id) ?? [], android: androidSamples.get(c.id) ?? [] } }] : [];
});
const committed = committedLanes();
// MQ-R1: the resize cases that pass the resize host lanes against the committed resize captures prove the media rows.
const resize = resizeReport();
for (const f of resize.failures.slice(0, 3)) console.log(`not passing, proves nothing: ${f}`);
const resizePassing = resize.passing.map((c) => ({ id: c.id, features: mediaFeatures(c.compiled) }));
// SELD-R2 PR 5: the forced cases that pass the host lanes and force :focus or :focus-visible in a case with no focusable element
// prove the forced-only interaction rows; on a native target only when each passes its device lanes (deriveInteractionRows).
const passedHost = new Set(cases.filter((c) => c.status === 'pass' && c.lanes['chrome-dual'] === 'pass').map((c) => c.id));
const forcedOnly = FIXTURES.filter((spec) => INTERACTION_FORCED.has(spec.id)).flatMap((spec) => {
  const compiled = new Map<'ltr' | 'rtl', ReturnType<typeof compileFixture>['compiled']>();
  const compiledOf = (d: 'ltr' | 'rtl') => {
    const c = compiled.get(d) ?? compileFixture(spec, NO_FAULTS, 'enforce', d).compiled;
    compiled.set(d, c);
    return c;
  };
  return forcedCases(spec, compiledOf).flatMap((c) => {
    if (!passedHost.has(c.id)) return [];
    const p = interactionPartitionOf(compiledOf(c.environment.direction), c.assignment);
    if (p === null) throw new Error(`${c.id}: a forced case without an interaction partition`);
    if (p.elements.some((e) => e.focusable)) return [];
    const features = [...new Set((c.forced ?? []).flatMap((f) => (f.pseudo === 'focus' || f.pseudo === 'focus-visible' ? [interactionRowFeature(f.pseudo)] : [])))];
    return features.length === 0 ? [] : [{ id: c.id, features }];
  });
});
for (const target of ['ios', 'android', 'web'] as const) {
  const device = target === 'web' ? null : committed.evidence(target);
  const rows = [...deriveRows(target, cases), ...deriveAnimationRows(target, framePassing, device), ...deriveMediaRows(target, resizePassing), ...deriveInteractionRows(target, forcedOnly, device)];
  writeFileSync(repoPath(`packages/dragon/src/profiles/${target}.ts`), profileSource(target, rows));
  console.log(`${target}: ${rows.length} rows from ${cases.length} cases`);
}
const { lanes, stale } = committed;
writeFileSync(repoPath('packages/dragon/src/profiles/native-lanes.ts'), nativeLanesSource({ ios: committed.verdict('ios'), android: committed.verdict('android') }));
console.log(`native lanes: ${lanes === null ? 'no committed lanes.json' : `${stale.length} stale`}`);
