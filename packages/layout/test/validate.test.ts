import { describe, expect, it } from 'vitest';
import { validateLayoutInput } from '../src/index.ts';
import { box } from './helpers.ts';

const good = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root: box('root', {}, [box('a', {})]) };

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
});
