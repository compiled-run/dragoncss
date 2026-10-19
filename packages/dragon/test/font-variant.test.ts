// TXT-FONTFEAT compiler (properties/font-variant.ts, analysis/font-variant.ts): the font-variant feature longhands are accepted over
// Ahem and refused on every target over text in a real face; caps, position and emoji are refused at parse time. The planted fault
// fontVariantOnRealFaceAccepted accepts the real face. Their agreement with Chrome is packages/parity/test/font-variant-parse.test.ts.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ElementNode, FontMap, FrontEndResult, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { inputFor, staticClass, DOC, text } from './helpers.ts';

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const vendor = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../vendor/fonts/${file}`, import.meta.url)));
const LATO = vendor('Lato/Lato-Regular.ttf');
const MAP: FontMap = { generics: {}, families: { Lato: { mode: 'pinned', family: 'Lato', faces: [{ src: 'fonts/Lato-Regular.ttf', weight: '400' }] } } } as unknown as FontMap;
const withLato = (base: FrontEndResult): FrontEndResult => ({
  ...base,
  snapshot: { ...base.snapshot, assets: [{ id: 'fonts/Lato-Regular.ttf', hash: `sha256:${createHash('sha256').update(LATO).digest('hex')}`, bytes: LATO }] },
});

/** The diagnostics naming font-variant for a div d holding text, as `code target message`. */
function variantDiagnostics(family: string, decl: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: ${family}; font-size: 10px; } .w { ${decl}; }`;
  const tree = (r: SourceRef) => [el(r, 'd', 'div', ['w'], [text(r, 't0', 'Ab cd')])];
  const out = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} }, fonts: MAP }, { faults, profiles: 'derive', direction: 'ltr' }).compile(withLato(inputFor(css, tree)));
  return out.diagnostics.filter((d) => d.message.includes('font-variant')).map((d) => `${d.code} ${String(d.target)} ${d.message}`);
}

const FEATURES = ['font-variant-ligatures: none', 'font-variant-numeric: tabular-nums', 'font-variant-east-asian: ruby', 'font-variant-alternates: historical-forms', 'font-variant: no-contextual slashed-zero'];

describe('font-variant (TXT-FONTFEAT)', () => {
  it('accepts the feature longhands and the shorthand over Ahem, and normal over a real face', () => {
    for (const decl of FEATURES) expect(variantDiagnostics('Ahem', decl), decl).toEqual([]);
    expect(variantDiagnostics('Lato', 'font-variant: normal')).toEqual([]);
  });
  it('refuses them over text in a real face on every target; fontVariantOnRealFaceAccepted accepts them', () => {
    const message = 'font-variant-ligatures: none reaches text d:text0, which is drawn in a real face: Dragon applies no OpenType feature yet (TXT-FONTFEAT)';
    expect(variantDiagnostics('Lato', 'font-variant-ligatures: none')).toEqual([`DRAGON_UNSUPPORTED_VALUE ios ${message}`, `DRAGON_UNSUPPORTED_VALUE web ${message}`]);
    for (const decl of FEATURES) {
      expect(variantDiagnostics('Lato', decl).length, decl).toBe(2);
      expect(variantDiagnostics('Lato', decl, { ...NO_FAULTS, fontVariantOnRealFaceAccepted: true }), decl).toEqual([]);
    }
  });
  it('refuses caps other than small-caps, position and emoji, and the alternates functions, at parse time on every target', () => {
    for (const decl of ['font-variant-caps: all-small-caps', 'font-variant-caps: petite-caps', 'font-variant: titling-caps slashed-zero', 'font-variant-position: sub', 'font-variant-emoji: emoji', 'font-variant-alternates: swash(a)', 'font-variant: all-small-caps tabular-nums']) {
      const d = variantDiagnostics('Ahem', decl);
      expect(d.length, decl).toBe(1);
      expect(d[0], decl).toMatch(/^DRAGON_UNSUPPORTED_VALUE null font-variant[a-z-]*: [a-z-]+(\(\))? is unsupported: /);
    }
  });
});
