// A union's generated class name must fit a JVM class file name (255 bytes with ".class"); short unions keep their readable name.
import { describe, expect, it } from 'vitest';
import { unionName } from '../src/lower.ts';

describe('unionName', () => {
  it('joins a short union\'s members', () => {
    expect(unionName(['A', 'B'])).toBe('U_A_B');
  });
  it('keeps a long union under the class file limit, distinct per member list', () => {
    const kinds = ['buttonBlock', 'checkbox', 'fieldset', 'legend', 'range', 'selectInner', 'selectMenulist', 'sliderThumb', 'textArea', 'textEditor', 'textField', 'textPlaceholder'].map((k) => `ControlKind_${k}`);
    const all = unionName(kinds);
    const less = unionName(kinds.filter((k) => k !== 'ControlKind_checkbox'));
    expect(`${all}.class`.length).toBeLessThanOrEqual(255);
    expect(all.startsWith('U_ControlKind_')).toBe(true);
    expect(all).not.toBe(less);
  });
});
