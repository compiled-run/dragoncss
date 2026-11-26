// Factored states (analysis/link.ts StateGroup, export schema /2): a page whose states no element reads together compiles one table
// per group, and a phone that combines them (state-groups.ts composedNodes, harness.ts groupedVariant) shows exactly what the table
// of every assignment shows: each node's writes, each interaction state's, and the plan layout of each, on both targets.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { NO_INTERACTION_FAULTS, interactionStart, interactionState, keyboardFocused, pointerMoved, touchPressed } from '../../layout/src/rt-interaction.ts';
import type { InteractionTables } from '@dragon/layout';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import type { ExportAssignment, ExportNode, ExportTarget } from '../src/native-style-export.ts';
import { NATIVE_STYLE_EXPORT_SCHEMA, NATIVE_STYLE_EXPORT_SCHEMA_GROUPS, parseNativeStyleExport } from '../src/native-style-export.ts';
import { composedNodes, mergedOrder, tableEntries } from '../src/state-groups.ts';
import { repoPath } from '../src/paths.ts';

const { runMarklessLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessLayout(line: string): string };

const PATH = 'examples/markless-styles/input/groups.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');

const exportOf = (text: string, grouped: boolean, plan: boolean) => {
  if (grouped) process.env['DRAGON_STATE_GROUPS'] = 'always';
  else delete process.env['DRAGON_STATE_GROUPS'];
  try {
    return marklessStyleExport(text, PATH, undefined, plan ? 'system' : 'pinned', undefined, plan).exported;
  } finally {
    delete process.env['DRAGON_STATE_GROUPS'];
  }
};
afterEach(() => {
  delete process.env['DRAGON_STATE_GROUPS'];
});

type Input = { nodes: Record<string, unknown>[]; css: string; branches: Record<string, unknown>[] };
/** The groups fixture with more nodes, CSS and branches. */
const variant = (f: (v: Input) => void): string => {
  const v = JSON.parse(TEXT) as Input;
  f(v);
  return JSON.stringify(v);
};
/** A value per combination of the fixture's two states. */
const byAB = (value: (a: boolean, b: boolean) => string | null) => [false, true].flatMap((a) => [false, true].map((b) => ({ when: { 'state:a': a, 'state:b': b }, value: value(a, b) })));

/** A node as a host applies it: everything but what the plan layout gives the phone at its own size. */
const applied = (nodes: readonly ExportNode[]): Map<string, string> =>
  new Map(nodes.map(({ frame: _frame, lines: _lines, scrollRange: _scroll, borderOps: _ops, ...n }) => [n.id, JSON.stringify(n)]));

type Event = 'hover' | 'touch' | 'focus';
/** The interaction state a table's runtime is in after one event on its element at index e; null when focus cannot reach it. */
const stateAfter = (t: InteractionTables, e: number, event: Event): number | null => {
  if (e < 0) return -1;
  if (event === 'focus' && t.focusable[e] !== true) return null;
  const s = event === 'hover' ? pointerMoved(t, interactionStart(), e) : event === 'touch' ? touchPressed(t, interactionStart(), e, NO_INTERACTION_FAULTS) : keyboardFocused(t, interactionStart(), e);
  return interactionState(t, s);
};

