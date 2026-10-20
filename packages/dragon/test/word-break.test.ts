// TXT2-d and TXT-BREAK-2 compiler (analysis/break-all.ts): word-break break-all over the Latin set and keep-all are accepted in Ahem and
// in a real face; break-all over any other character, or U+00AD, is refused on every target at the word-break declaration; the planted
// fault accepts it.
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
  return out.diagnostics.filter((d) => d.message.includes('(TXT-BREAK-2)')).map((d) => `${d.code} ${String(d.target)} ${d.message}`);
}

describe('word-break break-all and keep-all (TXT2-d, TXT-BREAK-2)', () => {
  it('accepts break-all over the Latin set and keep-all over anything, in Ahem and in a real face', () => {
    expect(refusals('Ahem', 'break-all', 'XY12 ZW34 xx')).toEqual([]);
    expect(refusals('Ahem', 'break-all', 'XX-XX X.X X/X X(X) X\u00a0X \u00e9\u00df \u2014\u201cX\u201d')).toEqual([]);
    expect(refusals('Ahem', 'keep-all', 'XX-XX XX/XX X.X')).toEqual([]);
    expect(refusals('Ahem', 'normal', 'XX-XX')).toEqual([]);
    for (const wb of ['break-all', 'keep-all']) expect(refusals('Lato', wb, 'Ab-cd \u00e9t\u00e9'), wb).toEqual([]);
  });
  it('refuses break-all over a character outside the Latin set, or U+00AD, on every target; breakAllOutsideSetAccepted accepts it', () => {
    for (const [family, value, cp] of [['Ahem', 'X\u0153X', '0153'], ['Ahem', 'X\u00adX', '00AD'], ['Lato', 'A\u20acb', '20AC']] as const) {
      const message = `word-break: break-all on d:text0, which holds U+${cp}: break-all is laid out over Latin text only (TXT-BREAK-2)`;
      expect(refusals(family, 'break-all', value), value).toEqual([`DRAGON_UNSUPPORTED_VALUE ios ${message}`, `DRAGON_UNSUPPORTED_VALUE web ${message}`]);
      expect(refusals(family, 'break-all', value, { ...NO_FAULTS, breakAllOutsideSetAccepted: true }), value).toEqual([]);
    }
    expect(refusals('Ahem', 'keep-all', 'X\u0153X')).toEqual([]);
  });
});
