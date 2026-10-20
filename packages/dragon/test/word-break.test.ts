// TXT2-d compiler (analysis/break-all.ts): word-break break-all over ASCII letters, digits and spaces and keep-all are accepted over
// Ahem; break-all over any other character, and either value over text in a real face, are refused on every target at the word-break
// declaration; each planted fault accepts what it names.
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

/** The TXT2-d refusals of a div d holding text, as `code target message-head`. */
function refusals(family: string, wordBreak: string, value: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: ${family}; font-size: 10px; } .w { word-break: ${wordBreak}; }`;
  const tree = (r: SourceRef) => [el(r, 'd', 'div', ['w'], [text(r, 't0', value)])];
  const out = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} }, fonts: MAP }, { faults, profiles: 'derive', direction: 'ltr' }).compile(withLato(inputFor(css, tree)));
  return out.diagnostics.filter((d) => d.message.includes('(TXT2-d)')).map((d) => `${d.code} ${String(d.target)} ${d.message}`);
}

describe('word-break break-all and keep-all (TXT2-d)', () => {
  it('accepts break-all over ASCII letters, digits and spaces, and keep-all over anything, in Ahem', () => {
    expect(refusals('Ahem', 'break-all', 'XY12 ZW34 xx')).toEqual([]);
    expect(refusals('Ahem', 'keep-all', 'XX-XX XX/XX X.X')).toEqual([]);
    expect(refusals('Ahem', 'normal', 'XX-XX')).toEqual([]);
  });
  it('refuses break-all over any other character on every target; breakAllOutsideAsciiAccepted accepts it', () => {
    for (const [value, cp] of [['XX-XX', '002D'], ['X.X', '002E'], ['X/X', '002F'], ['X\u00a0X', '00A0']] as const) {
      const message = `word-break: break-all on d:text0, which holds U+${cp}: break-all is laid out over ASCII letters, digits and spaces only (TXT2-d)`;
      expect(refusals('Ahem', 'break-all', value), value).toEqual([`DRAGON_UNSUPPORTED_VALUE ios ${message}`, `DRAGON_UNSUPPORTED_VALUE web ${message}`]);
      expect(refusals('Ahem', 'break-all', value, { ...NO_FAULTS, breakAllOutsideAsciiAccepted: true }), value).toEqual([]);
    }
  });
  it('refuses break-all and keep-all over text in a real face on every target; wordBreakOnRealFaceAccepted accepts them', () => {
    for (const wb of ['break-all', 'keep-all']) {
      expect(refusals('Lato', wb, 'Ab cd'), wb).toEqual([
        `DRAGON_UNSUPPORTED_VALUE ios word-break: ${wb} on d:text0, which is drawn in a real face: word-break ${wb} is laid out over Ahem only (TXT2-d)`,
        `DRAGON_UNSUPPORTED_VALUE web word-break: ${wb} on d:text0, which is drawn in a real face: word-break ${wb} is laid out over Ahem only (TXT2-d)`,
      ]);
      expect(refusals('Lato', wb, 'Ab cd', { ...NO_FAULTS, wordBreakOnRealFaceAccepted: true }), wb).toEqual([]);
    }
    expect(refusals('Lato', 'normal', 'Ab cd')).toEqual([]);
  });
});