/** Every assignment and interaction state of the product against the combined tables: nodes, and with plan the phone's layout. */
function expectCombines(text: string, plan: boolean): number {
  const product = exportOf(text, false, plan);
  const grouped = exportOf(text, true, plan);
  expect(product.schema).toBe(NATIVE_STYLE_EXPORT_SCHEMA);
  expect(grouped.schema).toBe(NATIVE_STYLE_EXPORT_SCHEMA_GROUPS);
  expect(() => parseNativeStyleExport(JSON.stringify(grouped))).not.toThrow();
  let compared = 0;
  for (const t of ['ios', 'android'] as const) {
    const p = product.targets[t] as ExportTarget;
    const g = grouped.targets[t] as ExportTarget;
    expect(p.groups).toBeUndefined();
    expect(g.groups?.length).toBeGreaterThan(1);
    const tables = [g, ...(g.groups ?? [])];
    const planOf = (x: ExportTarget) => x.plan as NonNullable<ExportTarget['plan']>;
    const firsts = plan ? [0, ...(planOf(g).groups ?? []).map((x) => x.first)] : [];
    if (plan) (g.groups ?? []).forEach((x, k) => expect(x.planNames?.length, `group ${k} names`).toBe(planOf(g).groups?.[k]?.count));
    const dpr = plan ? (planOf(p).densities[0] as { dpr: number }).dpr : 0;
    const layout = (x: ExportTarget, extra: object): string => runMarklessLayout(JSON.stringify({ dpr, viewport: p.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: planOf(x), ...extra }));
    for (const [i, a] of p.assignments.entries()) {
      const at = tableEntries(g, a.values);
      expect(applied(composedNodes(g, a.values)), `${t} ${JSON.stringify(a.values)}`).toEqual(applied(a.nodes));
      if (plan) {
        const want = layout(p, { assignment: i });
        expect(want.startsWith('["ok"'), want.slice(0, 200)).toBe(true);
        expect(layout(g, { assignment: at[0], groups: at.slice(1) }), `${t} ${JSON.stringify(a.values)} layout`).toBe(want);
      }
      compared++;
      const level = p.interaction?.levels[i];
      if (level === undefined) continue;
      level.addresses.forEach((address, e) => {
        for (const event of ['hover', 'touch', 'focus'] as const) {
          const k = stateAfter(level.tables, e, event);
          if (k === null) continue;
          const stateIn = (ti: number): number => {
            const l = (tables[ti] as ExportTarget).interaction?.levels[at[ti] as number];
            const kk = l === undefined ? -1 : stateAfter(l.tables, l.addresses.indexOf(address), event);
            return kk === null ? -1 : kk;
          };
          const shownIn = (ti: number, entry: number): ExportAssignment => {
            const table = tables[ti] as ExportTarget;
            const kk = stateIn(ti);
            return kk < 0 ? (table.assignments[entry] as ExportAssignment) : (table.interaction?.levels[entry]?.states[kk] as ExportAssignment);
          };
          const want = k < 0 ? a.nodes : (level.states[k] as ExportAssignment).nodes;
          expect(applied(composedNodes(g, a.values, shownIn)), `${t} ${JSON.stringify(a.values)} ${event} ${address}`).toEqual(applied(want));
          if (plan) {
            const entries = tables.map((x, ti) => {
              const kk = stateIn(ti);
              return kk < 0 ? (at[ti] as number) : ((x.interaction?.levels[at[ti] as number]?.planAssignments as number[])[kk] as number) - (firsts[ti] as number);
            });
            expect(layout(g, { assignment: entries[0], groups: entries.slice(1) }), `${t} ${JSON.stringify(a.values)} ${event} ${address} layout`).toBe(layout(p, { assignment: k < 0 ? i : (level.planAssignments as number[])[k] }));
          }
          compared++;
        }
      });
    }
  }
  return compared;
}

