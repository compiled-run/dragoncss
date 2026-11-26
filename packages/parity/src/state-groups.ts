// Factored states (schema /2, ExportTarget groups): the reference of how a host combines a target's tables into the page one
// assignment shows. A node takes its record from the group that owns it ("node:<id>"), and a parent's child order from the group
// that owns its box ("box:<id>"); every other node and order comes from the target's own table, which holds the initial assignment.
import type { Scalar } from 'dragon';
import type { ExportAssignment, ExportGroup, ExportNode, ExportTarget } from './native-style-export.ts';

const BAND_KEY = '@env#band';

/** The index of the assignment of a table whose values agree with values on every state the table varies. */
export function tableEntry(table: Pick<ExportTarget, 'states' | 'assignments'>, values: Readonly<Record<string, Scalar>>, varies: readonly string[]): number {
  const k = table.assignments.findIndex((a) => varies.every((s) => a.values[s] === values[s]));
  if (k < 0) throw new Error(`no assignment of the table has ${varies.map((s) => `${s}=${JSON.stringify(values[s])}`).join(', ')}`);
  return k;
}

/** Each table's entry at values: the target's own first, then each group's. */
export function tableEntries(target: ExportTarget, values: Readonly<Record<string, Scalar>>): number[] {
  // A group whose elements style alike in every band has no band state.
  const banded = (t: Pick<ExportTarget, 'states'>): string[] => (t.states.some((s) => s.key === BAND_KEY) ? [BAND_KEY] : []);
  return [tableEntry(target, values, banded(target)), ...(target.groups ?? []).map((g) => tableEntry(g, values, [...g.groupStates, ...banded(g)]))];
}

/**
 * The nodes of the page at values (every state of the target), combined from the target's table and its groups'. shown: what a
 * table shows at its entry (table 0 the target's, then each group's), by default the entry itself; an interaction state replaces it.
 */
export function composedNodes(target: ExportTarget, values: Readonly<Record<string, Scalar>>, shownIn: (table: number, entry: number) => ExportAssignment = (table, entry) => ((table === 0 ? target : (target.groups as readonly ExportGroup[])[table - 1] as ExportGroup).assignments[entry] as ExportAssignment)): ExportNode[] {
  const groups: readonly ExportGroup[] = target.groups ?? [];
  const at = tableEntries(target, values);
  const page = shownIn(0, at[0] as number);
  const entries = groups.map((_, k) => shownIn(k + 1, at[k + 1] as number));
  const nodeOwner = new Map<string, number>();
  groups.forEach((g, k) => {
    for (const o of g.owned) {
      if (o.startsWith('node:')) nodeOwner.set(o.slice('node:'.length), k);
    }
  });
  const entryOf = (owner: number | undefined): ExportAssignment => (owner === undefined ? page : (entries[owner] as ExportAssignment));
  // A node shows where its owner's entry has it; siblings keep the order every table's entries give them.
  const shown = (id: string): ExportNode | undefined => indexOf(entryOf(nodeOwner.get(id))).byId.get(id);
  const tables = [page, ...entries].map(indexOf);
  // Laid-out nodes first, in the order every table gives them; then the named, boxless ones (frame null), as the export lists them.
  const out: ExportNode[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, laidOut: boolean): void => {
    for (const id of mergedOrder(tables.map((a) => (laidOut ? a.laidOut : a.boxless).get(parent) ?? []))) {
      const own = shown(id);
      if (own === undefined || own.parent !== parent || seen.has(id) || (own.frame !== null) !== laidOut) continue;
      seen.add(id);
      out.push(own);
      visit(own.id, laidOut);
    }
  };
  visit(null, true);
  for (const a of [page, ...entries]) for (const n of a.nodes) if (!seen.has(n.id) && n.frame === null && shown(n.id) === n) {
    seen.add(n.id);
    out.push(n);
  }
  return restacked(out);
}

