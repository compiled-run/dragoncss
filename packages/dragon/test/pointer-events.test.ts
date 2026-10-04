// SELD-R1b (notes/T047-runtime-spec.md RT-9): pointer-events is a longhand appended after grid, inherited, with no layout or
// paint aspect; auto and none compile, the SVG values are refused through the support profile, and the hit facts carry the
// computed value, whether it was inherited, and the activation handler of a and button.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, POINTER_LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { GRID_LONGHANDS } from '../src/css/properties/grid.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { ACTIVATION_TAGS, hitFacts } from '../src/internal.ts';
import { div, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/pe.css', revision: 'r1', hash: 'sha256:0' };

function parse(value: string): Diagnostic[] {
  const css = `.a { pointer-events: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return diagnostics;
}

describe('pointer-events: registry', () => {
  it('is the longhand after grid, inherited, with no layout or paint aspect, and webref\'s grammar', () => {
    expect([...POINTER_LONGHANDS]).toEqual(['pointer-events']);
    // It follows the grid family; PNT2's transform family, a paint family registered last, comes after it.
    expect(LONGHANDS[LONGHANDS.indexOf(GRID_LONGHANDS[GRID_LONGHANDS.length - 1] as (typeof LONGHANDS)[number]) + 1]).toBe('pointer-events');
    expect(INHERITED.has('pointer-events')).toBe(true);
    expect(PROPERTY_ASPECTS['pointer-events']).toEqual({ layout: false, paint: false });
    expect(grammar['pointer-events']?.initial).toBe('auto');
    expect(grammar['pointer-events']?.syntax).toContain('visiblePainted');
  });

  it('parses every grammar keyword and the CSS-wide keywords, and refuses other values as invalid', () => {
    for (const v of ['auto', 'none', 'visiblePainted', 'bounding-box', 'all', 'inherit', 'initial', 'unset']) expect(parse(v), v).toEqual([]);
    for (const v of ['hidden', '1px', 'auto none']) expect(parse(v).map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
});

describe('pointer-events: compile and hit facts', () => {
  const project = () => createProject({ projectId: 'test', targets: { web: {} } });
  const tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])];

  it('compiles auto and none on web and writes them into every rule', () => {
    const c = project().compile(inputFor('.a { pointer-events: none; } .b { pointer-events: auto; }', tree));
    const web = c.outputs.web;
    expect(web.kind).toBe('ready');
    const css = web.kind === 'ready' ? (web.files[0]?.text ?? '') : '';
    expect(css).toContain('pointer-events: none;');
    expect(css).toContain('pointer-events: auto;');
  });

  it('refuses the SVG values with DRAGON_UNSUPPORTED_VALUE on the value', () => {
    for (const v of ['visiblePainted', 'all', 'bounding-box', 'fill']) {
      const c = project().compile(inputFor(`.a { pointer-events: ${v}; }`, tree));
      expect(c.outputs.web.kind, v).toBe('blocked');
      expect(c.diagnostics.map((d) => d.code), v).toContain('DRAGON_UNSUPPORTED_VALUE');
    }
  });

  it('keeps border-radius refused, so no rounded box reaches the hit table (which also refuses one loudly)', () => {
    const c = project().compile(inputFor('.a { border-radius: 4px; }', tree));
    expect(c.diagnostics.map((d) => d.code)).toContain('DRAGON_UNSUPPORTED_PROPERTY');
  });

  it('carries the computed value, its inheritance and the activation handler', () => {
    const c = project().compile(inputFor('.a { pointer-events: none; }', tree));
    const facts = hitFacts(c, []);
    expect(facts?.get('a')).toEqual({ pointerEvents: 'none', inherited: false, activation: false });
    expect(facts?.get('b')).toEqual({ pointerEvents: 'none', inherited: true, activation: false });
    for (const [id, f] of facts ?? []) if (id !== 'a' && id !== 'b') expect(f.pointerEvents, id).toBe('auto');
    expect([...ACTIVATION_TAGS]).toEqual(['a', 'button']);
    expect(hitFacts({}, [])).toBeNull();
  });
});
