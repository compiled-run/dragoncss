// TXT1a-1 R4: latinOpportunities keeps linebreak-data.ts out of the translated engine for real-font Latin text. It must equal
// lineBreakOpportunitiesWith (linebreak.ts) on every code point it covers: each class against Unicode 16.0.0, every pair, every
// triple of a representative set, and generated runs, with and without each linebreak.ts plant.
import { describe, expect, it } from 'vitest';
import { latinBreakClass, latinOpportunities } from '../src/inline.ts';
import { lineBreakClass, lineBreakOpportunitiesWith } from '../src/linebreak.ts';
import { LB_AI, LB_AL, LB_B2, LB_BA, LB_BB, LB_CL, LB_CP, LB_EX, LB_GL, LB_HY, LB_IN, LB_IS, LB_NU, LB_OP, LB_PO, LB_PR, LB_QU, LB_QU_PF, LB_QU_PI, LB_SP, LB_SY, LB_ZW } from '../src/linebreak-data.ts';
import { box, text } from './helpers.ts';

const covered: number[] = [];
for (let cp = 0x20; cp <= 0x7e; cp++) covered.push(cp);
for (let cp = 0xa0; cp <= 0xff; cp++) covered.push(cp);
covered.push(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x200b);

// latinBreakClass's local codes, in its order, as the UCD classes (AI resolves to AL by LB1).
const UCD = [LB_AL, LB_SP, LB_EX, LB_QU, LB_QU_PI, LB_QU_PF, LB_PR, LB_PO, LB_OP, LB_CP, LB_CL, LB_IS, LB_HY, LB_SY, LB_NU, LB_BA, LB_BB, LB_GL, LB_B2, LB_IN, LB_ZW];
const style = { whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', hyphens: 'manual', languageRules: 'cj-ideographic' } as const;
const faultSets = [{ breakAfterSolidus: false, noHyphenDigitBreak: false }, { breakAfterSolidus: true, noHyphenDigitBreak: false }, { breakAfterSolidus: false, noHyphenDigitBreak: true }];
const box0 = box('b', {}, [text('t', 'X')]);
const reference = (run: readonly number[], faults: (typeof faultSets)[number]): number[] => {
  const r = lineBreakOpportunitiesWith(run, style, faults);
  if (!r.ok) throw new Error(r.reason);
  return r.opportunities.map((o) => o.position);
};

describe('latinOpportunities equals lineBreakOpportunitiesWith on the Latin code points', () => {
  it('gives each covered code point its Unicode 16.0.0 class, and refuses the rest', () => {
    for (const cp of covered) {
      const ucd = lineBreakClass(cp);
      expect(UCD[latinBreakClass(cp)], cp.toString(16)).toBe(ucd === LB_AI ? LB_AL : ucd);
    }
    for (const cp of [0x7f, 0x9f, 0x100, 0x2015, 0x3001, 0x30fc, 0x1f600]) expect(latinBreakClass(cp), cp.toString(16)).toBe(-1);
    expect(() => latinOpportunities(box0, [0x41, 0x3b1], true, faultSets[0] as (typeof faultSets)[number])).toThrow(/outside the code points/);
  });

  it('every pair of covered code points under each fault set', () => {
    let compared = 0;
    for (const faults of faultSets) {
      for (const a of covered) {
        for (const b of covered) {
          const got = latinOpportunities(box0, [a, b], true, faults);
          const want = reference([a, b], faults);
          if (got.length !== want.length || got.some((x, i) => x !== want[i])) expect(got, `${a.toString(16)} ${b.toString(16)}`).toEqual(want);
          compared++;
        }
      }
    }
    expect(compared).toBe(3 * covered.length ** 2);
  });

  it('every triple of one code point per class and the code points with rules of their own', () => {
    const reps = [0x41, 0x20, 0x21, 0x22, 0x2018, 0x2019, 0x24, 0x25, 0x28, 0x29, 0x7d, 0x2c, 0x2d, 0x2f, 0x30, 0x7c, 0xb4, 0xa0, 0x2014, 0x2026, 0x200b, 0x2010, 0xad, 0x3f, 0x2e, 0xe4, 0xd7, 0x201c, 0x201d, 0x2013];
    let compared = 0;
    for (const faults of faultSets) {
      for (const a of reps) for (const b of reps) for (const c of reps) {
        const run = [a, b, c];
        const got = latinOpportunities(box0, run, true, faults);
        const want = reference(run, faults);
        if (got.length !== want.length || got.some((x, i) => x !== want[i])) expect(got, run.map((x) => x.toString(16)).join(' ')).toEqual(want);
        compared++;
      }
    }
    expect(compared).toBe(3 * reps.length ** 3);
  });

  it('20000 generated runs of 4 to 32 covered code points, and nowrap gives none', () => {
    let seed = 20261001;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let k = 0; k < 20000; k++) {
      const n = 4 + (next() % 29);
      const run: number[] = [];
      for (let i = 0; i < n; i++) {
        const cp = covered[next() % covered.length] as number;
        // Collapsed text never holds two spaces in a row.
        if (cp === 0x20 && run[run.length - 1] === 0x20) continue;
        run.push(cp);
      }
      const faults = faultSets[k % 3] as (typeof faultSets)[number];
      const got = latinOpportunities(box0, run, true, faults);
      const want = reference(run, faults);
      if (got.length !== want.length || got.some((x, i) => x !== want[i])) expect(got, run.map((x) => x.toString(16)).join(' ')).toEqual(want);
      expect(latinOpportunities(box0, run, false, faults)).toEqual([]);
    }
  });
});
