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
  const shown = (id: string): ExportNode | undefined => entryOf(nodeOwner.get(id)).nodes.find((n) => n.id === id);
  const tables = [page, ...entries];
  // Laid-out nodes first, in the order every table gives them; then the named, boxless ones (frame null), as the export lists them.
  const out: ExportNode[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, laidOut: boolean): void => {
    for (const id of mergedOrder(tables.map((a) => a.nodes.filter((n) => n.parent === parent && (n.frame !== null) === laidOut).map((n) => n.id)))) {
      const own = shown(id);
      if (own === undefined || own.parent !== parent || seen.has(id) || (own.frame !== null) !== laidOut) continue;
      seen.add(id);
      out.push(own);
      visit(own.id, laidOut);
    }
  };
  visit(null, true);
  for (const a of tables) for (const n of a.nodes) if (!seen.has(n.id) && n.frame === null && shown(n.id) === n) {
    seen.add(n.id);
    out.push(n);
  }
  return out;
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
