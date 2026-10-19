// appearance (css-ui-4 §7.1): a longhand appended after the mask family, not inherited, painting nothing on any
// supported tag, discrete, initial none, with -webkit-appearance its alias. Dragon accepts none, auto and the compat keywords in any
// case and refuses every other keyword, so it never drops one Chrome keeps; web output writes it only where it is not none.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { MASK_LONGHANDS } from '../src/css/properties/mask.ts';
import { APPEARANCE_KEYWORDS, APPEARANCE_LONGHANDS, APPEARANCE_REFUSED } from '../src/css/properties/appearance.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { resolveAlias } from '../src/css/aliases.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Targets } from '../src/types.ts';
import { div, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/ap.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(value: string, name = 'appearance') {
  const css = `.a { ${name}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const lh = rules[0]?.declarations[0]?.longhands[0];
  return { codes: diagnostics.map((d) => d.code), value: lh?.value.kind === 'keyword' ? lh.value.value : null, diagnostics };
}

function compile(css: string, targets: Targets = { web: {} }) {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

describe('appearance: registry and parse', () => {
  it('follows the mask family, last, not inherited, with a layout aspect and no paint aspect, discrete, initial none', () => {
    expect([...APPEARANCE_LONGHANDS]).toEqual(['appearance']);
    expect(LONGHANDS[LONGHANDS.indexOf('appearance') - 1]).toBe(MASK_LONGHANDS[MASK_LONGHANDS.length - 1]);
    expect(LONGHANDS[LONGHANDS.length - 1]).toBe('appearance');
    expect(INHERITED.has('appearance')).toBe(false);
    expect(PROPERTY_ASPECTS.appearance).toEqual({ layout: true, paint: false });
    expect(ANIMATION_KINDS.appearance).toBe(DISCRETE);
    expect(grammar.appearance?.initial).toBe('none');
    expect(grammar.appearance?.syntax).toBe('<any-value>');
    expect(resolveAlias('-webkit-appearance')).toBe('appearance');
  });

  it('accepts none, auto and the compat keywords in any case, from either name, computed in lower case', () => {
    expect(APPEARANCE_KEYWORDS).toEqual(['none', 'auto', 'searchfield', 'textarea', 'checkbox', 'radio', 'menulist', 'listbox', 'meter', 'progress-bar', 'button', 'textfield', 'menulist-button']);
    for (const k of APPEARANCE_KEYWORDS) {
      for (const name of ['appearance', '-webkit-appearance', 'APPEARANCE']) {
        for (const v of [k, k.toUpperCase()]) expect(parse(v, name), `${name}: ${v}`).toMatchObject({ codes: [], value: k });
      }
    }
    for (const v of ['inherit', 'initial', 'unset', 'revert', 'var(--x)']) expect(parse(v).codes, v).toEqual([]);
  });

  it('refuses base-select and slider-vertical, which Chrome keeps, and drops every other keyword and a value that is not one keyword', () => {
    expect(APPEARANCE_REFUSED).toEqual(['base-select', 'slider-vertical']);
    for (const v of ['base-select', 'slider-vertical', 'Slider-Vertical']) {
      const p = parse(v);
      expect(p.codes, v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      expect(p.diagnostics[0]?.message, v).toContain(`appearance: ${v.toLowerCase()} is unsupported`);
    }
    for (const v of ['base', 'push-button', 'square-button', 'slider-horizontal', 'inner-spin-button', 'media-slider', 'sliderthumb-horizontal', 'searchfield-cancel-button', 'bogus']) expect(parse(v).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    for (const v of ['none auto', 'none none', '1px', '"none"', 'none, none']) expect(parse(v).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parse('push-button', '-webkit-appearance').codes).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parse('slider-vertical', '-webkit-appearance').codes).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
  });
});

describe('appearance: compile', () => {
  it('compiles every accepted keyword on every target without a diagnostic of its own', () => {
    for (const k of APPEARANCE_KEYWORDS) {
      const c = compile(`.a { appearance: ${k}; } .b { -webkit-appearance: ${k}; }`, NATIVE);
      expect(c.diagnostics.filter((d) => d.severity === 'error' && d.message.includes('appearance')), k).toEqual([]);
    }
  });

  it('refuses appearance other than none on display inline, inline-table, list-item and table, which Chrome adjusts', () => {
    const refusals = (c: ReturnType<typeof compile>) => c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes('appearance'));
    for (const [display, adjusted] of [['inline', 'inline-block'], ['inline-table', 'inline-block'], ['list-item', 'block'], ['table', 'block']]) {
      const c = compile(`.b { display: ${display}; appearance: button; }`, NATIVE);
      expect(refusals(c).map((d) => d.target).sort(), display).toEqual(['android', 'ios', 'web']);
      expect(refusals(c)[0]?.message, display).toContain(`which Chrome turns into display ${adjusted}`);
      expect(refusals(compile(`.b { display: ${display}; appearance: none; }`, NATIVE)), display).toEqual([]);
    }
    for (const display of ['block', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'flow-root']) expect(refusals(compile(`.b { display: ${display}; -webkit-appearance: auto; }`, NATIVE)), display).toEqual([]);
  });

  it('writes appearance in web output only where it is not none', () => {
    const css = (c: ReturnType<typeof compile>): string => {
      const out = c.outputs.web;
      if (out.kind !== 'ready') throw new Error(out.kind);
      return (out.files[0] as { text: string }).text;
    };
    const none = css(compile('.a { appearance: none; } .b { -webkit-appearance: NONE; }'));
    expect(none).not.toContain('appearance');
    const some = css(compile('.a { appearance: button; }'));
    expect(some.split('  appearance: ').length - 1).toBe(1);
    expect(some).toContain('  appearance: button;');
  });
});
