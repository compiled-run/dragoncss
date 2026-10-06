// MQ-R1 (notes/T067-mq-r-spec.md R4): the band suite's vectors (packages/layout/rt-vectors/band/cases.json). One record per media
// fixture with @media bands: its native band table and root sizes in whole device px at DPR 1, 1.75, 2, 2.625, 3 and 3.5: every
// whole px within 2 of each threshold at each DPR (where Chrome's 1/64 px slack and the float media size decide the band), squares
// and the neighbours of every aspect ratio, and the Chrome measurements M4 (1080 x 2208 at 2.625) and the review's 1400 px at 3.5.
// The translate corpus runs them on the TypeScript harness for the expected results; Swift and Kotlin must equal them. No browser.
import type { rtBand } from '@dragon/layout';
import { nativeBands } from 'dragon';
import { FIXTURES } from './fixtures.ts';
import type { FixtureSpec } from './fixtures.ts';
import { nativeCompile } from './native-host.ts';

const view = new DataView(new ArrayBuffer(8));
/** A double's bit pattern as 16 hex digits, as the translate corpus writes numbers (translate/harness/host.ts bitsHex). */
function bitsHex(x: number): string {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

export const BAND_VECTORS_PATH = 'packages/layout/rt-vectors/band/cases.json';
export const BAND_VECTOR_DPRS: readonly number[] = [1, 1.75, 2, 2.625, 3, 3.5];
export const BAND_VECTORS_SCHEMA = 'dragon-band-vectors/1';

type Size = readonly [number, number, number];

/** The root sizes a table is looked up at: every whole px within 2 of each threshold, both axes, at each DPR, plus the fixed rows. */
export function bandSizes(table: rtBand.BandTable): Size[] {
  const out = new Map<string, Size>();
  const add = (w: number, h: number, dpr: number): void => {
    if (w < 0 || h < 0) return;
    out.set(`${w} ${h} ${dpr}`, [w, h, dpr]);
  };
  for (const dpr of BAND_VECTOR_DPRS) {
    const base = Math.round(600 * dpr);
    const tall = Math.round(1400 * dpr);
    for (const a of table.atoms) {
      for (const c of a.comparisons) {
        if (a.feature === 'width' || a.feature === 'height') {
          const at = Math.round(c.value * dpr);
          for (let px = at - 2; px <= at + 2; px++) {
            if (a.feature === 'width') for (const h of [base, tall]) add(px, h, dpr);
            else for (const w of [base, tall]) add(w, px, dpr);
          }
        } else {
          // A ratio num/den: heights where the width is the ratio's, and one whole px either side, at two scales.
          for (const s of [300, 400]) {
            const h = Math.round(s * dpr);
            const w = Math.round((h * c.num) / c.den);
            for (let d = -2; d <= 2; d++) add(w + d, h, dpr);
          }
        }
      }
      if (a.feature === 'orientation') for (const s of [304, 400]) for (let d = -2; d <= 2; d++) add(Math.round(s * dpr) + d, Math.round(s * dpr), dpr);
    }
    add(base, base, dpr);
  }
  add(1080, 2208, 2.625);
  add(1400, 1000, 3.5);
  return [...out.values()];
}

/** Every media and mqr fixture's band table (ltr: a band table does not depend on direction) with its sizes, numbers as bits. */
export function bandVectorCases(specs: readonly FixtureSpec[] = FIXTURES): { readonly id: string; readonly table: unknown; readonly sizes: readonly (readonly string[])[] }[] {
  return specs.filter((f) => f.kind === 'layout' && /^(media|mqr)-/.test(f.id)).flatMap((f) => {
    const bands = nativeBands(nativeCompile(f, 'ltr'));
    if (bands === null || bands.table.atoms.length === 0) return [];
    const table = [
      bands.table.atoms.map((a) => [a.feature, a.keyword, a.comparisons.map((c) => [c.op, bitsHex(c.value), bitsHex(c.num), bitsHex(c.den)])]),
      bands.table.bands,
    ];
    return [{ id: f.id, table, sizes: bandSizes(bands.table).map((s) => s.map(bitsHex)) }];
  });
}

export function bandVectorsJson(): string {
  return `${JSON.stringify({ schema: BAND_VECTORS_SCHEMA, cases: bandVectorCases() }, null, 1)}\n`;
}
