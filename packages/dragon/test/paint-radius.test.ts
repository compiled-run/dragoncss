// PNT1 border-radius (css-backgrounds-3 §5): parsing of the corner longhands and the shorthand with Chrome 145's rules beyond the
// grammar, computed values (em and rem to px, equal pairs collapsed), the refusals, the lowering to one write with typed facts, the
// emitted writer lines and the expected applied radii (the TS paint-radius.ts the device runs translated).
import { describe, expect, it } from 'vitest';
import { roundedShape } from '@dragon/layout';
import type { Diagnostic } from '../src/index.ts';
import type { Targets } from '../src/types.ts';
import { createProjectWith, laneOnlyNative, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { BORDER_EMITTER } from '../src/emit/paint/border.ts';
import { IMAGE_EMITTER } from '../src/emit/paint/image.ts';
import { RADIUS_EMITTER } from '../src/emit/paint/radius.ts';
import type { DraftTree, FrontEndResult } from '../src/index.ts';
import { div, DOC, eq, expectCatalogued, explainOne, inputFor, not, spanTextOf } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/radius.css', revision: 'r1', hash: 'sha256:0' };

function declare(property: string, value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; css: string } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, css };
}

const spanOf = (css: string, d: Diagnostic): string => (d.origin.kind === 'authored' ? css.slice(d.origin.span.start, d.origin.span.end) : '<unlocated>');

function compile(css: string, targets: Targets = { ios: { minimum: '15.0' }, web: {} }) {
  const input = inputFor(`body { margin: 0; font-size: 20px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])]);
  return { input, c: createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input) };
}

/** A box .a that gains class on in the open state, as animations.test.ts states it, so a transition has a state pair to start it. */
function stated(css: string): FrontEndResult {
  const input = inputFor(css, (r) => {
    const d = div(r, 'a', ['a']);
    const on = { value: [{ when: eq('open', true), value: { owner: DOC, sheet: 's', name: 'on' } }, { when: not(eq('open', true)), value: null }], origin: d.origin };
    return [{ ...d, classes: [...d.classes, on] }];
  });
  const tree = input.tree as DraftTree;
  const root = tree.components[0] as DraftTree['components'][number];
  return { ...input, tree: { ...tree, components: [{ ...root, states: [{ id: 'open', domain: [false, true], initial: false, origin: root.origin }] }] } };
}

const CORNERS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];

describe('border-radius: parse and computed values (Chrome 145 getComputedStyle)', () => {
  // [declaration, the four computed corners as Chrome 145 serializes them] (probed with the pinned Chrome)
  const cases: [string, string[]][] = [
    ['border-radius: 10px', ['10px', '10px', '10px', '10px']],
    ['border-radius: 10px 20px', ['10px', '20px', '10px', '20px']],
    ['border-radius: 10px / 20px', ['10px 20px', '10px 20px', '10px 20px', '10px 20px']],
    ['border-radius: 50%', ['50%', '50%', '50%', '50%']],
    ['border-radius: 1rem', ['16px', '16px', '16px', '16px']],
    ['border-radius: 2em', ['40px', '40px', '40px', '40px']],
    ['border-radius: 10px 20px 30px 40px / 5px 6px', ['10px 5px', '20px 6px', '30px 5px', '40px 6px']],
    ['border-radius: 0', ['0px', '0px', '0px', '0px']],
    ['border-radius: 1em/2em 3em', ['20px 40px', '20px 60px', '20px 40px', '20px 60px']],
    ['border-top-left-radius: 10px 10px', ['10px', '0px', '0px', '0px']],
    ['border-top-left-radius: 10px 20px', ['10px 20px', '0px', '0px', '0px']],
    ['border-top-left-radius: 0.35rem', ['5.6px', '0px', '0px', '0px']],
    ['border-top-left-radius: 0.5em 1rem', ['10px 16px', '0px', '0px', '0px']],
    ['border-top-left-radius: 1rem 16px', ['16px', '0px', '0px', '0px']],
    ['border-top-left-radius: 50% 50%', ['50%', '0px', '0px', '0px']],
    ['border-top-left-radius: 33.333%', ['33.333%', '0px', '0px', '0px']],
    ['border-top-left-radius: 1in 1pt', ['96px 1.3333333333333333px', '0px', '0px', '0px']],
    // -webkit-border-radius: Chrome's legacy parsing reads exactly two values with no "/" as horizontal / vertical.
    ['-webkit-border-radius: 10px', ['10px', '10px', '10px', '10px']],
    ['-webkit-border-radius: 10px 20px', ['10px 20px', '10px 20px', '10px 20px', '10px 20px']],
    ['-webkit-border-radius: 10px 20px 30px', ['10px', '20px', '30px', '20px']],
    ['-webkit-border-radius: 10px 20px / 5px', ['10px 5px', '20px 5px', '10px 5px', '20px 5px']],
    ['-webkit-border-radius: 1em 50%', ['20px 50%', '20px 50%', '20px 50%', '20px 50%']],
    ['-webkit-border-radius: 30px; border-radius: 4px', ['4px', '4px', '4px', '4px']],
    ['border-radius: 4px; -webkit-border-radius: 6px 2px', ['6px 2px', '6px 2px', '6px 2px', '6px 2px']],
  ];
  for (const [decl, want] of cases) {
    it(`${decl} computes to ${want.join(' | ')}`, () => {
      const { c } = compile(`.a { width: 100px; height: 50px; ${decl}; }`);
      expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(CORNERS.map((p) => explainOne(c, 'ios', 'a', p).value)).toEqual(want);
    });
  }

  it('a corner longhand with "/" or three values, a negative radius and a unitless non-zero radius are invalid, as in Chrome', () => {
    for (const [p, v] of [['border-top-left-radius', '10px / 20px'], ['border-top-left-radius', '10px 20px 30px'], ['border-radius', '-1px'], ['border-radius', '1px / 2px / 3px'], ['border-top-right-radius', '5']]) {
      const { declaration, diagnostics } = declare(p as string, v as string);
      expect(declaration, `${p}: ${v}`).toBeNull();
      expect(diagnostics.map((d) => d.code), `${p}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expectCatalogued(diagnostics);
    }
  });

  it('CSS-wide keywords set each corner; inherit takes the parent computed corners', () => {
    const { c } = compile('.a { border-radius: 9px 3px; } .b { border-radius: inherit; } ');
    expect(CORNERS.map((p) => explainOne(c, 'ios', 'b', p).value)).toEqual(['9px', '3px', '9px', '3px']);
    const { declaration } = declare('border-radius', 'unset');
    expect(declaration?.longhands.map((l) => [l.property, l.value])).toEqual(CORNERS.map((p) => [p, { kind: 'keyword', value: 'unset' }]));
  });

  it('var() substitutes into the shorthand and the corner longhands', () => {
    const { c } = compile('.a { --r: 12px; --pair: 20px 6px; border-radius: var(--r); border-bottom-right-radius: var(--pair); }');
    expect(CORNERS.map((p) => explainOne(c, 'ios', 'a', p).value)).toEqual(['12px', '12px', '20px 6px', '12px']);
  });
});