/** What a table shows in one of its interaction states (schema /2 slim: the nodes the state changes, over its assignment's). */
export function shownState(base: ExportAssignment, state: ExportAssignment): ExportAssignment {
  const changed = new Map(state.nodes.map((n) => [n.id, n]));
  const removed = new Set(state.removed ?? []);
  const kept = base.nodes.filter((n) => !removed.has(n.id)).map((n) => changed.get(n.id) ?? n);
  const have = new Set(kept.map((n) => n.id));
  const { removed: _removed, order, ...own } = state;
  const merged = { ...(base.order ?? {}), ...(order ?? {}) };
  const { order: _baseOrder, ...shared } = base;
  return { ...shared, ...own, nodes: [...kept, ...state.nodes.filter((n) => !have.has(n.id))], ...(Object.keys(merged).length === 0 ? {} : { order: merged }) };
}

type PaintOrder = { readonly kind: 'paint-order'; readonly host: string; readonly bucket: number; readonly rank: number; readonly index: number; readonly layer?: string; readonly z?: number | null };
const paintOrderOf = (n: ExportNode): PaintOrder | undefined => n.writes.find((w) => w['kind'] === 'paint-order') as PaintOrder | undefined;
// The order of a stacking context's layer items (lower/paint/stacking.ts itemsOf): z < 0, the normal-flow layers, z auto and 0, z > 0, the top layer.
const LAYER_CLASS: Readonly<Record<string, number>> = { negative: 0, 'normal-flow': 1, positioned: 1, positive: 2, 'top-layer': 3 };

/**
 * The combined page's paint order: a layer item's rank and index count only the items of its own table. Under each host its items
 * sort by layer, then z-index, then tree order (the node order), as Dragon sorts one case's; ranks and indices are numbered again.
 */
function restacked(nodes: readonly ExportNode[]): ExportNode[] {
  const items = new Map<string, { readonly id: string; readonly at: number; readonly order: PaintOrder }[]>();
  nodes.forEach((n, at) => {
    const order = paintOrderOf(n);
    if (order === undefined) return;
    if (order.layer === undefined) throw new Error(`${n.id}'s paint-order write has no layer, which a combined page sorts by`);
    const list = items.get(order.host) ?? [];
    list.push({ id: n.id, at, order });
    items.set(order.host, list);
  });
  if (items.size === 0) return [...nodes];
  const renumbered = new Map<string, PaintOrder>();
  for (const present of items.values()) {
    const key = (o: PaintOrder): [number, number] => {
      const layer = o.layer as string;
      return [LAYER_CLASS[layer] ?? 3, layer === 'normal-flow' ? -1 : layer === 'negative' || layer === 'positive' ? (o.z ?? 0) : 0];
    };
    const sorted = [...present].sort((x, y) => {
      const [a, b] = [key(x.order), key(y.order)];
      return a[0] - b[0] || a[1] - b[1] || x.at - y.at;
    });
    // The host's own box views come before its layer items: as many as the lowest-ranked item's index counts.
    const base = Math.min(...present.map((it) => it.order.index - it.order.rank));
    sorted.forEach((it, k) => renumbered.set(it.id, { ...it.order, rank: k, index: base + k }));
  }
  return nodes.map((n) => {
    const order = renumbered.get(n.id);
    return order === undefined ? n : { ...n, writes: n.writes.map((w) => (w['kind'] === 'paint-order' ? order : w)) };
  });
}

