import { existsSync, readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromeDeviations } from '@dragon/layout';
import type { ProfileRow } from 'dragon';
import { iosProfile, NO_FAULTS, webProfile } from 'dragon';
import type { WebCapture } from '../src/capture.ts';
import { captureFixture, captureJson } from '../src/capture.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';
import type { FixtureOutcome } from '../src/pipeline.ts';
import { runFixture } from '../src/pipeline.ts';
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

const passed = (id: string): boolean => outcomes.get(id)?.status === 'pass';
const lanePassed = (id: string, lane: 'linux-dragon-layout' | 'chrome-dual'): boolean => outcomes.get(id)?.lanes[lane] === 'pass';

/** Colour and paint features: native paint has no lane in milestone 1, so no ios row for these may be exact. */
const isPaintFeature = (feature: string): boolean => /(^|-)color:|background|shadow|opacity|-style:(dotted|dashed|double|groove|ridge|inset|outset)$/.test(feature);

function specFor(id: string): (typeof FIXTURES)[number] {
  const spec = FIXTURES.find((f) => f.id === id);
  if (spec === undefined) throw new Error(`fixture ${id} missing`);
  return spec;
}

function capturedFor(id: string): WebCapture {
  const c = captures.get(id);
  if (c === undefined) throw new Error(`no live capture for ${id}`);
  return c;
}

