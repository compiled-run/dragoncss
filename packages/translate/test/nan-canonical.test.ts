// PM ruling 2026-10-04: in the bit-exact corpus comparison a NaN matches any NaN (JavaScript gives NaN bits no meaning; x86-64 and
// arm64 differ in their sign), and nothing else is loosened.
import { describe, expect, it } from 'vitest';
import { canonicalNan, sameResult } from '../src/corpus.ts';

const line = (...bits: string[]): string => JSON.stringify(['ok', ...bits]);

describe('NaN in the corpus comparison', () => {
  it('matches any NaN with any NaN: sign, quiet bit and payload (units-m2 #45946 and #46835 on the x86_64 emulator)', () => {
    expect(sameResult(line('fff8000000000000'), line('7ff8000000000000'))).toBe(true);
    expect(sameResult(line('7ff8000000000000'), line('7ff0000000000001'))).toBe(true);
    expect(sameResult(line('fff8000000000000', '3ff0000000000000'), line('7ff8000000000000', '3ff0000000000000'))).toBe(true);
    expect(canonicalNan(JSON.stringify(['zoomFontSize', 'fff8000000000000', '7ff8000000000000']))).toBe(JSON.stringify(['zoomFontSize', '7ff8000000000000', '7ff8000000000000']));
  });
  it('still fails a mismatch of numbers, a NaN against a number, infinities and -0 against +0', () => {
    expect(sameResult(line('3ff0000000000000'), line('3ff0000000000001'))).toBe(false);
    expect(sameResult(line('7ff8000000000000'), line('3ff0000000000000'))).toBe(false);
    expect(sameResult(line('3ff0000000000000'), line('fff8000000000000'))).toBe(false);
    expect(sameResult(line('7ff0000000000000'), line('fff0000000000000'))).toBe(false);
    expect(sameResult(line('7ff0000000000000'), line('7ff8000000000000'))).toBe(false);
    expect(sameResult(line('8000000000000000'), line('0000000000000000'))).toBe(false);
    expect(sameResult(line('fff8000000000000', '3ff0000000000000'), line('7ff8000000000000', '4000000000000000'))).toBe(false);
    expect(canonicalNan('["ok","8000000000000000","fff0000000000000"]')).toBe('["ok","8000000000000000","fff0000000000000"]');
  });
  it('leaves tokens that are not 16 hex digits alone', () => {
    expect(canonicalNan('["fff8000000000000x","fff800000000000"]')).toBe('["fff8000000000000x","fff800000000000"]');
  });
});
