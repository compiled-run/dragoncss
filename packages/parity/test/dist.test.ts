// S5 (d), (f4), (f5): the built packages outside the workspace. pnpm run build (TypeScript only, no bundler) emits dragon and
// @dragon/layout; the pinned Chrome loads them in a module Worker from Playwright routes; pnpm pack packs dragon into /tmp, where a
// plain Node consumer imports it through the default condition and a typed consumer checks its .d.ts.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Compiled, FrontEndResult } from 'dragon';
// createProject is the public entry's own (create-project.ts); the internal entry 'dragon' resolves to leaves it out.
import { createProject } from '../../dragon/src/index.ts';
import { launchChrome } from '../src/chrome.ts';
import { fixtureInput } from '../src/cases.ts';
import { PROJECT_ID } from '../src/fixture-reader.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';

const ORIGIN = 'https://dragon.test';
const CSS_TREE = realpathSync(repoPath('packages/dragon/node_modules/css-tree'));
const PUBLIC_EXPORTS = ['TREE_SCHEMA_REVISION', 'createProject', 'formatDiagnostic', 'formatDiagnostics', 'querySupport'];

/** The canonical compiled result compared across environments: every report field and the outputs. */
function canonical(c: Compiled<'ios' | 'web'>): string {
  return JSON.stringify({ ok: c.ok, revision: c.revision, digest: c.digest, sources: c.sources, dependencies: c.dependencies, diagnostics: c.diagnostics, targets: c.targets, outputs: c.outputs });
}
const nodeCompile = (input: FrontEndResult): string => canonical(createProject({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } }).compile(input));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
}

let packDir = '';
let tarball = '';
const scratch: string[] = [];

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

beforeAll(() => {
  execFileSync(process.execPath, [repoPath('scripts/build-dist.ts')], { stdio: 'pipe' });
  packDir = mkdtempSync(join(tmpdir(), 'dragon-s5-pack-'));
  scratch.push(packDir);
  execFileSync('pnpm', ['pack', '--pack-destination', packDir], { cwd: repoPath('packages/dragon'), stdio: 'pipe' });
  const tgz = readdirSync(packDir).filter((f) => f.endsWith('.tgz'));
  expect(tgz).toEqual(['dragon-1.0.0-alpha.0.tgz']);
  tarball = join(packDir, tgz[0] as string);
  execFileSync('tar', ['-xzf', tarball, '-C', packDir]);
}, 120_000);

