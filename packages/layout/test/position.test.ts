import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS } from '../src/index.ts';
import type { AlignItems, EngineFaults, FlexDirection, FlexWrap, JustifyContent, LayoutBox, LayoutRect, LayoutResult, LayoutStyle } from '../src/index.ts';
import { anon, box, pct, px, text } from './helpers.ts';

// S4b positioning, pinned in raw LayoutUnits measured in Chrome 145.0.7632.6: probes /tmp/t037/p1-p10 (quoted in
// notes/T037-slice-4b.md) and the committed captures of the named fixtures. Trees mirror the probe markup.
const auto = { kind: 'auto' } as const;
const rel: Partial<LayoutStyle> = { position: 'relative' };
const absolute: Partial<LayoutStyle> = { position: 'absolute' };
const rtl: Partial<LayoutStyle> = { direction: 'rtl' };
const ltr: Partial<LayoutStyle> = { direction: 'ltr' };
const edges = (v: number, side: 'margin' | 'padding' | 'border') => {
  const k = side === 'border' ? ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'] : [`${side}Top`, `${side}Right`, `${side}Bottom`, `${side}Left`];
  return Object.fromEntries(k.map((n) => [n, px(v)])) as Partial<LayoutStyle>;
};
const margin = (t: number, r: number, b: number, l: number): Partial<LayoutStyle> => ({ marginTop: px(t), marginRight: px(r), marginBottom: px(b), marginLeft: px(l) });
const padding = (t: number, r: number, b: number, l: number): Partial<LayoutStyle> => ({ paddingTop: px(t), paddingRight: px(r), paddingBottom: px(b), paddingLeft: px(l) });

function run(body: LayoutBox[], over: { html?: Partial<LayoutStyle>; body?: Partial<LayoutStyle>; faults?: EngineFaults } = {}): Map<string, LayoutRect> {
  const root = box('html', over.html ?? {}, [box('body', over.body ?? {}, body)]);
  const r: LayoutResult = layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root }, ahemMeasurer, over.faults ?? NO_ENGINE_FAULTS);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return absoluteRects(r.boxes);
}
const at = (m: Map<string, LayoutRect>, id: string): number[] => {
  const r = m.get(id);
  if (r === undefined) throw new Error(`${id} was not laid out`);
  return [r.x, r.y, r.width, r.height];
};
const x = (m: Map<string, LayoutRect>, id: string): number => at(m, id)[0] as number;
const y = (m: Map<string, LayoutRect>, id: string): number => at(m, id)[1] as number;

