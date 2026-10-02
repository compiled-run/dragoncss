import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LayoutBox, LayoutStyle } from '@dragon/layout';
import type { FrontEndResult } from '../src/index.ts';
import * as publicEntry from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from '../src/analysis/resolve.ts';
import { initialValue } from '../src/analysis/resolve.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { INHERITED, LONGHANDS } from '../src/css/properties.ts';
import type { Longhand } from '../src/css/properties.ts';
import type { CssValue } from '../src/css/stylesheet.ts';
import { assertTextCarriesContainer, lowerStyle } from '../src/lower/ios-layout.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf, text } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, rootFont: 'ua-default' } as const;
const project = (direction: 'ltr' | 'rtl', profiles: 'enforce' | 'derive' = 'derive') => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles, direction });

function projection(input: FrontEndResult, direction: 'ltr' | 'rtl' = 'ltr'): LayoutBox {
  const c = project(direction).compile(input);
  const p = iosLayoutProjection(c, { ...ENV, direction }, []);
  if (p.kind !== 'ready') throw new Error(`${p.reason} ${c.diagnostics.map((d) => d.message).join('; ')}`);
  return p.input.root;
}

function boxes(b: LayoutBox, out: LayoutBox[] = []): LayoutBox[] {
  out.push(b);
  for (const c of b.children) if (c.kind === 'box') boxes(c, out);
  return out;
}

describe('B1: the environment direction (docs/api.md §7)', () => {
  const input = () => inputFor(`${FONT} .a { width: 50px; }`, (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX')])]);
  it('reaches the root as a resolved value with origin environment, never as an author declaration, and is inherited', () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      const c = project(direction).compile(input());
      expect(explainOne(c, 'ios', 'html', 'direction')).toMatchObject({ value: direction, cascade: 'environment', origin: { kind: 'builtin', dataset: 'reference environment' } });
      expect(explainOne(c, 'ios', 'a', 'direction')).toMatchObject({ value: direction, cascade: 'inherited' });
      expect(boxes(projection(input(), direction)).map((b) => b.style.direction)).toEqual(['html', 'body', 'a'].map(() => direction));
    }
  });
  it('an author declaration on the root wins over the environment', () => {
    const c = project('rtl').compile(inputFor(`${FONT} html { direction: ltr; }`, (r) => [div(r, 'a', [])]));
    expect(explainOne(c, 'ios', 'html', 'direction')).toMatchObject({ value: 'ltr', cascade: 'author' });
  });
  it('the projection refuses an environment whose direction the result was not resolved for, and the digests differ', () => {
    const ltr = project('ltr').compile(input());
    const rtl = project('rtl').compile(input());
    expect(iosLayoutProjection(ltr, { ...ENV, direction: 'rtl' }, []).kind).toBe('blocked');
    expect(iosLayoutProjection(rtl, { ...ENV, direction: 'ltr' }, []).kind).toBe('blocked');
    expect(ltr.digest).not.toBe(rtl.digest);
  });
  it('MF2: Environment, direction, platform and the internal options stay off the public entry; createProject compiles for ltr on the reference platform', () => {
    // S5 adds exactly formatDiagnostics (T005 rec 5) and querySupport (docs/api.md §6.3).
    expect(Object.keys(publicEntry).sort()).toEqual(['TREE_SCHEMA_REVISION', 'createProject', 'formatDiagnostic', 'formatDiagnostics', 'querySupport']);
    expect(createProject.length).toBe(1);
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).not.toMatch(/Environment|InternalOptions|direction|platform|rootFont/);
    const c = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }).compile(input());
    expect(c.digest).toBe(createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' }).compile(input()).digest);
    expect(c.digest).toBe(createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ua-default' }).compile(input()).digest);
    expect(c.digest).not.toBe(createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', rootFont: 'ahem' }).compile(input()).digest);
  });
});

describe('B3 and C7: profile contexts carry a direction facet and flex text contexts a main-axis facet', () => {
  it('item properties take the parent direction, container and text properties their own', () => {
    const c = project('ltr').compile(inputFor(`${FONT} .r { direction: rtl; display: flex; flex-direction: column; } .i { width: 5px; } .t { font-size: 12px; }`, (r) => [
      div(r, 'r', ['r'], [div(r, 'i', ['i', 't'], [text(r, 'x', 'XX')])]),
    ]));
    const keys = compiledFeatures(c, 'ios', []);
    expect(keys).toContain('direction:rtl@flex-column-single-line/rtl');
    expect(keys).toContain('display:flex@block/ltr');
    expect(keys).toContain('width:<length-px>@flex-column/rtl');
    expect(keys).toContain('font-size:<length-px>@text-in-flex-item/column/rtl');
  });
});

