// PNT1: an animation or transition of color that reaches a background colour, or a descendant's gradient raster, in currentcolor is
// refused on ios and android, whose lowerings bake currentcolor there and whose animator repaints only color and currentcolor border
// sides per frame (a gradient box's own color is BG2c's refuseAnimatedGradients).
import { describe, expect, it } from 'vitest';
import type { Diagnostic, DraftTree, FrontEndResult } from '../src/index.ts';
import type { Targets } from '../src/types.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { div, DOC, eq, expectCatalogued, inputFor, not, spanTextOf } from './helpers.ts';

/** A box .a holding a box .b, where .a gains class on in the open state, so a transition has a state pair to start it. */
function stated(css: string): FrontEndResult {
  const input = inputFor(css, (r) => {
    const d = div(r, 'a', ['a'], [div(r, 'b', ['b'])]);
    const on = { value: [{ when: eq('open', true), value: { owner: DOC, sheet: 's', name: 'on' } }, { when: not(eq('open', true)), value: null }], origin: d.origin };
    return [{ ...d, classes: [...d.classes, on] }];
  });
  const tree = input.tree as DraftTree;
  const root = tree.components[0] as DraftTree['components'][number];
  return { ...input, tree: { ...tree, components: [{ ...root, states: [{ id: 'open', domain: [false, true], initial: false, origin: root.origin }] }] } };
}

const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function run(css: string, targets: Targets = NATIVE) {
  const input = stated(`body { margin: 0; } .a, .b { width: 40px; height: 30px; } ${css}`);
  const c = createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' }).compile(input);
  return { input, c, refused: c.diagnostics.filter((d) => d.message.includes('paints in currentcolor, which')) };
}

const summary = (ds: readonly Diagnostic[]): string[] => ds.map((d) => `${d.target} ${d.message.split(' paints in')[0]}`).sort();
const both = (line: string): string[] => [`android ${line}`, `ios ${line}`];
const anim = (to: string): string => `animation: k 1s infinite; } @keyframes k { to { color: ${to}; } }`;

