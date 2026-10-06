// The exact input set of a regen step: the static import closure of its entry files (relative and workspace imports, literal
// dynamic imports, `new URL('<path>', import.meta.url)` files and directories), its declared data globs, and the pnpm-lock.yaml
// entries of every external package the closure imports, followed through their dependencies. scripts/regen.ts keys each step
// on this set and, after each run, checks the files the step's processes actually read (scripts/regen-trace.ts) against it.
import { dirname, posix } from 'node:path';

/** path -> git blob sha of every tracked or untracked, not ignored file in the working tree. */
export type Tree = ReadonlyMap<string, string>;

/** Reads a tree file's text; the caller memoizes by blob. */
export type ReadText = (path: string) => string;

const IMPORT_RES: readonly RegExp[] = [
  // import x from '...', import { a, type B } from '...', export * from '...'; `import type` / `export type` load nothing.
  /\b(import|export)\s+(?!type\s)[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*[,)]/g,
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\b(?:import\.meta|require)\.resolve\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];
// A string that can be a module specifier; a match inside other text ("import ', '") is not one.
const SPECIFIER = /^[\w@.:/-][\w@.:/+~-]*$/;
const URL_RE = /\bnew\s+URL\s*\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

/** The module specifiers a source file imports or resolves, and the paths it names relative to itself with new URL. */
export function scanSource(text: string): { specifiers: string[]; urls: string[] } {
  const specifiers = new Set<string>();
  for (const re of IMPORT_RES) for (const m of text.matchAll(re)) if (SPECIFIER.test(m[m.length - 1]!)) specifiers.add(m[m.length - 1]!);
  const urls = new Set<string>();
  for (const m of text.matchAll(URL_RE)) urls.add(m[1]!);
  return { specifiers: [...specifiers], urls: [...urls] };
}

const SOURCE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;

/** The package name of a bare specifier ('@scope/name/x' -> '@scope/name'), or null for a relative, absolute or builtin one. */
export function packageName(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('file:') || spec.startsWith('data:')) return null;
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  return BUILTINS.has(name) ? null : name;
}
const BUILTINS = new Set(['assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http', 'https', 'module', 'net', 'os', 'path', 'process', 'readline', 'stream', 'url', 'util', 'worker_threads', 'zlib', 'v8', 'vm', 'tty', 'timers', 'perf_hooks', 'string_decoder', 'querystring', 'dns', 'cluster', 'async_hooks', 'diagnostics_channel', 'inspector', 'test']);

/** Every string target of a package.json "exports"/"main" value, under every condition. */
const exportTargets = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(exportTargets) : typeof v === 'object' && v !== null ? Object.values(v).flatMap(exportTargets) : []);

/**
 * The targets of a package's "." export that Node picks under one set of conditions: the first matching key of each conditions
 * object, as Node resolves it. null conditions: every target under every condition.
 */
export function exportTargetsUnder(v: unknown, conditions: ReadonlySet<string> | null): string[] {
  if (conditions === null) return exportTargets(v);
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap((x) => exportTargetsUnder(x, conditions));
  if (typeof v !== 'object' || v === null) return [];
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.some((k) => k.startsWith('.'))) return '.' in o ? exportTargetsUnder(o['.'], conditions) : [];
  const hit = keys.find((k) => k === 'default' || conditions.has(k));
  return hit === undefined ? [] : exportTargetsUnder(o[hit], conditions);
}

/** The conditions Node always applies to an ES module import, besides the --conditions flags of the process. */
export const NODE_IMPORT_CONDITIONS: readonly string[] = ['node', 'import', 'module-sync', 'node-addons'];

export type Workspace = ReadonlyMap<string, { readonly dir: string; readonly manifest: string; readonly targets: readonly string[]; readonly exports: unknown }>;

/** Workspace packages by name: their directory, package.json path and every file their exports resolve to. */
export function workspaceOf(tree: Tree, read: ReadText): Workspace {
  const ws = new Map<string, { dir: string; manifest: string; targets: string[]; exports: unknown }>();
  for (const p of tree.keys()) {
    if (!/^packages\/[^/]+\/package\.json$/.test(p)) continue;
    const pkg = JSON.parse(read(p)) as { name?: unknown; exports?: unknown; main?: unknown };
    if (typeof pkg.name !== 'string') continue;
    const dir = dirname(p);
    const exports = pkg.exports ?? pkg.main ?? [];
    const targets = exportTargets(exports).map((t) => posix.join(dir, t));
    ws.set(pkg.name, { dir, manifest: p, targets, exports });
  }
  return ws;
}

