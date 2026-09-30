// GRID G1a lowering (lower/grid-layout.ts): computed grid values to the engine's grid input, with every item line resolved by the
// compiler as Blink's GridLineResolver does; the grid formatting contexts of the support profiles; and the refusals of the values
// G1a does not lay out. Layout itself is proven against Chrome by packages/parity/test/grid-corpus-*.test.ts and the grid fixtures.
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

  it('refuses what G1a does not lay out: automatic repetition, baseline and safe self-alignment, and a flexible minimum never reaches it', () => {
    const refusal = (css: string): string[] => compile(css, (r) => [div(r, 'g', ['g'], [div(r, 'i', ['i'])])]).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`);
    expect(refusal('.g { display: grid; grid-template-columns: repeat(auto-fill, 20px); }').some((m) => m.startsWith('DRAGON_LOWERING_FAILED') && m.includes('repeat(auto-fill) and repeat(auto-fit) are not supported yet'))).toBe(true);
    expect(refusal('.g { display: grid; } .i { justify-self: baseline; }').some((m) => m.startsWith('DRAGON_LOWERING_FAILED') && m.includes('justify-self: baseline'))).toBe(true);
    expect(refusal('.g { display: grid; justify-items: safe center; }').some((m) => m.startsWith('DRAGON_LOWERING_FAILED') && m.includes('justify-items: safe center'))).toBe(true);
    expect(refusal('.g { display: grid; grid-template-columns: 20px 30px; }')).toEqual([]);
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
