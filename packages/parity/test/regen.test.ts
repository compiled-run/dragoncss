import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compilePattern, matchSegments, parseIgnoreFile } from '../../../scripts/macroscope-ignore.ts';
import { commandOf, type Context, type Entry, fileStore, type Io, lanesVerdict, MANUAL, MERGE_BY_HAND, parseEntry, pruneStore, regen, restoreBlobs, shared, snapshotTree, STEPS, type Step, stepInputs, type Store, type Tree } from '../../../scripts/regen.ts';
import { importClosure, lockClosure, parseLock, workspaceOf } from '../../../scripts/regen-inputs.ts';
import { repoPath } from '../src/paths.ts';

const matches = (glob: string, path: string): boolean => matchSegments(compilePattern(glob), path.split('/'));

// A fake repository: files by path, git-like blobs, an in-memory cache store, and steps as functions over the files.
type Files = { get: (p: string) => string | undefined; set: (p: string, v: string) => void; del: (p: string) => void; trace: (line: string) => void };
type Impl = (f: Files) => void | { code: number; log: string } | Promise<void>;

const blobOf = (c: string): string => createHash('sha1').update(c).digest('hex');

function memStore(): Store & { entries: Map<string, Entry> } {
  const entries = new Map<string, Entry>();
  const order: string[] = [];
  return {
    entries,
    get: (step, key) => entries.get(`${step}\0${key}`) ?? null,
    put: (step, key, e) => {
      entries.set(`${step}\0${key}`, e);
      order.push(`${step}\0${key}`);
    },
    latest: (step) => {
      const k = order.filter((o) => o.startsWith(`${step}\0`)).at(-1);
      return k === undefined ? null : entries.get(k)!;
    },
  };
}

class World {
  readonly t: Map<string, string>;
  readonly blobs = new Map<string, string>();
  readonly store = memStore();
  ran: string[] = [];
  live = 0;
  maxLive = 0;
  constructor(
    files: Record<string, string>,
    readonly impls: Record<string, Impl>,
  ) {
    this.t = new Map(Object.entries(files));
  }
  set(files: Record<string, string | null>): this {
    for (const [p, v] of Object.entries(files)) v === null ? this.t.delete(p) : this.t.set(p, v);
    return this;
  }
  io(): Io {
    this.ran = [];
    const snapshot = (): Tree => {
      const tree = new Map<string, string>();
      for (const [p, c] of [...this.t].sort()) {
        const b = blobOf(c);
        this.blobs.set(b, c);
        tree.set(p, b);
      }
      return tree;
    };
    return {
      snapshot,
      context: (tree) => ({ tree, read: (p) => this.blobs.get(tree.get(p)!)!, scripts: { 'gen:x': 'node tools/gen.ts' }, env: { E: this.t.get('env/E') }, machine: 'test' }),
      run: async (s) => {
        this.ran.push(s.name);
        this.maxLive = Math.max(this.maxLive, ++this.live);
        const written = new Set<string>();
        const trace: string[] = [`A\t/r\t["node","/r/${s.argv[1]}"]`];
        const files: Files = {
          get: (p) => {
            trace.push(`R\t/r/${p}`);
            return this.t.get(p);
          },
          set: (p, v) => {
            written.add(p);
            this.t.set(p, v);
          },
          del: (p) => {
            written.add(p);
            this.t.delete(p);
          },
          trace: (line) => trace.push(line),
        };
        await new Promise((r) => setTimeout(r, 1));
        const out = await this.impls[s.name]!(files);
        this.live--;
        return { code: out?.code ?? 0, log: out?.log ?? '', trace, touched: (paths) => new Set(paths.filter((p) => written.has(p))) };
      },
      restore: (files) => {
        if (Object.values(files).some((b) => b !== null && !this.blobs.has(b))) return false;
        for (const [p, b] of Object.entries(files)) b === null ? this.t.delete(p) : this.t.set(p, this.blobs.get(b)!);
        return true;
      },
      store: this.store,
      roots: ['/r'],
      log: () => {},
      now: () => 0,
    };
  }
}

const node = (name: string, file: string, outputs: string[], extra: Partial<Step> = {}): Step => ({ name, argv: ['node', file], outputs, ...extra });
const opts = { force: false, check: false, from: null };

