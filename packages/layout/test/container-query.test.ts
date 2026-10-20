// CQ: container-type: inline-size in the engine (input.ts containSize: 'inline-size'): the box's content contributes 0 to its intrinsic
// inline sizes (intrinsic.ts) and it lays out in a new formatting context (box.ts establishesFormattingContext). Chrome agreement is
// proven by the container-query fixture group (packages/parity); these cases pin the engine's decisions in 10px Ahem.
import { describe, expect, it } from 'vitest';
import type { EngineFaults, GridContainerStyle, LayoutBox, LayoutResult, LayoutStyle, TrackSize } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS, validateLayoutInput } from '../src/index.ts';
import { ahemFont, box, divStyle, neutralEnvironment, px, span, text } from './helpers.ts';

const CQ: Partial<LayoutStyle> = { containSize: 'inline-size' };
const t = (id: string, value: string) => text(id, value, { font: ahemFont(10) });
// A block container of one atomic inline, which needs its own strut.
const line = (kid: LayoutBox): LayoutBox => box('root', {}, [kid], { font: ahemFont(10), lineHeight: { kind: 'normal' } });

function run(root: LayoutBox, faults: EngineFaults = NO_ENGINE_FAULTS): LayoutResult {
  return layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer, faults);
}

function rect(r: LayoutResult, id: string): readonly [number, number, number, number] {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  const b = absoluteRects(r.boxes).get(id);
  if (b === undefined) throw new Error(`no box ${id}`);
  return [b.x / 64, b.y / 64, b.width / 64, b.height / 64];
}

describe('CQ: inline-size containment', () => {
  it('sizes a shrink-to-fit container as if it had no content: an inline-block, an absolutely positioned box and a flex item', () => {
    const atomic = run(line(box('a', { ...CQ, display: 'inline-block' }, [t('t', 'XXXX')])));
    expect(rect(atomic, 'a')[2]).toBe(0);
    const abs = run(box('root', { position: 'relative' }, [box('a', { ...CQ, position: 'absolute' }, [t('t', 'XXXX')])]));
    expect(rect(abs, 'a')[2]).toBe(0);
    // A row flex item's flex-basis content and its automatic minimum size are both 0.
    const flex = run(box('root', { display: 'flex', width: px(100) }, [box('a', CQ, [t('t', 'XXXX')]), box('b', { flexGrow: 1 }, [t('u', 'X')])]));
    expect(rect(flex, 'a')[2]).toBe(0);
    expect(rect(flex, 'b')[2]).toBe(100);
  });

  it('sizes a contained grid as an empty grid, which keeps its explicit tracks and gaps', () => {
    const track = (value: number): TrackSize => ({ kind: 'breadth', breadth: { kind: 'px', value } });
    const AUTO: TrackSize = { kind: 'breadth', breadth: { kind: 'auto' } };
    // grid-template-columns: 30px 40px auto; column-gap: 5px.
    const grid: GridContainerStyle = { templateColumns: [{ count: 1, sizes: [track(30), track(40), AUTO] }], templateRows: [], autoColumns: [AUTO], autoRows: [AUTO], explicitColumnCount: 3, explicitRowCount: 0, autoRepeatColumns: null, autoRepeatRows: null, autoFlow: 'row', dense: false, justifyItems: 'normal' };
    const items = ['XX', 'XX', 'XXXXXXXX'].map((v, i) => box(`i${String(i)}`, { gridItem: { column: { kind: 'auto', span: 1 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' } }, [t(`t${String(i)}`, v)]));
    const at = (contained: boolean) => rect(run(box('root', { position: 'relative' }, [box('a', { containSize: contained ? 'inline-size' : 'none', display: 'grid', position: 'absolute', columnGap: px(5), grid }, items)])), 'a')[2];
    // 30 + 40 + 0 + 2 x 5; without containment the auto track takes the 80px item.
    expect([at(true), at(false)]).toEqual([80, 160]);
  });

  it('keeps the padding and border in the contribution, and lays the content out at the size it gets', () => {
    const r = run(line(box('a', { ...CQ, display: 'inline-block', paddingLeft: px(5), borderRightWidth: px(3) }, [t('t', 'XX XX')])));
    // Content box 0: each word overflows its own line.
    expect(rect(r, 'a')).toEqual([0, 0, 8, 20]);
  });

  it('stops the margins of its children collapsing through it', () => {
    const kid = box('k', { marginTop: px(10) }, [t('t', 'X')]);
    const plain = run(box('root', {}, [box('a', {}, [kid])]));
    expect(rect(plain, 'a')[1]).toBe(10);
    const contained = run(box('root', {}, [box('a', CQ, [box('k', { marginTop: px(10) }, [t('t', 'X')])])]));
    expect(rect(contained, 'a')[1]).toBe(0);
    expect(rect(contained, 'k')[1]).toBe(10);
  });

  it('catches the planted faults', () => {
    const atomic = line(box('a', { ...CQ, display: 'inline-block' }, [t('t', 'XXXX')]));
    expect(rect(run(atomic, { ...NO_ENGINE_FAULTS, containedContentSized: true }), 'a')[2]).toBe(40);
    const flow = box('root', {}, [box('a', CQ, [box('k', { marginTop: px(10) }, [t('t', 'X')])])]);
    expect(rect(run(flow, { ...NO_ENGINE_FAULTS, containerJoinsFlow: true }), 'a')[1]).toBe(10);
  });

  it('refuses inline-size containment on an inline box', () => {
    const root = box('root', {}, [span('s', [t('t', 'X')], { style: { ...divStyle, display: 'inline', containSize: 'inline-size' } })], { font: ahemFont(10), lineHeight: { kind: 'normal' } });
    const v = validateLayoutInput({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
    expect(v.ok ? [] : v.errors.map((e) => e.path)).toContain('$.root.children[0].style.containSize');
  });
});
