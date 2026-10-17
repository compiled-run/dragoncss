// PNT2: backface-visibility, transform-style and transform-box are accepted at their initial values alone, on every target, and
// -webkit-backface-visibility and -webkit-transform-style are aliases; every other keyword is kept as Chrome keeps it and refused where
// it applies, since hidden can hide a box (and its text) and none of them is drawn. The Chrome cases are transform-extra-initial and
// reject-transform-extra-backface (packages/parity/fixtures); packages/parity/test/transform-extra-parse.test.ts pins the parse.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { isInitialTransformExtra, TRANSFORM_EXTRA_LONGHANDS } from '../src/css/properties/transform-extra.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/transform-extra.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, `dropped` when Chrome would drop it, or its diagnostics. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.some((d) => d.code === 'DRAGON_CSS_INVALID_VALUE')) return ['dropped'];
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
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS, child = ''): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; } .c { ${child} }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('the 3D transform longhands', () => {
  it('follow filter in the registry, animate discretely and know their initial values', () => {
    expect([...TRANSFORM_EXTRA_LONGHANDS]).toEqual(['backface-visibility', 'transform-style', 'transform-box']);
    expect(LONGHANDS[LONGHANDS.indexOf('backface-visibility') - 1]).toBe('filter');
    for (const p of TRANSFORM_EXTRA_LONGHANDS) expect(ANIMATION_KINDS[p], p).toBe(DISCRETE);
    expect(isInitialTransformExtra('backface-visibility', { kind: 'keyword', value: 'visible' })).toBe(true);
    expect(isInitialTransformExtra('backface-visibility', { kind: 'keyword', value: 'hidden' })).toBe(false);
    expect(isInitialTransformExtra('transform-box', { kind: 'keyword', value: 'border-box' })).toBe(false);
    expect(isInitialTransformExtra('transform-style', { kind: 'keyword', value: 'inherit' })).toBe(false);
  });

  it('parse Chrome 145\'s keywords in any case, through the aliases, and drop every other value', () => {
    expect(parsed('backface-visibility: VISIBLE')).toEqual(['backface-visibility: visible']);
    expect(parsed('-webkit-backface-visibility: hidden')).toEqual(['backface-visibility: hidden']);
    expect(parsed('transform-style: Flat')).toEqual(['transform-style: flat']);
    expect(parsed('-WEBKIT-TRANSFORM-STYLE: preserve-3d')).toEqual(['transform-style: preserve-3d']);
    for (const v of ['content-box', 'border-box', 'fill-box', 'stroke-box', 'view-box']) expect(parsed(`transform-box: ${v}`)).toEqual([`transform-box: ${v}`]);
    for (const d of ['backface-visibility: none', 'backface-visibility: visible hidden', 'transform-style: 3d', 'transform-box: padding-box', 'transform-style: flat flat', '-webkit-transform-box: view-box']) {
      expect(parsed(d).length === 1 && parsed(d)[0]?.includes(':') === false, d).toBe(true);
    }
  });

  it('accept the initial values on every target, from either name and through the CSS-wide keywords', () => {
    expect(errorsAt('backface-visibility: visible; transform-style: flat; transform-box: view-box')).toEqual([]);
    expect(errorsAt('-webkit-backface-visibility: visible; -webkit-transform-style: flat')).toEqual([]);
    expect(errorsAt('backface-visibility: initial; transform-style: unset; transform-box: revert')).toEqual([]);
    expect(errorsAt('transform: rotate(30deg); backface-visibility: visible; transform-style: flat')).toEqual([]);
    expect(errorsAt('backface-visibility: visible', NO_FAULTS, 'backface-visibility: inherit; transform-style: inherit')).toEqual([]);
    // The later declaration wins between the alias and its property, as in Chrome.
    expect(errorsAt('backface-visibility: hidden; -webkit-backface-visibility: visible')).toEqual([]);
    expect(errorsAt('-webkit-transform-style: preserve-3d; transform-style: flat')).toEqual([]);
  });

  it('refuse every other value on every target, once per element where it applies', () => {
    for (const d of ['backface-visibility: hidden', 'transform-style: preserve-3d', 'transform-box: border-box', 'transform-box: content-box', 'transform-box: fill-box', 'transform-box: stroke-box']) {
      expect(errorsAt(d), d).toEqual(REFUSED);
    }
    expect(errorsAt('-webkit-backface-visibility: hidden')).toEqual(REFUSED);
    expect(errorsAt('-webkit-transform-style: preserve-3d')).toEqual(REFUSED);
    expect(errorsAt('backface-visibility: visible; -webkit-backface-visibility: hidden')).toEqual(REFUSED);
    expect(errorsAt('backface-visibility: hidden; transform-style: preserve-3d; transform-box: border-box')).toEqual(REFUSED);
    // A value that arrives through var() is refused as well, and the initial value through var() is accepted.
    expect(errorsAt('--b: hidden; backface-visibility: var(--b)')).toEqual(REFUSED);
    expect(errorsAt('--b: flat; -webkit-transform-style: var(--b)')).toEqual([]);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { backface-visibility: hidden; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toMatch(/^backface-visibility: hidden on <div> a is unsupported: .*only visible is accepted$/);
  });

  it('refuse a value a child inherits explicitly, on the child too', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { backface-visibility: hidden; } .c { backface-visibility: inherit; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    expect(at).toEqual(['backface-visibility: hidden on <div> a', 'backface-visibility: hidden on <div> a', 'backface-visibility: hidden on <div> a', 'backface-visibility: hidden on <div> b', 'backface-visibility: hidden on <div> b', 'backface-visibility: hidden on <div> b']);
  });

  it('are refused in @keyframes, where Dragon has no discrete animation writer', () => {
    for (const v of ['backface-visibility: hidden', 'backface-visibility: visible', 'transform-style: preserve-3d', 'transform-box: border-box']) {
      expect(errorsAt('animation: k 1s', NO_FAULTS, `} @keyframes k { to { ${v}; } } .x {`), v).toEqual(['null DRAGON_UNSUPPORTED_VALUE']);
    }
  });

  it('plant transformExtraAccepted: a non-initial value compiles', () => {
    expect(errorsAt('backface-visibility: hidden', { ...NO_FAULTS, transformExtraAccepted: true })).toEqual([]);
    expect(errorsAt('transform-style: preserve-3d', { ...NO_FAULTS, transformExtraAccepted: true })).toEqual([]);
  });
});