describe('border-radius: refusals', () => {
  it('a calculation, a viewport unit and a font-metric unit in a radius are DRAGON_UNSUPPORTED_VALUE on the token', () => {
    for (const [p, v, span] of [['border-radius', 'calc(10px + 5%)', 'calc(10px + 5%)'], ['border-top-left-radius', '2vw 4px', '2vw'], ['border-radius', '1ex', '1ex'], ['border-radius', '10px / min(5px, 2%)', 'min(5px, 2%)']]) {
      const { declaration, diagnostics, css } = declare(p as string, v as string);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      expect(spanOf(css, diagnostics[0] as Diagnostic)).toBe(span);
      expectCatalogued(diagnostics);
    }
  });

  it('env() in a radius is refused by name, before the grammar substitutes it', () => {
    for (const p of ['border-radius', '-webkit-border-radius', 'border-top-left-radius']) {
      const { declaration, diagnostics, css } = declare(p, '4px env(safe-area-inset-top)');
      expect(declaration, p).toBeNull();
      expect(diagnostics.map((d) => [d.code, d.message]), p).toEqual([['DRAGON_UNSUPPORTED_VALUE', `${p}: env(safe-area-inset-top) is unsupported: env() in ${p} is not supported`]]);
      expect(spanOf(css, diagnostics[0] as Diagnostic)).toBe('env(safe-area-inset-top)');
    }
  });

  it('a rounded box with a dashed, dotted or 3D border side is refused for ios and android at the radius declaration (PNT1b), naming why, and not for web', () => {
    const why: { readonly [style: string]: string } = {
      dashed: "(Blink strokes the rounded centre line with Skia's dash path effect, fitted to the whole path's length, which Dragon does not port)",
      dotted: "(Blink strokes the rounded centre line with Skia's dash path effect and round caps, fitted to the whole path's length, which Dragon does not port)",
      groove: '(Blink draws its two shades along the rounded corners, which Dragon does not port)',
      outset: '(Blink draws its two shades along the rounded corners, which Dragon does not port)',
    };
    for (const [style, says] of Object.entries(why)) {
      // A dashed or dotted side next to four double sides is still refused by its own name.
      const { c, input } = compile(`.a { width: 40px; height: 20px; border: 6px double blue; border-left-style: ${style}; border-radius: 6px; }`, { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} });
      const refused = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(refused.map((d) => d.target).sort(), style).toEqual(['android', 'ios']);
      for (const d of refused) {
        expect(spanTextOf(input, d)).toBe('6px');
        expect(d.message).toBe(`a rounds its corners and has a ${style} border side; rounded ${style} borders are PNT1b, which ${d.target} does not draw yet ${says}`);
      }
      expectCatalogued(refused);
    }
  });

  it('a rounded double border compiles on every target when its four sides are double in one width and colour, whatever the colour syntax', () => {
    // An opaque eight-digit hex colour: a translucent one is refused (the next test).
    for (const css of ['.a { width: 60px; height: 40px; border: 6px double blue; border-radius: 10px; }', '.a { width: 60px; height: 40px; border: 1px double #ff0000ff; border-radius: 50%; }','.a { width: 60px; height: 40px; border: 9px double red; border-top-color: #f00; border-left-color: rgb(255 0 0); border-radius: 4px 20px; }']) {
      const { c } = compile(css, { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} });
      expect(c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE'), css).toEqual([]);
    }
  });

  it('a translucent rounded double border is refused for ios and android by name, at the colour, in every state and band; web compiles (device run 38470185768)', () => {
    const both: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
    const project = (input: FrontEndResult, t: Targets = both, lanes = false) => createProjectWith({ projectId: 'test', targets: t }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', interactionLanes: lanes }).compile(input);
    const translucent = (c: { diagnostics: readonly Diagnostic[] }) => c.diagnostics.filter((d) => d.severity === 'error' && d.message.includes('rounded double border in the translucent colour'));
    const message = (colour: string, t: string) => `a is a rounded double border in the translucent colour ${colour}, which Chrome fills with Skia's 8-bit premultiplied colour and ${t} blends with its own rounding; ${t} draws rounded double borders in opaque colours only (PNT1b)`;
    const one = (css: string) => inputFor(`body { margin: 0; font-size: 20px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])]);
    for (const [css, span, shown] of [
      ['.a { width: 90px; height: 60px; border: 12px double rgba(192, 57, 43, 0.5); border-radius: 26px; }', '12px double rgba(192, 57, 43, 0.5)', 'rgba(192, 57, 43, 0.5)'],
      ['.a { width: 90px; height: 60px; border: 9px double #2a3b8f; border-color: #2a3b8f80; border-radius: 50%; }', '#2a3b8f80', 'rgba(42, 59, 143, 0.5)'],
      ['.a { width: 60px; height: 40px; border: 1px double rgba(0, 0, 0, 0.99); border-radius: 4px 20px; }', '1px double rgba(0, 0, 0, 0.99)', 'rgba(0, 0, 0, 0.99)'],
      ['.a { width: 60px; height: 40px; color: rgba(0, 0, 255, 0.3); border: 6px double; border-radius: 10px; }', 'rgba(0, 0, 255, 0.3)', 'rgba(0, 0, 255, 0.3)'],
    ] as const) {
      const input = one(css);
      const c = project(input);
      const refused = translucent(c);
      expect(refused.map((d) => [d.code, d.target, d.message]).sort(), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android', message(shown, 'android')], ['DRAGON_UNSUPPORTED_VALUE', 'ios', message(shown, 'ios')]]);
      for (const d of refused) expect(spanTextOf(input, d), css).toBe(span);
      expect(c.diagnostics.filter((d) => d.severity === 'error'), css).toEqual(refused);
      expectCatalogued(refused);
      expect(project(input, { web: {} }).diagnostics.filter((d) => d.severity === 'error'), `${css} on web`).toEqual([]);
      // The parity lanes compile it on native, as a lane-only case.
      const lanes = project(input, both, true);
      expect(translucent(lanes), css).toEqual([]);
      expect([laneOnlyNative(lanes, 'ios'), laneOnlyNative(lanes, 'android')], css).toEqual([true, true]);
    }
    const targetsOf = (input: FrontEndResult) => translucent(project(input)).map((d) => d.target).sort();
    // A reachable state that makes the colour translucent, or rounds a translucent double border.
    const box = '.a { width: 60px; height: 40px; border: 6px double blue; border-radius: 10px; }';
    expect(targetsOf(stated(`body { margin: 0; } ${box} .a.on { border-color: rgba(0, 0, 255, 0.5); }`))).toEqual(['android', 'ios']);
    expect(targetsOf(stated('body { margin: 0; } .a { width: 60px; height: 40px; border: 6px double rgba(0, 0, 255, 0.5); } .a.on { border-radius: 10px; }'))).toEqual(['android', 'ios']);
    // MQ-R1: native switches @media bands at run time, so a band that is not the fold band's is refused too, and lane-only in the lanes.
    for (const media of ['(min-width: 600px)', '(max-width: 599px)']) {
      const banded = one(`${box} @media ${media} { .a { border-color: rgba(0, 0, 255, 0.5); } }`);
      expect(targetsOf(banded), media).toEqual(['android', 'ios']);
      const lanes = project(banded, both, true);
      expect([laneOnlyNative(lanes, 'ios'), laneOnlyNative(lanes, 'android')], media).toEqual([true, true]);
    }
    // Not refused: opaque and transparent rounded double borders, a translucent square double border, a translucent rounded solid
    // border, and a hidden box; an opaque one stays a native proof in the lanes.
    for (const css of [box, '.a { width: 60px; height: 40px; border: 6px double transparent; border-radius: 10px; }', '.a { width: 60px; height: 40px; border: 6px double rgba(0, 0, 255, 0.5); }', '.a { width: 60px; height: 40px; border: 6px solid rgba(0, 0, 255, 0.5); border-radius: 10px; }', '.a { width: 60px; height: 40px; visibility: hidden; border: 6px double rgba(0, 0, 255, 0.5); border-radius: 10px; }']) {
      expect(project(one(css)).diagnostics.filter((d) => d.severity === 'error'), css).toEqual([]);
    }
    const opaque = project(one(box), both, true);
    expect([laneOnlyNative(opaque, 'ios'), laneOnlyNative(opaque, 'android')]).toEqual([false, false]);
  });

  it('an animation or transition of color through translucent values on a currentcolor rounded double border is refused for ios and android; web compiles', () => {
    const both: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
    const run = (input: FrontEndResult, t: Targets = both) => createProjectWith({ projectId: 'test', targets: t }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
    const refused = (input: FrontEndResult, t: Targets = both) => run(input, t).diagnostics.filter((d) => d.severity === 'error' && d.message.includes('the color passes through translucent values'));
    const one = (css: string) => inputFor(`body { margin: 0; } ${css}`, (r) => [div(r, 'a', ['a'])]);
    const box = '.a { width: 60px; height: 40px; color: blue; border: 6px double; border-radius: 10px; }';
    const message = (what: string, t: string) => `${what} of color on a: a rounded double border on a paints in currentcolor, and the color passes through translucent values, which ${t} blends with its own rounding, unlike Chrome's Skia; ${t} draws dotted, dashed and 3D outlines and rounded double borders in opaque colours only (PNT1)`;
    const keyframed = one(`${box} .a { animation: f 1s forwards; } @keyframes f { to { color: rgba(0, 0, 255, 0.5); } }`);
    const ds = refused(keyframed);
    expect(ds.map((d) => [d.code, d.target, d.message]).sort()).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android', message('an animation', 'android')], ['DRAGON_UNSUPPORTED_VALUE', 'ios', message('an animation', 'ios')]]);
    for (const d of ds) expect(spanTextOf(keyframed, d)).toBe('f 1s forwards');
    expectCatalogued(ds);
    expect(refused(keyframed, { web: {} })).toEqual([]);
    const targetsOf = (input: FrontEndResult) => refused(input).map((d) => d.target).sort();
    // A keyframe to transparent passes through translucent colours; a parent's animated color reaches an inheriting child.
    expect(targetsOf(one(`${box} .a { animation: f 1s; } @keyframes f { 50% { color: transparent; } }`))).toEqual(['android', 'ios']);
    const inherited = inputFor('body { margin: 0; } .p { color: blue; animation: f 1s; } .a { width: 60px; height: 40px; border: 6px double; border-radius: 10px; } @keyframes f { to { color: rgba(0, 0, 255, 0.5); } }', (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'])])]);
    expect(refused(inherited).map((d) => d.message.split(':')[0]).sort()).toEqual(['an animation of color on p', 'an animation of color on p']);
    // A transition from an opaque state to a transparent one, in a reachable state.
    expect(targetsOf(stated(`body { margin: 0; } ${box} .a { transition: color 1s; } .a.on { color: transparent; }`))).toEqual(['android', 'ios']);
    // MQ-R1: an animation only in a band that is not the fold band's.
    for (const media of ['(min-width: 600px)', '(max-width: 599px)']) {
      expect(targetsOf(one(`${box} @media ${media} { .a { animation: f 1s; } } @keyframes f { to { color: rgba(0, 0, 255, 0.5); } }`)), media).toEqual(['android', 'ios']);
    }
    // Not refused: opaque keyframes and transitions, a border with its own colour, a square double border.
    for (const input of [
      one(`${box} .a { animation: f 1s; } @keyframes f { to { color: red; } }`),
      stated(`body { margin: 0; } ${box} .a { transition: color 1s; } .a.on { color: red; }`),
      one('.a { width: 60px; height: 40px; color: blue; border: 6px double green; border-radius: 10px; animation: f 1s; } @keyframes f { to { color: rgba(0, 0, 255, 0.5); } }'),
      one('.a { width: 60px; height: 40px; color: blue; border: 6px double; animation: f 1s; } @keyframes f { to { color: rgba(0, 0, 255, 0.5); } }'),
    ]) expect(run(input).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('any other rounded double border is refused for ios and android at the radius declaration, and not for web', () => {
    const cases = [
      ['one double side', '.a { border: 6px solid blue; border-top-style: double; border-radius: 6px; }'],
      ['a zero-width side', '.a { border: 6px double blue; border-left-width: 0; border-radius: 6px; }'],
      ['a hidden side', '.a { border: 6px double blue; border-bottom-style: none; border-radius: 6px; }'],
      ['two widths', '.a { border: 6px double blue; border-right-width: 9px; border-radius: 6px; }'],
      ['two colours', '.a { border: 6px double blue; border-top-color: red; border-radius: 6px; }'],
    ] as const;
    for (const [name, css] of cases) {
      const { c, input } = compile(css, { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} });
      const refused = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(refused.map((d) => d.target).sort(), name).toEqual(['android', 'ios']);
      for (const d of refused) {
        expect(spanTextOf(input, d), name).toBe('6px');
        expect(d.message, name).toBe(`a rounds its corners and has a double border side, but not four double sides of one width and colour; rounded double borders are drawn only as four such sides, which ${d.target} draws as Blink's two rings (other rounded double borders are PNT1b)`);
      }
      expectCatalogued(refused);
    }
  });

  it('an animation or transition of a border side colour on a rounded double border is refused for ios and android, per side or shorthand', () => {
    // The native animator feeds each side's colour apart (dragonAnimatedSides), and the two rings are one colour (dragonDrawRoundedDouble).
    const run = (css: string, targets: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }) => {
      const input = stated(`body { margin: 0; } ${css}`);
      const c = createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
      return { input, c, refused: c.diagnostics.filter((d) => d.message.includes('the native animator changes each side')) };
    };
    const summary = (ds: readonly Diagnostic[]): string[] => ds.map((d) => `${d.target} ${d.message.split(':')[0]}`).sort();
    const box = '.a { width: 40px; height: 30px; border: 6px double blue; border-radius: 10px; }';
    const sides = (what: string, ps: readonly string[]): string[] => ps.flatMap((p) => [`android ${what} of ${p} on a`, `ios ${what} of ${p} on a`]).sort();
    const all = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];
    const cases: [string, string, string, string[]][] = [
      ['a transition of one side', `${box} .a { transition: border-top-color 1s; } .a.on { border-color: red; }`, 'border-top-color 1s', sides('a transition', ['border-top-color'])],
      ['a transition of the shorthand', `${box} .a { transition: border-color 1s; } .a.on { border-color: red; }`, 'border-color 1s', sides('a transition', all)],
      ['a transition of all', `${box} .a { transition: all 1s; } .a.on { border-left-color: red; border-top-color: red; border-right-color: red; border-bottom-color: red; }`, 'all 1s', sides('a transition', all)],
      ['@keyframes of one side', `${box} .a { animation: k 1s infinite; } @keyframes k { to { border-top-color: red; } }`, 'k 1s infinite', sides('an animation', ['border-top-color'])],
      ['@keyframes of the shorthand', `${box} .a { animation: k 1s infinite; } @keyframes k { to { border-color: red; } }`, 'k 1s infinite', sides('an animation', all)],
    ];
    for (const [name, css, span, expected] of cases) {
      const { input, refused } = run(css);
      expect(summary(refused), name).toEqual(expected);
      for (const d of refused) {
        expect(d.code, name).toBe('DRAGON_UNSUPPORTED_VALUE');
        expect(spanTextOf(input, d), name).toBe(span);
      }
      expectCatalogued(refused);
      expect(run(css, { web: {} }).refused, `${name} on web`).toEqual([]);
    }
    // MQ-R1: native switches @media bands at run time, so a box rounded only in a band that is not the fold band's is refused too.
    for (const media of ['(min-width: 600px)', '(max-width: 599px)']) {
      const css = `.a { width: 40px; height: 30px; border: 6px double blue; animation: k 1s infinite; } @media ${media} { .a { border-radius: 10px; } } @keyframes k { to { border-top-color: red; } }`;
      expect(summary(run(css).refused), media).toEqual(sides('an animation', ['border-top-color']));
    }
    expect(run(`${box} .a { transition: border-top-color 1s; } .a.on { border-color: red; }`).refused[0]?.message).toBe("a transition of border-top-color on a: the box is a rounded double border, which ios draws as Blink's two rings only while its four sides are one colour, and the native animator changes each side's colour apart (animated rounded double borders are PNT1b)");
    // Not refused: a rounded solid border, a square double border, a transition no state starts, and color under four currentcolor sides
    // (the four sides stay one colour).
    expect(run('.a { width: 40px; height: 30px; border: 6px solid blue; border-radius: 10px; transition: border-top-color 1s; } .a.on { border-color: red; }').refused).toEqual([]);
    expect(run('.a { width: 40px; height: 30px; border: 6px double blue; transition: border-top-color 1s; } .a.on { border-color: red; }').refused).toEqual([]);
    expect(run(`${box} .a { transition: border-top-color 1s; } .a.on { width: 30px; }`).refused).toEqual([]);
    expect(run('.a { width: 40px; height: 30px; color: blue; border: 6px double; border-radius: 10px; animation: k 1s infinite; } @keyframes k { to { color: red; } }').c.diagnostics).toEqual([]);
  });

  it('a rounded html, body or iframe, and a rounded img with padding or another overflow, are refused for ios and android at the radius declaration, and not for web', () => {
    const targets: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
    const cases = [
      ['html', 'img', 'html { border-radius: 8px; }', 'propagates to the canvas'],
      ['body', 'img', 'body { border-radius: 8px; }', 'propagates to the canvas'],
      ['iframe', 'iframe', '.i { width: 20px; height: 20px; border-radius: 8px; }', 'draws a web view square (a rounded iframe is not supported yet)'],
      ['img padding', 'img', '.i { width: 20px; height: 20px; padding: 0 0 2px; border-radius: 8px; }', 'has padding-bottom: 2px; ios clips a rounded image only at its padding edge'],
      ['img padding %', 'img', '.i { width: 20px; height: 20px; padding-left: 1%; border-radius: 8px; }', 'has padding-left: 1%;'],
      ['img overflow visible', 'img', '.i { width: 20px; height: 20px; overflow: visible; border-radius: 8px; }', 'rounds its corners with overflow: visible, under which Chrome does not clip the image round; ios supports a rounded img only under overflow: clip (the img default) or hidden on both axes'],
      ['img overflow-y visible', 'img', '.i { width: 20px; height: 20px; overflow-y: visible; border-radius: 8px; }', 'rounds its corners with overflow: visible, under which Chrome does not clip the image round'],
      ['img overflow scroll', 'img', '.i { width: 20px; height: 20px; overflow: scroll; border-radius: 8px; }', 'rounds its corners with overflow: scroll, which Dragon has not proven on a rounded img against Chrome yet'],
      ['img overflow-x visible, y hidden', 'img', '.i { width: 20px; height: 20px; overflow-x: visible; overflow-y: hidden; border-radius: 8px; }', 'rounds its corners with overflow: auto, which Dragon has not proven on a rounded img against Chrome yet'],
    ] as const;
    for (const [name, tag, css, says] of cases) {
      const input = inputFor(`body { margin: 0; } ${css}`, (r) => [{ ...div(r, 'i', ['i']), tag, attributes: [] } as never]);
      const c = createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
      const refused = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes('rounds its corners'));
      expect(refused.map((d) => d.target).sort(), name).toEqual(['android', 'ios']);
      for (const d of refused) {
        expect(spanTextOf(input, d), name).toBe('8px');
        expect(d.message, name).toContain(says.replace('ios', d.target ?? ''));
      }
      expectCatalogued(refused);
    }
  });

  it('a rounded img with no padding under its default overflow: clip, or under hidden, compiles on every target, with and without a border', () => {
    const targets: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
    // Chrome clips an img under hidden as under clip (LayoutObject::IsScrollContainer is false for a replaced element); overflow-y:
    // hidden alone computes overflow-x: clip to hidden (StyleAdjuster::AdjustOverflow).
    for (const css of ['.i { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }', '.i { width: 20px; height: 12px; border: 2px solid red; border-radius: 4px 8px 0 6px / 2px 6px 0 9px; object-fit: contain; }', '.i { width: 20px; height: 20px; padding: 0; overflow: clip; border-radius: 3px; }', '.i { width: 20px; height: 20px; overflow: hidden; border: 3px solid red; border-radius: 50%; }', '.i { width: 20px; height: 20px; overflow-y: hidden; border-radius: 4px; }']) {
      const input = inputFor(`body { margin: 0; } ${css}`, (r) => [{ ...div(r, 'i', ['i']), tag: 'img', attributes: [] } as never]);
      const c = createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
      expect(c.diagnostics.filter((d) => d.message.includes('rounds its corners')), css).toEqual([]);
    }
  });

  it('in one walk, a rounded dashed scroll container keeps its PNT1b refusal and its child keeps the OVFL-p refusal (#194 merge)', () => {
    const { c, input } = compile('.a { width: 40px; height: 20px; overflow: hidden; border: 2px dashed blue; border-radius: 6px; } .b { position: relative; top: 10%; }', { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} });
    const pnt1b = c.diagnostics.filter((d) => d.message.includes('PNT1b'));
    expect(pnt1b.map((d) => `${d.code} ${d.target} ${spanTextOf(input, d)}`).sort()).toEqual(['DRAGON_UNSUPPORTED_VALUE android 6px', 'DRAGON_UNSUPPORTED_VALUE ios 6px']);
    const ovflP = c.diagnostics.filter((d) => d.message.includes('OVFL-p'));
    expect(ovflP.map((d) => `${d.code} ${d.target}: ${d.message}`).sort()).toEqual(['android', 'ios', 'web'].map((t) => `DRAGON_UNPROVEN_CONTEXT ${t}: position: relative with a percentage top on b inside the scroll container a: the scrollable overflow does not decide its basis yet (OVFL-p)`));
    expectCatalogued([...pnt1b, ...ovflP]);
  });

  it('square corners with a dashed border, a zero-width dashed side and a solid rounded border are not refused', () => {
    for (const css of ['.a { border: 2px dashed blue; }', '.a { border: 2px solid blue; border-left: 0 dashed red; border-radius: 6px; }', '.a { border: 2px solid blue; border-radius: 6px 0 / 0 6px; border-style: dashed; }']) {
      const { c } = compile(css);
      expect(c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE'), css).toEqual([]);
    }
  });
});

describe('border-radius: lowering and emission', () => {
  const programs = (css: string) => {
    const { c } = compile(css, { ios: { minimum: '15.0' }, android: { minSdk: 31 } });
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };

  it('a box with a rounded corner gets one border-radius write of eight components and radius facts; square boxes get none', () => {
    const p = programs('.a { width: 100px; height: 50px; border-radius: 10px 50% / 1rem 2px; } .b { border-radius: 0 10px / 10px 0; }');
    const a = p.uikit.nodes.find((n) => n.id === 'a');
    const lengths = [
      { percent: false, value: 10 }, { percent: true, value: 50 }, { percent: false, value: 10 }, { percent: true, value: 50 },
      { percent: false, value: 16 }, { percent: false, value: 2 }, { percent: false, value: 16 }, { percent: false, value: 2 },
    ];
    expect(a?.writes.filter((w) => w.kind === 'border-radius')).toEqual([expect.objectContaining({ kind: 'border-radius', key: 'dragonRadius.radiiPx', technique: 'dragon-owned-paint', lengths })]);
    // PNT1 stacking publishes its facts on every box too (rt-hit reads them); the radius facts are a's own.
    expect(Object.keys(a?.facts ?? {}).sort()).toEqual(['radius', 'stacking']);
    expect(a?.facts['radius']).toEqual({ lengths });
    const b = p['android-views'].nodes.find((n) => n.id === 'b');
    expect(b?.writes.some((w) => w.kind === 'border-radius')).toBe(false);
    expect(Object.keys(b?.facts ?? {})).toEqual(['stacking']);
  });

  it('emits the runtime writer on both backends and expects the clamped outer radii in device px', () => {
    const p = programs('.a { width: 100px; height: 40px; border-radius: 60px; }');
    const a = p.uikit.nodes.find((n) => n.id === 'a');
    const w = a?.writes.find((x) => x.kind === 'border-radius');
    if (w === undefined || w.kind !== 'border-radius') throw new Error('no radius write');
    expect(RADIUS_EMITTER.lines.uikit('v0', a as never, w)).toEqual(['  dragonSetRadii(v0, [RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0)])']);
    expect(RADIUS_EMITTER.lines['android-views']('v0', a as never, w)[0]).toMatch(/^ {2}dragonSetRadii\(v0, arrayOf\(RadiusLength\(false, 60\.0\)/);
    const box = { left: 0, top: 0, right: 200, bottom: 80, width: 200, height: 80 } as never;
    const applied = RADIUS_EMITTER.applied({ paint: { roundedShape } } as never, 'uikit', w, 2, { border: [0, 0, 0, 0], box, size: [200, 80], fontSize: null, replaced: null, scroll: null });
    // 120 + 120 device px over an 80 px side: the §5.5 factor 80 / 240 scales every radius to 40.
    expect(applied).toEqual([40, 40, 40, 40, 40, 40, 40, 40]);
  });

  it('both image stages clip the bitmap to the padding-edge curve of a rounded img (the roundedPath hook)', () => {
    const swift = IMAGE_EMITTER.native.uikit.file ?? '';
    const stage = swift.slice(swift.indexOf('public func dragonPaintImageStage('));
    const clip = stage.indexOf('  if let curve = dragonRoundedPath(v, shape, inner: true) {\n    ctx.addPath(curve)\n    ctx.clip()\n  }\n');
    expect(clip).toBeGreaterThan(stage.indexOf('ctx.clip(to: CGRect('));
    expect(clip).toBeLessThan(stage.indexOf('.draw(in: CGRect('));
    const kotlin = IMAGE_EMITTER.native['android-views'].file ?? '';
    const at = kotlin.indexOf('fun dragonPaintImageStage(');
    const k = kotlin.slice(at, kotlin.indexOf('\n}\n', at));
    expect(k).toContain('val curve = dragonRoundedPath(v, shape, true)');
    // Each draw (direct and through the layer's recording) clips to the curve between the rect clip and the bitmap.
    expect(k.match(/clipRect\([^\n]+\)\n {4}if \(curve != null\) (canvas|inner)\.clipPath\(curve\)\n {4}\1\.drawBitmap\(image, null, dest, paint\)/g)?.length).toBe(2);
  });

  it('both border stages draw four double sides as the two rings of borderDoubleRings, and a double side under 3 device px as solid', () => {
    for (const backend of ['uikit', 'android-views'] as const) {
      const file = BORDER_EMITTER.native[backend].file ?? '';
      const stage = file.slice(file.indexOf(backend === 'uikit' ? 'public func dragonPaintBorderStage(' : 'fun dragonPaintBorderStage('));
      // The double rings come first; every other rounded border reaches the ring painter with its effective styles.
      const double = stage.indexOf(backend === 'uikit' ? 'if dragonDrawRoundedDouble(v, ctx, shape, Array(r[0..<8])) { return }' : 'if (dragonDrawRoundedDouble(v, canvas, shape, r.copyOfRange(0, 8))) return');
      expect(double, backend).toBeGreaterThan(0);
      expect(stage.indexOf('dragonEffectiveBorderStyle(v.dragonBorderStyles['), backend).toBeGreaterThan(double);
      expect(stage.indexOf('dragonDrawRoundedBorders('), backend).toBeGreaterThan(stage.indexOf('dragonEffectiveBorderStyle(v.dragonBorderStyles['));
      const fn = file.slice(file.indexOf(backend === 'uikit' ? 'public func dragonDrawRoundedDouble(' : 'fun dragonDrawRoundedDouble('));
      expect(fn, backend).toContain('paintRadius_borderDoubleRings(e[0], e[1], e[2], e[3], JsArray(shape.borders');
      // Ring one is the border box less the outer stripe rect, ring two the inner stripe rect less the padding edge (24 values each).
      expect(fn, backend).toMatch(/\[\[0, 8, 4, 16\], \[24, 32, 28, 40\]\]|arrayOf\(intArrayOf\(0, 8, 4, 16\), intArrayOf\(24, 32, 28, 40\)\)/);
      expect(fn, backend).toContain('a rounded double border that is not four double sides in one colour is PNT1b');
    }
    expect(BORDER_EMITTER.native.uikit.file).toContain('return style == "double" && devicePx < 3 ? "solid" : style');
    expect(BORDER_EMITTER.native['android-views'].file).toContain('if (style == "double" && devicePx < 3.0) "solid" else style');
  });

  it('the double-solid plant swaps exactly its one flag line on each backend, which then fills the border box to the padding edge', () => {
    const plant = BORDER_EMITTER.plants.find((p) => p.name === 'double-solid');
    if (plant === undefined) throw new Error('no double-solid plant');
    for (const backend of ['uikit', 'android-views'] as const) {
      const file = BORDER_EMITTER.native[backend].file ?? '';
      const [from, to] = plant.replace[backend];
      expect(file.split(from).length - 1, backend).toBe(1);
      expect(file, backend).not.toContain(to);
    }
    expect(BORDER_EMITTER.native.uikit.file).toContain('let fills = dragonDoublePlantSolid ? [[0, 8, 28, 40]] :');
    expect(BORDER_EMITTER.native['android-views'].file).toContain('val fills = if (DRAGON_DOUBLE_PLANT_SOLID) arrayOf(intArrayOf(0, 8, 28, 40)) else');
  });

  it('on Android API 31 and 32 an img\'s empty clip view gets no hardware layer or DST_OUT mask, and loses one an earlier layout gave it', () => {
    const kotlin = RADIUS_EMITTER.native['android-views'].file ?? '';
    const at = kotlin.indexOf('fun dragonAfterLayoutRadius(');
    const hook = kotlin.slice(at, kotlin.indexOf('\n}\n', at));
    // The img case takes the branch that clears the layer and the overlay, before either is made.
    const skip = hook.indexOf('if (inner == null || (Build.VERSION.SDK_INT < 33 && dragonHostsNoChildren(v, c))) {');
    expect(skip).toBeGreaterThan(0);
    const cleared = hook.slice(skip, hook.indexOf('    return\n', skip));
    expect(cleared).toContain('c.overlay.clear()');
    expect(cleared).toContain('c.setLayerType(View.LAYER_TYPE_NONE, null)');
    expect(hook.indexOf('c.setLayerType(View.LAYER_TYPE_HARDWARE, null)')).toBeGreaterThan(skip);
    // Only a box that draws an image counts, and an img clip view that somehow hosts children fails loudly instead of going unmasked.
    const helper = kotlin.slice(kotlin.indexOf('fun dragonHostsNoChildren('), kotlin.indexOf('\n}\n', kotlin.indexOf('fun dragonHostsNoChildren(')));
    expect(helper).toContain('if (v.dragonImage == null) return false');
    expect(helper).toContain('if (c.childCount != 0) throw IllegalStateException(');
    // API 33 and up keeps the outline clip for every box, and UIKit is unchanged.
    expect(hook).toContain('if (Build.VERSION.SDK_INT >= 33) {');
    expect(RADIUS_EMITTER.native.uikit.file).not.toContain('dragonHostsNoChildren');
  });
});