describe('an animated color under a currentcolor background colour or gradient raster (PNT1)', () => {
  it('is refused for ios and android at the animation-name or transition-property, for a descendant that inherits color', () => {
    const cases: [string, string, string, string[]][] = [
      ['currentcolor gradient stop', `.b { background-image: linear-gradient(currentcolor, red); } .a { color: blue; ${anim('red')}`, 'k 1s infinite', both('an animation of color on a: a gradient background on b')],
      ['currentcolor stop, transition', '.b { background-image: linear-gradient(red, currentcolor); } .a { color: blue; transition: color 1s; } .a.on { color: red; }', 'color 1s', both('a transition of color on a: a gradient background on b')],
      ['radial gradient, currentcolor stop', `.b { background-image: radial-gradient(currentcolor, red); } .a { color: blue; ${anim('red')}`, 'k 1s infinite', both('an animation of color on a: a gradient background on b')],
      ['gradient over a currentcolor background colour', `.b { background: currentcolor linear-gradient(transparent, red); } .a { color: blue; ${anim('red')}`, 'k 1s infinite', both('an animation of color on a: a gradient background on b')],
      ['gradient only in the open state', '.a { color: blue; transition: color 1s; } .a.on { color: red; } .a.on .b { background-image: linear-gradient(currentcolor, red); }', 'color 1s', both('a transition of color on a: a gradient background on b')],
      ['gradient under a currentcolor border, to translucent', `.b { background-image: linear-gradient(green, red); border: 3px solid; } .a { color: blue; ${anim('rgba(255, 0, 0, 0.5)')}`, 'k 1s infinite', both('an animation of color on a: a gradient background under a currentcolor border on b')],
      ['gradient under a currentcolor border, transition to transparent', '.b { background-image: linear-gradient(green, red); border-left: 3px double; } .a { color: blue; transition: color 1s; } .a.on { color: transparent; }', 'color 1s', both('a transition of color on a: a gradient background under a currentcolor border on b')],
      ['background-color on the element', `.a { color: blue; background-color: currentcolor; ${anim('red')}`, 'k 1s infinite', both('an animation of color on a: a background-color on a')],
      ['background-color on a descendant', '.b { background-color: currentcolor; } .a { color: blue; transition: color 1s; } .a.on { color: red; }', 'color 1s', both('a transition of color on a: a background-color on b')],
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
    expect(run(`.b { background-image: linear-gradient(currentcolor, red); } .a { color: blue; ${anim('red')}`).refused.find((d) => d.target === 'android')?.message).toBe(
      'an animation of color on a: a gradient background on b paints in currentcolor, which android resolves to the resting color once, and the native animator does not repaint a gradient raster per frame, so mid-animation android would keep the resting colour where Chrome follows color (PNT1)',
    );
  });

  it('is refused in every @media band, since native switches bands at run time', () => {
    for (const media of ['(min-width: 600px)', '(max-width: 599px)']) {
      const css = `.a { color: blue; animation: k 1s infinite; } @media ${media} { .b { background-image: linear-gradient(currentcolor, red); } } @keyframes k { to { color: red; } }`;
      expect(summary(run(css).refused), media).toEqual(both('an animation of color on a: a gradient background on b'));
      const t = `.a { color: blue; } @media ${media} { .a { transition: color 1s; } .a.on { color: red; } .b { background-color: currentcolor; } }`;
      expect(summary(run(t).refused), `${media} transition`).toEqual(both('a transition of color on a: a background-color on b'));
    }
  });

  it('is not refused where the animator repaints the paint or no frame changes it', () => {
    for (const css of [
      `.b { border: 3px solid; } .a { color: blue; ${anim('red')}`, // a descendant's currentcolor border sides are in the animator's closure
      `.b { background-image: linear-gradient(green, red); border: 3px solid; } .a { color: blue; ${anim('red')}`, // stays opaque, so the raster's obscuring holds
      `.b { background-image: linear-gradient(green, red); border: 3px solid; } .a { color: rgba(0, 0, 255, 0.5); ${anim('rgba(255, 0, 0, 0.25)')}`,
      `.a.on { display: none; } .b { background-image: linear-gradient(green, red); border: 3px solid; } .a { color: blue; ${anim('red')}`, // a hidden state has no color end
      `.b { background-image: linear-gradient(green, red); border: 3px dashed; } .a { color: blue; ${anim('transparent')}`, // a dashed side never obscures
      `.b { background-image: linear-gradient(green, red); } .a { color: blue; ${anim('red')}`,
      `.b { color: green; background-image: linear-gradient(currentcolor, red); } .a { color: blue; ${anim('red')}`, // .b sets its own color
      `.b { visibility: hidden; background-image: linear-gradient(currentcolor, red); } .a { color: blue; ${anim('red')}`,
      `.b { display: none; background-color: currentcolor; } .a { color: blue; ${anim('red')}`,
      `.b { display: contents; background-color: currentcolor; } .a { color: blue; ${anim('red')}`,
      '.b { background-image: linear-gradient(currentcolor, red); } .a { color: blue; transition: color 1s; } .a.on { width: 30px; }', // no state changes color
      '.b { background-color: currentcolor; } .a { color: blue; transition: color 0s; } .a.on { color: red; }',
    ]) expect(run(css).refused, css).toEqual([]);
  });

  it('leaves a gradient box animating its own color to BG2c', () => {
    const { c, refused } = run(`.a { color: blue; background-image: linear-gradient(currentcolor, red); ${anim('red')}`);
    expect(refused).toEqual([]);
    expect(c.diagnostics.filter((d) => d.message.includes('BG2c')).map((d) => d.target).sort()).toEqual(['android', 'ios']);
  });
});
