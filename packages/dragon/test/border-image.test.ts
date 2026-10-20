// MISC-PAINT: the border image longhands, border-image and -webkit-border-image are accepted at their initial values alone, on every
// target; every other value is kept and refused where it applies, since no target draws border images yet. The Chrome cases are
// border-image-initial and reject-border-image-source (packages/parity/fixtures); packages/parity/test/border-image-parse.test.ts
// pins the parse against Chrome.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { initialValue, valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { BORDER_IMAGE_INITIAL, BORDER_IMAGE_LONGHANDS, isInitialBorderImage } from '../src/css/properties/border-image.ts';
import { MASK_LONGHANDS } from '../src/css/properties/mask.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/border-image.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, or its diagnostics as `code`. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

/** The value kind of each longhand one declaration sets. */
function kindsOf(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, []);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => l.value.kind);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text in a child of the bordered element the declarations are on. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS, extra = ''): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { border: 2px solid #102030; ${decl}; } ${extra}`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

/** Each longhand's initial spelling, as webref and Chrome's InitialValue give it. */
const INITIAL_DECLS = ['border-image-source: none', 'border-image-slice: 100%', 'border-image-width: 1', 'border-image-outset: 0', 'border-image-repeat: stretch'];

describe('border-image', () => {
  it('follows mask, before isolation, in Chrome\'s border-image shorthand order', () => {
    expect(LONGHANDS.slice(LONGHANDS.indexOf(MASK_LONGHANDS[MASK_LONGHANDS.length - 1] as (typeof MASK_LONGHANDS)[number]) + 1)).toEqual([...BORDER_IMAGE_LONGHANDS, 'isolation']);
  });

  it('holds the initial values the resolver takes from the grammar, and isInitialBorderImage takes no other value', () => {
    for (const p of BORDER_IMAGE_LONGHANDS) {
      expect(BORDER_IMAGE_INITIAL[p], p).toEqual(initialValue(p, referenceDataset()));
      expect(isInitialBorderImage(p, BORDER_IMAGE_INITIAL[p]), p).toBe(true);
    }
    expect(isInitialBorderImage('border-image-width', { kind: 'percentage', value: 1 })).toBe(false);
    expect(isInitialBorderImage('border-image-outset', { kind: 'length', value: 0, unit: 'px' })).toBe(false);
    expect(isInitialBorderImage('border-image-slice', { kind: 'number', value: 100 })).toBe(false);
    expect(isInitialBorderImage('border-image-repeat', { kind: 'keyword', value: 'round' })).toBe(false);
  });

  it('parses each initial spelling in any case as the initial value, and keeps every other value', () => {
    for (const d of INITIAL_DECLS) expect(parsed(d), d).toEqual([d]);
    expect(parsed('BORDER-IMAGE-SOURCE: NONE')).toEqual(['border-image-source: none']);
    expect(parsed('border-image-repeat: Stretch')).toEqual(['border-image-repeat: stretch']);
    expect(parsed('border-image-width: 1.0')).toEqual(['border-image-width: 1']);
    expect(parsed('border-image: none')).toEqual(INITIAL_DECLS);
    expect(parsed('border-image: NONE')).toEqual(INITIAL_DECLS);
    expect(parsed('-webkit-border-image: none')).toEqual(INITIAL_DECLS);
    expect(parsed('-WEBKIT-BORDER-IMAGE: None')).toEqual(INITIAL_DECLS);
    // Values the initial spelling does not cover are kept as written, so that they are refused rather than ignored.
    expect(parsed('border-image-source: linear-gradient(red, blue)')).toEqual(['border-image-source: linear-gradient(red,blue)']);
    for (const d of ['border-image-source: url(b.png)', 'border-image-source: bogus', 'border-image-slice: 100% 100%', 'border-image-slice: 100% fill', 'border-image-slice: 100', 'border-image-slice: 30%', 'border-image-slice: +100%', 'border-image-width: 1px', 'border-image-width: auto', 'border-image-width: 100%', 'border-image-width: +1', 'border-image-width: 1 1', 'border-image-outset: 0px', 'border-image-outset: -0', 'border-image-outset: 1', 'border-image-repeat: stretch stretch', 'border-image-repeat: round', 'border-image-repeat: space']) {
      expect(parsed(d), d).toEqual([d]);
      expect(kindsOf(d), d).toEqual(['other']);
    }
    // Anything but none is kept on every longhand, so it is over-refused rather than read as partly initial.
    expect(kindsOf('border-image: url(b.png) 30 round')).toEqual(['other', 'other', 'other', 'other', 'other']);
    expect(kindsOf('-webkit-border-image: url(b.png) 10 / 4px')).toEqual(['other', 'other', 'other', 'other', 'other']);
    expect(parsed('border-image: url(b.png) 30 round')[0]).toBe('border-image-source: url(b.png) 30 round');
    expect(parsed('border-image: none 100% / 1 / 0 stretch')[0]).toBe('border-image-source: none 100% / 1 / 0 stretch');
    expect(parsed('-webkit-border-image: url(b.png) 10 / 4px')[0]).toBe('border-image-source: url(b.png) 10 / 4px');
    expect(parsed('border-image-slice: inherit')).toEqual(['border-image-slice: inherit']);
  });

  it('accepts the initial values on every target, from every name and through the CSS-wide keywords', () => {
    expect(errorsAt(INITIAL_DECLS.join('; '))).toEqual([]);
    expect(errorsAt('border-image: none; -webkit-border-image: none')).toEqual([]);
    for (const k of ['inherit', 'initial', 'unset', 'revert']) expect(errorsAt(['border-image', '-webkit-border-image', ...BORDER_IMAGE_LONGHANDS].map((p) => `${p}: ${k}`).join('; ')), k).toEqual([]);
    // A later initial value wins over an earlier border image, from either name, as in Chrome.
    expect(errorsAt('border-image-source: url(b.png); border-image: none')).toEqual([]);
    expect(errorsAt('border-image: url(b.png) 30 round; -webkit-border-image: none')).toEqual([]);
    expect(errorsAt('--b: none; border-image-source: var(--b)')).toEqual([]);
  });

  it('refuses every other value on every target, once where it applies', () => {
    for (const d of ['border-image-source: url(b.png)', 'border-image-source: linear-gradient(red, blue)', 'border-image-slice: 30%', 'border-image-slice: 100% fill', 'border-image-width: 4px', 'border-image-width: auto', 'border-image-outset: 2px', 'border-image-outset: 0px', 'border-image-repeat: round', 'border-image: url(b.png) 30 round', 'border-image: linear-gradient(red, blue) 1', '-webkit-border-image: url(b.png) 10 / 4px', '-webkit-border-image: linear-gradient(red, blue) 1']) {
      expect(errorsAt(d), d).toEqual(REFUSED);
    }
    expect(errorsAt('border-image-source: url(b.png); border-image-repeat: round; border-image-width: 3')).toEqual(REFUSED);
    // A value that arrives through var() is refused as well.
    expect(errorsAt('--b: linear-gradient(red, blue); border-image-source: var(--b)')).toEqual(REFUSED);
    expect(errorsAt('--b: url(b.png) 30; -webkit-border-image: var(--b)')).toEqual(REFUSED);
    // -webkit-border-image is refused even where it loses (analysis/border-image.ts): Chrome applies it first and keeps its border widths.
    expect(errorsAt('-webkit-border-image: url(b.png) 30; border-image-source: none')).toEqual(REFUSED);
    // Dragon's border shorthand sets no border image longhand, so an earlier border image is still refused (Chrome's border resets it).
    expect(errorsAt('border-image-repeat: round; border: 1px solid')).toEqual(REFUSED);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { border-image-repeat: space; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toMatch(/^border-image-repeat: space on <div> a is unsupported: /);
    // The reject-border-image-source fixture's message (packages/parity/src/fixture-groups/border-image.ts).
    const shown = project(NO_FAULTS).compile(inputFor('body { font-family: Ahem; } .s { border: 4px solid; border-image-source: linear-gradient(red, blue); }', (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const refused = shown.diagnostics.filter((x) => x.severity === 'error');
    expect(refused).toHaveLength(3);
    for (const d of refused) expect(d.message).toMatch(/^border-image-source: linear-gradient\(red,blue\) on <div> a is unsupported: /);
  });

  it('refuses a -webkit-border-image that loses the cascade, since Chrome keeps the border widths it sets', () => {
    // No declared border width: Chrome draws the 20px widths -webkit-border-image set, where Dragon would draw medium.
    const at = (decl: string, extra = ''): string[] => {
      const css = `body { font-family: Ahem; font-size: 10px; } .s { border-style: solid; ${decl}; } ${extra}`;
      const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
      return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
    };
    // The controls: none and the CSS-wide keywords set no width, and compile.
    expect(at('-webkit-border-image: none; border-image: none')).toEqual([]);
    for (const k of ['inherit', 'initial', 'unset', 'revert']) expect(at(`-webkit-border-image: ${k}; border-image: none`), k).toEqual([]);
    for (const d of [
      '-webkit-border-image: url(b.png) 10 / 20px; border-image: none',
      '-webkit-border-image: url(b.png) 10 / 20px; border-image: initial',
      '-webkit-border-image: url(b.png) 10 / 20px; border-image-source: none',
      '-webkit-border-image: url(b.png) 10 / 20px !important; border-image: none !important',
      '--x: url(b.png) 10 / 20px; -webkit-border-image: var(--x); border-image: initial',
    ]) expect(at(d), d).toEqual(REFUSED);
    // Inside a state rule too: every check runs on each interaction state (native refuses :hover on a div as a selector anyway).
    const selector = ['android DRAGON_UNSUPPORTED_SELECTOR', 'ios DRAGON_UNSUPPORTED_SELECTOR'];
    expect(at('', '.s:hover { -webkit-border-image: none; border-image: none; }')).toEqual(selector);
    expect(at('', '.s:hover { -webkit-border-image: url(b.png) 10 / 20px; border-image: none; }')).toEqual([...REFUSED, ...selector].sort());
    const shown = project(NO_FAULTS).compile(inputFor('body { font-family: Ahem; } .s { border-style: solid; -webkit-border-image: url(b.png) 10 / 20px; border-image: none; }', (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const refused = shown.diagnostics.filter((x) => x.severity === 'error');
    expect(refused).toHaveLength(3);
    for (const d of refused) expect(d.message).toMatch(/^-webkit-border-image: url\(b\.png\) 10 \/ 20px on <div> a is unsupported: /);
    // The plant accepts it.
    const planted = project({ ...NO_FAULTS, borderImageAccepted: true }).compile(inputFor('body { font-family: Ahem; } .s { border-style: solid; -webkit-border-image: url(b.png) 10 / 20px; border-image: none; }', (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    expect(planted.diagnostics.filter((x) => x.severity === 'error')).toEqual([]);
  });

  it('refuses a border image that a child inherits explicitly, on the child too', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { border-image-width: 4px; } .c { border-image-width: inherit; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    expect(at).toEqual(['border-image-width: 4px on <div> a', 'border-image-width: 4px on <div> a', 'border-image-width: 4px on <div> a', 'border-image-width: 4px on <div> b', 'border-image-width: 4px on <div> b', 'border-image-width: 4px on <div> b']);
  });

  it('refuses every border image longhand in @keyframes, even at its initial value', () => {
    for (const p of BORDER_IMAGE_LONGHANDS) expect(ANIMATION_KINDS[p].kind, p).toBe(p === 'border-image-repeat' ? 'discrete' : 'smooth-unadmitted');
    const kf = (frames: string): string[] => {
      const css = `body { font-family: Ahem; font-size: 10px; } .s { animation: k 1s; } @keyframes k { ${frames} }`;
      const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
      return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${d.message.split(' cannot')[0]}`);
    };
    // The control: an animation of an admitted longhand compiles.
    expect(kf('to { width: 30px }')).toEqual([]);
    for (const p of BORDER_IMAGE_LONGHANDS) expect(kf(`to { ${INITIAL_DECLS[BORDER_IMAGE_LONGHANDS.indexOf(p)]} }`), p).toEqual([`null DRAGON_UNSUPPORTED_VALUE ${p} in @keyframes k`]);
    for (const d of ['border-image: none', '-webkit-border-image: none']) expect(kf(`to { ${d} }`), d).toEqual(BORDER_IMAGE_LONGHANDS.map((p) => `null DRAGON_UNSUPPORTED_VALUE ${p} in @keyframes k`));
  });

  it('plant borderImageAccepted: a border image compiles', () => {
    expect(errorsAt('border-image-source: url(b.png)', { ...NO_FAULTS, borderImageAccepted: true })).toEqual([]);
    expect(errorsAt('border-image: linear-gradient(red, blue) 1', { ...NO_FAULTS, borderImageAccepted: true })).toEqual([]);
  });
});
