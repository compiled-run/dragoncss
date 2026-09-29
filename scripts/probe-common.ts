// Shared by the layout probe capture scripts (capture-grid-probe, capture-float-probe, capture-writing-mode-probe): argument
// parsing, corpus JSON formatting, case validation and the all-or-nothing corpus write.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Parses `--flag` and `--name=value` arguments; anything not listed throws, so a typo never runs a capture that overwrites the corpus. */
export function parseProbeArgs(argv: readonly string[], flags: readonly string[], valued: readonly string[] = []): { flags: Set<string>; values: Map<string, string> } {
  const out = { flags: new Set<string>(), values: new Map<string, string>() };
  for (const a of argv) {
    const eq = a.indexOf('=');
    const name = eq < 0 ? a : a.slice(0, eq);
    if (eq < 0 && flags.includes(name)) out.flags.add(name);
    else if (eq >= 0 && valued.includes(name) && a.length > eq + 1) out.values.set(name, a.slice(eq + 1));
    else throw new Error(`unknown argument ${a}; expected ${[...flags, ...valued.map((v) => `${v}=<value>`)].join(', ')}`);
  }
  return out;
}

/** JSON indented by one space, with every array that `inline` accepts printed on one line. String contents are never rewritten. */
export function formatJson(v: unknown, inline: (a: readonly unknown[]) => boolean): string {
  const walk = (x: unknown, ind: string): string => {
    const inner = `${ind} `;
    if (Array.isArray(x)) {
      if (x.length === 0) return '[]';
      if (inline(x)) return JSON.stringify(x);
      return `[\n${x.map((e) => inner + walk(e, inner)).join(',\n')}\n${ind}]`;
    }
    if (x !== null && typeof x === 'object') {
      const entries = Object.entries(x).filter(([, e]) => e !== undefined);
      if (entries.length === 0) return '{}';
      return `{\n${entries.map(([k, e]) => `${inner}${JSON.stringify(k)}: ${walk(e, inner)}`).join(',\n')}\n${ind}}`;
    }
    const s = JSON.stringify(x);
    if (s === undefined) throw new Error(`formatJson: ${typeof x} is not JSON`);
    return s;
  };
  return walk(v, '');
}

export const allNumbers = (a: readonly unknown[]): boolean => a.every((e) => typeof e === 'number');
export const allPrimitives = (a: readonly unknown[]): boolean => a.every((e) => e === null || typeof e !== 'object');

/** Duplicate case ids in a family, and duplicate `data-p` labels in one case's html (later ones would overwrite earlier ones). */
export function caseProblems(families: readonly { readonly id: string; readonly cases: readonly { readonly id: string; readonly html?: string }[] }[]): string[] {
  const problems: string[] = [];
  const familyIds = new Set<string>();
  for (const fam of families) {
    if (familyIds.has(fam.id)) problems.push(`duplicate family ${fam.id}`);
    familyIds.add(fam.id);
    const ids = new Set<string>();
    for (const c of fam.cases) {
      if (ids.has(c.id)) problems.push(`${fam.id}: duplicate case ${c.id}`);
      ids.add(c.id);
      const labels = [...(c.html ?? '').matchAll(/data-p="([^"]*)"/g)].map((m) => m[1]!);
      for (const [k, l] of labels.entries()) if (labels.indexOf(l) !== k) problems.push(`${fam.id} ${c.id}: duplicate data-p="${l}"`);
    }
  }
  return problems;
}

/**
 * Writes every [path, text] pair, or with `check` compares them to the files on disk. Called once after every family has been
 * captured, so a failed capture leaves the committed corpus untouched. Returns false when a check finds a difference.
 */
export function writeOrCheck(outputs: readonly (readonly [path: string, text: string, label: string])[], check: boolean): boolean {
  let ok = true;
  for (const [path, text, label] of outputs) {
    if (check) {
      const same = existsSync(path) && readFileSync(path, 'utf8') === text;
      console.log(`${same ? 'same' : 'DIFFERS'} ${label}`);
      if (!same) ok = false;
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      console.log(`wrote ${label}`);
    }
  }
  return ok;
}
