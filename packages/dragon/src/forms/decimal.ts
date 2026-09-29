// A port of Blink's Decimal (platform/wtf/decimal.cc at Chrome 145.0.7632.6): 18-digit decimal coefficient, base-10 exponent.
// Range values are computed in this arithmetic, so value strings match Chrome's serialisation digit for digit.

const EXPONENT_MAX = 1023;
const EXPONENT_MIN = -1023;
const PRECISION = 18;
const MAX_COEFFICIENT = 999_999_999_999_999_999n;
const UINT64 = 1n << 64n;

type FormatClass = 'normal' | 'zero' | 'infinity' | 'nan';

export class Decimal {
  readonly cls: FormatClass;
  readonly negative: boolean;
  readonly exponent: number;
  readonly coefficient: bigint;

  private constructor(cls: FormatClass, negative: boolean, exponent: number, coefficient: bigint) {
    this.cls = cls;
    this.negative = negative;
    this.exponent = exponent;
    this.coefficient = coefficient;
  }

  /** EncodedData(sign, exponent, coefficient): drops digits beyond 18, then overflows to infinity or underflows to zero. */
  static of(negative: boolean, exponent: number, coefficient: bigint): Decimal {
    let e = exponent;
    let c = coefficient;
    if (e >= EXPONENT_MIN && e <= EXPONENT_MAX) {
      while (c > MAX_COEFFICIENT) {
        c /= 10n;
        e++;
      }
    }
    if (e > EXPONENT_MAX) return new Decimal('infinity', negative, 0, 0n);
    if (e < EXPONENT_MIN) return new Decimal('zero', negative, 0, 0n);
    return new Decimal(c === 0n ? 'zero' : 'normal', negative, e, c);
  }

  static int(i: number): Decimal {
    return Decimal.of(i < 0, 0, BigInt(Math.abs(i)));
  }

  static zero(negative = false): Decimal {
    return new Decimal('zero', negative, 0, 0n);
  }

  static infinity(negative: boolean): Decimal {
    return new Decimal('infinity', negative, 0, 0n);
  }

  static nan(): Decimal {
    return new Decimal('nan', false, 0, 0n);
  }

  isFinite(): boolean {
    return this.cls === 'normal' || this.cls === 'zero';
  }
  isNaN(): boolean {
    return this.cls === 'nan';
  }
  isZero(): boolean {
    return this.cls === 'zero';
  }
  isSpecial(): boolean {
    return this.cls === 'infinity' || this.cls === 'nan';
  }

  neg(): Decimal {
    if (this.isNaN()) return this;
    return new Decimal(this.cls, !this.negative, this.exponent, this.coefficient);
  }

  abs(): Decimal {
    return new Decimal(this.cls, false, this.exponent, this.coefficient);
  }

  add(rhs: Decimal): Decimal {
    const special = specials(this, rhs);
    if (special !== null) {
      if (special === 'both-infinity') return this.negative === rhs.negative ? this : Decimal.nan();
      if (special === 'lhs') return this;
      return rhs;
    }
    const a = align(this, rhs);
    const result = this.negative === rhs.negative ? a.lhs + a.rhs : a.lhs - a.rhs;
    if (this.negative && !rhs.negative && result === 0n) return Decimal.of(false, a.exponent, 0n);
    return result >= 0n ? Decimal.of(this.negative, a.exponent, result) : Decimal.of(!this.negative, a.exponent, -result);
  }

  sub(rhs: Decimal): Decimal {
    const special = specials(this, rhs);
    if (special !== null) {
      if (special === 'both-infinity') return this.negative === rhs.negative ? Decimal.nan() : this;
      if (special === 'lhs') return this;
      if (special === 'rhs-nan') return rhs;
      return Decimal.infinity(!rhs.negative);
    }
    const a = align(this, rhs);
    const result = this.negative === rhs.negative ? a.lhs - a.rhs : a.lhs + a.rhs;
    if (this.negative && rhs.negative && result === 0n) return Decimal.of(false, a.exponent, 0n);
    return result >= 0n ? Decimal.of(this.negative, a.exponent, result) : Decimal.of(!this.negative, a.exponent, -result);
  }

