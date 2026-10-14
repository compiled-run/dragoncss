// GRID G1a and G2 lowering (lower/grid-layout.ts): computed grid values to the engine's grid input, with every item line resolved
// by the compiler as Blink's GridLineResolver does, or left to the engine in an axis with an automatic repeater; the grid
// formatting contexts of the support profiles; and the refusals of the values the engine does not lay out. Layout itself is proven against Chrome by packages/parity/test/grid-corpus-*.test.ts and the grid fixtures.
import { describe, expect, it } from 'vitest';
import type { GridItemStyle, LayoutBox } from '@dragon/layout';
import { compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import { GridLoweringError, lowerGridContainer, lowerGridItem } from '../src/lower/grid-layout.ts';
import type { Longhand } from '../src/css/properties.ts';
import type { CssValue } from '../src/css/stylesheet.ts';
import { div, inputFor, text } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ahem' } as const;

function compile(css: string, body: Parameters<typeof inputFor>[1]) {
  return createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem' }).compile(inputFor(`div { font-family: Ahem; } ${css}`, body));
}

function boxes(css: string, body: Parameters<typeof inputFor>[1]): Map<string, LayoutBox> {
  const c = compile(css, body);
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') throw new Error(`blocked: ${p.reason} ${c.diagnostics.map((d) => d.message).join('; ')}`);
  const out = new Map<string, LayoutBox>();
  const walk = (b: LayoutBox): void => {
    out.set(b.id, b);
    for (const k of b.children) if (k.kind === 'box') walk(k);
  };
  walk(p.input.root);
  return out;
}

const item = (m: Map<string, LayoutBox>, id: string): GridItemStyle => {
  const gi = m.get(id)?.style.gridItem;
  if (gi === null || gi === undefined) throw new Error(`${id} has no placement`);
  return gi;
};

describe('grid lowering', () => {
  it('lowers tracks as repeaters, keeping repeat() counts, and fills the explicit counts from the template and the areas', () => {
    const m = boxes('.g { display: grid; grid-template-columns: 10px repeat(3, 1fr minmax(5px, auto)) fit-content(20%); grid-template-areas: "a a a a a a a a a"; grid-auto-rows: 7px min-content; grid-auto-flow: column dense; justify-items: legacy center; }', (r) => [div(r, 'g', ['g'])]);
    expect(m.get('g')?.style.grid).toEqual({
      templateColumns: [
        { count: 1, sizes: [{ kind: 'breadth', breadth: { kind: 'px', value: 10 } }] },
        { count: 3, sizes: [{ kind: 'breadth', breadth: { kind: 'fr', value: 1 } }, { kind: 'minmax', min: { kind: 'px', value: 5 }, max: { kind: 'auto' } }] },
        { count: 1, sizes: [{ kind: 'fit-content', limit: { kind: 'percent', value: 20 } }] },
      ],
      templateRows: [],
      autoColumns: [{ kind: 'breadth', breadth: { kind: 'auto' } }],
      autoRows: [{ kind: 'breadth', breadth: { kind: 'px', value: 7 } }, { kind: 'breadth', breadth: { kind: 'min-content' } }],
      explicitColumnCount: 9,
      explicitRowCount: 1,
      autoRepeatColumns: null,
      autoRepeatRows: null,
      autoFlow: 'column',
      dense: true,
      justifyItems: 'center',
    });
  });

  it('resolves integer, negative, span and named lines as Blink does (css-grid-2 §8.3)', () => {
    const css = [
      '.g { display: grid; grid-template-columns: [a] 20px [b] 20px [a] 20px [c]; grid-template-areas: ". x x"; }',
      '.p1 { grid-column: a 2 / c; } .p2 { grid-column: b; } .p3 { grid-column: a -1; } .p4 { grid-column: -1 / -3; }',
      '.p5 { grid-column: missing; } .p6 { grid-column: span 2 / 3; } .p7 { grid-column: span a / c; } .p8 { grid-column: x; }',
      '.p9 { grid-column: span 2; grid-row: span foo; } .p10 { grid-column: 2 / span 2 missing; }',
    ].join(' ');
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];
    const m = boxes(css, (r) => [div(r, 'g', ['g'], ids.map((id) => div(r, id, [id])))]);
    expect(ids.map((id) => item(m, id).column)).toEqual([
      { kind: 'definite', start: 2, end: 3 },
      { kind: 'definite', start: 1, end: 2 },
      { kind: 'definite', start: 2, end: 3 },
      { kind: 'definite', start: 1, end: 3 },
      { kind: 'definite', start: 4, end: 5 },
      { kind: 'definite', start: 0, end: 2 },
      { kind: 'definite', start: 2, end: 3 },
      { kind: 'definite', start: 1, end: 3 },
      { kind: 'auto', span: 2 },
      { kind: 'definite', start: 1, end: 5 },
    ]);
    // An automatic position with a named span is a span of one (Blink InitialAndFinalPositionsFromStyle).
    expect(item(m, 'p9').row).toEqual({ kind: 'auto', span: 1 });
  });

  it('matches escaped line and area names by their decoded value (css-syntax-3 §4.3.7)', () => {
    const css = '.g { display: grid; grid-template-columns: [x] 10px [\\61 b] 10px [\\31 st] 10px; grid-template-areas: ". \\61 r"; } .p1 { grid-column: ab; } .p2 { grid-column: \\31 st; } .p3 { grid-column: \\61r; }';
    // The areas string is ". ar", two columns, so ar is the second column.
    const m = boxes(css, (r) => [div(r, 'g', ['g'], ['p1', 'p2', 'p3'].map((id) => div(r, id, [id])))]);
    expect(['p1', 'p2', 'p3'].map((id) => item(m, id).column)).toEqual([
      { kind: 'definite', start: 1, end: 2 },
      { kind: 'definite', start: 2, end: 3 },
      { kind: 'definite', start: 1, end: 2 },
    ]);
  });

  it('resolves named lines near kGridMaxTracks among 100000 names without a quadratic walk (it took minutes)', () => {
    const css = '.g { display: grid; grid-template-columns: repeat(100000, [a] 1px) repeat(9900000, 1px); } .p1 { grid-column: 10000000 a; } .p2 { grid-column: -10000000 a; }';
    const start = performance.now();
    const m = boxes(css, (r) => [div(r, 'g', ['g'], [div(r, 'p1', ['p1']), div(r, 'p2', ['p2'])])]);
    // Past the 100000 named lines, every implicit line counts (css-grid-2 §8.3); p1 clamps to the last track.
    expect(item(m, 'p1').column).toEqual({ kind: 'definite', start: 9999999, end: 10000000 });
    expect(item(m, 'p2').column).toEqual({ kind: 'definite', start: -9900000, end: -9899999 });
    // Under 1 s here, minutes with the old list scan; the bound leaves room for a loaded machine.
    expect(performance.now() - start).toBeLessThan(20000);
  }, 30000);

  it('places a replaced child of a grid container, and refuses display: grid on a replaced element', () => {
    const iframe = (r: Parameters<Parameters<typeof inputFor>[1]>[0], id: string): ReturnType<typeof div> => ({ ...div(r, id, [id]), tag: 'iframe' });
    const c = compile('.g { display: grid; } .f { grid-column: 2; border: none; }', (r) => [div(r, 'g', ['g'], [iframe(r, 'f')])]);
    const p = iosLayoutProjection(c, ENV, []);
    if (p.kind !== 'ready') throw new Error(`blocked: ${p.reason} ${c.diagnostics.map((d) => d.message).join('; ')}`);
    const find = (b: LayoutBox): LayoutBox | undefined => (b.style.display === 'grid' ? b : b.children.map((k) => (k.kind === 'box' ? find(k) : undefined)).find((x) => x !== undefined));
    const leaf = find(p.input.root)?.children[0];
    expect(leaf?.kind).toBe('replaced');
    expect(leaf?.kind === 'replaced' ? leaf.style.gridItem : null).toEqual({ column: { kind: 'definite', start: 1, end: 2 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' });
    const rc = compile('.f { display: grid; border: none; }', (r) => [iframe(r, 'f')]);
    expect(iosLayoutProjection(rc, ENV, []).kind).not.toBe('ready');
    expect(rc.diagnostics.map((d) => d.message).join('\n')).toContain('display: grid on <iframe> f is not supported');
  });
  it('gives an absolutely positioned child the lines of its containing block: an auto side is the padding edge (css-grid-2 §9.1)', () => {
    const css = [
      '.g { display: grid; position: relative; grid-template-columns: [a] 20px [b] 20px; }',
      '.a { position: absolute; } .p1 { grid-column: 2 / 3; grid-row: 1; } .p2 { grid-column: auto / b; grid-row: span 2; }',
      '.p3 { grid-column: 2 / span 2; grid-row: auto / auto; } .p4 { grid-area: a / a / x / x; justify-self: end; }',
    ].join(' ');
    const m = boxes(css, (r) => [div(r, 'g', ['g'], [div(r, 'i', []), ...['p1', 'p2', 'p3', 'p4'].map((id) => div(r, id, ['a', id]))])]);
    expect(['p1', 'p2', 'p3', 'p4'].map((id) => item(m, id))).toEqual([
      { column: { kind: 'definite', start: 1, end: 2 }, row: { kind: 'start-line', line: 0 }, justifySelf: 'auto' },
      { column: { kind: 'end-line', line: 1 }, row: { kind: 'auto', span: 2 }, justifySelf: 'auto' },
      { column: { kind: 'definite', start: 1, end: 3 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' },
      { column: { kind: 'definite', start: 0, end: 3 }, row: { kind: 'definite', start: 1, end: 2 }, justifySelf: 'end' },
    ]);
    expect(item(m, 'i')).toEqual({ column: { kind: 'auto', span: 1 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' });
  });
  it('refuses self-alignment of an absolutely positioned grid child between two insets, which the engine does not do yet', () => {
    const refusal = (css: string): string[] => compile(`.g { display: grid; position: relative; } .a { position: absolute; } ${css}`, (r) => [div(r, 'g', ['g'], [div(r, 'a', ['a'])])]).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    expect(refusal('.a { left: 0; right: 0; justify-self: center; }').join('\n')).toContain('justify-self: center has no grid layout mapping: self-alignment between two insets is not supported yet');
    expect(refusal('.a { inset: 0; align-self: end; }').join('\n')).toContain('align-self: end has no grid layout mapping: self-alignment between two insets is not supported yet');
    expect(refusal('.a { inset: 0; justify-self: normal; align-self: auto; }')).toEqual([]);
    expect(refusal('.a { top: 0; justify-self: center; align-self: end; }')).toEqual([]);
  });
  it('wraps text directly in a grid container in an auto-placed anonymous grid item', () => {
    const m = boxes('.g { display: grid; grid-template-columns: 30px 30px; }', (r) => [div(r, 'g', ['g'], [text(r, 't', 'XX'), div(r, 'b', [])])]);
    expect(m.get('g:anon0')?.style.gridItem).toEqual({ column: { kind: 'auto', span: 1 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' });
    expect(m.get('g')?.children.map((k) => k.id)).toEqual(['g:anon0', 'b']);
  });

  it('keys grid container properties, grid items and their text in the grid contexts, never in block or flex ones', () => {
    const c = compile('.g { display: grid; grid-template-columns: 30px; justify-content: center; } .i { width: 10px; justify-self: end; } .t { color: red; }', (r) => [div(r, 'g', ['g'], [div(r, 'i', ['i'], [text(r, 'x', 'X')]), text(r, 'y', 'Y')])]);
    const keys = compiledFeatures(c, 'ios', []);
    expect(keys).toContain('display:grid@block/ltr');
    expect(keys).toContain('grid-template-columns:<track-list>@grid-container/ltr');
    expect(keys).toContain('justify-content:center@grid-container/ltr');
    expect(keys).toContain('width:<length-px>@grid/ltr');
    expect(keys).toContain('justify-self:end@grid/ltr');
    expect(keys).toContain('font-family:Ahem@text-in-grid-item/ltr');
    expect(keys).toContain('font-family:Ahem@text-as-anonymous-grid-item/ltr');
  });

  it('lowers repeat(auto-fill) and repeat(auto-fit) with the line names of the axis by id, and leaves its item lines to the engine (G2)', () => {
    const css = [
      '.g { display: grid; grid-template-columns: [s] 10px repeat(auto-fill, [a] minmax(20px, 1fr) [b]) [e] 15px; grid-template-rows: repeat(auto-fit, 5px); grid-template-areas: "x"; }',
      '.p1 { grid-column: a 2 / b -1; } .p2 { grid-column: x; grid-row: span 2; } .p3 { grid-column: span e / 4; }',
    ].join(' ');
    const m = boxes(css, (r) => [div(r, 'g', ['g'], ['p1', 'p2', 'p3', 'p4'].map((id) => div(r, id, [id])))]);
    const g = m.get('g')?.style.grid;
    const none = { explicit: [], repeat: [], implicit: [] };
    expect(g?.templateColumns).toEqual([{ count: 1, sizes: [{ kind: 'breadth', breadth: { kind: 'px', value: 10 } }] }, { count: 1, sizes: [{ kind: 'breadth', breadth: { kind: 'px', value: 15 } }] }]);
    expect(g?.explicitColumnCount).toBe(2);
    // Names after the repeater are numbered as if it were one track: e is line 2 (Blink ConvertGridTrackList).
    expect(g?.autoRepeatColumns).toEqual({
      type: 'auto-fill',
      index: 1,
      sizes: [{ kind: 'minmax', min: { kind: 'px', value: 20 }, max: { kind: 'fr', value: 1 } }],
      lineNames: [none, { ...none, repeat: [0] }, { ...none, repeat: [1] }, { ...none, explicit: [2] }, { ...none, explicit: [0] }, { ...none, implicit: [1] }, { ...none, implicit: [0] }],
    });
    expect(g?.templateRows).toEqual([]);
    expect(g?.explicitRowCount).toBe(1);
    expect(g?.autoRepeatRows).toEqual({ type: 'auto-fit', index: 0, sizes: [{ kind: 'breadth', breadth: { kind: 'px', value: 5 } }], lineNames: [none, { ...none, implicit: [1] }, { ...none, implicit: [0] }] });
    expect(item(m, 'p1').column).toEqual({ kind: 'lines', start: { kind: 'named-line', n: 2, name: 1 }, end: { kind: 'named-line', n: -1, name: 2 } });
    expect(item(m, 'p1').row).toEqual({ kind: 'auto', span: 1 });
    // A lone name reads <name>-start or <name>-end first; x itself names no line, so it is id 0.
    expect(item(m, 'p2').column).toEqual({ kind: 'lines', start: { kind: 'area', implicitName: 6, name: 0 }, end: { kind: 'area', implicitName: 5, name: 0 } });
    expect(item(m, 'p2').row).toEqual({ kind: 'lines', start: { kind: 'span', n: 2 }, end: { kind: 'auto' } });
    expect(item(m, 'p3').column).toEqual({ kind: 'lines', start: { kind: 'named-span', n: 1, name: 3 }, end: { kind: 'line', n: 4 } });
    expect(item(m, 'p4').column).toEqual({ kind: 'auto', span: 1 });
  });

  it('leaves the lines of an absolutely positioned child to the engine in an axis with an automatic repeater (G2 with G4)', () => {
    const css = [
      '.g { display: grid; position: relative; grid-template-columns: repeat(auto-fill, [a] 25px [b]); grid-template-rows: 10px; }',
      '.x { position: absolute; } .p1 { grid-column: a 2 / auto; grid-row: 1; } .p2 { grid-column: auto / -2; } .p3 { grid-column: span 2 / b 3; }',
    ].join(' ');
    const m = boxes(css, (r) => [div(r, 'g', ['g'], ['p1', 'p2', 'p3', 'p4'].map((id) => div(r, id, ['x', id])))]);
    expect(item(m, 'p1')).toEqual({ column: { kind: 'lines', start: { kind: 'named-line', n: 2, name: 1 }, end: { kind: 'auto' } }, row: { kind: 'start-line', line: 0 }, justifySelf: 'auto' });
    expect(item(m, 'p2').column).toEqual({ kind: 'lines', start: { kind: 'auto' }, end: { kind: 'line', n: -2 } });
    expect(item(m, 'p3').column).toEqual({ kind: 'lines', start: { kind: 'span', n: 2 }, end: { kind: 'named-line', n: 3, name: 2 } });
    expect(item(m, 'p4').column).toEqual({ kind: 'auto', span: 1 });
  });

  it('hands first baseline alignment in the block axis to the engine as baseline (GRID G3)', () => {
    const m = boxes('.g { display: grid; align-items: first baseline; } .i { align-self: baseline; } .j { align-self: first baseline; }', (r) => [div(r, 'g', ['g'], [div(r, 'i', ['i']), div(r, 'j', ['j']), div(r, 'k', [])])]);
    expect(m.get('g')?.style.alignItems).toBe('baseline');
    expect(['i', 'j', 'k'].map((id) => m.get(id)?.style.alignSelf)).toEqual(['baseline', 'baseline', 'auto']);
  });

  it('hands baseline alignment in the inline axis and last baseline alignment in both axes to the engine (GRID G3b)', () => {
    const css = '.g { display: grid; justify-items: first baseline; align-items: last baseline; } .i { justify-self: last baseline; align-self: baseline; } .j { justify-self: baseline; align-self: last baseline; } .x { position: absolute; align-self: last baseline; }';
    const m = boxes(`.g { position: relative; } ${css}`, (r) => [div(r, 'g', ['g'], [div(r, 'i', ['i']), div(r, 'j', ['j']), div(r, 'k', []), div(r, 'x', ['x'])])]);
    expect(m.get('g')?.style.grid?.justifyItems).toBe('baseline');
    expect(m.get('g')?.style.alignItems).toBe('last baseline');
    expect(['i', 'j', 'k', 'x'].map((id) => [item(m, id).justifySelf, m.get(id)?.style.alignSelf])).toEqual([['last baseline', 'baseline'], ['baseline', 'last baseline'], ['auto', 'auto'], ['auto', 'last baseline']]);
  });

  it('takes last baseline on every grid item, blockified inline-level elements and anonymous text items included, and refuses it on an inline box', () => {
    const span = (r: Parameters<typeof div>[0], id: string, classes: string[], children: Parameters<typeof div>[3] = []) => ({ ...div(r, id, classes, children), tag: 'span' });
    const css = '.g { display: grid; align-items: last baseline; } .i { align-self: last baseline; } .ib { display: inline-block; } .if { display: inline-flex; } .ig { display: inline-grid; }';
    // css-display-3 §2.7: a grid blockifies its children, so none of these is lowered as an inline box or an atomic inline.
    const m = boxes(css, (r) => [div(r, 'g', ['g'], [text(r, 't0', 'X'), span(r, 'a', ['i'], [text(r, 't1', 'X')]), span(r, 'b', ['i', 'ib'], [text(r, 't2', 'X')]), span(r, 'c', ['i', 'if'], [text(r, 't3', 'X')]), span(r, 'd', ['i', 'ig'], [span(r, 'e', ['i'], [text(r, 't4', 'X')])])])]);
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => [m.get(id)?.style.display, m.get(id)?.style.alignSelf])).toEqual([['block', 'last baseline'], ['block', 'last baseline'], ['flex', 'last baseline'], ['grid', 'last baseline'], ['block', 'last baseline']]);
    expect([m.get('g:anon0')?.style.alignSelf, m.get('g:anon0')?.style.gridItem]).toEqual(['auto', expect.anything()]);
    // An inline-grid among inline content is not a grid item, but its children are.
    const n = boxes(`.ig { display: inline-grid; align-items: last baseline; } .i { align-self: last baseline; }`, (r) => [div(r, 'p', [], [text(r, 't0', 'X'), span(r, 'g', ['ig'], [span(r, 'e', ['i'], [text(r, 't1', 'X')])])])]);
    expect([n.get('g')?.style.alignItems, n.get('e')?.style.alignSelf]).toEqual(['last baseline', 'last baseline']);
    // An inline box inside a grid item is not a grid item.
    const errors = compile(`${css} .s { align-self: last baseline; }`, (r) => [div(r, 'g', ['g'], [div(r, 'i', [], [text(r, 't0', 'X'), span(r, 's', ['s'], [text(r, 't1', 'X')])])])]).diagnostics.filter((d) => d.severity === 'error');
    expect(errors.map((d) => d.message).filter((msg) => msg.includes('align-self: last baseline on s') && msg.includes('last baseline aligns grid items only'))).toHaveLength(1);
  });

  it('refuses what the engine does not lay out: last baseline outside a grid and safe self-alignment; a flexible minimum never reaches it', () => {
    const refusal = (css: string): string[] => compile(css, (r) => [div(r, 'g', ['g'], [div(r, 'i', ['i'])])]).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`);
    expect(refusal('.g { display: grid; grid-template-columns: repeat(auto-fill, 20px); }')).toEqual([]);
    expect(refusal('.g { display: grid; grid-template-rows: 5px repeat(auto-fit, [a] 1em 10%) [b]; }')).toEqual([]);
    // GRID G3 and G3b: baseline alignment in both axes, first and last, lays out in a grid.
    expect(refusal('.g { display: grid; align-items: baseline; } .i { align-self: first baseline; }')).toEqual([]);
    expect(refusal('.g { display: grid; justify-items: first baseline; } .i { justify-self: last baseline; }')).toEqual([]);
    expect(refusal('.g { display: grid; align-items: last baseline; } .i { align-self: last baseline; }')).toEqual([]);
    // Last baseline stays refused on a flex container, a flex item and a block child.
    const lastRefused = (css: string, p: string): boolean => refusal(css).some((m) => m.includes(`${p}: last baseline`) && m.includes('last baseline aligns grid items only'));
    expect(lastRefused('.g { display: flex; align-items: last baseline; }', 'align-items')).toBe(true);
    expect(lastRefused('.g { display: flex; } .i { align-self: last baseline; }', 'align-self')).toBe(true);
    expect(lastRefused('.g { display: block; } .i { align-self: last baseline; }', 'align-self')).toBe(true);
    expect(lastRefused('.g { display: block; align-items: last baseline; }', 'align-items')).toBe(true);
    expect(refusal('.g { display: grid; justify-items: safe center; }').some((m) => m.startsWith('DRAGON_LOWERING_FAILED') && m.includes('justify-items: safe center'))).toBe(true);
    expect(refusal('.g { display: grid; grid-template-columns: 20px 30px; }')).toEqual([]);
    for (const p of ['height: 50%', 'min-height: 10%', 'max-height: calc(10px + 5%)']) {
      expect(refusal(`.g { display: grid; grid-template-rows: repeat(auto-fill, 20px); ${p}; }`).some((m) => m.startsWith('DRAGON_LOWERING_FAILED') && m.includes('beside repeat(auto-fill) or repeat(auto-fit) rows')), p).toBe(true);
      expect(refusal(`.g { display: grid; grid-template-columns: repeat(auto-fill, 20px); ${p}; }`).some((m) => m.includes('beside repeat(auto-fill)')), p).toBe(false);
    }
    expect(refusal('.g { display: grid; grid-template-rows: repeat(auto-fill, 20px); height: 100px; max-height: none; }')).toEqual([]);
  });

  it('refuses malformed computed values it is handed instead of lowering them: a zero line, a zero span, ragged areas', () => {
    const kw = (value: string): CssValue => ({ kind: 'keyword', value });
    const base: Partial<Record<Longhand, CssValue>> = {
      'grid-template-columns': kw('none'), 'grid-template-rows': kw('none'), 'grid-template-areas': kw('none'), 'grid-auto-columns': kw('auto'), 'grid-auto-rows': kw('auto'),
      'grid-auto-flow': kw('row'), 'justify-items': kw('normal'), 'justify-self': kw('auto'),
      'grid-column-start': kw('auto'), 'grid-column-end': kw('auto'), 'grid-row-start': kw('auto'), 'grid-row-end': kw('auto'),
    };
    const getter = (over: Partial<Record<Longhand, CssValue>>) => (p: Longhand): CssValue => {
      const v = over[p] ?? base[p];
      if (v === undefined) throw new Error(`no value for ${p}`);
      return v;
    };
    const container = lowerGridContainer(getter({}));
    expect(() => lowerGridItem(container, getter({ 'grid-column-start': { kind: 'other', type: 'integer', text: '0' } }))).toThrow(GridLoweringError);
    expect(() => lowerGridItem(container, getter({ 'grid-row-end': { kind: 'other', type: 'span-integer', text: 'span 0' } }))).toThrow(GridLoweringError);
    expect(() => lowerGridContainer(getter({ 'grid-template-areas': { kind: 'other', type: 'string', text: '"a a" "b"' } }))).toThrow(/not a rectangle/);
    expect(() => lowerGridContainer(getter({ 'grid-auto-flow': kw('dense row column') }))).toThrow(GridLoweringError);
  });
});
