// TXT2-c (notes/T149-txt2-spec.md R3): phase I of the white space processing rules for the preserving modes, and the refusals the
// compiler keeps (a tab, a preserved control character, all-white-space preserved text). Chrome proves the layouts in
// packages/parity/test/white-space.test.ts.
import { describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS, phaseOne } from '../src/internal.ts';
import { div, inputFor, text } from './helpers.ts';

describe('phase I for the preserving modes (css-text-3 §4.1.1)', () => {
  it('keeps preserve and break-spaces text unchanged', () => {
    for (const mode of ['preserve', 'break-spaces']) expect(phaseOne('  a  \n\n b ', mode, NO_FAULTS)).toBe('  a  \n\n b ');
  });
  it('preserve-breaks keeps each U+000A, collapses spaces and tabs to one space and removes the spaces around each segment break', () => {
    expect(phaseOne('  a \t b  \n  c\n\nd  ', 'preserve-breaks', NO_FAULTS)).toBe('a b\nc\n\nd');
    expect(phaseOne('a', 'preserve-breaks', NO_FAULTS)).toBe('a');
  });
  it('the planted preLineKeepsSpaceBeforeNewline keeps the space before each U+000A, and only there', () => {
    expect(phaseOne(' a  \n b ', 'preserve-breaks', { ...NO_FAULTS, preLineKeepsSpaceBeforeNewline: true })).toBe('a \nb');
  });
});

function errorsOf(css: string, value: string): { code: string; message: string }[] {
  const input = inputFor(css, (r) => [div(r, 'a', ['a'], [text(r, 't', value)])]);
  const c = createProjectWith({ projectId: 'test', targets: { web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => ({ code: d.code, message: d.message }));
}

describe('preserved text the compiler refuses', () => {
  it('compiles pre text with spaces and line feeds for web (support profiles derived; the rows come from the Chrome cases)', () => {
    expect(errorsOf('.a { white-space: pre; }', 'XX  XX\nX')).toEqual([]);
  });
  it('refuses a tab (tab-size is TXT2-c3), a preserved control character and all-white-space preserved text', () => {
    const one = (css: string, value: string): string => {
      const e = errorsOf(css, value);
      expect(e.length, value).toBe(1);
      return `${e[0]?.code} ${e[0]?.message.split(' ').slice(0, 2).join(' ')}`;
    };
    expect(one('.a { white-space: pre; }', 'XX\tXX')).toBe('DRAGON_UNSUPPORTED_VALUE a tab');
    expect(one('.a { white-space: pre-wrap; }', 'XX\fXX')).toBe('DRAGON_UNSUPPORTED_VALUE U+000C in');
    expect(one('.a { white-space: break-spaces; }', '  \n ')).toMatch(/^DRAGON_UNSUPPORTED_VALUE /);
  });
  it('leaves a tab in collapsed text alone (phase I turns it into a space)', () => {
    expect(errorsOf('.a { white-space: normal; }', 'XX\tXX')).toEqual([]);
  });
});
