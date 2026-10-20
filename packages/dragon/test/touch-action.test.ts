// touch-action (pointerevents-3 §10.2): a longhand appended after line-clamp, not inherited, with no layout or paint aspect. Chrome
// 145 parses auto, none, manipulation, or one keyword of each of the x, y and pinch-zoom groups in any order, and serializes the
// computed flags in x, y, pinch-zoom order, with pan-x pan-y pinch-zoom as manipulation. Native compiles a value that stops a pan
// direction unless a native scroll view on or around the box scrolls on that axis, or the box is or holds an iframe.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { LINE_CLAMP_LONGHANDS } from '../src/css/properties/line-clamp.ts';
import { CLIP_RECT_LONGHANDS } from '../src/css/properties/clip-rect.ts';
import { TOUCH_ACTION_LONGHANDS, touchActionPans } from '../src/css/properties/touch-action.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { ElementNode, Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/ta.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(value: string): Diagnostic[] {
  const css = `.a { touch-action: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return diagnostics;
}

function compile(css: string, targets: Targets = { web: {} }, tag = 'div', childTag = 'div') {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [{ ...div(r, 'a', ['a'], [{ ...div(r, 'b', ['b'], [text(r, 't', 'XX')]), tag: childTag } as ElementNode]), tag } as ElementNode]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

const errors = (c: ReturnType<typeof compile>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');

describe('touch-action: registry and parse', () => {
  it('follows line-clamp and precedes clip, not inherited, with no layout or paint aspect, discrete, initial auto', () => {
    expect([...TOUCH_ACTION_LONGHANDS]).toEqual(['touch-action']);
    expect(LONGHANDS[LONGHANDS.indexOf('touch-action') - 1]).toBe(LINE_CLAMP_LONGHANDS[LINE_CLAMP_LONGHANDS.length - 1]);
    // FAMILIES runs line-clamp, touch-action, clip-rect (properties.ts).
    expect(LONGHANDS[LONGHANDS.indexOf('touch-action') + 1]).toBe(CLIP_RECT_LONGHANDS[0]);
    expect(INHERITED.has('touch-action')).toBe(false);
    expect(PROPERTY_ASPECTS['touch-action']).toEqual({ layout: false, paint: false });
    expect(ANIMATION_KINDS['touch-action']).toBe(DISCRETE);
    expect(grammar['touch-action']?.initial).toBe('auto');
  });

  it('parses what TouchAction::ParseSingleValue takes, in any case, and the CSS-wide keywords; the rest is invalid', () => {
    for (const v of ['auto', 'none', 'manipulation', 'pan-x', 'pan-left', 'pan-right', 'pan-y', 'pan-up', 'pan-down', 'pinch-zoom', 'pan-y pan-x', 'pinch-zoom pan-up pan-left', 'PAN-X Pinch-Zoom', 'inherit', 'initial', 'unset', 'revert']) expect(parse(v), v).toEqual([]);
    for (const v of ['auto none', 'none pan-x', 'manipulation pan-x', 'pan-x pan-left', 'pan-up pan-down', 'pinch-zoom pinch-zoom', 'pan', 'pan-x 1px', 'double-tap-zoom']) expect(parse(v).map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('allows the pan directions its flags set', () => {
    expect([...touchActionPans('auto')]).toEqual(['left', 'right', 'up', 'down']);
    expect([...touchActionPans('none')]).toEqual([]);
    expect([...touchActionPans('pan-left pan-y')]).toEqual(['left', 'up', 'down']);
    expect([...touchActionPans('pan-right pinch-zoom')]).toEqual(['right']);
  });
});

describe('touch-action: computed values', () => {
  for (const [css, a, b] of [
    ['.a { touch-action: manipulation; }', 'manipulation', 'auto'],
    ['.a { touch-action: pan-y pan-x; } .b { touch-action: inherit; }', 'pan-x pan-y', 'pan-x pan-y'],
    ['.a { touch-action: PINCH-ZOOM pan-y pan-x; } .b { touch-action: pan-x pan-y; }', 'manipulation', 'pan-x pan-y'],
    ['.a { touch-action: none; } .b { touch-action: unset; }', 'none', 'auto'],
    ['.a { --t: pan-down pan-left; touch-action: var(--t); } .b { touch-action: initial; }', 'pan-left pan-down', 'auto'],
  ] as const) {
    it(`${css} computes ${a} and ${b}`, () => {
      const c = compile(css);
      expect(errors(c)).toEqual([]);
      expect(explainOne(c, 'web', 'a', 'touch-action').value).toBe(a);
      expect(explainOne(c, 'web', 'b', 'touch-action').value).toBe(b);
    });
  }
});

describe('touch-action on native', () => {
  const taErrors = (c: ReturnType<typeof compile>): Diagnostic[] => errors(c).filter((d) => d.message.includes('touch-action'));

  it('auto, manipulation and pan-x pan-y, with or without pinch-zoom, compile on every target, inside a scroll container too', () => {
    for (const v of ['auto', 'manipulation', 'pan-x pan-y', 'pan-y pan-x pinch-zoom']) {
      for (const css of [`.a { touch-action: ${v}; }`, `.a { overflow: auto; height: 5px; } .b { touch-action: ${v}; }`]) {
        const c = compile(css, NATIVE);
        expect(errors(c), css).toEqual([]);
        expect(c.outputs.ios.kind, css).not.toBe('blocked');
        expect(c.outputs.android.kind, css).not.toBe('blocked');
      }
    }
  });

  it('a value that stops a pan direction compiles on native where no native scroll view is around the box: the native root never scrolls', () => {
    for (const v of ['none', 'pinch-zoom', 'pan-y', 'pan-x', 'pan-up pan-x', 'pan-left pan-down']) {
      const c = compile(`.a { touch-action: ${v}; } .b { touch-action: ${v}; }`, NATIVE);
      expect(errors(c), v).toEqual([]);
      expect(c.outputs.ios.kind, v).not.toBe('blocked');
      expect(c.outputs.android.kind, v).not.toBe('blocked');
    }
  });

  it('overflow the viewport takes (html, else body) makes no native scroll view, so none compiles under it', () => {
    for (const css of ['body { overflow: auto; } .a { touch-action: none; }', 'html { overflow: scroll; } .a { touch-action: none; }']) expect(taErrors(compile(css, NATIVE)), css).toEqual([]);
  });

  it('a body that scrolls because html took the viewport overflow is a native scroll view, so none under it is refused', () => {
    const errs = taErrors(compile('html { overflow: hidden; } body { overflow: auto; } .a { touch-action: none; }', NATIVE));
    expect(errs.map((d) => [d.code, d.target]).sort()).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
    expect(errs.find((d) => d.target === 'ios')?.message).toBe('a has touch-action none, so Chrome stops a pan that starts on it from scrolling the scroll container body in any direction; ios scroll views pan in every direction they scroll, so Dragon compiles a touch-action that stops a pan direction only where native pans nothing in that direction');
  });

  it('a value that stops a direction on an axis a scroll view around the box scrolls is refused on ios and android, at the declaration, and compiles for web', () => {
    for (const [overflow, v, computed, how] of [
      ['overflow: auto', 'none', 'none', 'in any direction'],
      ['overflow: auto', 'pinch-zoom', 'pinch-zoom', 'in any direction'],
      ['overflow-x: scroll; overflow-y: hidden', 'pan-y', 'pan-y', 'in the directions it leaves out'],
      ['overflow-x: hidden; overflow-y: auto', 'pan-x', 'pan-x', 'in the directions it leaves out'],
      ['overflow-x: hidden; overflow-y: auto', 'pan-up pan-x', 'pan-x pan-up', 'in the directions it leaves out'],
      ['overflow-x: auto; overflow-y: hidden', 'pan-right pan-y', 'pan-right pan-y', 'in the directions it leaves out'],
    ] as const) {
      const css = `.a { ${overflow}; height: 5px; } .b { touch-action: ${v}; }`;
      const c = compile(css, NATIVE);
      const errs = errors(c);
      expect(errs.map((d) => [d.code, d.target]).sort(), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs.find((d) => d.target === 'ios')?.message, css).toBe(`b has touch-action ${computed}, so Chrome stops a pan that starts on it from scrolling the scroll container a ${how}; ios scroll views pan in every direction they scroll, so Dragon compiles a touch-action that stops a pan direction only where native pans nothing in that direction`);
      expect(errs[0]?.origin.kind, css).toBe('authored');
      expect(c.outputs.web.kind, css).toBe('ready');
      expectCatalogued(errs);
    }
  });

  it('a value that stops only the axis the scroll views around it do not scroll compiles', () => {
    for (const css of [
      '.a { overflow-x: hidden; overflow-y: auto; height: 5px; } .b { touch-action: pan-y; }',
      '.a { overflow-x: auto; overflow-y: hidden; } .b { touch-action: pan-x; }',
      '.a { overflow-x: auto; overflow-y: clip; } .b { touch-action: pan-x pinch-zoom; }',
      '.a { overflow: hidden; height: 5px; } .b { touch-action: none; }',
    ]) expect(taErrors(compile(css, NATIVE)), css).toEqual([]);
  });

  it('a scroll container\'s own touch-action limits its own pans, and refuses where it stops an axis it scrolls', () => {
    expect(taErrors(compile('.a { overflow-x: auto; overflow-y: hidden; touch-action: pan-x; }', NATIVE))).toEqual([]);
    const errs = taErrors(compile('.a { overflow-x: auto; overflow-y: hidden; touch-action: pan-y; }', NATIVE));
    expect(errs.length).toBe(2);
    expect(errs[0]?.message).toContain('from scrolling itself in the directions it leaves out');
  });

  it('Chrome resets pan restrictions at a scroll container, so none on a box around one compiles', () => {
    expect(taErrors(compile('.a { touch-action: none; } .b { overflow: auto; height: 5px; }', NATIVE))).toEqual([]);
  });

  it('the scroll container named is the nearest one whose pans the value stops', () => {
    const c = compile('body { overflow: hidden; } .a { overflow-x: auto; overflow-y: hidden; } .b { overflow-x: hidden; overflow-y: auto; height: 5px; touch-action: pan-y; }', NATIVE);
    expect(taErrors(c).find((d) => d.target === 'android')?.message).toContain('from scrolling the scroll container a in the directions it leaves out; android scroll views pan');
  });

  it('a box that is or holds an iframe refuses a value that stops a pan, as the iframe\'s web view pans its document', () => {
    const own = taErrors(compile('.a { display: block; touch-action: none; }', NATIVE, 'iframe'));
    expect(own.length).toBe(2);
    expect(own.find((d) => d.target === 'ios')?.message).toContain('from scrolling the document of its iframe in any direction; ios web views pan');
    const held = taErrors(compile('.a { touch-action: pan-y; }', NATIVE, 'div', 'iframe'));
    expect(held.length).toBe(2);
    expect(held[0]?.message).toContain('from scrolling the document of an iframe in the directions it leaves out');
  });

  it('an inherited none inside a scroll container is refused on the child that inherits it too', () => {
    const c = compile('html { overflow: hidden; } body { overflow: auto; } .a { touch-action: none; } .b { touch-action: inherit; }', NATIVE);
    expect(taErrors(c).map((d) => d.message.slice(0, 24)).sort()).toEqual(['a has touch-action none,', 'a has touch-action none,', 'b has touch-action none,', 'b has touch-action none,']);
  });

  it('Chrome ignores it on a non-replaced inline box, a table row, display contents or none, so native compiles it there', () => {
    for (const css of ['.a { display: inline; touch-action: none; } .b { display: inline; }', '.a { display: contents; touch-action: none; }', '.a { display: none; touch-action: pan-y; }', '.a { display: table-row; touch-action: none; }']) {
      expect(taErrors(compile(`html { overflow: hidden; } body { overflow: auto; } ${css}`, NATIVE)), css).toEqual([]);
    }
  });

  it('Chrome ignores it on an inline <iframe>, which it does not count as replaced here, so native compiles it there', () => {
    expect(taErrors(compile('.a { display: inline; touch-action: none; }', NATIVE, 'iframe'))).toEqual([]);
  });

  it('Chrome keeps it on a table header or footer group, an inline-block and a replaced inline box, so native refuses none there inside a scroll view', () => {
    const scroller = 'html { overflow: hidden; } body { overflow: auto; }';
    for (const d of ['table-header-group', 'table-footer-group', 'inline-block']) {
      expect(taErrors(compile(`${scroller} .a { display: ${d}; touch-action: none; }`, NATIVE)).length, d).toBe(2);
    }
    expect(taErrors(compile(`${scroller} .a { touch-action: none; }`, NATIVE, 'img')).length).toBe(2);
  });
});
