// INL1a's planted engine faults through runFixture, with the committed Chrome captures as the authored side: each moves one line
// breaking rule off Blink's (linebreak.ts, linefit.ts), and the layout lane names the boxes whose line count changes. The unfaulted
// runs pass. Then white-space collapsing over a whole inline formatting context (notes/T058-inl1a.md T058J2 (A)).
import { readdirSync, readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { collapseInlineContext, collapseInlineRun, NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';
import { parseFixtureHtml } from '../src/fixture-reader.ts';
import { repoPath } from '../src/paths.ts';

let browser: Browser | undefined;

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});

afterAll(async () => {
  await browser?.close();
});

const run = async (id: string, engineFaults: EngineFaults) => {
  const spec = FIXTURES.find((f) => f.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  if (browser === undefined) throw new Error('Chrome did not launch');
  return runFixture(spec, browser, { authored: committedAuthored, faults: NO_FAULTS, engineFaults, profiles: 'enforce' });
};

/** Each plant, the fixture that catches it, and the boxes whose layout it moves off Chrome's in every case of the fixture. */
const PLANTS: readonly { readonly fault: keyof EngineFaults; readonly fixture: string; readonly nodes: readonly string[] }[] = [
  { fault: 'spaceOnlyBreaks', fixture: 'inline-breaks-hyphen', nodes: ['h1', 'h2', 'h3', 'h5', 'h7', 'h8'] },
  { fault: 'noHyphenDigitBreak', fixture: 'inline-breaks-hyphen', nodes: ['h2', 'h3'] },
  { fault: 'breakAfterSolidus', fixture: 'inline-breaks-no-break', nodes: ['n1', 'n2'] },
  { fault: 'fitWithoutEpsilon', fixture: 'inline-breaks-fit', nodes: ['e1', 'e4'] },
];

describe.sequential('INL1a planted engine faults', () => {
  for (const p of PLANTS) {
    it(`${p.fault}: ${p.fixture} fails the layout lane on ${p.nodes.join(', ')}; unfaulted it passes`, async () => {
      const clean = await run(p.fixture, NO_ENGINE_FAULTS);
      expect(clean.reason).toBeNull();
      expect(clean.status).toBe('pass');
      const faulty = await run(p.fixture, { ...NO_ENGINE_FAULTS, [p.fault]: true });
      expect(faulty.status).toBe('fail');
      expect(clean.cases.length).toBeGreaterThan(0);
      expect(faulty.cases.map((c) => c.id)).toEqual(clean.cases.map((c) => c.id));
      for (const c of faulty.cases) {
        expect(c.status, c.id).toBe('fail');
        expect(c.lanes['linux-dragon-layout'], c.id).toBe('fail');
        const failed = new Set((c.comparison?.nodes ?? []).filter((n) => !n.pass).map((n) => n.id));
        for (const n of p.nodes) expect(failed.has(n), `${c.id} ${n}`).toBe(true);
      }
    });
  }
});

type Raw = ReturnType<typeof parseFixtureHtml>['root'];

/** The text runs of every element of a fixture: its text children, split at each element child; with and without blank texts. */
function runsOf(el: Raw, out: string[][]): string[][] {
  for (const blanks of [true, false]) {
    let run: string[] = [];
    for (const c of el.children) {
      if ('tag' in c) {
        if (run.length > 0) out.push(run);
        run = [];
      } else if (blanks || c.text.trim() !== '') run.push(c.text);
    }
    if (run.length > 0) out.push(run);
  }
  for (const c of el.children) if ('tag' in c) runsOf(c, out);
  return out;
}

/** A small deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('collapseInlineContext (T058J2 (A))', () => {
  it('equals collapseInlineRun on every text run of every existing fixture', () => {
    const dir = repoPath('packages/parity/fixtures');
    const files = readdirSync(dir).filter((f) => f.endsWith('.html') && !f.startsWith('inline-') && !f.startsWith('reject-inline-'));
    expect(files.length).toBeGreaterThan(200);
    let n = 0;
    for (const f of files) {
      for (const run of runsOf(parseFixtureHtml(readFileSync(`${dir}/${f}`, 'utf8')).root, [])) {
        expect(collapseInlineContext(run), `${f} ${JSON.stringify(run)}`).toEqual(collapseInlineRun(run));
        n++;
      }
    }
    expect(n).toBeGreaterThan(500);
  });
  it('equals collapseInlineRun on 20000 generated run lists without <br>', () => {
    const r = rng(0x1a1a);
    const alphabet = [' ', ' ', '\n', '\t', '\r', '\f', 'a', 'b', '​'];
    for (let i = 0; i < 20000; i++) {
      const runs: string[] = [];
      const count = 1 + Math.floor(r() * 5);
      for (let k = 0; k < count; k++) {
        let t = '';
        const len = Math.floor(r() * 6);
        for (let j = 0; j < len; j++) t += alphabet[Math.floor(r() * alphabet.length)] as string;
        runs.push(t);
      }
      expect(collapseInlineContext(runs), JSON.stringify(runs)).toEqual(collapseInlineRun(runs));
    }
  });
  it('collapses across inline box boundaries and not across a <br>', () => {
    // a <span> b</span>: one space, kept in the first run.
    expect(collapseInlineContext(['a ', ' b'])).toEqual(['a ', 'b']);
    // a<span> </span>b: the space is the span's.
    expect(collapseInlineContext(['a', ' ', 'b'])).toEqual(['a', ' ', 'b']);
    // Spaces before a <br> collapse to one that hangs (INL-P f2-after-space); spaces after it start a line and are removed.
    expect(collapseInlineContext(['ab   ', null, '   cd'])).toEqual(['ab ', null, 'cd']);
    expect(collapseInlineContext(['a ', null, ' ', null, 'b'])).toEqual(['a ', null, '', null, 'b']);
    // A leading and a trailing <br>.
    expect(collapseInlineContext([null, ' ab'])).toEqual([null, 'ab']);
    expect(collapseInlineContext(['ab', null, null])).toEqual(['ab', null, null]);
    expect(collapseInlineContext(['ab ', null])).toEqual(['ab ', null]);
    // A segment break next to U+200B is removed (css-text-3 §4.1.2), within a run and across a box boundary.
    expect(collapseInlineContext(['a\n​b'])).toEqual(['a​b']);
    expect(collapseInlineContext(['a\n', '​b'])).toEqual(['a', '​b']);
    expect(collapseInlineContext(['a\n', '​b'])).toEqual(collapseInlineRun(['a\n', '​b']));
  });
});
