// TXT-FONTFEAT compiler (properties/font-tuning.ts, analysis/font-tuning.ts): font-kerning, font-optical-sizing and
// font-language-override are accepted at any value over Ahem, and off their initial values refused on every target over text in a
// real face. The planted fault fontTuningOnRealFaceAccepted accepts the real face. Their agreement with Chrome is
// packages/parity/test/font-tuning-parse.test.ts.
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

/** The font-tuning refusals for a div d holding text, as `code target message`. */
function variantDiagnostics(family: string, decl: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: ${family}; font-size: 10px; } .w { ${decl}; }`;
  const tree = (r: SourceRef) => [el(r, 'd', 'div', ['w'], [text(r, 't0', 'Ab cd')])];
  const out = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} }, fonts: MAP }, { faults, profiles: 'derive', direction: 'ltr' }).compile(withLato(inputFor(css, tree)));
  return out.diagnostics.filter((d) => d.message.includes('TXT-FONTFEAT')).map((d) => `${d.code} ${String(d.target)} ${d.message}`);
}

const SET = ['font-kerning: none', 'font-kerning: normal', 'font-optical-sizing: none', 'font-language-override: "TRK"'];

describe('font-kerning, font-optical-sizing and font-language-override (TXT-FONTFEAT)', () => {
  it('accepts every value over Ahem, and the initial values over a real face', () => {
    for (const decl of SET) expect(variantDiagnostics('Ahem', decl), decl).toEqual([]);
    expect(variantDiagnostics('Lato', 'font-kerning: auto; font-optical-sizing: auto; font-language-override: normal')).toEqual([]);
  });
  it('refuses another value over text in a real face on every target; fontTuningOnRealFaceAccepted accepts it', () => {
    const message = "font-kerning: none reaches text d:text0, which is drawn in a real face: Dragon shapes it with the face's default kerning, language system and optical size (TXT-FONTFEAT)";
    expect(variantDiagnostics('Lato', 'font-kerning: none')).toEqual([`DRAGON_UNSUPPORTED_VALUE ios ${message}`, `DRAGON_UNSUPPORTED_VALUE web ${message}`]);
    for (const decl of SET) {
      expect(variantDiagnostics('Lato', decl).length, decl).toBe(2);
      expect(variantDiagnostics('Lato', decl, { ...NO_FAULTS, fontTuningOnRealFaceAccepted: true }), decl).toEqual([]);
    }
  });
});
