// css-sizing-4 §5.1 aspect-ratio (SIZE-ar): the parse Chrome 145 applies, the computed and emitted value, the raw layout ratio
// the lowering gives the engine (equal to the engine's own float conversion), and the build-time refusals.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import { layoutRatio } from '../../layout/src/units.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import { exactLayoutRatio } from '../src/css/values.ts';
import { div, inputFor } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const project = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });
const compile = (css: string) => project().compile(inputFor(`${FONT} ${css}`, (r) => [div(r, 'a', ['a'])]));

function find(b: LayoutBox, id: string): LayoutBox | null {
  if (b.id === id) return b;
  for (const c of b.children) if (c.kind === 'box' && find(c, id) !== null) return find(c, id);
  return null;
}

/** The engine aspectRatio of .a, or the diagnostics when the compile refuses it. */
function lowered(value: string): unknown {
  const c = compile(`.a { width: 100px; aspect-ratio: ${value}; }`);
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') return c.diagnostics.map((d) => `${d.code} ${d.message}`);
  return (find(p.input.root, 'a') as LayoutBox).style.aspectRatio;
}

/** The emitted declaration of .a's rule. */
function emitted(value: string): string | null {
  const c = compile(`.a { aspect-ratio: ${value}; }`);
  if (c.outputs.web.kind !== 'ready') return null;
  const text = (c.outputs.web.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
  const decls = [...text.matchAll(/ {2}aspect-ratio: ([^;]*);/g)].map((m) => m[1]);
  return decls[decls.length - 1] ?? null;
}

describe('aspect-ratio parsing (Chrome 145, probed in the pinned Chrome)', () => {
  it('accepts auto || <ratio> in either order, a single number as n / 1, and zero parts', () => {
    // Chrome's computed value for each: 16 / 9, auto 16 / 9 (both orders), 1.5 / 1, 0 / 1, 0 / 0, 1 / 0, 2 / 1, 0.5 / 1.
    expect(emitted('16/9')).toBe('16 / 9');
    expect(emitted('16 / 9')).toBe('16 / 9');
    expect(emitted('auto 16/9')).toBe('auto 16 / 9');
    expect(emitted('16/9 auto')).toBe('auto 16 / 9');
    expect(emitted('AUTO 2/1')).toBe('auto 2 / 1');
    expect(emitted('1.5')).toBe('1.5 / 1');
    expect(emitted('0')).toBe('0 / 1');
    expect(emitted('0/0')).toBe('0 / 0');
    expect(emitted('1 / 0')).toBe('1 / 0');
    expect(emitted('+2/1')).toBe('2 / 1');
    expect(emitted('.5')).toBe('0.5 / 1');
    expect(emitted('auto')).toBe('auto');
    // An escaped auto is auto (Macroscope 4162020520; Chrome 145 computes auto 16 / 9, auto and auto 16 / 9 for these).
    expect(emitted(String.raw`\61uto 16/9`)).toBe('auto 16 / 9');
    expect(emitted(String.raw`\61 uto`)).toBe('auto');
    expect(emitted(String.raw`16/9 AU\54O`)).toBe('auto 16 / 9');
  });
  it('drops what Chrome drops: negative parts, a unit, two ratios, two autos and a second slash', () => {
    for (const v of ['-1', '-1/2', '1/-2', '1px', 'auto auto', '16/9 16/9', '16/9/2', '16 / auto 9']) {
      const c = compile(`.a { aspect-ratio: ${v}; }`);
      expect(c.diagnostics.map((d) => d.code), v).toContain('DRAGON_CSS_INVALID_VALUE');
    }
  });
  it('refuses a calculation inside the ratio at its token', () => {
    const c = compile('.a { aspect-ratio: calc(1/2); }');
    const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
    expect(d?.message).toBe('aspect-ratio: calc(1/2) is unsupported: a calculation inside aspect-ratio is not supported');
  });
});

describe('the layout ratio the lowering gives the engine', () => {
  it('is Blink raw LayoutUnits: exact parts kept, auto && <ratio> as auto-ratio, a degenerate ratio as auto', () => {
    expect(lowered('16 / 9')).toEqual({ kind: 'ratio', width: 1024, height: 576 });
    expect(lowered('auto 16 / 9')).toEqual({ kind: 'auto-ratio', width: 1024, height: 576 });
    expect(lowered('1')).toEqual({ kind: 'ratio', width: 64, height: 64 });
    expect(lowered('1.5')).toEqual({ kind: 'ratio', width: 96, height: 64 });
    expect(lowered('0')).toEqual({ kind: 'auto' });
    expect(lowered('1 / 0')).toEqual({ kind: 'auto' });
    expect(lowered('auto')).toEqual({ kind: 'auto' });
  });
  it('equals the engine float conversion (units.ts layoutRatio) wherever the compiler gives one', () => {
    let compared = 0;
    for (let a = 0; a <= 40; a++) {
      for (let b = 0; b <= 40; b++) {
        for (const [w, h] of [[a, b], [a / 64, b], [a / 4, b / 8], [a * 1000, b * 997], [a / 10, a / 10]] as const) {
          const mine = exactLayoutRatio(w, h);
          if (mine === null) continue;
          compared++;
          expect(mine === 'degenerate' ? null : mine, `${w} / ${h}`).toEqual(layoutRatio(w, h));
        }
      }
    }
    expect(compared).toBeGreaterThan(8000);
  });
  it('refuses a ratio that needs Blink float continued fraction, at the declaration, on every target', () => {
    const c = compile('.a { aspect-ratio: 0.7; }');
    const d = c.diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
    expect(d.map((x) => x.target).sort()).toEqual(['ios', 'web']);
    expect(d[0]?.message).toMatch(/^aspect-ratio: 0.7 \/ 1 on a is unsupported: Chrome converts a ratio whose parts are not whole multiples of 1\/64/);
    expect(c.outputs.web.kind).toBe('blocked');
    // Equal parts are 1 / 1 without float arithmetic.
    expect(lowered('0.7 / 0.7')).toEqual({ kind: 'ratio', width: 64, height: 64 });
  });
  it('refuses a percentage height, min-height or max-height beside a ratio, and allows it beside a degenerate one', () => {
    for (const [p, v] of [['height', '50%'], ['min-height', '10%'], ['max-height', 'calc(50% - 1px)']]) {
      const c = compile(`.a { aspect-ratio: 2; ${p}: ${v}; }`);
      const d = c.diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(d.map((x) => x.target).sort(), p).toEqual(['ios', 'web']);
      expect(d[0]?.message, p).toMatch(new RegExp(`^${p}: .* beside aspect-ratio: 2 / 1 on a is unsupported`));
    }
    expect(compile('.a { aspect-ratio: 0 / 1; height: 50%; }').diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE')).toEqual([]);
    expect(compile('.a { aspect-ratio: 2; height: 50px; }').diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE')).toEqual([]);
  });
});

describe('object-position keywords (REPL-a, Macroscope 4164413914)', () => {
  it('reads an escaped or upper-case edge keyword as the keyword, as Chrome 145 computes it', async () => {
    const { parseValueText } = await import('../src/analysis/computed.ts');
    const left = parseValueText('object-position', 'left top');
    expect(left).toEqual({ kind: 'position', x: { unit: '%', value: 0 }, y: { unit: '%', value: 0 } });
    for (const v of [String.raw`\6c eft top`, String.raw`\6C eft \74op`, 'LEFT Top', String.raw`l\65 ft top`]) expect(parseValueText('object-position', v), v).toEqual(left);
    expect(parseValueText('object-position', String.raw`\72ight b\6fttom`)).toEqual(parseValueText('object-position', 'right bottom'));
  });
});
