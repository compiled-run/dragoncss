import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromeDeviations, NO_ENGINE_FAULTS } from '@dragon/layout';
import type { Assignment, ProfileRow } from 'dragon';
import { CATALOGUE, iosProfile, NO_FAULTS, PROPERTY_ASPECTS, webProfile } from 'dragon';
import type { Longhand } from 'dragon';
import type { WebCapture } from '../src/capture.ts';
import { captureFixture, captureJson } from '../src/capture.ts';
import type { ParityCase } from '../src/cases.ts';
import { CHROME_VERSION, harnessStyle, launchChrome } from '../src/chrome.ts';
import { emittedPath, expectedPath } from '../src/committed.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';
import { ENVIRONMENT, FIXTURES, RTL_ENVIRONMENT } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';
import type { CaseOutcome, FixtureOutcome } from '../src/pipeline.ts';
import { caseCountProblems, runFixture, topologyProblems } from '../src/pipeline.ts';
import { fixtureInput } from '../src/cases.ts';
import { compileFixture } from '../src/pipeline.ts';
import { readTreeExpectation } from '../src/tree-fixture.ts';
import { deriveRows } from '../src/profile-rows.ts';
import { buildReport, writeReport } from '../src/report.ts';

let browser: Browser;
const outcomes = new Map<string, FixtureOutcome>();
const captures = new Map<string, WebCapture>();

