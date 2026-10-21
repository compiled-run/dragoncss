// FONT-UNITS: ex, ch and cap (css-values-4 §6.1.1) in an element's own sizes, margins, padding, insets, flex-basis and gaps lower to
// the engine's font-metric leaf of the element's primary font, which the engine measures at the device's zoom; every other
// context keeps its typed refusal: an inherited or painted length, a calculation, the root-relative and ideographic units, a
// length a child takes with inherit, a keyframe or transition endpoint, and natively a real face or a font size that follows the
// viewport. The Chrome cases are font-units-ahem and the reject-font-units-* cases of fixture-groups/font-units.ts.
import { describe, expect, it } from 'vitest';
import type { LayoutBox, LayoutStyle } from '@dragon/layout';
import type { DraftTree, ElementNode, FrontEndResult, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { FONT_METRIC_LAYOUT_LONGHANDS, FONT_METRIC_LAYOUT_UNITS, unitRefusal, unitRefusalIn } from '../src/css/units.ts';
import { INHERITED } from '../src/css/properties.ts';
import { DOC, eq, inputFor, not, staticClass, text } from './helpers.ts';

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
type Body = Parameters<typeof inputFor>[1];
const nested: Body = (r) => [el(r, 'a', 'div', ['a'], [el(r, 'b', 'div', ['b'], [text(r, 't', 'XX')])])];
const compile = (css: string, body: Body = nested, faults: CompilerFaults = NO_FAULTS) => project(faults).compile(inputFor(`${FONT} ${css}`, body));
type Compiled = ReturnType<typeof compile>;
const errors = (c: Compiled): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${d.message}`);
const codes = (c: Compiled): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();

function box(c: Compiled, id: string): LayoutBox {
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const find = (b: LayoutBox): LayoutBox | undefined => (b.id === id ? b : b.children.flatMap((k) => (k.kind === 'box' ? [find(k)] : [])).find((x) => x !== undefined));
  const hit = find(p.input.root);
  if (hit === undefined) throw new Error(`no box ${id}`);
  return hit;
}

const ahem = (size: number) => ({ family: 'Ahem', size, specifiedSize: { kind: 'px', value: size }, absoluteSize: true });
const leaf = (value: number, metric: 'ex' | 'ch' | 'cap', size: number, range: 'non-negative' | 'all') => ({ kind: 'calc', expr: { kind: 'font-metric', value, metric, font: ahem(size) }, range });

describe('the font-metric units in the unit registry', () => {
  it('admits ex, ch and cap in the non-inherited layout longhands and the shorthands of them alone, and refuses them elsewhere', () => {
    for (const u of FONT_METRIC_LAYOUT_UNITS) {
      // The generic refusal stays, so a paint or text parser that asks for px keeps refusing them.
      expect(unitRefusal(u), u).not.toBeNull();
      for (const p of FONT_METRIC_LAYOUT_LONGHANDS) {
        expect(INHERITED.has(p as never), p).toBe(false);
        expect(unitRefusalIn(u, [p]), `${p} ${u}`).toBeNull();
      }
      expect(unitRefusalIn(u, ['flex-grow', 'flex-shrink', 'flex-basis']), `flex ${u}`).toBeNull();
      expect(unitRefusalIn(u, ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']), `margin ${u}`).toBeNull();
      for (const p of ['letter-spacing', 'word-spacing', 'text-indent', 'font-size', 'line-height', 'border-top-width', 'outline-offset', 'column-width', 'tab-size', 'vertical-align']) {
        expect(unitRefusalIn(u, [p]), `${p} ${u}`).not.toBeNull();
      }
      // A shorthand that also sets a paint longhand is refused whole.
      expect(unitRefusalIn(u, ['border-top-width', 'border-top-style', 'border-top-color']), `border-top ${u}`).not.toBeNull();
      expect(unitRefusalIn(u, []), `no longhand ${u}`).not.toBeNull();
    }
    for (const u of ['rex', 'rch', 'rcap', 'ic', 'ric', 'lh', 'rlh']) expect(unitRefusalIn(u, ['width']), u).not.toBeNull();
    expect(unitRefusalIn('px', ['letter-spacing'])).toBeNull();
  });
});

describe('ex, ch and cap in layout lengths', () => {
  it('lower to a font-metric leaf of the element\'s own Ahem font in every admitted longhand', () => {
    const c = compile(`.a { font-size: 20px; width: 3ch; min-height: 2ex; max-width: 30CH; margin: -1ch 2ex 0 1cap; padding: 1ex 2ch 3cap 4ex;
      position: relative; top: 1ex; left: -2ch; display: flex; row-gap: 1cap; column-gap: 2ch; } .b { flex: 1 1 4ex; height: 3cap; }`);
    expect(errors(c)).toEqual([]);
    const a = box(c, 'a').style;
    expect([a.width, a.minHeight, a.maxWidth]).toEqual([leaf(3, 'ch', 20, 'non-negative'), leaf(2, 'ex', 20, 'non-negative'), leaf(30, 'ch', 20, 'non-negative')]);
    expect([a.marginTop, a.marginRight, a.marginBottom, a.marginLeft]).toEqual([leaf(-1, 'ch', 20, 'all'), leaf(2, 'ex', 20, 'all'), { kind: 'px', value: 0 }, leaf(1, 'cap', 20, 'all')]);
    expect([a.paddingTop, a.paddingRight, a.paddingBottom, a.paddingLeft]).toEqual([leaf(1, 'ex', 20, 'non-negative'), leaf(2, 'ch', 20, 'non-negative'), leaf(3, 'cap', 20, 'non-negative'), leaf(4, 'ex', 20, 'non-negative')]);
    expect([a.top, a.left]).toEqual([leaf(1, 'ex', 20, 'all'), leaf(-2, 'ch', 20, 'all')]);
    expect([a.rowGap, a.columnGap]).toEqual([leaf(1, 'cap', 20, 'non-negative'), leaf(2, 'ch', 20, 'non-negative')]);
    // b's own font (inherited 20px) is the one its lengths read.
    const b = box(c, 'b').style;
    expect([b.flexBasis, b.height]).toEqual([leaf(4, 'ex', 20, 'non-negative'), leaf(3, 'cap', 20, 'non-negative')]);
  });

  it('read each element\'s own font, through var() too, and on an inline box and an atomic inline', () => {
    const c = compile('.a { --w: 2ch; width: var(--w); } .b { font-size: 13px; width: var(--w); }');
    expect(errors(c)).toEqual([]);
    expect(box(c, 'a').style.width).toEqual(leaf(2, 'ch', 10, 'non-negative'));
    expect(box(c, 'b').style.width).toEqual(leaf(2, 'ch', 13, 'non-negative'));
    const inline: Body = (r) => [el(r, 'a', 'div', ['a'], [el(r, 's', 'span', ['s'], [text(r, 't', 'XX')]), el(r, 'i', 'span', ['i'], [text(r, 'u', 'X')])])];
    const ci = compile('.s { padding-left: 1ch; margin-right: 2ex; font-size: 20px; } .i { display: inline-block; width: 3cap; }', inline);
    expect(errors(ci)).toEqual([]);
    const kids = box(ci, 'a').children;
    const s = kids.find((k) => k.id === 's') as { readonly style: LayoutStyle };
    expect([s.style.paddingLeft, s.style.marginRight]).toEqual([leaf(1, 'ch', 20, 'non-negative'), leaf(2, 'ex', 20, 'all')]);
    expect((kids.find((k) => k.id === 'i') as LayoutBox).style.width).toEqual(leaf(3, 'cap', 10, 'non-negative'));
  });

  it('pass through to the web output as written', () => {
    const c = compile('.a { width: 3ch; margin-left: 2ex; padding-top: 1cap; }');
    expect(c.outputs.web.kind).toBe('ready');
    if (c.outputs.web.kind !== 'ready') return;
    const css = (c.outputs.web.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
    for (const v of ['3ch', '2ex', '1cap']) expect(css, v).toContain(v);
  });

  it('the planted fontMetricAsEm lowers them as em of the element\'s font', () => {
    const c = compile('.a { width: 3ex; }', nested, { ...NO_FAULTS, fontMetricAsEm: true });
    expect(box(c, 'a').style.width).toEqual({ kind: 'calc', expr: { kind: 'em', value: 3, fontSize: { kind: 'px', value: 10 } }, range: 'non-negative' });
  });
});

describe('the contexts that stay refused', () => {
  it('refuses an inherited, painted or text length, a root-relative or ideographic unit, and a calculation, as before', () => {
    for (const d of ['letter-spacing: 1ch', 'word-spacing: 1ex', 'text-indent: 2ch', 'border-left: 1ch solid red', 'outline: 1ex solid red', 'border-radius: 1ch', 'line-height: 2ex', 'font-size: 2ch', 'width: 2rch', 'width: 2rex', 'height: 1ic', 'width: 2lh']) {
      expect(codes(compile(`.a { ${d} }`)), d).toEqual(['null DRAGON_UNSUPPORTED_VALUE']);
    }
    expect(errors(compile('.a { --w: 2ch; text-indent: var(--w) }'))[0]).toContain('text-indent: 2ch is unsupported: Dragon resolves ex, ch and cap from the element\'s own font in its sizes');
    expect(codes(compile('.a { width: calc(1ch + 1px) }'))).toEqual(['android DRAGON_LOWERING_FAILED', 'ios DRAGON_LOWERING_FAILED']);
  });

  it('refuses for every target a length a child takes with a CSS-wide keyword, which Chrome measures against the parent\'s font', () => {
    for (const k of ['inherit', 'INHERIT']) {
      const c = compile(`.a { width: 3ch } .b { width: ${k}; font-size: 20px }`);
      expect(codes(c), k).toEqual(['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE']);
      expect(errors(c)[0], k).toContain('width: inherit on <div> b takes 3ch from its parent');
    }
    expect(codes(compile('.a { margin-left: 2ex } .b { margin: inherit }'))).toEqual(['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE']);
    expect(errors(compile('.a { width: 3px } .b { width: inherit }'))).toEqual([]);
  });

  it('refuses natively a font size that follows the viewport, and keeps the web output', () => {
    const c = compile('.a { font-size: 5vw; width: 2ch; }');
    expect(codes(c)).toEqual(['android DRAGON_LOWERING_FAILED', 'ios DRAGON_LOWERING_FAILED']);
    expect(errors(c)[0]).toContain('expected an ex, ch or cap length over Ahem at a px font size');
    expect(c.outputs.web.kind).toBe('ready');
  });

  it('refuses a keyframe in ex, ch or cap', () => {
    const c = compile('@keyframes k { from { width: 1ch } to { width: 3ch } } .a { animation: k 1s infinite }');
    expect(codes(c)).toEqual(['null DRAGON_UNSUPPORTED_VALUE', 'null DRAGON_UNSUPPORTED_VALUE']);
    expect(errors(c)[0]).toContain('width: 1ch in @keyframes k is unsupported');
    expect(errors(compile('@keyframes k { to { margin-left: 2ex } } .a { animation: k 1s infinite }'))).toHaveLength(1);
  });

  it('refuses a transition from or to an ex, ch or cap length, and not one between px values', () => {
    const stated = (css: string): FrontEndResult => {
      const input = inputFor(`${FONT} ${css}`, (r) => {
        const d = el(r, 'a', 'div', ['a'], [text(r, 't', 'XX')]);
        const on = { value: [{ when: eq('open', true), value: { owner: DOC, sheet: 's', name: 'on' } }, { when: not(eq('open', true)), value: null }], origin: d.origin };
        return [{ ...d, classes: [...d.classes, on] }];
      });
      const tree = input.tree as DraftTree;
      const root = tree.components[0] as DraftTree['components'][number];
      return { ...input, tree: { ...tree, components: [{ ...root, states: [{ id: 'open', domain: [false, true], initial: false, origin: root.origin }] }] } };
    };
    const run = (css: string) => project(NO_FAULTS).compile(stated(css)).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    const refused = run('.a { width: 2ch; transition: width 1s; } .a.on { width: 40px; }');
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every((m) => m.includes('a transition from or to an ex, ch or cap length is unsupported')), refused.join('\n')).toBe(true);
    expect(run('.a { width: 20px; transition: width 1s; } .a.on { width: 40px; }')).toEqual([]);
    expect(run('.a { width: 2ch; transition: width 1s; } .a.on { color: red; }')).toEqual([]);
  });
});