describe('relative offsets (CSS2 §9.4.3, probe p1)', () => {
  const r = (id: string, s: Partial<LayoutStyle>) => box(id, { ...rel, height: px(10), width: px(50), ...s });
  const c = (id: string, s: Partial<LayoutStyle>, kids: LayoutBox[]) => box(id, { width: px(200), ...s }, kids);
  const m = run([
    c('c1', {}, [r('a', { left: px(10), right: px(20), top: px(5), bottom: px(7) }), box('a2', { height: px(10) })]),
    c('c2', rtl, [r('b', { left: px(10), right: px(20) }), box('b2', { height: px(10) })]),
    c('c3', {}, [r('d', { right: px(20), bottom: px(7) })]),
    c('c4', {}, [r('e', { left: pct(10), top: pct(10) })]),
    c('c5', { height: px(100) }, [r('f', { left: pct(10.3), top: pct(10), bottom: pct(20) })]),
    c('c6', { height: px(100) }, [r('g', { bottom: pct(10) })]),
    c('c7', {}, [r('h', { bottom: pct(10) })]),
    c('c8', rtl, [r('i', { left: px(10) }), r('i2', { right: px(10), ...ltr })]),
  ]);
  it('left wins over right in an ltr containing block and right wins in rtl; top wins over bottom; siblings keep their flow position', () => {
    expect([at(m, 'a').slice(0, 2), y(m, 'a2'), x(m, 'b'), at(m, 'd').slice(0, 2)]).toEqual([[640, 320], 640, 8320, [-1280, 2112]]);
  });
  it('one auto side is minus the other; the containing block direction decides, not the box own direction', () => {
    expect([x(m, 'i'), x(m, 'i2')]).toEqual([10240, 8960]);
  });
  it('percentages: left against the containing block width, top and bottom against a definite height, and auto against an auto height', () => {
    expect([at(m, 'e').slice(0, 2), at(m, 'f').slice(0, 2), y(m, 'g'), y(m, 'h')]).toEqual([[1280, 3200], [1318, 4480], 9600, 16640]);
  });
  it('relative offsets leave margin collapsing and the flow alone (fixture position-relative-flow), and relativeShiftsFlow breaks that', () => {
    const tree = [box('p', { marginTop: px(10) }, [box('q', { ...rel, top: px(3), marginTop: px(20), height: px(5) })]), box('s', { marginTop: px(4), height: px(2) })];
    expect([y(run(tree), 'body'), y(run(tree), 'q'), y(run(tree), 's')]).toEqual([1280, 1472, 1856]);
    expect(y(run(tree, { faults: { ...NO_ENGINE_FAULTS, relativeShiftsFlow: true } }), 's')).not.toBe(1856);
  });
  it('a relative flex item moves after alignment and never moves a baseline (probe p10)', () => {
    const f = box('g', { display: 'flex', alignItems: 'baseline' }, [
      box('g1', {}, [text('g1:t', 'A')]),
      box('g2', { display: 'flex' }, [box('g2a', { ...rel, top: px(7) }, [text('g2a:t', 'B', { font: { family: 'Ahem', size: 20 } })]), box('g2b', {}, [text('g2b:t', 'C')])]),
    ]);
    const mm = run([f]);
    expect([at(mm, 'g1').slice(0, 2), at(mm, 'g2').slice(0, 2), at(mm, 'g2a').slice(0, 2)]).toEqual([[0, 512], [640, 0], [640, 448]]);
    const h = run([box('h', { display: 'flex', width: px(100), ...rtl }, [box('h1', { ...rel, left: px(5), right: px(9), width: px(10), height: px(10) }), box('h2', { ...rel, left: px(5), width: px(10), height: px(10) })])]);
    expect([x(h, 'h1'), x(h, 'h2')]).toEqual([5184, 5440]);
  });
});

