// TXT-FSA (docs/research/font-size-adjust.md): font-size-adjust, none only. Chrome lays text out at an adjusted size under any
// other value, which the engine has no input for, so every other value Chrome parses is refused on every target, and what Chrome
// drops is invalid. The font shorthand resets it to none, and the web output never writes it. The Chrome cases are
// text-font-size-adjust-ahem and the parse matrix in packages/parity/test/font-size-adjust.test.ts.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/font-size-adjust.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, or its diagnostic codes. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

const project = () =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** The compilation of Ahem text under the declaration. */
const compiled = (decl: string) => {
  const css = `body { font-family: Ahem; font-size: 10px; } .h { ${decl}; width: 50px; }`;
  return project().compile(inputFor(css, (r) => [el(r, 'a', 'div', ['h'], [text(r, 't', 'XX XX XX')])]));
};
const errorsAt = (decl: string): string[] => compiled(decl).diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();

/** A parse-time refusal, which holds for every target. */
const REFUSED = ['null DRAGON_UNSUPPORTED_VALUE'];

describe('font-size-adjust (css-fonts-5 §2.6)', () => {
  it('parses none in any case and the CSS-wide keywords', () => {
    expect(parsed('font-size-adjust: none')).toEqual(['font-size-adjust: none']);
    expect(parsed('font-size-adjust: NONE')).toEqual(['font-size-adjust: none']);
    for (const k of ['inherit', 'initial', 'unset']) expect(parsed(`font-size-adjust: ${k}`)).toEqual([`font-size-adjust: ${k}`]);
  });

  it('refuses every other value Chrome parses: a number, from-font, and either after a metric keyword', () => {
    for (const v of ['0.5', '0', '1.2', 'from-font', 'ex-height 0.5', 'cap-height 0.7', 'ch-width from-font', 'ic-width 1', 'ic-height 1', 'calc(0.5)', 'ex-height calc(0.5)', 'calc(-1)']) {
      expect(parsed(`font-size-adjust: ${v}`), v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    }
  });

  it('drops what Chrome drops: a negative number, a metric keyword alone, two numbers, a length', () => {
    for (const v of ['-1', 'ex-height', '0.5 0.5', '0.5 ex-height', '10px', 'auto']) expect(parsed(`font-size-adjust: ${v}`), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('compiles none on every target and refuses a number on every target', () => {
    expect(errorsAt('font-size-adjust: none')).toEqual([]);
    expect(errorsAt('font-size-adjust: inherit')).toEqual([]);
    expect(errorsAt('font-size-adjust: 0.5')).toEqual(REFUSED);
  });

  it('the font shorthand resets it to none, after the settings', () => {
    expect(parsed('font: 12px x').slice(-3)).toEqual(['font-feature-settings: normal', 'font-variation-settings: normal', 'font-size-adjust: none']);
  });

  it('the web output never writes it', () => {
    const c = compiled('font-size-adjust: none');
    const web = c.outputs.web;
    expect(web.kind).toBe('ready');
    if (web.kind !== 'ready') return;
    const css = web.files.map((f) => f.text ?? '').join('\n');
    expect(css).toContain('hyphens: manual');
    expect(css).not.toContain('font-size-adjust');
  });
});
