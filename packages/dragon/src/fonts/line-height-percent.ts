// CALC-2: line-height: <percentage> as Chrome 145 computes it, in Blink's float32 arithmetic (hence under src/fonts, exempt from
// the rounding boundary in ua.test.ts). The engine's model is layout units.ts lineHeightPercentPx.

/** StyleBuilderConverter::ConvertLineHeight: float(float(size) * int(percent)) / 100.0, stored as a float. */
export function lineHeightPercentPx(size: number, percent: number): number {
  const whole = Number.isNaN(percent) ? 0 : percent >= 2147483647 ? 2147483647 : percent <= -2147483648 ? -2147483648 : Math.trunc(percent);
  return Math.fround(Math.fround(Math.fround(size) * whole) / 100);
}
