// The fragmentation family (css-break-3): break-before, break-after, break-inside, orphans and widows, appended after the counters,
// with the legacy page-break-* and -webkit-column-break-* shorthands. Dragon lays out no fragmentation context, so it accepts every
// value Chrome 145 parses, on every target, and web output writes them only on cases that set them.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS, SHORTHANDS } from '../src/css/properties.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE, UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { valueToString } from '../src/analysis/resolve.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Targets } from '../src/types.ts';
import { div, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/fragmentation.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

/** The diagnostic codes and the longhands as [property, value] a declaration parses to. */
function parse(name: string, value: string) {
  const css = `.a { ${name}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const longhands = (rules[0]?.declarations[0]?.longhands ?? []).map((l) => [l.property, valueToString(l.value)]);
  return { codes: diagnostics.map((d) => d.code), longhands };
}

function compile(css: string, targets: Targets = { web: {} }) {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

function webText(css: string): string {
  const out = compile(css).outputs.web;
  if (out.kind !== 'ready') throw new Error(out.kind);
  return (out.files[0] as { text: string }).text;
}

describe('fragmentation', () => {
  it('registers five longhands after the counters and six legacy shorthands, with no layout or paint aspect', () => {
    expect(LONGHANDS.slice(-5)).toEqual(['break-before', 'break-after', 'break-inside', 'orphans', 'widows']);
    expect(SHORTHANDS.slice(-6)).toEqual(['page-break-before', 'page-break-after', 'page-break-inside', '-webkit-column-break-before', '-webkit-column-break-after', '-webkit-column-break-inside']);
    for (const p of ['break-before', 'break-after', 'break-inside', 'orphans', 'widows'] as const) expect(PROPERTY_ASPECTS[p], p).toEqual({ layout: false, paint: false });
    expect(['orphans', 'widows'].every((p) => INHERITED.has(p as never))).toBe(true);
    expect(['break-before', 'break-after', 'break-inside'].some((p) => INHERITED.has(p as never))).toBe(false);
    expect([ANIMATION_KINDS['break-before'], ANIMATION_KINDS['break-inside'], ANIMATION_KINDS['orphans']]).toEqual([DISCRETE, DISCRETE, UNADMITTED]);
    expect(grammar['orphans']).toEqual({ syntax: '<any-value>', initial: '2', inherited: 'yes' });
  });

  it("accepts Chrome's break keywords in any case and drops the rest", () => {
    for (const v of ['auto', 'avoid', 'avoid-column', 'avoid-page', 'column', 'left', 'page', 'recto', 'right', 'verso']) expect(parse('break-before', v), v).toEqual({ codes: [], longhands: [['break-before', v]] });
    expect(parse('break-after', 'Page')).toEqual({ codes: [], longhands: [['break-after', 'page']] });
    expect(parse('break-inside', 'AVOID-column')).toEqual({ codes: [], longhands: [['break-inside', 'avoid-column']] });
    for (const v of ['always', 'all', 'region', 'avoid-region', 'page page', '1']) expect(parse('break-before', v).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    for (const v of ['page', 'column', 'left']) expect(parse('break-inside', v).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    for (const v of ['inherit', 'initial', 'unset', 'var(--x)']) expect(parse('break-inside', v).codes, v).toEqual([]);
  });

  it('maps the legacy shorthands as Chrome does: always is page or column, avoid stays avoid', () => {
    expect(parse('page-break-before', 'always').longhands).toEqual([['break-before', 'page']]);
    expect(parse('page-break-after', 'ALWAYS').longhands).toEqual([['break-after', 'page']]);
    expect(parse('page-break-after', 'left').longhands).toEqual([['break-after', 'left']]);
    expect(parse('page-break-inside', 'avoid').longhands).toEqual([['break-inside', 'avoid']]);
    expect(parse('-webkit-column-break-before', 'always').longhands).toEqual([['break-before', 'column']]);
    expect(parse('-webkit-column-break-after', 'avoid').longhands).toEqual([['break-after', 'avoid']]);
    expect(parse('-webkit-column-break-inside', 'auto').longhands).toEqual([['break-inside', 'auto']]);
    for (const [p, v] of [['page-break-before', 'page'], ['page-break-inside', 'always'], ['-webkit-column-break-before', 'column'], ['-webkit-column-break-before', 'left'], ['-webkit-column-break-inside', 'avoid-column']]) expect(parse(p as string, v as string).codes, `${p}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('reads orphans and widows as a positive integer, rounding and clamping a calculation and the computed value as Chrome does', () => {
    expect(parse('orphans', '3').longhands).toEqual([['orphans', '3']]);
    expect(parse('widows', '1').longhands).toEqual([['widows', '1']]);
    expect(parse('orphans', '10000000000').longhands).toEqual([['orphans', '32767']]);
    expect(parse('orphans', 'calc(1.5)').longhands).toEqual([['orphans', '2']]);
    expect(parse('widows', 'calc(0)').longhands).toEqual([['widows', '1']]);
    expect(parse('widows', 'calc(-1)').longhands).toEqual([['widows', '1']]);
    for (const v of ['0', '-1', '1.5', 'auto', '2 2', 'calc(1px)']) expect(parse('orphans', v).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('compiles on every target, and web output writes them only where a case sets them', () => {
    const c = compile('.a { break-inside: avoid; page-break-after: always; orphans: 3; widows: 4; }', NATIVE);
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const set = webText('.a { break-inside: avoid; page-break-after: always; orphans: 3; }');
    expect(set).toContain('break-inside: avoid');
    expect(set).toContain('break-after: page');
    expect(set).toContain('orphans: 3');
    expect(set).toContain('widows: 2');
    const unset = webText('.a { color: red; }');
    expect(unset).not.toMatch(/break-|orphans|widows/);
  });
});
