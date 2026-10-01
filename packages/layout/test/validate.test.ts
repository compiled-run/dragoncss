import { describe, expect, it } from 'vitest';
import type { LayoutInput, TextLeaf } from '../src/index.ts';
import { ahemMeasurer, layout, validateLayoutInput } from '../src/index.ts';
import { box, neutralEnvironment, text } from './helpers.ts';

const good = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root: box('root', {}, [box('a', {})]) };

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('validateLayoutInput', () => {
  it('accepts a fully specified input', () => {
    expect(validateLayoutInput(clone(good)).ok).toBe(true);
  });

  it('planted fault 3: a missing style field is rejected', () => {
    const bad = clone(good) as unknown as { root: { children: { style: Record<string, unknown> }[] } };
    delete bad.root.children[0]?.style['boxSizing'];
    const r = validateLayoutInput(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual(expect.objectContaining({ code: 'missing-key', path: '$.root.children[0].style.boxSizing' }));
  });

  it('rejects extra keys, unknown tags and bad enums', () => {
    const bad = clone(good) as unknown as { root: { style: Record<string, unknown> } };
    bad.root.style['float'] = 'left';
    bad.root.style['width'] = { kind: 'em', value: 2 };
    bad.root.style['display'] = 'grid';
    const r = validateLayoutInput(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code).sort()).toEqual(['bad-value', 'extra-key', 'unknown-tag']);
    }
  });

  it('rejects negative padding and duplicate ids', () => {
    const bad = clone(good) as unknown as { root: { style: Record<string, unknown>; children: { id: string }[] } };
    bad.root.style['paddingTop'] = { kind: 'px', value: -1 };
    (bad.root.children[0] as { id: string }).id = 'root';
    const r = validateLayoutInput(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code).sort()).toEqual(['bad-value', 'duplicate-id']);
  });

  it('S4b: rejects bad position and inset fields, a missing inset, and an absolutely positioned root', () => {
    const bad = clone(good) as unknown as { root: { style: Record<string, unknown>; children: { style: Record<string, unknown> }[] } };
    const kid = bad.root.children[0] as { style: Record<string, unknown> };
    kid.style['position'] = 'fixed';
    kid.style['top'] = { kind: 'em', value: 1 };
    kid.style['left'] = { kind: 'px', value: Number.NaN };
    delete kid.style['bottom'];
    const r = validateLayoutInput(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => `${e.path} ${e.code}`).sort()).toEqual([
        '$.root.children[0].style.bottom missing-key',
        '$.root.children[0].style.left.value wrong-type',
        '$.root.children[0].style.position bad-value',
        '$.root.children[0].style.top.kind unknown-tag',
      ]);
    }
    for (const position of ['sticky', 'fixed']) {
      const b = clone(good) as unknown as { root: { style: Record<string, unknown> } };
      b.root.style['position'] = position;
      expect(validateLayoutInput(b).ok, position).toBe(false);
    }
    const absRoot = clone(good) as unknown as { root: { style: Record<string, unknown> } };
    absRoot.root.style['position'] = 'absolute';
    const a = validateLayoutInput(absRoot);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors).toEqual([expect.objectContaining({ path: '$.root.style.position', code: 'bad-value' })]);
    const relRoot = clone(good) as unknown as { root: { style: Record<string, unknown> } };
    relRoot.root.style['position'] = 'relative';
    relRoot.root.style['top'] = { kind: 'percent', value: -5 };
    expect(validateLayoutInput(relRoot).ok).toBe(true);
  });
});

describe('V2 value-model inputs the engine cannot lay out are rejected (validate.ts)', () => {
  const px = (value: number) => ({ kind: 'px', value });
  const withLeaf = (over: Record<string, unknown>): unknown => ({
    ...clone(good),
    root: box('root', {}, [box('p', {}, [text('p:t', 'XX', over as Partial<TextLeaf>)])]),
  });
  const verdict = (over: Record<string, unknown>): { ok: boolean; codes: string[] } => {
    const r = validateLayoutInput(JSON.parse(JSON.stringify(withLeaf(over))));
    return { ok: r.ok, codes: r.ok ? [] : r.errors.map((e) => e.code) };
  };
  const font = (specifiedSize: unknown) => ({ family: 'Ahem', size: 10, specifiedSize, absoluteSize: true });
  const lhLeaf = (lineHeight: unknown) => ({ kind: 'calc', range: 'non-negative', expr: { kind: 'lh', value: 1, font: font(px(10)), lineHeight } });

  it('a font-size percentage must not be negative (css-fonts-4 §2.5)', () => {
    expect(verdict({ font: font({ kind: 'font-percent', value: 150, parent: px(10) }) }).ok).toBe(true);
    expect(verdict({ font: font({ kind: 'font-percent', value: 0, parent: px(10) }) }).ok).toBe(true);
    expect(verdict({ font: font({ kind: 'font-percent', value: -100, parent: px(10) }) })).toEqual({ ok: false, codes: ['bad-value'] });
    expect(verdict({ font: font({ kind: 'font-percent', value: 50, parent: { kind: 'font-percent', value: -1, parent: px(10) } }) })).toEqual({ ok: false, codes: ['bad-value'] });
  });

  it('a calculated line height must carry the non-negative range, on a text leaf and inside an lh leaf (CSS2 §10.8.1)', () => {
    const lh = (range: string) => ({ kind: 'calc', range, expr: px(-1) });
    expect(verdict({ lineHeight: lh('non-negative') }).ok).toBe(true);
    expect(verdict({ lineHeight: lh('all') })).toEqual({ ok: false, codes: ['bad-value'] });
    const style = (width: unknown): unknown => ({ ...clone(good), root: box('root', {}, [box('p', { width: width as never })]) });
    expect(validateLayoutInput(JSON.parse(JSON.stringify(style(lhLeaf(lh('non-negative')))))).ok).toBe(true);
    const r = validateLayoutInput(JSON.parse(JSON.stringify(style(lhLeaf(lh('all'))))));
    expect(r.ok ? [] : r.errors.map((e) => e.code)).toEqual(['bad-value']);
  });

  it('a non-negative calculated line height of -1px lays out as 0, so an accepted input never gives a negative line box', () => {
    const input = withLeaf({ lineHeight: { kind: 'calc', range: 'non-negative', expr: px(-1) } }) as LayoutInput;
    const r = layout(input, ahemMeasurer);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.boxes.find((b) => b.id === 'p')?.height).toBe(0);
  });
});
