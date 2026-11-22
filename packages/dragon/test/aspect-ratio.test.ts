// css-sizing-4 §5.1 aspect-ratio (SIZE-ar, ARAT): the parse Chrome 145 applies, the computed and emitted value, the authored parts
// the lowering gives the engine (which converts them as Blink does), and the build-time refusals.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import { createProjectWith, iosLayoutProjection, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
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

describe('the ratio the lowering gives the engine', () => {
  it('is the authored parts: auto && <ratio> as auto-ratio, a ratio with a zero part as auto', () => {
    expect(lowered('16 / 9')).toEqual({ kind: 'ratio', width: 16, height: 9 });
    expect(lowered('auto 16 / 9')).toEqual({ kind: 'auto-ratio', width: 16, height: 9 });
    expect(lowered('1')).toEqual({ kind: 'ratio', width: 1, height: 1 });
    expect(lowered('1.5')).toEqual({ kind: 'ratio', width: 1.5, height: 1 });
    expect(lowered('3 / 3.4')).toEqual({ kind: 'ratio', width: 3, height: 3.4 });
    expect(lowered('1.1875626880641925')).toEqual({ kind: 'ratio', width: 1.1875626880641925, height: 1 });
    expect(lowered('0.7 / 0.7')).toEqual({ kind: 'ratio', width: 0.7, height: 0.7 });
    // The engine zeroes a tiny part (gfx::SizeF); the compiler leaves that to it and lowers only a zero part as auto.
    expect(lowered('1 / 0.0000005')).toEqual({ kind: 'ratio', width: 1, height: 0.0000005 });
    expect(lowered('0')).toEqual({ kind: 'auto' });
    expect(lowered('1 / 0')).toEqual({ kind: 'auto' });
    expect(lowered('auto')).toEqual({ kind: 'auto' });
  });
  it('refuses no ratio for being fractional, tiny or large, on any target', () => {
    for (const v of ['0.7', '3 / 3.4', '1 / 3.14159265358979', '1 / 0.0000005', '1000000 / 1.7', '1e40 / 1']) {
      const c = compile(`.a { width: 100px; aspect-ratio: ${v}; }`);
      expect(c.diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE'), v).toEqual([]);
      expect(c.outputs.web.kind, v).toBe('ready');
    }
  });
  it('refuses a percentage height, min-height or max-height beside a ratio, and allows it beside a degenerate one', () => {
    for (const [p, v] of [['height', '50%'], ['min-height', '10%'], ['max-height', 'calc(50% - 1px)']]) {
      const c = compile(`.a { aspect-ratio: 2; ${p}: ${v}; }`);
      const d = c.diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(d.map((x) => x.target).sort(), p).toEqual(['ios', 'web']);
      expect(d[0]?.message, p).toMatch(new RegExp(`^${p}: .* beside aspect-ratio: 2 / 1 on a is unsupported`));
    }
    expect(compile('.a { aspect-ratio: 0 / 1; height: 50%; }').diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE')).toEqual([]);
    // A fractional ratio, and a tiny part Chrome takes as auto: refused all the same, since the compiler does not decide degeneracy.
    for (const ratio of ['3 / 3.4', '1 / 0.0000005']) expect(compile(`.a { aspect-ratio: ${ratio}; height: 50%; }`).diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE').map((x) => x.target).sort(), ratio).toEqual(['ios', 'web']);
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

  it('refuses an offset past the range of a number instead of carrying Infinity to the emitter (Macroscope 4164997169)', () => {
    for (const v of ['1e999px 0', '0 1e999%', 'left 1e999px top 0', '-1e999px 50%']) {
      const c = compile(`.a { object-position: ${v}; }`);
      const d = c.diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(d.map((x) => x.message).join(' '), v).toContain('an offset past the range of a number is not supported in object-position');
    }
    expect(compile('.a { object-position: 1e30px 0; }').diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE')).toEqual([]);
  });
});


describe('a non-replaced grid item with a ratio and an auto width (grid.ts transfers no size through its ratio)', () => {
  const grid = (css: string, item: (r: Parameters<typeof div>[0]) => ReturnType<typeof div> = (r) => div(r, 'i', ['i'])) =>
    project().compile(inputFor(`${FONT} .g { display: grid; grid-template-columns: 300px; } ${css}`, (r) => [div(r, 'g', ['g'], [item(r)])]));
  const refusals = (c: ReturnType<typeof grid>): string[] => c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE').map((d) => `${d.target} ${d.message}`);
  const transfer = (block: string, justify: string): string => `ios aspect-ratio: 16 / 9 on i, a grid item with an auto width, ${block} and justify-self: ${justify}, is not laid out yet: the engine does not transfer a grid item's block size through its ratio to its width`;
  const borderBox = (sides: string): string => `ios aspect-ratio: 16 / 9 on i, a border-box grid item with an auto width and a ${sides} border or padding, is not laid out yet: the engine does not widen a grid item past its column when its vertical border and padding exceed the height its ratio gives`;

  it('refuses on native a block size beside an inline alignment other than stretch, normal included (Chrome 145 lays these out as start)', () => {
    // Probed in Chrome 145, ltr and rtl: a 16 / 9 item 90px high is 160px wide in each of these, and the engine gives 0 or the column's 300.
    for (const [css, block, justify] of [
      ['justify-self: start; height: 90px;', 'height: 90px', 'start'],
      ['height: 90px;', 'height: 90px', 'normal'],
      ['justify-self: center; height: 90px;', 'height: 90px', 'center'],
      ['justify-self: self-end; height: 90px;', 'height: 90px', 'self-end'],
      ['justify-self: left; height: 90px;', 'height: 90px', 'left'],
      ['justify-self: start; min-height: 90px;', 'min-height: 90px', 'start'],
      ['justify-self: start; align-self: stretch;', 'align-self: stretch', 'start'],
      // Stretched in a definite row it is 160px wide in Chrome and 300px in the engine; refused in an auto row too, where both give 300.
      ['align-self: stretch;', 'align-self: stretch', 'normal'],
    ] as const) {
      const c = grid(`.i { aspect-ratio: 16 / 9; ${css} }`);
      expect(refusals(c), css).toEqual([transfer(block, justify)]);
      expect(c.outputs.web.kind, css).toBe('ready');
    }
    expect(refusals(grid('.g { justify-items: start; } .i { aspect-ratio: 16 / 9; height: 90px; }'))).toEqual([transfer('height: 90px', 'start')]);
    expect(refusals(grid('.g { justify-items: start; grid-template-rows: 90px; align-items: stretch; } .i { aspect-ratio: 16 / 9; }'))).toEqual([transfer('align-self: stretch', 'start')]);
  });
  it('refuses on native border-box sizing with a vertical border or padding, whatever the alignment', () => {
    // Probed in Chrome 145, ltr and rtl: in a 12.34px column such an item widens to 17.765625px, and the engine keeps 12.328125.
    expect(refusals(grid('.i { aspect-ratio: 16 / 9; box-sizing: border-box; padding: 3px 0 7px 0; }'))).toEqual([borderBox('top and bottom')]);
    expect(refusals(grid('.i { aspect-ratio: 16 / 9; box-sizing: border-box; border-bottom: 2px solid; justify-self: stretch; }'))).toEqual([borderBox('bottom')]);
    expect(refusals(grid('.i { aspect-ratio: 16 / 9; box-sizing: border-box; padding-top: 1px; justify-self: start; height: 90px; }'))).toEqual([transfer('height: 90px', 'start'), borderBox('top')]);
  });
  it('compiles the shapes the engine lays out as Chrome does', () => {
    for (const css of [
      'aspect-ratio: 16 / 9; justify-self: stretch; height: 90px;',
      'aspect-ratio: 16 / 9; justify-self: start; width: 160px;',
      'aspect-ratio: 16 / 9; justify-self: start;',
      'aspect-ratio: 16 / 9;',
      'aspect-ratio: 16 / 9; justify-self: start; min-height: 0;',
      'aspect-ratio: 16 / 9; justify-self: start; max-height: 45px;',
      'aspect-ratio: 16 / 9; padding: 3px 0 7px 0;',
      'aspect-ratio: 16 / 9; box-sizing: border-box; padding: 0 5px 0 2px;',
      'aspect-ratio: 16 / 9; box-sizing: border-box; border-bottom-width: 2px;',
      'aspect-ratio: 16 / 9; box-sizing: border-box; padding: 3px 0; width: 12px;',
      'aspect-ratio: 0 / 1; justify-self: start; height: 90px;',
      'aspect-ratio: 16 / 9; justify-self: start; height: 90px; position: absolute;',
    ]) expect(refusals(grid(`.i { ${css} }`)), css).toEqual([]);
    const img = (r: Parameters<typeof div>[0]) => ({ ...div(r, 'i', ['i']), tag: 'img' });
    expect(refusals(grid('.i { aspect-ratio: 16 / 9; justify-self: start; height: 90px; box-sizing: border-box; padding: 3px; }', img))).toEqual([]);
    const block = project().compile(inputFor(`${FONT} .i { aspect-ratio: 16 / 9; height: 90px; box-sizing: border-box; padding: 3px; }`, (r) => [div(r, 'b', [], [div(r, 'i', ['i'])])]));
    expect(refusals(block)).toEqual([]);
  });
  it('leaves the Markless shop skeleton card alone (packages/mobile/apps/shop/styles/app.css, Markless f12707d7a), with its ratio or a whole one', () => {
    for (const ratio of ['3 / 3.4', '3 / 4']) {
      const css = `* { box-sizing: border-box; } .content { display: block; padding: 20px 16px; } .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; list-style: none; margin: 0; padding: 0; } .skeleton { aspect-ratio: ${ratio}; border-radius: 12px; background: #eee; }`;
      const c = project().compile(inputFor(`${FONT} ${css}`, (r) => [{ ...div(r, 'm', ['content'], [{ ...div(r, 'u', ['grid'], [0, 1, 2, 3].map((n) => ({ ...div(r, `s${n}`, ['skeleton']), tag: 'li' }))), tag: 'ul' }]), tag: 'main' }]));
      expect(refusals(c).filter((m) => m.includes('grid item')), ratio).toEqual([]);
    }
  });
});
