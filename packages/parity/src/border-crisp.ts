// Which side's colour a border's drawing operations (paint-dash.ts) give a device pixel when they cover it wholly or not at all;
// pixels covered in part (anti-aliased dash ends and dot rims) are the edge rule's business. Shared by the P6a Chrome pixel oracle
// and the Markless export's dashed-border check.
import type { BorderOp } from '@dragon/layout';

type Pt = readonly [number, number];

/** Whether two convex polygons overlap (separating axis test); touching edges do not overlap. */
function overlaps(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Pt;
      const q = poly[(i + 1) % poly.length] as Pt;
      const nx = q[1] - p[1];
      const ny = p[0] - q[0];
      if (nx === 0 && ny === 0) continue;
      const proj = (xs: readonly Pt[]): [number, number] => {
        const v = xs.map(([x, y]) => x * nx + y * ny);
        return [Math.min(...v), Math.max(...v)];
      };
      const [a0, a1] = proj(a);
      const [b0, b1] = proj(b);
      if (a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9) return false;
    }
  }
  return true;
}

/** Whether point (x, y) is inside a convex polygon (either winding), boundary included. */
function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    const c = (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/** The width of a dot's rim band in device px, each side of its circle. */
const DOT_RIM = 0.5;

const pairs = (pts: readonly number[]): Pt[] => Array.from({ length: pts.length / 2 }, (_, i) => [pts[2 * i] as number, pts[2 * i + 1] as number] as const);

/** How an operation's shape covers pixel [x, x+1) x [y, y+1): wholly, not at all, or in part. */
function cover(o: BorderOp, x: number, y: number): 'full' | 'none' | 'part' {
  const corners: Pt[] = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
  if (o.op === 'dot') {
    const [cx, cy, r] = o.points as [number, number, number];
    // Skia rasters a dot as conics flattened to quads with analytic anti-aliasing, so its rim is not the exact circle: pixels
    // within half a pixel of the circle are the rim, compared by the edge rule, not here.
    if (corners.every(([px, py]) => Math.hypot(px - cx, py - cy) <= r - DOT_RIM)) return 'full';
    const nx = Math.max(x, Math.min(cx, x + 1));
    const ny = Math.max(y, Math.min(cy, y + 1));
    return Math.hypot(nx - cx, ny - cy) >= r + DOT_RIM ? 'none' : 'part';
  }
  const poly = pairs(o.points);
  if (!overlaps(poly, corners)) return 'none';
  return corners.every(([px, py]) => inside(poly, px, py)) ? 'full' : 'part';
}

/** The reference's crisp colour side at a pixel (-1 for none), or null when some operation covers it in part. */
export function crispSide(ops: readonly BorderOp[], x: number, y: number): number | null {
  const clips: (readonly BorderOp[])[] = [[]];
  let side = -1;
  for (const o of ops) {
    const top = clips[clips.length - 1] as BorderOp[];
    if (o.op === 'save') clips.push([...top]);
    else if (o.op === 'restore') clips.pop();
    else if (o.op === 'clip') top.push(o);
    else if (o.op === 'begin-layer' || o.op === 'end-layer') return null;
    else {
      const c = cover(o, x, y);
      if (c === 'none') continue;
      const clipped = top.map((k) => cover(k, x, y));
      if (clipped.includes('none')) continue;
      if (c === 'part' || clipped.includes('part')) return null;
      side = o.side;
    }
  }
  return side;
}
