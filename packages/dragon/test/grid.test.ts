// GRID G0: the grid longhands and shorthands and justify-items / justify-self are parsed, expanded and computed like Chrome 145
// (css/grid-values.ts, properties/grid.ts, shorthands/grid.ts), while grid layout stays refused: display: grid and inline-grid have
// no profile row. The live Chrome comparison is packages/parity/test/grid-computed.test.ts (this suite runs without a browser).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { resolveTree, valueToString } from '../src/analysis/resolve.ts';
import type { LinkedElement } from '../src/analysis/link.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS, PROPERTY_ROLE, SHORTHANDS } from '../src/css/properties.ts';
import { GRID_LONGHANDS, GRID_SHORTHANDS } from '../src/css/properties/grid.ts';
import * as backgroundLayers from '../src/css/properties/background-layers.ts';
import * as effects from '../src/css/properties/effects.ts';
import * as outline from '../src/css/properties/outline.ts';
import * as radius from '../src/css/properties/radius.ts';
import * as scrollbar from '../src/css/properties/scrollbar.ts';
import * as shadow from '../src/css/properties/shadow.ts';
import * as transform from '../src/css/properties/transform.ts';
import { SHORTHAND_HANDLERS } from '../src/css/shorthands/index.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { parseGridValue } from '../src/css/grid-values.ts';
import { list } from '../src/css/ast.ts';
import { parse } from 'css-tree';
import { NO_FAULTS } from '../src/faults.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { div, expectCatalogued, inputFor, spanTextOf, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/grid.css', revision: 'r1', hash: 'sha256:0' };

function declare(property: string, value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; span: string | null } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const d = diagnostics[0];
  const span = d !== undefined && d.origin.kind === 'authored' ? css.slice(d.origin.span.start, d.origin.span.end) : null;
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, span };
}

/** The longhands a declaration sets, as "property=value" with (i) for a shorthand-filled initial value. */
const expanded = (property: string, value: string): string[] => {
  const { declaration, diagnostics } = declare(property, value);
  expect(diagnostics, `${property}: ${value}`).toEqual([]);
  return (declaration?.longhands ?? []).map((l) => `${l.property}${l.explicit ? '' : '(i)'}=${valueToString(l.value)}`);
};

/** The EMS paint families (notes/T046-paint-spec.md §3 item 4), registered after grid. */
const PAINT_FAMILIES: readonly Record<string, unknown>[] = [radius, shadow, effects, outline, transform, backgroundLayers, scrollbar];

describe('grid family: registry', () => {
  it('twelve longhands and eight shorthands, appended after every other family but the paint families', () => {
    expect([...GRID_LONGHANDS]).toEqual([
      'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',
      'grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end', 'justify-items', 'justify-self',
    ]);
    // EMS registers the paint families after grid in every table (PIN-DERIVE: derived from the families, not a tail length).
    const after = (all: readonly string[], block: readonly string[], paint: readonly string[]): string[] => {
      const at = all.indexOf(block[0] as string);
      const problems = JSON.stringify(all.slice(at, at + block.length)) === JSON.stringify(block) ? [] : [`not one run: ${JSON.stringify(block)}`];
      return [...problems, ...all.slice(0, at).filter((p) => paint.includes(p)).map((p) => `${p} comes before the grid family`)];
    };
    const paint = PAINT_FAMILIES.flatMap((f) => Object.entries(f).filter(([k]) => k.endsWith('_LONGHANDS')).flatMap(([, v]) => v as readonly string[]));
    const paintShorthands = PAINT_FAMILIES.flatMap((f) => Object.entries(f).filter(([k]) => k.endsWith('_SHORTHANDS')).flatMap(([, v]) => v as readonly string[]));
    expect(after(LONGHANDS, GRID_LONGHANDS, paint)).toEqual([]);
    expect(after(SHORTHANDS, GRID_SHORTHANDS, paintShorthands)).toEqual([]);
    for (const p of GRID_LONGHANDS) {
      expect(INHERITED.has(p), p).toBe(false);
      expect(PROPERTY_ASPECTS[p], p).toEqual({ layout: true, paint: false });
    }
    expect(GRID_LONGHANDS.filter((p) => PROPERTY_ROLE[p] === 'item')).toEqual(['grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end', 'justify-self']);
    expect(SHORTHAND_HANDLERS.grid.longhands).toEqual(['grid-template-rows', 'grid-template-columns', 'grid-template-areas', 'grid-auto-rows', 'grid-auto-columns', 'grid-auto-flow']);
    expect(SHORTHAND_HANDLERS['grid-area'].longhands).toEqual(['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end']);
    expect(SHORTHAND_HANDLERS['grid-gap'].longhands).toEqual(['row-gap', 'column-gap']);
  });
  it('initial values come from the webref grammar', () => {
    expect(Object.fromEntries(GRID_LONGHANDS.map((p) => [p, grammar[p]?.initial]))).toEqual({
      'grid-template-columns': 'none', 'grid-template-rows': 'none', 'grid-template-areas': 'none', 'grid-auto-columns': 'auto', 'grid-auto-rows': 'auto',
      'grid-auto-flow': 'row', 'grid-row-start': 'auto', 'grid-row-end': 'auto', 'grid-column-start': 'auto', 'grid-column-end': 'auto',
      'justify-items': 'legacy', 'justify-self': 'auto',
    });
  });
});

