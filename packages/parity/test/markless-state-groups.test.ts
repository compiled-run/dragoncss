// Factored states (analysis/link.ts StateGroup, export schema /2): a page whose states no element reads together compiles one table
// per group, and a phone that combines them (state-groups.ts composedNodes, harness.ts groupedVariant) shows exactly what the table
// of every assignment shows: each node's writes, each interaction state's, and the plan layout of each, on both targets.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { NO_INTERACTION_FAULTS, interactionStart, interactionState, keyboardFocused, pointerMoved, touchPressed } from '../../layout/src/rt-interaction.ts';
import type { InteractionTables } from '@dragon/layout';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import type { ExportAssignment, ExportGroup, ExportNode, ExportTarget } from '../src/native-style-export.ts';
import { NATIVE_STYLE_EXPORT_SCHEMA, NATIVE_STYLE_EXPORT_SCHEMA_GROUPS, parseNativeStyleExport } from '../src/native-style-export.ts';
import { composedNodes, interactionStateOf, mergedOrder, shownState, tableEntries } from '../src/state-groups.ts';
import type { GroupProduct, PooledInteraction } from '../src/state-groups.ts';
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
  new Map(nodes.map(({ frame: _frame, lines: _lines, scrollRange: _scroll, borderOps: _ops, ...n }) => [n.id, JSON.stringify({ ...n, writes: n.writes.map((w) => (w['kind'] === 'paint-order' ? { kind: w['kind'], host: w['host'], bucket: w['bucket'] } : w)) })]));
/** Each host's layer items in the order it sorts them (bucket, then rank), which applied leaves out. */
const paintOrders = (nodes: readonly ExportNode[]): Record<string, string[]> => {
  const out: Record<string, [number, number, string][]> = {};
  for (const n of nodes) for (const w of n.writes) if (w['kind'] === 'paint-order') (out[w['host'] as string] ??= []).push([w['bucket'] as number, w['rank'] as number, n.id]);
  return Object.fromEntries(Object.entries(out).map(([h, l]) => [h, l.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2])]));
};

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
function expectProduct(text: string): number {
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
        expect(paintOrders(combine(states)), `${what} ${event} ${address} paint order`).toEqual(paintOrders(want.nodes));
        expect(layout(g, lineOf(states)), `${what} ${event} ${address} layout`).toBe(layout(p, { assignment: k < 0 ? i : (pl.planAssignments as number[])[k] as number }));
        compared++;
      }
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

  it('pairs interaction states by the element a touch or pointer is on, not by what they match', () => {
    // A hovered .x child matches one more element than a hovered plain child, so its states' match sets differ with state a.
    const text = variant((v) => {
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'div', parent: 'h0', attributes: { class: 'p mk-g' } },
        { kind: 'element', id: 'h7', element: 'div', parent: 'h6', attributes: {}, classByState: byAB((a) => (a ? 'c x mk-g' : 'c mk-g')) },
        { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'Child' },
      );
      v.css += '\n.c.mk-g { color: #000000; }\n.p.mk-g:hover > .c.mk-g { color: #ff0000; }\n.p.mk-g:hover > .c.x.mk-g:hover { color: #000000; }\n';
    });
    expect(expectCombines(text, true)).toBeGreaterThan(200);
  });

  it("hovers a group's element through a child only another group shows", () => {
    // h6's :hover colour follows state b; its child h7 exists only while branch-site:1 shows it, so b's table has no h7.
    const text = variant((v) => {
      v.branches.push({ id: 'branch-site:1', domain: ['0', '1'], initial: '1' });
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'div', parent: 'h0', attributes: {}, classByState: byAB((_a, b) => (b ? 'q y mk-g' : 'q mk-g')) },
        { kind: 'element', id: 'h7', element: 'div', parent: 'h6', attributes: { class: 'kid mk-g' }, arm: { branch: 'branch-site:1', index: 0 } },
        { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'Inside', arm: { branch: 'branch-site:1', index: 0 } },
      );
      v.css += '\n.q.mk-g { padding: 4px; }\n.q.y.mk-g:hover { background-color: #ff0000; }\n.kid.mk-g { padding: 2px; }\n';
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

  it('orders layer items of two groups no table shows together by layer, z-index and tree order', () => {
    // The panel (z-index 2, state a) and the other arm's note (z-index 3, branch-site:0) are never in one table; the bar is in all.
    const text = variant((v) => {
      v.css = v.css.split('\n').filter((l) => !l.includes(':hover') && !l.includes(':active') && !l.includes(':focus')).join('\n');
      v.nodes.push({ kind: 'element', id: 'h6', element: 'div', parent: 'h0', attributes: { class: 'bar mk-g' } }, { kind: 'text', id: 'h6:text0', parent: 'h6', text: 'Bar' });
      v.css += '\n.panel.mk-g { position: relative; z-index: 2; }\n.note.mk-g { position: relative; }\n.other.mk-g { z-index: 3; }\n.bar.mk-g { position: relative; z-index: 1; }\n.t.mk-g[aria-pressed="true"] { position: relative; z-index: 4; }\n';
    });
    const g = exportOf(text, true, false).targets.ios as ExportTarget;
    const order = paintOrders(composedNodes(g, { ...(g.assignments[0] as ExportAssignment).values, 'state:a': true, 'branch-site:0': '1' }));
    expect(order['html']?.indexOf('h2')).toBeLessThan(order['html']?.indexOf('h5') as number);
    expect(expectCombines(text, true)).toBeGreaterThan(0);
  });

  it("writes a group's tables slim: its owned nodes, and what each interaction state changes", () => {
    const g = exportOf(TEXT, true, false).targets.ios as ExportTarget;
    const nodes = (g.assignments[0] as ExportAssignment).nodes.length;
    for (const x of g.groups ?? []) {
      const owned = new Set(x.owned.filter((o) => o.startsWith('node:')).map((o) => o.slice('node:'.length)));
      for (const a of x.assignments) expect(a.nodes.every((n) => owned.has(n.id))).toBe(true);
      for (const st of (x.interaction as unknown as PooledInteraction | undefined)?.states ?? []) expect(st.nodes.length).toBeLessThan(nodes);
    }
    const pooled = g.interaction as unknown as PooledInteraction;
    for (const st of pooled.states) expect(st.nodes.length).toBeLessThan(nodes);
    // A state two levels share is written once.
    expect(pooled.states.length).toBeLessThan(pooled.levels.reduce((n, l) => n + l.states.length, 0));
  });

  for (const name of ['groups', 'arms', 'tabs']) {
    it(`steps ${name}'s product skeleton as a host does: every combination, transition and interaction event`, () => {
      expect(expectProduct(readFileSync(repoPath(`examples/markless-styles/input/${name}.native-style-input.json`), 'utf8'))).toBeGreaterThan(0);
    });
  }
});