// gen: tools/gen.ts (imports tools/lib.ts) reads data/a and writes out/a. rows: tools/rows.ts (imports tools/lib.ts) reads
// out/a and writes out/b. other: tools/other.ts reads data/c and writes out/c; it shares nothing with the other two.
const SOURCES = {
  'tools/gen.ts': "import { f } from './lib.ts';\nimport type { T } from './types.ts';\n",
  'tools/rows.ts': "import { f } from './lib.ts';\n",
  'tools/lib.ts': 'export const f = 1;\n',
  'tools/types.ts': 'export type T = 1;\n',
  'tools/other.ts': "import { g } from './other-lib.ts';\n",
  'tools/other-lib.ts': 'export const g = 1;\n',
  'data/a/x': '1',
  'data/c': 'c',
  'docs/notes.md': 'notes',
  'data/unread': 'u',
};
const CHAIN = [node('gen', 'tools/gen.ts', ['out/a'], { reads: ['data/a/**'] }), node('rows', 'tools/rows.ts', ['out/b'], { reads: ['out/a'] }), node('other', 'tools/other.ts', ['out/c'], { reads: ['data/c'] })];
const IMPL: Record<string, Impl> = {
  gen: (f) => f.set('out/a', `A(${f.get('data/a/x')})`),
  rows: (f) => f.set('out/b', `B(${f.get('out/a')})`),
  other: (f) => f.set('out/c', `C(${f.get('data/c')})`),
};

/** A world after a first full run, with every step cached. */
async function warm(): Promise<World> {
  const w = new World(SOURCES, IMPL);
  const r = await regen(CHAIN, opts, w.io());
  expect(r, r.error ?? '').toMatchObject({ ok: true, error: null });
  return w;
}

