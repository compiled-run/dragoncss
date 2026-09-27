import { describe, expect, it } from 'vitest';
import type { LayoutBox, TextLeaf } from '@dragon/layout';
import type { Diagnostic, FrontEndResult, TreeNode } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS, textTopology } from '../src/internal.ts';
import { validateInput } from '../src/analysis/input.ts';
import type { LinkedElement } from '../src/analysis/link.ts';
import { linkDocument } from '../src/analysis/link.ts';
import { collapseInlineRun } from '../src/analysis/resolve.ts';
import { div, expectCatalogued, explainOne, inputFor, text } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const derive = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });

function lowered(input: FrontEndResult, faults = NO_FAULTS): LayoutBox {
  const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults, profiles: 'derive', direction: 'ltr' }).compile(input);
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') throw new Error(`${p.reason} ${c.diagnostics.map((d) => d.message).join('; ')}`);
  return p.input.root;
}

function find(b: LayoutBox, id: string): LayoutBox | TextLeaf | undefined {
  if (b.id === id) return b;
  for (const c of b.children) {
    if (c.id === id) return c;
    if (c.kind === 'box') {
      const hit = find(c, id);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

const summary = (b: LayoutBox | TextLeaf | undefined): unknown =>
  b === undefined ? undefined : b.kind === 'text' ? `${b.id}=${JSON.stringify(b.text)}` : `${b.id}(${b.boxType})[${b.children.map((c) => (c.kind === 'text' ? `${c.id}=${JSON.stringify(c.text)}` : c.id)).join(' ')}]`;

describe('white-space phase I over one inline formatting context (css-text-3 §4.1.1)', () => {
  it('collapses each white space sequence to one space kept by the run where it starts, across run boundaries', () => {
    expect(collapseInlineRun(['XX ', ' YY'])).toEqual(['XX ', 'YY']);
    expect(collapseInlineRun(['XX', ' \n YY'])).toEqual(['XX', ' YY']);
    expect(collapseInlineRun(['XX\t\t', 'YY'])).toEqual(['XX ', 'YY']);
  });
  it('removes the spaces at the start and end of the context, which begin and end a line (§4.1.2)', () => {
    expect(collapseInlineRun(['  XX   XX\n   XX\tXX  '])).toEqual(['XX XX XX XX']);
    expect(collapseInlineRun([' ', 'XX', ' '])).toEqual(['', 'XX', '']);
  });
  it('removes a segment break next to U+200B (§4.1.3), and keeps it as a space otherwise', () => {
    expect(collapseInlineRun(['XX​\nYY'])).toEqual(['XX​YY']);
    expect(collapseInlineRun(['XX \n ​YY'])).toEqual(['XX​YY']);
    expect(collapseInlineRun(['XX \n YY'])).toEqual(['XX YY']);
  });
});

describe('MF4: whitespace-only text never has an empty address', () => {
  const tree = (children: (r: Parameters<typeof div>[0]) => TreeNode[]) => inputFor(FONT, (r) => [div(r, 'a', [], children(r))]);
  const linkedTexts = (input: FrontEndResult): string[] => {
    const diagnostics: Diagnostic[] = [];
    const valid = validateInput(input, 'test', diagnostics);
    if (valid === null) throw new Error(JSON.stringify(diagnostics));
    const linked = linkDocument(valid, { stateCollapse: null }, diagnostics);
    const out: string[] = [];
    const walk = (el: LinkedElement): void => {
      for (const c of el.children) {
        if (c.kind === 'element') walk(c);
        else out.push(c.address);
      }
    };
    walk((linked?.cases[0] as { root: LinkedElement }).root);
    return out;
  };
  const collapsing = tree((r) => [text(r, 's0', '\n  '), div(r, 'b', []), text(r, 't0', 'XX '), text(r, 's1', ' '), text(r, 't1', 'YY'), text(r, 's2', ' \n')]);
  it('every text node gets a unique address: <element>:text<k>, or <element>:space<k> when whitespace-only', () => {
    expect(linkedTexts(collapsing)).toEqual(['a:space0', 'a:text0', 'a:space1', 'a:text1', 'a:space2']);
  });
  it('the collapse rule removes whitespace-only text beside a block, after a space and at the edges of a context', () => {
    expect(summary(find(lowered(collapsing), 'a'))).toBe('a(element)[b a:anon0]');
    expect(summary(find(lowered(collapsing), 'a:anon0'))).toBe('a:anon0(anonymous)[a:text0="XX " a:text1="YY"]');
  });
  it('a whitespace-only text node whose space survives between runs is laid out under its own address', () => {
    const between = tree((r) => [text(r, 't0', 'XX'), text(r, 's0', '   '), text(r, 't1', 'YY')]);
    expect(summary(find(lowered(between), 'a'))).toBe('a(element)[a:text0="XX" a:space0=" " a:text1="YY"]');
  });
});

describe('text nodes carry their inherited text styles (goal.md principle 3)', () => {
  const input = inputFor(`${FONT} .p { line-height: 1.5; text-align: center; color: #102030; white-space: nowrap; }`, (r) => [div(r, 'p', ['p'], [text(r, 't', 'XX XX')])]);
  it('each of the eight text properties has an Origin of kind inherited naming the insertion parent', () => {
    const c = derive().compile(input);
    const topo = textTopology(c, []);
    expect(topo?.map((t) => t.address)).toEqual(['p:text0']);
    const t = (topo ?? [])[0];
    expect(Object.keys(t?.inherited ?? {}).sort()).toEqual(['color', 'direction', 'font-family', 'font-size', 'line-height', 'text-align', 'text-wrap-mode', 'white-space-collapse']);
    for (const o of Object.values(t?.inherited ?? {})) expect(o).toMatchObject({ kind: 'inherited', element: 'p' });
    expect(t?.inherited['font-size']).toMatchObject({ kind: 'inherited', element: 'p', from: { kind: 'inherited', element: 'body', from: { kind: 'authored' } } });
    expect(t?.context).toBe('text-in-block/ltr');
  });
  it('the lowering reads the text node, never its parent: a text node with a dropped font-size lays out at its own 16px', () => {
    expect(find(lowered(input), 'p:text0')).toEqual({ kind: 'text', id: 'p:text0', text: 'XX XX', font: { family: 'Ahem', size: 10 }, lineHeight: { kind: 'number', value: 1.5 }, whiteSpaceCollapse: 'collapse', textWrapMode: 'nowrap' });
    const faulty = find(lowered(input, { ...NO_FAULTS, dropInheritedText: true }), 'p:text0');
    expect(faulty?.kind === 'text' && faulty.font.size).toBe(16);
    expect((find(lowered(input, { ...NO_FAULTS, dropInheritedText: true }), 'p') as LayoutBox).style.textAlign).toBe('center');
  });
});

describe('anonymous boxes are made by the compiler (CSS2 §9.2.1.1, css-flexbox-1 §4)', () => {
  const css = `${FONT} .m { text-align: center; padding: 3px; margin-top: 7px; width: 50px; } .f { display: flex; } .none { display: none; }`;
  it('text beside blocks is wrapped per run, inheriting inherited properties and taking initial values for the rest', () => {
    const root = lowered(inputFor(css, (r) => [div(r, 'm', ['m'], [text(r, 't0', 'XX'), div(r, 'b', []), text(r, 't1', ' YY ')])]));
    expect(summary(find(root, 'm'))).toBe('m(element)[m:anon0 b m:anon1]');
    const anon = find(root, 'm:anon0') as LayoutBox;
    expect(anon.style).toMatchObject({ display: 'block', textAlign: 'center', direction: 'ltr', width: { kind: 'auto' }, marginTop: { kind: 'px', value: 0 }, paddingTop: { kind: 'px', value: 0 }, flexGrow: 0, flexShrink: 1, alignSelf: 'auto' });
    expect(summary(find(root, 'm:anon1'))).toBe('m:anon1(anonymous)[m:text1="YY"]');
  });
  it('text directly in a flex container becomes anonymous flex items', () => {
    const root = lowered(inputFor(css, (r) => [div(r, 'f', ['f'], [text(r, 't0', 'XX '), div(r, 'i', []), text(r, 't1', 'YY')])]));
    expect(summary(find(root, 'f'))).toBe('f(element)[f:anon0 i f:anon1]');
    expect(summary(find(root, 'f:anon0'))).toBe('f:anon0(anonymous)[f:text0="XX"]');
  });
  it('display: none elements generate no box, so beside text they are left out and do not split the run', () => {
    const root = lowered(inputFor(css, (r) => [div(r, 'm', ['m'], [text(r, 't0', 'XX '), div(r, 'h', ['none']), text(r, 't1', ' YY')])]));
    expect(summary(find(root, 'm'))).toBe('m(element)[m:text0="XX " m:text1="YY"]');
  });
  it('text row keys name the text context of each text node a declaration reaches', () => {
    const c = derive().compile(inputFor(`${FONT} .f { display: flex; line-height: 2; }`, (r) => [
      div(r, 'm', [], [text(r, 't0', 'XX'), div(r, 'b', [], [text(r, 't1', 'YY')])]),
      div(r, 'f', ['f'], [text(r, 't2', 'ZZ'), div(r, 'i', [], [text(r, 't3', 'WW')])]),
    ]));
    const keys = compiledFeatures(c, 'ios', []).filter((k) => k.startsWith('font-size') || k.startsWith('line-height'));
    expect(keys).toEqual([
      'font-size:<length-px>@text-as-anonymous-flex-item/row/ltr',
      'font-size:<length-px>@text-in-anonymous-block/ltr',
      'font-size:<length-px>@text-in-block/ltr',
      'font-size:<length-px>@text-in-flex-item/row/ltr',
      'line-height:<number>@text-as-anonymous-flex-item/row/ltr',
      'line-height:<number>@text-in-flex-item/row/ltr',
    ]);
  });
});

describe('white-space is a shorthand over white-space-collapse and text-wrap-mode (webref 8.7.5)', () => {
  const both = () => createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });
  const compile = (decl: string) => both().compile(inputFor(`${FONT} .a { ${decl} }`, (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX')])]));
  it('normal and nowrap set both longhands', () => {
    for (const [decl, collapse, wrap] of [['white-space: normal;', 'collapse', 'wrap'], ['white-space: nowrap;', 'collapse', 'nowrap']] as const) {
      const c = compile(decl);
      expect(c.ok, decl).toBe(true);
      expect(explainOne(c, 'web', 'a', 'white-space-collapse').value, decl).toBe(collapse);
      expect(explainOne(c, 'web', 'a', 'text-wrap-mode').value, decl).toBe(wrap);
    }
  });
  it('pre, pre-wrap and pre-line set a collapse mode no profile supports: DRAGON_UNSUPPORTED_VALUE on the value', () => {
    for (const v of ['pre', 'pre-wrap', 'pre-line']) {
      const c = compile(`white-space: ${v};`);
      expectCatalogued(c.diagnostics);
      const d = c.diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(d.length, v).toBeGreaterThan(0);
      expect(d.every((x) => x.origin.kind === 'authored' && `${FONT} .a { white-space: ${v}; }`.slice(x.origin.span.start, x.origin.span.end) === v), v).toBe(true);
      expect(c.outputs.ios.kind).toBe('blocked');
    }
  });
  it('a value that sets white-space-trim is DRAGON_UNSUPPORTED_VALUE on its keyword', () => {
    const c = compile('white-space: collapse discard-before;');
    expect(c.diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    const d = c.diagnostics[0] as Diagnostic;
    expect(d.origin.kind === 'authored' && `${FONT} .a { white-space: collapse discard-before; }`.slice(d.origin.span.start, d.origin.span.end)).toBe('discard-before');
  });
});