describe('the css-overflow-3 §3.1 computed pair and the overflow refusals', () => {
  const resolved = (css: string) => {
    const c = project('ltr').compile(inputFor(`${FONT} ${css}`, (r) => [div(r, 'a', ['a'])]));
    return { c, x: explainOne(c, 'web', 'a', 'overflow-x').value, y: explainOne(c, 'web', 'a', 'overflow-y').value };
  };
  it('visible beside hidden computes to auto, clip beside hidden to hidden, and clip beside visible stays', () => {
    const pair = project('ltr').compile(inputFor(`${FONT} .a { overflow-x: hidden; }`, (r) => [div(r, 'a', ['a'])]));
    expect(pair.diagnostics.map((d) => d.message)).toEqual(['overflow-y computes to auto on a (css-overflow-3 §3.1: visible beside a non-visible axis computes to auto); only overflow: hidden on both axes is supported', 'overflow-y computes to auto on a (css-overflow-3 §3.1: visible beside a non-visible axis computes to auto); only overflow: hidden on both axes is supported']);
    expect([resolved('.a { overflow: clip hidden; }').x, resolved('.a { overflow: clip hidden; }').y]).toEqual(['hidden', 'hidden']);
    expect([resolved('.a { overflow-y: clip; }').x, resolved('.a { overflow-y: clip; }').y]).toEqual(['visible', 'clip']);
  });
  it('a computed auto from the pair rule and overflow on body are DRAGON_UNSUPPORTED_VALUE on every target, located at the declaration', () => {
    for (const css of ['.a { overflow-x: hidden; }', 'body { overflow: hidden; }']) {
      const input = inputFor(`${FONT} ${css}`, (r) => [div(r, 'a', ['a'])]);
      const c = project('ltr').compile(input);
      const hits = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(hits.map((d) => d.target).sort(), css).toEqual(['ios', 'web']);
      for (const d of hits) expect(spanTextOf(input, d), css).toBe('hidden');
      expect([c.outputs.ios.kind, c.outputs.web.kind], css).toEqual(['blocked', 'blocked']);
      expectCatalogued(c.diagnostics);
    }
    const ok = project('ltr').compile(inputFor(`${FONT} .a { overflow: hidden; }`, (r) => [div(r, 'a', ['a'])]));
    expect(ok.diagnostics).toEqual([]);
  });
});

describe('bidi: rtl text holds only strong-L letters, spaces and U+200B not at the end (DRAGON_UNSUPPORTED_BIDI)', () => {
  const compile = (direction: 'ltr' | 'rtl', ...values: string[]) => project(direction).compile(inputFor(FONT, (r) => [div(r, 'a', [], values.map((v, i) => text(r, `t${i}`, v)))]));
  it('refuses digits, punctuation and a trailing U+200B in rtl, and blocks every output', () => {
    for (const values of [['AB 12'], ['XX.'], ['XX', '\u200b']]) {
      const c = compile('rtl', ...values);
      expect(c.diagnostics.map((d) => d.code), values.join('|')).toEqual(['DRAGON_UNSUPPORTED_BIDI']);
      expect([c.outputs.ios.kind, c.outputs.web.kind]).toEqual(['blocked', 'blocked']);
      expectCatalogued(c.diagnostics);
    }
  });
  it('accepts the same text in ltr, and letters, spaces and inner U+200B in rtl', () => {
    expect(compile('ltr', 'AB 12.').diagnostics).toEqual([]);
    expect(compile('rtl', 'XX\u200bYY', ' ZZ').diagnostics).toEqual([]);
  });
});

describe('C3: anonymous boxes take the inherited longhands of their parent and every other longhand at its webref initial value', () => {
  const css = `${FONT} .p { direction: rtl; text-align: center; line-height: 2; color: #123; padding: 3px; margin: 4px 1px; border: 2px solid #000; width: 90px; min-height: 5px; box-sizing: border-box; }
    .f { display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-end; gap: 2px; flex-direction: column; height: 50px; }`;
  const inputs = [
    inputFor(css, (r) => [div(r, 'p', ['p'], [text(r, 't0', 'XX'), div(r, 'b', []), text(r, 't1', 'YY')])]),
    inputFor(css, (r) => [div(r, 'p', ['p', 'f'], [text(r, 't0', 'XX'), div(r, 'b', []), text(r, 't1', 'YY')])]),
  ];
  for (const [i, input] of inputs.entries()) {
    it(`case ${i}: every anonymous box in the lowered case, in both environments`, () => {
      for (const direction of ['ltr', 'rtl'] as const) {
        const root = projection(input, direction);
        const all = boxes(root);
        const anons = all.filter((b) => b.boxType === 'anonymous');
        expect(anons.length).toBe(2);
        for (const a of anons) {
          const parent = all.find((b) => b.children.includes(a)) as LayoutBox;
          // The expected style: the parent's inherited values and the webref initial values, lowered by the same mapping.
          const fake: ResolvedElement = {
            kind: 'element',
            element: { kind: 'element', address: a.id, instance: 'doc', owner: 'App', tag: 'div', classes: [], attributes: new Map(), children: [], node: { kind: 'element', id: a.id, tag: 'div', classes: [], attributes: [], children: [], origin: { kind: 'unlocated', reason: 'test' } } },
            props: new Map(LONGHANDS.map((p) => [p, { value: INHERITED.has(p) ? keywordOrValue(parent, p) : p === 'display' ? { kind: 'keyword', value: 'block' } : initialValue(p, referenceDataset()), origin: 'initial', span: null, declaration: null, declared: null, losing: [] } as ResolvedValue])),
            children: [],
          };
          expect(a.style, a.id).toEqual(lowerStyle(fake, NO_FAULTS, referenceDataset()));
          expect([a.style.direction, a.style.textAlign], a.id).toEqual([parent.style.direction, parent.style.textAlign]);
        }
      }
    });
  }
});