describe('pnpm regen chain', () => {
  it('runs to a fixed point, then a second run has nothing to do', async () => {
    const w = new World(SOURCES, IMPL);
    const r1 = await regen(CHAIN, opts, w.io());
    expect(r1).toMatchObject({ ok: true, changed: ['out/a', 'out/b', 'out/c'], error: null, passes: 2 });
    expect(w.t.get('out/b')).toBe('B(A(1))');
    const r2 = await regen(CHAIN, opts, w.io());
    expect(r2).toMatchObject({ ok: true, changed: [], ran: 0, passes: 1 });
    expect(w.ran).toEqual([]);
  });

  it('reruns exactly the steps that read a changed file, and nothing for a file no step reads', async () => {
    // Each file of the repository, edited on its own, against the steps that must rerun.
    const cases: [string, string, string[]][] = [
      ['tools/gen.ts', '// edited\n', ['gen']],
      ['tools/lib.ts', '// edited\n', ['gen', 'rows']],
      ['tools/rows.ts', '// edited\n', ['rows']],
      ['tools/other.ts', '// edited\n', ['other']],
      ['tools/other-lib.ts', '// edited\n', ['other']],
      // A changed output reruns its readers; an unchanged one stops there.
      ['data/a/x', '', ['gen', 'rows']],
      ['data/a/new', '', ['gen']],
      ['data/c', '', ['other']],
      // Type-only imports load nothing; docs and unread data are read by no step.
      ['tools/types.ts', '// edited\n', []],
      ['docs/notes.md', '!', []],
      ['data/unread', '!', []],
      ['README.md', 'new file', []],
    ];
    for (const [path, suffix, expected] of cases) {
      const w = await warm();
      w.set({ [path]: `${w.t.get(path) ?? ''}${suffix || '2'}` });
      const r = await regen(CHAIN, opts, w.io());
      expect(r.ok, `${path}: ${r.error}`).toBe(true);
      expect([...w.ran].sort(), path).toEqual(expected);
    }
  });

  it('restores a planted stale output from the cache, and --check names it', async () => {
    const w = await warm();
    w.set({ 'out/b': 'stale' });
    const r = await regen(CHAIN, { ...opts, check: true }, w.io());
    expect(r).toMatchObject({ ok: true, changed: ['out/b'], ran: 0 });
    expect(r.records.filter((x) => x.action !== 'skipped').map((x) => `${x.step} ${x.action}`)).toEqual(['rows restored']);
    expect(w.t.get('out/b')).toBe('B(A(1))');
    // A deleted output and an extra file under a step's outputs are restored away too.
    w.set({ 'out/a': null });
    expect((await regen(CHAIN, opts, w.io())).changed).toEqual(['out/a']);
    expect(w.ran).toEqual([]);
  });

  it('runs a step instead of restoring when its recorded run read its outputs, left one untouched, or lost a blob', async () => {
    // merge reads its own output and adds a line: its result depends on what the tree had, so only a run can make it.
    const merge = node('merge', 'tools/gen.ts', ['out/m', 'out/keep']);
    const impls: Record<string, Impl> = { merge: (f) => f.set('out/m', `${f.get('out/m') ?? ''}+`) };
    const w = new World({ ...SOURCES, 'out/m': '', 'out/keep': 'k' }, impls);
    expect((await regen([merge], opts, w.io())).ok).toBe(true);
    const [entry] = [...w.store.entries.values()];
    expect(entry!.restorable).toBe(false);
    w.set({ 'out/m': 'x' });
    await regen([merge], opts, w.io());
    expect(w.ran).toEqual(['merge']);
    // A pure writer whose blob is gone from the object database runs.
    const v = await warm();
    v.set({ 'out/b': 'stale' });
    const b = v.store.get('rows', [...v.store.entries.keys()].find((k) => k.startsWith('rows\0'))!.split('\0')[1]!)!.outputs['out/b']!;
    v.blobs.delete(b);
    await regen(CHAIN, opts, v.io());
    expect(v.ran).toEqual(['rows']);
  });

  it('keeps one entry per input state, so switching branches back and forth reruns nothing', async () => {
    const w = await warm();
    const a = new Map(w.t);
    w.set({ 'data/a/x': '2' });
    await regen(CHAIN, opts, w.io());
    expect([...w.ran].sort()).toEqual(['gen', 'rows']);
    const b = new Map(w.t);
    for (const tree of [a, b, a]) {
      w.t.clear();
      for (const [k, v] of tree) w.t.set(k, v);
      expect(await regen(CHAIN, opts, w.io())).toMatchObject({ ok: true, ran: 0, changed: [] });
    }
    // A merge that keeps one side's outputs (out/* from b) with the other side's inputs (data/a/x from a) restores a's outputs.
    w.set({ 'out/a': b.get('out/a')!, 'out/b': b.get('out/b')!, 'data/a/x': a.get('data/a/x')! });
    expect(await regen(CHAIN, opts, w.io())).toMatchObject({ ok: true, ran: 0, changed: ['out/a', 'out/b'] });
    expect(w.t.get('out/b')).toBe(a.get('out/b'));
  });

  it('keys a step on its command, script text, environment and machine', async () => {
    const tree = new Map([['tools/gen.ts', 'x'], ['data/a/x', '1']].map(([p, c]) => [p!, blobOf(c!)]));
    const ctx = (over: Partial<Context> = {}): Context => ({ tree, read: () => '', scripts: { 'gen:x': 'node tools/gen.ts' }, env: { E: '1' }, machine: 'm', ...over });
    const s = node('gen', 'tools/gen.ts', ['out/a'], { reads: ['data/a/**'], env: ['E'] });
    const key = (st: Step, c: Context): string => stepInputs(st, c, shared(c)).key;
    const base = key(s, ctx());
    expect(key(s, ctx())).toBe(base);
    expect(key(s, ctx({ env: { E: '2' } }))).not.toBe(base);
    expect(key(s, ctx({ env: { E: '1', OTHER: '1' } }))).toBe(base);
    expect(key(s, ctx({ machine: 'n' }))).not.toBe(base);
    expect(key({ ...s, argv: ['node', 'tools/gen.ts', '--x'] }, ctx())).not.toBe(base);
    const viaScript = { ...s, argv: ['pnpm', '-s', 'run', 'gen:x'] };
    expect(key(viaScript, ctx({ scripts: { 'gen:x': 'node tools/gen.ts --other' } }))).not.toBe(key(viaScript, ctx()));
    // Own outputs are not inputs: their content is judged against the recorded run instead.
    expect(key(s, ctx({ tree: new Map([...tree, ['out/a', blobOf('o')]]) }))).toBe(base);
  });

  it('repeats the chain while a later step feeds an earlier one, and fails loudly at the pass cap', async () => {
    // rows reads out/c, which the last step writes from out/b: two passes change files, the third changes nothing.
    const loop = [node('gen', 'tools/gen.ts', ['out/a'], { reads: ['data/a/**'] }), node('rows', 'tools/rows.ts', ['out/b'], { reads: ['out/a', 'out/c'] }), node('lanes', 'tools/other.ts', ['out/c'], { reads: ['out/b'] })];
    const loopImpl: Record<string, Impl> = { ...IMPL, rows: (f) => f.set('out/b', `B(${f.get('out/a')},${f.get('out/c') ?? '-'})`), lanes: (f) => f.set('out/c', f.get('out/b')!.length > 12 ? 'C' : 'c') };
    const w = new World(SOURCES, loopImpl);
    expect(await regen(loop, opts, w.io())).toMatchObject({ ok: true, passes: 3 });
    expect(w.ran).toEqual(['gen', 'rows', 'lanes', 'rows', 'lanes']);
    const v = new World(SOURCES, loopImpl);
    const r = await regen(loop, opts, v.io(), 2);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no fixed point after 2 passes/);
    // A feedback loop that never settles hits the cap too.
    const grow = { a: (f: Files) => f.set('out/a', `A${f.get('out/b') ?? ''}`), b: (f: Files) => f.set('out/b', f.get('out/a')!) };
    const g = new World(SOURCES, grow);
    expect((await regen([node('a', 'tools/gen.ts', ['out/a'], { reads: ['out/b'] }), node('b', 'tools/rows.ts', ['out/b'], { reads: ['out/a'] })], opts, g.io())).error).toBe('no fixed point after 5 passes; the last pass changed out/a, out/b');
  });

  it('does not take a pass whose steps changed a file and then changed it back for a fixed point', async () => {
    const flip = { set: (f: Files) => f.set('out/x', 'set'), reset: (f: Files) => f.set('out/x', 'base') };
    const w = new World({ ...SOURCES, 'out/x': 'base' }, flip);
    expect((await regen([node('set', 'tools/gen.ts', ['out/x']), node('reset', 'tools/rows.ts', ['out/x'])], opts, w.io())).error).toBe('no fixed point after 5 passes; the last pass changed out/x');
  });

  it('runs independent steps in parallel and dependent ones in order, within --jobs', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const impls: Record<string, Impl> = {
      gen: async (f) => {
        order.push('gen start');
        await gate;
        f.set('out/a', `A(${f.get('data/a/x')})`);
        order.push('gen end');
      },
      rows: (f) => void (order.push('rows'), f.set('out/b', `B(${f.get('out/a')})`)),
      other: (f) => void (order.push('other'), release(), f.set('out/c', 'C')),
    };
    const w = new World(SOURCES, impls);
    expect((await regen(CHAIN, { ...opts, jobs: 2 }, w.io())).ok).toBe(true);
    // other ran while gen was waiting; rows waited for gen, whose output it reads.
    expect(order).toEqual(['gen start', 'other', 'gen end', 'rows']);
    expect(w.maxLive).toBe(2);
    const v = new World(SOURCES, IMPL);
    await regen(CHAIN, { ...opts, jobs: 1 }, v.io());
    expect(v.maxLive).toBe(1);
    expect(v.ran).toEqual(['gen', 'rows', 'other']);
  });

  it('fails a step that writes outside its declared outputs, and one that exits non-zero, recording no entry for it', async () => {
    const w = new World(SOURCES, { gen: (f) => f.set('data/c', 'edited') });
    const r = await regen([CHAIN[0]!], opts, w.io());
    expect(r).toMatchObject({ ok: false, error: 'gen changed files outside its declared outputs: data/c' });
    const v = new World(SOURCES, { gen: () => ({ code: 3, log: 'one\ntwo' }) });
    expect(await regen([CHAIN[0]!], opts, v.io())).toMatchObject({ ok: false, error: 'gen exited 3; the last lines of its output:\none\ntwo' });
    expect(v.store.entries.size).toBe(0);
  });

  it('accepts a non-zero exit only when the step judges it a recorded verdict', async () => {
    const judge: Step = { ...CHAIN[0]!, verdict: (code, log) => code === 1 && log === 'all written\n' };
    const impl = (log: string): Impl => (f) => (f.set('out/a', 'A'), { code: 1, log });
    expect(await regen([judge], opts, new World(SOURCES, { gen: impl('all written\n') }).io())).toMatchObject({ ok: true, error: null });
    expect((await regen([judge], opts, new World(SOURCES, { gen: impl('crashed\n') }).io())).error).toBe('gen exited 1; the last lines of its output:\ncrashed\n');
  });

  it('fails a run that read a file or package its key does not cover, naming it', async () => {
    const reads = (extra: string): Impl => (f) => (f.trace(extra), f.set('out/a', 'A'));
    const fails = async (line: string): Promise<string | null> => (await regen([CHAIN[0]!], opts, new World(SOURCES, { gen: reads(line) }).io())).error;
    expect(await fails('R\t/r/data/unread')).toBe('gen read files its cache key does not cover; add them to its reads (or packages) in scripts/regen.ts:\n  read data/unread');
    expect(await fails('D\t/r/data')).toMatch(/listed data\/ \(2 unkeyed files, such as data\/c, data\/unread\)/);
    expect(await fails('P\t/r/docs/notes.md')).toMatch(/probed docs\/notes.md/);
    expect(await fails('X\t/r\t["swiftc","tools/other.ts"]')).toMatch(/passed to swiftc tools\/other.ts/);
    expect(await fails('X\t/r/tools\t["gradle","build"]')).toMatch(/ran gradle in tools\//);
    expect(await fails('R\t/r/node_modules/.pnpm/left-pad@1.0.0/node_modules/left-pad/index.js')).toMatch(/read installed package left-pad/);
    // Keyed files, the step's own data directory, files outside the repository and pnpm reading the manifests pass.
    for (const ok of ['R\t/r/data/a/x', 'D\t/r/data/a', 'R\t/r/tools/lib.ts', 'R\t/etc/hosts', 'R\t/r/out/a', 'X\t/r\t["node","/r/tools/gen.ts"]']) expect(await fails(ok), ok).toBeNull();
    const pnpmRead = (f: Files): void => (f.trace('A\t/r\t["node","/x/node_modules/pnpm/bin/pnpm.cjs","run"]'), f.trace('R\t/r/package.json'), f.set('out/a', 'A'));
    expect((await regen([CHAIN[0]!], opts, new World({ ...SOURCES, 'package.json': '{}' }, { gen: pnpmRead }).io())).error).toBeNull();
  });

  it('--force reruns every step once, ignoring recorded entries; --from starts at a step and still ends on a full pass', async () => {
    const w = await warm();
    expect(await regen(CHAIN, { ...opts, force: true }, w.io())).toMatchObject({ ok: true, ran: 3, passes: 1 });
    const v = new World(SOURCES, IMPL);
    expect(await regen(CHAIN, { ...opts, from: 'rows' }, v.io())).toMatchObject({ ok: true });
    expect(v.ran.slice(0, 2)).toEqual(['rows', 'other']);
    expect((await regen(CHAIN, { ...opts, from: 'nope' }, v.io())).error).toBe('unknown step nope; the steps are gen, rows, other');
    expect((await regen([CHAIN[0]!, CHAIN[0]!], opts, v.io())).error).toBe('step gen is named twice');
  });

  it('fails a step that edits one of its own inputs, recording nothing', async () => {
    const w = new World(SOURCES, { ...IMPL, gen: (f) => (f.set('out/a', 'A'), w.set({ 'tools/lib.ts': 'export const f = 2;\n' }), undefined) });
    const r = await regen([CHAIN[0]!], opts, w.io());
    expect(r).toMatchObject({ ok: false, error: 'gen changed files outside its declared outputs: tools/lib.ts' });
    expect(w.store.entries.size).toBe(0);
  });
});

