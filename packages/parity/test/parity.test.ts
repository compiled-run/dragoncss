import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromeDeviations } from '@dragon/layout';
import { iosProfile, webProfile } from 'dragon';
import { captureFixture, captureJson } from '../src/capture.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';
import { FIXTURES, VIEWPORT } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';
import type { FixtureOutcome } from '../src/pipeline.ts';
import { runFixture } from '../src/pipeline.ts';
import { buildReport, writeReport } from '../src/report.ts';
import type { WebCapture } from '../src/capture.ts';

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

describe.sequential('S1 layout parity: Chrome 145 vs Dragon layout at 1 device px', () => {
  it('the gate is owner decision 13: one device pixel', () => {
    expect(GATE_DEVICE_PX).toBe(1);
    for (const f of FIXTURES) if (f.kind === 'layout') expect(f.gate).toBe('default');
  });

  for (const spec of FIXTURES) {
    it(`${spec.id} (${spec.kind})`, async () => {
      const html = readFileSync(repoPath(`packages/parity/fixtures/${spec.id}.html`), 'utf8');
      let capture: WebCapture | null = null;
      if (spec.kind === 'layout') {
        capture = await captureFixture(browser, spec.id, html, VIEWPORT);
        captures.set(spec.id, capture);
      }
      const outcome = runFixture(spec, capture);
      outcomes.set(spec.id, outcome);
      if (capture !== null) {
        const committed = readFileSync(repoPath(`packages/parity/expected/${spec.id}.web.json`), 'utf8');
        expect(captureJson(capture), 'live capture must equal the committed expected file').toBe(committed);
      }
      expect(outcome.reason).toBeNull();
      expect(outcome.status).toBe('pass');
      if (spec.kind === 'reject') {
        expect(outcome.comparison).toBeNull();
        expect(outcome.vector).toBeNull();
      }
    });
  }

  it('planted fault 2: swapping content-box and border-box in the ios lowering fails the gate', () => {
    const spec = FIXTURES.find((f) => f.id === 'block-content-box-padding-border');
    const capture = captures.get('block-content-box-padding-border');
    if (spec === undefined || capture === undefined) throw new Error('fixture missing');
    const faulty = runFixture(spec, capture, { swapBoxSizing: true });
    expect(faulty.status).toBe('fail');
    expect(faulty.comparison?.nodes.some((n) => !n.pass)).toBe(true);
    expect(faulty.reason).toMatch(/exceeds 1 device px/);
    expect(faulty.comparison?.nodes.find((n) => n.id === 'box')?.pass).toBe(false);
  });

  it('every exact ios profile row names fixtures that passed in this run and use the feature', () => {
    expect(iosProfile.rows.length).toBeGreaterThan(0);
    for (const row of iosProfile.rows) {
      if (row.status !== 'exact') continue;
      expect(row.proofs.length, row.feature).toBeGreaterThan(0);
      for (const proof of row.proofs) {
        expect(proof.aspect).toBe('layout');
        expect(proof.lane).toBe('linux-dragon-layout');
        expect(proof.fixtures.length, row.feature).toBeGreaterThan(0);
        for (const id of proof.fixtures) expect(passed(id), `${row.feature} names ${id}`).toBe(true);
        const users = proof.fixtures.filter((id) => outcomes.get(id)?.features.includes(row.feature));
        expect(users, `${row.feature} is used by a named fixture`).not.toEqual([]);
      }
    }
  });

  it('nothing is exact for web, colour or paint', () => {
    expect(webProfile.rows.filter((r) => r.status === 'exact')).toEqual([]);
    const paint = iosProfile.rows.filter((r) => /color|background|shadow|opacity/.test(r.feature));
    expect(paint).toEqual([]);
  });

  it('every Chrome deviation names a fixture that passed in this run', () => {
    for (const d of chromeDeviations) {
      expect(passed(d.fixture), `${d.id} -> ${d.fixture}`).toBe(true);
      const node = outcomes.get(d.fixture)?.comparison?.nodes.find((n) => n.id === d.node);
      expect(node?.exactLu, `${d.id} -> ${d.node} matches Chrome at 1/64 px`).toBe(true);
    }
  });

  it('writes the report to packages/parity/out', () => {
    const ordered = FIXTURES.map((f) => outcomes.get(f.id)).filter((o): o is FixtureOutcome => o !== undefined);
    expect(ordered.length).toBe(FIXTURES.length);
    const report = buildReport(ordered);
    writeReport(report);
    expect(report.summary.failed).toBe(0);
  });
});
