// V1 of the engine value model (notes/T006-value-model-spec.md §4): the values fixture group against the committed Chrome 145
// captures, without a live browser. Every case is exact at 1/64 px at DPR 1, 2, 3 and 2.625 in both directions; each planted
// value-model fault fails its named fixture with its named failure kind; the calc goldens (packages/layout/vectors/calc) agree
// with Chrome where a fixture holds the same element; and getComputedStyle's calc serializations equal css/math.ts's.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CalcExpr, EngineFaults, LayoutBox, LayoutInput, LayoutRect } from '@dragon/layout';
import { dprPlatformRules, NO_ENGINE_FAULTS, zoomInput } from '@dragon/layout';
import { iosLayoutProjection, NO_FAULTS } from 'dragon';
import { computedMathNode, serializeMath } from '../../dragon/src/css/math.ts';
import type { WebCapture } from '../src/capture.ts';
import type { ParityCase } from '../src/cases.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { expectedPath } from '../src/committed.ts';
import { exactInZoomedLu } from '../src/compare.ts';
import { committedDprCapture, runDprCase } from '../src/dpr.ts';
import { FIXTURE_GROUPS, FIXTURES } from '../src/fixtures.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { compileFixture } from '../src/pipeline.ts';
import { repoPath } from '../src/paths.ts';
import { layoutCaseIds } from '../src/targets.ts';
import { shapedCaseIds } from '../src/text-latin-run.ts';

const VALUES = (FIXTURE_GROUPS.find((g) => g.id === 'values') as { fixtures: readonly FixtureSpec[] }).fixtures;
const LAYOUT = VALUES.filter((f) => f.kind === 'layout');
const DPRS = [1, 2, 3, 2.625];

const spec = (id: string): FixtureSpec => FIXTURES.find((f) => f.id === id) as FixtureSpec;
const committed = (c: ParityCase, dpr: number): WebCapture => (dpr === 1 ? (JSON.parse(readFileSync(expectedPath(c.id), 'utf8')) as WebCapture) : committedDprCapture(c.id, dpr));

describe('values group registration (fixture-groups/values.ts)', () => {
  it('is the last group; every layout fixture runs in both directions and every id carries the values- prefix the corpus keys on', () => {
    // TXT1a-2 and T133: the text groups and inline-tags come after it, and every case of theirs is shaped, so they add no plain
    // vector before the values ones.
    expect(FIXTURE_GROUPS.map((g) => g.id).slice(-4)).toEqual(['values', 'text-latin', 'text-calibration', 'inline-tags']);
    const shaped = shapedCaseIds();
    for (const g of FIXTURE_GROUPS.slice(-3)) for (const f of g.fixtures) for (const id of layoutCaseIds().filter((x) => x === f.id || x === `${f.id}-rtl`)) expect(shaped.has(id), id).toBe(true);
    for (const f of VALUES) expect(f.id.startsWith('values-'), f.id).toBe(true);
    for (const f of LAYOUT) expect(f.kind === 'layout' && f.environments, f.id).toEqual(['ltr', 'rtl']);
    expect(LAYOUT.length).toBeGreaterThanOrEqual(25);
    expect(VALUES.filter((f) => f.kind === 'reject').length).toBeGreaterThanOrEqual(11);
  });
});

describe('every values case is exact at 1/64 px at every DPR against the committed captures', () => {
  for (const f of LAYOUT) {
    it(f.id, () => {
      for (const c of casesOf(f, fixtureInput(f))) {
        const compiled = compileFixture(f, NO_FAULTS, 'enforce', c.environment.direction).compiled;
        for (const dpr of DPRS) {
          const o = runDprCase(c, compiled, dpr, committed(c, dpr));
          expect(o.reason, `${c.id} @${dpr}`).toBeNull();
          expect(o.exact, `${c.id} @${dpr}`).toBe(o.nodes);
        }
      }
    });
  }
});

/**
 * Each planted value-model fault and the fixture it fails, at a DPR, on named nodes, with its failure kind: gate (an edge more than
 * 1 device px from Chrome) or exact (within the gate but not exact at 1/64 px, which the DPR lane and this test refuse).
 */