  mul(rhs: Decimal): Decimal {
    const negative = this.negative !== rhs.negative;
    const special = specials(this, rhs);
    if (special === null) {
      let e = this.exponent + rhs.exponent;
      let work = this.coefficient * rhs.coefficient;
      while (work >= UINT64) {
        work /= 10n;
        e++;
      }
      return Decimal.of(negative, e, work);
    }
    if (special === 'both-infinity') return Decimal.infinity(negative);
    if (special === 'lhs' && this.isNaN()) return this;
    if (special === 'rhs-nan') return rhs;
    if (special === 'lhs') return rhs.isZero() ? Decimal.nan() : Decimal.infinity(negative);
    return this.isZero() ? Decimal.nan() : Decimal.infinity(negative);
  }

  div(rhs: Decimal): Decimal {
    const negative = this.negative !== rhs.negative;
    const special = specials(this, rhs);
    if (special !== null) {
      if (special === 'both-infinity') return Decimal.nan();
      if (special === 'lhs' && this.isNaN()) return this;
      if (special === 'rhs-nan') return rhs;
      if (special === 'lhs') return Decimal.infinity(negative);
      return Decimal.zero(negative);
    }
    if (rhs.isZero()) return this.isZero() ? Decimal.nan() : Decimal.infinity(negative);
    let e = this.exponent - rhs.exponent;
    if (this.isZero()) return Decimal.of(negative, e, 0n);
    let remainder = this.coefficient;
    const divisor = rhs.coefficient;
    let result = 0n;
    for (;;) {
      while (remainder < divisor && result < MAX_COEFFICIENT / 10n) {
        remainder *= 10n;
        result *= 10n;
        e--;
      }
      if (remainder < divisor) break;
      const quotient = remainder / divisor;
      if (result > MAX_COEFFICIENT - quotient) break;
      result += quotient;
      remainder %= divisor;
      if (remainder === 0n) break;
    }
    if (remainder > divisor / 2n) result++;
    return Decimal.of(negative, e, result);
  }

  /** CompareTo: the difference, with infinities mapped to ±1 and zero made positive. */
  private compareTo(rhs: Decimal): Decimal {
    const d = this.sub(rhs);
    if (d.cls === 'infinity') return Decimal.int(d.negative ? -1 : 1);
    if (d.cls === 'zero') return Decimal.zero();
    return d;
  }

  private sameData(rhs: Decimal): boolean {
    return this.negative === rhs.negative && this.cls === rhs.cls && this.exponent === rhs.exponent && this.coefficient === rhs.coefficient;
  }

  eq(rhs: Decimal): boolean {
    return this.sameData(rhs) || this.compareTo(rhs).isZero();
  }
  lt(rhs: Decimal): boolean {
    const r = this.compareTo(rhs);
    return !r.isNaN() && !r.isZero() && r.negative;
  }
  le(rhs: Decimal): boolean {
    if (this.sameData(rhs)) return true;
    const r = this.compareTo(rhs);
    return !r.isNaN() && (r.isZero() || r.negative);
  }
  gt(rhs: Decimal): boolean {
    const r = this.compareTo(rhs);
    return !r.isNaN() && !r.isZero() && !r.negative;
  }
  ge(rhs: Decimal): boolean {
    if (this.sameData(rhs)) return true;
    const r = this.compareTo(rhs);
    return !r.isNaN() && (r.isZero() || !r.negative);
  }

  /** Round(): half away from zero, deciding on the first dropped digit only. */
  round(): Decimal {
    if (this.isSpecial() || this.exponent >= 0) return this;
    let result = this.coefficient;
    const digits = countDigits(result);
    const drop = -this.exponent;
    if (digits < drop) return Decimal.zero();
    result = scaleDown(result, drop - 1);
    if (result % 10n >= 5n) result += 10n;
    result /= 10n;
    return Decimal.of(this.negative, 0, result);
  }

