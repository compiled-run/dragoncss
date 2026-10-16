// touch-action (pointerevents-3 §10.2): a longhand appended after line-clamp, not inherited, with no layout or paint aspect. Chrome
// 145 parses auto, none, manipulation, or one keyword of each of the x, y and pinch-zoom groups in any order, and serializes the
// computed flags in x, y, pinch-zoom order, with pan-x pan-y pinch-zoom as manipulation. Native compiles a value that allows every
// pan direction and refuses any other where Chrome applies it.
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

function compile(css: string, targets: Targets = { web: {} }, tag = 'div') {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [{ ...div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])]), tag } as ElementNode]);
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
  it('auto, manipulation and pan-x pan-y, with or without pinch-zoom, compile on every target', () => {
    for (const v of ['auto', 'manipulation', 'pan-x pan-y', 'pan-y pan-x pinch-zoom']) {
      const c = compile(`.a { touch-action: ${v}; }`, NATIVE);
      expect(errors(c), v).toEqual([]);
      expect(c.outputs.ios.kind, v).not.toBe('blocked');
      expect(c.outputs.android.kind, v).not.toBe('blocked');
    }
  });

  it('a value that stops a pan direction is refused on ios and android, at the declaration, and compiles for web', () => {
    for (const [v, computed, how] of [['none', 'none', 'in any direction'], ['pinch-zoom', 'pinch-zoom', 'in any direction'], ['pan-y', 'pan-y', 'in the directions it leaves out'], ['pan-up pan-x', 'pan-x pan-up', 'in the directions it leaves out']] as const) {
      const c = compile(`.a { touch-action: ${v}; }`, NATIVE);
      const errs = errors(c);
      expect(errs.map((d) => [d.code, d.target]).sort(), v).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs.find((d) => d.target === 'ios')?.message, v).toBe(`a has touch-action ${computed}, so Chrome stops a pan that starts on it from scrolling ${how}; ios views pan in every direction, so Dragon compiles touch-action at auto, manipulation or pan-x pan-y only`);
      expect(c.outputs.web.kind, v).toBe('ready');
      expectCatalogued(errs);
    }
  });

  it('an inherited none is refused on the child that inherits it too', () => {
    const c = compile('.a { touch-action: none; } .b { touch-action: inherit; }', NATIVE);
    expect(errors(c).map((d) => d.message.slice(0, 24)).sort()).toEqual(['a has touch-action none,', 'a has touch-action none,', 'b has touch-action none,', 'b has touch-action none,']);
  });

  it('Chrome ignores it on a non-replaced inline box, a table row, display contents or none, so native compiles it there', () => {
    for (const css of ['.a { display: inline; touch-action: none; } .b { display: inline; }', '.a { display: contents; touch-action: none; }', '.a { display: none; touch-action: pan-y; }', '.a { display: table-row; touch-action: none; }']) {
      expect(errors(compile(css, NATIVE)).filter((d) => d.message.includes('touch-action')), css).toEqual([]);
    }
  });

  it('an inline-block or a replaced inline box with none is refused', () => {
    expect(errors(compile('.a { display: inline-block; touch-action: none; }', NATIVE)).length).toBe(2);
    expect(errors(compile('.a { touch-action: none; }', NATIVE, 'img')).filter((d) => d.message.includes('touch-action')).length).toBe(2);
  });
});
