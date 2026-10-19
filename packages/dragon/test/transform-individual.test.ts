// PNT2: the individual transform properties translate, rotate and scale (css-transforms-2 §4). Each is read as one 2D function
// and applied before transform, in that order, about transform-origin; a z component, a rotation axis and a composition that skews
// are refused. The Chrome case is transform-individual (packages/parity/fixtures), measured by pnt2-quads.test.ts.
import { describe, expect, it } from 'vitest';
import type { Compiled, FrontEndResult } from '../src/index.ts';
import { createProjectWith, nativePrograms, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { INDIVIDUAL_TRANSFORMS } from '../src/css/properties/transform.ts';
import { div, inputFor, spanTextOf, text } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';

function compile(css: string): { input: FrontEndResult; c: Compiled<'ios' | 'android' | 'web'> } {
  const input = inputFor(`${FONT} ${css}`, (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX')])]);
  const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  return { input, c };
}

const errors = (r: ReturnType<typeof compile>): string[] => [...new Set(r.c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${JSON.stringify(spanTextOf(r.input, d))} ${d.message}`))];

function webRule(r: ReturnType<typeof compile>): string {
  const web = r.c.outputs.web;
  if (web.kind !== 'ready') throw new Error('web output blocked');
  return web.files.find((f) => f.path === WEB_CSS_PATH)?.text ?? '';
}

function ops(r: ReturnType<typeof compile>): unknown {
  const p = nativePrograms(r.c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const uikit = p.programs.uikit.nodes.find((x) => x.id === 'a')?.writes.find((x) => x.kind === 'transform');
  const android = p.programs['android-views'].nodes.find((x) => x.id === 'a')?.writes.find((x) => x.kind === 'transform');
  expect((android as { ops?: unknown } | undefined)?.ops).toEqual((uikit as { ops?: unknown } | undefined)?.ops);
  return (uikit as { ops?: unknown } | undefined)?.ops;
}

const px = (v: number) => ({ kind: 'px', px: v, percent: 0 });
const pct = (v: number) => ({ kind: 'percent', px: 0, percent: v });

describe('PNT2: translate, rotate and scale', () => {
  it('are transform longhands after will-change that Chrome interpolates and Dragon does not animate yet', () => {
    expect([...INDIVIDUAL_TRANSFORMS]).toEqual(['translate', 'rotate', 'scale']);
    expect(LONGHANDS.slice(LONGHANDS.indexOf('will-change') + 1, LONGHANDS.indexOf('will-change') + 4)).toEqual(['translate', 'rotate', 'scale']);
    for (const p of INDIVIDUAL_TRANSFORMS) expect(ANIMATION_KINDS[p], p).toBe(UNADMITTED);
  });

  it('compute to px and percentages, degrees and numbers, and keep none', () => {
    const r = compile('.a { font-size: 20px; translate: 1em -50%; rotate: 0.25turn; scale: 150% 2; } ');
    expect(errors(r)).toEqual([]);
    expect(webRule(r)).toMatch(/translate: 20px -50%;\n\s*rotate: 90deg;\n\s*scale: 1\.5 2;/);
    expect(webRule(compile('.a { translate: 3px; scale: 2; rotate: -0deg; }'))).toMatch(/translate: 3px 0px;\n\s*rotate: 0deg;\n\s*scale: 2 2;/);
    expect(webRule(compile('.a { translate: none; rotate: none; scale: none; }'))).toMatch(/translate: none;\n\s*rotate: none;\n\s*scale: none;/);
    expect(errors(compile('.a { translate: 1px 2px 0; scale: 2 3 1; }'))).toEqual([]);
  });

  it('apply translate, then rotate, then scale, then transform, on both native backends', () => {
    expect(ops(compile('.a { transform: translateX(4px); scale: 2 3; rotate: 30deg; translate: 10% 5px; }'))).toEqual([
      { fn: 'translate', x: pct(10), y: px(5), angle: 0, sx: 1, sy: 1 },
      { fn: 'rotate', x: px(0), y: px(0), angle: 30, sx: 1, sy: 1 },
      { fn: 'scale', x: px(0), y: px(0), angle: 0, sx: 2, sy: 3 },
      { fn: 'translateX', x: px(4), y: px(0), angle: 0, sx: 1, sy: 1 },
    ]);
    expect(ops(compile('.a { rotate: -45deg; }'))).toEqual([{ fn: 'rotate', x: px(0), y: px(0), angle: -45, sx: 1, sy: 1 }]);
    expect(ops(compile('.a { scale: none; }'))).toBeUndefined();
  });

  it('refuse a z component, a rotation axis and a composition that skews, naming PNT2-m', () => {
    const M = 'skew, 3D functions and perspective are not supported yet (package PNT2-m)';
    expect(errors(compile('.a { translate: 1px 2px 3px; }'))).toEqual([`DRAGON_UNSUPPORTED_VALUE "3px" translate: 3px is unsupported: a z translation moves the box off the plane: ${M}`]);
    expect(errors(compile('.a { rotate: z 30deg; }'))).toEqual([`DRAGON_UNSUPPORTED_VALUE "z" rotate: z is unsupported: a rotation axis turns the box out of the plane: ${M}`]);
    expect(errors(compile('.a { scale: 1 1 2; }'))).toEqual([`DRAGON_UNSUPPORTED_VALUE "2" scale: 2 is unsupported: a z scale is a 3D transform: ${M}`]);
    // scale applies before transform, so a non-uniform scale then a rotation skews; a rotation before it does not.
    expect(errors(compile('.a { scale: 2 1; transform: rotate(30deg); }'))).toEqual([
      'DRAGON_UNSUPPORTED_VALUE "rotate(30deg)" the translate, rotate, scale and transform of a compose to a rotation after a non-uniform scale, which skews the box: Android\'s View transform cannot express it (package PNT2-m)',
    ]);
    expect(errors(compile('.a { scale: 2 1; rotate: 30deg; }'))).toEqual([]);
    expect(errors(compile('.a { scale: 2 1; transform: rotate(90deg); }'))).toEqual([]);
  });
});
