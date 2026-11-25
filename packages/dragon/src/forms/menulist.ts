// FORM-b: a menulist-button select's internal margins and paddings and its drop-down arrow, compared with Chrome 145 captures
// (scripts/capture-form-data.ts, test/forms/chrome-145/menulist.json). The reference functions are the engine's (packages/layout
// controls.ts), passed in, since the compiler core imports the engine for types only.
import type { FormFaults } from './faults.ts';

/** [top, right, bottom, left] in CSS px, as getComputedStyle gives them. */
type Sides = readonly [number, number, number, number];

/** One captured select: its inner element's computed margins and paddings at a device scale and zoom. */
export type MenuListCase = { readonly id: string; readonly direction: 'ltr' | 'rtl'; readonly dpr: number; readonly zoom: number; readonly css: string; readonly margin: Sides; readonly padding: Sides };

/**
 * One captured arrow at a device scale: the select's snapped border box [left, top, width, height] and whole left and right
 * border widths, its colour and background (#rrggbb), its inner element's border box [left, top, right, bottom], and the pixels
 * of region [x, y, width, height] as rows of #rrggbb, all in device px.
 */
export type MenuListPixels = {
  readonly id: string;
  readonly direction: 'ltr' | 'rtl';
  readonly dpr: number;
  readonly css: string;
  readonly rect: readonly [number, number, number, number];
  readonly border: readonly [number, number];
  readonly color: string;
  readonly background: string;
  readonly inner: readonly [number, number, number, number];
  readonly region: readonly [number, number, number, number];
  readonly rows: readonly string[];
};

export type MenuListCapture = { readonly chrome: string; readonly cases: readonly MenuListCase[]; readonly pixels: readonly MenuListPixels[] };

type Pt = { readonly x: number; readonly y: number };
type Segment = { readonly kind: string; readonly x?: number; readonly y?: number };

/** The engine's menulist functions (layout controls.ts menuListInnerInsets, menuListArrowBox and menuListArrow). */
export type MenuListReference = {
  readonly insets: (arrowWidth: number, zoom: number, device: number) => { readonly start: number; readonly end: number; readonly top: number; readonly bottom: number };
  readonly box: (arrowWidth: number, zoom: number, device: number) => number;
  readonly arrow: (left: number, top: number, width: number, height: number, borderLeft: number, borderRight: number, arrowBox: number, arrowWidth: number, inlineEndLeft: boolean) => { readonly shape: { readonly segments: readonly Segment[] }; readonly strokeWidth: number };
};

/** MenuListArrowWidthInDIP: the inline-end margin less 1 of every select captured at DPR 1 and zoom 1, which must agree. */
export function menuListArrowWidthOf(c: MenuListCapture): number {
  const ends = c.cases.filter((k) => k.dpr === 1 && k.zoom === 1).map((k) => (k.direction === 'ltr' ? k.margin[1] : k.margin[3]) - 1);
  const w = ends[0];
  if (w === undefined || !ends.every((e) => e === w) || !Number.isInteger(w) || w <= 0) throw new Error(`the captured menulist end margins less 1 (${ends.join(', ')}) give no one arrow width`);
  return w;
}

/** The centreline of an arrow as segments. */
function segmentsOf(segments: readonly Segment[]): (readonly [Pt, Pt])[] {
  const pts = segments.filter((s) => s.kind === 'move' || s.kind === 'line').map((s) => ({ x: s.x as number, y: s.y as number }));
  return pts.slice(1).map((p, k) => [pts[k] as Pt, p] as const);
}

function distance(p: Pt, [a, b]: readonly [Pt, Pt]): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * An arrow against Chrome's pixels: a pixel the butt-capped stroke covers whole must be the colour, and one whose centre keeps
 * clearance from the stroke outline (its band and the miter tip at the vertex) must be the background; the rest are antialiased and
 * not judged, nor is anything inside the inner element's box.
 */
