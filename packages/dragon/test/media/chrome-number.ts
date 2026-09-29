// Chrome's number text in mediaText: six significant digits, as printf %g writes them.

export function chromeNumber(x: number): string {
  if (x === 0) return '0';
  const [mantissa, expText] = x.toExponential(5).split('e') as [string, string];
  const exp = Number(expText);
  const trim = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (exp < -4 || exp >= 6) return `${trim(mantissa)}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  return trim(x.toFixed(5 - exp));
}
