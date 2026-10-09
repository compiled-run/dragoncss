// CASC 3: cascade layers (css-cascade-5 §6.4) and :host outside a shadow tree. Every expectation here was read from Chrome
// 145.0.7632.6 on the same CSS; the parity fixture casc-layer (packages/parity/src/fixture-groups/casc-layer.ts) proves them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LinkedElement } from '../src/analysis/link.ts';
import { rankLayers } from '../src/analysis/layers.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { resolveTree, valueToString } from '../src/analysis/resolve.ts';
import { atRuleHandler } from '../src/css/at-rules.ts';
import { layerAtRule, layerRanks } from '../src/css/at-rules/layer.ts';
import type { Longhand } from '../src/css/properties.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { NO_FAULTS } from '../src/faults.ts';
import type { Diagnostic } from '../src/types.ts';
import { referenceDataset } from '../src/ua/datasets.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const origin = { kind: 'unlocated', reason: 'test' } as const;
const el = (id: string, classes: string[], children: LinkedElement[] = [], tag = 'div'): LinkedElement => ({
  kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: classes.map((name) => ({ owner: 'o', sheet: 'sheet', name })), attributes: new Map(), children,
  node: { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin },
});

function parse(css: string, faults: CompilerFaults = NO_FAULTS): { rules: ReturnType<typeof parseStylesheet>; diagnostics: Diagnostic[]; layers: string[] } {
  const diagnostics: Diagnostic[] = [];
  const layers: string[] = [];
  const parsed = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics, [], [], [], [], faults, layers);
  return { rules: rankLayers(parsed, layers, faults, diagnostics), diagnostics, layers };
}

const FIXTURE = readFileSync(new URL('../../parity/fixtures/casc-layer.html', import.meta.url), 'utf8');
const SHEET = (/<style>([\s\S]*)<\/style>/.exec(FIXTURE) as RegExpExecArray)[1] as string;
const IDS: [string, string[]][] = [['b1', ['box']], ['imp', ['box', 'imp']], ['m', ['box', 'm']], ['n', ['box', 'n']], ['d', ['box', 'd']], ['a', ['box', 'a']], ['plain', ['box', 'plain']], ['pimp', ['box', 'plain-imp']], ['p', ['box', 'p']]];

