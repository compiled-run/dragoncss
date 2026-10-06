// R5 (notes/T010-p2-triage.md ruling 1, owner decision D1): a border width that is its initial value by provenance lowers to a
// typed device-px engine value, because Chrome keeps the initial width at 3 device px at every pixel ratio. Authored widths stay CSS
// px, and resolved values, web emission and profile features do not change.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import { ahemMeasurer, layout } from '@dragon/layout';
import { createProject } from '../src/index.ts';
import { iosLayoutProjection, referenceDataset, WEB_CSS_PATH } from '../src/internal.ts';
import { isInitialByProvenance } from '../src/analysis/resolve.ts';
import { div, explainOne, inputFor } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const project = () => createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });
const SIDES = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'] as const;

function lowered(css: string, dpr = 1): LayoutBox {
  const c = project().compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
  expect(c.ok, JSON.stringify(c.diagnostics.map((d) => d.message))).toBe(true);
  const p = iosLayoutProjection(c, { ...ENV, devicePixelRatio: dpr }, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const body = p.input.root.children[0] as LayoutBox;
  return body.children[0] as LayoutBox;
}

const widths = (b: LayoutBox): unknown[] => SIDES.map((k) => b.style[k]);
const medium = Number.parseFloat(referenceDataset().borderWidthKeywords['medium'] as string);

describe('R5: initial line widths lower to device px', () => {
  it('the UA dataset medium keyword is 3px; the device-px value is read from it', () => {
    expect(medium).toBe(3);
  });

  it('branch no-width-declared: border-style: solid alone gives four device-px widths of the dataset medium value', () => {
    expect(widths(lowered('.a { border-style: solid; }'))).toEqual(SIDES.map(() => ({ kind: 'device-px', value: medium })));
  });

  it('branch shorthand-omitted: border: solid and border-top: solid reset the width to its initial value, which lowers to device px', () => {
    expect(widths(lowered('.a { border: solid; }'))).toEqual(SIDES.map(() => ({ kind: 'device-px', value: medium })));
    expect(widths(lowered('.a { border-top: solid; }'))).toEqual([{ kind: 'device-px', value: medium }, { kind: 'px', value: 0 }, { kind: 'px', value: 0 }, { kind: 'px', value: 0 }]);
  });

  it('authored medium, thin, thick and px widths stay CSS px (Chrome zooms them)', () => {
    expect(widths(lowered('.a { border: medium solid; }'))).toEqual(SIDES.map(() => ({ kind: 'px', value: 3 })));
    expect(widths(lowered('.a { border: thin solid; }'))).toEqual(SIDES.map(() => ({ kind: 'px', value: 1 })));
    expect(widths(lowered('.a { border-left: thick solid; }'))).toEqual([{ kind: 'px', value: 0 }, { kind: 'px', value: 0 }, { kind: 'px', value: 0 }, { kind: 'px', value: 5 }]);
    expect(widths(lowered('.a { border: 3px solid; }'))).toEqual(SIDES.map(() => ({ kind: 'px', value: 3 })));
    expect(widths(lowered('.a { border-style: solid; border-top-width: medium; }'))).toEqual([{ kind: 'px', value: 3 }, ...SIDES.slice(1).map(() => ({ kind: 'device-px', value: medium }))]);
  });

  it('a none or hidden style still lowers to 0 CSS px; anonymous boxes carry no device-px width', () => {
    expect(widths(lowered('.a { border-width: 4px; }'))).toEqual(SIDES.map(() => ({ kind: 'px', value: 0 })));
    const c = project().compile(inputFor('.a { border-style: solid; }', (r) => [div(r, 'a', ['a'])]));
    const p = iosLayoutProjection(c, ENV, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const text = JSON.stringify(p.input);
    expect(text.match(/device-px/g)?.length).toBe(4);
  });

  it('the lowering does not depend on the pixel ratio: the compiler writes the same device-px value at DPR 1, 2, 3 and 2.625', () => {
    for (const dpr of [1, 2, 3, 2.625]) expect(widths(lowered('.a { border-style: solid; }', dpr))).toEqual(SIDES.map(() => ({ kind: 'device-px', value: medium })));
  });

  it('resolved values, web emission and the support profile features are unchanged: the web CSS keeps border-top-width: medium', () => {
    const c = project().compile(inputFor('.a { border-style: solid; }', (r) => [div(r, 'a', ['a'])]));
    // An initial value is no author feature, so it has no support row, before and after R5.
    expect(explainOne(c, 'ios', 'a', 'border-top-width')).toMatchObject({ value: 'medium', cascade: 'initial', support: null });
    const web = c.outputs.web;
    if (web.kind !== 'ready') throw new Error('web output not ready');
    const css = web.files.find((f) => f.path === WEB_CSS_PATH)?.text ?? '';
    expect(css).toContain('border-top-width: medium;');
    expect(css).not.toContain('device');
  });

  it('at DPR 1 a device px is a CSS px: the engine lays out device-px and px widths identically', () => {
    const a = lowered('.a { border-style: solid; width: 50px; height: 10px; }');
    const b: LayoutBox = { ...a, style: { ...a.style, borderTopWidth: { kind: 'px', value: 3 }, borderRightWidth: { kind: 'px', value: 3 }, borderBottomWidth: { kind: 'px', value: 3 }, borderLeftWidth: { kind: 'px', value: 3 } } };
    const run = (x: LayoutBox) => layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, viewportUnits: { small: { width: 400, height: 300 }, large: { width: 400, height: 300 }, dynamic: { width: 400, height: 300 } }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16, root: { ...(lowered('.x{}') as LayoutBox), id: 'html', children: [x] } }, ahemMeasurer);
    expect(run(a)).toEqual(run(b));
  });

  it('isInitialByProvenance: initial origin and shorthand-filled longhands are initial; an authored keyword equal to the initial value is not', () => {
    const c = project().compile(inputFor('.a { border: solid; border-left-width: medium; }', (r) => [div(r, 'a', ['a'])]));
    expect(c.ok).toBe(true);
    expect(widths(lowered('.a { border: solid; border-left-width: medium; }'))).toEqual([...SIDES.slice(0, 3).map(() => ({ kind: 'device-px', value: medium })), { kind: 'px', value: 3 }]);
    expect(isInitialByProvenance({ value: { kind: 'keyword', value: 'medium' }, origin: 'initial', span: null, declaration: null, declared: null, losing: [] }, 'border-top-width')).toBe(true);
    expect(isInitialByProvenance({ value: { kind: 'keyword', value: 'medium' }, origin: 'inherited', span: null, declaration: null, declared: null, losing: [] }, 'border-top-width')).toBe(false);
  });

  it('latent finding (not widened here): border-top-width initial stays refused by the m1-s5 profile; inherit compiles since ctx-proof-inherit proved it', () => {
    const initial = project().compile(inputFor('.a { border-style: solid; border-top-width: initial; }', (r) => [div(r, 'a', ['a'])]));
    expect(initial.ok).toBe(false);
    expect(initial.diagnostics.map((d) => d.code)).toContain('DRAGON_UNSUPPORTED_VALUE');
    const inherit = project().compile(inputFor('.a { border-style: solid; border-top-width: inherit; }', (r) => [div(r, 'a', ['a'])]));
    expect(inherit.ok).toBe(true);
    expect(inherit.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
