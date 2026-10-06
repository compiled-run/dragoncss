// MQ-R1 (notes/T067-mq-r-spec.md R4): the band suite's vectors (packages/layout/rt-vectors/band/cases.json). One record per media
// fixture with @media bands: its native band table and root sizes in whole device px at DPR 1, 1.75, 2, 2.625, 3 and 3.5: every
// whole px within 2 of each threshold at each DPR (where Chrome's 1/64 px slack and the float media size decide the band), squares
// and the neighbours of every aspect ratio, and the Chrome measurements M4 (1080 x 2208 at 2.625) and the review's 1400 px at 3.5.
// MQ-R2: a table with device atoms is also looked up with every pointer, hover and reduced-motion reading, at each DPR and at the
// float scales next to each resolution query. The translate corpus runs them on the TypeScript harness for the expected results;
// Swift and Kotlin must equal them. No browser.
import type { rtBand } from '@dragon/layout';
import { nativeBands } from 'dragon';
import { FIXTURES } from './fixtures.ts';
import type { FixtureSpec } from './fixtures.ts';
import { nativeCompile } from './native-host.ts';
import { MEDIA_ENVIRONMENT_FIXTURES } from './fixture-groups/media-environment.ts';

const view = new DataView(new ArrayBuffer(8));
/** A double's bit pattern as 16 hex digits, as the translate corpus writes numbers (translate/harness/host.ts bitsHex). */
function bitsHex(x: number): string {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

export const BAND_VECTORS_PATH = 'packages/layout/rt-vectors/band/cases.json';
export const BAND_VECTOR_DPRS: readonly number[] = [1, 1.75, 2, 2.625, 3, 3.5];
export const BAND_VECTORS_SCHEMA = 'dragon-band-vectors/2';

/** The readings as the harness takes them: [pointer, hover, anyCoarse, anyFine, anyHover, reducedMotion]. */
type Readings = readonly [string, boolean, boolean, boolean, boolean, boolean];
type Size = readonly [number, number, number, Readings];

/** Headless Chrome's desktop readings (a mouse, no motion preference). */
const DESKTOP: Readings = ['fine', true, false, true, true, false];

/** Every reading a device can report: the primary pointer one of those present, hover only when some device hovers. */
export function allReadings(): Readings[] {
  const out: Readings[] = [];
  for (const [anyCoarse, anyFine] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const pointers = [...(anyCoarse ? ['coarse'] : []), ...(anyFine ? ['fine'] : [])];
    for (const pointer of pointers.length === 0 ? ['none'] : pointers) {
      for (const anyHover of [false, true]) {
        for (const hover of anyHover ? [false, true] : [false]) for (const reducedMotion of [false, true]) out.push([pointer, hover, anyCoarse, anyFine, anyHover, reducedMotion]);
      }
    }
  }
  return out;
}

/** The adjacent float above (up) or below x. */
function floatStep(x: number, up: boolean): number {
  const f = new Float32Array([x]);
  const i = new Int32Array(f.buffer);
  i[0] = (i[0] as number) + ((x > 0) === up ? 1 : -1);
  return f[0] as number;
}

/** The root sizes a table is looked up at: every whole px within 2 of each threshold, both axes, at each DPR, plus the fixed rows. */
export function bandSizes(table: rtBand.BandTable): Size[] {
  const out = new Map<string, Size>();
  const add = (w: number, h: number, dpr: number, r: Readings = DESKTOP): void => {
    if (w < 0 || h < 0) return;
    out.set(`${w} ${h} ${dpr} ${r.join()}`, [w, h, dpr, r]);
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
  // MQ-R2: every reading at every DPR, and the scales at and next to each resolution query (dpcm's rounding edges too).
  const device = table.atoms.some((a) => !['width', 'height', 'orientation', 'aspect-ratio'].includes(a.feature));
  if (device) {
    const scales = new Set<number>(BAND_VECTOR_DPRS);
    for (const a of table.atoms) {
      if (a.feature !== 'resolution') continue;
      for (const c of a.comparisons) {
        const centres = c.num === 1 ? [c.value, Math.round(c.value * 100) / 100 - 0.005, Math.round(c.value * 100) / 100 + 0.005] : [c.value];
        for (const v of centres.map(Math.fround)) for (const x of [v, floatStep(v, true), floatStep(v, false)]) if (x > 0) scales.add(x);
      }
    }
    for (const dpr of scales) for (const r of allReadings()) add(Math.round(400 * dpr), Math.round(300 * dpr), dpr, r);
  }
  add(1080, 2208, 2.625);
  add(1400, 1000, 3.5);
  return [...out.values()];
}

/** Every media and mqr fixture's band table (ltr: a band table does not depend on direction) with its sizes, numbers as bits. */
export function bandVectorCases(specs: readonly FixtureSpec[] = [...FIXTURES, ...MEDIA_ENVIRONMENT_FIXTURES]): { readonly id: string; readonly table: unknown; readonly sizes: readonly unknown[] }[] {
  return specs.filter((f) => f.kind === 'layout' && /^(media|mqr2?)-/.test(f.id)).flatMap((f) => {
    const bands = nativeBands(nativeCompile(f, 'ltr'));
    if (bands === null || bands.table.atoms.length === 0) return [];
    const table = [
      bands.table.atoms.map((a) => [a.feature, a.keyword, a.comparisons.map((c) => [c.op, bitsHex(c.value), bitsHex(c.num), bitsHex(c.den)])]),
      bands.table.bands,
    ];
    return [{ id: f.id, table, sizes: bandSizes(bands.table).map(([w, h, dpr, r]) => [bitsHex(w), bitsHex(h), bitsHex(dpr), r]) }];
  });
}

export function bandVectorsJson(): string {
  return `${JSON.stringify({ schema: BAND_VECTORS_SCHEMA, cases: bandVectorCases() }, null, 1)}\n`;
}
