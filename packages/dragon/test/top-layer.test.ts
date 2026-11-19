// A modal <dialog> and its ::backdrop in the top layer (css-position-4 §3), the host presenting it: the position Chrome 145 computes
// for them, where they are laid out and their paint order. Every expected value was read from the pinned Chrome with showModal().
import { describe, expect, it } from 'vitest';
import type { LayoutRect } from '@dragon/layout';
import { layout, measurerFor, REFERENCE_PLATFORM } from '@dragon/layout';
import type { ElementNode, SourceRef } from '../src/index.ts';
import { createProjectWith, nativeProgramFor, NO_FAULTS, programInput } from '../src/internal.ts';
import { div, inputFor } from './helpers.ts';

const dialog = (ref: SourceRef, id: string, classes: string[]): ElementNode => ({ ...div(ref, id, classes), tag: 'dialog' });
const compile = (css: string) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', hostTopLayer: true }).compile(inputFor(css, (r) => [div(r, 's', ['s']), dialog(r, 'd', ['d'])]));
const errors = (css: string): string[] => compile(css).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);

function program(css: string) {
  const c = compile(css);
  expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
  const p = nativeProgramFor(c, [], 'ios');
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.program;
}

/** Each box's border box in CSS px from the viewport origin. */
function boxes(css: string): Map<string, [number, number, number, number]> {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(m.detail);
  const out = layout(programInput(program(css), { width: 400, height: 300 }, 1), m.measurer);
  if (out.kind !== 'ok') throw new Error(JSON.stringify(out));
  const at = new Map<string, LayoutRect>(out.boxes.map((b) => [b.id, b]));
  const origin = (id: string | null): [number, number] => {
    const b = id === null ? undefined : at.get(id);
    if (b === undefined) return [0, 0];
    const [x, y] = origin(b.parent);
    return [x + b.x / 64, y + b.y / 64];
  };
  return new Map(out.boxes.map((b) => [b.id, [...origin(b.id), b.width / 64, b.height / 64]]));
}

describe('the position of a top-layer box', () => {
  const box = 'margin: 0; padding: 0; border: 0; width: 50px; height: 20px;';
  for (const pos of ['static', 'relative', 'sticky']) {
    it(`position: ${pos} lays the dialog out absolutely at the initial containing block, as Chrome does`, () => {
      // Chrome: the dialog at (0, 0) 50x20 and html 100px tall, with position absolute.
      const b = boxes(`html { margin-top: 50px; } body { margin: 0; } .s { height: 100px; } .d { display: block; position: ${pos}; ${box} }`);
      expect(b.get('d')).toEqual([0, 0, 50, 20]);
      expect(b.get('html')).toEqual([0, 50, 400, 100]);
    });
  }

  it('a static ::backdrop and an inline, floated dialog are laid out as Chrome computes them: absolute, block, unfloated', () => {
    const css = `body { margin: 0; } .d { display: inline; float: left; position: static; ${box} } .d::backdrop { position: static; display: inline; }`;
    const b = boxes(css);
    expect(b.get('d')).toEqual([0, 0, 50, 20]);
    expect(b.get('d::backdrop')).toEqual([0, 0, 400, 300]);
  });

  it('refuses by name a top-layer box Dragon would place against a positioned root, where Chrome uses the initial containing block', () => {
    // Chrome: the dialog at (0, 0); Dragon would put it at the root's padding box, 50px down.
    for (const pos of ['static', 'absolute']) {
      expect(errors(`html { position: relative; margin-top: 50px; } body { margin: 0; } .d { position: ${pos}; ${box} }`)).toEqual([
        "the top-layer box d is position: absolute while the root html is positioned or contained: Chrome places it against the initial containing block, Dragon would place it against the root's padding box",
      ]);
    }
    expect(errors(`html { position: relative; margin-top: 50px; } body { margin: 0; } .d { position: fixed; ${box} }`)).toEqual([]);
  });

  it('refuses by name a top-layer box with auto insets, whose static position Chrome puts at the initial containing block', () => {
    // Chrome: (0, 0) for absolute, fixed and static alike, with html 50px down and 7px of padding.
    for (const pos of ['absolute', 'fixed']) {
      expect(errors(`html { margin: 50px 0 0 30px; padding: 7px; } body { margin: 0; } .s { height: 100px; } .d { inset: auto; position: ${pos}; ${box} }`)).toEqual([
        "left and right, and top and bottom are auto on the top-layer box d: Chrome places it at the initial containing block's start corner, Dragon would place it after the root's contents",
      ]);
    }
  });
});

describe('the paint order of the top layer', () => {
  const order = (css: string): string[] => {
    const p = program(`body { margin: 0; } .s { height: 100px; background: blue; } .d { position: fixed; inset: 0 auto auto 0; margin: 0; padding: 0; border: 0; width: 50px; height: 20px; background: red; } ${css}`);
    const key = (id: string): [number, number] => {
      const w = p.nodes.find((n) => n.id === id)?.writes.find((x) => x.kind === 'paint-order') as { host: string; bucket: number; rank: number } | undefined;
      if (w === undefined || w.host !== 'html') throw new Error(`${id} is not a layer item of html`);
      return [w.bucket, w.rank];
    };
    return ['s', 'd::backdrop', 'd'].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
  };
  // Chrome paints the dialog's red over the z-index 10 box in all three, and over a fixed box at the largest z-index.
  it('paints the backdrop and dialog over a positive z-index in the page, whatever their own z-index', () => {
    expect(order('.s { position: relative; z-index: 10; }')).toEqual(['s', 'd::backdrop', 'd']);
    expect(order('.s { position: relative; z-index: 10; } .d { z-index: -5; }')).toEqual(['s', 'd::backdrop', 'd']);
    expect(order('.s { position: fixed; top: 0; z-index: 2147483647; }')).toEqual(['s', 'd::backdrop', 'd']);
  });
});