export type Closure = {
  /** Tree files the step's code loads or names: modules, package.json files resolution goes through, new URL targets. */
  readonly files: ReadonlySet<string>;
  /** External packages imported, each with the package directory that imports it (its pnpm importer). */
  readonly externals: ReadonlySet<string>;
  /** Imports the scan could not resolve to a tree file or a package (a template dynamic import, a missing file). */
  readonly unresolved: readonly string[];
};

/** The import closure of the entry files over the tree. A missing entry is unresolved, never silently dropped. */
/**
 * conditions: the condition sets of the step's Node processes (NODE_IMPORT_CONDITIONS plus each one's --conditions flags); a
 * workspace package's entry is then only the targets Node picks under one of them. Omitted: every target under every condition.
 * The trace check fails a run whose process loaded an entry the key left out, so a narrower key cannot miss an input.
 */
export function importClosure(entries: readonly string[], tree: Tree, read: ReadText, ws: Workspace, scan: (path: string) => { specifiers: string[]; urls: string[] } = (p) => scanSource(read(p)), conditions?: readonly ReadonlySet<string>[]): Closure {
  const files = new Set<string>();
  const externals = new Set<string>();
  const unresolved: string[] = [];
  const dirs = new Map<string, string[]>();
  const under = (dir: string): string[] => {
    let hit = dirs.get(dir);
    if (hit === undefined) {
      hit = [...tree.keys()].filter((p) => p.startsWith(`${dir}/`));
      dirs.set(dir, hit);
    }
    return hit;
  };
  const queue: string[] = [];
  const add = (p: string): void => {
    if (files.has(p)) return;
    files.add(p);
    if (SOURCE.test(p)) queue.push(p);
  };
  const importer = (from: string): string => {
    for (let d = dirname(from); d !== '.' && d !== '/'; d = dirname(d)) if (tree.has(`${d}/package.json`)) return d;
    return '.';
  };
  for (const e of entries) {
    if (tree.has(e)) add(e);
    else unresolved.push(`entry ${e}`);
  }
  while (queue.length > 0) {
    const from = queue.pop()!;
    const { specifiers, urls } = scan(from);
    for (const spec of specifiers) {
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('.')) {
        const p = posix.normalize(posix.join(dirname(from), spec.split('?')[0]!));
        if (tree.has(p)) add(p);
        else unresolved.push(`${from}: ${spec}`);
        continue;
      }
      const name = packageName(spec);
      if (name === null) {
        if (!BUILTINS.has(spec.split('/')[0]!)) unresolved.push(`${from}: ${spec}`);
        continue;
      }
      const w = ws.get(name);
      if (w !== undefined) {
        add(w.manifest);
        const sub = spec.slice(name.length);
        const targets = conditions === undefined ? w.targets : [...new Set(conditions.flatMap((c) => exportTargetsUnder(w.exports, c).map((t) => posix.join(w.dir, t))))];
        if (sub === '') for (const t of targets) tree.has(t) ? add(t) : unresolved.push(`${from}: ${spec} -> ${t}`);
        else for (const p of under(w.dir)) add(p);
        continue;
      }
      externals.add(`${importer(from)}\0${name}`);
    }
    for (const u of urls) {
      const p = posix.normalize(posix.join(dirname(from), u));
      if (tree.has(p)) add(p);
      else {
        const inside = under(p.replace(/\/$/, ''));
        if (inside.length > 0) for (const q of inside) add(q);
        else unresolved.push(`${from}: new URL(${u})`);
      }
    }
  }
  return { files, externals, unresolved: [...new Set(unresolved)].sort() };
}

/** pnpm-lock.yaml (lockfile v9), as the blocks a package's key covers. */
export type Lock = {
  readonly importers: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly packages: ReadonlyMap<string, string>;
  readonly snapshots: ReadonlyMap<string, { readonly text: string; readonly deps: readonly string[] }>;
};