describe('containing blocks (CSS2 §10.1): the nearest positioned ancestor padding box, or the initial containing block (probes p3, p5)', () => {
  const cbStyle: Partial<LayoutStyle> = { ...rel, width: px(200), height: px(100), ...edges(3, 'border'), ...padding(5, 7, 9, 11), marginBottom: px(4) };
  const a = (id: string, s: Partial<LayoutStyle>) => box(id, { ...absolute, height: px(10), ...s });
  it('insets measure from the padding box; left and right with an auto width stretch', () => {
    const m = run([box('c1', cbStyle, [a('a1', { left: px(0), top: px(0), width: px(10) }), a('b1', { right: px(0), bottom: px(0), width: px(10) }), a('c1a', { left: px(10), right: px(20) }), a('d1', { left: px(10), right: px(20), width: px(50) })])]);
    expect([at(m, 'a1').slice(0, 2), at(m, 'b1').slice(0, 2), at(m, 'c1a').slice(0, 3), x(m, 'd1')]).toEqual([[192, 192], [13504, 6848], [832, 512, 12032], 832]);
    const faulty = run([box('c1', cbStyle, [a('a1', { left: px(0), top: px(0), width: px(10) })])], { faults: { ...NO_ENGINE_FAULTS, cbIgnoresPadding: true } });
    expect(at(faulty, 'a1').slice(0, 2)).not.toEqual([192, 192]);
  });
  it('without a positioned ancestor the containing block is the viewport, and nested absolute boxes are containing blocks', () => {
    const w = box('w', { ...margin(10, 10, 10, 10), ...padding(5, 5, 5, 5), height: px(30) }, [
      box('s', { height: px(4) }),
      a('a1', { width: px(20) }),
      a('a2', { right: px(0), bottom: px(0), width: px(20) }),
      a('a3', { left: pct(10), top: pct(10), width: pct(10) }),
    ]);
    const r = box('r', { ...rel, left: px(7), top: px(3), marginLeft: px(20), marginRight: px(20), height: px(20) }, [box('rin', { paddingLeft: px(6) }, [a('a4', { top: px(2), width: px(20) })])]);
    const n = box('n', { ...absolute, left: px(100), top: px(150), width: px(100), height: px(60), ...edges(2, 'border'), ...padding(4, 4, 4, 4) }, [
      box('nn', { height: px(5) }),
      a('a5', { right: px(0), width: px(20) }),
      a('a6', { left: px(0), bottom: px(0), width: px(20) }, ),
    ]);
    const nested = { ...n, children: [...n.children.slice(0, 2), box('a6', { ...absolute, left: px(0), bottom: px(0), width: px(20), height: px(10) }, [a('a6c', { left: px(3), top: px(3), width: px(5), height: px(5) })])] };
    const m = run([w, r, nested], { body: margin(8, 8, 8, 8) });
    expect([at(m, 'a1').slice(0, 2), at(m, 'a2').slice(0, 2), at(m, 'a3'), at(m, 'a4').slice(0, 2)]).toEqual([[1472, 1216], [24320, 18560], [2560, 1920, 2560, 640], [2624, 4160]]);
    expect([at(m, 'n'), at(m, 'a5').slice(0, 2), at(m, 'a6').slice(0, 2), at(m, 'a6c').slice(0, 2)]).toEqual([[6400, 9600, 7168, 4608], [12160, 10304], [6528, 13440], [6720, 13632]]);
  });
  it('the initial containing block takes the root direction (rtl probe)', () => {
    // The compiler writes the inherited direction on every box; the engine never inherits it.
    const m = run([box('w2', { ...padding(5, 5, 5, 5), ...rtl }, [a('b1', { width: px(20), ...rtl }), a('b2', { left: px(0), right: px(0), width: px(30), marginLeft: auto, marginRight: auto, ...rtl }), a('b3', { left: px(10), right: px(20), width: px(30), ...rtl })])], { html: rtl, body: rtl });
    expect([at(m, 'b1').slice(0, 2), x(m, 'b2'), x(m, 'b3')]).toEqual([[24000, 320], 11840, 22400]);
  });
  it('a scroll container is a containing block only when positioned', () => {
    const sc = (id: string, s: Partial<LayoutStyle>) => box(id, { overflowX: 'hidden', overflowY: 'hidden', width: px(100), height: px(50), ...padding(3, 3, 3, 3), ...edges(1, 'border'), ...s }, [box(`${id}i`, { height: px(10) }), a(`${id}a`, { top: px(40), left: px(90), width: px(20) }), a(`${id}b`, { width: px(20) })]);
    const m = run([sc('sc', {}), sc('sc2', rel)]);
    expect([at(m, 'sca').slice(0, 2), at(m, 'sc2a').slice(0, 2), at(m, 'sc2b').slice(0, 2)]).toEqual([[5760, 2560], [5824, 6336], [256, 4608]]);
  });
});

