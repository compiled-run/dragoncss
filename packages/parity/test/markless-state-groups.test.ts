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
const INPUTS = ['groups', 'arms', 'tabs'].map((n) => `examples/markless-styles/input/${n}.native-style-input.json`);

const exportOf = (text: string, path: string, grouped: boolean, plan: boolean) => {
  if (grouped) process.env['DRAGON_STATE_GROUPS'] = 'always';
  else delete process.env['DRAGON_STATE_GROUPS'];
  try {
    return marklessStyleExport(text, path, undefined, plan ? 'system' : 'pinned', undefined, plan).exported;
  } finally {
    delete process.env['DRAGON_STATE_GROUPS'];
  }
};
afterEach(() => {
  delete process.env['DRAGON_STATE_GROUPS'];
});

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

describe('factored states', () => {
  it('orders the ids of several lists as each list does', () => {
    expect(mergedOrder([['a', 'c'], ['b', 'c'], ['a', 'b']])).toEqual(['a', 'b', 'c']);
    expect(() => mergedOrder([['a', 'b'], ['b', 'a']])).toThrow('both before and after');
  });

  for (const path of INPUTS) {
    describe(path, () => {
      const text = readFileSync(repoPath(path), 'utf8');
      const product = exportOf(text, path, false, false);
      const grouped = exportOf(text, path, true, false);

      it('writes schema /2 with groups only when its states are factored, and /1 otherwise', () => {
        expect(product.schema).toBe(NATIVE_STYLE_EXPORT_SCHEMA);
        expect(grouped.schema).toBe(NATIVE_STYLE_EXPORT_SCHEMA_GROUPS);
        expect(() => parseNativeStyleExport(JSON.stringify(grouped))).not.toThrow();
        for (const t of ['ios', 'android'] as const) {
          expect(product.targets[t]?.groups).toBeUndefined();
          expect(grouped.targets[t]?.groups?.length).toBeGreaterThan(1);
        }
      });

      it('combines its tables into the nodes of every assignment and every interaction state', () => {
        for (const t of ['ios', 'android'] as const) {
          const p = product.targets[t] as ExportTarget;
          const g = grouped.targets[t] as ExportTarget;
          const tables = [g, ...(g.groups ?? [])];
          for (const [i, a] of p.assignments.entries()) {
            expect(applied(composedNodes(g, a.values)), `${t} ${JSON.stringify(a.values)}`).toEqual(applied(a.nodes));
            const level = p.interaction?.levels[i];
            if (level === undefined) continue;
            const at = tableEntries(g, a.values);
            level.addresses.forEach((address, e) => {
              for (const event of ['hover', 'touch', 'focus'] as const) {
                const k = stateAfter(level.tables, e, event);
                if (k === null) continue;
                const shownIn = (ti: number, entry: number): ExportAssignment => {
                  const table = tables[ti] as Pick<ExportTarget, 'assignments' | 'interaction'>;
                  const l = table.interaction?.levels[entry];
                  const kk = l === undefined ? -1 : stateAfter(l.tables, l.addresses.indexOf(address), event);
                  return l === undefined || kk === null || kk < 0 ? (table.assignments[entry] as ExportAssignment) : (l.states[kk] as ExportAssignment);
                };
                const want = k < 0 ? a.nodes : (level.states[k] as ExportAssignment).nodes;
                expect(applied(composedNodes(g, a.values, shownIn)), `${t} ${JSON.stringify(a.values)} ${event} ${address}`).toEqual(applied(want));
                expect(at.length).toBe(tables.length);
              }
            });
          }
        }
      });
    });
  }

  it('lays every assignment and interaction state out on a phone as the product does, from one plan', () => {
    const product = exportOf(TEXT, PATH, false, true);
    const grouped = exportOf(TEXT, PATH, true, true);
    for (const t of ['ios', 'android'] as const) {
      const p = product.targets[t] as ExportTarget;
      const g = grouped.targets[t] as ExportTarget;
      const plan = (x: ExportTarget) => x.plan as NonNullable<ExportTarget['plan']>;
      const dpr = (plan(p).densities[0] as { dpr: number }).dpr;
      const layout = (x: ExportTarget, extra: object): string => runMarklessLayout(JSON.stringify({ dpr, viewport: p.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: plan(x), ...extra }));
      const tables = [g, ...(g.groups ?? [])];
      const firsts = [0, ...(plan(g).groups ?? []).map((x) => x.first)];
      let compared = 0;
      for (const [i, a] of p.assignments.entries()) {
        const at = tableEntries(g, a.values);
        const want = layout(p, { assignment: i });
        expect(want.startsWith('["ok"')).toBe(true);
        expect(layout(g, { assignment: at[0], groups: at.slice(1) }), `${t} ${JSON.stringify(a.values)}`).toBe(want);
        const level = p.interaction?.levels[i];
        if (level === undefined) continue;
        level.addresses.forEach((address, e) => {
          for (const event of ['hover', 'touch', 'focus'] as const) {
            const k = stateAfter(level.tables, e, event);
            if (k === null) continue;
            const entryIn = (ti: number): number => {
              const l = (tables[ti] as ExportTarget).interaction?.levels[at[ti] as number];
              const kk = l === undefined ? -1 : stateAfter(l.tables, l.addresses.indexOf(address), event);
              return l === undefined || kk === null || kk < 0 ? (at[ti] as number) : ((l.planAssignments as number[])[kk] as number) - (firsts[ti] as number);
            };
            const entries = tables.map((_, ti) => entryIn(ti));
            expect(layout(g, { assignment: entries[0], groups: entries.slice(1) }), `${t} ${JSON.stringify(a.values)} ${event} ${address}`).toBe(layout(p, { assignment: k < 0 ? i : (level.planAssignments as number[])[k] }));
            compared++;
          }
        });
      }
      expect(compared).toBeGreaterThan(200);
    }
  });

  it('gives a group whose elements style alike in every @media band one row per assignment', () => {
    const g = exportOf(TEXT, PATH, true, false).targets.ios as ExportTarget;
    const rows = (g.groups ?? []).map((x) => [x.groupStates, x.assignments.length] as const);
    expect(rows).toEqual([[['state:a'], 4], [['state:b'], 4], [['branch-site:0'], 2]]);
  });

  it("refuses a paragraph whose text two groups change, which a phone could not shape", () => {
    const input = JSON.parse(TEXT) as { nodes: Record<string, unknown>[]; css: string };
    input.nodes.push(
      { kind: 'element', id: 'h6', element: 'p', parent: 'h0', attributes: { class: 'note mk-g' } },
      { kind: 'element', id: 'h7', element: 'span', parent: 'h6', attributes: {}, classByState: [false, true].flatMap((a) => [false, true].map((b) => ({ when: { 'state:a': a, 'state:b': b }, value: a ? 'bold mk-g' : 'mk-g' }))) },
      { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'One' },
      { kind: 'text', id: 'h6:text0', parent: 'h6', text: ' and ' },
      { kind: 'element', id: 'h8', element: 'span', parent: 'h6', attributes: {}, classByState: [false, true].flatMap((a) => [false, true].map((b) => ({ when: { 'state:a': a, 'state:b': b }, value: b ? 'bold mk-g' : 'mk-g' }))) },
      { kind: 'text', id: 'h8:text0', parent: 'h8', text: 'two' },
    );
    input.css += '\n.bold.mk-g { font-weight: 700; letter-spacing: 1px; }\n';
    expect(() => exportOf(JSON.stringify(input), PATH, true, false)).toThrow('changes with more than one group of states, and a phone shapes a paragraph only as Dragon laid it out');
  });
});
