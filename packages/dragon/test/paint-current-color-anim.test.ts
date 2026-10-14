// PNT1: an animation or transition of color that reaches a currentcolor outline or box-shadow is refused on ios and android, whose
// lowerings resolve currentcolor once and whose animator repaints only color and currentcolor border sides per frame.
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
  return { input, c, refused: c.diagnostics.filter((d) => d.message.includes('the native animator does not repaint outlines or box shadows')) };
}

const summary = (ds: readonly Diagnostic[]): string[] => ds.map((d) => `${d.target} ${d.message.split(' paints in')[0]}`).sort();
const both = (line: string): string[] => [`android ${line}`, `ios ${line}`];

describe('an animated color under a currentcolor outline or box-shadow (PNT1)', () => {
  it('is refused for ios and android at the animation-name or transition-property, in every state, for the element or a descendant that inherits color', () => {
    const anim = 'animation: k 1s infinite; } @keyframes k { to { color: red; } }';
    const cases: [string, string, string, string[]][] = [
      ['outline, explicit currentcolor', `.a { color: blue; outline: 4px solid currentcolor; ${anim}`, 'k 1s infinite', both('an animation of color on a: a solid outline on a')],
      ['outline, the outline-color default', `.a { color: blue; outline: 4px solid; ${anim}`, 'k 1s infinite', both('an animation of color on a: a solid outline on a')],
      ['dotted outline', `.a { color: blue; outline: 2px dotted; ${anim}`, 'k 1s infinite', both('an animation of color on a: a dotted outline on a')],
      ['outline, opaque transition', '.a { color: blue; outline: 4px solid; transition: color 1s; } .a.on { color: red; }', 'color 1s', both('a transition of color on a: a solid outline on a')],
      ['outline, transition of all', '.a { color: blue; outline: 4px double; transition: all 1s; } .a.on { color: red; }', 'all 1s', both('a transition of color on a: a double outline on a')],
      ['outline on a descendant inheriting an animated color', `.b { outline: 2px solid; } .a { color: blue; ${anim}`, 'k 1s infinite', both('an animation of color on a: a solid outline on b')],
      ['outline on a descendant inheriting a transitioned color', '.b { outline: 2px solid; } .a { color: blue; transition: color 1s; } .a.on { color: red; }', 'color 1s', both('a transition of color on a: a solid outline on b')],
      ['outline only in the open state', '.a { color: blue; transition: color 1s; } .a.on { color: red; outline: 3px solid; }', 'color 1s', both('a transition of color on a: a solid outline on a')],
      ['box-shadow, explicit currentcolor', `.a { color: blue; box-shadow: 2px 2px 0 currentcolor; ${anim}`, 'k 1s infinite', both('an animation of color on a: a box-shadow on a')],
      ['box-shadow, no colour', `.a { color: blue; box-shadow: 2px 2px 0 red, 4px 4px 0; ${anim}`, 'k 1s infinite', both('an animation of color on a: a box-shadow on a')],
      ['box-shadow on a descendant', '.b { box-shadow: 2px 2px 0; } .a { color: blue; transition: color 1s; } .a.on { color: red; }', 'color 1s', both('a transition of color on a: a box-shadow on b')],
      ['box-shadow inherited by keyword', `.a { color: blue; box-shadow: 1px 1px 0; } .b { color: green; box-shadow: inherit; ${anim}`, 'k 1s infinite', both('an animation of color on b: a box-shadow on b')],
      ['outline and box-shadow', `.a { color: blue; outline: 1px solid; box-shadow: 1px 1px 0; ${anim}`, 'k 1s infinite', both('an animation of color on a: a solid outline and a box-shadow on a')],
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
    expect(run(`.a { color: blue; outline: 4px solid; ${anim}`).refused.find((d) => d.target === 'ios')?.message).toBe(
      'an animation of color on a: a solid outline on a paints in currentcolor, which ios resolves to the resting color once, and the native animator does not repaint outlines or box shadows per frame, so mid-animation ios would keep the resting colour where Chrome follows color (PNT1)',
    );
  });

  it('is refused in every @media band, since native switches bands at run time', () => {
    for (const media of ['(min-width: 600px)', '(max-width: 599px)']) {
      const css = `.a { color: blue; animation: k 1s infinite; } @media ${media} { .a { outline: 2px solid; } } @keyframes k { to { color: red; } }`;
      expect(summary(run(css).refused), media).toEqual(both('an animation of color on a: a solid outline on a'));
      const t = `.a { color: blue; } @media ${media} { .a { transition: color 1s; box-shadow: 1px 1px 0; } .a.on { color: red; } }`;
      expect(summary(run(t).refused), `${media} transition`).toEqual(both('a transition of color on a: a box-shadow on a'));
    }
  });

  it('is not refused where no frame changes a currentcolor outline or box-shadow', () => {
    const anim = 'animation: k 1s infinite; } @keyframes k { to { color: red; } }';
    for (const css of [
      `.a { color: blue; outline: 4px solid green; box-shadow: 1px 1px 0 green; ${anim}`, // their own colours
      `.a { color: blue; border: 4px solid; ${anim}`, // currentcolor border sides are in the animator's closure
      `.a { color: blue; outline: 4px none; ${anim}`,
      `.a { color: blue; outline: 0 solid; ${anim}`,
      `.a { color: blue; visibility: hidden; outline: 2px solid; box-shadow: 1px 1px 0; ${anim}`,
      `.b { color: green; outline: 2px solid; } .a { color: blue; ${anim}`, // .b sets its own color
      `.b { display: none; outline: 2px solid; } .a { color: blue; ${anim}`,
      '.a { color: blue; outline: 2px solid; transition: color 1s; } .a.on { width: 30px; }', // no state changes color
      '.a { color: blue; outline: 2px solid; transition: color 0s; } .a.on { color: red; }',
      '.a { color: blue; outline: 2px solid; animation: k 1s infinite; } @keyframes k { to { width: 20px; } }',
    ]) expect(run(css).refused, css).toEqual([]);
  });
});
