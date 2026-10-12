// R3 (notes/T074-bg2-spec.md): the capture host's libm results Chrome's gradient code reads, looked up in the measured table
// (libm-darwin-arm64.generated.ts, pnpm run libm:capture) and folded at build time; the device gets constants and never calls tan.
import { TANF_DIFFS } from './libm-darwin-arm64.generated.ts';

/**
 * R3: Blink's linear slope, tan(float) of Deg2rad(90 - a) for the angle a normalised to [0, 360) in float, as the capture host's
 * libm gives it: the measured table entry, or else fdlibm's tan rounded to float (every other grid input agrees with it). Only angles
 * on the 0.01 degree grid the probe covers have a known result; null for any other (the native targets refuse it, BG2b). The right
 * angles take no slope (EndPointsFromAngle returns before its tan), so they are on the grid with slope 0.
 */
export function linearSlope(angleDeg: number, faults: { readonly libmTableIgnored?: boolean } = {}): number | null {
  let a = f32(f32(angleDeg) % 360);
  if (a < 0) a = f32(a + 360);
  if (a === 0 || a === 90 || a === 180 || a === 270) return 0;
  // a is in (0, 360): the nearest hundredth of a degree by adding a half and truncating.
  const k = (a * 100 + 0.5) | 0;
  if (k < 0 || k >= 36000 || f32(k / 100) !== a) return null;
  const x = f32(f32(90 - a) * f32(f32(Math.PI) / 180));
  const hit = faults.libmTableIgnored === true ? undefined : TANF.get(f32Bits(x));
  return hit === undefined ? f32(Math.tan(x)) : f32FromBits(hit);
}

/** Rounds a double to float32 as a typed array stores it. */
function f32(v: number): number {
  F32[0] = v;
  return F32[0] as number;
}
const F32 = new Float32Array(1);

const bitsView = new DataView(new ArrayBuffer(4));
function f32Bits(f: number): number {
  bitsView.setFloat32(0, f);
  return bitsView.getUint32(0);
}
function f32FromBits(u: number): number {
  bitsView.setUint32(0, u);
  return bitsView.getFloat32(0);
}
const TANF: ReadonlyMap<number, number> = new Map(TANF_DIFFS.map(([x, y]) => [x, y] as const));