type Indexed = { readonly byId: ReadonlyMap<string, ExportNode>; readonly laidOut: ReadonlyMap<string | null, readonly string[]>; readonly boxless: ReadonlyMap<string | null, string[]> };
const INDEXED = new WeakMap<ExportAssignment, Indexed>();
/** An assignment's nodes by id, and each parent's laid-out (its order, where it gives one) and boxless children in order. */
function indexOf(a: ExportAssignment): Indexed {
  const known = INDEXED.get(a);
  if (known !== undefined) return known;
  const laidOut = new Map<string | null, readonly string[]>();
  const boxless = new Map<string | null, string[]>();
  for (const n of a.nodes) {
    const into = n.frame === null ? boxless : (laidOut as Map<string | null, string[]>);
    const list = into.get(n.parent) as string[] | undefined;
    if (list === undefined) into.set(n.parent, [n.id]);
    else list.push(n.id);
  }
  for (const [parent, ids] of Object.entries(a.order ?? {})) laidOut.set(parent, ids);
  const made = { byId: new Map(a.nodes.map((n) => [n.id, n])), laidOut, boxless };
  INDEXED.set(a, made);
  return made;
}

/**
 * Factored states written slim (schema /2): a group's assignments keep the nodes it owns, with the order of their parents' laid-out
 * children; every interaction state keeps the nodes it changes from its assignment (a group's: the ones it owns), the ids it has
 * no node for, and the order of a parent it adds a child to. composedNodes, with shownState, combines them as the full tables.
 */
export function slimTarget(full: ExportTarget): ExportTarget {
  if (full.groups === undefined) return full;
  const x = withoutIdleStates(full);
  const groups = x.groups as readonly ExportGroup[];
  const ownedBy = groups.map((g) => new Set(g.owned.flatMap((o) => (o.startsWith('node:') ? [o.slice('node:'.length)] : []))));
  const groupOwned = new Set(ownedBy.flatMap((s) => [...s]));
  const childOrder = (a: ExportAssignment, parents: Iterable<string>): Record<string, string[]> => {
    const wanted = new Set(parents);
    const out: Record<string, string[]> = {};
    for (const n of a.nodes) if (n.frame !== null && n.parent !== null && wanted.has(n.parent)) (out[n.parent] ??= []).push(n.id);
    return out;
  };
  const delta = (base: ExportAssignment, state: ExportAssignment, keeps: (id: string) => boolean): ExportAssignment => {
    const was = new Map(base.nodes.map((n) => [n.id, JSON.stringify(n)]));
    const now = new Set(state.nodes.map((n) => n.id));
    const nodes = state.nodes.filter((n) => keeps(n.id) && was.get(n.id) !== JSON.stringify(n));
    const removed = base.nodes.filter((n) => keeps(n.id) && !now.has(n.id)).map((n) => n.id);
    const added = nodes.filter((n) => !was.has(n.id) && n.frame !== null && n.parent !== null).map((n) => n.parent as string);
    const order = childOrder(state, added);
    // What the state shares with its assignment (its values, page scroll and root paint) the host takes from the assignment.
    const own = Object.fromEntries(Object.entries(state).filter(([k, v]) => k !== 'nodes' && JSON.stringify(v) !== JSON.stringify((base as Record<string, unknown>)[k])));
    return { ...own, nodes, ...(removed.length === 0 ? {} : { removed }), ...(Object.keys(order).length === 0 ? {} : { order }) } as unknown as ExportAssignment;
  };
  const slimLevels = (t: Required<Pick<ExportTarget, 'interaction'>>, full: readonly ExportAssignment[], keeps: (id: string) => boolean): NonNullable<ExportTarget['interaction']> =>
    ({ levels: t.interaction.levels.map((l, i) => ({ ...l, states: l.states.map((st) => delta(full[i] as ExportAssignment, st, keeps)) })) });
  const pageKeeps = (id: string): boolean => !groupOwned.has(id);
  const page = { ...x, ...(x.interaction === undefined ? {} : { interaction: slimLevels({ interaction: x.interaction }, x.assignments, pageKeeps) }) };
  return pooled({
    ...page,
    groups: groups.map((g, k) => {
      const owns = ownedBy[k] as Set<string>;
      const keeps = (id: string): boolean => owns.has(id);
      const assignments = g.assignments.map((a) => {
        const nodes = a.nodes.filter((n) => owns.has(n.id));
        return { ...a, nodes, order: childOrder(a, nodes.filter((n) => n.frame !== null && n.parent !== null).map((n) => n.parent as string)) };
      });
      // A group's plan names are only those the page's initial entry does not give alike; a host lays them over the page's.
      const pageNames = new Map((x.planNames?.[x.initial] ?? []).map(([d, m]) => [d, m]));
      const planNames = g.planNames?.map((names) => names.filter(([d, m]) => pageNames.get(d) !== m));
      return { ...g, assignments, ...(planNames === undefined ? {} : { planNames }), ...(g.interaction === undefined ? {} : { interaction: slimLevels({ interaction: g.interaction }, g.assignments, keeps) }) };
    }),
  });
}

