// ARAT (notes/ARAT-fraction-spec.md): the fraction fixtures of the sizing group against the committed Chrome 145 captures, without
// a live browser. Every case is exact at 1/64 px at DPR 1, 2, 3 and 2.625 in both directions, and each planted ratio fault makes
// its named nodes non-exact in both directions while the fixture passes with it off.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import type { WebCapture } from '../src/capture.ts';
import type { ParityCase } from '../src/cases.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { expectedPath } from '../src/committed.ts';
import { committedDprCapture, runDprCase } from '../src/dpr.ts';
import { FIXTURES } from '../src/fixtures.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { compileFixture } from '../src/pipeline.ts';

const IDS = ['sizing-ratio-fraction-block', 'sizing-ratio-fraction-flex', 'sizing-ratio-fraction-grid', 'sizing-ratio-fraction-abspos', 'sizing-ratio-fraction-edge', 'sizing-ratio-shop'];
const DPRS = [1, 2, 3, 2.625];
const spec = (id: string): FixtureSpec => {
  const f = FIXTURES.find((x) => x.id === id);
  if (f === undefined) throw new Error(`${id} is not registered`);
  return f;
};
const committed = (c: ParityCase, dpr: number): WebCapture => (dpr === 1 ? (JSON.parse(readFileSync(expectedPath(c.id), 'utf8')) as WebCapture) : committedDprCapture(c.id, dpr));

describe('the ARAT fixtures are exact at 1/64 px at every DPR against the committed captures', () => {
  for (const id of IDS) {
    it(id, () => {
      const f = spec(id);
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

// Each fault's named nodes, at DPR 1. ratioExactSpec is the Chrome deviation aspect-ratio-continued-fraction (parity.test.ts M2).
const PLANTED: readonly { readonly fault: keyof EngineFaults; readonly fixture: string; readonly nodes: readonly string[] }[] = [
  // 1 / 0.0000005 is auto in Chrome (gfx::SizeF zeroes the part); kept, it widens the 40px-high box, and moves the replaced <img>.
  { fault: 'ratioNoTrivialClamp', fixture: 'sizing-ratio-fraction-edge', nodes: ['e1', 'i'] },
  // 1.1875626880641925: the continued fraction in double gives 1184 / 997, not 1165 / 981.
  { fault: 'ratioDoubleFraction', fixture: 'sizing-ratio-fraction-abspos', nodes: ['d1', 'd2', 'd3'] },
  // LayoutUnit(part) alone: 3 / 3.4 as 192 / 217 and 16 / 9.1 as 1024 / 582, in block flow, flex, grid and absolute positioning.
  { fault: 'ratioTruncatedParts', fixture: 'sizing-ratio-fraction-block', nodes: ['a1', 'b1', 'a2', 'b2'] },
  { fault: 'ratioTruncatedParts', fixture: 'sizing-ratio-fraction-flex', nodes: ['a1x', 'b1x', 'c1x', 'a2x', 'b2x', 'c2x'] },
  { fault: 'ratioTruncatedParts', fixture: 'sizing-ratio-fraction-grid', nodes: ['c21a', 'c22a', 'c31a', 'c32a'] },
  { fault: 'ratioTruncatedParts', fixture: 'sizing-ratio-fraction-abspos', nodes: ['t1', 't2', 't3'] },
  // The golden ratio stops at 34 / 21 after 8 steps, not 1597 / 987.
  { fault: 'ratioEightSteps', fixture: 'sizing-ratio-fraction-abspos', nodes: ['d5'] },
  { fault: 'ratioEightSteps', fixture: 'sizing-ratio-fraction-flex', nodes: ['a3x', 'b3x', 'c3x'] },
  // 3 / 3.4 at a 173.5px content-box width: Chrome truncates to 196.625px; rounding gives 196.640625px.
  { fault: 'ratioRoundedMulDiv', fixture: 'sizing-ratio-fraction-abspos', nodes: ['t4'] },
];

describe('planted ratio faults each make their named nodes non-exact (ARAT)', () => {
  for (const p of PLANTED) {
    it(`${p.fault} on ${p.fixture}: ${p.nodes.join(', ')}, in both directions; the fixture passes with it off`, () => {
      const f = spec(p.fixture);
      for (const c of casesOf(f, fixtureInput(f))) {
        const compiled = compileFixture(f, NO_FAULTS, 'enforce', c.environment.direction).compiled;
        const o = runDprCase(c, compiled, 1, committed(c, 1), { ...NO_ENGINE_FAULTS, [p.fault]: true });
        const inexact = (o.comparison?.nodes ?? []).filter((n) => n.dragon !== null && !n.exactLu).map((n) => n.id);
        for (const id of p.nodes) expect(inexact, `${c.id}: ${id}`).toContain(id);
        expect(runDprCase(c, compiled, 1, committed(c, 1)).status, c.id).toBe('pass');
      }
    });
  }
  it('names every ratio fault but the deviation fault', () => {
    expect([...new Set(PLANTED.map((p) => p.fault))].sort()).toEqual(['ratioDoubleFraction', 'ratioEightSteps', 'ratioNoTrivialClamp', 'ratioRoundedMulDiv', 'ratioTruncatedParts']);
  });
});
