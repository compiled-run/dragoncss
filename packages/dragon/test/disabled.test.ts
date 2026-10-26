// FORM-c: HTML §4.10.18.5's actually-disabled rule, which :disabled and :enabled read (analysis/match.ts isActuallyDisabled).
import { describe, expect, it } from 'vitest';
import type { LinkedElement } from '../src/analysis/link.ts';
import { isActuallyDisabled } from '../src/analysis/match.ts';

const el = (tag: string, attrs: Record<string, string> = {}, children: LinkedElement[] = []): LinkedElement => ({ kind: 'element', address: tag, node: null as never, instance: '', owner: '', tag, classes: [], attributes: new Map(Object.entries(attrs)), children });

describe('isActuallyDisabled', () => {
  it('a control with a disabled attribute of any value; never an element that cannot be disabled', () => {
    expect(isActuallyDisabled([el('div'), el('button', { disabled: '' })])).toBe(true);
    expect(isActuallyDisabled([el('div'), el('input', { disabled: 'false' })])).toBe(true);
    expect(isActuallyDisabled([el('div'), el('button')])).toBe(false);
    expect(isActuallyDisabled([el('div'), el('div', { disabled: '' })])).toBe(false);
    expect(isActuallyDisabled([el('div'), el('a', { disabled: '' })])).toBe(false);
  });

  it('a control inside a disabled fieldset, except inside its first legend', () => {
    const inFirst = el('button');
    const first = el('legend', {}, [inFirst]);
    const inSecond = el('button');
    const second = el('legend', {}, [inSecond]);
    const outside = el('input');
    const fieldset = el('fieldset', { disabled: '' }, [first, second, outside]);
    expect(isActuallyDisabled([fieldset, first, inFirst])).toBe(false);
    expect(isActuallyDisabled([fieldset, second, inSecond])).toBe(true);
    expect(isActuallyDisabled([fieldset, outside])).toBe(true);
    expect(isActuallyDisabled([fieldset])).toBe(true);
    const nested = el('fieldset', {}, [outside]);
    expect(isActuallyDisabled([el('fieldset', { disabled: '' }, [nested]), nested, outside])).toBe(true);
    expect(isActuallyDisabled([el('fieldset', {}, [outside]), outside])).toBe(false);
  });

  it('an option inside a disabled optgroup; a div inside a disabled fieldset is not', () => {
    const option = el('option');
    expect(isActuallyDisabled([el('optgroup', { disabled: '' }, [option]), option])).toBe(true);
    expect(isActuallyDisabled([el('optgroup', {}, [option]), option])).toBe(false);
    const d = el('div');
    expect(isActuallyDisabled([el('fieldset', { disabled: '' }, [d]), d])).toBe(false);
  });
});
