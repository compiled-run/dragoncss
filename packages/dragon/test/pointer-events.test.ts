// SELD-R1b (notes/T047-runtime-spec.md RT-9): pointer-events is a longhand appended after grid, inherited, with no layout or
// paint aspect; auto and none compile, the SVG values are refused through the support profile, and the hit facts carry the
// computed value, whether it was inherited, and the activation handler of a and button.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, POINTER_LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { GRID_LONGHANDS } from '../src/css/properties/grid.ts';
import { EFFECTS_LONGHANDS } from '../src/css/properties/effects.ts';
import { RADIUS_LONGHANDS } from '../src/css/properties/radius.ts';
import { SHADOW_LONGHANDS } from '../src/css/properties/shadow.ts';
import { TRANSFORM_LONGHANDS } from '../src/css/properties/transform.ts';
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
  it('follows grid before the paint families, inherited, with no layout or paint aspect, and webref\'s grammar', () => {
    expect([...POINTER_LONGHANDS]).toEqual(['pointer-events']);
    // The paint families register after it in registry order: PNT1's radius first, then PNT1's shadow and effects, then PNT2's
    // transform.
    expect(LONGHANDS[LONGHANDS.indexOf('pointer-events') - 1]).toBe(GRID_LONGHANDS[GRID_LONGHANDS.length - 1]);
    expect(LONGHANDS.indexOf(RADIUS_LONGHANDS[0])).toBe(LONGHANDS.indexOf('pointer-events') + 1);
    expect(LONGHANDS.indexOf(SHADOW_LONGHANDS[0])).toBe(LONGHANDS.indexOf('pointer-events') + 1 + RADIUS_LONGHANDS.length);
    expect(LONGHANDS.indexOf(EFFECTS_LONGHANDS[0])).toBe(LONGHANDS.indexOf(SHADOW_LONGHANDS[0]) + SHADOW_LONGHANDS.length);
    expect(LONGHANDS.indexOf(TRANSFORM_LONGHANDS[0])).toBeGreaterThan(LONGHANDS.indexOf(RADIUS_LONGHANDS[3]));
    expect(LONGHANDS.indexOf(TRANSFORM_LONGHANDS[0])).toBe(LONGHANDS.indexOf(EFFECTS_LONGHANDS[0]) + EFFECTS_LONGHANDS.length);
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

  it('compiles border-radius (PNT1) and leaves the hit facts unchanged; the hit lane refuses a rounded case by name (parity hit-report.test)', () => {
    const plain = project().compile(inputFor('.a { pointer-events: none; }', tree));
    const c = project().compile(inputFor('.a { pointer-events: none; border-radius: 4px; }', tree));
    expect(c.diagnostics.map((d) => d.code)).not.toContain('DRAGON_UNSUPPORTED_PROPERTY');
    expect(c.outputs.web.kind).toBe('ready');
    expect(hitFacts(c, [])).toEqual(hitFacts(plain, []));
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