/** One order holding every list's items in that list's order (each list is a subsequence of one document order). */
export function mergedOrder(lists: readonly (readonly string[])[]): string[] {
  const after = new Map<string, Set<string>>();
  const all: string[] = [];
  for (const list of lists) {
    list.forEach((id, i) => {
      if (!after.has(id)) {
        after.set(id, new Set());
        all.push(id);
      }
      if (i > 0) (after.get(id) as Set<string>).add(list[i - 1] as string);
    });
  }
  const out: string[] = [];
  const placed = new Set<string>();
  const place = (id: string, path: readonly string[]): void => {
    if (placed.has(id)) return;
    if (path.includes(id)) throw new Error(`the tables order ${id} both before and after ${path[path.length - 1]}`);
    for (const before of after.get(id) as Set<string>) place(before, [...path, id]);
    placed.add(id);
    out.push(id);
  };
  for (const id of all) place(id, []);
  return out;
}

type PlanBoxJson = { readonly id?: string; readonly kind: string; readonly children?: readonly PlanBoxJson[] } & Readonly<Record<string, unknown>>;

/**
 * A group's interaction states that change nothing it owns (most: its table is a whole page, so it has every hover and press the
 * page has) are left out: its runtime then gives none for them, and a host shows the group's entry, as the state would. A state
 * stays when it changes an owned node, an owned layout box, or an owned node's plan facts. The plan drops their entries and variants.
 */
