// Chrome 145 loads a web font only when OTS accepts it: Blink passes some tables through, drops those OTS does not know, checks the rest.
import { checkCff } from './cff.ts';
import { checkCmap } from './cmap.ts';
import { checkGlyf } from './glyf.ts';
import { Dropped, Reader, Refused } from './reader.ts';
import { typefaceRefusal } from './typeface.ts';
import type { OtsFont, TableRange } from './reader.ts';
import {
  checkGasp, checkHdmx, checkHead, checkHhea, checkHmtx, checkInstructions, checkKern, checkLoca, checkLtsh, checkMath, checkMaxp, checkName, checkOs2,
  checkPost, checkVdmx, checkVhea, checkVmtx, checkVorg,
} from './tables.ts';

const REQUIRED = ['maxp', 'head', 'OS/2', 'cmap', 'hhea', 'hmtx', 'name', 'post'];

/** The tables OTS checks, in the order it checks them (ots.cc supported_tables), less those Blink passes through. */
const CHECKS: readonly (readonly [string, (t: Reader, font: OtsFont) => void])[] = [
  ['maxp', checkMaxp],
  ['head', checkHead],
  ['OS/2', checkOs2],
  ['cmap', checkCmap],
  ['hhea', checkHhea],
  ['hmtx', checkHmtx],
  ['name', checkName],
  ['post', checkPost],
  ['loca', checkLoca],
  ['glyf', checkGlyf],
  ['CFF ', checkCff],
  ['VDMX', checkVdmx],
  ['hdmx', checkHdmx],
  ['gasp', checkGasp],
  ['cvt ', (t) => checkInstructions(t, 'cvt ')],
  ['fpgm', (t) => checkInstructions(t, 'fpgm')],
  ['prep', (t) => checkInstructions(t, 'prep')],
  ['LTSH', checkLtsh],
  ['VORG', checkVorg],
  ['kern', checkKern],
  ['vhea', checkVhea],
  ['vmtx', checkVmtx],
  ['MATH', checkMath],
];

/** Tables Blink hands on without OTS checking them (web_font_decoder.cc). */
export const PASSED_THROUGH = new Set(['CBDT', 'CBLC', 'COLR', 'CPAL', 'CFF2', 'sbix', 'STAT', 'avar', 'BASE', 'cvar', 'fvar', 'gvar', 'HVAR', 'MVAR', 'VVAR', 'GDEF', 'GPOS', 'GSUB']);

/** Why Chrome refuses the font, or the tables it keeps. */
export function sanitize(d: DataView, tables: ReadonlyMap<string, TableRange>): { readonly refused: string } | { readonly kept: ReadonlySet<string> } {
  const font: OtsFont = { numGlyphs: 0, headFlags: 0, indexToLocFormat: 0, hheaMetrics: 0, vheaMetrics: 0, loca: null, kept: new Set() };
  for (const [tag, check] of CHECKS) {
    const range = tables.get(tag);
    if (range === undefined) {
      if (REQUIRED.includes(tag)) return { refused: `no ${tag} table` };
      continue;
    }
    try {
      check(new Reader(d, range.offset, range.length), font);
      font.kept.add(tag);
    } catch (e) {
      if (e instanceof Refused) return { refused: `${tag}: ${e.message}` };
      if (!(e instanceof Dropped)) throw e;
    }
  }
  for (const tag of tables.keys()) if (PASSED_THROUGH.has(tag)) font.kept.add(tag);
  const has = (tag: string): boolean => font.kept.has(tag);
  if (!(has('glyf') && has('loca')) && !has('CFF ') && !has('CFF2') && !(has('CBDT') && has('CBLC'))) return { refused: 'no glyf and loca, CFF, CFF2, or CBDT and CBLC table' };
  const typeface = typefaceRefusal(d, tables);
  return typeface === null ? { kept: font.kept } : { refused: typeface };
}
