// FX: filter is accepted at none on every target, and -webkit-filter is its alias; any other value is kept as Chrome keeps it and
// refused where it applies unless it is a list of the colour-matrix functions (PNT1-filter), which web writes as authored and native
// draws on a group it pre-composites. The Chrome cases are filter-none, filter-matrix-text, filter-matrix-over-rects and
// reject-filter-function (packages/parity/fixtures); packages/parity/test/filter-parse.test.ts pins the parse against Chrome, and
// packages/parity/test/pnt1-effects.test.ts the drawn pixels.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { colorMatrixFilters, FILTER_LIST_TYPE } from '../src/css/properties/filter.ts';
import { EFFECTS_EMITTER } from '../src/emit/paint/effects.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/filter.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, or its diagnostics as `code message`. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => `${d.code} ${d.message}`);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text in a child of the element the declarations are on. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('filter', () => {
  it('parses none in any case, through -webkit-filter too, and keeps every other value', () => {
    expect(parsed('filter: none')).toEqual(['filter: none']);
    expect(parsed('filter: NONE')).toEqual(['filter: none']);
    expect(parsed('-webkit-filter: none')).toEqual(['filter: none']);
    expect(parsed('-WEBKIT-FILTER: None')).toEqual(['filter: none']);
    expect(parsed('filter: blur(4px)')).toEqual(['filter: blur(4px)']);
    // Values webref's grammar would drop, which Chrome may keep, are kept so that they are refused rather than ignored.
    for (const v of ['opacity(0)', 'brightness(-1)', 'none none', 'url(#f) grayscale(1)', 'drop-shadow(0 0 2px #000)']) expect(parsed(`filter: ${v}`), v).toHaveLength(1);
    expect(parsed('filter: inherit')).toEqual(['filter: inherit']);
  });

  it('accepts none on every target, from either name and through the CSS-wide keywords', () => {
    expect(errorsAt('filter: none')).toEqual([]);
    expect(errorsAt('-webkit-filter: none')).toEqual([]);
    expect(errorsAt('filter: initial')).toEqual([]);
    expect(errorsAt('filter: inherit')).toEqual([]);
    // The later declaration wins between the alias and its property, as in Chrome, so checkFilter passes it (an enforced support
    // profile still refuses the declared list itself, as it checks every declaration).
    expect(errorsAt('filter: blur(2px); -webkit-filter: none')).toEqual([]);
    expect(errorsAt('-webkit-filter: blur(2px); filter: none')).toEqual([]);
  });

  it('refuses every list but one of colour-matrix functions on every target, once where it applies', () => {
    for (const v of ['blur(4px)', 'drop-shadow(0 0 2px #000)', 'url(#f)', 'bogus', 'hue-rotate(90deg)', 'grayscale(1) blur(1px)', 'contrast(calc(1 + 1))', 'brightness(-1)', 'saturate(1, 2)', 'brightness(1e39)']) expect(errorsAt(`filter: ${v}`), v).toEqual(REFUSED);
    expect(errorsAt('filter: none; -webkit-filter: blur(1px)')).toEqual(REFUSED);
    // A filter that arrives through var() is refused as well, and none through var() is accepted.
    expect(errorsAt('--f: blur(2px); filter: var(--f)')).toEqual(REFUSED);
    expect(errorsAt('--f: none; -webkit-filter: var(--f)')).toEqual([]);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { filter: hue-rotate(90deg); }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toBe("filter: hue-rotate(90deg) on <div> a is unsupported: Dragon draws only lists of the colour-matrix functions grayscale, sepia, saturate, invert, opacity, brightness and contrast (FX), and hue-rotate() builds its matrix from the platform's cosf and sinf, which Dragon does not reproduce exactly");
  });

  it('draws a colour-matrix list on every target where the box is a group native pre-composites', () => {
    for (const v of ['grayscale(1)', 'brightness(.8)', 'opacity(0)', 'sepia(50%) invert()', 'contrast(2) saturate(3)', 'GRAYSCALE(0.5)']) expect(errorsAt(`filter: ${v}`), v).toEqual([]);
    expect(errorsAt('-webkit-filter: opacity(0)')).toEqual([]);
    expect(errorsAt('filter: none; -webkit-filter: brightness(0)')).toEqual([]);
    expect(errorsAt('--f: invert(0.4); filter: var(--f)')).toEqual([]);
    expect(errorsAt('filter: grayscale(1); opacity: 0.5')).toEqual([]);
  });

  it('refuses a colour-matrix list on native only where the box is no group, naming why', () => {
    const native = (css: string): string[] => {
      const all = `body { font-family: Ahem; font-size: 10px; } ${css}`;
      const c = project(NO_FAULTS).compile(inputFor(all, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['k'], [text(r, 't', 'XX')])])]));
      return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.message}`);
    };
    const why = (target: string, reason: string): string => `${target} a has filter: grayscale(1); ${target} has no filter that rounds as Chrome's Skia pipeline does, so Dragon draws a colour-matrix filter only on a group it pre-composites (PNT1-filter), and this one is not: ${reason}`;
    expect(native('.s { filter: grayscale(1); border-radius: 2px; }')).toEqual([why('ios', 'a has a border radius'), why('android', 'a has a border radius')]);
    // The nested opacity box is refused too, as inside a filtered box; keep only a's messages here.
    const own = (ms: string[]): string[] => ms.filter((m) => / a has filter: /.test(m));
    expect(own(native('.s { filter: grayscale(1); } .k { opacity: 0.5; }'))).toEqual([why('ios', 'b inside it has opacity 0.5, a nested group'), why('android', 'b inside it has opacity 0.5, a nested group')]);
    expect(native('.s { filter: grayscale(1); } .k { text-shadow: 1px 1px rgb(0, 0, 0); }')).toEqual([why('ios', 'the text of b has a text-shadow'), why('android', 'the text of b has a text-shadow')]);
    // A filtered box inside a filtered group: the inner one is a member with a filter, and inside a box with a filter.
    const nested = native('.s { filter: grayscale(1); } .k { filter: invert(1); }');
    expect(nested.filter((m) => m.startsWith('ios '))).toEqual([why('ios', 'b has a filter (a shadow, image, filter, clip, transform or will-change)'), 'ios b has filter: invert(1); ios has no filter that rounds as Chrome\'s Skia pipeline does, so Dragon draws a colour-matrix filter only on a group it pre-composites (PNT1-filter), and this one is not: it is inside a, which has a filter']);
    // A box of opacity 0 draws nothing, filtered or not.
    expect(native('.s { filter: grayscale(1); border-radius: 2px; opacity: 0; }')).toEqual([]);
  });

  it('reads each function\'s computed amount as Blink does: percentages, a default of 1, and the clamp of four functions to 1', () => {
    const read = (text: string) => colorMatrixFilters({ kind: 'other', type: FILTER_LIST_TYPE, text });
    expect(read('grayscale(50%) brightness(.8)')).toEqual({ kind: 'list', functions: [{ name: 'grayscale', amount: 0.5 }, { name: 'brightness', amount: 0.8 }] });
    expect(read('INVERT() Opacity(3) sepia(120%) grayscale(1.5)')).toEqual({ kind: 'list', functions: [{ name: 'invert', amount: 1 }, { name: 'opacity', amount: 1 }, { name: 'sepia', amount: 1 }, { name: 'grayscale', amount: 1 }] });
    expect(read('saturate(300%) contrast(2.5) brightness(1e1)')).toEqual({ kind: 'list', functions: [{ name: 'saturate', amount: 3 }, { name: 'contrast', amount: 2.5 }, { name: 'brightness', amount: 10 }] });
    expect(colorMatrixFilters({ kind: 'keyword', value: 'none' })).toEqual({ kind: 'none' });
    for (const t of ['blur(1px)', 'hue-rotate(0deg)', 'grayscale(-1)', 'grayscale(calc(0.5))', 'grayscale(1px)', 'grayscale(1) , sepia(1)']) expect(read(t).kind, t).toBe('other');
  });

  it('lowers a filter group to a filter-group write with the (code, amount) pairs, after or without an opacity', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { filter: sepia(0.25) contrast(150%); opacity: 0.5; } .n { filter: invert(); }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')]), el(r, 'b', 'div', ['n'], [text(r, 'u', 'XX')])]));
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const a = p.programs.uikit.nodes.find((n) => n.id === 'a');
    const b = p.programs.uikit.nodes.find((n) => n.id === 'b');
    const wa = a?.writes.find((w) => w.kind === 'filter-group');
    const wb = b?.writes.find((w) => w.kind === 'filter-group');
    expect(wa).toEqual(expect.objectContaining({ kind: 'filter-group', key: 'dragonFilterGroup', technique: 'dragon-owned-paint', opacity: 0.5, filter: [{ name: 'sepia', amount: 0.25 }, { name: 'contrast', amount: 1.5 }], css: ['filter', 'opacity'] }));
    expect(wb).toEqual(expect.objectContaining({ kind: 'filter-group', opacity: 1, filter: [{ name: 'invert', amount: 1 }] }));
    expect(a?.writes.some((w) => w.kind === 'opacity' || w.kind === 'opacity-group')).toBe(false);
    expect(a?.facts['effects']).toEqual({ opacity: 0.5, filter: [{ name: 'sepia', amount: 0.25 }, { name: 'contrast', amount: 1.5 }] });
    // A filter makes a stacking context, painted in the z-index 0 layer.
    expect(b?.facts['stacking']).toEqual(expect.objectContaining({ createsContext: true, layer: 'positioned' }));
    expect(EFFECTS_EMITTER.lines.uikit('v0', a as never, wa as never)[0]).toMatch(/^ {2}dragonSetFilterGroup\(t, v0, 0\.5, \[1\.0, 0\.25, 6\.0, 1\.5\], nil, \[.*\]\)$/);
    expect(EFFECTS_EMITTER.lines['android-views']('v0', b as never, wb as never)[0]).toMatch(/^ {2}dragonSetFilterGroup\(t, v0, 1\.0, listOf<Double>\(3\.0, 1\.0\), null, listOf<String>\(.*\)\)$/);
  });

  it('refuses a filter that a child inherits explicitly, on the child too', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { filter: blur(1px); } .c { filter: inherit; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    expect(at).toEqual(['filter: blur(1px) on <div> a', 'filter: blur(1px) on <div> a', 'filter: blur(1px) on <div> a', 'filter: blur(1px) on <div> b', 'filter: blur(1px) on <div> b', 'filter: blur(1px) on <div> b']);
  });

  it('plant filterListAccepted: a filter list compiles', () => {
    expect(errorsAt('filter: blur(4px)', { ...NO_FAULTS, filterListAccepted: true })).toEqual([]);
  });
});