function withoutIdleStates(x: ExportTarget): ExportTarget {
  const plan = x.plan;
  const groups = x.groups as readonly ExportGroup[];
  const planGroups = plan?.groups ?? [];
  const boxesOf = new Map<number, Map<string, string>>();
  // Each layout box of a variant: its record with its children by id (leaves whole), as harness.ts groupedRoot takes it.
  const boxRecords = (v: number): Map<string, string> => {
    const known = boxesOf.get(v);
    if (known !== undefined) return known;
    const out = new Map<string, string>();
    const visit = (b: PlanBoxJson): void => {
      if (b.id === undefined) return;
      out.set(b.id, JSON.stringify({ ...b, children: (b.children ?? []).map((c) => c.id ?? c) }));
      for (const c of b.children ?? []) visit(c);
    };
    visit((plan?.variants[v] as unknown as { readonly root: PlanBoxJson }).root);
    boxesOf.set(v, out);
    return out;
  };
  const keptPerGroup = groups.map((g, k) => {
    const owns = new Set(g.owned.flatMap((o) => (o.startsWith('node:') ? [o.slice('node:'.length)] : [])));
    const pg = planGroups[k];
    const boxes = pg?.owned ?? [];
    const facts = new Set(pg?.nodes ?? []);
    const factsOf = (e: number): string => {
      const a = plan?.assignments[e];
      if (a === undefined) return '';
      return JSON.stringify([a.dashed.filter((d) => facts.has(d[0] as string)), a.scroll.filter((id) => facts.has(id)), (a.checkboxes ?? []).filter((id) => facts.has(id))]);
    };
    const boxesAt = (e: number): string => {
      const a = plan?.assignments[e];
      if (a === undefined) return '';
      const records = boxRecords(a.variant);
      return JSON.stringify(boxes.map((id) => records.get(id) ?? null));
    };
    const ownedNodes = (a: ExportAssignment): string => JSON.stringify(a.nodes.filter((n) => owns.has(n.id)));
    return (g.interaction?.levels ?? []).map((l, i) => {
      const base = g.assignments[i] as ExportAssignment;
      const basePlan = (pg?.first ?? 0) + i;
      return l.states.map((st, s) => ownedNodes(st) !== ownedNodes(base) || (plan !== undefined && (boxesAt((l.planAssignments as readonly number[])[s] as number) !== boxesAt(basePlan) || factsOf((l.planAssignments as readonly number[])[s] as number) !== factsOf(basePlan))));
    });
  });
  // The plan again: the page's entries, then per group its assignments' entries and its kept states', with only the variants they use.
  const entries: PlanEntryOf[] = [];
  const variantIndex = new Map<number, number>();
  const variants: unknown[] = [];
  const take = (e: number): number => {
    const a = plan?.assignments[e] as PlanEntryOf;
    let v = variantIndex.get(a.variant);
    if (v === undefined) {
      v = variants.length;
      variants.push(plan?.variants[a.variant]);
      variantIndex.set(a.variant, v);
    }
    entries.push({ ...a, variant: v });
    return entries.length - 1;
  };
  const pageCount = plan === undefined ? 0 : (planGroups[0]?.first ?? plan.assignments.length);
  for (let e = 0; e < pageCount; e++) take(e);
  const newGroups = groups.map((g, k) => {
    const pg = planGroups[k];
    const first = entries.length;
    const names: (readonly (readonly [string, string])[])[] = [];
    const nameOf = (e: number): readonly (readonly [string, string])[] => g.planNames?.[e - (pg?.first ?? 0)] ?? [];
    if (plan !== undefined) g.assignments.forEach((_, i) => {
      names.push(nameOf((pg?.first ?? 0) + i));
      take((pg?.first ?? 0) + i);
    });
    const interaction = g.interaction === undefined ? undefined : { levels: g.interaction.levels.map((l, i) => {
      const kept = keptPerGroup[k]?.[i] as readonly boolean[];
      const renumber: number[] = [];
      let next = 0;
      kept.forEach((keep) => renumber.push(keep ? next++ : -1));
      const map = (v: number): number => (v < 0 ? -1 : (renumber[v] as number));
      const t = l.tables;
      const tables = { ...t, combos: t.combos.map(map), forcedHoverOf: t.forcedHoverOf.map(map), forcedActiveOf: t.forcedActiveOf.map(map), forcedFocusOf: t.forcedFocusOf.map(map), forcedFocusVisibleOf: t.forcedFocusVisibleOf.map(map) };
      const planAssignments = l.planAssignments?.flatMap((e, s) => {
        if (!kept[s]) return [];
        names.push(nameOf(e));
        return [take(e)];
      });
      return { ...l, tables, states: l.states.filter((_, s) => kept[s]), matches: l.matches.filter((_, s) => kept[s]), ...(planAssignments === undefined ? {} : { planAssignments }) };
    }) };
    const planGroup = pg === undefined ? undefined : { ...pg, first, count: entries.length - first };
    return { group: { ...g, ...(interaction === undefined ? {} : { interaction }), ...(plan === undefined ? {} : { planNames: names }) }, planGroup };
  });
  if (plan === undefined) return { ...x, groups: newGroups.map((n) => n.group) };
  // The page's own entries keep their variants, renumbered.
  return {
    ...x,
    plan: { ...plan, variants: variants as typeof plan.variants, assignments: entries, groups: newGroups.map((n) => n.planGroup as PlanGroupOf) },
    groups: newGroups.map((n) => n.group),
  };
}
type PlanEntryOf = NonNullable<ExportTarget['plan']>['assignments'][number];
type PlanGroupOf = NonNullable<NonNullable<ExportTarget['plan']>['groups']>[number];

