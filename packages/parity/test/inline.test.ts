// INL1a's planted engine faults through runFixture, with the committed Chrome captures as the authored side: each moves one line
// breaking rule off Blink's (linebreak.ts, linefit.ts), and the layout lane names the boxes whose line count changes. The unfaulted
// runs pass. Then white-space collapsing over a whole inline formatting context (notes/T058-inl1a.md T058J2 (A)), the reference
// dump and capture of inline fixtures, the planted compiler faults and the host side of the single-run-baseline plant.
import { readdirSync, readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutBox, LayoutRect } from '@dragon/layout';
import { absoluteRects, inlineLeaves, layout, LU_PER_PX, measurerFor, NO_ENGINE_FAULTS, placeLines, zoomInput } from '@dragon/layout';
import type { CompilerFaults } from 'dragon';
import { collapseInlineContext, collapseInlineRun, NO_FAULTS, programInput } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { compileFixture, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';
import { parseFixtureHtml } from '../src/fixture-reader.ts';
import { repoPath } from '../src/paths.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { atDpr, layoutCases } from '../src/dpr.ts';
import { referenceDump } from '../src/native-compare.ts';
import { deviceDprs, nativeTargets } from '../src/targets.ts';
import { LINE_PLANT_CASE } from '../src/device-run.ts';
import { nativeCases } from '../src/native-host.ts';
import { casePoints } from '../src/pixel-reference.ts';

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

describe('the reference dump of an inline fixture (T058 Amendment 1)', () => {
  it('labels inline boxes and <br>s element and the text inside an inline box text, and does not throw', () => {
    const f = layoutCases().find((x) => x.spec.id === 'inline-br');
    const c = f?.cases.find((x) => x.environment.direction === 'ltr');
    if (f === undefined || c === undefined) throw new Error('inline-br has no ltr case');
    const { compiled } = compileFixture(f.spec, NO_FAULTS, 'enforce', 'ltr');
    const m = measurerFor(REFERENCE_PLATFORM);
    if (m.kind !== 'ok') throw new Error(m.detail);
    for (const t of nativeTargets()) {
      const p = t.projection(compiled, atDpr(c.environment, 2), c.assignment);
      if (p.kind !== 'ready') throw new Error(`${t.target} projection blocked`);
      const out = layout(p.input, m.measurer);
      if (out.kind !== 'ok') throw new Error(JSON.stringify(out.unsupported));
      const dump = referenceDump({ platform: t.target, caseId: c.id, fixture: f.spec.id, dpr: 2, direction: 'ltr', compilerDigest: compiled.digest, input: p.input, engine: out.boxes });
      const kind = (id: string): string | undefined => dump.nodes.find((n) => n.id === id)?.kind;
      expect([kind('r6s'), kind('r6b'), kind('r6s:text0'), kind('r6:text0'), kind('r1b')], t.target).toEqual(['element', 'element', 'text', 'text', 'element']);
      // The span's per-line fragments are its lines, not nodes.
      expect(dump.nodes.find((n) => n.id === 'r6s')?.lines.length, t.target).toBe(2);
      expect(dump.nodes.some((n) => n.id.includes(':line')), t.target).toBe(false);
    }
  });
});

describe('the program of an inline box or <br> view', () => {
  it('gives every box view, inline boxes and <br>s included, the background and border writes its view reads back (device-applied)', () => {
    // A DragonBoxView reports its background and borders whatever the program wrote, so a box view without those writes fails (b).
    const missing: string[] = [];
    const checked = new Set<string>();
    for (const n of nativeCases()) {
      for (const [backend, p] of Object.entries(n.programs)) {
        for (const x of p.nodes) {
          if (!x.native.endsWith('DragonBoxView')) continue;
          checked.add(`${n.case.id} ${backend} ${x.id}`);
          const kinds = new Set(x.writes.map((w) => w.kind));
          for (const k of ['background-color', 'border-widths', 'border-styles', 'border-colors']) if (!kinds.has(k)) missing.push(`${n.case.id} ${backend} ${x.id} ${k}`);
        }
      }
    }
    // The span m1s and the <br> m1b of inline-mixed-sizes, whose views failed device-applied without these writes, are box views checked here.
    for (const backend of ['uikit', 'android-views']) for (const id of ['m1s', 'm1b']) expect(checked.has(`inline-mixed-sizes ${backend} ${id}`), `${backend} ${id}`).toBe(true);
    expect(missing).toEqual([]);
  });
});

describe('the capture of inline boxes (T058 Amendment 1, capture.ts)', () => {
  it('records one "<id>:line<j>" per line an inline box is on, and none for a <br>', async () => {
    const f = layoutCases().find((x) => x.spec.id === 'inline-br');
    const c = f?.cases.find((x) => x.environment.direction === 'ltr');
    if (c === undefined) throw new Error('inline-br has no ltr case');
    const ids = (await committedAuthored(c)).nodes.map((n) => `${n.id} ${n.kind}`);
    // r6s holds a <br>, so it is on two lines; r10s holds two <br>s and no text.
    expect(ids.filter((x) => /^r6s:line|^r10s:line/.test(x))).toEqual(['r6s:line0 line', 'r6s:line1 line', 'r10s:line0 line', 'r10s:line1 line']);
    expect(ids.filter((x) => /^r\d+b\d*:line/.test(x))).toEqual([]);
  });
});

describe.sequential('INL1a planted compiler faults, against the committed Chrome captures', () => {
  // The file's Chrome (beforeAll above) runs these too.
  const runCompiler = async (id: string, faults: CompilerFaults) => {
    const spec = FIXTURES.find((f) => f.id === id);
    if (spec === undefined) throw new Error(`${id} is not registered`);
    if (browser === undefined) throw new Error('Chrome did not launch');
    return runFixture(spec, browser, { authored: committedAuthored, faults, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
  };
  // Each plant leaves a space-only text leaf where a line starts or ends, which the engine input validator rejects by path.
  const plants: readonly { readonly fault: 'brAsSpace' | 'inlineWrapperPerElement'; readonly fixture: string; readonly path: string }[] = [
    { fault: 'brAsSpace', fixture: 'inline-br', path: '$.root.children[0].children[0].children uncollapsed-text' },
    { fault: 'inlineWrapperPerElement', fixture: 'inline-tags', path: '$.root.children[0].children[3].children[1].children uncollapsed-text' },
  ];
  for (const p of plants) {
    it(`${p.fault}: ${p.fixture} fails in both directions on the rejected input (${p.path}); unfaulted it passes`, async () => {
      expect((await runCompiler(p.fixture, NO_FAULTS)).reason).toBeNull();
      const faulty = await runCompiler(p.fixture, { ...NO_FAULTS, [p.fault]: true });
      expect(faulty.status).toBe('fail');
      expect(faulty.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
      for (const c of faulty.cases) {
        expect(c.status, c.id).toBe('fail');
        expect(c.reason, c.id).toMatch(/^layout input rejected: /);
        expect(c.reason, c.id).toContain(p.path);
      }
    });
  }
});

describe('the host side of the single-run-baseline plant (T058J3 F)', () => {
  it('LINE_PLANT_CASE holds b1:text1 on two lines whose baselines sit a whole device px or more differently below their line tops, with a glyph-bottom scanline on the moved line, at every device DPR', () => {
    const n = nativeCases().find((c) => c.case.id === LINE_PLANT_CASE);
    if (n === undefined) throw new Error(`no case ${LINE_PLANT_CASE}`);
    const m = measurerFor(REFERENCE_PLATFORM);
    if (m.kind !== 'ok') throw new Error(m.detail);
    for (const dpr of [...new Set(nativeTargets().flatMap((t) => deviceDprs(t.target)))]) {
      const input = programInput(n.programs.uikit, n.case.environment.viewport, dpr);
      const zoomed = zoomInput(input, NO_ENGINE_FAULTS);
      const find = (b: LayoutBox): LayoutBox | null => (b.id === 'b1' ? b : b.children.flatMap((k) => (k.kind === 'box' ? [find(k)] : [])).find((x) => x !== null) ?? null);
      const box = find(zoomed.root);
      const out = layout(input, m.measurer);
      if (box === null || out.kind !== 'ok') throw new Error(`b1 is not laid out at ${dpr}`);
      const ctx = { measurer: m.measurer, devicePixelRatio: zoomed.devicePixelRatio, faults: NO_ENGINE_FAULTS };
      const leaf = inlineLeaves(box).findIndex((t) => t.id === 'b1:text1');
      const lines = placeLines(ctx, box, (absoluteRects(out.boxes).get('b1') as LayoutRect).width).filter((l) => l.pieces.some((p) => p.leaf === leaf));
      expect(lines.length, `${dpr}`).toBe(2);
      const [a, b] = lines.map((l) => (l.baseline - l.top) / LU_PER_PX) as [number, number];
      expect(Math.abs(a - b), `${dpr}`).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(a - b), `${dpr}`).toBe(true);
      const rules = casePoints(n.programs.uikit, n.case.environment.viewport, dpr).map((q) => q.rule).filter((r) => r.includes('b1'));
      expect(rules, `${dpr}`).toContain('edge:b1:text1:line1:glyph-bottom');
    }
  });
});
