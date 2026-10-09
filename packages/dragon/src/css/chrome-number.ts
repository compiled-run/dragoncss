// The one number formatting outside the ports and css/color.ts, exempted by path in ua.test.ts and s4b.test.ts (CASC 2).

/**
 * A computed <number>, <length> or <percentage> as Chrome 145 serialises it, and so substitutes it: six significant digits as C's
 * %g writes them (0.10000049 is 0.1, 123456789 is 1.23457e+08; probed). An <integer> keeps every digit (1234567 stays 1234567).
 */
export function chromeNumber(v: number): string {
  if (v === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(Number(v.toPrecision(6)))));
  if (exp < -4 || exp >= 6) {
    const [mantissa, e] = v.toExponential(5).split('e') as [string, string];
    const m = mantissa.includes('.') ? mantissa.replace(/\.?0+$/, '') : mantissa;
    const n = Number(e);
    return `${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  const fixed = v.toFixed(Math.max(0, 5 - exp));
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}
