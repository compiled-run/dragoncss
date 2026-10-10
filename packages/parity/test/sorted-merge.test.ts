import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MERGE_DRIVERS } from '../../../scripts/floor-merge.ts';
import { lineKey, mergeSortedFile, Refuse, SORTED_MERGE_DRIVER, SORTED_REGISTRIES } from '../../../scripts/sorted-merge.ts';
import { repoPath } from '../src/paths.ts';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const FIX = 'packages/parity/src/fixtures.ts';
const imp = (id: string, name: string): string => `import { ${name} } from './fixture-groups/${id}.ts';`;
const ent = (id: string, name: string): string => `  ${/-/.test(id) ? `'${id}'` : id}: ${name},`;
const GROUP_IDS: [string, string][] = [['background', 'BACKGROUND'], ['cascade-var', 'CASCADE_VAR'], ['contexts', 'CONTEXTS'], ['fonts', 'FONTS'], ['grid', 'GRID'], ['units', 'UNITS']];
/** A fixtures.ts-shaped file with these groups (sorted by the caller), its imports and its GROUPS block. */
const fixtures = (groups: readonly [string, string][]): string =>
  [
    '// The parity corpus.',
    "import type { DiagnosticCode } from 'dragon';",
    ...groups.map(([id, n]) => imp(id, n)),
    '',
    'export const ENVIRONMENT = 1;',
    '',
    'export const GROUPS = {',
    ...groups.map(([id, n]) => ent(id, n)),
    '} as const;',
    '',
    'export const LEGACY_RUN_ORDER = [];',
    '',
  ].join('\n');
const sortById = (gs: [string, string][]): [string, string][] => [...gs].sort((x, y) => (x[0] < y[0] ? -1 : 1));
const add = (...more: [string, string][]): string => fixtures(sortById([...GROUP_IDS, ...more]));
const BASE = fixtures(GROUP_IDS);
const merge = (o: string, a: string, b: string, path = FIX): ReturnType<typeof mergeSortedFile> => mergeSortedFile(path, o, a, b);

