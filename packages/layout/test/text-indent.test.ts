// TXT2-h: text-indent in the engine (css-text-3 §8.1, Blink LineBreaker::ComputeTextIndent). Chrome agreement is proven by the
// text-indent fixture group (packages/parity); these cases pin the port's decisions in 10px Ahem and catch the four engine plants.
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutBox, LayoutRect, LayoutResult, LayoutStyle } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS } from '../src/index.ts';
import { box, br, neutralEnvironment, pct, px, text } from './helpers.ts';

const G = 640;

function run(root: LayoutBox, faults: EngineFaults = NO_ENGINE_FAULTS): LayoutResult {
  return layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer, faults);
}

function rects(r: LayoutResult): Map<string, LayoutRect> {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return absoluteRects(r.boxes);
}

/** [x, width] of each line fragment of a leaf, absolute, in LU. */
function frags(r: LayoutResult, leaf: string): number[][] {
  const abs = rects(r);
  const out: number[][] = [];
  for (let j = 0; abs.has(`${leaf}:line${j}`); j++) {
    const l = abs.get(`${leaf}:line${j}`) as LayoutRect;
    out.push([l.x, l.width]);
  }
  return out;
}

const indented = (style: Partial<LayoutStyle>, ...kids: LayoutBox['children'][number][]): LayoutBox => box('root', {}, [box('a', { width: px(100), ...style }, kids)]);

describe('TXT2-h: text-indent on the first formatted line', () => {
  it('starts the first line at the indent and fits its text in what is left; later lines start at 0', () => {
    const r = run(indented({ textIndent: px(25) }, text('t', 'XX XX XX XX XX')));
    expect(frags(r, 't')).toEqual([[25 * 64, 5 * G], [0, 8 * G]]);
  });

  it('a negative indent starts the line left of the content box and lets more text fit', () => {
    const r = run(indented({ textIndent: px(-15) }, text('t', 'XX XX XX XX XX')));
    expect(frags(r, 't')).toEqual([[-15 * 64, 11 * G], [0, 2 * G]]);
  });

  it('a percentage is of the available width', () => {
    expect(frags(run(indented({ textIndent: pct(10) }, text('t', 'XX'))), 't')).toEqual([[10 * 64, 2 * G]]);
  });

  it('a line after a <br> is not indented (planted fault indentAfterBr indents it)', () => {
    const root = indented({ textIndent: px(25) }, text('t0', 'XX'), br('b'), text('t1', 'XX'));
    expect(frags(run(root), 't1')).toEqual([[0, 2 * G]]);
    expect(frags(run(root, { ...NO_ENGINE_FAULTS, indentAfterBr: true }), 't1')).toEqual([[25 * 64, 2 * G]]);
  });

  it('a soft-wrapped line is not indented (planted fault indentEveryLine indents it)', () => {
    const root = indented({ textIndent: px(25) }, text('t', 'XX XX XX XX XX'));
    expect(frags(run(root, { ...NO_ENGINE_FAULTS, indentEveryLine: true }), 't')[1]).toEqual([25 * 64, 5 * G]);
  });

  it('in rtl the indent is on the right (planted fault indentRtlFromLeft puts it on the left)', () => {
    const root = indented({ textIndent: px(25), direction: 'rtl' }, text('t', 'XX'));
    expect(frags(run(root), 't')).toEqual([[55 * 64, 2 * G]]);
    expect(frags(run(root, { ...NO_ENGINE_FAULTS, indentRtlFromLeft: true }), 't')).toEqual([[80 * 64, 2 * G]]);
  });

  it('text-align center centres the line with its indent', () => {
    expect(frags(run(indented({ textIndent: px(20), textAlign: 'center' }, text('t', 'XX'))), 't')).toEqual([[(20 + 30) * 64, 2 * G]]);
  });
});

describe('TXT2-h: text-indent in intrinsic sizes', () => {
  const shrink = (indent: LayoutStyle['textIndent']): LayoutBox => box('root', {}, [box('a', { width: { kind: 'max-content' }, textIndent: indent }, [text('t', 'XXXX')])]);
  it('a length adds to the first line; a percentage counts as 0 (planted fault indentPercentInIntrinsic counts it)', () => {
    expect(rects(run(shrink(px(20)))).get('a')?.width).toBe(60 * 64);
    expect(rects(run(shrink(pct(10)))).get('a')?.width).toBe(40 * 64);
    expect(rects(run(shrink(pct(10)), { ...NO_ENGINE_FAULTS, indentPercentInIntrinsic: true })).get('a')?.width).toBe(44 * 64);
  });
});

describe('TXT2-h: what no Chrome case proves yet is refused', () => {
  const code = (style: Partial<LayoutStyle>): string => {
    const r = run(indented({ textIndent: px(10), ...style }, text('t', 'XX XX')));
    return r.kind === 'ok' ? 'ok' : r.unsupported.code;
  };
  it('beside justify, an ellipsis or preserved white space', () => {
    expect(code({})).toBe('ok');
    expect(code({ textAlign: 'justify' })).toBe('text-indent');
    expect(code({ textOverflow: 'ellipsis', overflowX: 'hidden', overflowY: 'hidden' })).toBe('text-indent');
    const pre = run(box('root', {}, [box('a', { width: px(100), textIndent: px(10) }, [text('t', 'XX  XX', { whiteSpaceCollapse: 'preserve' })])]));
    expect(pre.kind === 'unsupported' && pre.unsupported.code).toBe('text-indent');
  });
});
