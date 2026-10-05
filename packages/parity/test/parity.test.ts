import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromeDeviations, NO_ENGINE_FAULTS, platformRules } from '@dragon/layout';
import type { Assignment, ProfileRow } from 'dragon';
import { CATALOGUE, iosProfile, NO_FAULTS, PROPERTY_ASPECTS, PROPERTY_ROLE, webProfile } from 'dragon';
import type { Longhand } from 'dragon';
import type { WebCapture } from '../src/capture.ts';
import { captureFixture, captureJson } from '../src/capture.ts';
import type { ParityCase } from '../src/cases.ts';
import { CHROME_VERSION, harnessStyle, launchChrome } from '../src/chrome.ts';
import { emittedPath, expectedDir, expectedPath } from '../src/committed.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';
import { ENVIRONMENT, environmentsOf, FIXTURES, RTL_ENVIRONMENT } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';
import type { CaseOutcome, FixtureOutcome } from '../src/pipeline.ts';
import { caseCountProblems, forcedCases, runFixture, topologyProblems } from '../src/pipeline.ts';
import { fixtureInput, isForcedCaseId } from '../src/cases.ts';
import { compileFixture } from '../src/pipeline.ts';
import { compilerChromeDeviations } from '../src/compiler-deviations.ts';
import { readTreeExpectation } from '../src/tree-fixture.ts';
import { prepareOf } from '../src/forced-pseudo.ts';
import { ANIMATION_CONTEXT, deriveRows } from '../src/profile-rows.ts';
import { animFixtures } from '../src/anim-cases.ts';
import { DETERMINISM_CHUNKS, determinismChunk, shuffled } from './determinism.ts';

// T065: the row checks here are about rows proven by layout cases. Animation rows (context animation) are proven by frame cases
// against frame captures, and anim-frames.test.ts gives them the same checks: exactly the passing cases that use the key, every
// used key has a row, exactly what profile:rows derives, the context and lane shape, and every proof case a passing frame case.
const layoutRows = <R extends { readonly context: string }>(rows: readonly R[]): R[] => rows.filter((r) => r.context !== ANIMATION_CONTEXT);
import { buildReport, renderSummary, writeReport } from '../src/report.ts';
import { hostPlatform, REFERENCE_PLATFORM, requireReferencePlatform } from '../src/platform.ts';
import { FONT_FIXTURES } from '../src/fixture-groups/fonts.ts';
import { fontEmittedPath, fontExpectedPath, liveFontAuthored, runFontFixture } from '../src/fonts-run.ts';
import type { FrontEndResult } from 'dragon';

let browser: Browser;
const outcomes = new Map<string, FixtureOutcome>();
const captures = new Map<string, WebCapture>();

beforeAll(async () => {
  // Off the reference platform the suite fails here with "reference platform darwin-arm64 required; Linux lane unavailable".
  requireReferencePlatform(hostPlatform());
  // A missing or wrong Chromium throws here and fails the run; it never skips.
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});

afterAll(async () => {
  await browser.close();
});

function specFor(id: string): (typeof FIXTURES)[number] {
  const spec = FIXTURES.find((f) => f.id === id);
  if (spec === undefined) throw new Error(`fixture ${id} missing`);
  return spec;
}

/** TXT1-C: the web-only fonts cases (fonts-run.ts), which prove web rows through chrome-dual alone. */
const fontOutcomes = new Map<string, CaseOutcome[]>();
const corpusCases = (): CaseOutcome[] => FIXTURES.flatMap((f) => (outcomes.get(f.id)?.cases ?? []));
const fontCasesRun = (): CaseOutcome[] => FONT_FIXTURES.flatMap((f) => fontOutcomes.get(f.spec.id) ?? []);
const allCases = (): CaseOutcome[] => [...corpusCases(), ...fontCasesRun()];
const recorded = async (c: ParityCase): Promise<WebCapture> => {
  const hit = captures.get(c.id);
  if (hit === undefined) throw new Error(`no live capture for ${c.id}`);
  return hit;
};
const describeAssignment = (a: Assignment): string => a.map((e) => `${e.state.instance}.${e.state.state}=${JSON.stringify(e.value)}`).join(',');