const PLANTED: readonly { readonly fault: string; readonly kind: 'engine' | 'compiler'; readonly fixture: string; readonly dpr: number; readonly failure: 'gate' | 'exact'; readonly nodes: readonly string[] }[] = [
  { fault: 'calcPercentPlainOrder', kind: 'engine', fixture: 'values-calc-percent-order', dpr: 1, failure: 'exact', nodes: ['a', 'd', 'e', 'a2', 'd2', 'e2'] },
  { fault: 'calcDoubleEval', kind: 'engine', fixture: 'values-calc-percent-order', dpr: 1, failure: 'exact', nodes: ['a', 'd', 'e', 'a2', 'd2', 'e2'] },
  { fault: 'calcNoNonNegClamp', kind: 'engine', fixture: 'values-calc-nonneg-clamp', dpr: 1, failure: 'gate', nodes: ['p', 'k', 'w', 'm', 'q'] },
  { fault: 'calcPercentIndefiniteAsLength', kind: 'engine', fixture: 'values-calc-zero-percent-height', dpr: 1, failure: 'gate', nodes: ['z', 'zz'] },
  { fault: 'clampMaxWins', kind: 'engine', fixture: 'values-clamp-min-wins', dpr: 1, failure: 'gate', nodes: ['a'] },
  { fault: 'divideDirect', kind: 'engine', fixture: 'values-calc-divide', dpr: 1, failure: 'exact', nodes: ['b'] },
  { fault: 'calcLeafUnzoomed', kind: 'engine', fixture: 'values-calc-em-fractional', dpr: 3, failure: 'gate', nodes: ['a', 'b', 'c', 'd'] },
  { fault: 'viewportUnitsUnceiled', kind: 'engine', fixture: 'values-viewport-units', dpr: 2.625, failure: 'exact', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
  { fault: 'sumOrderSwapped', kind: 'compiler', fixture: 'values-calc-sum-order', dpr: 1, failure: 'exact', nodes: ['a', 'b', 'c'] },
  { fault: 'dropExplicitZeroPercent', kind: 'compiler', fixture: 'values-calc-zero-percent-height', dpr: 1, failure: 'gate', nodes: ['z'] },
];

describe('planted value-model faults: 8 engine and 2 compiler faults each fail their named values fixture', () => {
  it('names every fault once: the 8 V1 engine faults and the 2 compiler faults', () => {
    expect(PLANTED.filter((p) => p.kind === 'engine').map((p) => p.fault).sort()).toEqual(['calcDoubleEval', 'calcLeafUnzoomed', 'calcNoNonNegClamp', 'calcPercentIndefiniteAsLength', 'calcPercentPlainOrder', 'clampMaxWins', 'divideDirect', 'viewportUnitsUnceiled']);
    expect(PLANTED.filter((p) => p.kind === 'compiler').map((p) => p.fault).sort()).toEqual(['dropExplicitZeroPercent', 'sumOrderSwapped']);
    expect(Object.keys(NO_ENGINE_FAULTS)).toEqual(expect.arrayContaining(PLANTED.filter((p) => p.kind === 'engine').map((p) => p.fault)));
    expect(Object.keys(NO_FAULTS)).toEqual(expect.arrayContaining(PLANTED.filter((p) => p.kind === 'compiler').map((p) => p.fault)));
  });
  for (const p of PLANTED) {
    it(`${p.fault} fails ${p.fixture} at DPR ${p.dpr} (${p.failure}) on ${p.nodes.join(', ')} in both directions, and the fixture passes with it off`, () => {
      const f = spec(p.fixture);
      for (const c of casesOf(f, fixtureInput(f))) {
        const faulty = compileFixture(f, p.kind === 'compiler' ? { ...NO_FAULTS, [p.fault]: true } : NO_FAULTS, 'enforce', c.environment.direction).compiled;
        const engine: EngineFaults = p.kind === 'engine' ? { ...NO_ENGINE_FAULTS, [p.fault]: true } : NO_ENGINE_FAULTS;
        const o = runDprCase(c, faulty, p.dpr, committed(c, p.dpr), engine);
        expect(o.status, c.id).toBe('fail');
        const nodes = (o.comparison?.nodes ?? []).filter((n) => n.dragon !== null);
        const failed = nodes.filter((n) => (p.failure === 'gate' ? !n.pass : n.pass && !n.exactLu)).map((n) => n.id);
        for (const id of p.nodes) expect(failed, `${c.id}: ${id}`).toContain(id);
        if (p.failure === 'exact') expect(nodes.filter((n) => !n.pass), c.id).toEqual([]);
        const clean = runDprCase(c, compileFixture(f, NO_FAULTS, 'enforce', c.environment.direction).compiled, p.dpr, committed(c, p.dpr));
        expect(clean.status, c.id).toBe('pass');
      }
    });
  }
});

/** A calc golden and the fixture elements that hold the same calculation in the same box: their sizes must be Chrome's. */
const GOLDEN_CHROME: readonly { readonly golden: string; readonly fixture: string; readonly dpr: number; readonly nodes: readonly (readonly [string, string])[] }[] = [
  { golden: 'sum-order-float-dpr-1', fixture: 'values-calc-sum-order', dpr: 1, nodes: [['a', 'a'], ['b', 'b']] },
  { golden: 'sum-order-float-dpr-2.625', fixture: 'values-calc-sum-order', dpr: 2.625, nodes: [['a', 'a'], ['b', 'b']] },
  { golden: 'constant-double-dpr-1', fixture: 'values-calc-sum-order', dpr: 1, nodes: [['a', 'g'], ['b', 'h']] },
  { golden: 'constant-double-dpr-2.625', fixture: 'values-calc-sum-order', dpr: 2.625, nodes: [['a', 'g'], ['b', 'h']] },
  { golden: 'constant-point-one-px-point-two-em-dpr-2.625', fixture: 'values-calc-width-vw-em', dpr: 2.625, nodes: [['a', 'a'], ['b', 'b'], ['c', 'c']] },
  { golden: 'divide-inverse-dpr-1', fixture: 'values-calc-divide', dpr: 1, nodes: [['b', 'b'], ['e', 'e']] },
  { golden: 'percent-order-dpr-1', fixture: 'values-calc-percent-order', dpr: 1, nodes: [['a', 'a'], ['p', 'b']] },
  { golden: 'viewport-r6-400x300-dpr-2.625', fixture: 'values-viewport-units', dpr: 2.625, nodes: [['m', 'c']] },
  { golden: 'em-leaf-fractional-dpr-3', fixture: 'values-calc-em-fractional', dpr: 3, nodes: [['a', 'a'], ['b', 'b']] },
  { golden: 'clamp-min-wins-dpr-1', fixture: 'values-clamp-min-wins', dpr: 1, nodes: [['a', 'a']] },
  { golden: 'nonneg-clamp-dpr-1', fixture: 'values-calc-nonneg-clamp', dpr: 1, nodes: [['p', 'p'], ['k', 'k']] },
  { golden: 'min-height-indefinite-basis-zero-dpr-1', fixture: 'values-calc-min-max-height-indefinite', dpr: 1, nodes: [['b', 'b']] },
  { golden: 'intrinsic-basis-zero-dpr-1', fixture: 'values-calc-intrinsic', dpr: 1, nodes: [['k', 'k']] },
];

/** Goldens with no Chrome capture: viewports other than 400x300 are engine vectors only (spec §3 item 5), and non-finite values have no fixture. */
const ENGINE_ONLY = ['viewport-r6-393x851-dpr-2.625', 'viewport-320x568-dpr-2', 'viewport-vmin-vmax-flip-844x390-dpr-3', 'nan-infinity-dpr-1'];

describe('the calc goldens agree with Chrome where a values fixture holds the same element', () => {
  it('every golden is either proven against a capture here or named engine-only', () => {
    const all = [...GOLDEN_CHROME.map((g) => g.golden), ...ENGINE_ONLY].sort();
    const named = readFileSync(repoPath('packages/layout/test/calc.test.ts'), 'utf8').match(/goldens: \[[^\]]*\]/g) ?? [];
    const files = named.flatMap((m) => [...m.matchAll(/'([^']+)'/g)].map((x) => x[1] as string)).sort();
    expect(all).toEqual(files);
  });
  for (const g of GOLDEN_CHROME) {
    it(`${g.golden} = ${g.fixture} @${g.dpr}`, () => {
      const golden = JSON.parse(readFileSync(repoPath(`packages/layout/vectors/calc/${g.golden}.json`), 'utf8')) as { output: LayoutRect[] };
      const f = spec(g.fixture);
      const c = casesOf(f, fixtureInput(f))[0] as ParityCase;
      const cap = committed(c, g.dpr);
      for (const [mine, theirs] of g.nodes) {
        const r = golden.output.find((b) => b.id === mine) as LayoutRect;
        const n = cap.nodes.find((x) => x.id === theirs);
        if (n === undefined) throw new Error(`${theirs} not captured`);
        // Chrome reports CSS px; the golden holds zoomed LU (1/64 device px), compared as the DPR lane compares (compare.ts).
        expect([exactInZoomedLu(n.width, r.width, g.dpr), exactInZoomedLu(n.height, r.height, g.dpr)], `${mine} vs ${theirs}: chrome ${n.width}x${n.height}, golden ${r.width}x${r.height} LU`).toEqual([true, true]);
      }
    });
  }
});

/** Blink's number serialization: six significant digits, without trailing zeros. */
const blinkNumber = (x: number): string => String(Number(x.toPrecision(6)));

const COMPUTED_PROPERTIES = [['minWidth', 'min-width'], ['maxWidth', 'max-width'], ['minHeight', 'min-height'], ['maxHeight', 'max-height'], ['flexBasis', 'flex-basis']] as const;

function boxes(b: LayoutBox, out: Map<string, LayoutBox> = new Map()): Map<string, LayoutBox> {
  out.set(b.id, b);
  for (const c of b.children) if (c.kind === 'box') boxes(c, out);
  return out;
}

describe('getComputedStyle serializes the calculation css/math.ts rebuilds from the resolved engine value', () => {
  it('min-width, max-width, min-height, max-height and flex-basis calculations of every values fixture, in both directions', () => {
    let compared = 0;
    for (const f of LAYOUT) {
      for (const c of casesOf(f, fixtureInput(f))) {
        const compiled = compileFixture(f, NO_FAULTS, 'enforce', c.environment.direction).compiled;
        const p = iosLayoutProjection(compiled, c.environment, c.assignment);
        if (p.kind !== 'ready') throw new Error(p.reason);
        const authored = boxes(p.input.root);
        const resolved = boxes((zoomInput(p.input as LayoutInput, NO_ENGINE_FAULTS)).root);
        const cap = committed(c, 1);
        for (const [id, box] of authored) {
          const n = cap.nodes.find((x) => x.id === id);
          if (n === undefined || n.computed === null) continue;
          for (const [field, property] of COMPUTED_PROPERTIES) {
            if (box.style[field].kind !== 'calc') continue;
            const v = (resolved.get(id) as LayoutBox).style[field];
            const mine = v.kind === 'calc' ? serializeMath(computedMathNode(v.expr as CalcExpr), blinkNumber) : v.kind === 'px' ? `${blinkNumber(v.value)}px` : v.kind === 'percent' ? `${blinkNumber(v.value)}%` : v.kind;
            expect(mine, `${c.id} ${id} ${property}`).toBe(String(n.computed[property]));
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(12);
  });
});

describe('DPR platform rules (platform-rules.ts dprPlatformRules): R6', () => {
  it('holds R6 only, measured on the reference platform and citing Blink at 145.0.7632.6', () => {
    expect(dprPlatformRules.map((r) => [r.id, r.platform, r.fault])).toEqual([['viewport-device-ceil', 'darwin-arm64', 'viewportUnitsUnceiled']]);
    for (const r of dprPlatformRules) expect(r.source).toMatch(/third_party\/blink\/\S+\.(cc|h)\b.*145\.0\.7632\.6/);
  });
  for (const r of dprPlatformRules) {
    it(`${r.id}: planted fault ${r.fault} makes every registered node non-exact at its DPR, in both directions, and every node is exact with it off`, () => {
      for (const fixture of [...new Set(r.nodes.map((n) => n.fixture))]) {
        const f = spec(fixture);
        for (const c of casesOf(f, fixtureInput(f))) {
          const compiled = compileFixture(f, NO_FAULTS, 'enforce', c.environment.direction).compiled;
          for (const dpr of [...new Set(r.nodes.filter((n) => n.fixture === fixture).map((n) => n.dpr))]) {
            const on = runDprCase(c, compiled, dpr, committed(c, dpr), { ...NO_ENGINE_FAULTS, [r.fault]: true });
            const off = runDprCase(c, compiled, dpr, committed(c, dpr));
            for (const n of r.nodes.filter((x) => x.fixture === fixture && x.dpr === dpr)) {
              expect(on.comparison?.nodes.find((x) => x.id === n.node)?.exactLu, `${c.id} ${n.node} @${dpr} with ${r.fault}`).toBe(false);
              expect(off.comparison?.nodes.find((x) => x.id === n.node)?.exactLu, `${c.id} ${n.node} @${dpr}`).toBe(true);
            }
            // At DPR 1 both readings agree: the rule cannot be seen there.
            expect(runDprCase(c, compiled, 1, committed(c, 1), { ...NO_ENGINE_FAULTS, [r.fault]: true }).status, c.id).toBe('pass');
          }
        }
      }
    });
  }
});
