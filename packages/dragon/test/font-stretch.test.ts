// TXT-FONTFEAT: font-stretch parses as Chrome parses it and computes to a percentage; the font shorthand sets it from a width keyword;
// any width compiles over Ahem text (one face at 100%, which Chrome draws at every width) and a width other than 100% is refused
// over a real face. The Chrome case is text-font-stretch-ahem (packages/parity/fixtures); font-stretch-parse.test.ts pins the grammar.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ElementNode, FontMap, FrontEndResult, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import type { ResolvedValue } from '../src/analysis/computed.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { computeFontStretch } from '../src/css/properties/font-stretch.ts';
import type { Longhand } from '../src/css/properties.ts';
import type { CssValue } from '../src/css/values.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/font-stretch.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, or its diagnostic codes. */
function parsed(value: string): string[] {
  const css = `.a { font-stretch: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

const vendor = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../vendor/fonts/${file}`, import.meta.url)));
const LATO = vendor('Lato/Lato-Regular.ttf');
const MAP: FontMap = { generics: {}, families: { Lato: { mode: 'pinned', family: 'Lato', faces: [{ src: 'fonts/Lato-Regular.ttf', weight: '400' }] } } } as unknown as FontMap;
const withLato = (base: FrontEndResult): FrontEndResult => ({
  ...base,
  snapshot: { ...base.snapshot, assets: [{ id: 'fonts/Lato-Regular.ttf', hash: `sha256:${createHash('sha256').update(LATO).digest('hex')}`, bytes: LATO }] },
});

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

function compile(family: string, decl: string, faults: CompilerFaults = NO_FAULTS) {
  const css = `body { font-family: ${family}; font-size: 10px; } .s { ${decl}; }`;
  const p = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, fonts: MAP }, { faults, profiles: 'derive', direction: 'ltr' });
  return p.compile(withLato(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'Ab Cd')])])])));
}

/** Each error as `<target> <code>`, native's own Lato refusal aside. */
const errorsAt = (family: string, decl: string, faults: CompilerFaults = NO_FAULTS): string[] =>
  compile(family, decl, faults).diagnostics.filter((d) => d.severity === 'error' && d.code !== 'DRAGON_UNSUPPORTED_FONT').map((d) => `${String(d.target)} ${d.code}`).sort();

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('font-stretch', () => {
  it('parses a width keyword or a non-negative percentage, and refuses a calculation', () => {
    expect(parsed('condensed')).toEqual(['font-stretch: condensed']);
    expect(parsed('ULTRA-EXPANDED')).toEqual(['font-stretch: ultra-expanded']);
    expect(parsed('75%')).toEqual(['font-stretch: 75%']);
    expect(parsed('0%')).toEqual(['font-stretch: 0%']);
    for (const v of ['-10%', '75', 'wide', 'condensed expanded', '10px']) expect(parsed(v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parsed('calc(50% + 25%)')).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
  });

  it('computes a keyword to its percentage, normal to 100%, and keeps a percentage', () => {
    const computed = (value: CssValue): string => {
      const props = new Map<Longhand, ResolvedValue>([['font-stretch', { value, origin: 'author' } as unknown as ResolvedValue]]);
      computeFontStretch(props);
      return valueToString((props.get('font-stretch') as ResolvedValue).value);
    };
    expect(computed({ kind: 'keyword', value: 'normal' })).toBe('100%');
    expect(computed({ kind: 'keyword', value: 'condensed' })).toBe('75%');
    expect(computed({ kind: 'keyword', value: 'extra-condensed' })).toBe('62.5%');
    expect(computed({ kind: 'keyword', value: 'ultra-expanded' })).toBe('200%');
    expect(computed({ kind: 'percentage', value: 33 })).toBe('33%');
  });

  it('compiles at every width over Ahem text on every target', () => {
    for (const d of ['font-stretch: condensed', 'font-stretch: 50%', 'font-stretch: ultra-expanded', 'font: expanded 10px Ahem', 'font-stretch: normal']) expect(errorsAt('Ahem', d), d).toEqual([]);
  });

  it('is refused at a width other than 100% over a real face on every target', () => {
    expect(errorsAt('Lato', 'font-stretch: condensed')).toEqual(REFUSED);
    expect(errorsAt('Lato', 'font: expanded 10px Lato')).toEqual(REFUSED);
    for (const d of ['font-stretch: normal', 'font-stretch: 100%', 'font: 10px Lato']) expect(errorsAt('Lato', d), d).toEqual([]);
  });

  it('plant fontStretchOnRealFaceAccepted: a width over a real face compiles', () => {
    expect(errorsAt('Lato', 'font-stretch: condensed', { ...NO_FAULTS, fontStretchOnRealFaceAccepted: true })).toEqual([]);
  });
});