describe('mergeSortedFile', () => {
  it('interleaves env and ctx-proof (the #176 / #179 case) in both the imports and the GROUPS lines, by the tests\' sort', () => {
    const env: [string, string] = ['env', 'ENV'];
    const ctx: [string, string] = ['ctx-proof', 'CTX_PROOF'];
    // A plain line merge conflicts here: both insert between contexts and fonts.
    const r = merge(BASE, add(env), add(ctx));
    expect(r.conflicts).toBe(0);
    expect(r.resolved).toBe(2);
    expect(r.text).toBe(add(env, ctx));
    expect(r.text).toContain([imp('contexts', 'CONTEXTS'), imp('ctx-proof', 'CTX_PROOF'), imp('env', 'ENV'), imp('fonts', 'FONTS')].join('\n'));
    expect(r.text).toContain(["  contexts: CONTEXTS,", "  'ctx-proof': CTX_PROOF,", '  env: ENV,', '  fonts: FONTS,'].join('\n'));
    // Symmetric: theirs and ours swapped give the same file.
    expect(merge(BASE, add(ctx), add(env)).text).toBe(r.text);
  });

  it('keeps a line both sides added once', () => {
    const env: [string, string] = ['env', 'ENV'];
    expect(merge(BASE, add(env), add(env))).toEqual({ text: add(env), conflicts: 0, resolved: 0 });
    // The same line plus a different one on one side: still one copy of env.
    const r = merge(BASE, add(env), add(env, ['ctx-proof', 'CTX_PROOF']));
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe(add(env, ['ctx-proof', 'CTX_PROOF']));
    expect(r.text.match(/env: ENV,/g)).toHaveLength(1);
  });

  it('interleaves several additions from each side in sorted order', () => {
    const ours: [string, string][] = [['a-first', 'A_FIRST'], ['d-mid', 'D_MID'], ['env', 'ENV'], ['zzz', 'ZZZ']];
    const theirs: [string, string][] = [['ab', 'AB'], ['ctx-proof', 'CTX_PROOF'], ['eo', 'EO'], ['ha', 'HA'], ['zz', 'ZZ']];
    const r = merge(BASE, add(...ours), add(...theirs));
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe(add(...ours, ...theirs));
  });

  it('sorts quoted and unquoted ids by the id, and imports by file name as registry-claims.test.ts does', () => {
    const reg = SORTED_REGISTRIES[FIX]!;
    expect(lineKey(reg, "  'ctx-proof': CTX_PROOF,", true)).toEqual({ kind: 'entry', key: 'ctx-proof' });
    expect(lineKey(reg, '  contexts: CONTEXTS,', true)).toEqual({ kind: 'entry', key: 'contexts' });
    expect(lineKey(reg, imp('ctx-proof', 'CTX_PROOF'), false)).toEqual({ kind: 'import', key: 'ctx-proof.ts' });
    expect(lineKey(reg, '  contexts: CONTEXTS,', false)).toBeNull(); // an entry only inside its block
    expect(lineKey(SORTED_REGISTRIES['packages/dragon/src/css/animation-kinds.ts']!, '  ...BACKGROUND_LAYERS_ANIMATION,', true)).toEqual({ kind: 'entry', key: 'background-layers' });
    expect(lineKey(SORTED_REGISTRIES['packages/dragon/src/faults.ts']!, "import { SELD_R2_FAULTS } from './faults/seld-r2.ts';", false)).toEqual({ kind: 'import', key: 'seld-r2' });
  });

  it('leaves a modification on one side as a conflict, and resolves the other hunks', () => {
    const ours = add(['env', 'ENV']);
    const theirs = add(['ctx-proof', 'CTX_PROOF']).replace('  fonts: FONTS,', '  fonts: FONTS_V2,');
    const r = merge(BASE, ours, theirs);
    expect(r.conflicts).toBe(1);
    expect(r.resolved).toBe(1); // the imports
    expect(r.text).toMatch(/^<<<<<<< ours$/m);
    expect(r.text).toContain('  fonts: FONTS_V2,');
  });

  it('leaves a deletion on one side as a conflict', () => {
    const ours = add(['env', 'ENV']);
    const theirs = add(['ctx-proof', 'CTX_PROOF']).replace("  contexts: CONTEXTS,\n", '');
    const r = merge(BASE, ours, theirs);
    expect(r.conflicts).toBe(1);
    expect(r.text).toMatch(/^\|\|\|\|\|\|\| base$/m);
  });

  it('leaves one id added with two contents as a conflict', () => {
    const r = merge(BASE, add(['env', 'ENV'], ['dd', 'DD']), add(['env', 'ENV_OTHER'], ['ab', 'AB']));
    expect(r.conflicts).toBe(2); // env's import and its GROUPS line each differ
    expect(r.resolved).toBe(0);
    expect(r.text).toContain('  env: ENV_OTHER,');
  });

  it('leaves an added line that is not a registry line as a conflict', () => {
    const ours = add(['env', 'ENV']).replace('  env: ENV,', '  env: ENV,\n  // a comment');
    const r = merge(BASE, ours, add(['ctx-proof', 'CTX_PROOF']));
    expect(r.conflicts).toBe(1);
  });

  it('refuses a file that is not a sorted registry, and inputs it cannot read', () => {
    expect(() => merge(BASE, add(['env', 'ENV']), add(['ctx-proof', 'CTX_PROOF']), 'packages/parity/src/other.ts')).toThrow(Refuse);
    expect(() => merge(BASE, add(['env', 'ENV']).slice(0, -1), BASE)).toThrow(/newline/);
    expect(() => merge(BASE, `${BASE}=======\n`, BASE)).toThrow(/conflict marker/);
  });
});

describe('the sorted merge driver in git', () => {
  // Made in beforeAll: `vitest list` runs describe bodies but no hooks, so a folder made here would leak.
  let dir = '';
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (text: string): void => {
    mkdirSync(join(dir, dirname(FIX)), { recursive: true });
    writeFileSync(join(dir, FIX), text);
  };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sorted-merge-'));
    temps.push(dir);
    git('init', '-q', '-b', 'master');
    git('config', 'merge.dragon-sorted.driver', `node ${repoPath('scripts/sorted-merge.ts')} %O %A %B %P`);
    writeFileSync(join(dir, '.gitattributes'), `${FIX} merge=dragon-sorted\n`);
    write(BASE);
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'ctx');
    write(add(['ctx-proof', 'CTX_PROOF']));
    git('commit', '-qam', 'ctx');
    git('checkout', '-q', 'master');
    write(add(['env', 'ENV']));
    git('commit', '-qam', 'env');
  });

  it('merges two PRs that each add a group at the same sorted place, where a text merge conflicts', () => {
    git('merge', '-q', '--no-edit', 'ctx');
    expect(readFileSync(join(dir, FIX), 'utf8')).toBe(add(['env', 'ENV'], ['ctx-proof', 'CTX_PROOF']));
    git('reset', '-q', '--hard', 'HEAD~1');
    expect(() => git('-c', 'merge.dragon-sorted.driver=false', 'merge', '-q', '--no-edit', 'ctx')).toThrow(); // without the driver
    git('merge', '--abort');
  });

  it('leaves a conflict, with markers, on what it refuses', () => {
    git('checkout', '-q', '-b', 'mod', 'master~1');
    write(add(['ctx-proof', 'CTX_PROOF']).replace('  contexts: CONTEXTS,', '  contexts: CONTEXTS_V2,'));
    git('commit', '-qam', 'mod');
    git('checkout', '-q', 'master');
    expect(() => git('merge', '-q', '--no-edit', 'mod')).toThrow();
    expect(readFileSync(join(dir, FIX), 'utf8')).toMatch(/^<<<<<<< ours/m);
    git('merge', '--abort');
  });
});

