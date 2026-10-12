// Append-only floors (PIN-DERIVE): a registry may gain entries without a test edit, but losing or reordering a floor entry fails.
// DRAGON_FLOOR_WRITE=1 raises a floor to the current registry, and only when nothing in the floor is missing.
import { readFileSync, writeFileSync } from 'node:fs';

type Floors = Record<string, readonly string[]>;

const read = (path: URL): Floors => {
  const v = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${path.pathname}: not an object of name lists`);
  for (const [k, list] of Object.entries(v)) {
    if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) throw new Error(`${path.pathname}: ${k} is not a list of names`);
    if (new Set(list).size !== list.length) throw new Error(`${path.pathname}: ${k} repeats a name`);
  }
  return v as Floors;
};

/** The floor entries missing from `actual`; ordered floors also report entries out of floor order. */
export function floorProblems(path: URL, key: string, actual: readonly string[], ordered: boolean): string[] {
  const floors = read(path);
  const floor = floors[key];
  if (floor === undefined) return [`${key}: no floor in ${path.pathname}`];
  const problems = floor.filter((x) => !actual.includes(x)).map((x) => `${key}: ${x} is in the floor but gone`);
  if (problems.length === 0 && ordered) {
    const at = floor.map((x) => actual.indexOf(x));
    for (let i = 1; i < at.length; i++) if ((at[i] as number) < (at[i - 1] as number)) problems.push(`${key}: ${floor[i]} now comes before ${floor[i - 1]}`);
  }
  if (new Set(actual).size !== actual.length) problems.push(`${key}: the registry repeats a name`);
  if (problems.length === 0 && process.env['DRAGON_FLOOR_WRITE'] === '1') {
    floors[key] = ordered ? [...actual] : [...new Set([...floor, ...actual])].sort();
    writeFileSync(path, `${JSON.stringify(floors, null, 2)}\n`);
  }
  return problems;
}