describe('step inputs', () => {
  const tree = (files: Record<string, string>): { tree: Tree; ctx: Context } => {
    const blobs = new Map<string, string>();
    const t = new Map(Object.entries(files).map(([p, c]) => {
      blobs.set(blobOf(c), c);
      return [p, blobOf(c)];
    }));
    return { tree: t, ctx: { tree: t, read: (p) => blobs.get(t.get(p)!)!, scripts: {}, env: {}, machine: 'm' } };
  };
  const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      vitest:
        specifier: ^4
        version: 4.1.11

  packages/a:
    dependencies:
      css-tree:
        specifier: 3.2.1
        version: 3.2.1
      b:
        specifier: workspace:*
        version: link:../b

packages:

  css-tree@3.2.1:
    resolution: {integrity: sha512-x}

  mdn-data@2.12.2:
    resolution: {integrity: sha512-y}

  vitest@4.1.11:
    resolution: {integrity: sha512-z}

snapshots:

  css-tree@3.2.1:
    dependencies:
      mdn-data: 2.12.2

  mdn-data@2.12.2: {}

  vitest@4.1.11: {}
`;
  const files = {
    'pnpm-lock.yaml': LOCK,
    'packages/a/package.json': '{"name":"a"}',
    'packages/b/package.json': '{"name":"b","exports":{".":{"dragon-internal":"./src/internal.ts","default":"./src/index.ts"}}}',
    'packages/b/src/index.ts': "export * from './x.ts';",
    'packages/b/src/internal.ts': "export * from './index.ts';\nexport { y } from './y.ts';",
    'packages/b/src/x.ts': 'export const x = 1;',
    'packages/b/src/y.ts': 'export const y = 1;',
    'packages/b/src/unused.ts': 'export const u = 1;',
    'packages/a/src/cli.ts': "import { x } from 'b';\nimport * as csstree from 'css-tree';\nimport type { Q } from './types.ts';\nconst d = new URL('../fixtures/', import.meta.url);\nconst w = await import('./lazy.ts');\nconst s = ['import ', ', '].join('');\n",
    'packages/a/src/types.ts': 'export type Q = 1;',
    'packages/a/src/lazy.ts': "import { readFileSync } from 'node:fs';",
    'packages/a/fixtures/one.html': '<p>',
    'packages/a/fixtures/sub/two.html': '<p>',
  };

  it('follows relative, workspace (every export condition), dynamic and new URL imports, but not type-only ones', () => {
    const { tree: t, ctx } = tree(files);
    const c = importClosure(['packages/a/src/cli.ts'], t, ctx.read, workspaceOf(t, ctx.read));
    expect([...c.files].sort()).toEqual(['packages/a/fixtures/one.html', 'packages/a/fixtures/sub/two.html', 'packages/a/src/cli.ts', 'packages/a/src/lazy.ts', 'packages/b/package.json', 'packages/b/src/index.ts', 'packages/b/src/internal.ts', 'packages/b/src/x.ts', 'packages/b/src/y.ts']);
    expect([...c.externals]).toEqual(['packages/a\0css-tree']);
    expect(c.unresolved).toEqual([]);
    expect(importClosure(['packages/a/src/missing.ts'], t, ctx.read, workspaceOf(t, ctx.read)).unresolved).toEqual(['entry packages/a/src/missing.ts']);
    const broken = tree({ ...files, 'packages/a/src/lazy.ts': "import './gone.ts';" });
    expect(importClosure(['packages/a/src/cli.ts'], broken.tree, broken.ctx.read, workspaceOf(broken.tree, broken.ctx.read)).unresolved).toEqual(['packages/a/src/lazy.ts: ./gone.ts']);
  });

  it('keys on the lockfile entries of the imported packages and their dependencies only', () => {
    const lock = parseLock(LOCK);
    const c = lockClosure(lock, ['packages/a\0css-tree']);
    expect([...c.names].sort()).toEqual(['css-tree', 'mdn-data']);
    const key = (text: string): string => lockClosure(parseLock(text), ['packages/a\0css-tree']).key.join('\n');
    expect(key(LOCK.replace('sha512-z', 'sha512-Z'))).toBe(key(LOCK));
    expect(key(LOCK.replace('sha512-y', 'sha512-Y'))).not.toBe(key(LOCK));
    expect(() => lockClosure(lock, ['packages/a\0left-pad'])).toThrow('packages/a imports left-pad, which pnpm-lock.yaml does not list for it');
    expect(() => parseLock("lockfileVersion: '6.0'\n")).toThrow(/not lockfile version 9/);
  });

  it('reads a step command through package.json scripts and sh -c, and refuses one it cannot key', () => {
    const scripts = { 'a:gen': 'node --conditions=dragon-internal packages/a/src/cli.ts', 'b:gen': 'node packages/b/src/x.ts --flag' };
    expect(commandOf(['pnpm', '-s', 'run', 'a:gen', '--x'], scripts)).toEqual({ entries: ['packages/a/src/cli.ts'], scripts: ['a:gen=node --conditions=dragon-internal packages/a/src/cli.ts'] });
    expect(commandOf(['sh', '-c', 'pnpm -s run a:gen && pnpm -s run b:gen --y'], scripts).entries).toEqual(['packages/a/src/cli.ts', 'packages/b/src/x.ts']);
    expect(() => commandOf(['pnpm', '-s', 'run', 'nope'], scripts)).toThrow('package.json has no script nope');
    expect(() => commandOf(['make', 'all'], scripts)).toThrow(/runs make, which regen cannot key/);
  });

  it('changes the key for an import, a data file or a package, and not for an unread file', () => {
    const step: Step = { name: 'a', argv: ['node', 'packages/a/src/cli.ts'], outputs: ['packages/a/out/**'], reads: ['packages/a/data/**'] };
    const key = (over: Record<string, string>): string => {
      const { ctx } = tree({ ...files, 'packages/a/data/d.json': '1', ...over });
      return stepInputs(step, ctx, shared(ctx)).key;
    };
    const base = key({});
    for (const [p, v] of Object.entries({ 'packages/b/src/y.ts': '2', 'packages/a/fixtures/sub/two.html': '2', 'packages/a/data/d.json': '2', 'packages/a/data/new.json': '1', 'packages/b/package.json': '{"name":"b","exports":"./src/x.ts"}', 'pnpm-lock.yaml': LOCK.replace('sha512-y', 'sha512-Y') })) expect(key({ [p]: v }), p).not.toBe(base);
    for (const [p, v] of Object.entries({ 'packages/b/src/unused.ts': '2', 'packages/a/src/types.ts': '2', 'packages/a/out/x': '1', 'README.md': '1', 'pnpm-lock.yaml': LOCK.replace('sha512-z', 'sha512-Z') })) expect(key({ [p]: v }), p).toBe(base);
  });

  it('every regen step resolves its command and imports on this tree', () => {
    const t = snapshotTree(repoPath('.'));
    const read = (p: string): string => readFileSync(repoPath(p), 'utf8');
    const ctx: Context = { tree: t, read, scripts: (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts, env: {}, machine: 'm' };
    const sh = shared(ctx);
    for (const s of STEPS) expect(stepInputs(s, ctx, sh).files.size, s.name).toBeGreaterThan(0);
  });
});

describe('regen cache entries', () => {
  it('reads a malformed entry as none', () => {
    const blob = 'a'.repeat(40);
    expect(parseEntry('{')).toBeNull();
    expect(parseEntry(JSON.stringify({ version: 1, outputs: {}, inputs: {}, restorable: true }))).toBeNull();
    expect(parseEntry(JSON.stringify({ version: 2, outputs: { a: 'nope' }, inputs: {}, restorable: true }))).toBeNull();
    expect(parseEntry(JSON.stringify({ version: 2, outputs: { a: blob }, inputs: {}, restorable: 'yes' }))).toBeNull();
    expect(parseEntry(JSON.stringify({ version: 2, outputs: { a: blob }, inputs: { b: blob }, restorable: true }))).toEqual({ outputs: { a: blob }, inputs: { b: blob }, restorable: true });
  });

  it('stores entries as files any worktree can read, and prunes old ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'regen-store-'));
    try {
      const s = fileStore(dir);
      const e: Entry = { outputs: { a: 'b'.repeat(40) }, inputs: {}, restorable: true };
      expect(s.get('gen', 'k')).toBeNull();
      s.put('gen', 'k', e);
      expect(fileStore(dir).get('gen', 'k')).toEqual(e);
      expect(s.latest('gen')).toEqual(e);
      writeFileSync(join(dir, 'gen', 'bad.json'), '{');
      expect(s.get('gen', 'bad')).toBeNull();
      expect(pruneStore(dir, 30, Date.now() + 31 * 86_400_000)).toBe(2);
      expect(s.get('gen', 'k')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restores outputs from git blobs and refuses a missing blob', () => {
    const dir = mkdtempSync(join(tmpdir(), 'regen-restore-'));
    try {
      execFileSync('git', ['init', '-q', dir]);
      writeFileSync(join(dir, 'f'), 'hello\n');
      const sha = execFileSync('git', ['-C', dir, 'hash-object', '-w', 'f'], { encoding: 'utf8' }).trim();
      writeFileSync(join(dir, 'gone'), 'x');
      expect(restoreBlobs(dir, { 'out/g': sha, gone: null })).toBe(true);
      expect(readFileSync(join(dir, 'out/g'), 'utf8')).toBe('hello\n');
      expect(existsSync(join(dir, 'gone'))).toBe(false);
      expect(restoreBlobs(dir, { 'out/h': 'f'.repeat(40) })).toBe(false);
      expect(existsSync(join(dir, 'out/h'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('lanes-host verdict', () => {
  const agree = 'parity:lanes: lanes, case lists, tolerances, sample rules, dump faults and the projection agree on ios and android';
  const log = (...lanes: string[]) => `ios:\n${lanes.map((l) => `  ${l}; cases [2: 460]`).join('\n')}\n${agree}\n`;

  it('accepts exit 1 only for failing device lanes with every host lane passing', () => {
    expect(lanesVerdict(1, log('layout-vectors-host: pass', 'layout-vectors-device: pass', 'device-pixels: fail (135 failures)'))).toBe(true);
    expect(lanesVerdict(1, log('layout-vectors-host: fail (3 suites)', 'device-pixels: fail (135 failures)'))).toBe(false);
    expect(lanesVerdict(1, log('layout-vectors-host: pending', 'device-pixels: fail (135 failures)'))).toBe(false);
    expect(lanesVerdict(1, log('layout-vectors-host: pass', 'device-pixels: pass'))).toBe(false);
    expect(lanesVerdict(1, log('device-pixels: fail (135 failures)'))).toBe(false);
    expect(lanesVerdict(1, log('layout-vectors-host: pass', 'device-pixels: fail (1)').replace(agree, 'parity:lanes: parity FAILS:'))).toBe(false);
    expect(lanesVerdict(2, log('layout-vectors-host: pass', 'device-pixels: fail (1)'))).toBe(false);
  });
});

describe('catch-up procedure (AGENTS.md step 2)', () => {
  it('sets up the merge driver before the merge, so generated outputs never stop it', () => {
    const step = readFileSync(repoPath('AGENTS.md'), 'utf8').split('\n').find((l) => l.startsWith('2. **Catch up'))!;
    expect(step.indexOf('pnpm setup:git')).toBeGreaterThan(-1);
    expect(step.indexOf('pnpm setup:git')).toBeLessThan(step.indexOf('git merge origin/master'));
    expect(step.indexOf('git merge origin/master')).toBeLessThan(step.indexOf('pnpm regen'));
  });
});

describe('merge policy (.gitattributes)', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter((p) => p !== '');
  const policy = new Set(execFileSync('git', ['ls-files', '-z', ':(attr:merge=dragon-generated)'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter((p) => p !== ''));
  const lines = readFileSync(repoPath('.gitattributes'), 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const written = (p: string): boolean => STEPS.some((s) => s.outputs.some((g) => matches(g, p)));
  const byHand = (p: string): boolean => MERGE_BY_HAND.some((h) => matches(h.path, p));

  it('covers every tracked file a regen step writes, except the listed merge-by-hand files', () => {
    for (const s of STEPS) for (const g of s.outputs) expect(tracked.filter((p) => matches(g, p)), `${s.name} output ${g} matches no tracked file`).not.toEqual([]);
    expect(tracked.filter((p) => written(p) && !byHand(p) && !policy.has(p))).toEqual([]);
    for (const h of MERGE_BY_HAND) expect(tracked.filter((p) => matches(h.path, p) && written(p)), h.path).not.toEqual([]);
  });

  it('covers only files regen rebuilds and review skips, so it never hides a source conflict', () => {
    const ignore = parseIgnoreFile(readFileSync(repoPath('.macroscope/ignore.md'), 'utf8'));
    expect([...policy].filter((p) => !written(p) || byHand(p))).toEqual([]);
    expect([...policy].filter((p) => !ignore.matches(p))).toEqual([]);
  });

  it('lists exactly the regen steps\' outputs, one pattern per line, each matching a tracked file (a pattern without "/" only at the root)', () => {
    const outputs = STEPS.flatMap((s) => s.outputs).filter((o) => !MERGE_BY_HAND.some((h) => h.path === o));
    expect(lines).toEqual(outputs.map((o) => `${o} merge=dragon-generated`));
    for (const l of lines) {
      const m = /^(\S+) merge=dragon-generated$/.exec(l);
      expect(m, l).not.toBeNull();
      const hits = tracked.filter((p) => matches(m![1]!, p));
      expect(hits, `${l} matches no tracked file`).not.toEqual([]);
      if (!m![1]!.includes('/')) expect(hits.filter((p) => p.includes('/')), `${l} matches below the root`).toEqual([]);
    }
  });

  it('lists a producer for every tracked file under the generated shapes of .macroscope/ignore.md', () => {
    const text = readFileSync(repoPath('.macroscope/ignore.md'), 'utf8');
    const section = text.split('# === Dragon: generated or captured data')[1]!.split('# === Dragon: not code')[0]!;
    const shapes = parseIgnoreFile(section);
    const manual = (p: string): boolean => MANUAL.some((m) => m.outputs.some((g) => matches(g, p)));
    expect(tracked.filter((p) => shapes.matches(p) && !written(p) && !manual(p))).toEqual([]);
    for (const m of MANUAL) for (const g of m.outputs) expect(tracked.some((p) => matches(g, p)), `${m.command}: ${g}`).toBe(true);
  });
});

// The full chain takes many minutes and needs Chrome, Xcode and the Android SDK: DRAGON_REGEN_CHECK=1 runs it.
describe.runIf(process.env.DRAGON_REGEN_CHECK === '1')('pnpm regen --check on this tree', () => {
  const run = () => spawnSync('pnpm', ['-s', 'regen', '--check'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  it('is at a fixed point, and fails naming a planted stale output', () => {
    const clean = run();
    expect(clean.status, clean.stdout + clean.stderr).toBe(0);
    const file = 'packages/dragon/src/css/grammar.generated.ts';
    const original = readFileSync(repoPath(file), 'utf8');
    try {
      writeFileSync(repoPath(file), `${original}// stale\n`);
      const stale = run();
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain(`files were stale:\n${file}`);
    } finally {
      writeFileSync(repoPath(file), original);
    }
  }, 3_600_000);
});
