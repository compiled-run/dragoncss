// css-writing-modes-4 in horizontal-tb: writing-mode accepts only the values Chrome 145 computes to horizontal-tb, text-orientation
// and text-combine-upright are inert, and every vertical value is refused (properties/writing-mode.ts, shorthands/writing-mode.ts).
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { LONGHANDS, SHORTHANDS } from '../src/css/properties.ts';
import { HORIZONTAL_WRITING_MODES, WRITING_MODE_RESET_LONGHANDS } from '../src/css/properties/writing-mode.ts';
import { SHORTHAND_HANDLERS } from '../src/css/shorthands/index.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { div, expectCatalogued, inputFor, spanTextOf, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/wm.css', revision: 'r1', hash: 'sha256:0' };

function declare(property: string, value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; span: string | null } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const d = diagnostics[0];
  const span = d !== undefined && d.origin.kind === 'authored' ? css.slice(d.origin.span.start, d.origin.span.end) : null;
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, span };
}

/** Every writing-mode keyword the grammar accepts: webref's five and the six SVG 1.1 values (css-writing-modes-4 Appendix B). */
const KEYWORDS = (grammar['writing-mode']?.syntax ?? '').split('|').map((s) => s.trim());
const VERTICAL = KEYWORDS.filter((k) => !(HORIZONTAL_WRITING_MODES as readonly string[]).includes(k));

describe('writing-mode family: registry', () => {
  it('the three properties are surrogate shorthands that set no longhand, appended after background and logical, before grid', () => {
    const at = SHORTHANDS.indexOf('writing-mode');
    expect(SHORTHANDS.slice(at, at + 3)).toEqual(['writing-mode', 'text-orientation', 'text-combine-upright']);
    expect(SHORTHANDS.indexOf('background')).toBeLessThan(at);
    expect(SHORTHANDS.indexOf('grid-template')).toBeGreaterThan(at);
    for (const p of ['writing-mode', 'text-orientation', 'text-combine-upright'] as const) {
      expect((LONGHANDS as readonly string[]).includes(p), p).toBe(false);
      expect(SHORTHAND_HANDLERS[p].longhands).toEqual([]);
    }
    expect(WRITING_MODE_RESET_LONGHANDS).toEqual({ 'writing-mode': 'horizontal-tb' });
  });
  it('the grammar is webref plus the SVG 1.1 legacy values, and the accepted set is exactly the horizontal ones', () => {
    expect(KEYWORDS).toEqual(['horizontal-tb', 'vertical-rl', 'vertical-lr', 'sideways-rl', 'sideways-lr', 'lr', 'lr-tb', 'rl', 'rl-tb', 'tb', 'tb-rl']);
    expect([...HORIZONTAL_WRITING_MODES]).toEqual(['horizontal-tb', 'lr', 'lr-tb', 'rl', 'rl-tb']);
    expect(VERTICAL).toEqual(['vertical-rl', 'vertical-lr', 'sideways-rl', 'sideways-lr', 'tb', 'tb-rl']);
  });
});

