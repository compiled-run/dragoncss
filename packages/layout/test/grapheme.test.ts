// UAX #29 extended grapheme clusters (grapheme.ts) against Chrome 145.0.7632.6's own segmenter: the committed
// Intl.Segmenter('en', { granularity: 'grapheme' }) capture over GraphemeBreakTest-16.0.0 and hand-picked text
// (test/fixtures/grapheme/capture.ts). linebreak:conformance runs the rules over GraphemeBreakTest itself.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { graphemeBreaks, graphemeBreaksWith } from '../src/grapheme.ts';

type Capture = { readonly chrome: string; readonly cases: readonly { readonly cps: readonly number[]; readonly starts: readonly number[] }[] };
const capture = JSON.parse(readFileSync(new URL('./fixtures/grapheme/chrome-grapheme.json', import.meta.url), 'utf8')) as Capture;
const startsOf = (b: readonly boolean[]): number[] => b.flatMap((x, i) => (x ? [i] : []));

describe('grapheme clusters equal Chrome 145 Intl.Segmenter N/N', () => {
  it('on every captured case', () => {
    expect(capture.chrome).toBe('145.0.7632.6');
    expect(capture.cases.length).toBeGreaterThan(1100);
    const misses = capture.cases.filter((c) => JSON.stringify(startsOf(graphemeBreaks(c.cps))) !== JSON.stringify(c.starts));
    expect(misses).toEqual([]);
  });
  it('keeps e + U+0301 one cluster, and the planted code-point fault splits it', () => {
    expect(graphemeBreaks([0x65, 0x301, 0x62])).toEqual([true, false, true]);
    expect(graphemeBreaksWith([0x65, 0x301, 0x62], true)).toEqual([true, true, true]);
    const differ = capture.cases.filter((c) => JSON.stringify(startsOf(graphemeBreaksWith(c.cps, true))) !== JSON.stringify(c.starts));
    expect(differ.length).toBeGreaterThan(500);
  });
});
