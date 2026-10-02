// INL1a R5 input model: inline boxes, line breaks, the container strut and vertical-align (input.ts). The validator checks their
// shape; the engine lays out text leaves only until the inline core lands, so it refuses an inline box or a <br> with a typed code.
import { describe, expect, it } from 'vitest';
import { ahemMeasurer, layout, NO_ENGINE_FAULTS, validateLayoutInput, zoomInput } from '../src/index.ts';
import type { InlineChild, LayoutBox, LayoutInput } from '../src/index.ts';
import { ahemFont, box, br, divStyle, neutralEnvironment, px, span, text } from './helpers.ts';

const input = (root: LayoutBox): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
const strut = { font: ahemFont(10), lineHeight: { kind: 'normal' } } as const;

describe('the validator for inline content (R5)', () => {
  const v = (root: unknown): string[] => {
    const r = validateLayoutInput(JSON.parse(JSON.stringify({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root })));
    return r.ok ? [] : r.errors.map((e) => e.code);
  };
  it('accepts inline boxes and line breaks with a strut, and rejects a missing or extra strut', () => {
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX'), span('s', [text('u', 'YY'), br('b')])])]))).toEqual([]);
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX')], null)]))).toEqual(['strut']);
    expect(v(box('root', {}, [box('c', {}, [box('d', {})], strut)]))).toEqual(['strut']);
    const { strut: _dropped, ...noStrut } = box('root', {});
    expect(v(noStrut)).toEqual(['missing-key']);
  });
  it('checks the strut, the inline box and the <br> fields with the font and line-height rules', () => {
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX')], { font: ahemFont(10), lineHeight: { kind: 'number', value: -1 } })]))).toContain('bad-value');
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX'), br('b', { lineHeight: { kind: 'px', value: -1 } })])]))).toEqual(['bad-value']);
    expect(v(box('root', {}, [box('c', {}, [{ ...br('b'), extra: 1 } as unknown as InlineChild])]))).toEqual(['extra-key']);
    expect(v(box('root', {}, [box('c', {}, [span('s', [], { font: { ...ahemFont(10), size: -1 } })])]))).toEqual(['bad-value']);
  });
  it('rejects a box or a replaced leaf inside an inline box, a LayoutBox with display inline and an inline box with another display', () => {
    const inner = span('s', []);
    expect(v(box('root', {}, [box('c', {}, [{ ...inner, children: [box('d', {}) as unknown as InlineChild] }], strut)]))).toContain('block-in-inline');
    const replaced = { kind: 'replaced', id: 'r', style: divStyle, natural: { kind: 'none' }, defaultWidth: 300, defaultHeight: 150, objectFit: 'fill', objectPositionX: { kind: 'percent', value: 50 }, objectPositionY: { kind: 'percent', value: 50 } };
    expect(v(box('root', {}, [box('c', {}, [{ ...inner, children: [replaced as unknown as InlineChild] }], strut)]))).toEqual(['block-in-inline']);
    expect(v(box('root', {}, [box('c', { display: 'inline' })]))).toEqual(['bad-value']);
    expect(v(box('root', {}, [box('c', {}, [{ ...inner, style: { ...inner.style, display: 'block' } }])]))).toEqual(['bad-value']);
    // An inline replaced box is an atomic inline (INL2): a replaced leaf stays block-level.
    expect(v(box('root', {}, [{ ...replaced, style: { ...divStyle, display: 'inline' } } as unknown as LayoutBox]))).toEqual(['bad-value']);
  });
  it('rejects a text leaf whose font or line-height is not its parent\'s (the strut, or its inline box)', () => {
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX'), span('s', [text('u', 'YY')], { font: ahemFont(20) })], strut)]))).toEqual(['leaf-font']);
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX', { font: ahemFont(12) })], strut)]))).toEqual(['leaf-font']);
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX', { lineHeight: { kind: 'number', value: 2 } })], strut)]))).toEqual(['leaf-font']);
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX'), span('s', [text('u', 'YY', { font: ahemFont(20) })], { font: ahemFont(20) })], strut)]))).toEqual([]);
  });
  it('rejects spaces after a <br> and at the end of the context, and keeps one before a <br>', () => {
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX '), br('b'), text('u', 'YY')])]))).toEqual([]);
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX'), br('b'), text('u', ' YY')])]))).toEqual(['uncollapsed-text']);
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX'), span('s', [text('u', 'YY ')])])]))).toEqual(['uncollapsed-text']);
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX'), span('s', [text('u', ' YY')])])]))).toEqual([]);
    expect(v(box('root', {}, [box('c', {}, [text('t', 'XX '), span('s', [text('u', ' YY')])])]))).toEqual(['uncollapsed-text']);
  });
  it('wraps inline content beside boxes or in a flex container: inline boxes and <br>s count as inline content', () => {
    expect(v(box('root', {}, [box('c', {}, [box('d', {}), br('b')], strut)]))).toEqual(['mixed-children']);
    expect(v(box('root', {}, [box('c', { display: 'flex' }, [span('s', [text('u', 'YY')])])]))).toEqual(['text-in-flex']);
  });
  it('checks vertical-align as a tagged value: a keyword of the CSS2 §10.8.1 set, a length, a percentage or a calculation', () => {
    const withAlign = (verticalAlign: unknown): unknown => box('root', { verticalAlign: verticalAlign as never });
    expect(v(withAlign({ kind: 'keyword', value: 'middle' }))).toEqual([]);
    expect(v(withAlign({ kind: 'px', value: -3 }))).toEqual([]);
    expect(v(withAlign({ kind: 'percent', value: 50 }))).toEqual([]);
    expect(v(withAlign({ kind: 'keyword', value: 'center' }))).toEqual(['bad-value']);
    expect(v(withAlign({ kind: 'auto' }))).toEqual(['unknown-tag']);
  });
});