  /** ToString(): at most DBL_DIG (15) significant digits when the exponent is negative, else the exponent form Blink writes. */
  toString(): string {
    if (this.cls === 'infinity') return this.negative ? '-Infinity' : 'Infinity';
    if (this.cls === 'nan') return 'NaN';
    let out = this.negative ? '-' : '';
    let e = this.exponent;
    let c = this.coefficient;
    if (e < 0) {
      let last = 0n;
      while (countDigits(c) > 15) {
        last = c % 10n;
        c /= 10n;
        e++;
      }
      if (last >= 5n) c++;
      while (e < 0 && c !== 0n && c % 10n === 0n) {
        c /= 10n;
        e++;
      }
    }
    const digits = c.toString();
    let length = digits.length;
    const adjusted = e + length - 1;
    if (e <= 0 && adjusted >= -6) {
      if (e === 0) return out + digits;
      if (adjusted >= 0) {
        for (let i = 0; i < length; i++) {
          out += digits[i];
          if (i === adjusted) out += '.';
        }
        return out;
      }
      out += '0.';
      for (let i = adjusted + 1; i < 0; i++) out += '0';
      return out + digits;
    }
    out += digits[0];
    while (length >= 2 && digits[length - 1] === '0') length--;
    if (length >= 2) out += `.${digits.slice(1, length)}`;
    if (adjusted !== 0) out += `${adjusted < 0 ? 'e' : 'e+'}${adjusted}`;
    return out;
  }

  /** ToDouble(): the double the serialisation parses to. */
  toDouble(): number {
    if (this.isFinite()) return Number(this.toString());
    if (this.cls === 'infinity') return this.negative ? -Infinity : Infinity;
    return NaN;
  }

  /** FromString: Blink's state machine (a leading '+' is accepted here; the number-type parser rejects it first). */
  static fromString(str: string): Decimal {
    let exponent = 0;
    let exponentNegative = false;
    let digitCount = 0;
    let digitsAfterDot = 0;
    let extraDigits = 0;
    let negative = false;
    type State = 'digit' | 'dot' | 'dotDigit' | 'e' | 'eDigit' | 'eSign' | 'sign' | 'start' | 'zero';
    let state: State = 'start';
    let acc = 0n;
    const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
    for (const ch of str) {
      switch (state) {
        case 'digit':
          if (isDigit(ch)) {
            if (digitCount < PRECISION) {
              digitCount++;
              acc = acc * 10n + BigInt(ch);
            } else extraDigits++;
            break;
          }
          if (ch === '.') state = 'dot';
          else if (ch === 'e' || ch === 'E') state = 'e';
          else return Decimal.nan();
          break;
        case 'dot':
        case 'dotDigit':
          if (isDigit(ch)) {
            if (digitCount < PRECISION) {
              digitCount++;
              digitsAfterDot++;
              acc = acc * 10n + BigInt(ch);
            }
            state = 'dotDigit';
            break;
          }
          if (ch === 'e' || ch === 'E') state = 'e';
          else return Decimal.nan();
          break;
        case 'e':
          if (ch === '+' || ch === '-') {
            exponentNegative = ch === '-';
            state = 'eSign';
          } else if (isDigit(ch)) {
            exponent = Number(ch);
            state = 'eDigit';
          } else return Decimal.nan();
          break;
        case 'eDigit':
          if (isDigit(ch)) {
            exponent = exponent * 10 + Number(ch);
            if (exponent > EXPONENT_MAX + PRECISION) {
              if (acc !== 0n) return exponentNegative ? Decimal.zero() : Decimal.infinity(negative);
              return Decimal.zero(negative);
            }
            break;
          }
          return Decimal.nan();
        case 'eSign':
          if (isDigit(ch)) {
            exponent = Number(ch);
            state = 'eDigit';
            break;
          }
          return Decimal.nan();
        case 'sign':
          if (ch >= '1' && ch <= '9') {
            acc = BigInt(ch);
            digitCount = 1;
            state = 'digit';
          } else if (ch === '0') state = 'zero';
          else if (ch === '.') state = 'dot';
          else return Decimal.nan();
          break;
        case 'start':
          if (ch >= '1' && ch <= '9') {
            acc = BigInt(ch);
            digitCount = 1;
            state = 'digit';
          } else if (ch === '-' || ch === '+') {
            negative = ch === '-';
            state = 'sign';
          } else if (ch === '0') state = 'zero';
          else if (ch === '.') state = 'dot';
          else return Decimal.nan();
          break;
        case 'zero':
          if (ch === '0') break;
          if (ch >= '1' && ch <= '9') {
            acc = BigInt(ch);
            digitCount = 1;
            state = 'digit';
          } else if (ch === '.') state = 'dot';
          else if (ch === 'e' || ch === 'E') state = 'e';
          else return Decimal.nan();
          break;
      }
    }
    if (state === 'zero') return Decimal.zero(negative);
    if (state === 'digit' || state === 'eDigit' || state === 'dotDigit') {
      let e = exponent * (exponentNegative ? -1 : 1) - digitsAfterDot + extraDigits;
      if (e < EXPONENT_MIN) return Decimal.zero();
      const overflow = e - EXPONENT_MAX + 1;
      if (overflow > 0) {
        if (overflow + digitCount - digitsAfterDot > PRECISION) return Decimal.infinity(negative);
        acc = scaleUp(acc, overflow);
        e -= overflow;
      }
      return Decimal.of(negative, e, acc);
    }
    return Decimal.nan();
  }
}

