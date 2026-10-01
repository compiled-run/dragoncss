// T124: every package.json script that runs a repo .ts file with node, and whose static import graph reaches the `dragon` package,
// passes --conditions=dragon-internal; without it `dragon` resolves to src/index.ts and internal-only imports fail at load time.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';

const CONDITION = '--conditions=dragon-internal';

interface Workspace { name: string; dir: string; entry: string | null }

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${path}: not a JSON object`);
  return parsed as Record<string, unknown>;
}

const WORKSPACES: Workspace[] = readdirSync(repoPath('packages'))
  .filter((d) => existsSync(repoPath(`packages/${d}/package.json`)))
  .map((d) => {
    const dir = repoPath(`packages/${d}`);
    const pkg = readJson(join(dir, 'package.json'));
    if (typeof pkg.name !== 'string') throw new Error(`packages/${d}/package.json: no name`);
    const dot = (pkg.exports as Record<string, unknown> | undefined)?.['.'];
    const target = typeof dot === 'string' ? dot : typeof dot === 'object' && dot !== null ? (dot as Record<string, unknown>).default : undefined;
    if (dot !== undefined && typeof target !== 'string') throw new Error(`packages/${d}/package.json: exports "." has no string default`);
    return { name: pkg.name, dir, entry: typeof target === 'string' ? resolve(dir, target) : null };
  });
const BY_NAME = new Map(WORKSPACES.map((w) => [w.name, w]));

/** Whether the static import graph from `entry` (relative files and workspace packages, followed) imports the `dragon` package. */
function reachesDragon(entry: string): { reaches: boolean; files: number } {
  const seen = new Set<string>();
  const queue = [entry];
  let reaches = false;
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const specs = ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles.map((f) => f.fileName);
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (!existsSync(target)) throw new Error(`${relative(repoPath(''), file)}: import ${spec} does not resolve to a file`);
        if (/\.[cm]?[jt]s$/.test(target)) queue.push(target);
        continue;
      }
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
      if (name === 'dragon') { reaches = true; continue; }
      const ws = BY_NAME.get(name);
      if (ws === undefined) continue;
      if (spec !== name || ws.entry === null) throw new Error(`${relative(repoPath(''), file)}: import ${spec} is not the "." export of a workspace package`);
      queue.push(ws.entry);
    }
  }
  return { reaches, files: seen.size };
}

interface NodeRun { pkg: string; script: string; flags: string[]; entry: string }

/** Every `node [flags] <file>.ts` command in every workspace package.json script (commands split on && ; ||). */
function nodeRuns(): NodeRun[] {
  const runs: NodeRun[] = [];
  for (const dir of [repoPath(''), ...WORKSPACES.map((w) => w.dir)]) {
    const scripts = readJson(join(dir, 'package.json')).scripts ?? {};
    if (typeof scripts !== 'object' || scripts === null) throw new Error(`${dir}/package.json: scripts is not an object`);
    for (const [script, command] of Object.entries(scripts)) {
      if (typeof command !== 'string') throw new Error(`${dir}/package.json: script ${script} is not a string`);
      for (const part of command.split(/&&|\|\||;/)) {
        const words = part.trim().split(/\s+/);
        if (words[0] !== 'node') continue;
        const at = words.findIndex((w, i) => i > 0 && !w.startsWith('-'));
        if (at < 0 || !words[at]!.endsWith('.ts')) continue;
        const entry = resolve(dir, words[at]!);
        if (!existsSync(entry)) throw new Error(`${dir}/package.json: script ${script} runs ${words[at]}, which does not exist`);
        runs.push({ pkg: relative(repoPath(''), join(dir, 'package.json')), script, flags: words.slice(1, at), entry });
      }
    }
  }
  return runs;
}

describe('package.json scripts that run repo .ts files', () => {
  const runs = nodeRuns();

  it('finds the node scripts, including north-star:check, and the walk sees check.ts reach dragon', () => {
    const northStar = runs.find((r) => r.pkg === 'package.json' && r.script === 'north-star:check');
    expect(northStar, 'north-star:check').toBeDefined();
    const walk = reachesDragon(northStar!.entry);
    expect(walk.reaches).toBe(true);
    expect(walk.files).toBeGreaterThan(1);
  });

  it(`every script whose import graph reaches dragon passes ${CONDITION}`, () => {
    const missing = runs.filter((r) => !r.flags.includes(CONDITION) && reachesDragon(r.entry).reaches).map((r) => `${r.pkg} ${r.script}`);
    expect(missing).toEqual([]);
  });
});
