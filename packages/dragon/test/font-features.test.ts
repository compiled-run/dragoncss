// TXT-FONTFEAT: font-feature-settings and font-variation-settings parse as Chrome parses them, the font shorthand resets both, and a
// non-normal setting compiles over Ahem text (a face with no OpenType features or axes, where Chrome draws the same glyphs) and is
// refused over a real face. The Chrome case is text-font-features-ahem (packages/parity/fixtures); font-features-parse.test.ts pins the grammar.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ElementNode, FontMap, FrontEndResult, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/font-features.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value` (! when implicit), or its diagnostic codes. */
function parsed(property: string, value: string): string[] {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}${l.explicit ? '' : '!'}`);
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

/** Each error as `<target> <code>` for text in the family, inheriting the declaration through a child; native's Lato refusal aside. */
function errorsAt(family: string, decl: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: ${family}; font-size: 10px; } .s { ${decl}; }`;
  const p = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, fonts: MAP }, { faults, profiles: 'derive', direction: 'ltr' });
  const c = p.compile(withLato(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'Ab Cd')])])])));
  return c.diagnostics.filter((d) => d.severity === 'error' && d.code !== 'DRAGON_UNSUPPORTED_FONT').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('font-feature-settings and font-variation-settings', () => {
  it('parse as Chrome does, written as Chrome serializes them', () => {
    expect(parsed('font-feature-settings', 'normal')).toEqual(['font-feature-settings: normal']);
    expect(parsed('font-feature-settings', '"liga" 1')).toEqual(['font-feature-settings: "liga"']);
    expect(parsed('font-feature-settings', '"liga" on, "kern" off, "ss01" 3, \'tnum\'')).toEqual(['font-feature-settings: "liga", "kern" 0, "ss01" 3, "tnum"']);
    expect(parsed('font-variation-settings', '"wght" 500, "wdth" 75.5')).toEqual(['font-variation-settings: "wght" 500, "wdth" 75.5']);
    for (const v of ['"lig" 1', '"ligat"', 'liga', '"liga" -1', '"liga" 1.5', '"liga" 1 2', 'normal, "liga"', '"liga",', '"ligé"']) expect(parsed('font-feature-settings', v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    for (const v of ['"wght"', '"wght" on', '"wgh" 1', 'wght 500']) expect(parsed('font-variation-settings', v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parsed('font-feature-settings', '"liga" calc(1 + 1)')).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
  });

  it('are reset to normal by the font shorthand', () => {
    expect(parsed('font', '10px Ahem').filter((l) => l.includes('settings'))).toEqual(['font-feature-settings: normal!', 'font-variation-settings: normal!']);
  });

  it('compile over Ahem text on every target', () => {
    for (const d of ['font-feature-settings: "liga" 1', 'font-feature-settings: "smcp", "kern" 0', 'font-variation-settings: "wght" 500', 'font-feature-settings: normal']) expect(errorsAt('Ahem', d), d).toEqual([]);
  });

  it('are refused over a real face on every target, normal accepted', () => {
    expect(errorsAt('Lato', 'font-feature-settings: "liga" 0')).toEqual(REFUSED);
    expect(errorsAt('Lato', 'font-variation-settings: "wght" 500')).toEqual(REFUSED);
    expect(errorsAt('Lato', 'font-feature-settings: normal')).toEqual([]);
  });

  it('plant fontFeaturesOnRealFaceAccepted: a setting over a real face compiles', () => {
    expect(errorsAt('Lato', 'font-feature-settings: "liga" 0', { ...NO_FAULTS, fontFeaturesOnRealFaceAccepted: true })).toEqual([]);
  });
});
