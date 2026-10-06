// SVG-a1 (/tmp/specs/svg-a.md): the SVG attribute grammars the compiler reads: path data (SVG 2 §9.3, implemented from the grammar),
// viewBox (SVG 2 §8.6) and the plain number geometry attributes. Path data becomes absolute moveto, lineto, quadratic, cubic and
// closepath segments in float32 user space, as Chrome hands them to Skia's SkPathBuilder: relative points and the smooth commands'
// reflected control point (current + (current - previous control)) are float32 sums, and a moveto right after a moveto replaces
// it. Arcs are refused (package SVG-arc): Chrome builds them with the platform's sinf, cosf and atan2f, which Dragon has no proven
// port of. Every behaviour here is pinned against Chrome 145 by test/svg.test.ts.
import type { SvgSegment, ViewBox } from '@dragon/layout';

const f32 = Math.fround;

/** A parsed d attribute: its segments, or why it is refused (a parse error, or an arc). */
export type SvgPathParse = { readonly ok: true; readonly segments: readonly SvgSegment[] } | { readonly ok: false; readonly reason: string; readonly arc: boolean };

const isWsp = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/** A cursor over path data with the SVG 2 number and separator rules. */
class Cursor {
  i = 0;
  readonly s: string;
  constructor(s: string) {
    this.s = s;
  }
  skipWsp(): void {
    while (this.i < this.s.length && isWsp(this.s[this.i] as string)) this.i++;
  }
  /** Optional whitespace, an optional comma, optional whitespace (comma-wsp). */
  skipCommaWsp(): void {
    this.skipWsp();
    if (this.s[this.i] === ',') {
      this.i++;
      this.skipWsp();
    }
  }
  done(): boolean {
    return this.i >= this.s.length;
  }
  /**
   * An SVG 2 number: sign? (digits ('.' digits)? | '.' digits) exponent?. Chrome builds its value in float32 (observed, pinned by
   * test/svg.test.ts): the integer digits summed from the last with a power of ten that grows by x10, the fraction digits each
   * times a scale that shrinks by x0.1, both in float32; then the sign, then the exponent as a float32 power of ten.
   */
  number(): number | null {
    const m = /^([+-]?)([0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?/.exec(this.s.slice(this.i));
    if (m === null || (m[2] === '' && m[3] === undefined)) return null;
    this.i += (m[0] as string).length;
    const digits = m[2] as string;
    let integer = 0;
    let multiplier = 1;
    for (let k = digits.length - 1; k >= 0; k--) {
      integer = f32(integer + f32(multiplier * (digits.charCodeAt(k) - 48)));
      multiplier = f32(multiplier * 10);
    }
    let decimal = 0;
    let frac = 1;
    for (const ch of m[3] ?? '') {
      frac = f32(frac * f32(0.1));
      decimal = f32(decimal + f32((ch.charCodeAt(0) - 48) * frac));
    }
    let v = f32(integer + decimal);
    if (m[1] === '-') v = -v;
    if (m[4] !== undefined) v = f32(v * f32(10 ** Number(m[4])));
    return Number.isFinite(v) ? v : null;
  }
  flag(): boolean | null {
    const c = this.s[this.i];
    if (c !== '0' && c !== '1') return null;
    this.i++;
    return c === '1';
  }
}

/** The path data of a d attribute, absolute and normalized as Chrome builds it. */
export function parsePathData(d: string): SvgPathParse {
  const c = new Cursor(d);
  const out: SvgSegment[] = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  // The previous segment's second control point (cubic) or control point (quadratic), for the smooth commands.
  let lastCubic: { x: number; y: number } | null = null;
  let lastQuad: { x: number; y: number } | null = null;
  let command = '';
  const fail = (reason: string): SvgPathParse => ({ ok: false, reason, arc: false });
  c.skipWsp();
  if (c.done()) return { ok: true, segments: [] };
  while (true) {
    c.skipWsp();
    if (c.done()) break;
    const ch = c.s[c.i] as string;
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      command = ch;
      c.i++;
    } else if (command === '' || command === 'Z' || command === 'z') {
      return fail(`expected a command at offset ${c.i}`);
    } else if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';
    if (out.length === 0 && command !== 'M' && command !== 'm') return fail('path data must start with a moveto');
    const rel = command === command.toLowerCase();
    const ox = rel ? curX : 0;
    const oy = rel ? curY : 0;
    const num = (): number | null => {
      c.skipWsp();
      const v = c.number();
      if (v !== null) c.skipCommaWsp();
      return v;
    };
    const pair = (): { x: number; y: number } | null => {
      const x = num();
      if (x === null) return null;
      const y = num();
      if (y === null) return null;
      return { x: f32(x + ox), y: f32(y + oy) };
    };
    const upper = command.toUpperCase();
    let nextCubic: { x: number; y: number } | null = null;
    let nextQuad: { x: number; y: number } | null = null;
    switch (upper) {
      case 'Z':
        out.push({ kind: 'close' });
        curX = startX;
        curY = startY;
        c.skipWsp();
        break;
      case 'M': {
        const p = pair();
        if (p === null) return fail(`a moveto needs two numbers at offset ${c.i}`);
        // A moveto right after a moveto replaces it, as Chrome's path builder keeps one.
        if (out.length > 0 && (out[out.length - 1] as SvgSegment).kind === 'move') out.pop();
        out.push({ kind: 'move', x: p.x, y: p.y });
        curX = startX = p.x;
        curY = startY = p.y;
        break;
      }
      case 'L': {
        const p = pair();
        if (p === null) return fail(`a lineto needs two numbers at offset ${c.i}`);
        out.push({ kind: 'line', x: p.x, y: p.y });
        curX = p.x;
        curY = p.y;
        break;
      }
      case 'H':
      case 'V': {
        const v = num();
        if (v === null) return fail(`${upper === 'H' ? 'a horizontal' : 'a vertical'} lineto needs a number at offset ${c.i}`);
        if (upper === 'H') curX = f32(v + ox);
        else curY = f32(v + oy);
        out.push({ kind: 'line', x: curX, y: curY });
        break;
      }
      case 'C':
      case 'S': {
        const p1: { x: number; y: number } | null = upper === 'C' ? pair() : lastCubic === null ? { x: curX, y: curY } : { x: f32(curX + f32(curX - lastCubic.x)), y: f32(curY + f32(curY - lastCubic.y)) };
        if (p1 === null) return fail(`a curveto needs six numbers at offset ${c.i}`);
        const p2 = pair();
        const p = p2 === null ? null : pair();
        if (p2 === null || p === null) return fail(`a curveto needs its control and end points at offset ${c.i}`);
        out.push({ kind: 'cubic', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y });
        nextCubic = p2;
        curX = p.x;
        curY = p.y;
        break;
      }
      case 'Q':
      case 'T': {
        const q: { x: number; y: number } | null = upper === 'Q' ? pair() : lastQuad === null ? { x: curX, y: curY } : { x: f32(curX + f32(curX - lastQuad.x)), y: f32(curY + f32(curY - lastQuad.y)) };
        if (q === null) return fail(`a quadratic curveto needs four numbers at offset ${c.i}`);
        const p = pair();
        if (p === null) return fail(`a quadratic curveto needs its end point at offset ${c.i}`);
        out.push({ kind: 'quad', x1: q.x, y1: q.y, x: p.x, y: p.y });
        nextQuad = q;
        curX = p.x;
        curY = p.y;
        break;
      }
      case 'A': {
        // Read the arc so a malformed one reports as malformed, then refuse it.
        const rx = num();
        const ry = rx === null ? null : num();
        const rot = ry === null ? null : num();
        const large = rot === null ? null : c.flag();
        if (large !== null) c.skipCommaWsp();
        const sweep = large === null ? null : c.flag();
        if (sweep !== null) c.skipCommaWsp();
        const p = sweep === null ? null : pair();
        if (p === null) return fail(`an elliptical arc needs seven parameters at offset ${c.i}`);
        return { ok: false, reason: 'elliptical arc commands are not built yet (package SVG-arc)', arc: true };
      }
      default:
        return fail(`unknown command ${command}`);
    }
    lastCubic = nextCubic;
    lastQuad = nextQuad;
  }
  return { ok: true, segments: out };
}

/** The viewBox attribute: four numbers separated by whitespace or commas, width and height positive; null when it is not one. */
export function parseViewBox(text: string): ViewBox | null {
  const c = new Cursor(text);
  const values: number[] = [];
  c.skipWsp();
  for (let k = 0; k < 4; k++) {
    const v = c.number();
    if (v === null) return null;
    values.push(v);
    c.skipCommaWsp();
  }
  if (!c.done()) return null;
  const [x, y, width, height] = values as [number, number, number, number];
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** A plain SVG number attribute (x, y, width, height, cx, cy, r), with an optional px unit; null for anything else. */
export function parseSvgLength(text: string): number | null {
  const m = /^[ \t\n\r\f]*([+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)(px)?[ \t\n\r\f]*$/.exec(text);
  if (m === null) return null;
  const v = f32(Number(m[1]));
  return Number.isFinite(v) ? v : null;
}
