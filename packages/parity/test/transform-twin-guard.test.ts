// The frame break capture refuses a sample with an element the transform twin would restyle (frame-capture.ts), and the twin
// restyles an element whose transform, translate, rotate or scale is not none (transform-capture.ts). Both read transformedIds, so
// a frame case with a static rotate (whose computed transform stays none) is refused, not silently un-rotated mid-script.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';
import { TRANSFORM_PROPERTIES, transformedIds } from '../src/transform-capture.ts';

type Styles = { readonly [p: string]: string };

/** A page whose evaluate runs the function on a stub document of elements with the given computed styles. */
const pageOf = (els: readonly (readonly [string, Styles])[]) => ({
  evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => {
    const g = globalThis as Record<string, unknown>;
    const nodes = els.map(([id, cs]) => ({ id, cs, getAttribute: (n: string) => (n === 'data-dragon-id' ? id : null) }));
    g['document'] = { querySelectorAll: (sel: string) => (sel === '[data-dragon-id]' ? nodes : []) };
    g['getComputedStyle'] = (el: { cs: Styles }) => ({ getPropertyValue: (p: string) => el.cs[p] ?? 'none', transform: el.cs['transform'] ?? 'none' });
    return fn(arg);
  },
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g['document'];
  delete g['getComputedStyle'];
});

describe('transformedIds', () => {
  it('names every element with a transform, translate, rotate or scale that is not none, in document order', async () => {
    expect(TRANSFORM_PROPERTIES).toEqual(['transform', 'translate', 'rotate', 'scale']);
    const page = pageOf([['a', {}], ['r', { rotate: '10deg' }], ['t', { translate: '5px' }], ['s', { scale: '2' }], ['m', { transform: 'matrix(1, 0, 0, 1, 2, 0)' }], ['b', {}]]);
    expect(await transformedIds(page as never)).toEqual(['r', 't', 's', 'm']);
  });
  it('names a statically rotated element, whose computed transform is none', async () => {
    expect(await transformedIds(pageOf([['r', { rotate: '10deg', transform: 'none' }]]) as never)).toEqual(['r']);
    expect(await transformedIds(pageOf([['a', {}]]) as never)).toEqual([]);
  });
  it('is the frame break capture guard, so a frame case with a static rotate is refused', () => {
    const src = readFileSync(repoPath('packages/parity/src/frame-capture.ts'), 'utf8');
    expect(src).toContain('const transformed = await transformedIds(page);');
    expect(src).not.toMatch(/getComputedStyle\(el\)\.transform !== 'none'/);
  });
});