/** Parses the three sections of a v9 pnpm-lock.yaml the key needs; anything else in their shape throws. */
export function parseLock(text: string): Lock {
  const lines = text.split('\n');
  if (!/^lockfileVersion: '9\.\d+'$/.test(lines[0] ?? '')) throw new Error(`regen: pnpm-lock.yaml is not lockfile version 9: ${lines[0]}`);
  const sections = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const l of lines) {
    const top = /^([a-zA-Z]+):/.exec(l);
    if (top !== null) {
      cur = [];
      sections.set(top[1]!, cur);
    } else if (cur !== null) cur.push(l);
  }
  // Blocks at two-space indent, keyed by their (unquoted) key.
  const blocks = (name: string): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    let key: string | null = null;
    for (const l of sections.get(name) ?? []) {
      const m = /^ {2}(\S.*?):(?: \{\})?$/.exec(l);
      if (m !== null) {
        key = m[1]!.replace(/^'(.*)'$/, '$1');
        out.set(key, [l]);
      } else if (l.trim() !== '') {
        if (key === null || !l.startsWith('    ')) throw new Error(`regen: unexpected pnpm-lock.yaml ${name} line ${JSON.stringify(l)}`);
        out.get(key)!.push(l);
      }
    }
    return out;
  };
  const importers = new Map<string, Map<string, string>>();
  for (const [k, b] of blocks('importers')) {
    const deps = new Map<string, string>();
    let dep: string | null = null;
    for (const l of b.slice(1)) {
      const d = /^ {6}(\S.*?):$/.exec(l);
      if (d !== null) dep = d[1]!.replace(/^'(.*)'$/, '$1');
      const v = /^ {8}version: (.+)$/.exec(l);
      if (v !== null && dep !== null) deps.set(dep, v[1]!);
    }
    importers.set(k, deps);
  }
  const packages = new Map([...blocks('packages')].map(([k, b]) => [k, b.join('\n')]));
  const snapshots = new Map<string, { text: string; deps: string[] }>();
  for (const [k, b] of blocks('snapshots')) {
    const deps: string[] = [];
    for (const l of b) {
      const d = /^ {6}(\S.*?): (.+)$/.exec(l);
      if (d !== null) deps.push(`${d[1]!.replace(/^'(.*)'$/, '$1')}@${d[2]!.replace(/^'(.*)'$/, '$1')}`);
    }
    snapshots.set(k, { text: b.join('\n'), deps });
  }
  return { importers, packages, snapshots };
}

/** The base package key of a snapshot key: 'vitest@4.1.11(@types/node@24.19.0)' -> 'vitest@4.1.11'. */
const baseKey = (snap: string): string => {
  const at = snap.indexOf('@', 1);
  const paren = snap.indexOf('(', at);
  return paren < 0 ? snap : snap.slice(0, paren);
};

/**
 * The lockfile text that pins each external import ("<importer>\0<name>") and everything it depends on, as sorted lines, plus
 * the package names involved (what node_modules reads may touch). An import its importer does not list throws: pnpm would not
 * resolve it either, and keying on nothing would hide it.
 */
export function lockClosure(lock: Lock, externals: Iterable<string>): { key: string[]; names: Set<string> } {
  const seen = new Set<string>();
  const key: string[] = [];
  const names = new Set<string>();
  const visit = (snap: string): void => {
    if (seen.has(snap)) return;
    seen.add(snap);
    const s = lock.snapshots.get(snap);
    const p = lock.packages.get(baseKey(snap));
    if (s === undefined && p === undefined) throw new Error(`regen: pnpm-lock.yaml has no snapshot or package ${snap}`);
    names.add(baseKey(snap).slice(0, baseKey(snap).lastIndexOf('@')));
    key.push(`${snap}\n${p ?? ''}\n${s?.text ?? ''}`);
    for (const d of s?.deps ?? []) visit(d);
  };
  for (const ext of externals) {
    const [imp, name] = ext.split('\0') as [string, string];
    // Node walks up node_modules directories: the nearest importer that lists the package wins.
    const chain: string[] = [];
    for (let d = imp; d !== '.'; d = dirname(d)) chain.push(d);
    chain.push('.');
    const version = chain.map((d) => lock.importers.get(d)?.get(name)).find((v) => v !== undefined);
    if (version === undefined) throw new Error(`regen: ${imp} imports ${name}, which pnpm-lock.yaml does not list for it`);
    names.add(name);
    if (version.startsWith('link:')) continue;
    visit(`${name}@${version}`);
  }
  return { key: key.sort(), names };
}
