// NA-NATIVE: the north star's support accounting counts a declaration not applicable on native on its own and leaves it out of the
// denominator; it is never supported, and an error on the same declaration still blocks it.
import { describe, expect, it } from 'vitest';
import type { AccountedDiagnostic } from '../src/north-star-accounting.ts';
import { hitsOf, statusOn, supportNumbers } from '../src/north-star-accounting.ts';

const decl = (start: number, end: number, selector: { start: number; end: number } = { start: 0, end: 1 }) => ({ span: { start, end }, selectorSpan: selector, atRuleSpan: null });
const at = (start: number, end: number) => ({ start, end });
const na = (t: string, start: number, end: number): AccountedDiagnostic => ({ code: 'DRAGON_NOT_APPLICABLE_NATIVE', severity: 'info', target: t, css: at(start, end) });
const err = (target: string | null, start: number, end: number, code = 'DRAGON_UNSUPPORTED_PROPERTY'): AccountedDiagnostic => ({ code, severity: 'error', target, css: at(start, end) });

describe('north-star accounting (NA-NATIVE)', () => {
  // Four declarations: supported; cursor (NA on native, refused on web); a scrollbar rule's declaration (NA through its selector);
  // and an unsupported property refused everywhere.
  const decls = [decl(10, 20), decl(30, 40), decl(60, 70, at(50, 58)), decl(80, 90)];
  const diagnostics: AccountedDiagnostic[] = [
    err('web', 30, 40), na('ios', 30, 40), na('android', 30, 40),
    err('web', 52, 58, 'DRAGON_UNSUPPORTED_SELECTOR'), na('ios', 52, 58), na('android', 52, 58),
    err(null, 80, 90),
  ];
  const rows = decls.map((d) => {
    const hits = hitsOf(d, diagnostics);
    return { web: statusOn(hits, 'web'), ios: statusOn(hits, 'ios'), android: statusOn(hits, 'android') };
  });

  it('marks not-applicable declarations per native target and keeps web blocked', () => {
    expect(rows).toEqual([
      { web: 'supported', ios: 'supported', android: 'supported' },
      { web: 'blocked', ios: 'not-applicable', android: 'not-applicable' },
      { web: 'blocked', ios: 'not-applicable', android: 'not-applicable' },
      { web: 'blocked', ios: 'blocked', android: 'blocked' },
    ]);
  });

  it('counts them on their own and leaves them out of the denominator, never as supported', () => {
    expect(supportNumbers(rows)).toEqual({
      declarations: 4, notApplicableNative: 2, notApplicableIos: 2, notApplicableAndroid: 2, applicableDeclarations: 2,
      supportedBothTargets: 1, supportedWeb: 1, supportedIos: 1, supportedAndroid: 1, supportPercent: 50,
    });
  });

  it('an error on the declaration wins over the info, and an info for another target or every target does not count', () => {
    expect(statusOn([na('ios', 0, 1), err('ios', 0, 1)], 'ios')).toBe('blocked');
    expect(statusOn([na('android', 0, 1)], 'ios')).toBe('supported');
    expect(statusOn([{ ...na('ios', 0, 1), target: null }], 'ios')).toBe('supported');
    expect(statusOn([{ ...na('ios', 0, 1), severity: 'warning' }], 'ios')).toBe('supported');
  });

  it('an empty sheet has no support percentage rather than dividing by zero', () => {
    expect(supportNumbers([]).supportPercent).toBe(0);
  });
});