describe('writing-mode family: parse', () => {
  for (const v of [...HORIZONTAL_WRITING_MODES, 'LR-TB', 'Horizontal-TB', '\\68 orizontal-tb', 'l\\r']) {
    it(`writing-mode: ${v} is accepted and sets nothing`, () => {
      const { declaration, diagnostics } = declare('writing-mode', v);
      expect(diagnostics).toEqual([]);
      expect(declaration?.property).toBe('writing-mode');
      expect(declaration?.longhands).toEqual([]);
    });
  }
  // An escaped keyword is matched, and named in the message, by its decoded value (css-syntax-3 §4.3.7).
  const DECODED: Readonly<Record<string, string>> = { '\\76 ertical-rl': 'vertical-rl', '\\74 b-rl': 'tb-rl' };
  for (const v of [...VERTICAL, 'Vertical-RL', ...Object.keys(DECODED)]) {
    it(`writing-mode: ${v} is DRAGON_UNSUPPORTED_VALUE on the value`, () => {
      const { declaration, diagnostics, span } = declare('writing-mode', v);
      expect(declaration).toBeNull();
      expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      expect(span).toBe(v);
      expect((diagnostics[0] as Diagnostic).message).toBe(`writing-mode: ${DECODED[v] ?? v} is unsupported: Dragon lays out horizontal-tb only`);
      expectCatalogued(diagnostics);
    });
  }
  it('CSS-wide keywords are accepted on all three and set nothing', () => {
    for (const p of ['writing-mode', 'text-orientation', 'text-combine-upright']) {
      for (const wide of ['inherit', 'initial', 'unset', 'revert', 'revert-layer']) {
        const { declaration, diagnostics } = declare(p, wide);
        expect(diagnostics, `${p}: ${wide}`).toEqual([]);
        expect(declaration?.longhands, `${p}: ${wide}`).toEqual([]);
      }
    }
  });
  it('text-orientation accepts mixed, upright and sideways, inert in horizontal-tb', () => {
    for (const v of ['mixed', 'upright', 'sideways']) {
      const { declaration, diagnostics } = declare('text-orientation', v);
      expect(diagnostics, v).toEqual([]);
      expect(declaration?.longhands, v).toEqual([]);
    }
  });
  it('text-combine-upright accepts none and all, and refuses digits, which Chrome 145 does not parse', () => {
    for (const v of ['none', 'all']) expect(declare('text-combine-upright', v).diagnostics, v).toEqual([]);
    for (const v of ['digits', 'digits 2', 'digits 4']) {
      const { declaration, diagnostics, span } = declare('text-combine-upright', v);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      expect(span, v).toBe('digits');
      expect((diagnostics[0] as Diagnostic).message).toBe(`text-combine-upright: ${v} is unsupported: Chrome 145 does not parse digits`);
    }
  });
  it('values outside the grammar stay DRAGON_CSS_INVALID_VALUE', () => {
    for (const [p, v] of [['writing-mode', 'vertical'], ['writing-mode', 'lr tb'], ['text-orientation', 'sideways-right'], ['text-combine-upright', 'digits 5']] as const) {
      expect(declare(p, v).diagnostics.map((d) => d.code), `${p}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    }
  });
});

describe('writing-mode family: compile', () => {
  const project = () => createProject({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' } } });
  const tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', ['a'], [text(r, 't', 'XX XX')])];
  const outputs = (css: string): string[] => {
    const c = project().compile(inputFor(css, tree));
    expect(c.diagnostics, css).toEqual([]);
    const files = (['web', 'ios'] as const).flatMap((t) => {
      const o = c.outputs[t];
      return o.kind === 'ready' ? o.files.map((f) => `${f.path}\n${f.text.split('\n').filter((l) => !/compilation [0-9a-f]{64}/.test(l)).join('\n')}`) : [`${t} ${o.kind}`];
    });
    return files;
  };
  it('the accepted values leave both outputs byte-identical to the same element without them', () => {
    const base = outputs('.a { width: 50px; font-family: Ahem; font-size: 10px; }');
    for (const extra of ['writing-mode: rl;', 'writing-mode: lr-tb; text-orientation: upright; text-combine-upright: all;', 'text-orientation: sideways; writing-mode: inherit;']) {
      expect(outputs(`.a { width: 50px; ${extra} font-family: Ahem; font-size: 10px; }`), extra).toEqual(base);
    }
  });
  it('a vertical value blocks both targets with DRAGON_UNSUPPORTED_VALUE on the value', () => {
    const input = inputFor('.a { writing-mode: vertical-rl; width: 20px; }', tree);
    const c = project().compile(input);
    expect(c.ok).toBe(false);
    expect(c.outputs.web.kind).toBe('blocked');
    expect(c.outputs.ios.kind).toBe('blocked');
    const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE') as Diagnostic;
    expect(spanTextOf(input, d)).toBe('vertical-rl');
    expectCatalogued(c.diagnostics);
  });
  // Substitution runs per longhand winner and writing-mode sets none, so a var() value could never be checked: it is refused.
  for (const [css, value] of [
    ['.a { --wm: vertical-rl; writing-mode: var(--wm); width: 20px; }', 'var(--wm)'],
    ['.a { writing-mode: var(--none, vertical-lr); width: 20px; }', 'var(--none, vertical-lr)'],
    ['.a { --wm: horizontal-tb; writing-mode: var(--wm); width: 20px; }', 'var(--wm)'],
    ['.a { --t: all; text-combine-upright: var(--t); width: 20px; }', 'var(--t)'],
  ] as const) {
    it(`${css} blocks both targets with DRAGON_UNSUPPORTED_VALUE on the var() value`, () => {
      const input = inputFor(css, tree);
      const c = project().compile(input);
      expect(c.outputs.web.kind).toBe('blocked');
      expect(c.outputs.ios.kind).toBe('blocked');
      const refused = c.diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(refused.map((d) => spanTextOf(input, d))).toEqual([value]);
      expectCatalogued(c.diagnostics);
    });
  }
  it('text-orientation, which refuses no value, stays inert through var()', () => {
    expect(outputs('.a { --o: upright; width: 50px; text-orientation: var(--o); font-family: Ahem; font-size: 10px; }'))
      .toEqual(outputs('.a { --o: upright; width: 50px; font-family: Ahem; font-size: 10px; }'));
  });
});

// The parity dual lane on the committed Chrome 145 capture (the live Chrome check is packages/parity/test/writing-mode-computed.test.ts).
describe('writing-mode family: the parity dual lane', () => {
  const load = async <T>(file: string): Promise<T> => (await import(new URL(`../../parity/src/${file}`, import.meta.url).href)) as T;

  it('the parity dual lane catches the planted handler: authored vertical-rl against the compiled horizontal-tb', async () => {
    const { compareDual } = await load<{ compareDual: (a: unknown, c: unknown, colors: ReadonlyMap<string, unknown>, text: ReadonlyMap<string, unknown>, extra: readonly string[]) => { pass: boolean; problems: readonly string[] } }>('dual.ts');
    const { readFileSync } = await import('node:fs');
    const committed = JSON.parse(readFileSync(new URL('../../parity/expected/darwin-arm64/writing-mode-horizontal.web.json', import.meta.url), 'utf8')) as { nodes: { id: string; computed: Record<string, string> | null }[] };
    const extra = Object.keys(WRITING_MODE_RESET_LONGHANDS);
    expect(compareDual(committed, committed, new Map(), new Map(), extra).problems.filter((p) => p.includes('writing-mode'))).toEqual([]);
    // What Chrome renders when the planted handler lets vertical-rl through: the authored page computes it; the compiled page drops it.
    const planted = structuredClone(committed);
    const a1 = planted.nodes.find((n) => n.id === 'a1') as { computed: Record<string, string> };
    a1.computed['writing-mode'] = 'vertical-rl';
    expect(compareDual(planted, committed, new Map(), new Map(), extra).problems).toContain('a1: writing-mode authored "vertical-rl" compiled "horizontal-tb" Dragon "horizontal-tb"');
  });
});
