// TXT-BREAK-2: word-break: break-all and keep-all over the Latin set (inline.ts breakAllOpportunities and latinOpportunities),
// against Chrome 145's own opportunities (fixtures/linebreak/chrome145-break-all.json, captured by capture/chrome-break-all.mjs):
// every ordered pair under break-all, and generated runs under break-all and keep-all.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS } from '../src/index.ts';
import type { EngineFaults, LayoutBox, TextLeaf } from '../src/index.ts';
import { breakAllOpportunities, latinOpportunities } from '../src/inline.ts';
import { NO_LINE_BREAK_FAULTS } from '../src/linebreak.ts';
import { box, neutralEnvironment, px, text } from './helpers.ts';

type Capture = { readonly chrome: string; readonly set: readonly number[]; readonly breakAllPairs: string; readonly runs: readonly { readonly text: string; readonly breakAll: readonly number[]; readonly keepAll: readonly number[] }[] };
const capture = JSON.parse(readFileSync(new URL('fixtures/linebreak/chrome145-break-all.json', import.meta.url), 'utf8')) as Capture;
const box0 = box('b', {});
const cpsOf = (t: string): number[] => [...t].map((ch) => ch.codePointAt(0) as number);

/** breakAllOpportunities, or null where the engine refuses the run. */
function breakAll(cps: readonly number[]): number[] | null {
  try {
    return breakAllOpportunities(box0, cps, true);
  } catch (e) {
    if (e instanceof Error && /word-break/.test(e.message)) return null;
    throw e;
  }
}

describe('word-break: break-all', () => {
  it('is Chrome 145.0.7632.6 on every pair of the Latin set, but the refused ones', () => {
    expect(capture.chrome).toBe('145.0.7632.6');
    const n = capture.set.length;
    const wrong: string[] = [];
    let refused = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const pair = [capture.set[i] as number, capture.set[j] as number];
        const got = breakAll(pair);
        if (got === null) {
          refused++;
          continue;
        }
        if ((got.length === 1) !== (capture.breakAllPairs[i * n + j] === '1')) wrong.push(pair.map((c) => c.toString(16)).join(' '));
      }
    }
    expect(wrong).toEqual([]);
    // U+00AD with every code point.
    expect(refused).toBe(2 * n - 1);
  });

  it('is Chrome on the generated runs, and refuses only those with U+00AD', () => {
    const wrong: string[] = [];
    let refused = 0;
    for (const r of capture.runs) {
      const got = breakAll(cpsOf(r.text));
      if (got === null) refused++;
      else if (JSON.stringify(got) !== JSON.stringify(r.breakAll)) wrong.push(`${JSON.stringify(r.text)}: Chrome ${JSON.stringify(r.breakAll)}, Dragon ${JSON.stringify(got)}`);
    }
    expect(wrong).toEqual([]);
    expect(refused).toBe(capture.runs.filter((r) => r.text.includes('\u00ad')).length);
  });

  it('refuses U+00AD, breaks after a hyphen-minus before a Latin-1 letter only where no break precedes it, and has none under nowrap', () => {
    expect(() => breakAllOpportunities(box0, [0x41, 0xad, 0x42], true)).toThrow(/soft hyphen/);
    expect(breakAllOpportunities(box0, [0x41, 0x2d, 0xe9], true)).toEqual([1]);
    expect(breakAllOpportunities(box0, [0x24, 0x2d, 0xe9], true)).toEqual([2]);
    expect(() => breakAllOpportunities(box0, [0x41, 0x3b1], true)).toThrow(/outside the code points/);
    expect(breakAllOpportunities(box0, cpsOf('AB CD'), false)).toEqual([]);
    expect(breakAllOpportunities(box0, cpsOf('AB-CD'), true)).toEqual([1, 2, 3, 4]);
  });
});

describe('word-break: keep-all', () => {
  it('breaks as normal over the Latin set, as Chrome does on every generated run', () => {
    const wrong = capture.runs.filter((r) => JSON.stringify(latinOpportunities(box0, cpsOf(r.text), true, NO_LINE_BREAK_FAULTS)) !== JSON.stringify(r.keepAll)).map((r) => r.text);
    expect(wrong).toEqual([]);
  });
});

describe('the layout', () => {
  const G = 640;
  const lines = (t: Partial<TextLeaf>, faults: EngineFaults = NO_ENGINE_FAULTS): number[] => {
    const root: LayoutBox = box('root', {}, [box('c', { width: px(35) }, [text('t', 'XXXXXXXX XX', t)])]);
    const r = layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer, faults);
    if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
    const abs = absoluteRects(r.boxes);
    const out: number[] = [];
    for (let j = 0; abs.has(`t:line${j}`); j++) out.push((abs.get(`t:line${j}`) as { width: number }).width / G);
    return out;
  };
  it('breaks a long word between letters under break-all, and planted fault breakAllIgnored lays it out as normal', () => {
    expect(lines({ wordBreak: 'break-all' })).toEqual([3, 3, 2, 2]);
    expect(lines({ wordBreak: 'keep-all' })).toEqual([8, 2]);
    expect(lines({ wordBreak: 'break-all' }, { ...NO_ENGINE_FAULTS, breakAllIgnored: true })).toEqual([8, 2]);
  });
});
