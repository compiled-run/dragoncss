// css-images-3 §5.3, image-rendering (css/properties/image-rendering.ts, analysis/image-rendering.ts): Chrome 145's three keywords
// parse, and every other value is dropped as Chrome drops it (packages/parity/test/render-anchor-parse.test.ts pins both against
// Chrome). auto and -webkit-optimize-contrast are accepted everywhere; pixelated is accepted on every target where the element
// paints no image layer, and on the web output everywhere, as Chrome draws it from the written CSS. The Chrome case is
// replaced-pixelated (packages/parity/fixtures, fixture-groups/replaced.ts).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { isPixelated } from '../src/css/properties/image-rendering.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/image-rendering.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, or its diagnostics' codes. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code> <element>` for `.s { decl }` on a, with Ahem text in its child b (`.c { child }`). */
function errorsAt(decl: string, child = '', faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; } .c { ${child} }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${/<div> (\w+)/.exec(d.message)?.[1] ?? d.message}`).sort();
}

const NATIVE_REFUSED = (id: string): string[] => [`android DRAGON_UNSUPPORTED_VALUE ${id}`, `ios DRAGON_UNSUPPORTED_VALUE ${id}`];

describe('image-rendering', () => {
  it('parses Chrome 145\'s three keywords in any ASCII case and drops every other value', () => {
    expect(parsed('image-rendering: AUTO')).toEqual(['image-rendering: auto']);
    expect(parsed('image-rendering: Pixelated')).toEqual(['image-rendering: pixelated']);
    expect(parsed('image-rendering: -WEBKIT-optimize-contrast')).toEqual(['image-rendering: -webkit-optimize-contrast']);
    for (const v of ['crisp-edges', 'smooth', 'high-quality', 'optimizeSpeed', 'optimizeQuality', 'auto auto', 'none', '0']) expect(parsed(`image-rendering: ${v}`), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(errorsAt('image-rendering: crisp-edges')).toEqual(['null DRAGON_CSS_INVALID_VALUE "crisp-edges" is not a valid value for image-rendering: image-rendering takes auto, -webkit-optimize-contrast or pixelated (Chrome 145 drops any other value)']);
    expect(isPixelated({ kind: 'keyword', value: 'pixelated' })).toBe(true);
    expect(isPixelated({ kind: 'keyword', value: '-webkit-optimize-contrast' })).toBe(false);
  });

  it('accepts every keyword on every target where no image layer is painted, set or inherited', () => {
    for (const v of ['auto', '-webkit-optimize-contrast', 'pixelated']) {
      expect(errorsAt(`image-rendering: ${v}; background-color: #abc; border: 2px solid red`), v).toEqual([]);
      expect(errorsAt(`image-rendering: ${v}`, 'box-shadow: 1px 1px red'), v).toEqual([]);
    }
    // -webkit-optimize-contrast draws an image layer as auto does.
    expect(errorsAt('image-rendering: -webkit-optimize-contrast; background-image: linear-gradient(red, blue)')).toEqual([]);
  });

  it('refuses pixelated on iOS and Android where the element paints an image layer, inherited or not, never on the web', () => {
    expect(errorsAt('image-rendering: pixelated; background-image: linear-gradient(red, blue)')).toEqual(NATIVE_REFUSED('a'));
    expect(errorsAt('image-rendering: pixelated', 'background-image: radial-gradient(red, blue)')).toEqual(NATIVE_REFUSED('b'));
    expect(errorsAt('image-rendering: pixelated; background: radial-gradient(red, blue) #abc')).toEqual(NATIVE_REFUSED('a'));
    // The child's own auto is drawn as auto.
    expect(errorsAt('image-rendering: pixelated', 'image-rendering: auto; background-image: linear-gradient(red, blue)')).toEqual([]);
    expect(errorsAt('--r: pixelated; image-rendering: var(--r); background-image: linear-gradient(red, blue)')).toEqual(NATIVE_REFUSED('a'));
    const c = project(NO_FAULTS).compile(inputFor('body { font-family: Ahem; font-size: 10px; } .s { image-rendering: pixelated; background-image: linear-gradient(red, blue); }', (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.map((d) => d.target).sort()).toEqual(['android', 'ios']);
    for (const d of errors) expect(d.message).toBe('image-rendering: pixelated on <div> a is unsupported with its background-image: Chrome samples that image layer nearest-neighbour, and Dragon draws only an img\'s image so');
  });

  it('refuses pixelated on iOS and Android on an img under a transform, set, will-change or animated, on it or an ancestor', () => {
    /** The pixelated-under-transform errors for an img .i (`.i { img }`) inside a div .w (`.w { wrap }`). */
    const under = (img: string, wrap = '', faults: CompilerFaults = NO_FAULTS): string[] => {
      const css = `body { margin: 0; } @keyframes k { to { opacity: 0.5; } } @keyframes t { to { rotate: 10deg; } } .w { ${wrap} } .i { width: 20px; height: 20px; image-rendering: pixelated; ${img} }`;
      const c = project(faults).compile(inputFor(css, (r) => [el(r, 'w', 'div', ['w'], [{ ...el(r, 'i', 'img', ['i']), attributes: [] }])]));
      return c.diagnostics.filter((d) => d.severity === 'error' && d.message.includes('under')).map((d) => `${String(d.target)} ${/under (its own|the transform or animation of \w+)/.exec(d.message)?.[1] ?? d.message}`).sort();
    };
    const at = (who: string): string[] => [`android ${who}`, `ios ${who}`];
    expect(under('')).toEqual([]);
    expect(under('transform: scale(3)')).toEqual(at('its own'));
    expect(under('rotate: 10deg')).toEqual(at('its own'));
    expect(under('will-change: transform')).toEqual(at('its own'));
    expect(under('', 'transform: rotate(10deg)')).toEqual(at('the transform or animation of w'));
    expect(under('', 'animation: t 1s')).toEqual(at('the transform or animation of w'));
    expect(under('animation: t 1s')).toEqual(at('its own'));
    // An animation of no transform, and a transform inside the img's own transformed ancestor, are the same refusal once.
    expect(under('', 'animation: k 1s')).toEqual([]);
    expect(under('transform: scale(3)', 'animation: t 1s')).toEqual(at('its own'));
    expect(under('image-rendering: auto', 'transform: rotate(10deg)')).toEqual([]);
    expect(under('display: none', 'transform: rotate(10deg)')).toEqual([]);
    expect(under('transform: scale(3)', '', { ...NO_FAULTS, imageRenderingAccepted: true })).toEqual([]);
  });

  it('plants its fault: pixelated over an image layer compiles', () => {
    expect(errorsAt('image-rendering: pixelated; background-image: linear-gradient(red, blue)', '', { ...NO_FAULTS, imageRenderingAccepted: true })).toEqual([]);
  });
});
