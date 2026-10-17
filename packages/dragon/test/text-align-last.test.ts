// TXT2-tal compiler (analysis/text-align-last.ts): text-align-last is accepted where it aligns the last line as auto does, and
// refused on every target at its declaration otherwise; the planted fault alignLastAccepted accepts every value.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { inputFor, staticClass, DOC, text } from './helpers.ts';

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** The text-align-last refusals of a div d with the given text-align, text-align-last and direction, as `target message`. */
function refusals(align: string, last: string, direction: 'ltr' | 'rtl' = 'ltr', faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .w { width: 50px; text-align: ${align}; text-align-last: ${last}; direction: ${direction}; }`;
  const tree = (r: SourceRef) => [el(r, 'd', 'div', ['w'], [text(r, 't0', 'XX XXX XX XX')])];
  const out = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, tree));
  return out.diagnostics.filter((d) => d.message.startsWith('text-align-last')).map((d) => `${String(d.target)} ${d.message}`);
}

describe('text-align-last (TXT2-tal)', () => {
  it('accepts auto, and every value that aligns the last line as auto does', () => {
    const same: [string, string, 'ltr' | 'rtl'][] = [
      ['justify', 'auto', 'ltr'], ['justify', 'start', 'ltr'], ['justify', 'left', 'ltr'], ['justify', 'start', 'rtl'], ['justify', 'right', 'rtl'],
      ['center', 'center', 'ltr'], ['end', 'end', 'rtl'], ['end', 'left', 'rtl'], ['left', 'start', 'ltr'], ['right', 'right', 'rtl'], ['start', 'auto', 'rtl'],
    ];
    for (const [align, last, dir] of same) expect(refusals(align, last, dir), `${align} ${last} ${dir}`).toEqual([]);
  });
  it('refuses every other value on every target; alignLastAccepted accepts it', () => {
    const other: [string, string, 'ltr' | 'rtl', string][] = [
      ['left', 'justify', 'ltr', 'left'], ['justify', 'justify', 'ltr', 'left'], ['justify', 'end', 'ltr', 'left'], ['justify', 'left', 'rtl', 'right'],
      ['center', 'start', 'ltr', 'center'], ['start', 'center', 'rtl', 'right'],
    ];
    for (const [align, last, dir, at] of other) {
      const message = `text-align-last: ${last} on d:text0, whose text-align is ${align} in a ${dir} block: the engine aligns the last line as text-align-last: auto does, at ${at} (TXT2-tal)`;
      expect(refusals(align, last, dir), `${align} ${last} ${dir}`).toEqual([`ios ${message}`, `web ${message}`]);
      expect(refusals(align, last, dir, { ...NO_FAULTS, alignLastAccepted: true }), `${align} ${last} ${dir}`).toEqual([]);
    }
  });
});