describe('grid family: parse and expand', () => {
  it('track lists keep line names as written, lowercase keywords, and name their shape', () => {
    const { declaration } = declare('grid-template-columns', '[A b] 10PX [c] MinMax(1Em, 1FR) repeat(2, [d] fit-content(10%))');
    expect(declaration?.longhands[0]?.value).toEqual({ kind: 'other', type: 'track-list', text: '[A b] 10px [c] minmax(1em, 1fr) repeat(2, [d] fit-content(10%))' });
    expect(declare('grid-template-rows', 'repeat(auto-fill, minmax(10px, 1fr))').declaration?.longhands[0]?.value).toEqual({ kind: 'other', type: 'auto-track-list', text: 'repeat(auto-fill, minmax(10px, 1fr))' });
    expect(expanded('grid-auto-columns', 'MIN-CONTENT')).toEqual(['grid-auto-columns=min-content']);
    expect(expanded('grid-auto-rows', 'minmax(5px, auto) 1fr')).toEqual(['grid-auto-rows=minmax(5px, auto) 1fr']);
  });
  it('grid lines take Chrome\'s canonical order: span, integer, name', () => {
    expect(expanded('grid-row-start', '2 span')).toEqual(['grid-row-start=span 2']);
    expect(expanded('grid-row-start', 'a 2 span')).toEqual(['grid-row-start=span 2 a']);
    expect(expanded('grid-column-end', 'Foo -1')).toEqual(['grid-column-end=-1 Foo']);
    expect(declare('grid-row-start', 'span a').declaration?.longhands[0]?.value).toEqual({ kind: 'other', type: 'span-custom-ident', text: 'span a' });
  });
  it('grid-row, grid-column and grid-area copy a lone name into the omitted end lines (css-grid-2 §8.4)', () => {
    expect(expanded('grid-row', 'a')).toEqual(['grid-row-start=a', 'grid-row-end=a']);
    expect(expanded('grid-column', '2')).toEqual(['grid-column-start=2', 'grid-column-end(i)=auto']);
    expect(expanded('grid-area', 'a / b / c')).toEqual(['grid-row-start=a', 'grid-column-start=b', 'grid-row-end=c', 'grid-column-end=b']);
    expect(expanded('grid-area', '1 / a')).toEqual(['grid-row-start=1', 'grid-column-start=a', 'grid-row-end(i)=auto', 'grid-column-end=a']);
  });
  it('grid-template merges the line names between area rows and fills omitted row sizes with auto (css-grid-2 §7.4)', () => {
    expect(expanded('grid-template', '[x] "a b" 10px [y] [z] "c d" [w] / [p] 1fr [q] 2fr')).toEqual([
      'grid-template-rows=[x] 10px [y z] auto [w]', 'grid-template-columns=[p] 1fr [q] 2fr', 'grid-template-areas="a b" "c d"',
    ]);
    expect(expanded('grid-template', '10px 1fr / auto')).toEqual(['grid-template-rows=10px 1fr', 'grid-template-columns=auto', 'grid-template-areas=none']);
  });
  it('grid sets one axis from auto-flow and resets the rest (css-grid-2 §7.8)', () => {
    expect(expanded('grid', '10px / auto-flow dense 20px')).toEqual([
      'grid-template-rows=10px', 'grid-template-columns=none', 'grid-template-areas=none', 'grid-auto-rows(i)=auto', 'grid-auto-columns=20px', 'grid-auto-flow=column dense',
    ]);
    expect(expanded('grid', '"a" 10px / 1fr')).toEqual([
      'grid-template-rows=10px', 'grid-template-columns=1fr', 'grid-template-areas="a"', 'grid-auto-rows(i)=auto', 'grid-auto-columns(i)=auto', 'grid-auto-flow(i)=row',
    ]);
  });
  it('areas are written with one space between cells and dots collapsed', () => {
    expect(expanded('grid-template-areas', "'a...b  ..c'")).toEqual(['grid-template-areas="a . b . c"']);
  });
  it('justify-* keywords take Chrome\'s serialized form, and the gap aliases set gap longhands', () => {
    expect(expanded('justify-items', 'center legacy')).toEqual(['justify-items=legacy center']);
    expect(expanded('justify-self', 'first baseline')).toEqual(['justify-self=baseline']);
    expect(expanded('justify-self', 'unsafe self-end')).toEqual(['justify-self=unsafe self-end']);
    expect(expanded('grid-auto-flow', 'dense row')).toEqual(['grid-auto-flow=dense']);
    expect(expanded('grid-gap', '1px 2px')).toEqual(['row-gap=1px', 'column-gap=2px']);
    expect(expanded('grid-column-gap', '3px')).toEqual(['column-gap=3px']);
  });
  it('values Chrome drops beyond the webref grammar are DRAGON_CSS_INVALID_VALUE with the rule', () => {
    const cases = [
      ['grid-template-columns', 'repeat(auto-fill, 1fr)', 'an automatic repetition takes only fixed sizes'],
      ['grid-template-columns', '[span] 10px', 'line names may not be span, auto, default or a CSS-wide keyword'],
      ['grid-template-areas', '"a a" "a b"', 'every named area must be a filled rectangle'],
      ['grid-template-areas', '"a b" "c"', 'every row needs the same number of cells'],
      ['grid-template-areas', '"a # b"', 'a cell name uses only name code points'],
      ['justify-self', 'safe normal', 'safe or unsafe goes only before a position'],
      ['justify-self', 'baseline last', 'first or last goes before baseline'],
    ] as const;
    for (const [p, v, rule] of cases) {
      const { declaration, diagnostics } = declare(p, v);
      expect(declaration, `${p}: ${v}`).toBeNull();
      expect(diagnostics.map((d) => d.code), `${p}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expect((diagnostics[0] as Diagnostic).message, `${p}: ${v}`).toContain(rule);
      expectCatalogued(diagnostics);
    }
  });
  it('subgrid, math functions and units with no build-time conversion are refused at the token', () => {
    for (const [p, v, token] of [
      ['grid-template-columns', 'subgrid [a]', 'subgrid'],
      ['grid-template', 'subgrid / 10px', 'subgrid'],
      ['grid-template-columns', 'minmax(calc(10px + 5%), 1fr)', 'calc(10px + 5%)'],
      ['grid-auto-rows', 'repeat(2, 10vw)', null],
      ['grid-template-rows', 'repeat(2, 10vw)', '10vw'],
      // V1 resolves viewport units in box lengths only; every one is refused inside a grid value, at any depth and in any case.
      ['grid-template-columns', 'minmax(3vw, auto) 1fr', '3vw'],
      ['grid-auto-columns', 'fit-content(100VW)', '100VW'],
      ['grid-auto-rows', '1fr 10vh', '10vh'],
      ['grid-template-columns', '[a] 2vi', '2vi'],
      ['grid-template-rows', '2vb', '2vb'],
      ['grid', 'auto-flow / 1vmin', '1vmin'],
      ['grid-template', '10px / 1Vmax', '1Vmax'],
      ['grid-template-columns', '10svw', '10svw'],
    ] as const) {
      const { declaration, diagnostics, span } = declare(p, v);
      expect(declaration, `${p}: ${v}`).toBeNull();
      if (token === null) {
        expect(diagnostics.map((d) => d.code), `${p}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
        continue;
      }
      expect(diagnostics.map((d) => d.code), `${p}: ${v}`).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      expect(span, `${p}: ${v}`).toBe(token);
    }
  });
  it('subgrid is refused only as the top-level track-list keyword; as a line name it is a name like any other', () => {
    for (const [p, v] of [['grid-template-columns', 'subgrid'], ['grid-template-rows', 'subgrid [a]'], ['grid-template', 'subgrid / 10px'], ['grid', 'auto-flow / subgrid']] as const) {
      const { diagnostics, span } = declare(p, v);
      expect(diagnostics.map((d) => d.code), `${p}: ${v}`).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      expect(span, `${p}: ${v}`).toBe('subgrid');
    }
    expect(expanded('grid-row-start', 'subgrid')).toEqual(['grid-row-start=subgrid']);
    expect(expanded('grid-area', 'subgrid / a')).toEqual(['grid-row-start=subgrid', 'grid-column-start=a', 'grid-row-end=subgrid', 'grid-column-end=a']);
    expect(expanded('grid-template-columns', 'repeat(2, [subgrid] 10px)')).toEqual(['grid-template-columns=repeat(2, [subgrid] 10px)']);
    expect(expanded('grid', '[subgrid] 10px / auto-flow')).toEqual([
      'grid-template-rows=[subgrid] 10px', 'grid-template-columns=none', 'grid-template-areas=none', 'grid-auto-rows(i)=auto', 'grid-auto-columns(i)=auto', 'grid-auto-flow=column',
    ]);
  });
  it('escaped function names, units and keywords read as their decoded value (css-syntax-3 §4.3.7); names serialize as CSSOM identifiers', () => {
    // CSS-ESC: Chrome 145 decodes escapes before keyword and grammar matching, so these are the unescaped values (probed).
    expect(declare('grid-template-columns', 'c\\61lc(10px + 5%)').diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('calc() is a css-values-4 math function')]);
    expect(declare('grid-template-columns', '10\\76w').diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    for (const v of ['\\72 epeat(auto-fill, 1fr)', 'repeat(auto-fill, 1\\66r)']) expect(declare('grid-template-columns', v).diagnostics.map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(expanded('grid-template-columns', '2\\65m \\72 epeat(2, 1\\66r) \\6d in-content')).toEqual(['grid-template-columns=2em repeat(2, 1fr) min-content']);
    expect(expanded('grid-row-start', '\\73 pan 2')).toEqual(['grid-row-start=span 2']);
    expect(expanded('grid-row-start', '\\61uto')).toEqual(['grid-row-start=auto']);
    expect(expanded('grid-row', '\\61uto / 2')).toEqual(['grid-row-start=auto', 'grid-row-end=2']);
    for (const v of ['span \\61uto', '\\64 efault']) expect(declare('grid-row-start', v).diagnostics.map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(expanded('grid-template-columns', '[\\31 foo] 10px')).toEqual(['grid-template-columns=[\\31 foo] 10px']);
    expect(expanded('grid-template-columns', '[\\61 bc \\31 23] 10px')).toEqual(['grid-template-columns=[abc \\31 23] 10px']);
    expect(expanded('grid-column', '\\31 foo')).toEqual(['grid-column-start=\\31 foo', 'grid-column-end=\\31 foo']);
    expect(expanded('grid-row-start', '2 \\31 foo')).toEqual(['grid-row-start=2 \\31 foo']);
    expect(expanded('grid-template-areas', '"\\2e a"')).toEqual(['grid-template-areas=". a"']);
    for (const v of ['[\\73 pan] 10px', '[\\61uto] 10px', '[\\64 efault] 10px', '[\\69nherit] 10px']) {
      expect(declare('grid-template-columns', v).diagnostics.map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    }
  });
  it('the hook checks the whole css-grid-2 track grammar itself, not only what the webref grammar leaves (PR #23 round 4)', () => {
    const hook = (p: string, v: string): string => {
      const tokens = list(parse(v, { context: 'value', positions: true }), 'children').filter((n) => n.type !== 'WhiteSpace');
      const r = parseGridValue(p, tokens, { source: SOURCE, start: 0, end: v.length });
      return r.kind === 'ok' ? r.longhands.map((l) => valueToString(l.value)).join(' | ') : r.kind;
    };
    const dropped = [
      // 4137427164: <auto-track-list> holds exactly one automatic repetition.
      ['grid-template-columns', 'repeat(auto-fill, 10px) repeat(auto-fit, 10px)'],
      // 4137427213: the tracks beside an automatic repetition are fixed sizes or fixed repeats.
      ['grid-template-columns', 'repeat(auto-fill, 10px) repeat(2, 1fr)'],
      ['grid-template-columns', 'repeat(auto-fill, 10px) 1fr'],
      // 4137427204: minmax(<inflexible-breadth>, <fixed-breadth>) takes no flexible minimum.
      ['grid-template-columns', 'repeat(auto-fill, minmax(1fr, 10px))'],
      ['grid-template-columns', 'minmax(1fr, 10px)'],
      // 4137427189: the areas form of grid-template takes <track-size> rows and an <explicit-track-list>, so no repeat().
      ['grid-template', '"a b" repeat(2, 10px)'],
      ['grid-template', '"a b" 10px / repeat(auto-fill, 10px)'],
      ['grid-template', '"a b" 10px / repeat(2, 1fr)'],
      ['grid', '"a b" 10px / repeat(2, 1fr)'],
      // The rest of the grammar the hook now checks on its own.
      ['grid-template-columns', '[a] [b] 10px'],
      ['grid-template-columns', '-10px'],
      ['grid-template-columns', 'repeat(0, 10px)'],
      ['grid-template-columns', 'repeat(2, repeat(2, 10px))'],
      ['grid-auto-rows', '[a] 10px'],
      ['grid-auto-rows', 'repeat(2, 10px)'],
      ['grid-auto-flow', 'row column'],
      ['grid', 'auto-flow auto-flow / 10px'],
      ['grid', '10px auto-flow / 10px'],
      ['justify-self', 'safe stretch'],
      ['justify-self', 'legacy'],
      ['justify-items', 'auto'],
      ['justify-items', 'legacy start'],
      ['grid-template-areas', '"a" none'],
    ] as const;
    for (const [p, v] of dropped) {
      expect(hook(p, v), `${p}: ${v}`).toBe('invalid');
      expect(declare(p, v).declaration, `${p}: ${v}`).toBeNull();
    }
    expect(hook('grid-template-columns', 'repeat(auto-fill, 10px) minmax(auto, 10px) repeat(2, 5px)')).toBe('repeat(auto-fill, 10px) minmax(auto, 10px) repeat(2, 5px)');
    expect(hook('grid-template-columns', 'repeat(auto-fill, minmax(auto, 10px))')).toBe('repeat(auto-fill, minmax(auto, 10px))');
    expect(hook('grid-template-columns', 'repeat(2, [a] 1fr minmax(min-content, 2fr)) [b]')).toBe('repeat(2, [a] 1fr minmax(min-content, 2fr)) [b]');
    expect(hook('grid-template', '[a] "x" 10px [b] [c] "y" / [d] 1fr')).toBe('[a] 10px [b c] auto | [d] 1fr | "x" "y"');
    expect(hook('grid', 'dense auto-flow 1fr / 10px')).toBe('none | 10px | none | 1fr | auto | dense');
    expect(hook('justify-items', 'anchor-center')).toBe('anchor-center');
  });
  it('computed text takes Chrome 145\'s computed form: zero lengths, number forms, empty names, flex minmax, span 1 and clamped integers (PR #23 round 5)', () => {
    const cases = [
      ['grid-template-columns', 'minmax(0, 1fr)', 'minmax(0px, 1fr)'],
      ['grid-template-columns', '0', '0px'],
      ['grid-template-columns', 'repeat(2, 0)', 'repeat(2, 0px)'],
      ['grid-template-columns', '[a] 0 [b]', '[a] 0px [b]'],
      ['grid-template-columns', 'fit-content(0)', 'fit-content(0px)'],
      ['grid-auto-rows', '0', '0px'],
      ['grid-template-columns', '+5px .5fr 1e1px 10.0% -0px', '5px 0.5fr 10px 10% 0px'],
      ['grid-template-columns', '[] 10px repeat(2, [] 1px) []', '10px repeat(2, 1px)'],
      ['grid-template-columns', 'minmax(auto, 1fr) minmax(AUTO, 0fr) minmax(min-content, 1fr)', '1fr 0fr minmax(min-content, 1fr)'],
      ['grid-template-columns', 'repeat(99999999999, 1px 1px) repeat(+3, 1px)', 'repeat(5000000, 1px 1px) repeat(3, 1px)'],
      ['grid-template-columns', '[\\1F600 x\\ y] 1px [\\-\\-a \\31 foo \\-]', '[😀x\\ y] 1px [--a \\31 foo \\-]'],
      ['grid-row-start', 'span 1 a', 'span a'],
      ['grid-row-start', 'span 1', 'span 1'],
      ['grid-row-start', '99999999999', '10000000'],
      ['grid-row-start', '-99999999999 a', '-10000000 a'],
      ['grid-row-start', '+3', '3'],
      ['grid-row-start', '\\1F600', '😀'],
    ] as const;
    for (const [p, v, want] of cases) expect(expanded(p, v).map((x) => x.slice(x.indexOf('=') + 1)).join(' | '), `${p}: ${v}`).toBe(want);
    expect(expanded('grid-template', '[] "a" minmax(auto, 1fr) [] / [] minmax(auto, 2fr)')).toEqual(['grid-template-rows=1fr', 'grid-template-columns=2fr', 'grid-template-areas="a"']);
  });
  it('area rows are scanned by code point, so non-BMP names are one cell', () => {
    expect(expanded('grid-template-areas', '"a😀b c" "d d"')).toEqual(['grid-template-areas="a😀b c" "d d"']);
    expect(expanded('grid-template-areas', '"😀"')).toEqual(['grid-template-areas="😀"']);
    expect(declare('grid-template-areas', '"😀 😀" "😀 x"').diagnostics.map((d) => d.code)).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
  it('masonry is outside the grammar', () => {
    expect(declare('grid-template-rows', 'masonry').diagnostics.map((d) => d.code)).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
});

describe('grid family: computed values', () => {
  const origin = { kind: 'unlocated', reason: 'test' } as const;
  const el = (id: string, tag: string, classes: string[], children: LinkedElement[] = []): LinkedElement => ({
    kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: classes.map((name) => ({ owner: 'doc', sheet: 's', name })), attributes: new Map(), children,
    node: { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin },
  });
  const resolve = (css: string, tree: LinkedElement) => {
    const diagnostics: Diagnostic[] = [];
    const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
    expect(diagnostics).toEqual([]);
    return resolveTree(tree, rules, NO_FAULTS, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  };
  const valueAt = (root: ReturnType<typeof resolve>, path: number[], p: (typeof LONGHANDS)[number]): string => {
    let at = root;
    for (const i of path) at = at.children[i] as typeof root;
    return valueToString(at.props.get(p)?.value ?? { kind: 'keyword', value: '?' });
  };
  it('lengths inside track lists compute to px: em against the element, rem against the root, absolute units by ratio', () => {
    const root = resolve('.g { font-size: 10px; grid-template-columns: 2em minmax(1rem, 1fr) 1in; grid-auto-rows: 3em; }', el('html', 'html', [], [el('body', 'body', [], [el('g', 'div', ['g'])])]));
    expect(valueAt(root, [0, 0], 'grid-template-columns')).toBe('20px minmax(16px, 1fr) 96px');
    expect(valueAt(root, [0, 0], 'grid-auto-rows')).toBe('30px');
  });
  it('justify-items legacy computes to the parent\'s legacy position, and to normal otherwise (css-align-3 §6.2)', () => {
    const tree = el('html', 'html', [], [el('body', 'body', [], [el('p', 'div', ['p'], [el('c', 'div', [], [el('g', 'div', [])]), el('n', 'div', ['n'])])])]);
    const root = resolve('.p { justify-items: legacy right; } .n { justify-items: legacy; }', tree);
    expect(valueAt(root, [0], 'justify-items')).toBe('normal');
    expect(valueAt(root, [0, 0], 'justify-items')).toBe('legacy right');
    expect(valueAt(root, [0, 0, 0], 'justify-items')).toBe('legacy right');
    expect(valueAt(root, [0, 0, 0, 0], 'justify-items')).toBe('legacy right');
    expect(valueAt(root, [0, 0, 1], 'justify-items')).toBe('legacy right');
    expect(valueAt(resolve('.p { justify-items: center; }', tree), [0, 0, 0], 'justify-items')).toBe('normal');
  });
});

describe('grid family: compile', () => {
  const project = () => createProject({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' } } });
  const tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])];
  it('grid values on block boxes compile for web and ios, and the web CSS writes every grid longhand', () => {
    const c = project().compile(inputFor('.a { width: 100px; grid-template-columns: repeat(2, 1fr); grid-template-areas: "x y"; } .b { grid-area: 1 / 2; font-family: Ahem; font-size: 10px; }', tree));
    expect(c.diagnostics).toEqual([]);
    const web = c.outputs.web;
    const css = web.kind === 'ready' ? (web.files[0]?.text ?? '') : '';
    expect(css).toContain('  grid-template-columns: repeat(2, 1fr);\n');
    expect(css).toContain('  grid-template-areas: "x y";\n');
    expect(css).toContain('  grid-row-start: 1;\n');
    expect(css).toContain('  grid-column-start: 2;\n');
    expect(css).toContain('  justify-items: normal;\n');
    expect(c.outputs.ios.kind).toBe('analysis-only');
  });
  for (const value of ['grid', 'inline-grid']) {
    it(`display: ${value} stays refused until the grid engine lands`, () => {
      const input = inputFor(`.a { display: ${value}; width: 100px; }`, tree);
      const c = project().compile(input);
      expect(c.ok).toBe(false);
      expect(c.outputs.web.kind).toBe('blocked');
      expect(c.outputs.ios.kind).toBe('blocked');
      const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE') as Diagnostic;
      expect(spanTextOf(input, d)).toBe(value);
      expectCatalogued(c.diagnostics);
    });
  }
  it('justify-self on a block child is refused: Chrome aligns block boxes by it', () => {
    const input = inputFor('.a { width: 100px; } .b { width: 20px; justify-self: center; font-family: Ahem; font-size: 10px; }', tree);
    const c = project().compile(input);
    expect(c.ok).toBe(false);
    expect(c.diagnostics.map((d) => `${d.code} ${String(d.target)} ${String(spanTextOf(input, d))}`).sort()).toEqual(['DRAGON_UNPROVEN_CONTEXT ios center', 'DRAGON_UNPROVEN_CONTEXT web center']);
  });
});
