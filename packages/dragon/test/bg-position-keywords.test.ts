// BG2 edge keywords (css-backgrounds-3 §3.6; fixture bg-position-keywords): right and bottom read as 100% on their axis, as Chrome
// 145 computes them, and compile for every target; what stays refused is refused, on the targets that refuse it.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import { position, positionAxisItem } from '../src/analysis/paint-values/gradient.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { Targets } from '../src/types.ts';
import { div, inputFor } from './helpers.ts';

const tokens = (text: string): CssNode[] => ((parse(text, { context: 'value' }) as unknown as { children: { toArray(): CssNode[] } }).children.toArray().filter((n) => n.type !== 'WhiteSpace'));
const ok = <T>(i: { ok: true; value: T } | { ok: false }): T => {
  if (!i.ok) throw new Error('refused');
  return i.value;
};
const reason = (i: { ok: boolean; refusal?: { reason: string } }): string => (i.ok ? '' : (i.refusal?.reason ?? ''));
const ALL: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
const compile = (rule: string, targets: Targets = ALL): string[] => {
  const css = `body { margin: 0; } .a { width: 40px; height: 20px; ${rule} }`;
  const c = createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.target ?? 'all'} ${d.message}`);
};
const LAYER = 'background-color: #eee; background-image: linear-gradient(red, blue); background-size: 10px 8px; background-repeat: no-repeat;';

describe('background-position edge keywords', () => {
  it('read right and bottom as 100% on their own axis, alone and paired in either order', () => {
    const full = { unit: 'percent', value: 100 };
    expect(ok(positionAxisItem(tokens('right'), 'x'))).toEqual(full);
    expect(ok(positionAxisItem(tokens('bottom'), 'y'))).toEqual(full);
    expect(ok(position(tokens('right top'), 'p'))).toEqual({ x: full, y: { unit: 'percent', value: 0 } });
    expect(ok(position(tokens('bottom right'), 'p'))).toEqual({ x: full, y: full });
    expect(ok(position(tokens('bottom'), 'p'))).toEqual({ x: { unit: 'percent', value: 50 }, y: full });
    expect(ok(position(tokens('right'), 'p'))).toEqual({ x: full, y: { unit: 'percent', value: 50 } });
  });
  it('refuse an edge keyword on the other axis and the logical edges, which no target draws', () => {
    expect(reason(positionAxisItem(tokens('bottom'), 'x'))).toContain('bottom positions are not supported');
    expect(reason(positionAxisItem(tokens('right'), 'y'))).toContain('right positions are not supported');
    for (const k of ['x-start', 'x-end']) expect(reason(positionAxisItem(tokens(k), 'x')), k).toContain(`${k} positions are not supported (BG2c)`);
    for (const k of ['y-start', 'y-end']) expect(reason(positionAxisItem(tokens(k), 'y')), k).toContain(`${k} positions are not supported (BG2c)`);
  });
  it('compile a non-repeating layer at each edge for every target, through the shorthands and the longhands', () => {
    for (const p of ['right top', 'right bottom', 'left bottom', 'bottom', 'right', 'top right', 'bottom left']) expect(compile(`${LAYER} background-position: ${p};`), p).toEqual([]);
    expect(compile(`${LAYER} background-position-x: right; background-position-y: bottom;`)).toEqual([]);
    expect(compile('background: linear-gradient(red, blue) right bottom / 10px 8px no-repeat #eee;')).toEqual([]);
  });
  it('refuse a logical edge on every target', () => {
    const out = compile(`${LAYER} background-position-x: x-end;`);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((m) => m.startsWith('DRAGON_UNSUPPORTED_VALUE all ') && m.includes('x-end positions are not supported'))).toBe(true);
  });
  it('refuse a repeating layer away from its start edge on ios and android only, since it tiles', () => {
    const tiled = (rule: string, targets?: Targets) => compile(`background-color: #eee; background-image: linear-gradient(red, blue); ${rule}`, targets);
    for (const p of ['right', 'bottom', 'right bottom']) {
      const out = tiled(`background-position: ${p};`);
      expect(out.map((m) => m.split(' ').slice(0, 2).join(' ')), p).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios']);
      expect(out.every((m) => m.includes('position other than the start edge tiles')), p).toBe(true);
      expect(tiled(`background-position: ${p};`, { web: {} }), p).toEqual([]);
    }
  });
});