export function arrowPixelProblems(segments: readonly Segment[], strokeWidth: number, clearance: number, at: (x: number, y: number) => string, region: readonly [number, number, number, number], inner: readonly [number, number, number, number], color: string, background: string): { readonly covered: number; readonly clear: number; readonly wrong: readonly string[] } {
  const segs = segmentsOf(segments);
  const half = strokeWidth / 2;
  const inside = (x: number, y: number): boolean => segs.some(([a, z]) => {
    const len = Math.hypot(z.x - a.x, z.y - a.y);
    if (len === 0) return false;
    const [dx, dy] = [(z.x - a.x) / len, (z.y - a.y) / len];
    const along = (x - a.x) * dx + (y - a.y) * dy;
    return along >= 0 && along <= len && Math.abs((x - a.x) * -dy + (y - a.y) * dx) <= half;
  });
  const vertex = segs[0]?.[1];
  let covered = 0;
  let clear = 0;
  const wrong: string[] = [];
  const [rx, ry, rw, rh] = region;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      if (x + 1 > inner[0] && x < inner[2] && y + 1 > inner[1] && y < inner[3]) continue;
      const p = { x: x + 0.5, y: y + 0.5 };
      const pixel = at(x, y);
      if ([[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].every(([u, v]) => inside(u as number, v as number))) {
        covered++;
        if (pixel !== color) wrong.push(`(${x}, ${y}) covered: ${pixel} != colour ${color}`);
      } else if (!segs.some((s) => distance(p, s) < half + clearance) && (vertex === undefined || Math.hypot(p.x - vertex.x, p.y - vertex.y) >= half * Math.SQRT2 + clearance)) {
        clear++;
        if (pixel !== background) wrong.push(`(${x}, ${y}) clear: ${pixel} != background ${background}`);
      }
    }
  }
  return { covered, clear, wrong };
}

export type MenuListMismatch = { readonly subject: string; readonly detail: string };

/**
 * The captures against the reference: every select's margins and paddings in device px are the reference insets (start and end
 * mirrored in rtl), and every captured arrow's pixels match the reference arrow, judging as clear only a pixel whose square misses
 * the stroke outline (its centre half a diagonal clear of it). arrowUnmirrored plants the ltr placement in rtl.
 */
export function compareMenuList(c: MenuListCapture, ref: MenuListReference, faults: FormFaults): { readonly count: number; readonly mismatches: readonly MenuListMismatch[] } {
  const width = menuListArrowWidthOf(c);
  const mismatches: MenuListMismatch[] = [];
  let count = 0;
  for (const k of c.cases) {
    count++;
    const z = k.dpr * k.zoom;
    const i = ref.insets(width, z, k.dpr);
    const rtl = k.direction === 'rtl' && !faults.arrowUnmirrored;
    const want = [i.top, rtl ? i.start : i.end, i.bottom, rtl ? i.end : i.start];
    const got = k.margin.map((m, s) => (s === 0 || s === 2 ? k.padding[s] as number : m) * z);
    if (got.some((g, s) => Math.abs(g - (want[s] as number)) > 1e-3)) mismatches.push({ subject: `${k.id} ${k.direction} DPR ${k.dpr} zoom ${k.zoom}`, detail: `inner padding-top, margin-right, padding-bottom, margin-left ${got.join(', ')} device px != reference ${want.join(', ')}` });
  }
  for (const p of c.pixels) {
    count++;
    const [l, t, w, h] = p.rect;
    const a = ref.arrow(l, t, w, h, p.border[0], p.border[1], ref.box(width, p.dpr, p.dpr), width, p.direction === 'rtl' && !faults.arrowUnmirrored);
    const [rx, ry] = p.region;
    const at = (x: number, y: number): string => {
      const row = p.rows[y - ry];
      if (row === undefined || x < rx || (x - rx) * 7 >= row.length) throw new Error(`${p.id}: pixel ${x}, ${y} is outside the captured region`);
      return row.slice((x - rx) * 7, (x - rx) * 7 + 7);
    };
    const r = arrowPixelProblems(a.shape.segments, a.strokeWidth, Math.SQRT1_2, at, p.region, p.inner, p.color, p.background);
    if (r.covered === 0 || r.clear === 0) mismatches.push({ subject: `${p.id} ${p.direction} arrow`, detail: `${r.covered} covered and ${r.clear} clear pixels: the region misses the arrow` });
    for (const m of r.wrong.slice(0, 3)) mismatches.push({ subject: `${p.id} ${p.direction} arrow`, detail: m });
  }
  return { count, mismatches };
}