describe('factored states', () => {
  it('orders the ids of several lists as each list does', () => {
    expect(mergedOrder([['a', 'c'], ['b', 'c'], ['a', 'b']])).toEqual(['a', 'b', 'c']);
    expect(() => mergedOrder([['a', 'b'], ['b', 'a']])).toThrow('both before and after');
  });

  for (const name of ['groups', 'arms', 'tabs']) {
    it(`combines ${name}'s tables into every assignment and interaction state, nodes and layout`, () => {
      expect(expectCombines(readFileSync(repoPath(`examples/markless-styles/input/${name}.native-style-input.json`), 'utf8'), true)).toBeGreaterThan(0);
    });
  }

  it('gives a group the elements its states change only under :hover, :active or :focus', () => {
    // h6 depends on state a only through its :hover colour.
    const text = variant((v) => {
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'button', parent: 'h0', attributes: { type: 'button' }, classByState: byAB((a) => (a ? 't x mk-g' : 't mk-g')) },
        { kind: 'text', id: 'h6:text0', parent: 'h6', text: 'Gamma' },
      );
      v.css += '\n.x.mk-g:hover { background-color: #ff0000; }\n';
    });
    expect(expectCombines(text, true)).toBeGreaterThan(200);
  });

  it("gives a select's shown option the states of every option", () => {
    const text = variant((v) => {
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'select', parent: 'h0', attributes: { class: 'pick mk-g' } },
        { kind: 'element', id: 'h7', element: 'option', parent: 'h6', attributes: {}, attributesByState: { disabled: byAB((a) => (a ? '' : null)) } },
        { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'One' },
        { kind: 'element', id: 'h8', element: 'option', parent: 'h6', attributes: {}, attributesByState: { disabled: byAB((_a, b) => (b ? '' : null)) } },
        { kind: 'text', id: 'h8:text0', parent: 'h8', text: 'Two' },
        { kind: 'element', id: 'h9', element: 'option', parent: 'h6', attributes: {} },
        { kind: 'text', id: 'h9:text0', parent: 'h9', text: 'Three' },
      );
      v.css += '\n.pick.mk-g { appearance: none; font-family: inherit; font-size: 16px; border: 1px solid #222222; background-color: #ffffff; }\n';
    });
    const g = exportOf(text, true, false).targets.ios as ExportTarget;
    expect(g.groups?.some((x) => x.groupStates.includes('state:a') && x.groupStates.includes('state:b'))).toBe(true);
    expect(expectCombines(text, true)).toBeGreaterThan(0);
  });

  it('lays a text out where its branch moves it into an anonymous box', () => {
    const text = variant((v) => {
      v.branches.push({ id: 'branch-site:1', domain: ['0', '1'], initial: '1' });
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'div', parent: 'h0', attributes: {} },
        { kind: 'text', id: 'h6:text0', parent: 'h6', text: 'Hello there' },
        { kind: 'element', id: 'h7', element: 'div', parent: 'h6', attributes: {}, arm: { branch: 'branch-site:1', index: 0 } },
        { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'Block', arm: { branch: 'branch-site:1', index: 0 } },
      );
    });
    expect(expectCombines(text, true)).toBeGreaterThan(0);
  });

  it("lays a box's dashed border out with the colours its group gives it", () => {
    const text = variant((v) => {
      v.css += '\n.t.mk-g { border-style: dashed; }\n.t.mk-g[aria-pressed="true"] { border-left-color: rgba(255, 0, 0, 0.5); }\n';
    });
    expect(expectCombines(text, true)).toBeGreaterThan(0);
  });

  it('gives a group whose elements style alike in every @media band one row per assignment', () => {
    const g = exportOf(TEXT, true, false).targets.ios as ExportTarget;
    expect((g.groups ?? []).map((x) => [x.groupStates, x.assignments.length])).toEqual([[['state:a'], 4], [['state:b'], 4], [['branch-site:0'], 2]]);
  });

  it('does not refuse a paragraph that only one group changes beside text no group changes', () => {
    const text = variant((v) => {
      v.branches.push({ id: 'branch-site:1', domain: ['0', '1'], initial: '1' });
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'p', parent: 'h0', attributes: { class: 'note mk-g' } },
        { kind: 'text', id: 'h6:text0', parent: 'h6', text: 'Hello ' },
        { kind: 'text', id: 'h6:text1', parent: 'h6', text: 'there', arm: { branch: 'branch-site:1', index: 0 } },
      );
    });
    // The engine refuses two texts in one paragraph today; the group rule must not be what refuses it.
    expect(() => exportOf(text, true, false)).not.toThrow('changes with more than one group of states');
  });

  it('refuses a paragraph whose text two groups change, which a phone could not shape', () => {
    const text = variant((v) => {
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'p', parent: 'h0', attributes: { class: 'note mk-g' } },
        { kind: 'element', id: 'h7', element: 'span', parent: 'h6', attributes: {}, classByState: byAB((a) => (a ? 'bold mk-g' : 'mk-g')) },
        { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'One' },
        { kind: 'text', id: 'h6:text0', parent: 'h6', text: ' and ' },
        { kind: 'element', id: 'h8', element: 'span', parent: 'h6', attributes: {}, classByState: byAB((_a, b) => (b ? 'bold mk-g' : 'mk-g')) },
        { kind: 'text', id: 'h8:text0', parent: 'h8', text: 'two' },
      );
      v.css += '\n.bold.mk-g { font-weight: 700; }\n';
    });
    expect(() => exportOf(text, true, false)).toThrow('changes with more than one group of states, and a phone shapes a paragraph only as Dragon laid it out');
  });
});
