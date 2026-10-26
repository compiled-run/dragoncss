// FORM-b: a textarea compiles as Chrome 145's UA shadow tree, a placeholder and an inner editor at the content top, sized by cols
// and rows (controls.ts textAreaInlineSize) and laid out by the engine. Refused on iOS and Android: the resizer grip, a scrollbar
// gutter, overflow: visible and an editable textarea; everywhere: an element child.
import { describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic } from 'dragon';
import * as dragon from 'dragon';
import { ahemMeasurer, layout as engineLayout } from '@dragon/layout';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { withFontMapAssets } from '../src/fixture-groups/fonts.ts';
import { FONT_REFERENCE_MAP } from '../src/font-reference.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';

const page = (css: string, body: string, base: string): string => `<!DOCTYPE html>
<html data-dragon-id="html">
<head>
<style>
body { margin: 0; font-family: Ahem; font-size: 10px; }
${base}
${css}
</style>
</head>
<body data-dragon-id="body">
${body}
</body>
</html>
`;

/** Every textarea here devolves to CSS by its author border, has no grip and no gutter, except where a test passes its own base rule. */
const BASE = 'textarea { display: block; font: inherit; appearance: none; margin: 0; border: 2px solid #036; padding: 1px 2px; resize: none; scrollbar-width: none; }';

function compile(id: string, css: string, body: string, base = BASE, fonts = false): Compiled<'ios' | 'android' | 'web'> {
  const project = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, ...(fonts ? { fonts: FONT_REFERENCE_MAP } : {}) }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem' });
  const input = fixtureToInput(id, page(css, body, base));
  return project.compile(fonts ? withFontMapAssets(input, FONT_REFERENCE_MAP) : input);
}

const errors = (c: Compiled<string>): string[] => c.diagnostics.filter((d: Diagnostic) => d.severity === 'error').map((d) => `${d.target ?? 'all'} ${d.code} ${d.message}`);

/** The engine's border boxes of a compile's first case, in CSS px relative to the parent box, by id. */
function boxes(c: Compiled<string>): Map<string, { x: number; y: number; width: number; height: number }> {
  const p = dragon.engineLayoutProjection(c, ENVIRONMENT, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const r = engineLayout(p.input, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return new Map(r.boxes.map((b) => [b.id, { x: b.x / 64, y: b.y / 64, width: b.width / 64, height: b.height / 64 }]));
}

describe('FORM-b textareas', () => {
  it('lays out a readonly textarea: cols x the advance of 0 wide, rows lines tall, its parts at the content top', () => {
    const c = compile('ta-basic', '', '<textarea data-dragon-id="t" readonly="" cols="3" rows="3">XX</textarea>');
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    expect(b.get('t')).toMatchObject({ width: 38, height: 36 });
    expect(b.get('t::editor')).toMatchObject({ x: 4, y: 3, width: 30, height: 10 });
  });

  it('defaults to 20 cols and 2 rows, and sizes by rows whatever the value', () => {
    const b = boxes(compile('ta-default', '', '<textarea data-dragon-id="t" readonly="">XX\nXX\nXX\nXX</textarea>'));
    expect(b.get('t')).toMatchObject({ width: 208, height: 26 });
  });

  it('puts the placeholder at the content top and leaves an empty editor lineless, beside a placeholder or not', () => {
    const b = boxes(compile('ta-placeholder', '', '<textarea data-dragon-id="p" readonly="" placeholder="PP"></textarea>\n<textarea data-dragon-id="e" readonly=""></textarea>\n<textarea data-dragon-id="v" readonly="" placeholder="PP">X</textarea>'));
    expect(b.get('p::placeholder')).toMatchObject({ y: 3, height: 10 });
    expect(b.get('p::editor')?.height).toBe(0);
    expect(b.get('e::editor')?.height).toBe(0);
    expect(b.has('v::placeholder')).toBe(false);
  });

  it('gives an empty textarea no baseline, with or without a placeholder, so a baseline-aligned flex row uses its border box bottom', () => {
    // Chrome 145: A sits at y 18 beside an empty textarea (26px tall, A's baseline 8px down), and at 3 beside one with a value.
    const row = (id: string, attrs: string, value: string): string => `<div data-dragon-id="${id}" class="f"><div data-dragon-id="${id}-a">A</div><textarea data-dragon-id="${id}-t" readonly=""${attrs}>${value}</textarea></div>`;
    const c = compile('ta-baseline', '.f { display: flex; align-items: baseline; }', [row('e', '', ''), row('p', ' placeholder="PP"', ''), row('v', '', 'XX')].join('\n'));
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    expect(b.get('e-a')?.y).toBe(18);
    expect(b.get('p-a')?.y).toBe(18);
    expect(b.get('v-a')?.y).toBe(3);
  });

  it('refuses a grip, a scrollbar gutter, overflow: visible and editing on iOS and Android', () => {
    const base = 'textarea { display: block; font: inherit; appearance: none; margin: 0; border: 2px solid #036; padding: 1px 2px; }';
    expect(errors(compile('ta-chrome', 'textarea { scrollbar-width: none; }', '<textarea data-dragon-id="t" readonly=""></textarea>', base))).toEqual([
      expect.stringMatching(/^android DRAGON_UNSUPPORTED_VALUE the scroll container t has resize both, so Chrome draws a resizer/),
      expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE the scroll container t has resize both/),
    ]);
    expect(errors(compile('ta-gutter', 'textarea { scrollbar-width: auto; }', '<textarea data-dragon-id="t" readonly=""></textarea>'))).toEqual([
      expect.stringMatching(/^android DRAGON_UNSUPPORTED_VALUE <textarea> t reserves a scrollbar gutter/),
      expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <textarea> t reserves a scrollbar gutter/),
    ]);
    expect(errors(compile('ta-gutter-hidden', 'textarea { scrollbar-width: auto; overflow: hidden; }', '<textarea data-dragon-id="t" readonly=""></textarea>'))).toEqual([]);
    expect(errors(compile('ta-visible', 'textarea { overflow: visible; }', '<textarea data-dragon-id="t" readonly=""></textarea>'))).toEqual([
      expect.stringMatching(/^android DRAGON_UNSUPPORTED_VALUE overflow: visible on <textarea> t/),
      expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE overflow: visible on <textarea> t/),
    ]);
    expect(errors(compile('ta-edit', '', '<textarea data-dragon-id="t">XX</textarea>'))).toEqual([
      expect.stringMatching(/^android DRAGON_UNSUPPORTED_VALUE <textarea> t is an editable text control/),
      expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <textarea> t is an editable text control/),
    ]);
  });
});
