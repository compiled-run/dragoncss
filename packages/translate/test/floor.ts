// Append-only floors (PIN-DERIVE): a corpus may gain suites and cases without a test edit, but a suite that vanishes, moves or
// shrinks below its floor fails. DRAGON_FLOOR_WRITE=1 raises a floor to the current corpus, and only when nothing is below it.
import { readFileSync, writeFileSync } from 'node:fs';

type Floor = { readonly order: readonly string[]; readonly counts: Readonly<Record<string, number>> };

const read = (path: URL, key: string): Record<string, Floor> => {
  const v = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Floor>;
  const f = v[key];
  const ok = f !== undefined && Array.isArray(f.order) && f.order.every((x) => typeof x === 'string') && new Set(f.order).size === f.order.length
    && typeof f.counts === 'object' && f.counts !== null && Object.values(f.counts).every((n) => Number.isInteger(n) && n >= 0);
  if (!ok) throw new Error(`${path.pathname}: ${key} is not { order: names, counts: { name: count } }`);
  return v;
};

/** The suites of `actual` (name and case count, in order) that drop, reorder or shrink a floor entry. */
export function suiteFloorProblems(path: URL, key: string, actual: readonly { readonly name: string; readonly count: number }[]): string[] {
  const all = read(path, key);
  const floor = all[key] as Floor;
  const names = actual.map((s) => s.name);
  const problems = floor.order.filter((x) => !names.includes(x)).map((x) => `${key}: suite ${x} is in the floor but gone`);
  const at = floor.order.map((x) => names.indexOf(x));
  for (let i = 1; i < at.length; i++) if ((at[i] as number) >= 0 && (at[i] as number) < (at[i - 1] as number)) problems.push(`${key}: ${floor.order[i]} now comes before ${floor.order[i - 1]}`);
  for (const [name, min] of Object.entries(floor.counts)) {
    const got = actual.find((s) => s.name === name)?.count ?? 0;
    if (got < min) problems.push(`${key}: ${name} has ${got} cases, the floor is ${min}`);
  }
  if (new Set(names).size !== names.length) problems.push(`${key}: a suite name repeats`);
  if (problems.length === 0 && process.env['DRAGON_FLOOR_WRITE'] === '1') {
    all[key] = { order: names, counts: Object.fromEntries(actual.map((s) => [s.name, s.count])) };
    writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
  }
  return problems;
}
