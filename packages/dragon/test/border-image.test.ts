// MISC-PAINT: the border image longhands, border-image and -webkit-border-image. Every target accepts a border image whose source is
// none, and part 1's gradient border image (analysis/border-image.ts); the rest is kept and refused where it applies, by name. The
// Chrome cases are border-image-initial, border-image-gradient, border-image-fractional, border-image-repeat, border-image-webkit, reject-border-image-source and reject-border-image-url
// (packages/parity/fixtures); packages/parity/test/border-image-parse.test.ts pins the parse against Chrome.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import { emitNativeSupport, SUPPORT_PLANTS } from '../src/emit/native-support.ts';
import type { GradientImage } from '@dragon/layout';
import { borderImageStopsModelled } from '@dragon/layout';
import { stopsResolveApart } from '../src/analysis/paint-values/stop-offsets.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { initialValue, valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { BORDER_IMAGE_INITIAL, BORDER_IMAGE_LONGHANDS, isInitialBorderImage } from '../src/css/properties/border-image.ts';
import { MASK_LONGHANDS } from '../src/css/properties/mask.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import type { Diagnostic } from '../src/types.ts';
import { WEB_CSS_PATH } from '../src/emit/web-css.ts';
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
  it('follows mask in Chrome\'s border-image shorthand order', () => {
    const start = LONGHANDS.indexOf(MASK_LONGHANDS[MASK_LONGHANDS.length - 1] as (typeof MASK_LONGHANDS)[number]) + 1;
    expect(LONGHANDS.slice(start, start + BORDER_IMAGE_LONGHANDS.length)).toEqual([...BORDER_IMAGE_LONGHANDS]);
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
    // border-image sets each component it holds and resets the rest; a value its grammar does not take is kept on every longhand,
    // so it is over-refused rather than read as partly initial.
    expect(parsed('border-image: url(b.png) 30 round')).toEqual(['border-image-source: url(b.png)', 'border-image-slice: 30', 'border-image-width: 1', 'border-image-outset: 0', 'border-image-repeat: round']);
    expect(parsed('border-image: none 100% / 1 / 0 stretch')).toEqual(INITIAL_DECLS);
    expect(parsed('border-image: round linear-gradient(red, blue) fill 10% 4 / / 2px')).toEqual(['border-image-source: linear-gradient(red,blue)', 'border-image-slice: fill 10% 4', 'border-image-width: 1', 'border-image-outset: 2px', 'border-image-repeat: round']);
    expect(parsed('border-image: 10 / 4px auto 2 stretch space')).toEqual(['border-image-source: none', 'border-image-slice: 10', 'border-image-width: 4px auto 2', 'border-image-outset: 0', 'border-image-repeat: stretch space']);
    for (const d of ['border-image: 1 2 3 4 5', 'border-image: 10 / / ', 'border-image: 10 /', 'border-image: url(a.png) url(b.png)', 'border-image: round round round', 'border-image: bogus', 'border-image: 10 / -1', 'border-image: round fill 10% 4 linear-gradient(red, blue) / / 2px']) {
      expect(kindsOf(d), d).toEqual(['other', 'other', 'other', 'other', 'other']);
    }
    // -webkit-border-image takes the same grammar, and a slice it holds is filled (ConsumeWebkitBorderImage, DefaultFill::kFill).
    expect(parsed('-webkit-border-image: url(b.png) 10 / 4px')).toEqual(['border-image-source: url(b.png)', 'border-image-slice: 10 fill', 'border-image-width: 4px', 'border-image-outset: 0', 'border-image-repeat: stretch']);
    expect(parsed('-webkit-border-image: url(b.png) fill 10 round')).toEqual(['border-image-source: url(b.png)', 'border-image-slice: fill 10', 'border-image-width: 1', 'border-image-outset: 0', 'border-image-repeat: round']);
    expect(parsed('-webkit-border-image: linear-gradient(red, blue)')).toEqual(['border-image-source: linear-gradient(red,blue)', ...INITIAL_DECLS.slice(1)]);
    expect(kindsOf('-webkit-border-image: bogus')).toEqual(['other', 'other', 'other', 'other', 'other']);
    // The types the profile rows key (featureOf <longhand>:<type>).
    const typesOf = (decl: string): string[] => {
      const css = `.a { ${decl}; }`;
      const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, []);
      return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => (l.value.kind === 'other' ? l.value.type : l.value.kind));
    };
    expect(typesOf('border-image: linear-gradient(red, blue) 30% fill / 2 / 1px repeat')).toEqual(['linear-gradient()', 'slice', 'widths', 'outsets', 'repeat']);
    expect(typesOf('border-image-source: url(b.png)')).toEqual(['url()']);
    expect(typesOf('border-image-source: bogus')).toEqual(['border-image-value']);
    // border resets the border image (Chrome's border shorthand includes the border image longhands); border-top does not.
    expect(parsed('border: 1px solid red').slice(12)).toEqual(INITIAL_DECLS);
    expect(parsed('border-top: 1px solid red')).toHaveLength(3);
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

  it('accepts a source of none with any other longhand, and part 1\'s gradient border images, on every target', () => {
    for (const d of ['border-image-slice: 30%', 'border-image-slice: 100% fill', 'border-image-width: 4px', 'border-image-width: 10%', 'border-image-outset: 2px', 'border-image-repeat: round', 'border-image: none 10 / 3 / 2 round']) {
      expect(errorsAt(d), d).toEqual([]);
    }
    for (const d of [
      'border-image-source: linear-gradient(red, blue)',
      'border-image: linear-gradient(red, blue) 1',
      'border-image: linear-gradient(to right, red, blue) 1',
      'border-image: linear-gradient(110deg, #2f4f66, #a57c5b 40%, #102030) 30% fill / 2 4px auto',
      'border-image: linear-gradient(0.3turn, red, blue) 10 / 0 / 0px stretch stretch',
      'border-style: none; border-image: linear-gradient(red, blue) 10 fill',
      'border-style: dashed; border-image: linear-gradient(red, blue) 2',
    ]) expect(errorsAt(d), d).toEqual([]);
    // A later border resets an earlier border image (and an earlier border does not reset a later one), as in Chrome.
    expect(errorsAt('border-image: url(b.png) 30 round; border: 1px solid')).toEqual([]);
    // A tiled border image on a box of no proven size is drawn on web and refused natively (border-image-tiling.ts).
    expect(errorsAt('border-image: linear-gradient(red, blue) 1 round; border-top: 1px solid')).toEqual(REFUSED.filter((x) => !x.startsWith('web ')));
  });

  it('refuses every border image part 1 draws on no target, on every target by name, once where it applies', () => {
    const cases: readonly (readonly [string, RegExp])[] = [
      ['border-image-source: url(b.png)', /^border-image-source: url\(b\.png\) on <div> a is unsupported: a url\(\) border image is not drawn yet/],
      ['border-image: url(b.png) 30 round', /^border-image-source: url\(b\.png\) on <div> a is unsupported: a url\(\) border image/],
      ['border-image-source: radial-gradient(red, blue)', /a radial-gradient\(\) border image is not drawn yet/],
      ['border-image-source: repeating-linear-gradient(red, blue 10%)', /a repeating-linear-gradient\(\) border image is not drawn yet/],
      ['border-image-source: conic-gradient(red, blue)', /a conic-gradient\(\) border image is not drawn yet/],
      ['border-image-source: linear-gradient(red, 30%, blue)', /the gradient: colour hints/],
      ['border-image: linear-gradient(red, blue) 1 / 10%', /^border-image-width: 10% on <div> a is unsupported: a percentage border image width/],
      ['border-image: linear-gradient(red, blue) 1 / 1em', /a border image width in em/],
      ['border-image: linear-gradient(red, blue) 1 / 1 / 2px', /^border-image-outset: 2px on <div> a is unsupported: a border image outset/],
      ['border-image: linear-gradient(red, blue) 1 / 1 / 0.5', /a border image outset/],
      ['-webkit-border-image: url(b.png) 10 / 4px', /^border-image-source: url\(b\.png\) on <div> a is unsupported: a url\(\) border image/],
      ['-webkit-border-image: linear-gradient(red, blue) 1 / 1em', /^-webkit-border-image: \S+ on <div> a is unsupported: its border image width in em sets a border width Dragon does not compute/],
    ];
    for (const [d, message] of cases) {
      const css = `body { font-family: Ahem; font-size: 10px; } .s { border: 2px solid #102030; ${d}; }`;
      const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'XX')])])]));
      const errors = c.diagnostics.filter((x) => x.severity === 'error');
      expect(errors.map((x) => `${String(x.target)} ${x.code}`).sort(), d).toEqual(REFUSED);
      for (const x of errors) expect(x.message, d).toMatch(message);
    }
    // What only the native raster cannot draw exactly is refused on ios and android; the web output keeps it as written.
    const nativeCases: readonly (readonly [string, RegExp])[] = [
      ['border-image-source: linear-gradient(to top right, red, blue)', /a gradient to a corner/],
      ['border-image-source: linear-gradient(10.005deg, red, blue)', /off the 0\.01deg grid/],
      ['border-image-source: linear-gradient(currentcolor, blue)', /a currentcolor stop/],
      ['border-image-source: linear-gradient(rgba(255, 0, 0, 0.5), blue)', /a translucent stop/],
      ['border-image-source: linear-gradient(transparent, blue)', /a translucent stop/],
      ['border-image-source: linear-gradient(red 4px, blue)', /a stop position in px/],
      ['border-image-source: linear-gradient(red 50%, blue 50%)', /the stops resolve to one offset/],
      // The stops as the native raster resolves them (f32), not as written: these meet once resolved.
      ['border-image-source: linear-gradient(red 50%, blue 50.000001%)', /the stops resolve to one offset/],
      ['border-image-source: linear-gradient(red 150%, blue 150.000001%)', /the stops resolve to one offset/],
      ['border-image-source: linear-gradient(red 60%, blue 20%)', /the stops resolve to one offset/],
      ['border-image: linear-gradient(red, blue) 1; border-radius: 4px', /on a rounded box/],
      ['border-image: linear-gradient(red, blue) 1; background-image: linear-gradient(red, blue)', /over a background image/],
      ['border-image: linear-gradient(red, blue) 1; display: list-item', /display list-item/],
      ['border-image: linear-gradient(red, blue) 1; display: table-cell', /display table-cell/],
      // Chrome draws no border style under a border image, so a colour clipped inside the border box leaves the band open.
      ['border-image: linear-gradient(red, blue) 10 / 4px; background: #fff; background-clip: padding-box', /a background colour clipped to the padding or content box/],
      ['border-image: linear-gradient(red, blue) 10 / 4px; background-color: #fff; background-clip: content-box', /a background colour clipped to the padding or content box/],
      // MISC-PAINT part 2: a tiled border image on a box whose size Dragon cannot prove (border-image-tiling.ts).
      ['border-image: linear-gradient(red, blue) 1 round', /^border-image-repeat: round on <div> a is unsupported: Dragon cannot prove its border box exactly/],
      ['border-image: linear-gradient(red, blue) 1 stretch space', /^border-image-repeat: stretch space on <div> a is unsupported: Dragon cannot prove/],
      ['border-image: linear-gradient(red, blue) 1 repeat', /^border-image-repeat: repeat on <div> a is unsupported: Dragon cannot prove/],
    ];
    for (const [d, message] of nativeCases) {
      const css = `body { font-family: Ahem; font-size: 10px; } .s { border: 2px solid #102030; ${d}; }`;
      const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'XX')])])]));
      const errors = c.diagnostics.filter((x) => x.severity === 'error');
      expect(errors.map((x) => `${String(x.target)} ${x.code}`).sort(), d).toEqual(REFUSED.filter((x) => !x.startsWith('web ')));
      for (const x of errors) expect(x.message, d).toMatch(message);
      expect(c.outputs.web.kind, d).toBe('ready');
    }
    // A clip inside the border box with no colour to clip, or a border-box clip, is drawn.
    expect(errorsAt('border-image: linear-gradient(red, blue) 10 / 4px; background-clip: padding-box')).toEqual([]);
    expect(errorsAt('border-image: linear-gradient(red, blue) 10 / 4px; background: #fff; background-clip: border-box')).toEqual([]);
    expect(errorsAt('border-image-source: linear-gradient(red 50%, blue 50.01%)')).toEqual([]);
    // A value that arrives through var() is refused as well.
    expect(errorsAt('--b: url(b.png); border-image-source: var(--b)')).toEqual(REFUSED);
    expect(errorsAt('--b: url(b.png) 30; -webkit-border-image: var(--b)')).toEqual(REFUSED);
    expect(errorsAt('--b: linear-gradient(red, blue); border-image-source: var(--b)')).toEqual([]);
    // A -webkit-border-image that loses its source to none sets no border width here (no length width), so nothing is drawn.
    expect(errorsAt('-webkit-border-image: url(b.png) 30; border-image-source: none')).toEqual([]);
    // The reject fixtures' messages (packages/parity/src/fixture-groups/border-image.ts).
    const shown = (css: string): string[] => project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; } .s { border: 4px solid #102030; ${css} }`, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])])).diagnostics.filter((x) => x.severity === 'error').map((x) => x.message);
    expect(shown('border-image-source: radial-gradient(red, blue);').map((m) => m.startsWith('border-image-source: radial-gradient(red,blue) on <div> a is unsupported: '))).toEqual([true, true, true]);
    expect(shown('border-image: url(b.png) 1;').map((m) => m.startsWith('border-image-source: url(b.png) on <div> a is unsupported: '))).toEqual([true, true, true]);
  });

  it('refuses a drawn border image natively under an effective zoom other than 1, and web keeps it', () => {
    // Chrome scales the slices and the gradient by the effective zoom times the device scale; the native writes pass the device scale.
    const at = (outer: string, inner = ''): { errors: string[]; web: string } => {
      const css = `body { font-family: Ahem; font-size: 10px; } .o { ${outer} } .s { border: 4px solid #102030; border-image: linear-gradient(red, blue) 2; ${inner} }`;
      const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'o', 'div', ['o'], [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])])]));
      return { errors: c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${d.message}`).sort(), web: c.outputs.web.kind };
    };
    expect(at('').errors).toEqual([]);
    for (const [outer, inner, z] of [['zoom: 2', '', '2'], ['', 'zoom: 0.5', '0.5'], ['zoom: 1.5', 'zoom: 2', '3']] as const) {
      const r = at(outer, inner);
      expect(r.errors, `${outer}|${inner}`).toEqual(['android', 'ios'].map((t) => `${t} DRAGON_UNSUPPORTED_VALUE border-image-source on <div> a is unsupported: its effective zoom is ${z}, and native draws a border image at zoom 1 only (MISC-PAINT)`));
      expect(r.web).toBe('ready');
    }
    // Zooms that multiply to 1, and a zoomed box with no border image source, compile.
    expect(at('zoom: 2', 'zoom: 0.5').errors).toEqual([]);
    expect(at('zoom: 2', 'border-image-source: none').errors).toEqual([]);
  });

  it('refuses a drawn border image on the native targets inside a transformed or composited subtree, and web keeps it', () => {
    const at = (outer: string, inner = ''): string[] => {
      const css = `body { font-family: Ahem; font-size: 10px; } .o { ${outer} } .s { border: 4px solid #102030; border-image: linear-gradient(red, blue) 2; ${inner} }`;
      const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'o', 'div', ['o'], [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])])]));
      return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${d.message.split(':')[0]}`).sort();
    };
    expect(at('width: 100px')).toEqual([]);
    const native = ['android DRAGON_UNSUPPORTED_VALUE border-image-source on a', 'ios DRAGON_UNSUPPORTED_VALUE border-image-source on a'];
    expect(at('transform: rotate(10deg)')).toEqual(native);
    expect(at('will-change: transform')).toEqual(native);
    expect(at('overflow: auto; height: 20px')).toEqual(native);
    expect(at('', 'will-change: opacity')).toEqual(native);
  });

  it('draws a border image on the body or html whose overflow the viewport takes, as the check and the lowering agree', () => {
    for (const [root, body] of [['', 'overflow: auto;'], ['overflow: auto;', '']] as const) {
      const css = `html { ${root} } body { font-family: Ahem; font-size: 10px; ${body} border: 4px solid #000; border-image: linear-gradient(red, blue) 2; }`;
      const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', [], [text(r, 't', 'XX')])]));
      expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${d.message}`), `${root}|${body}`).toEqual([]);
      const p = nativePrograms(c, []);
      expect(p.kind === 'ready' ? 'ready' : p.reason, `${root}|${body}`).toBe('ready');
      if (p.kind === 'ready') for (const b of ['uikit', 'android-views'] as const) expect(p.programs[b].nodes.some((n) => n.writes.some((w) => w.kind === 'border-image')), b).toBe(true);
    }
  });

  it('applies the border widths -webkit-border-image sets, winning or losing, unless a border width is declared, as Chrome does', () => {
    // webkit-border-image.ts: MapNinePieceImage sets border-<side>-width from a px width part; any declared border width wins.
    const widthsOf = (decl: string, faults: CompilerFaults = NO_FAULTS, extra = ''): { errors: string[]; css: string } => {
      const c = project(faults).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } .s { ${decl}; } ${extra}`, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
      const web = c.outputs.web.kind === 'ready' ? ((c.outputs.web.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text.match(/border-(top|right|bottom|left)-width: [^;]+/g) ?? []).join(', ') : c.outputs.web.kind;
      return { errors: c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort(), css: web };
    };
    const W = (t: string, r = t, b = t, l = r) => `border-top-width: ${t}, border-right-width: ${r}, border-bottom-width: ${b}, border-left-width: ${l}`;
    // Winning, losing its border image to a later border-image: none, and !important both ways: the widths stay.
    for (const d of [
      'border-style: solid; -webkit-border-image: linear-gradient(red, blue) 8 / 8px',
      'border-style: solid; -webkit-border-image: url(b.png) 10 / 8px; border-image: none',
      'border-style: solid; -webkit-border-image: url(b.png) 10 / 8px; border-image-source: none',
      'border-style: solid; -webkit-border-image: url(b.png) 10 / 8px !important; border-image: none !important',
    ]) {
      const r = widthsOf(d);
      expect(r.errors, d).toEqual([]);
      expect(r.css, d).toContain(W('8px'));
    }
    // Per side, from px lengths only; a declared border width wins in either order; none and the CSS-wide keywords set none.
    expect(widthsOf('border-style: solid; -webkit-border-image: linear-gradient(red, blue) 8 / 8px 2 auto 4px').css).toContain(W('8px', 'medium', 'medium', '4px'));
    expect(widthsOf('border: 2px solid; -webkit-border-image: linear-gradient(red, blue) 8 / 8px').css).toContain(W('2px'));
    expect(widthsOf('-webkit-border-image: linear-gradient(red, blue) 8 / 8px; border-style: solid; border-top-width: 2px').css).toContain(W('2px', '8px', '8px', '8px'));
    for (const k of ['none', 'inherit', 'initial', 'unset', 'revert']) expect(widthsOf(`border-style: solid; -webkit-border-image: ${k}`).css, k).toContain(W('medium'));
    // Inside a state rule too: every check runs on each interaction state (native refuses :hover on a div as a selector anyway).
    const selector = ['android DRAGON_UNSUPPORTED_SELECTOR', 'ios DRAGON_UNSUPPORTED_SELECTOR'];
    expect(widthsOf('border-style: solid', NO_FAULTS, '.s:hover { -webkit-border-image: url(b.png) 10 / 20px; border-image: none; }').errors).toEqual(selector);
    // Refused on every target: a var() value, a width in another unit, two that set different widths.
    for (const d of [
      '--x: url(b.png) 10 / 20px; -webkit-border-image: var(--x); border-image: initial',
      '-webkit-border-image: linear-gradient(red, blue) 8 / 1em; border-image: none',
    ]) expect(widthsOf(`border-style: solid; ${d}`).errors, d).toEqual(REFUSED);
    const two = widthsOf('border-style: solid; -webkit-border-image: linear-gradient(red, blue) 8 / 8px', NO_FAULTS, '.s.s { -webkit-border-image: linear-gradient(red, blue) 8 / 4px; }');
    expect(two.errors).toEqual(REFUSED);
    // Under one device px, which Chrome floors to 0 where a border width is at least one device px: native only.
    const thin = widthsOf('border-style: solid; -webkit-border-image: linear-gradient(red, blue) 8 / 0.3px');
    expect(thin.errors).toEqual(['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE']);
    // The plant reads it as the border-image shorthand: the border widths stay medium.
    expect(widthsOf('border-style: solid; -webkit-border-image: linear-gradient(red, blue) 8 / 8px', { ...NO_FAULTS, webkitBorderImageWidthsIgnored: true }).css).toContain(W('medium'));
  });

  it('refuses a border image that a child inherits explicitly, on the child too', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { border-image: linear-gradient(red, blue) 1 / 4px round; } .c { border-image-repeat: inherit; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    // Refused natively only: web draws round (border-image-tiling.ts cannot prove the auto-sized box).
    expect(at).toEqual(['border-image-repeat: round on <div> a', 'border-image-repeat: round on <div> a']);
    // The child's own source is none, so it draws nothing; inheriting the source too refuses it.
    const both = 'body { font-family: Ahem; font-size: 10px; } .s { border-image: linear-gradient(red, blue) 1 / 4px round; } .c { border-image: inherit; }';
    const d = project(NO_FAULTS).compile(inputFor(both, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    expect(d.diagnostics.filter((x) => x.severity === 'error').map((x) => x.message.split(' is unsupported')[0]).sort()).toEqual(['border-image-repeat: round on <div> a', 'border-image-repeat: round on <div> a', 'border-image-repeat: round on <div> b', 'border-image-repeat: round on <div> b']);
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

describe('border-image native support', () => {
  it('the border stage draws the image in place of the style, lays it out after layout, and has the border-image-offset-1 plant', () => {
    expect(SUPPORT_PLANTS).toContain('border-image-offset-1');
    for (const [b, ext] of [['uikit', 'swift'], ['android-views', 'kt']] as const) {
      const own = emitNativeSupport(b).find((f) => f.path.endsWith(`DragonPaintBorder.${ext}`))?.text ?? '';
      expect(own).toContain(b === 'uikit' ? '  if dragonPaintBorderImage(v, ctx, shape) { return }' : '  if (dragonPaintBorderImage(v, canvas, shape)) return');
      expect(own).toContain('  dragonAfterLayoutBorderImage(v, shape, scale)');
      const [off, on] = b === 'uikit' ? ['public let dragonBorderImagePlantDevicePx: Double = 0\n', 'public let dragonBorderImagePlantDevicePx: Double = 1\n'] : ['const val DRAGON_BORDER_IMAGE_PLANT_DEVICE_PX = 0.0\n', 'const val DRAGON_BORDER_IMAGE_PLANT_DEVICE_PX = 1.0\n'];
      expect(own).toContain(off);
      const planted = emitNativeSupport(b, 'border-image-offset-1').find((f) => f.path.endsWith(`DragonPaintBorder.${ext}`))?.text ?? '';
      expect(planted).toContain(on);
      expect(planted.replace(on, off)).toBe(own);
    }
  });
});

describe('border image stops', () => {
  it('the check resolves percent stops as the engine does (borderImageStopsModelled), so no accepted stops leave the device plan unmodelled', () => {
    const image = (stops: readonly { unit: 'auto' | 'percent'; value: number }[]): GradientImage => ({ radial: false, repeating: false, direction: 'default', angleDeg: 180, slope: 0, sideX: 'none', sideY: 'none', circle: false, extent: 'farthest-corner', radiusX: { unit: 'px', value: 0 }, radiusY: { unit: 'px', value: 0 }, centerX: { unit: 'percent', value: 50 }, centerY: { unit: 'percent', value: 50 }, stops: stops.map((s, i) => ({ color: { r: 255 * (i % 2), g: 40, b: 255 * ((i + 1) % 2), alpha: 255 }, unit: s.unit, value: s.value })) });
    const values = [-50, -0.0000001, 0, 0.0000001, 10, 33.3333, 49.9999999, 50, 50.000001, 50.00001, 99.9999999, 100, 100.0000001, 150, 150.000001, 150.0001, 200];
    let checked = 0;
    for (const a of values) {
      for (const b of values) {
        for (const stops of [[{ unit: 'percent' as const, value: a }, { unit: 'percent' as const, value: b }], [{ unit: 'percent' as const, value: a }, { unit: 'auto' as const, value: 0 }, { unit: 'percent' as const, value: b }], [{ unit: 'auto' as const, value: 0 }, { unit: 'percent' as const, value: a }, { unit: 'percent' as const, value: b }, { unit: 'auto' as const, value: 0 }]]) {
          expect(stopsResolveApart(stops), JSON.stringify(stops)).toBe(borderImageStopsModelled(image(stops)));
          checked++;
        }
      }
    }
    expect(checked).toBe(values.length * values.length * 3);
  });
});