describe('(d) browser Worker: the built dragon and @dragon/layout run in the pinned Chrome without Node', () => {
  let browser: Browser;
  let page: Page;
  const served = new Map<string, string>();
  const outside: string[] = [];

  // Bare specifiers resolve by package: @dragon/layout by its exports ('.' -> the built index), css-tree by its browser build
  // ./dist/csstree.esm (lib/ imports source-map-js, which is CommonJS). Any other bare specifier is an error.
  const BARE: ReadonlyMap<string, string> = new Map([['css-tree', '/css-tree/dist/csstree.esm.js'], ['@dragon/layout', '/layout/index.js']]);
  // Static import and export statements of the tsc output start a line; css-tree's dist bundle has none and is served as is.
  const STATIC = /^((?:import|export)\b[^\n]*?\bfrom\s*|import\s+)(["'])([^"']+)\2/gm;
  const rewrite = (url: string, js: string): string => (url.startsWith('/css-tree/') ? js : js.replace(STATIC, (m: string, lead: string, q: string, spec: string) => {
    if (spec.startsWith('.') || spec.startsWith('/')) return m;
    const to = BARE.get(spec);
    if (to === undefined) throw new Error(`${url} imports ${spec}, which has no browser resolution`);
    return `${lead}${q}${to}${q}`;
  }));
  const importsOf = (js: string): string[] => [...js.matchAll(STATIC)].map((m) => m[3] as string);
  const fileFor = (path: string): string | null => {
    if (path.startsWith('/dragon/')) return repoPath(`packages/dragon/build/${path.slice('/dragon/'.length)}`);
    if (path.startsWith('/layout/')) return repoPath(`packages/layout/build/${path.slice('/layout/'.length)}`);
    if (path.startsWith('/css-tree/')) return join(CSS_TREE, path.slice('/css-tree/'.length));
    return null;
  };
  const WORKER = `import * as dragon from '/dragon/index.js';
import * as layout from '/layout/index.js';
const canonical = (c) => JSON.stringify({ ok: c.ok, revision: c.revision, digest: c.digest, sources: c.sources, dependencies: c.dependencies, diagnostics: c.diagnostics, targets: c.targets, outputs: c.outputs });
self.onmessage = (e) => {
  const { id, kind, payload } = e.data;
  try {
    let result;
    if (kind === 'exports') result = Object.keys(dragon).sort();
    else if (kind === 'compile') result = payload.map((input) => canonical(dragon.createProject({ projectId: ${JSON.stringify(PROJECT_ID)}, targets: { ios: { minimum: '15.0' }, web: {} } }).compile(input)));
    else if (kind === 'vectors') {
      const m = layout.measurerFor(payload.platform);
      if (m.kind !== 'ok') throw new Error(m.detail);
      result = payload.vectors.map((v) => {
        const valid = layout.validateLayoutInput(v);
        if (!valid.ok) return 'invalid: ' + JSON.stringify(valid.errors);
        const r = layout.layout(valid.input, m.measurer);
        return r.kind === 'ok' ? JSON.stringify(r.boxes) : 'unsupported: ' + r.unsupported.code;
      });
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};`;

  beforeAll(async () => {
    browser = await launchChrome();
    const context = await browser.newContext();
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) {
        outside.push(url.href);
        return route.abort();
      }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html><head></head><body></body></html>' });
      if (url.pathname === '/worker.js') {
        served.set(url.pathname, WORKER);
        return route.fulfill({ contentType: 'text/javascript', body: WORKER });
      }
      const file = fileFor(url.pathname);
      if (file === null) {
        outside.push(url.href);
        return route.abort();
      }
      let body: string;
      try {
        body = rewrite(url.pathname, readFileSync(file, 'utf8'));
      } catch (e) {
        outside.push(`${url.href}: ${String(e)}`);
        return route.abort();
      }
      served.set(url.pathname, body);
      return route.fulfill({ contentType: 'text/javascript', body });
    });
    page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(() => {
      const w = new Worker('/worker.js', { type: 'module' });
      const pending = new Map<number, (v: unknown) => void>();
      let next = 0;
      w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => (pending.get(e.data.id) as (v: unknown) => void)(e.data);
      w.onerror = (e: ErrorEvent) => {
        for (const resolve of pending.values()) resolve({ error: `worker error: ${e.message}` });
      };
      (globalThis as unknown as { ask: (kind: string, payload: unknown) => Promise<unknown> }).ask = (kind, payload) => new Promise((resolve) => {
        const id = next++;
        pending.set(id, resolve);
        w.postMessage({ id, kind, payload });
      });
    });
  }, 120_000);

  afterAll(async () => {
    await browser.close();
  });

  const ask = async (kind: string, payload: unknown): Promise<unknown> => {
    const r = (await page.evaluate(([k, p]) => (globalThis as unknown as { ask: (kind: string, payload: unknown) => Promise<unknown> }).ask(k as string, p), [kind, payload] as const)) as { result?: unknown; error?: string };
    if (r.error !== undefined) throw new Error(r.error);
    return r.result;
  };

  it('loads the public dragon entry in a module Worker: exactly the public exports', async () => {
    expect(await ask('exports', null)).toEqual(PUBLIC_EXPORTS);
  });

  it('compiles every HTML and tree fixture input through the public createProject, equal to Node', async () => {
    const inputs = FIXTURES.map((f) => fixtureInput(f));
    const worker = (await ask('compile', inputs)) as string[];
    expect(worker.length).toBe(FIXTURES.length);
    FIXTURES.forEach((f, i) => expect(worker[i], f.id).toBe(nodeCompile(inputs[i] as FrontEndResult)));
  });

  it('the Worker layout engine reproduces every committed vector output byte for byte', async () => {
    const dir = repoPath('packages/layout/vectors');
    const vectors = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as { platform: string; input: unknown; output: unknown }) }));
    expect(vectors.length).toBeGreaterThan(250);
    expect([...new Set(vectors.map((v) => v.platform))]).toEqual(['darwin-arm64']);
    const out = (await ask('vectors', { platform: 'darwin-arm64', vectors: vectors.map((v) => v.input) })) as string[];
    vectors.forEach((v, i) => expect(out[i], v.file).toBe(JSON.stringify(v.output)));
  });

  it('serves no module with createRequire, "module" or "node:*" imports, and makes no request outside the served set', () => {
    expect(outside).toEqual([]);
    expect(served.size).toBeGreaterThan(10);
    expect([...served.keys()].filter((p) => p.startsWith('/css-tree/'))).toEqual(['/css-tree/dist/csstree.esm.js']);
    for (const [path, body] of served) {
      expect(body, path).not.toMatch(/createRequire/);
      expect(importsOf(body).filter((x) => x === 'module' || x.startsWith('node:')), path).toEqual([]);
      expect(body, path).not.toMatch(/\bimport\s*\(\s*["'](module|node:)/);
      expect(body, path).not.toMatch(/\brequire\s*\(\s*["'](module|node:)/);
    }
  });
});

describe('(f4) Node consumer and (f5) publish shape of the packed dragon tarball', () => {
  it('(f5) the packed package.json has publishConfig applied: no dragon-internal condition; no packed file mentions dragon-internal, and there is no internal.ts, source or test file', () => {
    const pkgDir = join(packDir, 'package');
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { exports: unknown; publishConfig?: unknown; dependencies: unknown };
    expect(manifest.exports).toEqual({ '.': { types: './build/index.d.ts', default: './build/index.js' } });
    expect(manifest.publishConfig).toBeUndefined();
    expect(manifest.dependencies).toEqual({ 'css-tree': '3.2.1' });
    const packed = files(pkgDir).map((f) => relative(pkgDir, f)).sort();
    expect(packed.length).toBeGreaterThan(40);
    expect(readFileSync(join(pkgDir, 'README.md'), 'utf8')).toBe(readFileSync(repoPath('README.md'), 'utf8'));
    expect(readFileSync(join(pkgDir, 'LICENSE'), 'utf8')).toBe(readFileSync(repoPath('LICENSE'), 'utf8'));
    expect(readFileSync(join(pkgDir, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toBe(readFileSync(repoPath('THIRD_PARTY_NOTICES.md'), 'utf8'));
    for (const f of packed) {
      expect(f, f).toMatch(/^(package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|build\/.+\.(js|d\.ts))$/);
      expect(f, f).not.toMatch(/internal|\.test\.|test\//);
      expect(readFileSync(join(pkgDir, f), 'utf8'), f).not.toMatch(/dragon-internal|internal\.ts/);
    }
  });

  it('(f4) plain node without --conditions imports "dragon" from a consumer in the temp folder: exactly the public exports; deep and internal paths fail; the compile equals the workspace compile', () => {
    const consumer = mkdtempSync(join(tmpdir(), 'dragon-s5-consumer-'));
    scratch.push(consumer);
    mkdirSync(join(consumer, 'node_modules'));
    cpSync(join(packDir, 'package'), join(consumer, 'node_modules', 'dragon'), { recursive: true });
    // css-tree 3.2.1 is linked from the pnpm store: no install, no network.
    symlinkSync(CSS_TREE, join(consumer, 'node_modules', 'css-tree'));
    writeFileSync(join(consumer, 'package.json'), '{ "type": "module" }\n');
    const input = fixtureInput(FIXTURES.find((f) => f.id === 'tree-slot-projection') as (typeof FIXTURES)[number]);
    writeFileSync(join(consumer, 'input.json'), JSON.stringify(input));
    writeFileSync(join(consumer, 'run.mjs'), `import { readFileSync } from 'node:fs';
const dragon = await import('dragon');
const deep = [];
for (const p of ['dragon/build/internal.js', 'dragon/build/project.js', 'dragon/src/internal.ts', 'dragon/package.json']) {
  try { await import(p); deep.push(p + ' loaded'); } catch (e) { deep.push(p + ' ' + e.code); }
}
const input = JSON.parse(readFileSync('./input.json', 'utf8'));
const c = dragon.createProject({ projectId: ${JSON.stringify(PROJECT_ID)}, targets: { ios: { minimum: '15.0' }, web: {} } }).compile(input);
const canonical = JSON.stringify({ ok: c.ok, revision: c.revision, digest: c.digest, sources: c.sources, dependencies: c.dependencies, diagnostics: c.diagnostics, targets: c.targets, outputs: c.outputs });
process.stdout.write(JSON.stringify({ exports: Object.keys(dragon).sort(), deep, canonical }));
`);
    const out = JSON.parse(execFileSync(process.execPath, ['run.mjs'], { cwd: consumer, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } })) as { exports: string[]; deep: string[]; canonical: string };
    expect(out.exports).toEqual(PUBLIC_EXPORTS);
    expect(out.deep).toEqual(['dragon/build/internal.js ERR_PACKAGE_PATH_NOT_EXPORTED', 'dragon/build/project.js ERR_PACKAGE_PATH_NOT_EXPORTED', 'dragon/src/internal.ts ERR_PACKAGE_PATH_NOT_EXPORTED', 'dragon/package.json ERR_PACKAGE_PATH_NOT_EXPORTED']);
    expect(out.canonical).toBe(nodeCompile(input));

    // tsc --noEmit over the packed .d.ts: a typed consumer with its @ts-expect-error cases.
    writeFileSync(join(consumer, 'consumer.ts'), `import { createProject, formatDiagnostic, formatDiagnostics, querySupport, TREE_SCHEMA_REVISION } from 'dragon';
import type { Compiled, FrontEndResult, NormalizedTarget, SupportAnswer } from 'dragon';
declare const input: FrontEndResult;
const web = createProject({ projectId: 'p', targets: { web: {} } }).compile(input);
export const out = web.outputs.web;
export const rev: string = TREE_SCHEMA_REVISION;
export const one: string = formatDiagnostic(web.diagnostics[0] as Compiled<'web'>['diagnostics'][number], web.sources);
export const all: string = formatDiagnostics(web.diagnostics, web.sources);
const target: NormalizedTarget = { kind: 'ios', minimum: '15.0' };
export const possible: SupportAnswer = querySupport({ kind: 'possibilities', target, css: 'gap: 7px' });
export const decided: SupportAnswer = querySupport({ kind: 'resolved', result: web, target: 'web', node: 'a', instance: 'doc', assignment: [], property: 'width' });
// @ts-expect-error ios is not configured: no outputs.ios
export const ios = web.outputs.ios;
// @ts-expect-error a web-only result rejects an ios resolved query (NoInfer)
export const wrong: SupportAnswer = querySupport({ kind: 'resolved', result: web, target: 'ios', node: 'a', instance: 'doc', assignment: [], property: 'width' });
// @ts-expect-error createProject takes the configuration only
export const opts = createProject({ projectId: 'p', targets: { web: {} } }, { direction: 'rtl' });
// @ts-expect-error internal helpers are not exported
export { createProjectWith } from 'dragon';
`);
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false, types: [] }, files: ['consumer.ts'] }));
    execFileSync(process.execPath, [repoPath('node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')], { stdio: 'pipe' });
  });
});
