import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync('/tmp/anchor-measure/results.json'));
const trunc = Math.trunc, round = (v) => Math.floor(v + 0.5);
// Model: z = dpr*64 device LU per CSS px. Specified px -> trunc(px*z). anchor(p%) edge = A.start + round(p*A.size) (LU).
// calc(): evaluated in floating point on (LU/z) px values, result truncated toward zero to LU.
const check = (id, cbW, cbH, A, preds) => {
  const v = r[id]; const z = v.dpr * 64; let bad = 0;
  const a = { x: trunc(A.x * z), y: trunc(A.y * z), w: trunc(A.w * z), h: trunc(A.h * z) };
  const e = (p, axis) => (axis === 'x' ? a.x + round(p * a.w) : a.y + round(p * a.h));
  for (const [k, [axis, f]] of Object.entries(preds)) {
    const b = v.boxes[k], cb = v.boxes.cb; const got = axis === 'w' ? b.w * z : axis === 'x' ? (b.x - cb.x) * z : (b.y - cb.y) * z;
    const want = f(a, e, z);
    const ok = Math.abs(got - want) < 0.01; if (!ok) bad++;
    console.log(`${id.padEnd(22)} ${k.padEnd(4)} ${axis} got ${got.toFixed(3).padStart(9)} model ${String(want).padStart(6)} ${ok ? 'OK' : 'MISMATCH'}`);
  }
  return bad;
};
let bad = 0;
const T = (px, z) => trunc(px * z);
for (const d of [1, 2, 2.625]) {
  bad += check(`Q7-rounding dpr${d}`, 300, 300, { x: 10.1, y: 5.3, w: 33.3, h: 17.7 }, {
    r1: ['x', (a, e) => e(0.333, 'x')], r2: ['x', (a, e) => e(0.5, 'x')], r3: ['w', (a, e, z) => trunc(a.w / 3)],
    r4: ['x', (a, e) => trunc((a.x + a.w) / 3)], r5: ['y', (a, e) => trunc((a.y + a.y + a.h) / 3)], r6: ['x', (a, e, z) => trunc((a.x / z * 0.7 + 1.1) * z)],
    r7: ['x', (a, e, z) => T(300, z) - (T(300, z) - e(0.333, 'x')) - T(3, z)], r8: ['w', (a) => a.w], r9: ['w', (a) => trunc(a.w * 0.333)],
    r10: ['x', (a, e) => e(0.5, 'x')], r11: ['x', (a, e) => e(0.667, 'x')], r12: ['x', (a) => trunc(a.x + a.w / 7)], r13: ['x', (a, e) => trunc(e(0.333, 'x') / 3)],
    r14: ['y', (a, e) => e(0.333, 'y')], r15: ['y', (a, e, z) => T(300, z) - (T(300, z) - e(0.333, 'y')) - T(3, z)],
  });
  bad += check(`Q7-negative dpr${d}`, 300, 300, { x: -10.1, y: 5.3, w: 33.3, h: 17.7 }, {
    n1: ['x', (a, e) => e(0.333, 'x')], n2: ['x', (a) => trunc(-a.w * 0.333)], n3: ['x', (a) => trunc(a.x * 0.7)], n4: ['x', (a) => a.x],
    n5: ['x', (a, e, z) => trunc(a.x - 0.3 * z)], n6: ['x', (a, e) => e(0.1, 'x')],
  });
}
console.log('mismatches', bad);
