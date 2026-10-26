// The canvas background (analysis/paint-values/canvas.ts): html's background, or body's when html's is none, paints the canvas.
// The native targets draw it in html's box view and the root view; the cases whose Chrome canvas does not equal that plan are
// refused natively and drawn on the web. The pixels are pinned against Chrome 145 by the canvas-gradient-* fixtures (parity
// bg2-reference.test.ts and the device records).
import { describe, expect, it } from 'vitest';
import type { BackgroundWrite } from '../src/lower/paint/background.ts';
import type { GradientWrite } from '../src/lower/paint/gradient.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { div, inputFor } from './helpers.ts';

const TARGETS = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } as const;
const compile = (css: string) => createProjectWith({ projectId: 'test', targets: TARGETS }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [div(r, 'a', ['box'])]));
const GRADIENT = 'linear-gradient(180deg, rgb(30, 60, 200), rgb(240, 120, 40))';
const BODY = (extra = ''): string => `body { margin: 0; min-height: 100vh; background: rgb(250, 250, 255) ${GRADIENT} no-repeat; ${extra} } .box { height: 40px; }`;

/** The error diagnostics of a page: target and message. */
const errors = (css: string): string[] => compile(css).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.target} ${d.message}`).sort();
const targetsOf = (out: readonly string[]): string[] => out.map((m) => m.split(' ')[0] as string);

/** The writes of html and body in a compiled page's program for a target. */
function writes(css: string, target: 'android-views' | 'uikit' = 'android-views'): { html: readonly { kind: string }[]; body: readonly { kind: string }[] } {
  const p = nativePrograms(compile(css), []);
  if (p.kind !== 'ready') throw new Error(`no native programs: ${p.reason}`);
  const of = (id: string) => {
    const n = p.programs[target].nodes.find((x) => x.id === id);
    if (n === undefined) throw new Error(`${id}: no node`);
    return n.writes as readonly { kind: string }[];
  };
  return { html: of('html'), body: of('body') };
}
const colorOf = (ws: readonly { kind: string }[]) => (ws.find((w) => w.kind === 'background-color') as BackgroundWrite | undefined)?.color;
const layersOf = (ws: readonly { kind: string }[]) => ws.find((w) => w.kind === 'background-layers') as GradientWrite | undefined;

describe('canvas source (css-backgrounds-3 §2.11.2)', () => {
  it('body propagates when html has no background: html carries body colour and layers, body paints none', () => {
    expect(errors(BODY())).toEqual([]);
    for (const target of ['android-views', 'uikit'] as const) {
      const w = writes(BODY(), target);
      expect(colorOf(w.html)).toEqual({ r: 250, g: 250, b: 255, alpha: 255 });
      expect(colorOf(w.body)?.alpha).toBe(0);
      expect(layersOf(w.body)).toBeUndefined();
      const l = layersOf(w.html);
      if (l === undefined || l.kind === 'mask-layer') throw new Error('html: no background-layers write');
      expect(l.layers.length).toBe(1);
      expect(l.color).toEqual({ r: 250, g: 250, b: 255, alpha: 255 });
      expect(l.colorClip).toBe('border-box');
    }
  });
  it('a body colour alone propagates too (fx-backdrop-canvas)', () => {
    const w = writes('body { margin: 0; background-color: rgb(0, 0, 255); }');
    expect(colorOf(w.html)).toEqual({ r: 0, g: 0, b: 255, alpha: 255 });
    expect(colorOf(w.body)?.alpha).toBe(0);
  });
  it('html with its own colour keeps it, and body paints its gradient as an ordinary box, repeat included', () => {
    const css = `html { background-color: rgb(236, 240, 245); } body { margin: 12px; height: 120px; background-image: ${GRADIENT}; }`;
    expect(errors(css)).toEqual([]);
    const w = writes(css);
    expect(colorOf(w.html)).toEqual({ r: 236, g: 240, b: 245, alpha: 255 });
    expect(layersOf(w.html)).toBeUndefined();
    expect(layersOf(w.body)).toBeDefined();
  });
  it('html with its own image paints the canvas, and body keeps its colour', () => {
    const css = `html { background: rgb(255, 250, 240) radial-gradient(circle at 30% 40%, rgb(255, 0, 0), rgb(0, 0, 255)) 0 0 / 100% 100% no-repeat; } body { margin: 20px; height: 80px; background-color: rgb(0, 160, 0); }`;
    expect(errors(css)).toEqual([]);
    const w = writes(css);
    expect(layersOf(w.html)).toBeDefined();
    expect(colorOf(w.body)).toEqual({ r: 0, g: 160, b: 0, alpha: 255 });
  });
});

describe('native refusals of the canvas background (accepted on the web)', () => {
  const refused = (css: string, text: string): void => {
    // html's own opacity and filter are refused natively by the effect checks too (PNT1-opacity-b, PNT1-filter).
    const out = errors(css);
    expect(targetsOf(out.filter((m) => m.includes(text)))).toEqual(['android', 'ios']);
    expect(targetsOf(out)).not.toContain('web');
  };
  it('a repeating layer: the canvas tiles beyond the root box (the old reject-gradient-root, a body repeat gradient)', () => {
    refused(`body { margin: 0; background-image: ${GRADIENT}; }`, 'background-repeat on body');
  });
  it('a layer away from position 0, or sized in px or beyond 100%', () => {
    refused(BODY('background-position: 10px 0;'), 'background-position-x on body');
    refused(BODY('background-position: 0 50%;'), 'background-position-y on body');
    refused(BODY('background-size: 200px 100px;'), 'sized in px');
    refused(BODY('background-size: 120% 100%;'), 'at 120%');
  });
  it('html with margin, padding or border', () => {
    refused(`html { margin: 4px; } ${BODY()}`, 'has a margin-top');
    refused(`html { padding-left: 2px; } ${BODY()}`, 'has a padding-left');
    refused(`html { border: 1px solid black; } ${BODY()}`, 'has a border');
  });
  it('html hidden, translucent or filtered, under layers or a colour', () => {
    refused(`html { opacity: 0.5; } ${BODY()}`, '<html> has opacity 0.5');
    refused(`html { visibility: hidden; } ${BODY()}`, '<html> has visibility: hidden, and Chrome paints the canvas');
    refused(`html { filter: grayscale(1); } ${BODY()}`, '<html> has a filter');
    refused('html { opacity: 0.5; } body { background-color: rgb(0, 0, 255); }', '<html> has opacity 0.5');
  });
  it('a translucent canvas colour', () => {
    refused('body { background-color: rgba(0, 0, 255, 0.5); }', 'a translucent colour on <body> is the canvas background');
  });
  it('background-attachment: fixed stays refused, for every target at once', () => {
    const out = errors(BODY('background-attachment: fixed;'));
    expect(out.length).toBe(1);
    expect(out[0]).toMatch(/^null .*background-attachment/);
  });
  it('a body whose background does not propagate is checked as an ordinary box', () => {
    expect(errors(`html { background-color: white; } body { margin: 8px; height: 100px; background-color: rgb(200, 200, 200); background-image: ${GRADIENT}; background-repeat: no-repeat; background-size: 50px 40px; background-position: 4px 0; }`)).toEqual([]);
  });
});