describe('static position in block flow (css-position-3 §4.1, probes p2 and p5)', () => {
  const cbStyle: Partial<LayoutStyle> = { ...rel, width: px(200), height: px(100), ...edges(3, 'border'), ...padding(5, 7, 9, 11), marginBottom: px(10) };
  const a = (id: string, s: Partial<LayoutStyle>) => box(id, { ...absolute, width: px(20), height: px(20), ...s });
  const m = run([
    box('cb1', cbStyle, [box('x1', { height: px(10), marginBottom: px(10) }), a('a1', margin(3, 0, 0, 4)), box('y1', { marginTop: px(20), height: px(10) })]),
    box('cb2', { ...cbStyle, ...rtl }, [box('x2', { height: px(10) }), a('a2', margin(3, 6, 0, 4))]),
    box('cb3', cbStyle, [box('p3', { ...rtl, paddingLeft: px(13), paddingRight: px(13) }, [a('a3', margin(0, 6, 0, 4))])]),
    box('cb4', { ...cbStyle, ...rtl }, [box('p4', { ...ltr, paddingLeft: px(13), paddingRight: px(13) }, [a('a4', margin(0, 6, 0, 4))])]),
  ]);
  it('at the flow position plus the pending margins, from the parent content start edge in the parent direction', () => {
    expect([at(m, 'a1').slice(0, 2), y(m, 'y1'), at(m, 'a2').slice(0, 2)]).toEqual([[1152, 1984], 2432, [12032, 9664]]);
  });
  it('the parent direction decides the edge, whatever the containing block direction; staticPosLtr breaks that', () => {
    expect([at(m, 'a3').slice(0, 2), x(m, 'a4')]).toEqual([[11200, 17152], 1984]);
    const faulty = run([box('cb2', { ...cbStyle, ...rtl }, [box('x2', { height: px(10) }), a('a2', margin(3, 6, 0, 4))])], { faults: { ...NO_ENGINE_FAULTS, staticPosLtr: true } });
    expect(x(faulty, 'a2')).not.toBe(12032);
  });
  it('before the parent block offset is fixed it is the content top; absolutely positioned boxes never stop collapsing', () => {
    const b = (id: string, s: Partial<LayoutStyle> = {}) => box(id, { ...absolute, width: px(20), height: px(10), ...s });
    const mm = run([
      box('top', { height: px(10) }),
      box('e1', { marginTop: px(10), marginBottom: px(10) }, [b('ea', { marginTop: px(3) })]),
      box('mid', { height: px(10) }),
      box('e2', { marginTop: px(20) }, [b('eb'), box('ec', { marginTop: px(15), height: px(5) })]),
      box('e3', { marginTop: px(5), borderTopWidth: px(1) }, [b('ed'), box('ee', { marginTop: px(15), height: px(5) })]),
      box('e4', {}, [box('ef', { marginBottom: px(7) }), b('eg'), box('eh', { marginTop: px(3), height: px(2) })]),
    ]);
    expect(['ea', 'mid', 'eb', 'ed', 'ee', 'eg', 'eh'].map((id) => y(mm, id))).toEqual([1472, 1280, 3200, 3904, 4864, 5632, 5632]);
  });
});
const STATIC_FLEX: { readonly [container: string]: { readonly justify: readonly (readonly [number, number])[]; readonly align: readonly (readonly [number, number])[] } } = {
  'row_nowrap_ltr': { justify: [[256,64],[256,64],[5056,64],[2656,64],[256,64],[2656,64],[2656,64],[256,64],[256,64],[5056,64],[256,64],[5056,64]], align: [[256,64],[256,64],[256,64],[256,2432],[256,1248],[256,64],[256,64],[256,2432],[256,64],[256,2432]] },
  'row_nowrap_rtl': { justify: [[5056,64],[5056,64],[256,64],[2656,64],[5056,64],[2656,64],[2656,64],[5056,64],[5056,64],[256,64],[256,64],[5056,64]], align: [[5056,64],[5056,64],[5056,64],[5056,2432],[5056,1248],[5056,64],[5056,64],[5056,2432],[5056,64],[5056,2432]] },
  'row_wrap-reverse_ltr': { justify: [[256,2432],[256,2432],[5056,2432],[2656,2432],[256,2432],[2656,2432],[2656,2432],[256,2432],[256,2432],[5056,2432],[256,2432],[5056,2432]], align: [[256,2432],[256,2432],[256,2432],[256,64],[256,1248],[256,64],[256,64],[256,2432],[256,64],[256,2432]] },
  'row_wrap-reverse_rtl': { justify: [[5056,2432],[5056,2432],[256,2432],[2656,2432],[5056,2432],[2656,2432],[2656,2432],[5056,2432],[5056,2432],[256,2432],[256,2432],[5056,2432]], align: [[5056,2432],[5056,2432],[5056,2432],[5056,64],[5056,1248],[5056,64],[5056,64],[5056,2432],[5056,64],[5056,2432]] },
  'row-reverse_nowrap_ltr': { justify: [[5056,64],[5056,64],[256,64],[2656,64],[5056,64],[2656,64],[2656,64],[5056,64],[256,64],[5056,64],[256,64],[5056,64]], align: [[5056,64],[5056,64],[5056,64],[5056,2432],[5056,1248],[5056,64],[5056,64],[5056,2432],[5056,64],[5056,2432]] },
  'row-reverse_nowrap_rtl': { justify: [[256,64],[256,64],[5056,64],[2656,64],[256,64],[2656,64],[2656,64],[256,64],[5056,64],[256,64],[256,64],[5056,64]], align: [[256,64],[256,64],[256,64],[256,2432],[256,1248],[256,64],[256,64],[256,2432],[256,64],[256,2432]] },
  'row-reverse_wrap-reverse_ltr': { justify: [[5056,2432],[5056,2432],[256,2432],[2656,2432],[5056,2432],[2656,2432],[2656,2432],[5056,2432],[256,2432],[5056,2432],[256,2432],[5056,2432]], align: [[5056,2432],[5056,2432],[5056,2432],[5056,64],[5056,1248],[5056,64],[5056,64],[5056,2432],[5056,64],[5056,2432]] },
  'row-reverse_wrap-reverse_rtl': { justify: [[256,2432],[256,2432],[5056,2432],[2656,2432],[256,2432],[2656,2432],[2656,2432],[256,2432],[5056,2432],[256,2432],[256,2432],[5056,2432]], align: [[256,2432],[256,2432],[256,2432],[256,64],[256,1248],[256,64],[256,64],[256,2432],[256,64],[256,2432]] },
  'column_nowrap_ltr': { justify: [[256,64],[256,64],[256,2432],[256,1248],[256,64],[256,1248],[256,1248],[256,64],[256,64],[256,2432],[256,64],[256,64]], align: [[256,64],[256,64],[256,64],[5056,64],[2656,64],[256,64],[256,64],[5056,64],[256,64],[5056,64]] },
  'column_nowrap_rtl': { justify: [[5056,64],[5056,64],[5056,2432],[5056,1248],[5056,64],[5056,1248],[5056,1248],[5056,64],[5056,64],[5056,2432],[5056,64],[5056,64]], align: [[5056,64],[5056,64],[5056,64],[256,64],[2656,64],[5056,64],[5056,64],[256,64],[5056,64],[256,64]] },
  'column_wrap-reverse_ltr': { justify: [[5056,64],[5056,64],[5056,2432],[5056,1248],[5056,64],[5056,1248],[5056,1248],[5056,64],[5056,64],[5056,2432],[5056,64],[5056,64]], align: [[5056,64],[5056,64],[5056,64],[256,64],[2656,64],[256,64],[256,64],[5056,64],[256,64],[5056,64]] },
  'column_wrap-reverse_rtl': { justify: [[256,64],[256,64],[256,2432],[256,1248],[256,64],[256,1248],[256,1248],[256,64],[256,64],[256,2432],[256,64],[256,64]], align: [[256,64],[256,64],[256,64],[5056,64],[2656,64],[5056,64],[5056,64],[256,64],[5056,64],[256,64]] },
  'column-reverse_nowrap_ltr': { justify: [[256,2432],[256,2432],[256,64],[256,1248],[256,2432],[256,1248],[256,1248],[256,2432],[256,64],[256,2432],[256,64],[256,64]], align: [[256,2432],[256,2432],[256,2432],[5056,2432],[2656,2432],[256,2432],[256,2432],[5056,2432],[256,2432],[5056,2432]] },
  'column-reverse_nowrap_rtl': { justify: [[5056,2432],[5056,2432],[5056,64],[5056,1248],[5056,2432],[5056,1248],[5056,1248],[5056,2432],[5056,64],[5056,2432],[5056,64],[5056,64]], align: [[5056,2432],[5056,2432],[5056,2432],[256,2432],[2656,2432],[5056,2432],[5056,2432],[256,2432],[5056,2432],[256,2432]] },
  'column-reverse_wrap-reverse_ltr': { justify: [[5056,2432],[5056,2432],[5056,64],[5056,1248],[5056,2432],[5056,1248],[5056,1248],[5056,2432],[5056,64],[5056,2432],[5056,64],[5056,64]], align: [[5056,2432],[5056,2432],[5056,2432],[256,2432],[2656,2432],[256,2432],[256,2432],[5056,2432],[256,2432],[5056,2432]] },
  'column-reverse_wrap-reverse_rtl': { justify: [[256,2432],[256,2432],[256,64],[256,1248],[256,2432],[256,1248],[256,1248],[256,2432],[256,64],[256,2432],[256,64],[256,64]], align: [[256,2432],[256,2432],[256,2432],[5056,2432],[2656,2432],[5056,2432],[5056,2432],[256,2432],[5056,2432],[256,2432]] },
};

