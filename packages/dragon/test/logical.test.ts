// css-logical-1 in horizontal-tb: flow-relative properties map to physical longhands by the element's own direction, and share
// the physical longhand's cascade (logical property groups). Chrome parity is proven by fixture-groups/logical-props.ts.
import { describe, expect, it } from 'vitest';
import type { FrontEndResult } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { SHORTHAND_HANDLERS } from '../src/css/shorthands/index.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { LOGICAL_SHORTHANDS } from '../src/css/properties/logical.ts';
import type { Diagnostic } from '../src/types.ts';
import { div, explainOne, inputFor, spanTextOf } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const project = (direction: 'ltr' | 'rtl' = 'ltr') =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction });
const value = (input: FrontEndResult, node: string, property: string, direction: 'ltr' | 'rtl' = 'ltr'): string => explainOne(project(direction).compile(input), 'web', node, property).value;
const SRC = { uri: 's.css', revision: 'r', hash: 'h' };

function declaration(css: string): Declaration {
  const diagnostics: Diagnostic[] = [];
  const text = `.a { ${css} }`;
  const rules = parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics);
  expect(diagnostics).toEqual([]);
  return rules[0]?.declarations[0] as Declaration;
}
const longhands = (css: string): string[] => declaration(css).longhands.map((l) => `${l.property}${l.direction === undefined ? '' : `@${l.direction}`}=${'value' in l.value ? String(l.value.value) : ''}${l.explicit ? '' : '?'}`);

describe('css-logical-1: parsing flow-relative properties into direction-tagged physical longhands', () => {
  it('every flow-relative property has a handler, and each handler sets only physical longhands', () => {
    for (const s of LOGICAL_SHORTHANDS) expect(SHORTHAND_HANDLERS[s], s).toBeDefined();
  });
  it('an inline edge maps to left in ltr and right in rtl, inline end the opposite; block edges and sizes are direction-free', () => {
    expect(longhands('margin-inline-start: 1px')).toEqual(['margin-left@ltr=1', 'margin-right@rtl=1']);
    expect(longhands('padding-inline-end: 2px')).toEqual(['padding-right@ltr=2', 'padding-left@rtl=2']);
    expect(longhands('inset-inline: 1px 2px')).toEqual(['left@ltr=1', 'right@rtl=1', 'right@ltr=2', 'left@rtl=2']);
    expect(longhands('margin-block: 3px')).toEqual(['margin-top=3', 'margin-bottom=3']);
    expect(longhands('inset: 1px 2px')).toEqual(['top=1', 'right=2', 'bottom=1', 'left=2']);
    expect(longhands('inline-size: 5px')).toEqual(['width=5']);
    expect(longhands('max-block-size: none')).toEqual(['max-height=none']);
  });
  it('border-inline fills omitted width, style and colour with their initial values on both edges', () => {
    expect(longhands('border-inline: 2px solid')).toEqual([
      'border-left-width@ltr=2', 'border-right-width@rtl=2', 'border-left-style@ltr=solid', 'border-right-style@rtl=solid', 'border-left-color@ltr=currentcolor?', 'border-right-color@rtl=currentcolor?',
      'border-right-width@ltr=2', 'border-left-width@rtl=2', 'border-right-style@ltr=solid', 'border-left-style@rtl=solid', 'border-right-color@ltr=currentcolor?', 'border-left-color@rtl=currentcolor?',
    ]);
  });
  it('a CSS-wide keyword sets only the mapped longhand of each direction', () => {
    expect(longhands('margin-inline-start: inherit')).toEqual(['margin-left@ltr=inherit', 'margin-right@rtl=inherit']);
    expect(longhands('border-block-end: initial')).toEqual(['border-bottom-width=initial', 'border-bottom-style=initial', 'border-bottom-color=initial']);
  });
});

describe('css-logical-1 §4: logical property groups share one cascade', () => {
  const css = `${FONT} .rtl { direction: rtl; } .ltr { direction: ltr; }
    .lp { margin-inline-start: 5px; margin-left: 7px; }
    .pl { margin-left: 7px; margin-inline-start: 5px; }
    .spec.spec { margin-left: 9px; } .spec { margin-inline-start: 4px; }`;
  const tree = inputFor(css, (r) => [
    div(r, 'a', ['lp']), div(r, 'b', ['pl']), div(r, 'c', ['spec']),
    div(r, 'd', ['rtl', 'lp']), div(r, 'e', ['rtl', 'pl']),
    div(r, 'p', ['rtl'], [div(r, 'p1', ['pl']), div(r, 'p2', ['ltr', 'pl'])]),
  ]);
  it('in ltr the later of the logical and physical declarations wins, and specificity still decides first', () => {
    expect([value(tree, 'a', 'margin-left'), value(tree, 'b', 'margin-left'), value(tree, 'c', 'margin-left')]).toEqual(['7px', '5px', '9px']);
  });
  it('in rtl margin-inline-start is margin-right, so margin-left does not compete with it', () => {
    expect([value(tree, 'd', 'margin-left'), value(tree, 'd', 'margin-right')]).toEqual(['7px', '5px']);
    expect([value(tree, 'e', 'margin-left'), value(tree, 'e', 'margin-right')]).toEqual(['7px', '5px']);
  });
  it('the mapping uses the element own direction, inherited or declared', () => {
    expect([value(tree, 'p1', 'margin-left'), value(tree, 'p1', 'margin-right')]).toEqual(['7px', '5px']);
    expect([value(tree, 'p2', 'margin-left'), value(tree, 'p2', 'margin-right')]).toEqual(['5px', '0px']);
  });
  it('the environment direction is the root direction the mapping inherits', () => {
    expect([value(tree, 'b', 'margin-left', 'rtl'), value(tree, 'b', 'margin-right', 'rtl')]).toEqual(['7px', '5px']);
  });
  it('the losing declarations are those of the element direction only', () => {
    const c = project().compile(tree);
    const e = explainOne(c, 'web', 'a', 'margin-left');
    expect(e.losing.map((l) => spanTextOf(tree, { origin: l.origin } as Diagnostic))).toEqual(['margin-inline-start: 5px']);
    expect(explainOne(c, 'web', 'a', 'margin-right').losing).toEqual([]);
  });
});

describe('css-logical-1: out of scope stays refused', () => {
  const refusal = (css: string): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const text = `.a { ${css} }`;
    parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics);
    return diagnostics;
  };
  it('writing-mode and the logical border-radius corners are refused with a fix that removes them', () => {
    for (const css of ['writing-mode: vertical-rl', 'writing-mode: horizontal-tb', 'border-start-start-radius: 4px', 'border-end-start-radius: 4px']) {
      const [d, ...rest] = refusal(css);
      expect(rest).toEqual([]);
      expect(d?.code, css).toBe('DRAGON_UNSUPPORTED_PROPERTY');
      expect(d?.fix, css).toMatchObject({ edits: [{ replacement: '' }] });
    }
  });
});