/** A table's interaction in the slim export: each level's states and matches as indices into the table's lists of distinct ones. */
export type PooledInteraction = {
  readonly levels: readonly (Omit<Level, 'states' | 'matches'> & { readonly states: readonly number[]; readonly matches: readonly number[] })[];
  readonly states: readonly ExportAssignment[];
  readonly matches: readonly Level['matches'][number][];
};
type Level = NonNullable<ExportTarget['interaction']>['levels'][number];

/** The interaction state k of a table's level, in a slim (pooled) export or a full one. */
export function interactionStateOf(table: Pick<ExportTarget, 'interaction'>, level: number, k: number): ExportAssignment {
  const i = table.interaction as unknown as PooledInteraction | NonNullable<ExportTarget['interaction']>;
  const l = i.levels[level] as { readonly states: readonly (number | ExportAssignment)[] };
  const s = l.states[k] as number | ExportAssignment;
  return typeof s === 'number' ? ((i as PooledInteraction).states[s] as ExportAssignment) : s;
}

/**
 * Every table's interaction states and matches written once (most repeat across a table's levels), and the plan entries of its
 * interaction states shared where two give the same entry and names, within the table's own entries.
 */
function pooled(x: ExportTarget): ExportTarget {
  const plan = x.plan;
  const groups = x.groups as readonly ExportGroup[];
  const pool = <T>(items: readonly T[], into: T[], index: Map<string, number>): number[] => items.map((it) => {
    const key = JSON.stringify(it);
    let k = index.get(key);
    if (k === undefined) {
      k = into.length;
      into.push(it);
      index.set(key, k);
    }
    return k;
  });
  const entries: PlanEntryOf[] = [];
  const ranges: { first: number; count: number }[] = [];
  const pooledTable = <T extends Pick<ExportTarget, 'interaction' | 'planNames' | 'assignments'>>(t: T, first: number, count: number): T => {
    const at = entries.length;
    const names: (readonly (readonly [string, string])[])[] = [];
    const seen = new Map<string, number>();
    const add = (old: number, share: boolean): number => {
      const entry = plan?.assignments[old] as PlanEntryOf;
      const own = t.planNames?.[old - first] ?? [];
      const key = JSON.stringify([entry, own]);
      const known = share ? seen.get(key) : undefined;
      if (known !== undefined) return known;
      entries.push(entry);
      names.push(own);
      seen.set(key, entries.length - 1);
      return entries.length - 1;
    };
    if (plan !== undefined) for (let e = 0; e < t.assignments.length; e++) add(first + e, false);
    const states: ExportAssignment[] = [];
    const matches: Level['matches'][number][] = [];
    const [stateIndex, matchIndex] = [new Map<string, number>(), new Map<string, number>()];
    const interaction = t.interaction === undefined ? undefined : {
      levels: t.interaction.levels.map((l) => ({
        ...l,
        states: pool(l.states, states, stateIndex),
        matches: pool(l.matches, matches, matchIndex),
        ...(l.planAssignments === undefined || plan === undefined ? {} : { planAssignments: l.planAssignments.map((e) => add(e, true)) }),
      })),
      states,
      matches,
    };
    void count;
    ranges.push({ first: at, count: entries.length - at });
    return { ...t, ...(interaction === undefined ? {} : { interaction: interaction as unknown as T['interaction'] }), ...(plan === undefined ? {} : { planNames: names }) };
  };
  const planGroups = plan?.groups ?? [];
  const pageCount = plan === undefined ? 0 : (planGroups[0]?.first ?? plan.assignments.length);
  const page = pooledTable(x, 0, pageCount);
  const pooledGroups = groups.map((g, k) => pooledTable(g, planGroups[k]?.first ?? 0, planGroups[k]?.count ?? 0));
  if (plan === undefined) return { ...page, groups: pooledGroups };
  return { ...page, groups: pooledGroups, plan: { ...plan, assignments: entries, groups: planGroups.map((pg, k) => ({ ...pg, ...(ranges[k + 1] as { first: number; count: number }) })) } };
}