describe('until the inline core lands, the engine lays out text leaves only', () => {
  const code = (kids: InlineChild[]): string | null => {
    const r = layout(input(box('root', {}, [box('c', { width: px(100) }, kids)])), ahemMeasurer);
    return r.kind === 'unsupported' ? `${r.unsupported.code} ${r.unsupported.nodeId}` : null;
  };
  it('refuses an inline box or a <br> with the inline-box code, naming it', () => {
    expect(code([text('t', 'XX'), span('s', [text('u', 'YY')])])).toBe('inline-box s');
    expect(code([text('t', 'XX'), br('b'), text('u', 'YY')])).toBe('inline-box b');
    expect(code([text('t', 'XX')])).toBeNull();
  });
  it('refuses them in intrinsic sizing too (a shrink-to-fit flex item)', () => {
    const r = layout(input(box('root', {}, [box('row', { display: 'flex', width: px(100) }, [box('i', {}, [text('t', 'XX'), br('b')])])])), ahemMeasurer);
    expect(r.kind === 'unsupported' ? r.unsupported.code : null).toBe('inline-box');
  });
  it('the environment pass zooms the strut and vertical-align, and resolves a vertical-align calculation', () => {
    const calc = { kind: 'calc', expr: { kind: 'sum', terms: [{ kind: 'px', value: 1 }, { kind: 'px', value: 1 }] } } as const;
    const root = box('root', { verticalAlign: px(3) }, [box('c', { verticalAlign: calc }, [text('t', 'XX')])]);
    const z = zoomInput({ ...input(root), devicePixelRatio: 2 }, NO_ENGINE_FAULTS);
    const c = z.root.children[0] as LayoutBox;
    expect(z.root.style.verticalAlign).toEqual(px(6));
    expect(c.style.verticalAlign).toEqual(px(4));
    expect(c.strut?.font.size).toBe(20);
  });
});