describe.sequential('S2 parity: Chrome 145 vs Dragon (layout lane at 1 device px, dual lane exact)', () => {
  it('the gate is owner decision 13: one device pixel, never per fixture', () => {
    expect(GATE_DEVICE_PX).toBe(1);
    for (const f of FIXTURES) if (f.kind === 'layout') expect(f.gate).toBe('default');
  });

  for (const spec of FIXTURES) {
    it(`${spec.id} (${spec.kind})`, async () => {
      const html = readFileSync(repoPath(`packages/parity/fixtures/${spec.id}.html`), 'utf8');
      let authored: WebCapture | null = null;
      if (spec.kind === 'layout') {
        authored = await captureFixture(browser, spec.id, html, ENVIRONMENT);
        captures.set(spec.id, authored);
        const committed = readFileSync(repoPath(`packages/parity/expected/${spec.id}.web.json`), 'utf8');
        expect(captureJson(authored), 'live capture must equal the committed expected file').toBe(committed);
      }
      const outcome = await runFixture(spec, browser, { authored, faults: NO_FAULTS });
      outcomes.set(spec.id, outcome);
      expect(outcome.reason).toBeNull();
      expect(outcome.status).toBe('pass');
      if (spec.kind === 'layout') {
        expect(outcome.lanes).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
        expect(outcome.unsupported).toBeNull();
        const emitted = readFileSync(repoPath(`packages/parity/emitted/${spec.id}.css`), 'utf8');
        expect(outcome.webCss, 'emitted web CSS must equal the committed file').toBe(emitted);
      } else {
        expect(outcome.comparison).toBeNull();
        expect(outcome.dual).toBeNull();
        expect(outcome.vector).toBeNull();
        expect(existsSync(repoPath(`packages/parity/emitted/${spec.id}.css`))).toBe(false);
      }
    });
  }

  it('planted fault: swapping content-box and border-box in the ios lowering fails the layout gate', async () => {
    const id = 'block-content-box-padding-border';
    const faulty = await runFixture(specFor(id), browser, { authored: capturedFor(id), faults: { ...NO_FAULTS, swapBoxSizing: true } });
    expect(faulty.status).toBe('fail');
    expect(faulty.lanes['linux-dragon-layout']).toBe('fail');
    expect(faulty.reason).toMatch(/exceeds 1 device px/);
    expect(faulty.comparison?.nodes.find((n) => n.id === 'box')?.pass).toBe(false);
  });

  it('planted fault: a resolver that collapses compound-class variants fails the dual check', async () => {
    const id = 'cascade-compound-variants';
    const faulty = await runFixture(specFor(id), browser, { authored: capturedFor(id), faults: { ...NO_FAULTS, variantCollapse: true } });
    expect(faulty.status).toBe('fail');
    expect(faulty.lanes['chrome-dual']).toBe('fail');
    expect(faulty.dual?.pass).toBe(false);
    expect((faulty.dual?.valuesEqual ?? 0) < (faulty.dual?.valuesCompared ?? 0)).toBe(true);
    expect(faulty.reason).toMatch(/chrome-dual: /);
  });

  it('planted fault: a colour-only resolver error fails the dual check on channels while the layout lane passes', async () => {
    const id = 'color-syntax';
    const faulty = await runFixture(specFor(id), browser, { authored: capturedFor(id), faults: { ...NO_FAULTS, colourOnly: true } });
    expect(faulty.status).toBe('fail');
    expect(faulty.lanes['linux-dragon-layout']).toBe('pass');
    expect(faulty.lanes['chrome-dual']).toBe('fail');
    const dual = faulty.dual;
    if (dual === null) throw new Error('no dual comparison');
    expect(dual.boxesEqual).toBe(dual.boxesCompared);
    expect(dual.channelsEqual).toBeLessThan(dual.channelsCompared);
    expect(dual.problems.every((p) => /color/.test(p))).toBe(true);
  });

  function checkProofs(row: ProfileRow, target: 'ios' | 'web'): void {
    expect(row.proofs.length, row.feature).toBeGreaterThan(0);
    for (const proof of row.proofs) {
      expect(proof.fixtures.length, row.feature).toBeGreaterThan(0);
      for (const id of proof.fixtures) {
        expect(passed(id), `${target} ${row.feature} names ${id}`).toBe(true);
        expect(lanePassed(id, proof.lane), `${target} ${row.feature}: ${id} passed ${proof.lane}`).toBe(true);
      }
      const users = proof.fixtures.filter((id) => outcomes.get(id)?.features[target].includes(row.feature));
      expect(users, `${target} ${row.feature} is used by a named fixture`).not.toEqual([]);
    }
  }

  it('ios rows: exact layout rows name passing linux-dragon-layout fixtures; colour rows are capped at caveat', () => {
    expect(iosProfile.rows.length).toBeGreaterThan(0);
    for (const row of iosProfile.rows) {
      if (row.status === 'unsupported') continue;
      checkProofs(row, 'ios');
      if (isPaintFeature(row.feature)) {
        expect(row.status, `${row.feature}: no native paint lane yet`).toBe('caveat');
        for (const p of row.proofs) expect([p.aspect, p.lane]).toEqual(['computed-value', 'chrome-dual']);
      } else {
        expect(row.status, row.feature).toBe('exact');
        for (const p of row.proofs) expect([p.aspect, p.lane]).toEqual(['layout', 'linux-dragon-layout']);
      }
    }
    expect(iosProfile.rows.filter((r) => r.status === 'exact' && isPaintFeature(r.feature))).toEqual([]);
  });

  it('web rows: at least one exact; every exact row names dual-check fixtures that passed this run and use the feature', () => {
    const exact = webProfile.rows.filter((r) => r.status === 'exact');
    expect(exact.length).toBeGreaterThan(0);
    for (const row of webProfile.rows) {
      if (row.status === 'unsupported') continue;
      checkProofs(row, 'web');
      for (const p of row.proofs) expect(p.lane, row.feature).toBe('chrome-dual');
      expect(row.proofs.some((p) => p.aspect === 'computed-value'), row.feature).toBe(true);
    }
  });

  it('every Chrome deviation names a fixture that passed in this run and a node that matches Chrome exactly', () => {
    for (const d of chromeDeviations) {
      expect(passed(d.fixture), `${d.id} -> ${d.fixture}`).toBe(true);
      const node = outcomes.get(d.fixture)?.comparison?.nodes.find((n) => n.id === d.node);
      expect(node?.exactLu, `${d.id} -> ${d.node} matches Chrome at 1/64 px`).toBe(true);
    }
  });

  it('writes the report to packages/parity/out: every fixture passes, no LayoutUnsupported, at least 35 fixtures', () => {
    const ordered = FIXTURES.map((f) => outcomes.get(f.id)).filter((o): o is FixtureOutcome => o !== undefined);
    expect(ordered.length).toBe(FIXTURES.length);
    const report = buildReport(ordered);
    writeReport(report);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.unsupportedCodes).toEqual([]);
    expect(report.summary.fixtures).toBeGreaterThanOrEqual(35);
    for (const o of ordered) if (o.kind === 'layout') expect(o.lanes, o.id).toEqual({ 'linux-dragon-layout': 'pass', 'chrome-dual': 'pass' });
  });
});