beforeAll(async () => {
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

const allCases = (): CaseOutcome[] => FIXTURES.flatMap((f) => (outcomes.get(f.id)?.cases ?? []));
const recorded = async (c: ParityCase): Promise<WebCapture> => {
  const hit = captures.get(c.id);
  if (hit === undefined) throw new Error(`no live capture for ${c.id}`);
  return hit;
};
const describeAssignment = (a: Assignment): string => a.map((e) => `${e.state.instance}.${e.state.state}=${JSON.stringify(e.value)}`).join(',');

describe.sequential('S4a parity: Chrome 145 vs Dragon, every case of every fixture in every environment (layout lane at 1 device px, dual lane exact)', () => {
  it('the gate is owner decision 13: one device pixel, never per fixture', () => {
    expect(GATE_DEVICE_PX).toBe(1);
    for (const f of FIXTURES) if (f.kind === 'layout') expect(f.gate).toBe('default');
  });

  it('fixture registry (M7): every packages/parity/fixtures entry is registered, and every registered fixture has its file', () => {
    const dir = repoPath('packages/parity/fixtures');
    const entries = readdirSync(dir).sort();
    const registered = new Set(FIXTURES.map((f) => (f.format === 'html' ? `${f.id}.html` : f.id)));
    for (const e of entries) expect(registered.has(e), `${e} is not in FIXTURES`).toBe(true);
    for (const f of FIXTURES) {
      if (f.format === 'html') expect(statSync(`${dir}/${f.id}.html`).isFile(), f.id).toBe(true);
      else expect(statSync(`${dir}/${f.id}/fixture.json`).isFile(), f.id).toBe(true);
    }
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
    // The rtl case and emitted-file suffix cannot collide with a fixture id.
    for (const f of FIXTURES) expect(f.id.endsWith('-rtl'), f.id).toBe(false);
  });

  for (const spec of FIXTURES) {
    it(`${spec.id} (${spec.format} ${spec.kind})`, async () => {
      const live = async (c: ParityCase): Promise<WebCapture> => {
        const capture = await captureFixture(browser, c.id, c.authoredHtml, c.environment);
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
        expect(outcome.cases.length).toBe(outcome.expectedCases);
        expect(outcome.dragonCases).toBe(outcome.expectedCases);
        for (const e of outcome.environments) expect([e.renderer, e.dragon], `${spec.id} ${e.direction}`).toEqual([e.expected, e.expected]);
        for (const c of outcome.cases) {
          expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
          expect(c.unsupported, c.id).toBeNull();
        }
        expect(outcome.webCss.ltr, 'emitted web CSS must equal the committed file').toBe(readFileSync(emittedPath(spec.id, 'ltr'), 'utf8'));
        if (spec.format === 'tree') expect(outcome.webCss.rtl, 'emitted rtl web CSS must equal the committed file').toBe(readFileSync(emittedPath(spec.id, 'rtl'), 'utf8'));
        else expect(existsSync(emittedPath(spec.id, 'rtl'))).toBe(false);
      } else {
        expect(outcome.cases).toEqual([]);
        expect(existsSync(emittedPath(spec.id, 'ltr'))).toBe(false);
        expect(existsSync(emittedPath(spec.id, 'rtl'))).toBe(false);
        expect(readdirSync(repoPath('packages/parity/expected')).filter((f) => f.startsWith(`${spec.id}.`) || f.startsWith(`${spec.id}#`))).toEqual([]);
      }
    });
  }

  it('committed captures are exactly the cases of this run', () => {
    const files = readdirSync(repoPath('packages/parity/expected')).filter((f) => f.endsWith('.web.json')).sort();
    expect(files).toEqual(allCases().map((c) => `${c.id}.web.json`).sort());
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

  const engineFaultCases: readonly { fault: 'rtlAsLtr' | 'ignoreOrder' | 'baselineFromBorderTop' | 'scrollMinAuto'; fixture: string; nodes: readonly string[] }[] = [
    // text-align start in rtl laid out as left: every start-aligned line and the overflowing start line move.
    { fault: 'rtlAsLtr', fixture: 'rtl-text-align-multi-line', nodes: ['s:text0:line0', 'so:text0:line0', 'd:text0:line1'] },
    { fault: 'ignoreOrder', fixture: 'flex-order', nodes: ['r1b', 'r1d', 'a1a', 'r3c'] },
    { fault: 'baselineFromBorderTop', fixture: 'flex-baseline-text', nodes: ['b', 'c2b', 'c3a'] },
    { fault: 'scrollMinAuto', fixture: 'overflow-hidden-flex-min-size', nodes: ['r1a', 'r2a', 'c1a'] },
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

  it('profile proofs (M1): every row and proof names exactly the cases that passed its lane and use its key; every used key has a row', () => {
    const cases = allCases();
    for (const [target, profile] of [['ios', iosProfile], ['web', webProfile]] as const) {
      expect(profile.rows.length).toBeGreaterThan(0);
      for (const row of profile.rows) {
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
      expect(profile.rows, `${target} rows must be exactly what pnpm run profile:rows derives from this run`).toEqual(deriveRows(target, cases));
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
      expect(row.status).toBe('exact');
      for (const p of row.proofs) expect(p.lane).toBe('chrome-dual');
      expect(row.proofs.some((p) => p.aspect === 'computed-value'), row.feature).toBe(true);
    }
  });

  it('row keys carry the formatting context (M2, M3, C7): <length-px>; every context has a direction facet and flex text contexts a main-axis facet', () => {
    const directions = ['ltr', 'rtl'];
    const textContexts = directions.flatMap((d) => ['text-in-block/' + d, 'text-in-anonymous-block/' + d, 'text-in-flex-item/row/' + d, 'text-in-flex-item/column/' + d, 'text-as-anonymous-flex-item/row/' + d, 'text-as-anonymous-flex-item/column/' + d]);
    const boxContexts = /^(root|block|flex-row|flex-column|display-none|flex-row-single-line|flex-row-multi-line|flex-column-single-line|flex-column-multi-line|not-flex-container)\/(ltr|rtl)$/;
    for (const profile of [iosProfile, webProfile]) {
      for (const row of profile.rows) {
        expect(row.feature, row.feature).not.toMatch(/<length>/);
        expect(row.context, row.feature).not.toBe('single-line-text');
        if (/^(font-family|font-size|line-height|text-align|white-space-collapse|text-wrap-mode):/.test(row.feature)) expect(textContexts, `${row.feature}@${row.context}`).toContain(row.context);
        else expect(row.context, `${row.feature}@${row.context}`).toMatch(boxContexts);
      }
    }
    expect(iosProfile.rows.filter((r) => r.feature.startsWith('font-family:Ahem')).map((r) => r.context).sort()).toEqual([...textContexts].sort());
    expect(iosProfile.rows.some((r) => r.feature === 'width:<length-px>' && r.context === 'block/ltr')).toBe(true);
    expect(iosProfile.rows.some((r) => r.feature === 'width:<length-px>' && r.context === 'block/rtl')).toBe(true);
    expect(iosProfile.rows.some((r) => r.feature === 'margin-top:auto' && r.context === 'block/ltr')).toBe(false);
  });

  it('no row of one direction is proven by a case that laid it out in the other: every proving case has an element of the facet direction in its Chrome capture', () => {
    const cases = new Map(allCases().map((c) => [c.id, c]));
    for (const profile of [iosProfile, webProfile]) {
      for (const row of profile.rows) {
        const direction = row.context.slice(row.context.lastIndexOf('/') + 1);
        for (const proof of row.proofs) {
          for (const id of proof.cases) {
            const capture = captures.get(id);
            if (capture === undefined) throw new Error(`no capture for ${id}`);
            expect(capture.nodes.some((n) => n.computed !== null && n.computed['direction'] === direction), `${row.feature}@${row.context} proven by ${id}`).toBe(true);
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

  it('every Chrome deviation branch (M5) has a node, and every node passed and matches Chrome exactly at 1/64 px in this run', () => {
    for (const d of chromeDeviations) {
      expect(d.branches.length, d.id).toBeGreaterThan(0);
      for (const b of d.branches) expect(d.nodes.filter((n) => n.branch === b.id).length, `${d.id} branch ${b.id}`).toBeGreaterThan(0);
      for (const n of d.nodes) {
        expect(d.branches.map((b) => b.id), `${d.id} ${n.node}`).toContain(n.branch);
        expect(outcomes.get(n.fixture)?.status, `${d.id} -> ${n.fixture}`).toBe('pass');
        const node = outcomes.get(n.fixture)?.cases.flatMap((c) => c.comparison?.nodes ?? []).find((x) => x.id === n.node);
        expect(node?.exactLu, `${d.id} ${n.branch} -> ${n.node} matches Chrome at 1/64 px`).toBe(true);
      }
    }
    const branchOf = (id: string, node: string) => chromeDeviations.find((d) => d.id === id)?.nodes.find((n) => n.node === node)?.branch;
    expect(['p4', 'p6', 'p9'].map((p) => branchOf('min-max-end-margin', p))).toEqual(['dropped', 'dropped', 'dropped']);
    expect(['p5', 'p7'].map((p) => branchOf('min-max-end-margin', p))).toEqual(['collapsed-through', 'collapsed-through']);
  });

  it('case counts (MF1, per environment): each tree fixture declares by hand its free states, case count and initial assignment; renderer and Dragon agree in both directions', () => {
    const trees = FIXTURES.filter((f) => f.format === 'tree' && f.kind === 'layout');
    expect(trees.length).toBeGreaterThanOrEqual(14);
    let existing = 0;
    for (const spec of trees) {
      const declared = readTreeExpectation(spec.id);
      if (declared === null) throw new Error(`${spec.id} declares no expectations`);
      const o = outcomes.get(spec.id) as FixtureOutcome;
      expect(o.environments.map((e) => e.direction), spec.id).toEqual(['ltr', 'rtl']);
      for (const e of o.environments) expect([e.expected, e.renderer, e.dragon], `${spec.id} ${e.direction}`).toEqual([declared.cases, declared.cases, declared.cases]);
      expect([o.expectedCases, o.rendererCases, o.dragonCases, o.cases.length], spec.id).toEqual([2 * declared.cases, 2 * declared.cases, 2 * declared.cases, 2 * declared.cases]);
      if (spec.id !== 'tree-whitespace-leaves') existing += o.cases.length;
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
    // The harness gives the environment direction to both renderings identically, and ltr adds nothing to the page.
    expect(harnessStyle(RTL_ENVIRONMENT)).toBe(`${harnessStyle(ENVIRONMENT)}:where(html){direction:rtl}`);
    expect(harnessStyle(ENVIRONMENT)).not.toMatch(/direction/);
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

  it('writes the report: at least 75 layout fixtures, every case listed with its direction and passing, anonymous boxes and line fragments listed', () => {
    const ordered = FIXTURES.map((f) => outcomes.get(f.id)).filter((o): o is FixtureOutcome => o !== undefined);
    expect(ordered.length).toBe(FIXTURES.length);
    const report = buildReport(ordered);
    writeReport(report);
    expect(report.summary.fixtures).toBeGreaterThanOrEqual(92);
    expect(report.summary.layoutFixtures).toBeGreaterThanOrEqual(75);
    expect(report.summary.lineNodes).toBeGreaterThan(0);
    expect(report.summary.lineNodesExact).toBe(report.summary.lineNodes);
    expect(report.summary.anonymousBoxes.length).toBeGreaterThan(0);
    for (const a of report.summary.anonymousBoxes) expect(a.lines.length, a.id).toBeGreaterThan(0);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.unsupportedCodes).toEqual([]);
    expect(report.summary.casesPassed).toBe(report.summary.cases);
    for (const o of ordered) for (const c of o.cases) expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
    for (const cc of report.summary.caseCounts) {
      expect(cc.cases.length, cc.fixture).toBe(cc.expected);
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

  it('direction reaches Chrome only through the harness environment injection, applied identically to both renderings', () => {
    // The renderers and fixture readers never write a direction or a dir attribute into the markup.
    for (const file of ['render.ts', 'cases.ts', 'tree-fixture.ts', 'fixture-reader.ts', 'dual.ts', 'capture.ts']) {
      const text = readFileSync(repoPath(`packages/parity/src/${file}`), 'utf8');
      expect(text, file).not.toMatch(/\bdir=|direction:\s*rtl|:where\(html\)/);
    }
    // One place injects the harness style, and both the authored and the compiled rendering are captured through it in the case environment.
    const src = readdirSync(repoPath('packages/parity/src')).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(repoPath(`packages/parity/src/${f}`), 'utf8')] as const);
    expect(src.filter(([, t]) => t.includes('data-dragon-harness')).map(([f]) => f)).toEqual(['chrome.ts']);
    const pipeline = readFileSync(repoPath('packages/parity/src/pipeline.ts'), 'utf8');
    expect(pipeline).toMatch(/captureFixture\(browser, c\.id, c\.compiledHtml\(webCss, classOf\), c\.environment\)/);
    expect(pipeline).toMatch(/captureFixture\(browser, c\.id, c\.authoredHtml, c\.environment\)/);
  });
});
