// Factored states (analysis/link.ts StateGroup, export schema /2): a page whose states no element reads together compiles one table
// per group, and a phone that combines them (state-groups.ts composedNodes, harness.ts groupedVariant) shows exactly what the table
// of every assignment shows: each node's writes, each interaction state's, and the plan layout of each, on both targets.
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { NO_INTERACTION_FAULTS, interactionStart, interactionState, keyboardFocused, pointerMoved, touchPressed } from '../../layout/src/rt-interaction.ts';
import type { InteractionTables } from '@dragon/layout';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import type { ExportAssignment, ExportGroup, ExportNode, ExportTarget } from '../src/native-style-export.ts';
import { NATIVE_STYLE_EXPORT_SCHEMA, NATIVE_STYLE_EXPORT_SCHEMA_GROUPS, parseNativeStyleExport } from '../src/native-style-export.ts';
import { composedNodes, interactionStateOf, shownState, tableEntries } from '../src/state-groups.ts';
import type { GroupProduct } from '../src/state-groups.ts';
import { repoPath } from '../src/paths.ts';

export const { runMarklessLayout, runMarklessRowsLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessLayout(line: string): string; runMarklessRowsLayout(line: string, shaper: never): string };

export const PATH = 'examples/markless-styles/input/groups.native-style-input.json';

export const TEXT = readFileSync(repoPath(PATH), 'utf8');

export const exportOf = (text: string, grouped: boolean, plan: boolean) => {
  if (grouped) process.env['DRAGON_STATE_GROUPS'] = 'always';
  else delete process.env['DRAGON_STATE_GROUPS'];
  try {
    return marklessStyleExport(text, PATH, undefined, plan ? 'system' : 'pinned', undefined, plan).exported;
  } finally {
    delete process.env['DRAGON_STATE_GROUPS'];
  }
};

export type Input = { nodes: Record<string, unknown>[]; css: string; branches: Record<string, unknown>[] };

/** The groups fixture with more nodes, CSS and branches. */
export const variant = (f: (v: Input) => void): string => {
  const v = JSON.parse(TEXT) as Input;
  f(v);
  return JSON.stringify(v);
};

/** A value per combination of the fixture's two states. */
export const byAB = (value: (a: boolean, b: boolean) => string | null) => [false, true].flatMap((a) => [false, true].map((b) => ({ when: { 'state:a': a, 'state:b': b }, value: value(a, b) })));

/** A node as a host applies it: everything but what the plan layout gives the phone at its own size. */
export const applied = (nodes: readonly ExportNode[]): Map<string, string> =>
  new Map(nodes.map(({ frame: _frame, lines: _lines, scrollRange: _scroll, borderOps: _ops, ...n }) => [n.id, JSON.stringify({ ...n, writes: n.writes.map((w) => (w['kind'] === 'paint-order' ? { kind: w['kind'], host: w['host'], bucket: w['bucket'] } : w)) })]));

/** Each host's layer items in the order it sorts them (bucket, then rank), which applied leaves out. */
export const paintOrders = (nodes: readonly ExportNode[]): Record<string, string[]> => {
  const out: Record<string, [number, number, string][]> = {};
  for (const n of nodes) for (const w of n.writes) if (w['kind'] === 'paint-order') (out[w['host'] as string] ??= []).push([w['bucket'] as number, w['rank'] as number, n.id]);
  return Object.fromEntries(Object.entries(out).map(([h, l]) => [h, l.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2])]));
};

export type Event = 'hover' | 'touch' | 'focus';

/** The interaction state a table's runtime is in after one event on its element at index e; null when focus cannot reach it. */
export const stateAfter = (t: InteractionTables, e: number, event: Event): number | null => {
  if (e < 0) return -1;
  if (event === 'focus' && t.focusable[e] !== true) return null;
  const s = event === 'hover' ? pointerMoved(t, interactionStart(), e) : event === 'touch' ? touchPressed(t, interactionStart(), e, NO_INTERACTION_FAULTS) : keyboardFocused(t, interactionStart(), e);
  return interactionState(t, s);
};

/** Every assignment and interaction state of the product against the combined tables: nodes, and with plan the phone's layout. */
export function expectCombines(text: string, plan: boolean): number {
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
      const combined = composedNodes(g, a.values);
      expect(applied(combined), `${t} ${JSON.stringify(a.values)}`).toEqual(applied(a.nodes));
      expect(paintOrders(combined), `${t} ${JSON.stringify(a.values)} paint order`).toEqual(paintOrders(a.nodes));
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
            const base = table.assignments[entry] as ExportAssignment;
            return kk < 0 ? base : shownState(base, interactionStateOf(table, entry, kk));
          };
          const want = k < 0 ? a.nodes : (level.states[k] as ExportAssignment).nodes;
          const combinedState = composedNodes(g, a.values, shownIn);
          expect(applied(combinedState), `${t} ${JSON.stringify(a.values)} ${event} ${address}`).toEqual(applied(want));
          expect(paintOrders(combinedState), `${t} ${JSON.stringify(a.values)} ${event} ${address} paint order`).toEqual(paintOrders(want));
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

/**
 * The product skeleton (GroupProduct) driven as a host drives it, against the product's export: each combination's nodes, paint
 * order, transitions and layout, and every interaction event through the combined level's runtime, by values.
 */