/** The lowered parent's inherited value as a CssValue, for the two inherited LayoutStyle fields (the rest of INHERITED are text-only). */
function keywordOrValue(parent: LayoutBox, p: Longhand): CssValue {
  const style = parent.style as LayoutStyle;
  if (p === 'direction') return { kind: 'keyword', value: style.direction };
  if (p === 'text-align') return { kind: 'keyword', value: style.textAlign };
  return initialValue(p, referenceDataset());
}

describe('C4: one display: none rule, the subtree is omitted wherever it occurs (CSS2 §9.2.4)', () => {
  // A hidden subtree that could not be lowered (a width in em), beside text and elsewhere, compiled without the profiles.
  const css = `${FONT} .h { display: none; width: 2em; } .h > div { width: 3em; }`;
  const beside = inputFor(css, (r) => [div(r, 'm', [], [text(r, 't0', 'XX'), div(r, 'h', ['h'], [div(r, 'hc', [])]), text(r, 't1', 'YY')])]);
  const elsewhere = inputFor(css, (r) => [div(r, 'm', [], [div(r, 'a', []), div(r, 'h', ['h'], [div(r, 'hc', [])])])]);
  it('gives the same diagnostics and projection outcome beside text and elsewhere', () => {
    const outcome = (input: FrontEndResult) => {
      const c = project('ltr').compile(input);
      const p = iosLayoutProjection(c, { ...ENV, direction: 'ltr' }, []);
      return { codes: c.diagnostics.map((d) => d.code), projection: p.kind, hidden: p.kind === 'ready' ? boxes(p.input.root).some((b) => b.id === 'h' || b.id === 'hc') : null };
    };
    expect(outcome(beside)).toEqual({ codes: [], projection: 'ready', hidden: false });
    expect(outcome(elsewhere)).toEqual(outcome(beside));
  });
  it('a display: none root leaves no layout tree and blocks the ios output with a typed diagnostic', () => {
    const c = project('ltr').compile(inputFor(`${FONT} html { display: none; }`, (r) => [div(r, 'a', [])]));
    expect(c.outputs.ios.kind).toBe('blocked');
    expect(c.diagnostics.map((d) => d.code)).toEqual(['DRAGON_LOWERING_FAILED']);
  });
});

describe('the root font size the engine input carries (V2 rootFontSize)', () => {
  const compileRoot = (fontSize: string) => project('ltr').compile(inputFor(`html { font-size: ${fontSize}; } ${FONT}`, (r) => [div(r, 'a', [], [text(r, 't', 'XX')])]));
  it('is the root font size in px when it computes to px', () => {
    for (const [fontSize, px] of [['2em', 32], ['1rem', 16], ['12px', 12]] as const) {
      const p = iosLayoutProjection(compileRoot(fontSize), { ...ENV, direction: 'ltr' }, []);
      expect(p.kind === 'ready' ? p.input.rootFontSize : p.reason, fontSize).toBe(px);
    }
  });
  it('blocks the ios output with a typed diagnostic, instead of throwing at projection, when it does not compute to px', () => {
    for (const fontSize of ['medium', 'larger', '120%', 'calc(10px + 1vw)']) {
      const c = compileRoot(fontSize);
      expect(c.outputs.ios.kind, fontSize).toBe('blocked');
      expect(c.diagnostics.map((d) => d.code), fontSize).toEqual(['DRAGON_LOWERING_FAILED']);
      expect(iosLayoutProjection(c, { ...ENV, direction: 'ltr' }, []).kind, fontSize).toBe('blocked');
    }
  });
});

