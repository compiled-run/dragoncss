// The legacy -webkit-box properties (properties/flex.ts LEGACY_BOX_PROPERTIES): Chrome 145 reads them only under display -webkit-box
// and -webkit-inline-box, which Dragon refuses, so each accepts Chrome's grammar and sets nothing.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { SHORTHANDS } from '../src/css/properties.ts';
import { LEGACY_BOX_PROPERTIES } from '../src/css/properties/flex.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { div, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/legacy-box.css', revision: 'r1', hash: 'sha256:0' };

function declare(property: string, value: string): { declaration: Declaration | null; diagnostics: Diagnostic[] } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics };
}

/** Every value Chrome 145 parses for each property (Blink CSSParserFastPaths and ParseSingleValue), and some it drops. */
const VALID: { readonly [P in (typeof LEGACY_BOX_PROPERTIES)[number]]: readonly string[] } = {
  '-webkit-box-align': ['stretch', 'start', 'center', 'end', 'baseline', 'CENTER'],
  '-webkit-box-direction': ['normal', 'reverse'],
  '-webkit-box-flex': ['0', '1', '2.5', '-1', 'calc(1 + 1)'],
  '-webkit-box-ordinal-group': ['1', '2', '10'],
  '-webkit-box-orient': ['horizontal', 'vertical', 'inline-axis', 'block-axis'],
  '-webkit-box-pack': ['start', 'center', 'end', 'justify'],
};
const INVALID: readonly (readonly [string, string])[] = [
  ['-webkit-box-align', 'flex-start'], ['-webkit-box-align', 'center center'], ['-webkit-box-direction', 'row'],
  ['-webkit-box-flex', '1px'], ['-webkit-box-flex', 'auto'], ['-webkit-box-ordinal-group', '0'], ['-webkit-box-ordinal-group', '1.5'],
  ['-webkit-box-orient', 'column'], ['-webkit-box-pack', 'space-between'], ['-webkit-box-pack', 'stretch'],
];

describe('legacy -webkit-box properties', () => {
  it('are surrogate shorthands of the flex family that set no longhand', () => {
    for (const p of LEGACY_BOX_PROPERTIES) expect(SHORTHANDS, p).toContain(p);
  });
  it("accept Chrome 145's values and the CSS-wide keywords, and set nothing", () => {
    for (const [p, values] of Object.entries(VALID)) {
      for (const v of [...values, 'inherit', 'initial', 'unset', 'revert', 'revert-layer']) {
        const { declaration, diagnostics } = declare(p, v);
        expect(diagnostics, `${p}: ${v}`).toEqual([]);
        expect(declaration?.longhands, `${p}: ${v}`).toEqual([]);
      }
    }
  });
  it('drop values Chrome 145 does not parse, as DRAGON_CSS_INVALID_VALUE', () => {
    for (const [p, v] of INVALID) {
      const { declaration, diagnostics } = declare(p, v);
      expect(declaration, `${p}: ${v}`).toBeNull();
      expect(diagnostics.map((d) => d.code), `${p}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    }
  });
  it('leave the web and iOS outputs byte-identical to the same flex container without them', () => {
    const project = () => createProject({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' } } });
    const tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])];
    const outputs = (css: string): string[] => {
      const c = project().compile(inputFor(css, tree));
      expect(c.diagnostics, css).toEqual([]);
      return (['web', 'ios'] as const).flatMap((t) => {
        const o = c.outputs[t];
        return o.kind === 'ready' ? o.files.map((f) => `${f.path}\n${f.text.split('\n').filter((l) => !/compilation [0-9a-f]{64}/.test(l)).join('\n')}`) : [`${t} ${o.kind}`];
      });
    };
    const base = '.a { display: flex; width: 100px; font-family: Ahem; font-size: 10px; } .b { width: 20px; }';
    const legacy = '.a { display: flex; width: 100px; font-family: Ahem; font-size: 10px; -webkit-box-orient: vertical; -webkit-box-direction: reverse; -webkit-box-pack: center; -webkit-box-align: end; } .b { width: 20px; -webkit-box-flex: 1; -webkit-box-ordinal-group: 2; }';
    expect(outputs(legacy)).toEqual(outputs(base));
  });
});
