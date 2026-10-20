// TXT2-lb compiler (properties/line-break.ts, analysis/line-break.ts): line-break auto, loose, normal and strict are accepted over
// Ahem text of ASCII letters, digits, spaces and . , - / ( ) ! ? : ;, and laid out as auto; anywhere is refused at parse time; a
// strictness level over any other character, or over text in a real face, is refused on every target at the line-break declaration.
// Each planted fault accepts what it names.
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

/** The line-break diagnostics of a div d holding text, as `code target message`. */
function refusals(family: string, lineBreak: string, value: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: ${family}; font-size: 10px; } .w { line-break: ${lineBreak}; }`;
  const tree = (r: SourceRef) => [el(r, 'd', 'div', ['w'], [text(r, 't0', value)])];
  const out = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} }, fonts: MAP }, { faults, profiles: 'derive', direction: 'ltr' }).compile(withLato(inputFor(css, tree)));
  return out.diagnostics.filter((d) => d.message.startsWith('line-break')).map((d) => `${d.code} ${String(d.target)} ${d.message}`);
}

describe('line-break (TXT2-lb)', () => {
  it('accepts every strictness level over the covered characters in Ahem, and auto over anything', () => {
    for (const lb of ['auto', 'loose', 'normal', 'strict']) expect(refusals('Ahem', lb, 'XY12 (A-B) c/d e.f, g! h? i: j;'), lb).toEqual([]);
    expect(refusals('Ahem', 'auto', 'X&X')).toEqual([]);
    expect(refusals('Lato', 'auto', 'Ab cd')).toEqual([]);
  });
  it('refuses anywhere at parse time on every target', () => {
    expect(refusals('Ahem', 'anywhere', 'XX')).toEqual(['DRAGON_UNSUPPORTED_VALUE null line-break: anywhere is unsupported: the engine does not break between every typographic letter unit yet']);
  });
  it('refuses a strictness level over any other character on every target; lineBreakOutsideAsciiAccepted accepts it', () => {
    for (const [value, cp] of [['X&X', '0026'], ['X+X', '002B'], ['X X', '00A0'], ['X%X', '0025']] as const) {
      const message = `line-break: strict on d:text0, which holds U+${cp}: line-break strict is laid out as auto over ASCII letters, digits, spaces and . , - / ( ) ! ? : ; only (TXT2-lb)`;
      expect(refusals('Ahem', 'strict', value), value).toEqual([`DRAGON_UNSUPPORTED_VALUE ios ${message}`, `DRAGON_UNSUPPORTED_VALUE web ${message}`]);
      expect(refusals('Ahem', 'strict', value, { ...NO_FAULTS, lineBreakOutsideAsciiAccepted: true }), value).toEqual([]);
    }
  });
  it('refuses a strictness level over text in a real face on every target; lineBreakOnRealFaceAccepted accepts it', () => {
    for (const lb of ['loose', 'normal', 'strict']) {
      const message = `line-break: ${lb} on d:text0, which is drawn in a real face: line-break ${lb} is laid out over Ahem only (TXT2-lb)`;
      expect(refusals('Lato', lb, 'Ab cd'), lb).toEqual([`DRAGON_UNSUPPORTED_VALUE ios ${message}`, `DRAGON_UNSUPPORTED_VALUE web ${message}`]);
      expect(refusals('Lato', lb, 'Ab cd', { ...NO_FAULTS, lineBreakOnRealFaceAccepted: true }), lb).toEqual([]);
    }
  });
});