describe('C5: a text leaf carries the text-align and direction of its block container', () => {
  const leaf = (align: string, direction: string): ResolvedText => ({
    kind: 'text',
    node: { kind: 'text', address: 'p:text0', instance: 'doc', owner: 'App', text: 'XX', node: { kind: 'text', id: 't', text: 'XX', origin: { kind: 'unlocated', reason: 'test' } } },
    text: 'XX',
    props: new Map([
      ['text-align', { value: { kind: 'keyword', value: align }, origin: 'inherited', span: null, declaration: null, declared: null, losing: [] }],
      ['direction', { value: { kind: 'keyword', value: direction }, origin: 'inherited', span: null, declaration: null, declared: null, losing: [] }],
    ]),
  } as ResolvedText);
  const container = (textAlign: LayoutStyle['textAlign'], direction: LayoutStyle['direction']) => ({ textAlign, direction }) as LayoutStyle;
  it('passes when they are equal, in both directions', () => {
    expect(() => assertTextCarriesContainer(container('center', 'ltr'), 'p', leaf('center', 'ltr'))).not.toThrow();
    expect(() => assertTextCarriesContainer(container('start', 'rtl'), 'p', leaf('start', 'rtl'))).not.toThrow();
  });
  it('a planted mismatch of text-align or direction throws', () => {
    expect(() => assertTextCarriesContainer(container('center', 'ltr'), 'p', leaf('start', 'ltr'))).toThrow(/text-align start and direction ltr/);
    expect(() => assertTextCarriesContainer(container('start', 'ltr'), 'p', leaf('start', 'rtl'))).toThrow(/direction rtl.*start and ltr/);
  });
  it('holds for element and anonymous containers in real lowerings, in both directions', () => {
    const input = inputFor(`${FONT} .p { text-align: end; } .q { direction: rtl; text-align: left; }`, (r) => [
      div(r, 'p', ['p'], [text(r, 't0', 'XX'), div(r, 'q', ['q'], [text(r, 't1', 'YY')]), text(r, 't2', 'ZZ')]),
    ]);
    for (const direction of ['ltr', 'rtl'] as const) expect(boxes(projection(input, direction)).length).toBe(6);
  });
});

describe('C6: nested rules and every other non-declaration child of a rule block are diagnosed, never skipped', () => {
  const cases: readonly { css: string; code: string; span: string }[] = [
    { css: '.a { width: 1px; & .b { width: 2px; } }', code: 'DRAGON_UNSUPPORTED_NESTED_RULE', span: '& .b { width: 2px; }' },
    { css: '.a { &:hover { width: 2px; } }', code: 'DRAGON_UNSUPPORTED_NESTED_RULE', span: '&:hover { width: 2px; }' },
    { css: '.a { width: 1px; @media (min-width: 1px) { width: 2px; } }', code: 'DRAGON_UNSUPPORTED_AT_RULE', span: '@media (min-width: 1px) { width: 2px; }' },
    { css: '.a { width: 1px; @supports (display: flex) { .b { width: 2px; } } }', code: 'DRAGON_UNSUPPORTED_AT_RULE', span: '@supports (display: flex) { .b { width: 2px; } }' },
    { css: '.a { width 1px; height: 2px; }', code: 'DRAGON_CSS_PARSE', span: 'width 1px;' },
    // A top-level @media is conditional since MQ-a, so the unsupported top-level at-rule here is @container.
    { css: '@container (min-width: 1px) { .a { width: 2px; } }', code: 'DRAGON_UNSUPPORTED_AT_RULE', span: '@container (min-width: 1px) { .a { width: 2px; } }' },
  ];
  for (const k of cases) {
    it(`${k.css} -> ${k.code}, blocking every output`, () => {
      const input = inputFor(k.css, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])]);
      const c = project('ltr', 'enforce').compile(input);
      const hit = c.diagnostics.filter((d) => d.code === k.code);
      expect(hit.map((d) => spanTextOf(input, d)), JSON.stringify(c.diagnostics.map((d) => [d.code, spanTextOf(input, d)]))).toContain(k.span);
      for (const d of hit) expect(d.target).toBeNull();
      expect([c.outputs.ios.kind, c.outputs.web.kind]).toEqual(['blocked', 'blocked']);
      expect(c.ok).toBe(false);
      expectCatalogued(c.diagnostics);
    });
  }
  it('an empty declaration and <!-- --> produce no CSSOM child and no diagnostic', () => {
    const c = project('ltr').compile(inputFor(`<!-- ${FONT} .a { width: 1px; ; } -->`, (r) => [div(r, 'a', ['a'])]));
    expect(c.diagnostics).toEqual([]);
  });
  it('the parser has no silent skip left: every non-Rule and non-Declaration node goes through refuseNode', () => {
    const src = readFileSync(new URL('../src/css/stylesheet.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/type !== 'Declaration'\) continue|type !== 'Rule'\) continue/);
    // The definition, the top-level and rule-block callers, and the two callers inside an unsupported at-rule (T005 rec 3).
    expect(src.match(/refuseNode\(/g)?.length).toBe(5);
  });
});
