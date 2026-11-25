// FORM-b: a textarea compiles as Chrome 145's UA shadow tree, a placeholder and an inner editor at the content top, sized by cols
// and rows (controls.ts textAreaInlineSize) and laid out by the engine. Its resize compiles on iOS and Android, which draw no grip,
// and so does the scrollbar thickness Chrome adds to its default size. Refused there: overflow: visible and an editable textarea;
// everywhere: an element child.
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

  it('adds the platform scrollbar thickness Chrome adds to the default size, on iOS and Android too', () => {
    // Chrome 145 (macOS overlay scrollbars, no gutter): 16 DIP at scrollbar-width auto, 14 at thin, to the inline size unless
    // overflow-y is hidden or clip, and to the height at overflow-x: scroll. BASE's border and padding add 8 x 6.
    const sized = (id: string, css: string): { width: number; height: number } | undefined => {
      const c = compile(id, `textarea { ${css} }`, '<textarea data-dragon-id="t" readonly="" cols="5" rows="3"></textarea>');
      expect(errors(c), css).toEqual([]);
      return boxes(c).get('t');
    };
    expect(sized('ta-sb-none', 'scrollbar-width: none')).toMatchObject({ width: 58, height: 36 });
    expect(sized('ta-sb-auto', 'scrollbar-width: auto')).toMatchObject({ width: 74, height: 36 });
    expect(sized('ta-sb-thin', 'scrollbar-width: thin')).toMatchObject({ width: 72, height: 36 });
    expect(sized('ta-sb-hidden', 'scrollbar-width: auto; overflow: hidden')).toMatchObject({ width: 58, height: 36 });
    expect(sized('ta-sb-clip', 'scrollbar-width: thin; overflow-y: clip; overflow-x: hidden')).toMatchObject({ width: 58, height: 36 });
    expect(sized('ta-sb-scroll', 'scrollbar-width: auto; overflow-x: scroll')).toMatchObject({ width: 74, height: 52 });
    expect(sized('ta-sb-scroll-y-hidden', 'scrollbar-width: thin; overflow-x: scroll; overflow-y: hidden')).toMatchObject({ width: 58, height: 50 });
    expect(sized('ta-sb-width', 'scrollbar-width: auto; overflow-x: scroll; width: 30px; height: 20px')).toMatchObject({ width: 38, height: 26 });
  });

  it('compiles the UA grip, and refuses overflow: visible and editing on iOS and Android', () => {
    const base = 'textarea { display: block; font: inherit; appearance: none; margin: 0; border: 2px solid #036; padding: 1px 2px; }';
    // The UA's resize: both compiles: a phone has no resizer (resize.test.ts).
    expect(errors(compile('ta-chrome', 'textarea { scrollbar-width: none; }', '<textarea data-dragon-id="t" readonly=""></textarea>', base))).toEqual([]);
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
