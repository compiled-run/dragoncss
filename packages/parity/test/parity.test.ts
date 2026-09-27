import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromeDeviations } from '@dragon/layout';
import type { Assignment, ProfileRow } from 'dragon';
import { CATALOGUE, iosProfile, NO_FAULTS, PROPERTY_ASPECTS, webProfile } from 'dragon';
import type { Longhand } from 'dragon';
import type { WebCapture } from '../src/capture.ts';
import { captureFixture, captureJson } from '../src/capture.ts';
import type { ParityCase } from '../src/cases.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { expectedPath } from '../src/committed.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';
import type { CaseOutcome, FixtureOutcome } from '../src/pipeline.ts';
import { runFixture } from '../src/pipeline.ts';
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

describe.sequential('S3a parity: Chrome 145 vs Dragon, every case of every fixture (layout lane at 1 device px, dual lane exact)', () => {
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
  });

  for (const spec of FIXTURES) {
    it(`${spec.id} (${spec.format} ${spec.kind})`, async () => {
      const live = async (c: ParityCase): Promise<WebCapture> => {
        const capture = await captureFixture(browser, c.id, c.authoredHtml, ENVIRONMENT);
        captures.set(c.id, capture);
        expect(captureJson(capture), `${c.id}: the live capture must equal the committed expected file`).toBe(readFileSync(expectedPath(c.id), 'utf8'));
        return capture;
      };
      const outcome = await runFixture(spec, browser, { authored: live, faults: NO_FAULTS, profiles: 'enforce' });
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
        for (const c of outcome.cases) {
          expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
          expect(c.unsupported, c.id).toBeNull();
        }
        const emitted = readFileSync(repoPath(`packages/parity/emitted/${spec.id}.css`), 'utf8');
        expect(outcome.webCss, 'emitted web CSS must equal the committed file').toBe(emitted);
      } else {
        expect(outcome.cases).toEqual([]);
        expect(existsSync(repoPath(`packages/parity/emitted/${spec.id}.css`))).toBe(false);
        expect(readdirSync(repoPath('packages/parity/expected')).filter((f) => f.startsWith(`${spec.id}.`) || f.startsWith(`${spec.id}#`))).toEqual([]);
      }
    });
  }

  it('committed captures are exactly the cases of this run', () => {
    const files = readdirSync(repoPath('packages/parity/expected')).filter((f) => f.endsWith('.web.json')).sort();
    expect(files).toEqual(allCases().map((c) => `${c.id}.web.json`).sort());
  });

  it('planted fault: swapping content-box and border-box in the ios lowering fails the layout gate', async () => {
    const faulty = await runFixture(specFor('block-content-box-padding-border'), browser, { authored: recorded, faults: { ...NO_FAULTS, swapBoxSizing: true }, profiles: 'enforce' });
    const c = faulty.cases[0] as CaseOutcome;
    expect(faulty.status).toBe('fail');
    expect(c.lanes['linux-dragon-layout']).toBe('fail');
    expect(c.reason).toMatch(/exceeds 1 device px/);
    expect(c.comparison?.nodes.find((n) => n.id === 'box')?.pass).toBe(false);
  });

  it('planted fault: a resolver that collapses compound-class variants fails the dual check', async () => {
    const faulty = await runFixture(specFor('cascade-compound-variants'), browser, { authored: recorded, faults: { ...NO_FAULTS, variantCollapse: true }, profiles: 'enforce' });
    const c = faulty.cases[0] as CaseOutcome;
    expect(faulty.status).toBe('fail');
    expect(c.lanes['chrome-dual']).toBe('fail');
    expect((c.dual?.valuesEqual ?? 0) < (c.dual?.valuesCompared ?? 0)).toBe(true);
    expect(c.reason).toMatch(/chrome-dual: /);
  });

  it('planted fault: a colour-only resolver error fails the dual check on channels while the layout lane passes', async () => {
    const faulty = await runFixture(specFor('color-syntax'), browser, { authored: recorded, faults: { ...NO_FAULTS, colourOnly: true }, profiles: 'enforce' });
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

  it('planted fault: stateCollapse on a/trigger fails exactly the non-initial cases of instance a, and the initial cases pass', async () => {
    const faulty = await runFixture(specFor('tree-switch-two-instances'), browser, { authored: recorded, faults: { ...NO_FAULTS, stateCollapse: 'a/trigger' }, profiles: 'enforce' });
    expect(faulty.status).toBe('fail');
    expect(faulty.cases.length).toBe(16);
    const aAtInitial = (c: CaseOutcome): boolean => c.assignment.filter((e) => e.state.instance === 'doc/a').every((e) => e.value === false);
    const failing = faulty.cases.filter((c) => c.status === 'fail').map((c) => describeAssignment(c.assignment));
    const expected = faulty.cases.filter((c) => !aAtInitial(c)).map((c) => describeAssignment(c.assignment));
    expect(failing).toEqual(expected);
    expect(failing.length).toBe(12);
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
    const initial = faulty.cases.find((c) => c.isInitial);
    expect(initial?.status).toBe('pass');
  });

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
    const solid = iosProfile.rows.filter((r) => /^border-(top|right|bottom|left)-style:solid$/.test(r.feature));
    expect(solid.length).toBeGreaterThan(0);
    for (const r of solid) expect(r.status).toBe('caveat');
    for (const row of webProfile.rows) {
      expect(row.status).toBe('exact');
      for (const p of row.proofs) expect(p.lane).toBe('chrome-dual');
      expect(row.proofs.some((p) => p.aspect === 'computed-value'), row.feature).toBe(true);
    }
  });

  it('row keys carry the formatting context (M2, M3, M9): <length-px>, and iOS text rows are single-line-text', () => {
    for (const profile of [iosProfile, webProfile]) {
      for (const row of profile.rows) {
        expect(row.feature, row.feature).not.toMatch(/<length>/);
        if (/^(font-family|font-size|line-height|text-align):/.test(row.feature)) expect(row.context, row.feature).toBe('single-line-text');
        else expect(row.context, row.feature).not.toBe('single-line-text');
      }
    }
    expect(iosProfile.rows.filter((r) => r.feature.startsWith('font-family:Ahem')).map((r) => r.context)).toEqual(['single-line-text']);
    expect(iosProfile.rows.some((r) => r.feature === 'width:<length-px>' && r.context === 'block')).toBe(true);
    expect(iosProfile.rows.some((r) => r.feature === 'margin-top:auto' && r.context === 'block')).toBe(false);
  });

  it('every Chrome deviation node, across all branches (M5), passed and matches Chrome exactly at 1/64 px in this run', () => {
    for (const d of chromeDeviations) {
      expect(outcomes.get(d.fixture)?.status, `${d.id} -> ${d.fixture}`).toBe('pass');
      expect(d.nodes.length, d.id).toBeGreaterThan(0);
      for (const n of d.nodes) {
        const node = outcomes.get(d.fixture)?.cases.flatMap((c) => c.comparison?.nodes ?? []).find((x) => x.id === n.node);
        expect(node?.exactLu, `${d.id} ${n.branch} -> ${n.node} matches Chrome at 1/64 px`).toBe(true);
      }
    }
    const branches = chromeDeviations.find((d) => d.id === 'min-max-end-margin')?.nodes.map((n) => n.node);
    for (const p of ['p4', 'p5', 'p6', 'p9']) expect(branches, p).toContain(p);
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

  it('writes the report: at least 50 fixtures, every case listed and passing, case counts equal the domain products', () => {
    const ordered = FIXTURES.map((f) => outcomes.get(f.id)).filter((o): o is FixtureOutcome => o !== undefined);
    expect(ordered.length).toBe(FIXTURES.length);
    const report = buildReport(ordered);
    writeReport(report);
    expect(report.summary.fixtures).toBeGreaterThanOrEqual(50);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.unsupportedCodes).toEqual([]);
    expect(report.summary.casesPassed).toBe(report.summary.cases);
    for (const o of ordered) for (const c of o.cases) expect(c.lanes, c.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
    for (const cc of report.summary.caseCounts) {
      expect(cc.cases.length, cc.fixture).toBe(cc.expected);
      expect(cc.dragon, cc.fixture).toBe(cc.expected);
    }
    expect(report.summary.caseCounts.find((c) => c.fixture === 'tree-switch-two-instances')?.cases.length).toBe(16);
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
});
