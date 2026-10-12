// OVFL-B: the compiler refuses on native every auto or scroll container whose scroll range the engine may refuse
// (lower/scroll-decidable.ts), so a native scroll view never meets an engine refusal on the device. Checked against the engine.
import { describe, expect, it } from 'vitest';
import type { FontSpec, InlineBox, InlineChild, LayoutBox, LayoutInput, LayoutStyle, LineBreak, Overflow, ReplacedLeaf, TextLeaf } from '@dragon/layout';
import { ahemMeasurer, scrollRanges } from '@dragon/layout';
import { undecidedScrollContainers } from '../src/lower/scroll-decidable.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { Diagnostic, TreeNode } from '../src/index.ts';
import { div, inputFor, text } from './helpers.ts';

// Engine input builders (as packages/layout/test/helpers.ts, which this package's tests cannot import): CSS initial values for a div.
const DIV: LayoutStyle = {
  display: 'block', position: 'static', top: { kind: 'auto' }, right: { kind: 'auto' }, bottom: { kind: 'auto' }, left: { kind: 'auto' },
  overflowX: 'visible', overflowY: 'visible', direction: 'ltr', boxSizing: 'content-box', width: { kind: 'auto' }, height: { kind: 'auto' },
  minWidth: { kind: 'auto' }, minHeight: { kind: 'auto' }, maxWidth: { kind: 'none' }, maxHeight: { kind: 'none' },
  marginTop: { kind: 'px', value: 0 }, marginRight: { kind: 'px', value: 0 }, marginBottom: { kind: 'px', value: 0 }, marginLeft: { kind: 'px', value: 0 },
  paddingTop: { kind: 'px', value: 0 }, paddingRight: { kind: 'px', value: 0 }, paddingBottom: { kind: 'px', value: 0 }, paddingLeft: { kind: 'px', value: 0 },
  borderTopWidth: { kind: 'px', value: 0 }, borderRightWidth: { kind: 'px', value: 0 }, borderBottomWidth: { kind: 'px', value: 0 }, borderLeftWidth: { kind: 'px', value: 0 },
  flexDirection: 'row', flexWrap: 'nowrap', flexGrow: 0, flexShrink: 1, flexBasis: { kind: 'auto' }, order: 0, justifyContent: 'normal', alignItems: 'normal',
  alignSelf: 'auto', alignContent: 'normal', rowGap: { kind: 'normal' }, columnGap: { kind: 'normal' }, textAlign: 'start', aspectRatio: { kind: 'auto' },
  verticalAlign: { kind: 'keyword', value: 'baseline' }, grid: null, gridItem: null,
};
type Child = LayoutBox | ReplacedLeaf | InlineChild;
const AHEM: FontSpec = { family: 'Ahem', size: 10, specifiedSize: { kind: 'px', value: 10 }, absoluteSize: true };
const px = (value: number) => ({ kind: 'px', value }) as const;
const pct = (value: number) => ({ kind: 'percent', value }) as const;
const box = (id: string, style: Partial<LayoutStyle>, children: Child[] = []): LayoutBox => ({
  kind: 'box', id, boxType: 'element', style: { ...DIV, ...style }, children,
  strut: children.some((c) => c.kind === 'text' || c.kind === 'inline' || c.kind === 'br') ? { font: AHEM, lineHeight: { kind: 'normal' } } : null,
});
const span = (id: string, children: InlineChild[]): InlineBox => ({ kind: 'inline', id, style: { ...DIV, display: 'inline' }, font: AHEM, lineHeight: { kind: 'normal' }, children });
const br = (id: string): LineBreak => ({ kind: 'br', id, font: AHEM, lineHeight: { kind: 'normal' } });
const leaf = (id: string, value: string): TextLeaf => ({ kind: 'text', id, text: value, font: AHEM, lineHeight: { kind: 'normal' }, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap' });
const VIEW = { width: 400, height: 300 };

const input = (children: LayoutBox[]): LayoutInput => ({
  viewport: { width: 400, height: 300 },
  devicePixelRatio: 2,
  viewportUnits: { small: VIEW, large: VIEW, dynamic: VIEW },
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  rootFontSize: 16,
  root: box('html', {}, [box('body', {}, children)]),
});
const sc = (o: Overflow, extra: Partial<LayoutStyle> = {}): Partial<LayoutStyle> => ({ overflowX: o, overflowY: o, width: px(100), height: px(60), ...extra });

const GRID = { templateColumns: [], templateRows: [], autoColumns: [{ kind: 'breadth', breadth: { kind: 'auto' } }], autoRows: [{ kind: 'breadth', breadth: { kind: 'auto' } }], explicitColumnCount: 0, explicitRowCount: 0, autoRepeatColumns: null, autoRepeatRows: null, autoFlow: 'row', dense: false, justifyItems: 'normal' } as const;

type Kid = (id: string) => Child;
/** Child shapes covering each engine refusal and its near misses. */
const KIDS: Record<string, Kid> = {
  text: (id) => leaf(`${id}t`, 'XX'),
  span: (id) => span(`${id}s`, [leaf(`${id}st`, 'YY')]),
  br: (id) => br(`${id}b`),
  block: (id) => box(id, { height: px(10) }),
  blockText: (id) => box(id, {}, [leaf(`${id}t`, 'XX')]),
  blockSpan: (id) => box(id, {}, [leaf(`${id}t`, 'XX'), span(`${id}s`, [leaf(`${id}st`, 'YY')])]),
  pctHeightMargin: (id) => box(id, { height: pct(50) }, [box(`${id}k`, { height: px(10), marginBottom: px(5) })]),
  pctHeightPadded: (id) => box(id, { height: pct(50), paddingBottom: px(2) }, [box(`${id}k`, { height: px(10), marginBottom: px(5) })]),
  pctHeightEmpty: (id) => box(id, { height: pct(50) }),
  deepPct: (id) => box(id, {}, [box(`${id}d`, { height: pct(50) }, [box(`${id}k`, { height: px(10), marginBottom: px(5) })])]),
  clipBoth: (id) => box(id, { overflowX: 'clip', overflowY: 'clip' }, [leaf(`${id}t`, 'XX'), span(`${id}s`, [leaf(`${id}st`, 'YY')])]),
  nestedScroll: (id) => box(id, sc('auto', { width: px(50), height: px(20) }), [leaf(`${id}t`, 'XX'), br(`${id}b`)]),
  flexSpan: (id) => box(id, { display: 'flex' }, [box(`${id}i`, {}, [leaf(`${id}t`, 'XX'), span(`${id}s`, [leaf(`${id}st`, 'YY')])])]),
  grid: (id) => box(id, { display: 'grid', grid: GRID }),
  abs: (id) => box(id, { position: 'absolute', width: px(20), height: px(20) }, [leaf(`${id}t`, 'XX'), span(`${id}s`, [leaf(`${id}st`, 'YY')])]),
};

/** As the lowering does (CSS2 §9.2.1.1): inline-level children beside a block-level one are wrapped in an anonymous block. */
const lowered = (kids: Child[]): Child[] => {
  const inline = (k: Child): boolean => k.kind === 'text' || k.kind === 'inline' || k.kind === 'br';
  if (kids.every(inline) || !kids.some(inline)) return kids;
  return kids.map((k, n) => (inline(k) ? box(`anon${n}`, {}, [k]) : k));
};

/** Whether the box with this id has auto or scroll on an axis. */
const userScrolls = (root: LayoutBox, id: string): boolean => {
  const find = (b: LayoutBox): LayoutBox | null => (b.id === id ? b : b.children.reduce<LayoutBox | null>((f, k) => f ?? (k.kind === 'box' ? find(k) : null), null));
  const b = find(root);
  if (b === null) throw new Error(`no box ${id}`);
  return [b.style.overflowX, b.style.overflowY].some((v) => v === 'auto' || v === 'scroll');
};

describe('OVFL-B: undecidedScrollContainers against the engine', () => {
  it('on every pair of child shapes, under auto, scroll and hidden, static and relative: the compiler refuses every container the engine refuses, and exactly those but for the percentage-height rule', () => {
    const names = Object.keys(KIDS);
    let refused = 0;
    let checked = 0;
    const problems: string[] = [];
    for (const o of ['auto', 'scroll', 'hidden'] as const) {
      for (const position of ['static', 'relative'] as const) {
        for (const a of names) {
          for (const b of names) {
            const i = input([box('c', sc(o, { position }), lowered([(KIDS[a] as Kid)('x'), (KIDS[b] as Kid)('y')]))]);
            const r = scrollRanges(i, ahemMeasurer);
            if (r.kind !== 'ok') throw new Error(`${a}+${b}: ${r.detail}`);
            // The engine refuses hidden containers too; only auto and scroll ones are native scroll views.
            const engine = r.refused.filter((x) => userScrolls(i.root, x.id)).map((x) => x.id).sort();
            const compiler = undecidedScrollContainers(i.root).map((x) => x.containerId).sort();
            const label = `${o} ${position} ${a}+${b}`;
            for (const id of engine) if (!compiler.includes(id)) problems.push(`${label}: the engine refuses ${id}, the compiler does not`);
            const valueRule = [a, b].some((k) => k.startsWith('pct') || k === 'deepPct');
            if (!valueRule && engine.join() !== compiler.join()) problems.push(`${label}: engine [${engine}], compiler [${compiler}]`);
            refused += engine.length;
            checked++;
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBe(6 * Object.keys(KIDS).length ** 2);
    expect(refused).toBeGreaterThan(300);
  });

  it('names the engine reason for each refusal class', () => {
    const reasons = (k: Child[]): string[] => undecidedScrollContainers(input([box('c', sc('auto'), k)]).root).map((u) => `${u.containerId} ${u.nodeId}: ${u.detail}`);
    expect(reasons([leaf('t', 'XX'), span('s', [leaf('u', 'YY')])])).toEqual(['c s: an inline box in the inline formatting context of c: its scrollable overflow is not decided here (R16, INL1a)']);
    expect(reasons([leaf('t', 'XX'), br('b'), leaf('v', 'YY')])).toEqual(['c b: a <br> in the inline formatting context of c: its scrollable overflow is not decided here (R16, INL1a)']);
    expect(reasons([leaf('t', 'XX'), box('k', { display: 'flex', width: px(10), height: px(10) })])).toEqual(['c k: an atomic inline in the inline formatting context of c: its scrollable overflow is not decided here (R16, INL2)']);
    expect(reasons([box('p', { height: pct(50) }, [box('k', { height: px(10), marginBottom: px(5) })])])).toEqual(['c p: a percentage height on a box whose end margins may collapse through it: its basis is not decided here']);
    expect(reasons([box('g', { display: 'grid', grid: GRID })])).toEqual(['c g: a grid container: its scrollable overflow (with its grid area) is not decided here']);
    expect(reasons([box('p', {}, [leaf('t', 'XX')]), box('q', { height: px(10) })])).toEqual([]);
  });
});

describe('OVFL-B: the compiler refuses an undecided native scroll container', () => {
  const NATIVE = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } as const;
  const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
  type Ref = Parameters<Parameters<typeof inputFor>[1]>[0];
  const el = (r: Ref, tag: string, id: string, classes: string[], children: TreeNode[] = []): TreeNode => ({ ...div(r, id, classes, children), tag });
  const compile = (css: string, inner: (r: Ref) => TreeNode[]) =>
    createProjectWith({ projectId: 'test', targets: NATIVE }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`${FONT} .a { overflow: auto; height: 20px; } ${css}`, (r) => [div(r, 'a', ['a'], inner(r))]));
  const refusals = (c: { readonly diagnostics: readonly Diagnostic[] }): string[] => c.diagnostics.filter((x) => x.message.includes("native scroll view's range")).map((x) => `${x.code} ${x.target}: ${x.message}`).sort();
  const both = (m: string): string[] => [`DRAGON_UNPROVEN_CONTEXT android: ${m}`, `DRAGON_UNPROVEN_CONTEXT ios: ${m}`];
  const prefix = (at: string): string => `overflow auto or scroll on a: the native scroll view's range is not decided at ${at}: `;

  it('an inline box, a <br>, an atomic inline and a collapsing percentage height inside auto or scroll are refused on ios and android only', () => {
    const span = compile('', (r) => [text(r, 't', 'XX'), el(r, 'span', 's', [], [text(r, 'u', 'YY')])]);
    expect(refusals(span)).toEqual(both(`${prefix('s')}an inline box in the inline formatting context of a: its scrollable overflow is not decided here (R16, INL1a) (OVFL-B)`));
    expect([span.outputs.ios.kind, span.outputs.android.kind, span.outputs.web.kind]).toEqual(['blocked', 'blocked', 'ready']);
    const brk = compile('', (r) => [text(r, 't', 'XX'), el(r, 'br', 'b', []), text(r, 'u', 'YY')]);
    expect(refusals(brk)).toEqual(both(`${prefix('b')}a <br> in the inline formatting context of a: its scrollable overflow is not decided here (R16, INL1a) (OVFL-B)`));
    // An atomic inline (an inline-level box beside text) never reaches the engine on native: the lowering refuses it first
    // (INL2 has not landed), so its scroll container is blocked there; the engine's atomic-inline rule is covered on its input above.
    const atomic = compile('.k { display: inline-flex; width: 10px; height: 10px; }', (r) => [text(r, 't', 'XX'), div(r, 'k', ['k'])]);
    expect(atomic.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.target}: ${d.message}`).sort()).toEqual([
      'DRAGON_LOWERING_FAILED android: display: inline-flex on k has no layout mapping (expected block | flex | grid | inline)',
      'DRAGON_LOWERING_FAILED ios: display: inline-flex on k has no layout mapping (expected block | flex | grid | inline)',
    ]);
    expect([atomic.outputs.ios.kind, atomic.outputs.android.kind]).toEqual(['blocked', 'blocked']);
    const pctHeight = compile('.p { height: 50%; } .k { height: 10px; margin-bottom: 5px; }', (r) => [div(r, 'p', ['p'], [div(r, 'k', ['k'])])]);
    expect(refusals(pctHeight)).toEqual(both(`${prefix('p')}a percentage height on a box whose end margins may collapse through it: its basis is not decided here (OVFL-B)`));
  });

  it('a decidable scroll container compiles everywhere, and hidden is never refused (it is no scroll view)', () => {
    const ok = compile('.p { height: 50%; padding-bottom: 1px; } .k { height: 10px; margin-bottom: 5px; }', (r) => [div(r, 'p', ['p'], [div(r, 'k', ['k'], [text(r, 't', 'XX')])])]);
    expect(ok.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const hidden = createProjectWith({ projectId: 'test', targets: NATIVE }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`${FONT} .a { overflow: hidden; height: 20px; }`, (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX'), el(r, 'span', 's', [], [text(r, 'u', 'YY')])])]));
    expect(refusals(hidden)).toEqual([]);
  });
});