describe('the sorted merge driver as git runs it', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sorted-merge-cli-'));
    temps.push(dir);
  });
  const run = (o: string, a: string, b: string, path = FIX): { status: number | null; ours: string; left: string[] } => {
    for (const [n, v] of [['O', o], ['A', a], ['B', b]] as const) writeFileSync(join(dir, n), v);
    const r = spawnSync(process.execPath, [repoPath('scripts/sorted-merge.ts'), join(dir, 'O'), join(dir, 'A'), join(dir, 'B'), path], { encoding: 'utf8' });
    return { status: r.status, ours: readFileSync(join(dir, 'A'), 'utf8'), left: readdirSync(dir).filter((f) => f.includes('sorted-merge')) };
  };

  it('replaces ours whole with the merge, leaving no temp file', () => {
    expect(run(BASE, add(['env', 'ENV']), add(['ctx-proof', 'CTX_PROOF']))).toEqual({ status: 0, ours: add(['env', 'ENV'], ['ctx-proof', 'CTX_PROOF']), left: [] });
  });

  it('on a refused hunk, writes the other hunks merged and the refused one with markers, and exits 1', () => {
    const r = run(BASE, add(['env', 'ENV']), add(['ctx-proof', 'CTX_PROOF']).replace("  contexts: CONTEXTS,\n", ''));
    expect(r.status).toBe(1);
    expect(r.left).toEqual([]);
    expect(r.ours).toMatch(/^<<<<<<< ours\n/m);
    expect(r.ours).toContain([imp('contexts', 'CONTEXTS'), imp('ctx-proof', 'CTX_PROOF'), imp('env', 'ENV')].join('\n'));
  });

  it('on a refused file, merges ours as it was with theirs as text, with markers, and exits 1', () => {
    const r = run(BASE, add(['env', 'ENV']), add(['ctx-proof', 'CTX_PROOF']), 'packages/parity/src/other.ts');
    expect(r.status).toBe(1);
    expect(r.left).toEqual([]);
    expect(r.ours).toMatch(/^<<<<<<< ours$/m);
  });
});

describe('the sorted merge driver is registered on exactly the sorted registries', () => {
  it('the landing driver and pnpm setup:git set it', () => {
    expect(MERGE_DRIVERS).toContainEqual(['merge.dragon-sorted.driver', SORTED_MERGE_DRIVER]);
  });

  it('marks exactly SORTED_REGISTRIES merge=dragon-sorted', () => {
    const marked = execFileSync('git', ['ls-files', '-z', ':(attr:merge=dragon-sorted)'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter((p) => p !== '');
    expect(marked).toEqual(Object.keys(SORTED_REGISTRIES).sort());
  });

  it('reads every registry in this tree: its block, and its imports and entries sorted by its key, one import per entry', () => {
    for (const [path, reg] of Object.entries(SORTED_REGISTRIES)) {
      const lines = readFileSync(repoPath(path), 'utf8').split('\n');
      const start = lines.findIndex((l) => reg.header.test(l));
      expect(start, path).toBeGreaterThan(0);
      const end = lines.findIndex((l, i) => i > start && l.startsWith('}'));
      const block = lines.slice(start + 1, end).map((l) => lineKey(reg, l, true));
      expect(block.every((k) => k !== null), `${path}: every line of the block is an entry`).toBe(true);
      const ids = block.map((k) => k!.key);
      expect(ids, path).toEqual([...new Set(ids)].sort());
      const imports = lines.slice(0, start).flatMap((l) => lineKey(reg, l, false)?.key ?? []);
      expect(imports, path).toEqual([...new Set(imports)].sort());
      expect(imports.length, `${path}: one import per entry`).toBe(ids.length);
      // A merge of the file with itself changes nothing.
      const text = lines.join('\n');
      expect(mergeSortedFile(path, text, text, text).text, path).toBe(text);
    }
  });
});
