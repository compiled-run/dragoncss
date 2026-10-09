// FORM-a A3 (#78 review): Chrome's html.css control rules reset inherited longhands to their defaults on a <button>
// (line-height: normal, color: ButtonText). Under a default parent such a reset equals inheriting, so the UA capture reads every
// element under a parent with non-default inherited values too (scripts/capture-ua-defaults.ts INHERITED_SKEW). A button under an
// ancestor that sets line-height and color resolves Chrome's values, as parity fixture controls-button-inherit compares.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { Longhand } from '../src/css/properties.ts';
import type { ResolvedValue } from '../src/analysis/computed.ts';
import { valueToString } from '../src/analysis/computed.ts';
import type { LinkedElement } from '../src/analysis/link.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { resolveTree } from '../src/analysis/resolve.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { Diagnostic } from '../src/types.ts';
import * as dark from '../src/ua/chrome-145.darwin-arm64.dark.generated.ts';
import * as light from '../src/ua/chrome-145.darwin-arm64.generated.ts';
import { referenceDataset, uaRows } from '../src/ua/datasets.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SRC: SourceRef = { uri: 's.css', revision: 'r', hash: 'h' };
const ORIGIN: Origin = { kind: 'unlocated', reason: 'test' };
// The #78 review's probe: an ancestor with a non-default line-height and colour, and a CSS-painted block button with font: inherit
// sizes (with an author border: the UA outset border is refused, and line-height: inherit has no profile row).
const CSS = 'body { font-family: Ahem; font-size: 10px; line-height: 30px; color: rgb(200, 0, 0); } button { display: block; appearance: none; font-family: inherit; font-size: inherit; background-color: #cdf; border: 2px solid #036; } .again { line-height: 30px; color: rgb(200, 0, 0); }';

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const tree = (r: SourceRef): TreeNode[] => [
  el(r, 'before', 'div', [], [text(r, 't0', 'XX')]),
  el(r, 'b1', 'button', [], [text(r, 't1', 'XX')]),
  el(r, 'b2', 'button', [], [el(r, 'b2-in', 'div', [], [text(r, 't2', 'XX')])]),
  el(r, 'b3', 'button', ['again'], [text(r, 't3', 'XX')]),
];

function resolved(): (id: string, p: Longhand) => { value: string; origin: string } {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(CSS, { source: SRC, start: 0, end: CSS.length }, { id: 'sheet', owner: DOC, scope: 'document' }, 0, diagnostics);
  expect(diagnostics).toEqual([]);
  const linked = (n: TreeNode): LinkedElement | null => n.kind !== 'element' ? null : {
    kind: 'element', address: n.id, instance: DOC, owner: DOC, tag: n.tag, attributes: new Map(), node: n,
    classes: n.classes.map((c) => ({ owner: DOC, sheet: 'sheet', name: (c.value[0] as { value: { name: string } }).value.name })),
    children: n.children.map(linked).filter((c): c is LinkedElement => c !== null),
  };
  const body: LinkedElement = { kind: 'element', address: 'body', instance: DOC, owner: DOC, tag: 'body', classes: [], attributes: new Map(), children: tree(SRC).map(linked).filter((c): c is LinkedElement => c !== null), node: { kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], children: [], origin: ORIGIN } };
  const root = resolveTree({ ...body, address: 'html', tag: 'html', children: [body] }, rules, NO_FAULTS, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  const find = (e: ResolvedElement, id: string): ResolvedElement | null => {
    if (e.element.address === id) return e;
    for (const c of e.children) if (c.kind === 'element') {
      const hit = find(c, id);
      if (hit !== null) return hit;
    }
    return null;
  };
  return (id, p) => {
    const v = (find(root, id) as ResolvedElement).props.get(p) as ResolvedValue;
    return { value: valueToString(v.value), origin: v.origin };
  };
}

describe('inherited longhands Chrome resets on a button', () => {
  it('are captured as declared UA values of the button key in both directions, light and dark', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      expect(light.elementKeyDeclared.button[dir], dir).toMatchObject({ 'line-height': 'normal', color: 'rgb(0, 0, 0)' });
      // ButtonText in the dark scheme is the dark dataset's own captured value, never the light one.
      expect(dark.elementKeyDeclared.button[dir]['line-height'], dir).toBe('normal');
      expect(dark.elementKeyDeclared.button[dir]['color'], dir).toBe(dark.systemColors.ButtonText);
      expect(uaRows(referenceDataset(), 'button').declared[dir], dir).toMatchObject({ 'line-height': 'normal', color: 'rgb(0, 0, 0)' });
    }
    expect(light.systemColors.ButtonText).toBe('rgb(0, 0, 0)');
  });

  it('resolve to Chrome\'s values under an ancestor that sets them, and an author value still wins', () => {
    const get = resolved();
    expect(get('before', 'line-height')).toEqual({ value: '30px', origin: 'inherited' });
    expect(get('before', 'color').value).toBe('rgb(200, 0, 0)');
    expect(get('b1', 'line-height')).toEqual({ value: 'normal', origin: 'user-agent' });
    expect(get('b1', 'color')).toEqual({ value: 'rgb(0, 0, 0)', origin: 'user-agent' });
    // The button's contents inherit the button's reset values.
    expect(get('b2-in', 'line-height')).toEqual({ value: 'normal', origin: 'inherited' });
    expect(get('b2-in', 'color')).toEqual({ value: 'rgb(0, 0, 0)', origin: 'inherited' });
    expect(get('b3', 'line-height')).toEqual({ value: '30px', origin: 'author' });
    expect(get('b3', 'color')).toEqual({ value: 'rgb(200, 0, 0)', origin: 'author' });
  });

  it('the probe compiles on every target, so its web body writes the reset values', () => {
    const c = createProjectWith({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' }).compile(inputFor(CSS, tree));
    expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${String(d.target)} ${d.message}`)).toEqual([]);
    expect(c.targets).toEqual({ web: 'checked', ios: 'checked', android: 'checked' });
  });
});