type Special = 'both-infinity' | 'lhs' | 'rhs' | 'rhs-nan';

/** SpecialValueHandler: null when both are finite; 'lhs' when the lhs is NaN or the only infinity. */
function specials(lhs: Decimal, rhs: Decimal): Special | null {
  if (lhs.isFinite() && rhs.isFinite()) return null;
  if (lhs.isNaN()) return 'lhs';
  if (rhs.isNaN()) return 'rhs-nan';
  if (lhs.cls === 'infinity') return rhs.cls === 'infinity' ? 'both-infinity' : 'lhs';
  return 'rhs';
}

function countDigits(x: bigint): number {
  return x === 0n ? 0 : x.toString().length;
}

function scaleDown(x: bigint, n: number): bigint {
  let v = x;
  for (let k = n; k > 0 && v !== 0n; k--) v /= 10n;
  return v;
}

function scaleUp(x: bigint, n: number): bigint {
  return x * 10n ** BigInt(n);
}

function align(lhs: Decimal, rhs: Decimal): { exponent: number; lhs: bigint; rhs: bigint } {
  let exponent = Math.min(lhs.exponent, rhs.exponent);
  let l = lhs.coefficient;
  let r = rhs.coefficient;
  if (lhs.exponent > rhs.exponent) {
    const digits = countDigits(l);
    if (digits > 0) {
      const shift = lhs.exponent - rhs.exponent;
      const overflow = digits + shift - PRECISION;
      if (overflow <= 0) l = scaleUp(l, shift);
      else {
        l = scaleUp(l, shift - overflow);
        r = scaleDown(r, overflow);
        exponent += overflow;
      }
    }
  } else if (lhs.exponent < rhs.exponent) {
    const digits = countDigits(r);
    if (digits > 0) {
      const shift = rhs.exponent - lhs.exponent;
      const overflow = digits + shift - PRECISION;
      if (overflow <= 0) r = scaleUp(r, shift);
      else {
        r = scaleUp(r, shift - overflow);
        l = scaleDown(l, overflow);
        exponent += overflow;
      }
    }
  }
  return { exponent, lhs: l, rhs: r };
}

export function dmax(a: Decimal, b: Decimal): Decimal {
  return a.lt(b) ? b : a;
}

export function dmin(a: Decimal, b: Decimal): Decimal {
  return b.lt(a) ? b : a;
}
