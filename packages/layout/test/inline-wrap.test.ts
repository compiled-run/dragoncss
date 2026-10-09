// TXT2-a engine: overflow-wrap and word-break: break-word over Ahem (Blink LineBreaker's anywhere-if-overflow path,
// line_breaker.cc:4008-4250, :4476-4560). The text-wrap-break fixtures prove the same against Chrome at every DPR.
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS } from '../src/index.ts';
import type { EngineFaults, InlineChild, LayoutBox, LayoutInput, TextLeaf } from '../src/index.ts';
import { box, neutralEnvironment, px, text } from './helpers.ts';

const G = 640; // one 10px Ahem glyph in LU
const input = (root: LayoutBox): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
const leaf = (id: string, value: string, over: Partial<TextLeaf>): TextLeaf => text(id, value, over);

/** The line rects (x, width) of leaf t in a 'width'-px block, or the refusal code. */
function lines(widthPx: number, kids: InlineChild[], t: string, faults: EngineFaults = NO_ENGINE_FAULTS): number[][] | string {
  const r = layoutWithFaults(input(box('root', {}, [box('c', { width: px(widthPx) }, kids)])), ahemMeasurer, faults);
  if (r.kind !== 'ok') return r.unsupported.code;
  const abs = absoluteRects(r.boxes);
  const out: number[][] = [];
  for (let j = 0; abs.has(`${t}:line${j}`); j++) {
    const x = abs.get(`${t}:line${j}`);
    if (x !== undefined) out.push([x.x, x.width]);
  }
  return out;
}

describe('anywhere-if-overflow', () => {
  for (const over of [{ overflowWrap: 'anywhere' }, { overflowWrap: 'break-word' }, { wordBreak: 'break-word' }] as const) {
    it(`${JSON.stringify(over)}: an overflowing first word breaks at the last grapheme that fits`, () => {
      expect(lines(45, [leaf('t', 'aaaaaaaaaa bb', over)], 't')).toEqual([[0, 4 * G], [0, 4 * G], [0, 2 * G], [0, 2 * G]]);
    });
  }
  it('a word\'s last grapheme keeps its trailing space on its line: no blank line before the next word (HandleTrailingSpaces)', () => {
    for (const over of [{ overflowWrap: 'anywhere' }, { overflowWrap: 'break-word' }, { wordBreak: 'break-word' }] as const) {
      const r = layoutWithFaults(input(box('root', {}, [box('c', { width: px(5) }, [leaf('t', 'ab cd', over)])])), ahemMeasurer, NO_ENGINE_FAULTS);
      if (r.kind !== 'ok') throw new Error(r.unsupported.code);
      const abs = absoluteRects(r.boxes);
      const ys: number[] = [];
      for (let j = 0; abs.has(`t:line${j}`); j++) ys.push((abs.get(`t:line${j}`) as { y: number }).y);
      expect(ys, JSON.stringify(over)).toEqual([0, 10, 20, 30].map((y) => y * 64));
      expect((abs.get('c') as { height: number }).height, JSON.stringify(over)).toBe(40 * 64);
    }
  });
  it('normal lets the word overflow', () => {
    expect(lines(45, [leaf('t', 'aaaaaaaaaa bb', {})], 't')).toEqual([[0, 10 * G], [0, 2 * G]]);
  });
  it('an earlier opportunity that fits wins over an emergency break; the planted fault breaks the word on the first line', () => {
    expect(lines(60, [leaf('t', 'aa bbbbbbbbbb cc', { overflowWrap: 'anywhere' })], 't')).toEqual([[0, 2 * G], [0, 6 * G], [0, 4 * G], [0, 2 * G]]);
    expect(lines(60, [leaf('t', 'aa bbbbbbbbbb cc', { overflowWrap: 'anywhere' })], 't', { ...NO_ENGINE_FAULTS, emergencyBreakBeforeOpportunity: true })).not.toEqual([[0, 2 * G], [0, 6 * G], [0, 4 * G], [0, 2 * G]]);
    expect(lines(60, [leaf('t', 'aa bbbbbbbbbb cc', { overflowWrap: 'anywhere' })], 't', { ...NO_ENGINE_FAULTS, breakAnywhereAlways: true })).not.toEqual([[0, 2 * G], [0, 6 * G], [0, 4 * G], [0, 2 * G]]);
  });
  it('nowrap keeps the word whole', () => {
    expect(lines(45, [leaf('t', 'aaaaaaaaaa bb', { overflowWrap: 'anywhere', textWrapMode: 'nowrap' })], 't')).toEqual([[0, 13 * G]]);
  });
  it('wordBreakBreakWordIgnored lays word-break: break-word out as normal', () => {
    expect(lines(45, [leaf('t', 'aaaaaaaaaa bb', { wordBreak: 'break-word' })], 't', { ...NO_ENGINE_FAULTS, wordBreakBreakWordIgnored: true })).toEqual([[0, 10 * G], [0, 2 * G]]);
  });
});

describe('min-content (a flex item\'s automatic minimum)', () => {
  const item = (over: Partial<TextLeaf>): LayoutBox => box('i', {}, [leaf('t', 'aaaaaaaa', over)]);
  const widthOf = (over: Partial<TextLeaf>, faults: EngineFaults = NO_ENGINE_FAULTS): number => {
    const r = layoutWithFaults(input(box('root', {}, [box('row', { display: 'flex', width: px(30) }, [item(over)])])), ahemMeasurer, faults);
    if (r.kind !== 'ok') throw new Error(r.unsupported.code);
    return (absoluteRects(r.boxes).get('i') as { width: number }).width;
  };
  it('anywhere and word-break: break-word shrink it to one grapheme; break-word and normal do not', () => {
    expect(widthOf({ overflowWrap: 'anywhere' })).toBe(30 * 64);
    expect(widthOf({ wordBreak: 'break-word' })).toBe(30 * 64);
    expect(widthOf({ overflowWrap: 'break-word' })).toBe(8 * G);
    expect(widthOf({})).toBe(8 * G);
  });
  it('the min-content plants move it', () => {
    expect(widthOf({ overflowWrap: 'anywhere' }, { ...NO_ENGINE_FAULTS, anywhereMinContentIgnored: true })).toBe(8 * G);
    expect(widthOf({ overflowWrap: 'break-word' }, { ...NO_ENGINE_FAULTS, breakWordShrinksMinContent: true })).toBe(30 * 64);
  });
});

describe('refusals', () => {
  it('word-break break-all, keep-all and auto-phrase are word-break (TXT2-d); mixed values in one context are refused', () => {
    for (const wb of ['break-all', 'keep-all', 'auto-phrase'] as const) expect(lines(45, [leaf('t', 'aa', { wordBreak: wb })], 't')).toBe('word-break');
    expect(lines(45, [leaf('t', 'aa ', {}), leaf('u', 'bb', { overflowWrap: 'anywhere' })], 't')).toBe('mixed-text-wrap-mode');
  });
});