describe('static position in flex containers (css-flexbox-1 §4.1, probe p6): every justify-content and align value, reverse, wrap-reverse, rtl', () => {
  const J: readonly JustifyContent[] = ['normal', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch', 'start', 'end', 'left', 'right'];
  const A: readonly AlignItems[] = ['normal', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end', 'self-start', 'self-end'];
  const container = (fd: FlexDirection, wrap: FlexWrap, dir: LayoutStyle['direction'], s: Partial<LayoutStyle>) =>
    box('c', { display: 'flex', ...rel, flexDirection: fd, flexWrap: wrap, direction: dir, width: px(101), height: px(51), ...padding(5, 5, 5, 5), ...edges(2, 'border'), ...s }, [box('a', { ...absolute, direction: dir, width: px(20), height: px(10), ...margin(1, 2, 3, 4) })]);
  for (const [key, expected] of Object.entries(STATIC_FLEX)) {
    const [fd, wrap, dir] = key.split('_') as [FlexDirection, FlexWrap, LayoutStyle['direction']];
    it(`${fd} ${wrap} ${dir}: offsets from the content box`, () => {
      const offset = (s: Partial<LayoutStyle>): number[] => {
        const m = run([container(fd, wrap, dir, s)]);
        const [cx, cy] = at(m, 'c') as [number, number];
        return [x(m, 'a') - cx - 448, y(m, 'a') - cy - 448];
      };
      expect(J.map((j) => offset({ justifyContent: j }))).toEqual(expected.justify);
      expect(A.map((al) => offset({ alignItems: al }))).toEqual(expected.align);
    });
  }
  it('a centred static position shrinks the box to twice the smaller distance to either containing block edge (probe p7 a11)', () => {
    const m = run([box('c', { display: 'flex', ...rel, justifyContent: 'center', alignItems: 'center', width: px(101.3), height: px(51.7), ...padding(5, 5, 5, 5), ...edges(2, 'border') }, [box('a', absolute, [text('a:t', 'XX XX XX XX XX XX XX XX XX XX XX')])])]);
    expect(at(m, 'a')).toEqual([128, 1142, 7122, 1920]);
  });
  it('odd centred sizes round in the containing block direction (probe p8)', () => {
    const one = (dir: LayoutStyle['direction'], w: number) => {
      const m = run([box('c', { display: 'flex', ...rel, direction: dir, justifyContent: 'center', alignItems: 'center', width: px(101.3), height: px(51.7), ...padding(5, 5, 5, 5), ...edges(2, 'border') }, [box('a', { ...absolute, width: px(w), height: px(10.015625), ...margin(1, 2, 3, 4) })])]);
      return x(m, 'a') - x(m, 'c');
    };
    expect([one('ltr', 20), one('ltr', 20.015625), one('rtl', 20), one('rtl', 20.015625)]).toEqual([3113, 3112, 3114, 3114]);
  });
});

describe('width, height and margins (CSS2 §10.3.7, §10.6.4; probes p3, p4)', () => {
  const cbStyle: Partial<LayoutStyle> = { ...rel, width: px(200), height: px(100), ...edges(3, 'border'), ...padding(5, 7, 9, 11), marginBottom: px(4) };
  const a = (id: string, s: Partial<LayoutStyle>) => box(id, { ...absolute, height: px(10), ...s });
  const h = (id: string, s: Partial<LayoutStyle>) => a(id, { left: px(10), right: px(20), width: px(50), ...s });
  const both = { marginLeft: auto, marginRight: auto };
  it('over-constrained: the end inset is ignored in the containing block direction; auto margins centre with the start margin LayoutUnit / 2', () => {
    const m = run([
      box('c1', cbStyle, [h('d1', {})]),
      box('c2', { ...cbStyle, ...rtl }, [h('d2', {}), h('e2', both), h('f2', { ...both, right: px(21) })]),
      box('c3', cbStyle, [h('e3', { ...both, right: px(21) }), h('f3', { ...both, width: px(300) }), h('g3', { marginLeft: auto, marginRight: px(5) }), h('h3', { marginRight: auto, marginLeft: px(7) })]),
      box('c4', { ...cbStyle, ...rtl }, [h('f4', { ...both, width: px(300) }), a('g4', { left: px(10), width: px(50), marginRight: auto, marginLeft: px(7) }), a('h4', { right: px(10), width: px(50), ...both })]),
    ]);
    expect(['d1', 'd2', 'e2', 'f2', 'e3', 'f3', 'g3', 'h3', 'f4', 'g4', 'h4'].map((id) => x(m, id))).toEqual([832, 9664, 5248, 5216, 5216, 832, 9344, 1280, -6336, 1280, 10304]);
  });
  it('odd free space and negative free space: inline start margin clamped at zero, block margins split even when negative', () => {
    const plain: Partial<LayoutStyle> = { ...rel, width: px(200), height: px(100), marginBottom: px(4) };
    const m = run([
      box('c1', plain, [a('o1', { left: px(10), right: px(20.015625), width: px(50), ...both }), a('o2', { width: px(10), top: px(10), bottom: px(20.015625), height: px(40), marginTop: auto, marginBottom: auto }), a('o3', { width: px(10), top: px(10), bottom: px(20.015625), height: px(200), marginTop: auto, marginBottom: auto })]),
      box('c2', { ...plain, ...rtl }, [a('o4', { left: px(10), right: px(20.015625), width: px(50), ...both }), a('o5', { left: px(10), right: px(20.015625), width: px(300), ...both })]),
    ]);
    expect([x(m, 'o1'), y(m, 'o2'), y(m, 'o3'), x(m, 'o4'), x(m, 'o5')]).toEqual([4479, 1599, -3520, 4480, -7681]);
  });
  it('heights: stretched between insets, over-constrained (top wins), auto margins and a lone bottom inset', () => {
    const v = (id: string, s: Partial<LayoutStyle>) => a(id, { width: px(10), top: px(10), bottom: px(20), height: px(40), ...s });
    const m = run([box('c5', cbStyle, [v('v1', { bottom: px(21), marginTop: auto, marginBottom: auto }), v('v2', { height: px(200), marginTop: auto, marginBottom: auto }), v('v3', {}), v('v4', { height: auto }), a('v5', { width: px(10), bottom: px(20), height: px(30), marginTop: auto }), v('v6', { marginTop: auto, marginBottom: px(3) })])]);
    expect([y(m, 'v1'), y(m, 'v2'), y(m, 'v3'), at(m, 'v4')[3], y(m, 'v5'), y(m, 'v6')].map((n) => n as number)).toEqual([2208, -2880, 832, 5376, 4288, 3456]);
  });
  it('percentages against the padding box; a stretched height is definite for children', () => {
    const m = run([box('c6', cbStyle, [a('p1', { width: pct(10), left: pct(10), top: pct(10), height: pct(10) }), a('p2', { width: pct(10.3), right: pct(12.7), bottom: pct(3.3), height: auto }), a('p3', { left: pct(5), right: pct(5), top: pct(5), bottom: pct(5), height: auto }, )])]);
    const withKid = run([box('c6', cbStyle, [box('p3', { ...absolute, left: pct(5), right: pct(5), top: pct(5), bottom: pct(5) }, [box('p3c', { height: pct(50) })])])]);
    expect([at(m, 'p1'), at(m, 'p2'), at(withKid, 'p3'), at(withKid, 'p3c')[3]]).toEqual([[1587, 921, 1395, 729], [10936, 7248, 1437, 0], [889, 556, 12558, 6568], 3284]);
  });
  it('shrink-to-fit: min(max(min-content, available), max-content) with wrapped Ahem text, then min and max width', () => {
    const plain: Partial<LayoutStyle> = { ...rel, width: px(200), height: px(100), marginBottom: px(4) };
    const s = (id: string, st: Partial<LayoutStyle>, words: string) => box(id, { ...absolute, ...st }, [text(`${id}:t`, words)]);
    const m = run([
      box('c3', plain, [s('s1', {}, 'XX XX XX XXXX XX'), s('s2', { left: px(150), top: px(20) }, 'XX XXX XX'), s('s3', { left: px(190), top: px(40) }, 'XXX XX'), s('s4', { right: px(150), top: px(60) }, 'XX XXX XX'), s('s5', { left: px(10), right: px(20), top: px(80) }, 'XX')]),
      box('c4', plain, [s('t1', { left: px(150), top: px(0), maxWidth: px(15), paddingLeft: px(2), paddingRight: px(2) }, 'XX XXX XX'), s('t2', { left: px(150), top: px(30), minWidth: px(70) }, 'XX X'), s('t3', { left: px(0), right: px(0), top: px(50), maxWidth: px(40), ...both }, 'XX'), s('t4', { left: px(0), right: px(0), top: px(70), width: px(10), minWidth: px(30), ...both }, 'X')]),
    ]);
    expect(['s1', 's2', 's3', 's4', 's5'].map((id) => at(m, id))).toEqual([[0, 0, 10240, 640], [9600, 1280, 3200, 1920], [12160, 2560, 1920, 1280], [0, 3840, 3200, 1920], [640, 5120, 10880, 640]]);
    expect(['t1', 't2', 't3', 't4'].map((id) => at(m, id).slice(0, 3))).toEqual([[9600, 6656, 1216], [9600, 8576, 4480], [5120, 9856, 2560], [5440, 11136, 1920]]);
  });
});

describe('absolutely positioned boxes leave the in-flow layout (fixtures position-absolute-out-of-flow and flex-abspos-excluded)', () => {
  const big = (id: string, s: Partial<LayoutStyle> = {}) => box(id, { ...absolute, width: px(300), height: px(80), ...margin(30, 30, 30, 30), ...s });
  it('auto height, margin collapsing and intrinsic sizes ignore them; absposInFlow breaks that', () => {
    const tree = [
      box('p1', { marginTop: px(10), marginBottom: px(10), borderLeftWidth: px(1) }, [big('a1'), box('q1', { marginTop: px(12), height: px(5) }), big('a2')]),
      box('p2', { marginTop: px(10), marginBottom: px(10), borderLeftWidth: px(1) }, [big('a3')]),
      box('s1', { display: 'flex' }, [box('i1', edges(1, 'border'), [box('i1w', { width: px(20), height: px(6) }), big('a4')]), box('i2', edges(1, 'border'), [big('a5')])]),
    ];
    const m = run(tree);
    expect(['body', 'p1', 'q1', 'a1', 'a2', 'p2', 'a3', 'i1', 'i2'].map((id) => at(m, id))).toEqual([[0, 768, 25600, 1472], [0, 768, 25600, 320], [64, 768, 25536, 320], [1984, 2688, 19200, 5120], [1984, 3008, 19200, 5120], [0, 1728, 25600, 0], [1984, 3648, 19200, 5120], [0, 1728, 1408, 512], [1408, 1728, 128, 512]]);
    expect(at(run(tree, { faults: { ...NO_ENGINE_FAULTS, absposInFlow: true } }), 'q1')).not.toEqual([64, 768, 25536, 320]);
  });
  it('flex lines, order and space distribution ignore them', () => {
    const i = (id: string, s: Partial<LayoutStyle> = {}) => box(id, { width: px(30), height: px(10), ...s });
    const a = (id: string, s: Partial<LayoutStyle> = {}) => box(id, { ...absolute, width: px(60), height: px(40), ...s });
    const m = run([box('c1', { display: 'flex', ...rel, width: px(150), ...edges(1, 'border'), columnGap: px(7), rowGap: px(3), justifyContent: 'space-between' }, [i('c1a'), a('a1', { order: -5 }), i('c1b'), a('a2', { order: 3 }), i('c1c')])]);
    expect(['c1a', 'c1b', 'c1c', 'a1', 'a2'].map((id) => x(m, id))).toEqual([64, 3904, 7744, 64, 64]);
    expect(at(m, 'c1')[3]).toBe(768);
  });
  it('an absolutely positioned child beside text is refused (abspos-in-inline)', () => {
    const r = layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root: box('html', {}, [box('p', {}, [anon('p:anon0', {}, [text('t', 'XX')]), box('a', absolute)])]) }, ahemMeasurer, NO_ENGINE_FAULTS);
    expect(r.kind === 'unsupported' && r.unsupported).toMatchObject({ code: 'abspos-in-inline', nodeId: 'a' });
  });
});
