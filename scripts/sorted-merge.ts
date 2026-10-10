// The git merge driver for the sorted per-feature registries (merge=dragon-sorted in .gitattributes, registered by `pnpm setup:git`):
// git's own line merge, then a conflict hunk is resolved only when both sides keep every base line of it and add only registry
// lines (a registry import, or an entry of the registry's sorted block); the added lines are interleaved by the sort key the
// registry's test enforces, a line both sides added appears once. Anything else (a deletion, a modification, one key added with
// two contents, a list that would end unsorted) stays a conflict.
// Run by git as: node scripts/sorted-merge.ts %O %A %B %P   (writes the result into %A; exit 1 leaves a conflict)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const SORTED_MERGE_DRIVER = 'node scripts/sorted-merge.ts %O %A %B %P';

/** A sorted registry: the directory its feature imports come from, how an import sorts, and its sorted block. */
export interface SortedRegistry {
  /** Imports `import { X } from './<dir>/<file>';` (one per feature). */
  readonly dir: string;
  /** 'file': by the file name with its extension, as registry-claims.test.ts sorts it; 'stem': by the feature id. */
  readonly importKey: 'file' | 'stem';
  /** The first line of the sorted block; the block ends at the next line starting with `}`. */
  readonly header: RegExp;
  /** 'entry': `  id: X,` or `  'id': X,`, keyed by id; 'spread': `  ...ID_ANIMATION,`, keyed by the family id. */
  readonly entry: 'entry' | 'spread';
}

