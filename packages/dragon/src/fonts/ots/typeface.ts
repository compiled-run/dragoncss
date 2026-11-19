// After OTS accepts a font, Chrome 145 on macOS still fails to make a typeface of some fvar tables OTS passes through unchecked;
// these rules are measured (woff-sanitizer.test.ts), and a COLRv0, COLRv1 or CBDT and CBLC font is exempt from them.
import type { TableRange } from './reader.ts';

/** The COLR version read-fonts finds, or null when its header is too short to read. */
function colrVersion(d: DataView, colr: TableRange | undefined): number | null {
  if (colr === undefined || colr.length < 2) return null;
  const version = d.getUint16(colr.offset);
  return colr.length >= (version === 0 ? 14 : 34) ? version : null;
}

export function typefaceRefusal(d: DataView, tables: ReadonlyMap<string, TableRange>): string | null {
  const fvar = tables.get('fvar');
  if (fvar === undefined) return null;
  const colr = colrVersion(d, tables.get('COLR'));
  if ((tables.has('CBDT') && tables.has('CBLC')) || colr === 0 || colr === 1) return null;
  if (fvar.length < 16) return 'fvar is shorter than its header';
  const o = fvar.offset;
  if (d.getUint16(o + 8) === 0) return null;
  if (d.getUint16(o + 10) < 20) return 'fvar axisSize is less than 20';
  if (d.getUint16(o + 4) + 20 > fvar.length) return 'the first fvar axis runs past the end of the table';
  if (d.getUint16(o + 14) === 0) return 'fvar instanceSize is 0';
  return null;
}
