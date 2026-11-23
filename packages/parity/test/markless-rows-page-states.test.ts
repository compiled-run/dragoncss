// A select's options follow its open state and their own selected state; the select lists the row state as a key it ignores.
import { describe, expect, it } from 'vitest';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { MARKLESS_STYLE_INPUT_VERSION, marklessWithRows } from '../src/markless-style-input.ts';

const OPEN = 'select.open';
const SELECTED = 'h4#ui-selected';
const combos = [false, true].flatMap((open) => ['0', '1'].map((selected) => ({ [OPEN]: open, [SELECTED]: selected })));

function input(optionValue: (open: boolean, selected: string) => string | null): MarklessStyleInput {
  return {
    version: MARKLESS_STYLE_INPUT_VERSION,
    component: 'Picker',
    css: '',
    states: [
      { cell: OPEN, domain: [false, true], initial: false },
      { cell: SELECTED, domain: ['0', '1'], initial: '0', row: 'repeat:0' },
    ],
    repeats: [{ id: 'repeat:0', parent: 'list' }],
    nodes: [
      { kind: 'element', id: 'root', element: 'div', parent: null, attributes: {}, attributesByState: { 'ui-open': combos.map((when) => ({ when, value: when[OPEN] ? '' : null })) } },
      { kind: 'element', id: 'list', element: 'div', parent: 'root', attributes: {} },
      { kind: 'element', id: 'h4', element: 'div', parent: 'list', row: 'repeat:0', attributes: { role: 'option' }, attributesByState: { 'ui-selected': combos.map((when) => ({ when, value: optionValue(when[OPEN] as boolean, when[SELECTED] as string) })) } },
    ],
  } as MarklessStyleInput;
}

const rows = new Map([['repeat:0', [
  { key: 'a', states: { [SELECTED]: '1' }, texts: new Map<string, string>() },
  { key: 'b', states: { [SELECTED]: '0' }, texts: new Map<string, string>() },
]]]);

describe('rows written out where a by-state list also follows a page state', () => {
  it("gives a row its own value where its list follows only the row's state, as before", () => {
    const out = marklessWithRows(input((_open, selected) => (selected === '1' ? '' : null)), rows);
    const a = out.nodes.find((n) => n.id === 'h4@a');
    const b = out.nodes.find((n) => n.id === 'h4@b');
    expect(a).toMatchObject({ attributes: { role: 'option', 'ui-selected': '' } });
    expect(b).toMatchObject({ attributes: { role: 'option' } });
    expect(a && 'attributesByState' in a ? a.attributesByState : undefined).toBeUndefined();
  });

  it('keeps a row a by-state list over the page state where the value follows it too', () => {
    const out = marklessWithRows(input((open, selected) => (open && selected === '1' ? '' : null)), rows);
    const a = out.nodes.find((n) => n.id === 'h4@a') as { readonly attributesByState?: unknown };
    expect(a.attributesByState).toEqual({ 'ui-selected': [{ when: { [OPEN]: false }, value: null }, { when: { [OPEN]: true }, value: '' }] });
  });

  it('drops the row state from a list outside the rows that ignores it, and refuses one that follows it', () => {
    const out = marklessWithRows(input(() => null), rows);
    const root = out.nodes.find((n) => n.id === 'root') as { readonly attributesByState?: unknown };
    expect(root.attributesByState).toEqual({ 'ui-open': [{ when: { [OPEN]: false }, value: null }, { when: { [OPEN]: true }, value: '' }] });
    expect(out.states.map((s) => s.cell)).toEqual([OPEN]);
    const follows = input(() => null);
    const broken = { ...follows, nodes: follows.nodes.map((n) => (n.id === 'root' ? { ...n, attributesByState: { 'ui-open': combos.map((when) => ({ when, value: when[SELECTED] === '1' ? '' : null })) } } : n)) } as MarklessStyleInput;
    expect(() => marklessWithRows(broken, rows)).toThrow("root: its by-state list follows a row's state outside the rows");
  });

  it("drops another list's row state from a row's list, and merges a list's entries whatever order their keys are in", () => {
    const OTHER = 'h9#ui-selected';
    const base = input((open, selected) => (open && selected === '1' ? '' : null));
    const four = (n: MarklessStyleInput['nodes'][number]) => {
      if (n.id !== 'h4' || n.kind !== 'element') return n;
      const list = n.attributesByState?.['ui-selected'] ?? [];
      return { ...n, attributesByState: { 'ui-selected': list.flatMap((e) => ['0', '1'].map((o) => ({ when: { [OTHER]: o, ...e.when }, value: e.value }))) } };
    };
    const twoLists = {
      ...base,
      states: [...base.states, { cell: OTHER, domain: ['0', '1'], initial: '0', row: 'repeat:1' }],
      repeats: [...(base.repeats ?? []), { id: 'repeat:1', parent: 'root' }],
      nodes: base.nodes.map(four),
    } as MarklessStyleInput;
    const out = marklessWithRows(twoLists, new Map([...rows, ['repeat:1', []]]));
    const a = out.nodes.find((n) => n.id === 'h4@a') as { readonly attributesByState?: unknown };
    expect(a.attributesByState).toEqual({ 'ui-selected': [{ when: { [OPEN]: false }, value: null }, { when: { [OPEN]: true }, value: '' }] });

    const PAGE = 'theme.dark';
    const reordered = {
      ...base,
      states: [{ cell: PAGE, domain: [false, true], initial: false }, ...base.states],
      nodes: base.nodes.map((n) =>
        n.id !== 'root' ? n : { ...n, attributesByState: { 'ui-open': combos.flatMap((when) => [false, true].map((dark) => ({ when: when[SELECTED] === '0' ? { [PAGE]: dark, ...when } : { ...when, [PAGE]: dark }, value: when[OPEN] ? '' : null }))) } },
      ),
    } as MarklessStyleInput;
    const root = marklessWithRows(reordered, rows).nodes.find((n) => n.id === 'root') as { readonly attributesByState?: { readonly 'ui-open': readonly unknown[] } };
    expect(root.attributesByState?.['ui-open']).toHaveLength(4);
  });
});