describe.sequential('S5 parity: Chrome 145 vs Dragon, every case of every fixture in every environment (layout lane at 1 device px, dual lane exact)', () => {
  it('the gate is owner decision 13: one device pixel, never per fixture', () => {
    expect(GATE_DEVICE_PX).toBe(1);
    for (const f of FIXTURES) if (f.kind === 'layout') expect(f.gate).toBe('default');
  });

  it('fixture registry (M7): every packages/parity/fixtures entry is registered, and every registered fixture has its file', () => {
    const dir = repoPath('packages/parity/fixtures');
    const entries = readdirSync(dir).sort();
    // Frame fixtures (T065) are registered by their frames.json sidecar (anim-cases.ts animFixtures) and are not layout fixtures.
    const frames = animFixtures().map((f) => f.id);
    for (const id of frames) expect(FIXTURES.some((f) => f.id === id), `${id} is both a frame fixture and in FIXTURES`).toBe(false);
    const registered = new Set([...[...FIXTURES, ...FONT_FIXTURES.map((f) => f.spec)].map((f) => (f.format === 'html' ? `${f.id}.html` : f.id)), ...frames]);
    for (const f of FONT_FIXTURES) expect(statSync(`${dir}/${f.spec.id}.html`).isFile(), f.spec.id).toBe(true);
    expect(new Set([...FIXTURES.map((f) => f.id), ...FONT_FIXTURES.map((f) => f.spec.id)]).size).toBe(FIXTURES.length + FONT_FIXTURES.length);
    for (const e of entries) expect(registered.has(e), `${e} is not in FIXTURES`).toBe(true);
    for (const f of FIXTURES) {
      if (f.format === 'html') expect(statSync(`${dir}/${f.id}.html`).isFile(), f.id).toBe(true);
      else expect(statSync(`${dir}/${f.id}/fixture.json`).isFile(), f.id).toBe(true);
    }
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
    // The rtl case and emitted-file suffix cannot collide with a fixture id.
    for (const f of FIXTURES) expect(f.id.endsWith('-rtl'), f.id).toBe(false);
    // S4b (C): every positioning HTML fixture runs in both environment directions; tree fixtures always do; others declare theirs.
    for (const f of FIXTURES) {
      if (f.kind !== 'layout') continue;
      if (f.format === 'tree' || /^(position|flex-abspos)-/.test(f.id)) expect(f.environments, f.id).toEqual(['ltr', 'rtl']);
      else expect(f.environments.length, f.id).toBeGreaterThan(0);
      expect(environmentsOf(f).map((e) => e.direction), f.id).toEqual(f.environments);
    }
    // The generator selections are committed files, and together they name exactly the fixtures registered as generated.
    const selections = [['granularity-selection.json', 'scripts/gen-granularity-fixtures.ts'], ['baseline-source-selection.json', 'scripts/gen-baseline-source-matrix.ts']].map(([file, generator]) => {
      const sel = JSON.parse(readFileSync(repoPath(`packages/parity/generated/${file}`), 'utf8')) as { generator: string; fixtures: string[] };
      expect(sel.generator).toBe(generator);
      return sel;
    });
    expect(readdirSync(repoPath('packages/parity/generated')).sort()).toEqual(['baseline-source-selection.json', 'granularity-selection.json']);
    const generatedIds = selections.flatMap((x) => x.fixtures);
    expect(FIXTURES.filter((f) => f.kind === 'layout' && f.source === 'generated').map((f) => f.id).sort()).toEqual([...generatedIds].sort());
    for (const id of generatedIds) expect(specFor(id), id).toMatchObject({ kind: 'layout', source: 'generated', environments: ['ltr', 'rtl'], rootFont: 'ahem' });
    // Every layout fixture runs on the Ahem root environment except the ones that compare Chrome's UA font.
    expect(FIXTURES.filter((f) => f.kind === 'layout' && f.rootFont === 'ua-default').map((f) => f.id)).toEqual(['block-ua-divs']);
  });

  for (const spec of FIXTURES) {
    it(`${spec.id} (${spec.format} ${spec.kind})`, async () => {
      const live = async (c: ParityCase): Promise<WebCapture> => {
        const capture = await captureFixture(browser, c.id, c.authoredHtml, c.environment, c.computedExtra, prepareOf(c));
        captures.set(c.id, capture);
        expect(captureJson(capture), `${c.id}: the live capture must equal the committed expected file`).toBe(readFileSync(expectedPath(c.id), 'utf8'));
        return capture;
      };
      const outcome = await runFixture(spec, browser, { authored: live, faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      outcomes.set(spec.id, outcome);
      expect(outcome.reason).toBeNull();
      expect(outcome.status).toBe('pass');
      for (const d of outcome.diagnostics) {
        const entry = CATALOGUE[d.code as keyof typeof CATALOGUE];
        expect(entry, d.code).toBeDefined();
        expect(d.fix, d.code).toBe(entry.fix.kind);
        expect(d.severity, d.code).toBe(entry.severity);
      }
      if (spec.kind === 'layout') {
        // SELD-R2a forced cases run beside the reachable cases and are not counted among them; each one is a forcedCases entry.
        expect(outcome.cases.filter((c) => !isForcedCaseId(c.id)).length).toBe(outcome.expectedCases);
        expect(outcome.cases.filter((c) => isForcedCaseId(c.id)).map((c) => c.id)).toEqual(forcedCases(spec).map((c) => c.id));
        expect(outcome.dragonCases).toBe(outcome.expectedCases);
        for (const e of outcome.environments) expect([e.renderer, e.dragon], `${spec.id} ${e.direction}`).toEqual([e.expected, e.expected]);
        for (const c of outcome.cases) {
          expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
          expect(c.unsupported, c.id).toBeNull();
        }
        expect(outcome.webCss.ltr, 'emitted web CSS must equal the committed file').toBe(readFileSync(emittedPath(spec.id, 'ltr'), 'utf8'));
        if (spec.environments.includes('rtl')) expect(outcome.webCss.rtl, 'emitted rtl web CSS must equal the committed file').toBe(readFileSync(emittedPath(spec.id, 'rtl'), 'utf8'));
        else expect(existsSync(emittedPath(spec.id, 'rtl'))).toBe(false);
        // Each environment has its own cases and captures, and the capture's root direction is the environment's.
        for (const d of spec.environments) {
          const own = outcome.cases.filter((c) => c.direction === d);
          expect(own.length, `${spec.id} ${d}`).toBeGreaterThan(0);
          for (const c of own) {
            const committed = JSON.parse(readFileSync(expectedPath(c.id), 'utf8')) as WebCapture;
            expect([committed.direction, committed.nodes.find((n) => n.id === 'html')?.computed?.['direction']], c.id).toEqual([d, d]);
          }
        }
      } else {
        expect(outcome.cases).toEqual([]);
        expect(existsSync(emittedPath(spec.id, 'ltr'))).toBe(false);
        expect(existsSync(emittedPath(spec.id, 'rtl'))).toBe(false);
        expect(readdirSync(expectedDir()).filter((f) => f.startsWith(`${spec.id}.`) || f.startsWith(`${spec.id}#`))).toEqual([]);
      }
    });
  }

  for (const f of FONT_FIXTURES) {
    it(`${f.spec.id} (web-only fonts fixture: chrome-dual alone)`, async () => {
      const live = liveFontAuthored(browser, f);
      const recordLive = async (c: ParityCase): Promise<WebCapture> => {
        const capture = await live(c);
        captures.set(c.id, capture);
        expect(captureJson(capture), `${c.id}: the live capture must equal the committed expected-fonts file`).toBe(readFileSync(fontExpectedPath(c.id), 'utf8'));
        return capture;
      };
      const cases = await runFontFixture(f, browser, { authored: recordLive });
      fontOutcomes.set(f.spec.id, cases);
      expect(cases.map((c) => c.direction)).toEqual(f.spec.kind === 'layout' ? f.spec.environments : []);
      for (const c of cases) {
        expect(c.reason, c.id).toBeNull();
        expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'not-run', 'chrome-dual': 'pass' });
        expect(c.features.ios, c.id).toEqual([]);
      }
      for (const d of ['ltr', 'rtl'] as const) {
        const web = compileFixture(f.spec, NO_FAULTS, 'enforce', d).compiled.outputs.web;
        expect(web.kind === 'ready' ? web.files[0]?.text : null, `${f.spec.id} ${d}: emitted web CSS must equal the committed file`).toBe(readFileSync(fontEmittedPath(f.spec.id, d), 'utf8'));
      }
    }, 240_000);
  }

  it('committed captures are exactly the cases of this run, under the reference platform key only', () => {
    expect(readdirSync(repoPath('packages/parity/expected'))).toEqual([REFERENCE_PLATFORM]);
    const files = readdirSync(expectedDir()).filter((f) => f.endsWith('.web.json')).sort();
    expect(files).toEqual(corpusCases().map((c) => `${c.id}.web.json`).sort());
  });

  it('planted fault: swapping content-box and border-box in the ios lowering fails the layout gate', async () => {
    const faulty = await runFixture(specFor('block-content-box-padding-border'), browser, { authored: recorded, faults: { ...NO_FAULTS, swapBoxSizing: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    const c = faulty.cases[0] as CaseOutcome;
    expect(faulty.status).toBe('fail');
    expect(c.lanes['linux-dragon-layout']).toBe('fail');
    expect(c.reason).toMatch(/exceeds 1 device px/);
    expect(c.comparison?.nodes.find((n) => n.id === 'box')?.pass).toBe(false);
  });

  it('planted fault: a resolver that collapses compound-class variants fails the dual check', async () => {
    const faulty = await runFixture(specFor('cascade-compound-variants'), browser, { authored: recorded, faults: { ...NO_FAULTS, variantCollapse: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    const c = faulty.cases[0] as CaseOutcome;
    expect(faulty.status).toBe('fail');
    expect(c.lanes['chrome-dual']).toBe('fail');
    expect((c.dual?.valuesEqual ?? 0) < (c.dual?.valuesCompared ?? 0)).toBe(true);
    expect(c.reason).toMatch(/chrome-dual: /);
  });

  it('planted fault: :is() with its first argument\'s specificity instead of its most specific one fails selectors-specificity', async () => {
    const faulty = await runFixture(specFor('selectors-specificity'), browser, { authored: recorded, faults: { ...NO_FAULTS, isSpecificityFirstArgument: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    const c = faulty.cases[0] as CaseOutcome;
    expect(faulty.status).toBe('fail');
    expect(c.lanes['chrome-dual']).toBe('fail');
    expect(c.lanes['linux-dragon-layout']).toBe('fail');
    expect(c.comparison?.nodes.filter((n) => !n.pass).map((n) => n.id).sort()).toEqual(['a', 'i']);
  });

  // Resolving direction before var() substitution, or letting a var() flow-relative declaration win both physical sides, fails
  // every case of its fixture in both environments on exactly these nodes.
  const varDirectionFaults = [
    { fault: 'directionBeforeVar', fixture: 'var-direction', nodes: { 'var-direction': ['a2', 'a3a', 'a5', 'b1', 'b2b', 'b3', 'b4', 'd3', 'd5', 'e2'], 'var-direction-rtl': ['a4', 'b2b', 'd3', 'd5', 'e2'] } },
    { fault: 'varLogicalBothSides', fixture: 'var-logical', nodes: { 'var-logical': ['a1', 'a10', 'a2', 'a3', 'a5', 'b1', 'b10', 'b2', 'b3', 'd5', 'd6', 'd8', 'd9', 'e5', 'e6', 'e8', 'e9'], 'var-logical-rtl': ['a1', 'a10', 'a2', 'a3', 'b1', 'b10', 'b2', 'b3', 'd5', 'd6', 'd8', 'd9', 'e5', 'e6', 'e8', 'e9'] } },
  ] as const;
  for (const f of varDirectionFaults) {
    it(`planted fault: ${f.fault} fails ${f.fixture} in both directions`, async () => {
      const faulty = await runFixture(specFor(f.fixture), browser, { authored: recorded, faults: { ...NO_FAULTS, [f.fault]: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(faulty.cases.map((c) => c.id).sort()).toEqual(Object.keys(f.nodes).sort());
      for (const c of faulty.cases) {
        expect(c.status, c.id).toBe('fail');
        expect(c.lanes['chrome-dual'], c.id).toBe('fail');
        expect(c.comparison?.nodes.filter((n) => !n.pass).map((n) => n.id).sort(), c.id).toEqual([...f.nodes[c.id as keyof typeof f.nodes]].sort());
      }
    });
  }

  for (const d of compilerChromeDeviations) {
    it(`compiler Chrome deviation ${d.id}: the spec reading (${d.fault}) fails ${d.fixture} on ${d.nodes.join(', ')} in every case`, async () => {
      const faulty = await runFixture(specFor(d.fixture), browser, { authored: recorded, faults: { ...NO_FAULTS, [d.fault]: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(faulty.cases.length).toBeGreaterThan(0);
      for (const c of faulty.cases) {
        expect(c.status, c.id).toBe('fail');
        expect(c.lanes['chrome-dual'], c.id).toBe('fail');
        expect(c.comparison?.nodes.filter((n) => !n.pass).map((n) => n.id).sort(), c.id).toEqual([...d.nodes].sort());
      }
    });
  }

  it('planted fault: a colour-only resolver error fails the dual check on channels while the layout lane passes', async () => {
    const faulty = await runFixture(specFor('color-syntax'), browser, { authored: recorded, faults: { ...NO_FAULTS, colourOnly: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    const c = faulty.cases[0] as CaseOutcome;
    expect(faulty.status).toBe('fail');
    expect(c.lanes['linux-dragon-layout']).toBe('pass');
    expect(c.lanes['chrome-dual']).toBe('fail');
    const dual = c.dual;
    if (dual === null) throw new Error('no dual comparison');
    expect(dual.boxesEqual).toBe(dual.boxesCompared);
    expect(dual.channelsEqual).toBeLessThan(dual.channelsCompared);
    expect(dual.problems.every((p) => /color/.test(p))).toBe(true);
  });

  it('planted fault: stateCollapse on a/trigger fails exactly the non-initial cases of instance a in both directions, and the initial cases pass', async () => {
    const faulty = await runFixture(specFor('tree-switch-two-instances'), browser, { authored: recorded, faults: { ...NO_FAULTS, stateCollapse: 'a/trigger' }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    expect(faulty.status).toBe('fail');
    expect(faulty.cases.length).toBe(32);
    const aAtInitial = (c: CaseOutcome): boolean => c.assignment.filter((e) => e.state.instance === 'doc/a').every((e) => e.value === false);
    const failing = faulty.cases.filter((c) => c.status === 'fail').map((c) => `${c.direction} ${describeAssignment(c.assignment)}`);
    const expected = faulty.cases.filter((c) => !aAtInitial(c)).map((c) => `${c.direction} ${describeAssignment(c.assignment)}`);
    expect(failing).toEqual(expected);
    expect(failing.length).toBe(24);
    for (const c of faulty.cases) {
      if (aAtInitial(c)) {
        expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
        continue;
      }
      // Every non-initial state of a changes a computed value on a/trigger or a/knob, and each one changes geometry here.
      expect(c.lanes['chrome-dual'], c.id).toBe('fail');
      expect((c.dual?.valuesEqual ?? 0) < (c.dual?.valuesCompared ?? 0), c.id).toBe(true);
      expect(c.dual?.problems.some((p) => p.startsWith('a/trigger: ') || p.startsWith('a/knob: ')), c.id).toBe(true);
      expect(c.lanes['linux-dragon-layout'], c.id).toBe('fail');
    }
    for (const initial of faulty.cases.filter((c) => c.isInitial)) expect(initial.status, initial.id).toBe('pass');
  });

  it('planted fault dropInheritedText: text font-size reverts to its initial value and the multi-line fixture fails the layout lane', async () => {
    const faulty = await runFixture(specFor('text-wrap-spaces'), browser, { authored: recorded, faults: { ...NO_FAULTS, dropInheritedText: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    const c = faulty.cases[0] as CaseOutcome;
    expect(faulty.status).toBe('fail');
    expect(c.lanes['linux-dragon-layout']).toBe('fail');
    expect(c.lanes['chrome-dual']).toBe('pass');
    expect(c.comparison?.problems.some((p) => /^w1:text0:line0: /.test(p))).toBe(true);
    expect(outcomes.get('text-wrap-spaces')?.status).toBe('pass');
  });

  it('planted engine fault breakOffByOne: a break one glyph late fails text-wrap-spaces on the layout lane', async () => {
    const faulty = await runFixture(specFor('text-wrap-spaces'), browser, { authored: recorded, faults: NO_FAULTS, engineFaults: { ...NO_ENGINE_FAULTS, breakOffByOne: true }, profiles: 'enforce' });
    const c = faulty.cases[0] as CaseOutcome;
    expect(faulty.status).toBe('fail');
    expect(c.lanes['linux-dragon-layout']).toBe('fail');
    expect(c.lanes['chrome-dual']).toBe('pass');
    expect(c.comparison?.problems.some((p) => /^w5:text0:line\d+: /.test(p))).toBe(true);
    expect(outcomes.get('text-wrap-spaces')?.cases[0]?.lanes).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
  });

  const engineFaultCases: readonly { fault: 'rtlAsLtr' | 'ignoreOrder' | 'baselineFromBorderTop' | 'scrollMinAuto' | 'absposInFlow' | 'cbIgnoresPadding' | 'staticPosLtr' | 'relativeShiftsFlow'; fixture: string; nodes: readonly string[] }[] = [
    // text-align start in rtl laid out as left: every start-aligned line and the overflowing start line move.
    { fault: 'rtlAsLtr', fixture: 'rtl-text-align-multi-line', nodes: ['s:text0:line0', 'so:text0:line0', 'd:text0:line1'] },
    { fault: 'ignoreOrder', fixture: 'flex-order', nodes: ['r1b', 'r1d', 'a1a', 'r3c'] },
    { fault: 'baselineFromBorderTop', fixture: 'flex-baseline-text', nodes: ['b', 'c2b', 'c3a'] },
    { fault: 'scrollMinAuto', fixture: 'overflow-hidden-flex-min-size', nodes: ['r1a', 'r2a', 'c1a'] },
    // S4b: an absolutely positioned box laid out in flow takes space: it and the boxes after it move.
    { fault: 'absposInFlow', fixture: 'position-absolute-out-of-flow', nodes: ['a1', 'q1', 'p2'] },
    // The content box instead of the padding box: every inset is measured from the wrong edge.
    { fault: 'cbIgnoresPadding', fixture: 'position-absolute-containing-block', nodes: ['a1', 'a2', 'b2'] },
    // The static position in an rtl block ignores the direction and starts at the left content edge.
    { fault: 'staticPosLtr', fixture: 'position-absolute-static-block', nodes: ['a3', 'a4'] },
    // A relative offset that also moves the following siblings.
    { fault: 'relativeShiftsFlow', fixture: 'position-relative-flow', nodes: ['s1', 's2', 's3'] },
  ];
  for (const planted of engineFaultCases) {
    it(`planted engine fault ${planted.fault}: ${planted.fixture} fails the layout lane on its named nodes while chrome-dual passes`, async () => {
      const faulty = await runFixture(specFor(planted.fixture), browser, { authored: recorded, faults: NO_FAULTS, engineFaults: { ...NO_ENGINE_FAULTS, [planted.fault]: true }, profiles: 'enforce' });
      const c = faulty.cases[0] as CaseOutcome;
      expect(faulty.status).toBe('fail');
      expect(c.lanes).toEqual({ 'linux-dragon-layout': 'fail', 'chrome-dual': 'pass' });
      const failing = new Set((c.comparison?.nodes ?? []).filter((n) => !n.pass).map((n) => n.id));
      for (const node of planted.nodes) expect(failing.has(node), `${planted.fault} moves ${node}`).toBe(true);
      // With the fault off the same fixture passes both lanes in the main run.
      expect(outcomes.get(planted.fixture)?.cases[0]?.lanes).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
    });
  }

  it('planted compiler fault ignoreEnvironmentDirection (M4): the root resolves ltr in the rtl environment, so named rtl tree cases fail chrome-dual and the ltr cases pass', async () => {
    for (const fixture of ['tree-param-args', 'tree-projected-text']) {
      const faulty = await runFixture(specFor(fixture), browser, { authored: recorded, faults: { ...NO_FAULTS, ignoreEnvironmentDirection: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(faulty.status, fixture).toBe('fail');
      for (const c of faulty.cases) {
        if (c.direction === 'ltr') expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
        else {
          expect(c.lanes['chrome-dual'], c.id).toBe('fail');
          expect(c.dual?.problems.some((p) => /direction authored "rtl" compiled "ltr"/.test(p)), c.id).toBe(true);
        }
      }
      expect(faulty.cases.filter((c) => c.direction === 'rtl').map((c) => c.id)).toContain(`${fixture}#0-rtl`);
      // With the fault off every case passes in the main run.
      for (const c of outcomes.get(fixture)?.cases ?? []) expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
    }
  });

  for (const rule of platformRules) {
    it(`platform rule ${rule.id} (M1): planted fault ${rule.fault} makes its registered nodes non-exact at 1/64 px, and they are exact with the fault off`, async () => {
      for (const fixture of [...new Set(rule.nodes.map((n) => n.fixture))]) {
        const faulty = await runFixture(specFor(fixture), browser, { authored: recorded, faults: NO_FAULTS, engineFaults: { ...NO_ENGINE_FAULTS, [rule.fault]: true }, profiles: 'enforce' });
        const faultyNodes = faulty.cases.flatMap((c) => c.comparison?.nodes ?? []);
        const mainNodes = outcomes.get(fixture)?.cases.flatMap((c) => c.comparison?.nodes ?? []) ?? [];
        for (const n of rule.nodes.filter((x) => x.fixture === fixture)) {
          expect(faultyNodes.find((x) => x.id === n.node)?.exactLu, `${rule.fault} -> ${n.node}`).toBe(false);
          expect(mainNodes.find((x) => x.id === n.node)?.exactLu, `${n.node} with the fault off`).toBe(true);
        }
      }
    });
  }

  it('profile proofs (M1): every row and proof names exactly the cases that passed its lane and use its key; every used key has a row', () => {
    const cases = allCases();
    for (const [target, profile] of [['ios', iosProfile], ['web', webProfile]] as const) {
      expect(layoutRows(profile.rows).length).toBeGreaterThan(0);
      for (const row of layoutRows(profile.rows)) {
        const key = `${row.feature}@${row.context}`;
        for (const proof of row.proofs) {
          const expected = cases.filter((c) => c.lanes[proof.lane] === 'pass' && c.features[target].includes(key)).map((c) => c.id);
          expect(proof.cases, `${target} ${key} ${proof.lane}`).toEqual(expected);
          expect(proof.cases.length, `${target} ${key}`).toBeGreaterThan(0);
          expect([proof.valueSubset, proof.context], key).toEqual([row.feature.slice(row.feature.indexOf(':') + 1), row.context]);
        }
      }
      const keys = new Set(profile.rows.map((r) => `${r.feature}@${r.context}`));
      for (const c of cases) for (const k of c.features[target]) expect(keys.has(k), `${target} ${k} used by ${c.id} has no row`).toBe(true);
      expect(layoutRows(profile.rows), `${target} rows must be exactly what pnpm run profile:rows derives from this run`).toEqual(deriveRows(target, cases));
    }
  });

  it('paint classification comes from PROPERTY_ASPECTS (M8): no iOS paint row is exact, border-*-style:solid included', () => {
    const aspects = (row: ProfileRow) => PROPERTY_ASPECTS[row.feature.slice(0, row.feature.indexOf(':')) as Longhand];
    for (const row of iosProfile.rows) {
      const a = aspects(row);
      expect(a, row.feature).toBeDefined();
      if (a.paint) {
        expect(row.status, `${row.feature}: no native paint lane yet`).toBe('caveat');
        expect(row.proofs.some((p) => p.aspect === 'computed-value' && p.lane === 'chrome-dual'), row.feature).toBe(true);
      } else {
        expect(row.status, row.feature).toBe('exact');
      }
      if (a.layout) expect(row.proofs.some((p) => p.aspect === 'layout' && p.lane === 'linux-dragon-layout'), row.feature).toBe(true);
    }
    expect(iosProfile.rows.filter((r) => r.status === 'exact' && aspects(r).paint)).toEqual([]);
    // iOS clipping is a paint aspect: overflow rows carry a layout proof and stay caveat.
    const overflow = iosProfile.rows.filter((r) => /^overflow-[xy]:/.test(r.feature));
    expect(overflow.length).toBeGreaterThan(0);
    for (const r of overflow) expect([r.status, r.proofs.map((p) => p.lane).sort()], `${r.feature}@${r.context}`).toEqual(['caveat', ['chrome-dual', 'linux-dragon-layout']]);
    const solid = iosProfile.rows.filter((r) => /^border-(top|right|bottom|left)-style:solid$/.test(r.feature));
    expect(solid.length).toBeGreaterThan(0);
    for (const r of solid) expect(r.status).toBe('caveat');
    for (const row of webProfile.rows) {
      // A family left to the platform by the font map is caveat (fonts/font-map.ts supportOf); every other web row is exact.
      expect(row.status, `${row.feature}@${row.context}`).toBe(row.feature === 'font-family:<platform>' ? 'caveat' : 'exact');
      for (const p of row.proofs) expect(p.lane).toBe('chrome-dual');
      expect(row.proofs.some((p) => p.aspect === 'computed-value'), row.feature).toBe(true);
    }
  });

  it('row keys carry the formatting context (M2, M3, C7, S4b): <length-px>; every context has a direction facet, flex text contexts a main-axis facet, positioned item contexts the scheme, paint rows only @paint/<dir>', () => {
    const directions = ['ltr', 'rtl'];
    const textContexts = directions.flatMap((d) => ['text-in-block/' + d, 'text-in-anonymous-block/' + d, 'text-in-flex-item/row/' + d, 'text-in-flex-item/column/' + d, 'text-as-anonymous-flex-item/row/' + d, 'text-as-anonymous-flex-item/column/' + d]);
    const boxContexts = /^(root|block|flex-row|flex-column|display-none|flex-row-single-line|flex-row-multi-line|flex-column-single-line|flex-column-multi-line|not-flex-container)\/(ltr|rtl)$/;
    const itemBases = '(root|block|flex-row|flex-column|display-none)';
    const positioned = new RegExp('^(relative-in-' + itemBases + '/(ltr|rtl)|absolute-in-' + itemBases + '/(ltr|rtl)/cb-(ltr|rtl))$');
    const role = (feature: string) => PROPERTY_ROLE[feature.slice(0, feature.indexOf(':')) as Longhand];
    for (const profile of [iosProfile, webProfile]) {
      for (const row of layoutRows(profile.rows)) {
        expect(row.feature, row.feature).not.toMatch(/<length>/);
        expect(row.context, row.feature).not.toBe('single-line-text');
        const r = role(row.feature);
        if (r === 'text') expect(textContexts, `${row.feature}@${row.context}`).toContain(row.context);
        else if (r === 'paint') expect(row.context, `${row.feature}@${row.context}`).toMatch(/^paint\/(ltr|rtl)$/);
        else if (r === 'item') expect(boxContexts.test(row.context) || positioned.test(row.context), `${row.feature}@${row.context}`).toBe(true);
        else expect(row.context, `${row.feature}@${row.context}`).toMatch(boxContexts);
      }
      // Positioned item contexts carry the scheme and every direction the algorithm reads; the rows exist in both directions.
      for (const key of ['position:relative@relative-in-block/ltr', 'position:relative@relative-in-block/rtl', 'position:relative@relative-in-flex-row/rtl', 'position:absolute@absolute-in-block/ltr/cb-ltr', 'position:absolute@absolute-in-block/rtl/cb-ltr', 'position:absolute@absolute-in-block/ltr/cb-rtl', 'position:absolute@absolute-in-flex-row/rtl/cb-rtl', 'position:absolute@absolute-in-flex-column/ltr/cb-ltr', 'top:<length-px>@absolute-in-block/rtl/cb-rtl']) {
        expect(profile.rows.some((row) => `${row.feature}@${row.context}` === key), `${profile.target} ${key}`).toBe(true);
      }
      // Paint rows: colour syntaxes on colour longhands, keyed by direction only (T036 rec1 colour_rows).
      for (const d of directions) for (const f of ['color:<hex-color>', 'background-color:<hsl()>', 'border-left-color:<rgba()>', 'border-top-color:currentcolor']) {
        expect(profile.rows.some((row) => row.feature === f && row.context === `paint/${d}`), `${profile.target} ${f}@paint/${d}`).toBe(true);
      }
    }
    expect(iosProfile.rows.filter((r) => r.feature.startsWith('font-family:Ahem')).map((r) => r.context).sort()).toEqual([...textContexts].sort());
    expect(iosProfile.rows.some((r) => r.feature === 'width:<length-px>' && r.context === 'block/ltr')).toBe(true);
    expect(iosProfile.rows.some((r) => r.feature === 'width:<length-px>' && r.context === 'block/rtl')).toBe(true);
    expect(iosProfile.rows.some((r) => r.feature === 'margin-right:<length-mm>' && r.context === 'block/ltr')).toBe(false);
  });

  it('no row of one direction is proven by a case that laid it out in the other: every proving case has an element of the facet direction in its Chrome capture', () => {
    const cases = new Map(allCases().map((c) => [c.id, c]));
    for (const profile of [iosProfile, webProfile]) {
      for (const row of layoutRows(profile.rows)) {
        // Every direction facet of the context, the containing block's (cb-<dir>) included.
        const facets = row.context.split('/').map((p) => p.replace(/^cb-/, '')).filter((p) => p === 'ltr' || p === 'rtl');
        expect(facets.length, row.context).toBeGreaterThan(0);
        for (const proof of row.proofs) {
          for (const id of proof.cases) {
            const capture = captures.get(id);
            if (capture === undefined) throw new Error(`no capture for ${id}`);
            for (const direction of facets) expect(capture.nodes.some((n) => n.computed !== null && n.computed['direction'] === direction), `${row.feature}@${row.context} proven by ${id}`).toBe(true);
            expect(cases.get(id)?.features[profile.target as 'ios' | 'web'].includes(`${row.feature}@${row.context}`), id).toBe(true);
          }
        }
      }
    }
  });

  it('an ltr-only proof does not make the rtl row exact: a feature proven only left-to-right blocks with DRAGON_UNPROVEN_CONTEXT in the rtl environment', () => {
    const spec = specFor('block-min-max');
    const ltr = compileFixture(spec, NO_FAULTS, 'enforce', 'ltr').compiled;
    const rtl = compileFixture(spec, NO_FAULTS, 'enforce', 'rtl').compiled;
    expect(ltr.diagnostics).toEqual([]);
    expect(rtl.outputs.ios.kind).toBe('blocked');
    const unproven = rtl.diagnostics.filter((d) => d.code === 'DRAGON_UNPROVEN_CONTEXT');
    expect(unproven.length).toBeGreaterThan(0);
    for (const d of unproven) expect(d.profile?.context, d.message).toMatch(/\/rtl$/);
    for (const d of unproven) expect(d.message).toMatch(/proven: [^)]*\/ltr/);
  });

  it('every text row context is proven by a passing case where a text node in that context wraps to 2 or more lines', () => {
    const cases = allCases();
    for (const [target, profile] of [['ios', iosProfile], ['web', webProfile]] as const) {
      const contexts = [...new Set(profile.rows.filter((r) => r.context.startsWith('text-')).map((r) => r.context))];
      expect(contexts.length).toBeGreaterThan(0);
      for (const context of contexts) {
        const proofCases = new Set(profile.rows.filter((r) => r.context === context).flatMap((r) => r.proofs.flatMap((p) => p.cases)));
        const wrapped = cases.filter((c) => proofCases.has(c.id) && c.status === 'pass' && c.textLines.some((t) => t.context === context && t.lines >= 2));
        expect(wrapped.length, `${target} ${context}: a proving case with a text node on 2 or more lines`).toBeGreaterThan(0);
      }
    }
  });

  it('every Chrome deviation and platform rule branch (MF5) has a node, and every node and control passed and matches Chrome exactly at 1/64 px in every case of this run; each entry cites Blink at 145.0.7632.6 or says it is measured', () => {
    const exactIn = (fixture: string, node: string): boolean[] => (outcomes.get(fixture)?.cases ?? []).flatMap((c) => c.comparison?.nodes ?? []).filter((x) => x.id === node).map((x) => x.exactLu);
    for (const d of [...chromeDeviations, ...platformRules]) {
      expect(d.branches.length, d.id).toBeGreaterThan(0);
      for (const b of d.branches) expect(d.nodes.filter((n) => n.branch === b.id).length, `${d.id} branch ${b.id}`).toBeGreaterThan(0);
      for (const n of d.nodes) {
        expect(d.branches.map((b) => b.id), `${d.id} ${n.node}`).toContain(n.branch);
        expect(outcomes.get(n.fixture)?.status, `${d.id} -> ${n.fixture}`).toBe('pass');
        const exact = exactIn(n.fixture, n.node);
        expect(exact.length, `${d.id} ${n.node} is compared`).toBeGreaterThan(0);
        expect(exact.every((x) => x), `${d.id} ${n.branch} -> ${n.node} matches Chrome at 1/64 px`).toBe(true);
      }
    }
    for (const d of chromeDeviations) {
      for (const c of d.controls) expect(exactIn(c.fixture, c.node).every((x) => x) && exactIn(c.fixture, c.node).length > 0, `${d.id} control ${c.node}`).toBe(true);
      expect(d.blink, d.id).toMatch(/^(third_party\/blink\/\S+\.(cc|h)\b.*\blines? \d+.*145\.0\.7632\.6|.*145\.0\.7632\.6.*\blines? \d+|measured; source not located)/);
    }
    for (const r of platformRules) expect(r.source, r.id).toMatch(/third_party\/blink\/\S+\.(cc|h)\b.*145\.0\.7632\.6|measured; source not located/);
    const branchOf = (id: string, node: string) => chromeDeviations.find((d) => d.id === id)?.nodes.find((n) => n.node === node)?.branch;
    // T038 M2: the spec reading of min-max-end-margin showed p4, p6 and p7 do not distinguish Blink from it; they are controls now.
    expect(['p9', 'x6'].map((p) => branchOf('min-max-end-margin', p))).toEqual(['dropped', 'dropped']);
    expect(['p5', 'x5'].map((p) => branchOf('min-max-end-margin', p))).toEqual(['collapsed-through', 'collapsed-through']);
    expect(chromeDeviations.find((d) => d.id === 'min-max-end-margin')?.controls.map((c) => c.node)).toEqual(['p4', 'p6', 'p7']);
    // T040: auto-margin-overflow-cross-start is retired; its 9 former nodes are ordinary compared nodes, exact in every case.
    expect(chromeDeviations.find((d) => d.id === 'auto-margin-overflow-cross-start')).toBeUndefined();
    const formerAutoMargin: [string, string][] = [
      ...['am-a', 'am-b', 'am-c', 'amc-a', 'amc-b', 'amc-c'].map((n): [string, string] => ['flex-wrap-reverse', n]),
      ...['amr-a', 'amr-b', 'amr-c'].map((n): [string, string] => ['flex-auto-margins-reverse-overflow', n]),
    ];
    for (const [fixture, node] of formerAutoMargin) {
      expect(outcomes.get(fixture)?.status, fixture).toBe('pass');
      const exact = exactIn(fixture, node);
      expect(exact.length, `${fixture} ${node} is compared`).toBeGreaterThan(0);
      expect(exact.every((x) => x), `${fixture} ${node} matches Chrome at 1/64 px`).toBe(true);
    }
    // T039 M1: wrap-reverse-baseline-line covers rows and both column directions.
    expect(chromeDeviations.find((d) => d.id === 'wrap-reverse-baseline-line')?.branches.map((b) => b.id)).toEqual(['shared-baseline', 'startmost-item', 'column-wrap-reverse', 'column-wrap-reverse-rtl']);
    // M1: the two macOS font rules are platform rules keyed to the capture platform, each with its planted fault.
    expect(platformRules.map((r) => [r.id, r.platform, r.fault, r.branches.map((b) => b.id)])).toEqual([
      ['ahem-metric-half-down', 'darwin-arm64', 'metricHalfUp', ['half-down']],
      ['font-size-truncation', 'darwin-arm64', 'untruncatedFontSize', ['size-truncation']],
    ]);
  });

  for (const d of chromeDeviations) {
    it(`Chrome deviation ${d.id} (M2): distinguished; the spec-reading fault ${d.fault} makes every registered node non-exact at 1/64 px in every case and fails the gate where the gap is over 1 px; controls keep their place in their frame; with the fault off every node is exact`, async () => {
      expect(d.finding.kind, `${d.id} is distinguished`).toBe('distinguished');
      let overGate = 0;
      for (const fixture of [...new Set([...d.nodes.map((n) => n.fixture), ...d.controls.map((c) => c.fixture)])]) {
        const faulty = await runFixture(specFor(fixture), browser, { authored: recorded, faults: NO_FAULTS, engineFaults: { ...NO_ENGINE_FAULTS, [d.fault]: true }, profiles: 'enforce' });
        const main = outcomes.get(fixture)?.cases ?? [];
        const mainNodes = main.flatMap((c) => c.comparison?.nodes ?? []);
        for (const n of d.nodes.filter((x) => x.fixture === fixture)) {
          const hits = faulty.cases.flatMap((c) => c.comparison?.nodes ?? []).filter((x) => x.id === n.node);
          expect(hits.length, `${d.fault} -> ${n.node} is compared`).toBeGreaterThan(0);
          for (const h of hits) {
            expect(h.exactLu, `${d.fault} -> ${n.node} is not exact`).toBe(false);
            const gap = h.delta === null ? Infinity : Math.max(Math.abs(h.delta.left), Math.abs(h.delta.top), Math.abs(h.delta.right), Math.abs(h.delta.bottom));
            if (gap > GATE_DEVICE_PX) {
              overGate++;
              expect(h.pass, `${d.fault} -> ${n.node} fails the gate at ${gap} px`).toBe(false);
            }
          }
          for (const m of mainNodes.filter((x) => x.id === n.node)) expect(m.exactLu, `${n.node} with the fault off`).toBe(true);
        }
        // A control keeps its rect relative to its frame under the spec reading: the two readings agree on it.
        for (const c of d.controls.filter((x) => x.fixture === fixture)) {
          faulty.cases.forEach((fc, i) => {
            const rel = (nodes: readonly { id: string; dragon: { left: number; top: number; right: number; bottom: number } | null }[]) => {
              const a = nodes.find((x) => x.id === c.node)?.dragon;
              const f = nodes.find((x) => x.id === c.relativeTo)?.dragon;
              if (a === undefined || f === undefined || a === null || f === null) throw new Error(`${c.node} or ${c.relativeTo} missing`);
              return [a.left - f.left, a.top - f.top, a.right - f.left, a.bottom - f.top];
            };
            expect(rel(fc.comparison?.nodes ?? []), `control ${c.node} in ${c.relativeTo}`).toEqual(rel(main[i]?.comparison?.nodes ?? []));
          });
        }
      }
      // The half-leading spec reading is a half px, inside the gate; the other distinguished entries move nodes by whole px beyond it.
      if (d.id !== 'half-leading-floor') expect(overGate, d.id).toBeGreaterThan(0);
      if (d.id === 'half-leading-floor') expect(overGate).toBe(0);
    });
  }
  it('T040 (M2): every registered Chrome deviation is distinguished; the contradicted auto-margin-overflow-cross-start is retired', () => {
    expect(chromeDeviations.map((d) => [d.id, d.finding.kind])).toEqual([['half-leading-floor', 'distinguished'], ['min-max-end-margin', 'distinguished'], ['wrap-reverse-baseline-line', 'distinguished']]);
    expect(chromeDeviations.map((d) => d.fault)).toEqual(['halfLeadingSpec', 'minMaxEndMarginSpec', 'wrapReverseBaselineSpec']);
    expect(Object.keys(NO_ENGINE_FAULTS)).not.toContain('autoMarginOverflowSpec');
  });

  it('case counts (MF1, per environment): each tree fixture declares by hand its free states, case count and initial assignment; renderer and Dragon agree in both directions', () => {
    const trees = FIXTURES.filter((f) => f.format === 'tree' && f.kind === 'layout');
    expect(trees.length).toBeGreaterThanOrEqual(15);
    let existing = 0;
    for (const spec of trees) {
      const declared = readTreeExpectation(spec.id);
      if (declared === null) throw new Error(`${spec.id} declares no expectations`);
      const o = outcomes.get(spec.id) as FixtureOutcome;
      expect(o.environments.map((e) => e.direction), spec.id).toEqual(['ltr', 'rtl']);
      for (const e of o.environments) expect([e.expected, e.renderer, e.dragon], `${spec.id} ${e.direction}`).toEqual([declared.cases, declared.cases, declared.cases]);
      expect([o.expectedCases, o.rendererCases, o.dragonCases, o.cases.length], spec.id).toEqual([2 * declared.cases, 2 * declared.cases, 2 * declared.cases, 2 * declared.cases]);
      if (spec.id !== 'tree-whitespace-leaves' && spec.id !== 'tree-position-toggle') existing += o.cases.length;
      for (const direction of ['ltr', 'rtl'] as const) {
        const initial = o.cases.filter((c) => c.isInitial && c.direction === direction);
        expect(initial.length, `${spec.id} ${direction}`).toBe(1);
        expect((initial[0] as CaseOutcome).assignment.map((e) => ({ instance: e.state.instance, state: e.state.state, value: e.value })), spec.id).toEqual(declared.initial);
        expect(caseCountProblems(declared, fixtureInput(spec), compileFixture(spec, NO_FAULTS, 'enforce', direction).compiled), `${spec.id} ${direction}`).toEqual([]);
      }
      const { input, compiled } = compileFixture(spec);
      // A declaration that disagrees in any of the three parts is caught against both the renderer and Dragon.
      const wrongCount = caseCountProblems({ ...declared, cases: declared.cases + 1 }, input, compiled);
      expect(wrongCount.some((p) => p.includes('renderer')) && wrongCount.some((p) => p.includes('Dragon')), spec.id).toBe(true);
      if (declared.freeStates.length > 0) {
        const first = declared.freeStates[0] as (typeof declared.freeStates)[number];
        const flipped = { ...declared, initial: declared.initial.map((e, i) => (i === 0 ? { ...e, value: first.domain.find((v) => v !== e.value) as typeof e.value } : e)) };
        const wrongInitial = caseCountProblems(flipped, input, compiled);
        expect(wrongInitial.some((p) => p.includes("renderer's initial")) && wrongInitial.some((p) => p.includes("Dragon's initial")), spec.id).toBe(true);
        const wrongDomain = caseCountProblems({ ...declared, freeStates: [{ ...first, domain: [...first.domain].reverse() }, ...declared.freeStates.slice(1)] }, input, compiled);
        expect(wrongDomain.some((p) => p.includes('renderer free states')) && wrongDomain.some((p) => p.includes("Dragon's free states")), spec.id).toBe(true);
      }
    }
    // The 13 tree fixtures of S3b had 57 cases; each also runs right-to-left.
    expect(existing).toBeGreaterThanOrEqual(2 * 57);
  });

  it('rtl coverage (docs/api.md §7): every tree fixture has exactly one ltr and one rtl case per declared assignment, each with its own capture and root direction; nothing is deduplicated', () => {
    for (const spec of FIXTURES.filter((f) => f.format === 'tree' && f.kind === 'layout')) {
      const declared = readTreeExpectation(spec.id) as NonNullable<ReturnType<typeof readTreeExpectation>>;
      const o = outcomes.get(spec.id) as FixtureOutcome;
      const byAssignment = new Map<string, CaseOutcome[]>();
      for (const c of o.cases) byAssignment.set(describeAssignment(c.assignment), [...(byAssignment.get(describeAssignment(c.assignment)) ?? []), c]);
      expect(byAssignment.size, spec.id).toBe(declared.cases);
      for (const [key, pair] of byAssignment) {
        expect(pair.map((c) => c.direction).sort(), `${spec.id} ${key}`).toEqual(['ltr', 'rtl']);
        const [ltr, rtl] = [pair.find((c) => c.direction === 'ltr') as CaseOutcome, pair.find((c) => c.direction === 'rtl') as CaseOutcome];
        expect(rtl.id, spec.id).toBe(`${ltr.id}-rtl`);
        for (const c of pair) {
          expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
          const committed = JSON.parse(readFileSync(expectedPath(c.id), 'utf8')) as WebCapture;
          expect(committed.direction, c.id).toBe(c.direction);
          expect(committed.nodes.find((n) => n.id === 'html')?.computed?.['direction'], c.id).toBe(c.direction);
        }
      }
    }
    // The harness gives the environment direction and root font to both renderings identically; ltr adds no direction rule.
    expect(harnessStyle(RTL_ENVIRONMENT)).toBe(`${harnessStyle(ENVIRONMENT)}:where(html){direction:rtl}`);
    expect(harnessStyle(ENVIRONMENT)).not.toMatch(/direction/);
    expect(harnessStyle(ENVIRONMENT)).toMatch(/:where\(html\)\{font-family:Ahem\}$/);
    expect(harnessStyle({ ...ENVIRONMENT, rootFont: 'ua-default' })).not.toMatch(/font-family:Ahem\}/);
  });

  it('text topology (docs/api.md §10): every tree case equals the declared mapping; projected text keeps its owner and inherits from its insertion parent', () => {
    for (const spec of FIXTURES.filter((f) => f.format === 'tree' && f.kind === 'layout')) {
      const declared = readTreeExpectation(spec.id);
      if (declared === null) throw new Error(spec.id);
      const o = outcomes.get(spec.id) as FixtureOutcome;
      expect(topologyProblems(declared, fixtureInput(spec), o.cases), spec.id).toEqual([]);
    }
    const projected = outcomes.get('tree-projected-text') as FixtureOutcome;
    expect(projected.cases.length).toBe(8);
    for (const c of projected.cases) {
      const title = c.topology?.find((t) => t.address === 'card/head:text0');
      expect(title, c.id).toMatchObject({ component: 'App', template: 'title-text', ownerInstance: 'doc', insertionParent: 'card/head', context: `text-in-block/${c.direction}` });
      for (const origin of Object.values(title?.inherited ?? {})) expect(origin, c.id).toMatchObject({ kind: 'inherited', element: 'card/head' });
      expect(c.topology?.find((t) => t.address === 'card/head:text1'), c.id).toMatchObject({ component: 'Card', ownerInstance: 'doc/card', insertionParent: 'card/head' });
    }
    // The insertion parent's state changes the projected text's size: small vs large puts it on 2 vs 3 lines.
    expect(projected.cases.map((c) => c.textLines.find((t) => t.address === 'card/head:text0')?.lines)).toEqual([2, 2, 3, 3, 2, 2, 3, 3]);
    const tampered = { ...(readTreeExpectation('tree-projected-text') as NonNullable<ReturnType<typeof readTreeExpectation>>) };
    const wrongOwner = { ...tampered, textTopology: tampered.textTopology.map((t) => (t.address === 'card/head:text0' ? { ...t, component: 'Card' } : t)) };
    expect(topologyProblems(wrongOwner, fixtureInput(specFor('tree-projected-text')), projected.cases).length).toBe(8);
    // The declared context of each direction is checked: swapping them fails every case.
    const swapped = { ...tampered, textTopology: tampered.textTopology.map((t) => ({ ...t, context: { ltr: t.context.rtl, rtl: t.context.ltr } })) };
    expect(topologyProblems(swapped, fixtureInput(specFor('tree-projected-text')), projected.cases).length).toBe(8);
  });

  it('distribution (M4): flex-distribution-grid passes, and the S1 truncation model mismatches committed nodes in every mode', () => {
    const grid = outcomes.get('flex-distribution-grid');
    expect(grid?.status).toBe('pass');
    expect(grid?.cases[0]?.comparison?.nodes.every((n) => n.exactLu)).toBe(true);
    const capture = JSON.parse(readFileSync(expectedPath('flex-distribution-grid'), 'utf8')) as WebCapture;
    const lu = (v: number): number => Math.round(v * 64);
    const byId = new Map(capture.nodes.map((n) => [n.id, n]));
    // The truncation model: item k at a truncated cumulative share of the free space. S1 (notes/T023-slice-1.md) used it for
    // space-around and space-evenly; S1 rounded space-between, so for space-between this checks the truncating variant.
    const s1 = (mode: string, free: number, n: number, k: number): number => {
      if (mode === 'between') return Math.trunc((free * k) / (n - 1));
      if (mode === 'around') return Math.trunc((free * (2 * k + 1)) / (2 * n));
      return Math.trunc((free * (k + 1)) / (n + 1));
    };
    for (const mode of ['between', 'around', 'evenly'] as const) {
      let mismatches = 0;
      let compared = 0;
      for (const axis of ['j', 'a'] as const) {
        for (const n of [2, 3, 5, 7]) {
          const box = byId.get(`${axis}-${mode}-${n}`);
          if (box === undefined) throw new Error(`${axis}-${mode}-${n} missing`);
          const itemSize = axis === 'j' ? 640 : 192;
          const free = (axis === 'j' ? lu(box.width) : lu(box.height)) - n * itemSize;
          expect(free % 2, `${axis}-${mode}-${n} has odd free space`).toBe(1);
          for (let k = 0; k < n; k++) {
            const item = byId.get(`${axis}-${mode}-${n}-${k}`);
            if (item === undefined) throw new Error('item missing');
            const offset = (axis === 'j' ? lu(item.x) - lu(box.x) : lu(item.y) - lu(box.y)) - k * itemSize;
            compared++;
            if (s1(mode, free, n, k) !== offset) mismatches++;
          }
        }
      }
      expect(compared).toBe(34);
      expect(mismatches, `S1 model against Chrome, ${mode}`).toBeGreaterThan(0);
    }
  });

  // determinism (S5 (c)) runs in parity-determinism-<k>.test.ts (determinism.ts), one chunk of FIXTURES per file, so its Chrome
  // work spreads over workers and shards; each chunk proves it checked its own fixtures, and this proves the chunks cover them all.
  describe('determinism (S5 (c))', () => {
    it('coverage: the chunk files together check every fixture exactly once, and the shuffle reorders the tree fixtures', () => {
      const files = readdirSync(repoPath('packages/parity/test')).filter((f) => /^parity-determinism-.*\.test\.ts$/.test(f)).sort();
      expect(files).toEqual(Array.from({ length: DETERMINISM_CHUNKS }, (_, i) => `parity-determinism-${i + 1}.test.ts`).sort());
      for (let k = 1; k <= DETERMINISM_CHUNKS; k++) {
        const text = readFileSync(repoPath(`packages/parity/test/parity-determinism-${k}.test.ts`), 'utf8');
        expect(text.match(/determinismSuite\(\d+\)/g), `parity-determinism-${k}.test.ts declares chunk ${k} once`).toEqual([`determinismSuite(${k})`]);
      }
      const ids = Array.from({ length: DETERMINISM_CHUNKS }, (_, i) => determinismChunk(i + 1).map((f) => f.id)).flat();
      expect(ids.slice().sort()).toEqual(FIXTURES.map((f) => f.id).sort());
      expect(() => determinismChunk(0)).toThrow();
      expect(() => determinismChunk(DETERMINISM_CHUNKS + 1)).toThrow();
      const permuted = FIXTURES.filter((spec) => JSON.stringify(shuffled(fixtureInput(spec))) !== JSON.stringify(fixtureInput(spec))).length;
      expect(permuted, 'tree fixtures have several sources, modules, components and style uses to reorder').toBeGreaterThanOrEqual(10);
    });
  });

  it('determinism negative: swapping two ordered stylesheet uses with conflicting rules changes the digest and the emitted CSS', () => {
    const spec = specFor('tree-ordered-sheets');
    const swap = (input: FrontEndResult): FrontEndResult => {
      if (input.tree === null) throw new Error('no tree');
      const doc = input.tree.documents[0] as NonNullable<FrontEndResult['tree']>['documents'][number];
      expect(doc.styles.length).toBeGreaterThanOrEqual(2);
      return { ...input, tree: { ...input.tree, documents: [{ ...doc, styles: [...doc.styles].reverse() }] } };
    };
    const a = compileFixture(spec).compiled;
    const b = compileFixture(spec, NO_FAULTS, 'enforce', 'ltr', swap).compiled;
    expect(b.digest).not.toBe(a.digest);
    const css = (c: typeof a): string => (c.outputs.web.kind === 'ready' ? (c.outputs.web.files[0] as { text: string }).text.split('\n').slice(1).join('\n') : 'blocked');
    expect(css(b)).not.toBe(css(a));
  });

  it('writes the report and summary.md: at least 114 layout fixtures, at least 110 hand-written; failed 0; unsupportedCodes []; every case in both environments passes both lanes; platform darwin-arm64; the Linux lane unavailable (not run); every exact row linked to passing cases', () => {
    const ordered = FIXTURES.map((f) => outcomes.get(f.id)).filter((o): o is FixtureOutcome => o !== undefined);
    expect(ordered.length).toBe(FIXTURES.length);
    const report = buildReport(ordered, fontCasesRun());
    expect(report.summary.webOnly).toEqual({ cases: fontCasesRun().length, passed: fontCasesRun().length, failed: [] });
    expect(report.summary.webOnly.cases).toBeGreaterThan(0);
    writeReport(report);
    expect(report.summary.fixtures).toBeGreaterThanOrEqual(137);
    expect(report.summary.layoutFixtures).toBeGreaterThanOrEqual(114);
    expect(report.summary.handWrittenLayoutFixtures).toBeGreaterThanOrEqual(110);
    expect(report.summary.handWrittenLayoutFixtures + report.summary.generatedLayoutFixtures).toBe(report.summary.layoutFixtures);
    const layoutSpecs = FIXTURES.filter((f) => f.kind === 'layout');
    const positioning = layoutSpecs.filter((f) => f.source === 'hand-written' && f.format === 'html' && /^(position|flex-abspos)-/.test(f.id));
    expect(positioning.length).toBeGreaterThanOrEqual(20);
    expect(report.summary.generatedFixtures).toEqual(layoutSpecs.filter((f) => f.source === 'generated').map((f) => f.id));
    for (const id of report.summary.generatedFixtures) expect(report.fixtures.find((f) => f.id === id)?.status, id).toBe('pass');
    expect(report.summary.lineNodes).toBeGreaterThan(0);
    expect(report.summary.lineNodesExact).toBe(report.summary.lineNodes);
    expect(report.summary.anonymousBoxes.length).toBeGreaterThan(0);
    for (const a of report.summary.anonymousBoxes) expect(a.lines.length, a.id).toBeGreaterThan(0);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.unsupportedCodes).toEqual([]);
    expect(report.summary.casesPassed).toBe(report.summary.cases);
    for (const o of ordered) for (const c of o.cases) expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
    for (const cc of report.summary.caseCounts) {
      expect(cc.cases.filter((id) => !isForcedCaseId(id)).length, cc.fixture).toBe(cc.expected);
      expect(cc.renderer, cc.fixture).toBe(cc.expected);
      expect(cc.dragon, cc.fixture).toBe(cc.expected);
      for (const e of cc.environments) expect([e.renderer, e.dragon], `${cc.fixture} ${e.direction}`).toEqual([e.expected, e.expected]);
    }
    expect(report.summary.caseCounts.find((c) => c.fixture === 'tree-switch-two-instances')?.cases.length).toBe(32);
    const byDirection = Object.fromEntries(report.summary.casesByDirection.map((d) => [d.direction, d]));
    expect(byDirection['rtl']?.cases).toBe(report.summary.caseCounts.filter((c) => c.environments.some((e) => e.direction === 'rtl')).reduce((n, c) => n + c.cases.length / 2, 0));
    for (const d of report.summary.casesByDirection) expect(d.passed, d.direction).toBe(d.cases);
    for (const f of report.fixtures) for (const c of f.cases) expect(['ltr', 'rtl'], c.id).toContain(c.direction);
    expect(report.summary.treeFixtures).toBeGreaterThanOrEqual(9);
    // (a) run metadata, the unavailable Linux lane and the scope wording.
    expect(report.run.platform).toBe('darwin-arm64');
    expect(report.run.referencePlatform).toBe('darwin-arm64');
    expect(report.run.browser).toBe('chromium-headless-shell');
    expect(report.run.flags).toContain('--force-device-scale-factor=1');
    expect(report.run.unavailableLanes).toEqual([{ lane: 'linux-chrome', platform: 'linux-x64', status: 'unavailable (not run)', workflow: '.github/workflows/parity.yml (workflow_dispatch only, not pushed)' }]);
    expect(report.run.rootFont).toEqual({ default: 'ahem', uaDefault: ['block-ua-divs'] });
    // Every exact profile row links to at least one passing case id that exists in the report, and every case links back.
    const reportCases = new Set([...report.fixtures.flatMap((f) => f.cases.filter((c) => c.status === 'pass').map((c) => c.id)), ...report.webOnlyCases.filter((c) => c.status === 'pass').map((c) => c.case)]);
    const exact = layoutRows(report.profileRows).filter((r) => r.status === 'exact');
    expect(exact.length).toBeGreaterThan(1000);
    for (const r of layoutRows(report.profileRows)) {
      expect(r.casesPassingInReport, `${r.target} ${r.feature}@${r.context}`).toBe(true);
      for (const pr of r.proofs) {
        expect(pr.cases.length).toBeGreaterThan(0);
        for (const id of pr.cases) expect(reportCases.has(id), id).toBe(true);
      }
    }
    for (const cr of report.caseRows) for (const key of [...cr.ios, ...cr.web]) expect(report.profileRows.some((r) => `${r.feature}@${r.context}` === key && r.proofs.some((x) => x.cases.includes(cr.case))), `${cr.case} ${key}`).toBe(true);
    expect(report.caseRows.length).toBe(report.summary.cases);
    for (const cr of report.webOnlyCases) expect(cr.web.length, cr.case).toBeGreaterThan(0);
    // Deviations and platform rules with branch, node and exactness in the report.
    for (const d of [...report.deviations, ...report.platformRules]) for (const n of d.nodes) expect(n.results.length > 0 && n.results.every((x) => x.exactLu), `${d.id} ${n.node}`).toBe(true);
    // summary.md: the scope wording, the unavailable Linux lane and the counts the audit checks.
    const summary = readFileSync(repoPath('packages/parity/out/summary.md'), 'utf8');
    expect(summary).toBe(renderSummary(report));
    expect(summary).toContain('Linux lane (linux-x64): unavailable (not run).');
    expect(summary).toContain('They do not claim a Linux run.');
    expect(summary).toContain(`| Layout fixtures | ${report.summary.layoutFixtures} |`);
    expect(summary).toContain(`| Hand-written layout fixtures | ${report.summary.handWrittenLayoutFixtures} |`);
    expect(summary).toContain('| Failed | 0 |');
    expect(summary).toContain('| unsupportedCodes | [] |');
    expect(summary).toContain('evidence, not a gate');
  });
});

describe('renderer isolation', () => {
  it('the authored renderer imports nothing from Dragon analysis, emit or lower, and only types from dragon', () => {
    for (const file of ['render.ts', 'cases.ts', 'tree-fixture.ts', 'fixture-reader.ts']) {
      const text = readFileSync(repoPath(`packages/parity/src/${file}`), 'utf8');
      expect(text, file).not.toMatch(/dragon\/src\/(analysis|emit|lower)|from '\.\.\/\.\.\/dragon/);
    }
    const render = readFileSync(repoPath('packages/parity/src/render.ts'), 'utf8');
    const imports = [...render.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[0]);
    expect(imports).toEqual([
      "import { parse } from 'css-tree';",
      "import type { CssNode } from 'css-tree';",
      "import type { Assignment, ComponentDefinition, Condition, FrontEndResult, Scalar, SourceFile, TreeNode } from 'dragon';",
    ]);
  });

  it('direction and the root font reach Chrome only through the harness environment injection, applied identically to both renderings', () => {
    // The renderers and fixture readers never write a direction or a dir attribute into the markup.
    for (const file of ['render.ts', 'cases.ts', 'tree-fixture.ts', 'fixture-reader.ts', 'dual.ts', 'capture.ts']) {
      const text = readFileSync(repoPath(`packages/parity/src/${file}`), 'utf8');
      expect(text, file).not.toMatch(/\bdir=|direction:\s*rtl|:where\(html\)|font-family:\s*Ahem/);
    }
    // One place injects the harness style, and both the authored and the compiled rendering are captured through it in the case environment.
    const src = readdirSync(repoPath('packages/parity/src')).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(repoPath(`packages/parity/src/${f}`), 'utf8')] as const);
    expect(src.filter(([, t]) => t.includes('data-dragon-harness')).map(([f]) => f)).toEqual(['chrome.ts']);
    const pipeline = readFileSync(repoPath('packages/parity/src/pipeline.ts'), 'utf8');
    // A SELD-R2a forced case passes the same prepare hook (CSS.forcePseudoState) to both renderings.
    expect(pipeline).toMatch(/captureFixture\(browser, c\.id, c\.compiledHtml\(webCss, classOf\), c\.environment, c\.computedExtra, prepareOf\(c\)\)/);
    expect(pipeline).toMatch(/captureFixture\(browser, c\.id, c\.authoredHtml, c\.environment, c\.computedExtra, prepareOf\(c\)\)/);
  });
});