/** The fixture's sheet resolved over its tree (the @media condition holds at Chrome's 400px viewport, so it is dropped here). */
function resolve(faults: CompilerFaults = NO_FAULTS): (id: string, p: Longhand) => string {
  const { rules, diagnostics } = parse(SHEET.replace('@media (min-width: 100px) { .m { width: 44px; } }', '.m { width: 44px; }'), faults);
  expect(diagnostics.map((d) => d.message)).toEqual([]);
  const root = resolveTree(el('html', [], [el('body', [], IDS.map(([id, cls]) => el(id, cls)), 'body')], 'html'), rules, faults, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  const byId = new Map<string, ResolvedElement>();
  const walk = (e: ResolvedElement): void => {
    byId.set(e.element.address, e);
    for (const c of e.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return (id, p) => valueToString(((byId.get(id) as ResolvedElement).props.get(p) as { value: Parameters<typeof valueToString>[0] }).value);
}

describe('CASC 3: cascade layers in the cascade', () => {
  it('orders layers by first declaration, sublayers below their parent, unlayered above all, and !important reversed (as Chrome 145)', () => {
    const v = resolve();
    expect(IDS.map(([id]) => [id, v(id, 'width'), v(id, 'height')])).toEqual([
      ['b1', '30px', '6px'], ['imp', '60px', '6px'], ['m', '44px', '6px'], ['n', '30px', '10px'], ['d', '30px', '9px'], ['a', '12px', '6px'],
      ['plain', '5px', '6px'], ['pimp', '66px', '6px'], ['p', '33px', '6px'],
    ]);
    expect([v('d', 'margin-left'), v('p', 'padding-left'), v('b1', 'background-color')]).toEqual(['4px', '3px', 'rgb(0, 170, 0)']);
  });
  it('the planted faults move the values they target', () => {
    const ignored = resolve({ ...NO_FAULTS, layersIgnored: true });
    expect([ignored('b1', 'width'), ignored('n', 'height'), ignored('plain', 'width')]).toEqual(['90px', '20px', '90px']);
    const notReversed = resolve({ ...NO_FAULTS, layerImportantNotReversed: true });
    expect([notReversed('imp', 'width'), notReversed('b1', 'width')]).toEqual(['70px', '30px']);
  });
  it('layerRanks: first declaration order, sublayers before their parent', () => {
    expect([...layerRanks(['a', 'b', 'a.x', 'a.y', 'b.z', 'c'])]).toEqual([['a.x', 0], ['a.y', 1], ['a', 2], ['b.z', 3], ['b', 4], ['c', 5]]);
    const { layers } = parse('@layer a { @layer x { } } @layer b, a.y; @layer { } @layer a.x.q;');
    expect(layers).toEqual(['a', 'a.x', 'b', 'a.y', '#anon4', 'a.x.q']);
  });
  it('@supports and @layer nest either way: a true @supports declares its layers, a false one declares none, and its rules keep their layer', () => {
    const { rules, layers, diagnostics } = parse('@supports (display: flex) { @layer t { .x { width: 1px; } } } @supports (not (display: block)) { @layer f { .y { width: 2px; } } } @layer a { @supports (display: flex) { .z { width: 3px; } } }');
    expect(diagnostics).toEqual([]);
    expect(layers).toEqual(['t', 'a']);
    expect(rules.map((r) => [r.layer, r.declarations.map((d) => d.layer)])).toEqual([['t', [0]], ['a', [1]]]);
  });
});

describe('CASC 3: refusals', () => {
  const messages = (css: string): string[] => parse(css).diagnostics.map((d) => `${d.code}: ${d.message}`);
  it('the handler table registers layerAtRule', () => {
    expect(atRuleHandler('LAYER')).toBe(layerAtRule);
  });
  it('refuses what Dragon does not decide as Chrome does', () => {
    expect(messages('@media (min-width: 1px) { @layer a { .x { width: 1px; } } }')).toEqual(['DRAGON_UNSUPPORTED_AT_RULE: @layer a in @media first declares a inside a condition, where Chrome counts it only while the condition holds; declare the layer order at the top level first']);
    expect(messages('@layer a; @media (min-width: 1px) { @layer a { .x { width: 1px; } } }')).toEqual([]);
    expect(messages('@layer a, b { .x { width: 1px; } }')).toEqual(['DRAGON_UNSUPPORTED_AT_RULE: @layer a, b in the stylesheet is not supported: a layer block takes one name, so Chrome drops the rule']);
    expect(messages('@layer;')).toEqual(['DRAGON_UNSUPPORTED_AT_RULE: @layer in the stylesheet is not supported: a statement must name at least one layer']);
    expect(messages('@layer a . b;')).toEqual(['DRAGON_CSS_PARSE: CSS parse error: Semicolon or block is expected', 'DRAGON_UNSUPPORTED_AT_RULE: @layer a . b in the stylesheet is not supported: "a . b" is not a layer name Dragon reads (an identifier, or identifiers joined by dots with no white space)']);
    // Rules that would be layered but are not ordered by layer here stay refused inside a layer block (keyframesOverride relies on it).
    expect(messages('@layer a { @keyframes k { to { width: 1px; } } @property --p { syntax: "*"; inherits: true; } @font-face { font-family: F; src: url(f.ttf); } }').map((m) => m.split(' is not supported')[0])).toEqual([
      'DRAGON_UNSUPPORTED_AT_RULE: @keyframes inside @layer', 'DRAGON_UNSUPPORTED_AT_RULE: @property in @layer', 'DRAGON_UNSUPPORTED_AT_RULE: @font-face in @layer',
    ]);
    expect(messages('@layer initial;')).toEqual(['DRAGON_UNSUPPORTED_AT_RULE: @layer initial in the stylesheet is not supported: "initial" is a CSS-wide keyword or default, which Dragon does not accept as a layer name']);
    expect(messages('.x { @layer a { width: 1px; } }').filter((m) => m.includes('@layer'))).toEqual(['DRAGON_UNSUPPORTED_AT_RULE: @layer a in a rule block is not supported: @layer nested in a style rule is not built yet']);
    expect(messages('@layer a { .x { width: revert-layer; --y: revert-layer; } } .z { width: revert-layer; }')).toEqual([
      'DRAGON_UNSUPPORTED_VALUE: width: revert-layer in a document with cascade layers is unsupported: rolling back to the layers below is not built yet',
      'DRAGON_UNSUPPORTED_VALUE: --y: revert-layer in a document with cascade layers is unsupported: rolling back to the layers below is not built yet',
      'DRAGON_UNSUPPORTED_VALUE: width: revert-layer in a document with cascade layers is unsupported: rolling back to the layers below is not built yet',
    ]);
    // revert-layer reaching a value through var() (a fallback, or a custom property's value) or written with an escape is refused too.
    expect(messages('@layer a; .z { width: var(--u, revert-layer); --v: var(--w, REVERT-LAYER); height: var(--v); margin: r\\65vert-layer; }')).toEqual([
      'DRAGON_UNSUPPORTED_VALUE: width: revert-layer in a document with cascade layers is unsupported: rolling back to the layers below is not built yet',
      'DRAGON_UNSUPPORTED_VALUE: --v: revert-layer in a document with cascade layers is unsupported: rolling back to the layers below is not built yet',
      'DRAGON_UNSUPPORTED_VALUE: margin: revert-layer in a document with cascade layers is unsupported: rolling back to the layers below is not built yet',
    ]);
    // Not a revert-layer identifier: a string, or a longer name.
    expect(messages('@layer a; .z { font-family: "revert-layer", revert-layers; }')).toEqual([]);
    // With no layer declared, revert-layer is not this refusal's (it reverts as revert does, casc.test.ts).
    expect(messages('.z { width: revert-layer; height: var(--u, revert-layer); }')).toEqual([]);
  });
  it(':host matches nothing in a document (css-scoping-1), and is refused inside a selector argument', () => {
    expect(messages(':root, :host { --a: 1px; } :host .x, :host.y { width: 1px; }')).toEqual([]);
    expect(messages(':is(:host, div) { width: 1px; }')).toEqual(['DRAGON_UNSUPPORTED_SELECTOR: :host inside a selector argument is not supported: it matches nothing here, but its specificity would still count']);
  });
});