// Exactly the files marked merge=dragon-sorted (sorted-merge.test.ts), each with the key its test sorts by.
export const SORTED_REGISTRIES: { readonly [path: string]: SortedRegistry } = {
  'packages/dragon/src/css/animation-kinds.ts': { dir: 'animation-kinds', importKey: 'stem', header: /^export const ANIMATION_KINDS\b.*= \{$/, entry: 'spread' },
  'packages/dragon/src/diagnostics/codes.ts': { dir: 'codes', importKey: 'stem', header: /^export const DIAGNOSTIC_FEATURES = \{$/, entry: 'entry' },
  'packages/dragon/src/faults.ts': { dir: 'faults', importKey: 'stem', header: /^export const FAULT_GROUPS = \{$/, entry: 'entry' },
  'packages/parity/src/fixtures.ts': { dir: 'fixture-groups', importKey: 'file', header: /^export const GROUPS = \{$/, entry: 'entry' },
  'scripts/regen.ts': { dir: 'regen-steps', importKey: 'file', header: /^export const REGEN_FEATURES\b.*= \{$/, entry: 'entry' },
};

export class Refuse extends Error {}
const refuse = (why: string): never => {
  throw new Refuse(why);
};

type Kind = 'import' | 'entry';
/** A registry line's kind and sort key, or null for any other line. `inBlock`: the line sits inside the sorted block. */
export const lineKey = (reg: SortedRegistry, line: string, inBlock: boolean): { kind: Kind; key: string } | null => {
  if (inBlock) {
    if (reg.entry === 'spread') {
      const m = /^ {2}\.\.\.([A-Z0-9_]+)_ANIMATION,$/.exec(line);
      return m ? { kind: 'entry', key: m[1]!.toLowerCase().replace(/_/g, '-') } : null;
    }
    const m = /^ {2}(?:'([a-z0-9-]+)'|([a-z][a-z0-9]*)): [A-Z][A-Z0-9_]*,$/.exec(line);
    return m ? { kind: 'entry', key: (m[1] ?? m[2])! } : null;
  }
  const m = new RegExp(`^import \\{ [A-Z][A-Z0-9_]* \\} from '\\./${reg.dir}/([a-z0-9-]+)\\.ts';$`).exec(line);
  return m ? { kind: 'import', key: reg.importKey === 'file' ? `${m[1]}.ts` : m[1]! } : null;
};

const MARKER = /^(<{7}|\|{7}|={7}|>{7})( |$)/;

/** The registry lines of a whole text, by kind, in order (to check the merged lists stay sorted). */
const registryLines = (reg: SortedRegistry, lines: readonly string[]): Record<Kind, string[]> => {
  const out: Record<Kind, string[]> = { import: [], entry: [] };
  let inBlock = false;
  let seen = false;
  for (const l of lines) {
    if (inBlock && l.startsWith('}')) inBlock = false;
    const k = lineKey(reg, l, inBlock);
    if (k) out[k.kind].push(k.key);
    if (!seen && reg.header.test(l)) inBlock = seen = true;
  }
  if (!seen) refuse(`no line matches ${reg.header}`);
  return out;
};
const strictlySorted = (xs: readonly string[]): boolean => xs.every((x, i) => i === 0 || xs[i - 1]! < x);

/** Merges one gap's additions from both sides by key; a key added with two contents, or a side out of order, is refused. */
const mergeGap = (reg: SortedRegistry, inBlock: boolean, a: readonly string[], b: readonly string[]): string[] => {
  if (a.length === 0) return [...b];
  if (b.length === 0) return [...a];
  const keyed = (side: readonly string[], name: string): { line: string; key: string }[] => {
    const ks = side.map((line) => ({ line, key: lineKey(reg, line, inBlock)?.key ?? refuse(`${name} adds a line that is not a registry line: ${JSON.stringify(line)}`) }));
    if (!strictlySorted(ks.map((k) => k.key))) refuse(`${name} adds lines out of order: ${JSON.stringify(side)}`);
    return ks;
  };
  const [ka, kb] = [keyed(a, 'ours'), keyed(b, 'theirs')];
  const out: string[] = [];
  let [i, j] = [0, 0];
  while (i < ka.length || j < kb.length) {
    const x = ka[i];
    const y = kb[j];
    if (x && y && x.key === y.key) {
      if (x.line !== y.line) refuse(`both sides add ${JSON.stringify(x.key)} differently (${JSON.stringify(x.line)}, ${JSON.stringify(y.line)})`);
      out.push(x.line);
      i++;
      j++;
    } else if (x && (!y || x.key < y.key)) {
      out.push(x.line);
      i++;
    } else {
      out.push(y!.line);
      j++;
    }
  }
  return out;
};

/** One side's additions per gap of a hunk's base lines (gap g comes before base[g]), or a Refuse if it drops or moves a base line. */
const gaps = (base: readonly string[], side: readonly string[], name: string): string[][] => {
  const out: string[][] = Array.from({ length: base.length + 1 }, () => []);
  const baseSet = new Set(base);
  let g = 0;
  for (const l of side) {
    if (baseSet.has(l)) {
      if (base[g] !== l) refuse(`${name} drops, moves or repeats a base line near ${JSON.stringify(l)}`);
      g++;
    } else out[g]!.push(l);
  }
  if (g !== base.length) refuse(`${name} drops a base line: ${JSON.stringify(base[g])}`);
  return out;
};

/**
 * The merged text, or a Refuse naming why the whole file is left to git's text merge. `conflicts` counts the hunks left as
 * conflicts in `text` (diff3 markers, labelled ours/base/theirs); 0 means a clean merge.
 */
export const mergeSortedFile = (path: string, base: string, ours: string, theirs: string): { text: string; conflicts: number; resolved: number } => {
  const reg = SORTED_REGISTRIES[path] ?? refuse(`${path} is not a sorted registry (SORTED_REGISTRIES)`);
  for (const [name, t] of [['the base', base], ['ours', ours], ['theirs', theirs]] as const) {
    if (t !== '' && !t.endsWith('\n')) refuse(`${name} does not end with a newline`);
    if (t.split('\n').some((l) => MARKER.test(l))) refuse(`${name} has a line that looks like a conflict marker`);
  }
  const lines3 = merge3(base, ours, theirs);
  const out: string[] = [];
  let conflicts = 0;
  let resolved = 0;
  // Block state as the merged file reads up to here: the base lines decide it, since both sides keep them.
  let inBlock = false;
  let seen = false;
  const step = (l: string): void => {
    if (inBlock && l.startsWith('}')) inBlock = false;
    if (!seen && reg.header.test(l)) inBlock = seen = true;
  };
  for (let i = 0; i < lines3.length; ) {
    const l = lines3[i]!;
    if (!l.startsWith('<<<<<<< ')) {
      out.push(l);
      step(l);
      i++;
      continue;
    }
    const sec: string[][] = [[], [], []];
    let s = 0;
    let j = i + 1;
    for (; j < lines3.length && !lines3[j]!.startsWith('>>>>>>> '); j++) {
      const m = lines3[j]!;
      if (s === 0 && m.startsWith('||||||| ')) s = 1;
      else if (s === 1 && m === '=======') s = 2;
      else sec[s]!.push(m);
    }
    if (j >= lines3.length || s !== 2) refuse('git merge-file printed a conflict this driver cannot read');
    const [a, o, b] = sec as [string[], string[], string[]];
    const hunk = lines3.slice(i, j + 1);
    i = j + 1;
    try {
      if (new Set(o).size !== o.length) refuse('a base line repeats inside the hunk');
      const [ga, gb] = [gaps(o, a, 'ours'), gaps(o, b, 'theirs')];
      const merged: string[] = [];
      for (let g = 0; g <= o.length; g++) {
        merged.push(...mergeGap(reg, inBlock, ga[g]!, gb[g]!));
        if (g < o.length) {
          merged.push(o[g]!);
          step(o[g]!);
        }
      }
      out.push(...merged);
      resolved++;
    } catch (error) {
      if (!(error instanceof Refuse)) throw error;
      out.push(...hunk);
      conflicts++;
      for (const x of o) step(x);
    }
  }
  const text = out.join('\n');
  if (conflicts === 0) {
    // Each list sorted on both sides stays sorted, one line per key, in the result (a check over the whole file, not one hunk).
    const lists = [base, ours, theirs].map((t) => registryLines(reg, t.split('\n')));
    const res = registryLines(reg, text.split('\n'));
    for (const kind of ['import', 'entry'] as const) {
      if (lists.every((x) => strictlySorted(x[kind])) && !strictlySorted(res[kind])) refuse(`the merged ${kind} lines would not be sorted, one per key: ${JSON.stringify(res[kind])}`);
    }
  }
  return { text, conflicts, resolved };
};

/** git's three-way line merge with diff3 markers, as lines (the text ends with a newline, so the last element is ''). */
const merge3 = (base: string, ours: string, theirs: string): string[] => {
  const dir = mkdtempSync(join(tmpdir(), 'sorted-merge-'));
  try {
    const [o, a, b] = ['base', 'ours', 'theirs'].map((n) => join(dir, n)) as [string, string, string];
    writeFileSync(o, base);
    writeFileSync(a, ours);
    writeFileSync(b, theirs);
    const r = spawnSync('git', ['merge-file', '-p', '--diff3', '-L', 'ours', '-L', 'base', '-L', 'theirs', a, o, b], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error !== undefined || r.status === null || r.status < 0 || r.status > 127) refuse(`git merge-file failed (${r.error?.message ?? r.status})`);
    return r.stdout.split('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Run as a script (realpaths: /tmp is a symlink on macOS, and a guard that misses would leave git with ours unmerged).
if (process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(import.meta.filename)) {
  const [o, a, b, path] = process.argv.slice(2);
  if (o === undefined || a === undefined || b === undefined || path === undefined) {
    console.error('usage: sorted-merge.ts %O %A %B %P');
    process.exit(2);
  }
  // %A is replaced whole (temp file, then rename), so it is ours or the merge, never half of one.
  const put = (text: string): void => {
    writeFileSync(`${a}.sorted-merge`, text);
    renameSync(`${a}.sorted-merge`, a);
  };
  const ours = readFileSync(a, 'utf8');
  try {
    const r = mergeSortedFile(path, readFileSync(o, 'utf8'), ours, readFileSync(b, 'utf8'));
    put(r.text);
    if (r.conflicts > 0) {
      console.error(`sorted-merge: ${path}: ${r.conflicts} hunk(s) left as a conflict (${r.resolved} resolved)`);
      process.exit(1);
    }
    console.error(`sorted-merge: merged ${path}${r.resolved > 0 ? ` (${r.resolved} sorted hunk(s) interleaved)` : ''}`);
  } catch (error) {
    // Left to the person: git's own text merge of ours (restored as it was) with theirs, with conflict markers.
    console.error(`sorted-merge: ${path} left as a conflict: ${error instanceof Error ? error.message : String(error)}`);
    try {
      put(ours);
    } catch {}
    rmSync(`${a}.sorted-merge`, { force: true });
    const r = spawnSync('git', ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', a, o, b], { stdio: 'ignore' });
    if (r.error !== undefined || r.status === null || r.status < 0) console.error(`sorted-merge: git merge-file failed; ${path} is ours, unmerged`);
    process.exit(1);
  }
}
