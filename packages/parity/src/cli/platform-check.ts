// pnpm run parity:platform-check <platform>: checks a platform's committed Chrome captures (packages/parity/expected/<platform>,
// written by pnpm run parity:capture on that platform) against the reference platform's. Hard: (1) the same cases, node ids, kinds
// and hasBox; (2) every computed value equal except the root font-family of fixtures that keep Chrome's UA font (keyed UA dataset);
// (3) chrome-dual exact, live on this machine, which must be that platform: the authored rendering against Dragon's web output
// compiled for the reference environment. Fixtures that keep Chrome's UA font are listed as refused for (3): their compiled CSS pins
// the reference platform's UA font. Information only: geometry deltas against the reference captures and against Dragon's layout
// under the reference platform's rules. Writes packages/parity/out/platform-check-<platform>.json; exits 1 on a hard failure.
import { mkdirSync, writeFileSync } from 'node:fs';
import { absoluteRects, layout, measurerFor, validateLayoutInput } from '@dragon/layout';
import { referenceShapedMeasurer } from '../text-shaper-host.ts';
import { nativeLayoutProjection, resolvedColors, resolvedTextColors, WEB_CSS_PATH, webClassMap } from 'dragon';
import { captureFixture } from '../capture.ts';
import { casesOf, fixtureInput } from '../cases.ts';
import { launchChrome } from '../chrome.ts';
import { compareLayout } from '../compare.ts';
import { compareDual } from '../dual.ts';
import { FIXTURES } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import { authoredPrepareOf, compileFixture, forcedCases } from '../pipeline.ts';
import { prepareOf } from '../forced-pseudo.ts';
import { checkPlatformCaptures, readCaptures } from '../platform-check.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';

const platform = process.argv[2];
if (platform === undefined || !/^[a-z0-9]+-[a-z0-9]+$/.test(platform)) {
  console.error('usage: pnpm run parity:platform-check <platform>, for example linux-x64');
  process.exit(1);
}
const reference = readCaptures(REFERENCE_PLATFORM);
const target = readCaptures(platform);
if (target.size === 0) {
  console.error(`no captures under packages/parity/expected/${platform}; run pnpm run parity:capture on ${platform} first`);
  process.exit(1);
}
const uaDefault = new Set(FIXTURES.filter((f) => f.kind === 'layout' && f.rootFont === 'ua-default').map((f) => f.id));
const captures = checkPlatformCaptures(reference, target, uaDefault);
const problems = [...captures.problems];
const dual: { case: string; pass: boolean; problems: readonly string[] }[] = [];
const refused: { fixture: string; reason: string }[] = [];
const dragon: { case: string; node: string; maxEdgeDeltaPx: number; exactLu: boolean }[] = [];
const m = measurerFor(REFERENCE_PLATFORM);
if (m.kind !== 'ok') throw new Error(m.detail);
if (hostPlatform() !== platform) problems.push(`chrome-dual needs a live Chrome on ${platform}; this machine is ${hostPlatform()}`);
else {
  const browser = await launchChrome();
  try {
    for (const spec of FIXTURES) {
      if (spec.kind !== 'layout') continue;
      if (spec.rootFont === 'ua-default') {
        refused.push({ fixture: spec.id, reason: `its compiled CSS pins the ${REFERENCE_PLATFORM} UA font; ${platform} has no UA dataset` });
        continue;
      }
      for (const c of [...casesOf(spec, fixtureInput(spec)), ...forcedCases(spec)]) {
        const state = c.interaction ?? null;
        const { compiled } = compileFixture(spec, undefined, 'enforce', c.environment.direction);
        const web = compiled.outputs.web;
        const css = web.kind === 'ready' ? web.files.find((f) => f.path === WEB_CSS_PATH) : undefined;
        const classOf = webClassMap(compiled, c.assignment);
        const colors = resolvedColors(compiled, c.assignment, state);
        const textColors = resolvedTextColors(compiled, c.assignment, state);
        if (css === undefined || classOf === null || colors === null || textColors === null) {
          problems.push(`${c.id}: the reference compile gives no web output`);
          continue;
        }
        const authored = await captureFixture(browser, c.id, c.authoredHtml, c.environment, c.computedExtra, authoredPrepareOf(c));
        const compiledCapture = await captureFixture(browser, c.id, c.compiledHtml(css.text, classOf), c.environment, c.computedExtra, prepareOf(c));
        const d = compareDual(authored, compiledCapture, colors, textColors, c.computedExtra);
        dual.push({ case: c.id, pass: d.pass, problems: d.problems });
        if (!d.pass) problems.push(`${c.id}: chrome-dual: ${d.problems.join('; ')}`);
        // Information only: Dragon under the reference platform's rules against this platform's capture.
        const own = target.get(c.id);
        const p = nativeLayoutProjection(compiled, c.environment, c.assignment, state);
        if (own === undefined || p.kind !== 'ready') continue;
        const v = validateLayoutInput(JSON.parse(JSON.stringify(p.input)));
        if (!v.ok) continue;
        const r = layout(v.input, referenceShapedMeasurer());
        if (r.kind !== 'ok') continue;
        for (const n of compareLayout(own, absoluteRects(r.boxes), v.input, c.environment).nodes) {
          if (n.exactLu || n.delta === null) continue;
          dragon.push({ case: c.id, node: n.id, maxEdgeDeltaPx: Math.max(Math.abs(n.delta.left), Math.abs(n.delta.top), Math.abs(n.delta.right), Math.abs(n.delta.bottom)), exactLu: false });
        }
      }
    }
  } finally {
    await browser.close();
  }
}
const out = {
  platform,
  referencePlatform: REFERENCE_PLATFORM,
  hard: { pass: problems.length === 0, problems, comparedCases: captures.comparedCases, comparedNodes: captures.comparedNodes, comparedValues: captures.comparedValues, dualCases: dual.length, dualPassed: dual.filter((d) => d.pass).length },
  exemptions: captures.exemptions,
  dualRefused: refused,
  information: { geometryAgainstReference: captures.geometry, dragonUnderReferenceRules: dragon },
};
mkdirSync(repoPath('packages/parity/out'), { recursive: true });
writeFileSync(repoPath(`packages/parity/out/platform-check-${platform}.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(`platform-check ${platform} against ${REFERENCE_PLATFORM}: ${captures.comparedCases} cases, ${captures.comparedNodes} nodes, ${captures.comparedValues} computed values; ${captures.exemptions.length} UA-dataset exemptions; chrome-dual ${dual.filter((d) => d.pass).length}/${dual.length} (refused: ${refused.map((r) => r.fixture).join(', ') || 'none'}); information: ${captures.geometry.length} nodes move against the reference, ${dragon.length} nodes are not exact under ${REFERENCE_PLATFORM} rules`);
for (const p of problems) console.log(`FAIL ${p}`);
if (problems.length > 0) process.exitCode = 1;