export function expectProduct(text: string): number {
  const product = exportOf(text, false, true);
  const grouped = exportOf(text, true, true);
  let compared = 0;
  for (const t of ['ios', 'android'] as const) {
    const p = product.targets[t] as ExportTarget;
    const g = grouped.targets[t] as ExportTarget;
    const sk = g.product as GroupProduct;
    const tables = [g, ...(g.groups ?? [])];
    const plan = g.plan as NonNullable<ExportTarget['plan']>;
    const firsts = [0, ...(plan.groups ?? []).map((x) => x.first)];
    const key = (v: Readonly<Record<string, unknown>>): string => JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]]));
    const valuesOf = (tuple: readonly number[]): Record<string, unknown> => Object.assign({}, ...tuple.map((e, ti) => {
      const a = (tables[ti] as ExportTarget).assignments[e] as ExportAssignment;
      return ti === 0 ? a.values : Object.fromEntries(((tables[ti] as ExportGroup).groupStates).map((st) => [st, a.values[st]]));
    }));
    const at = new Map(sk.assignments.map((tuple, j) => [key(valuesOf(tuple)), j]));
    expect(sk.assignments.length).toBe(p.assignments.length);
    expect(sk.states.map((st) => [st.key, st.domain])).toEqual(p.states.map((st) => [st.key, st.domain]));
    const dpr = (plan.densities[0] as { dpr: number }).dpr;
    const layout = (x: ExportTarget, extra: object): string => runMarklessLayout(JSON.stringify({ dpr, viewport: p.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, ...extra }));
    // What table ti shows for entry e and its level's state s (-1: the entry), and that table's plan entry for it.
    const shownOf = (ti: number, e: number, s: number): ExportAssignment => {
      const base = (tables[ti] as ExportTarget).assignments[e] as ExportAssignment;
      return s < 0 ? base : shownState(base, interactionStateOf(tables[ti] as ExportTarget, e, s));
    };
    const planOf = (ti: number, e: number, s: number): number => (s < 0 ? (firsts[ti] as number) + e : (((tables[ti] as ExportTarget).interaction?.levels[e]?.planAssignments as number[])[s] as number)) - (firsts[ti] as number);
    for (const [i, a] of p.assignments.entries()) {
      const j = at.get(key(a.values)) as number;
      const tuple = sk.assignments[j] as readonly number[];
      const what = `${t} ${key(a.values)}`;
      const combine = (states: readonly number[]): ExportNode[] => composedNodes(g, a.values, (ti) => shownOf(ti, tuple[ti] as number, states[ti] as number));
      const none = tuple.map(() => -1);
      expect(applied(combine(none)), what).toEqual(applied(a.nodes));
      const paintOf = (states: readonly number[]): unknown => {
        const shown = shownOf(sk.rootPaint, tuple[sk.rootPaint] as number, states[sk.rootPaint] as number) as unknown as Record<string, unknown>;
        return [shown['canvas'], shown['bodyBackground'], shown['colorScheme']];
      };
      const paintIn = (x: ExportAssignment): unknown => [(x as unknown as Record<string, unknown>)['canvas'], (x as unknown as Record<string, unknown>)['bodyBackground'], (x as unknown as Record<string, unknown>)['colorScheme']];
      expect(paintOf(none), `${what} root paint`).toEqual(paintIn(a));
      expect(paintOrders(combine(none)), `${what} paint order`).toEqual(paintOrders(a.nodes));
      const lineOf = (states: readonly number[]): object => ({ assignment: planOf(0, tuple[0] as number, states[0] as number), groups: tuple.slice(1).map((e, k) => planOf(k + 1, e, states[k + 1] as number)) });
      expect(layout(g, lineOf(none)), `${what} layout`).toBe(layout(p, { assignment: i }));
      p.states.forEach((st, si) => st.domain.forEach((v, vi) => {
        const want = p.next[i]?.[si]?.[vi] as number;
        const got = sk.next[j]?.[si]?.[vi] as number;
        expect(got < 0 ? null : key(valuesOf(sk.assignments[got] as readonly number[])), `${what} set ${st.key}=${String(v)}`).toBe(want < 0 ? null : key((p.assignments[want] as ExportAssignment).values));
      }));
      compared++;
      const pl = p.interaction?.levels[i];
      const sl = sk.interaction?.levels[j];
      expect(sl === undefined, `${what} interaction`).toBe(pl === undefined);
      if (pl === undefined || sl === undefined) continue;
      for (const address of pl.addresses) for (const event of ['hover', 'touch', 'focus'] as const) {
        const k = stateAfter(pl.tables, pl.addresses.indexOf(address), event);
        const kk = stateAfter(sl.tables, sl.addresses.indexOf(address), event);
        expect(kk === null, `${what} ${event} ${address} reachable`).toBe(k === null);
        if (k === null || kk === null) continue;
        const states = kk < 0 ? none : (sl.states[kk] as readonly number[]);
        const want = k < 0 ? a : (pl.states[k] as ExportAssignment);
        expect(applied(combine(states)), `${what} ${event} ${address}`).toEqual(applied(want.nodes));
        expect(paintOf(states), `${what} ${event} ${address} root paint`).toEqual(paintIn(want));
        expect(paintOrders(combine(states)), `${what} ${event} ${address} paint order`).toEqual(paintOrders(want.nodes));
        expect(layout(g, lineOf(states)), `${what} ${event} ${address} layout`).toBe(layout(p, { assignment: k < 0 ? i : (pl.planAssignments as number[])[k] as number }));
        compared++;
      }
    }
  }
  return compared;
}
