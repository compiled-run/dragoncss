// pnpm regen [--check] [--force] [--from <step>] [--jobs <n>] [--explain]: regenerates every generated output from the sources
// and repeats the chain until a pass changes nothing (profile rows feed the captures, lanes.json feeds the profile rows).
// A step's cache key is the content of exactly what it reads (scripts/regen-inputs.ts): the import closure of its entry files,
// its declared data globs, the lockfile entries of the packages it imports, its command and its environment. Every step runs
// under scripts/regen-trace.ts, and a run that read a tree file or package outside that set fails, so the key cannot miss an
// input. The cache lives in the git common directory, shared by every worktree, one entry per (step, key): a step is skipped
// when an entry for its key recorded the outputs the tree has now, and its outputs are restored from the entry's git blobs when
// they differ and the recorded run wrote every output without reading any of them. Steps that neither read nor write each
// other's files run in parallel (--jobs, default 2). --check exits 1 naming every file the run changed (and leaves them
// regenerated); --force ignores entries recorded before this run; --from starts the first pass at that step; --explain prints
// what each step would do and why, and changes nothing.
// Device lanes are never run: lanes-host rewrites only the host rows of lanes.json and keeps device records that are still current.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { compilePattern, matchSegments } from './macroscope-ignore.ts';
import { importClosure, lockClosure, parseLock, type ReadText, scanSource, type Tree, type Workspace, workspaceOf } from './regen-inputs.ts';

export type { Tree } from './regen-inputs.ts';

export type Step = {
  readonly name: string;
  readonly argv: readonly string[];
  /** Every committed path the step writes (macroscope-ignore glob syntax); a change anywhere else fails the run. */
  readonly outputs: readonly string[];
  /** Tree files the step reads as data (fixtures, case lists, other steps' outputs), beyond the import closure of its code. */
  readonly reads?: readonly string[];
  /** Directories the step lists without reading every file below them: the names directly inside each are inputs. */
  readonly lists?: readonly string[];
  /** Modules the step imports by a computed path: their import closures are inputs too. */
  readonly imports?: readonly string[];
  /** Installed packages the step reads as files rather than importing them. */
  readonly packages?: readonly string[];
  /** Environment variables that are inputs of the step. */
  readonly env?: readonly string[];
  /** Whether a non-zero exit is a verdict the step recorded rather than a failure to regenerate. */
  readonly verdict?: (code: number, log: string) => boolean;
};

const pnpm = (...a: string[]): string[] => ['pnpm', '-s', 'run', ...a];
// parity:lanes exits 1 when a lane's state is fail (device-pixels on master); it prints this line only after writing lanes.json
// with no parity problem.
const LANES_AGREE = 'parity:lanes: lanes, case lists, tolerances, sample rules, dump faults and the projection agree on ios and android';

/**
 * lanes-host's exit 1 is a recorded verdict only when parity:lanes finished with no parity problem, every failing lane is a
 * device lane (carried from the device runner, not run here) and the host lanes it ran all pass.
 */
export function lanesVerdict(code: number, log: string): boolean {
  if (code !== 1 || !log.includes(`\n${LANES_AGREE}\n`)) return false;
  const lanes = [...log.matchAll(/^ {2}([a-z0-9-]+): ([a-z-]+)/gm)].map((m) => ({ lane: m[1]!, state: m[2]! }));
  const device = (lane: string): boolean => lane.startsWith('device-') || lane.endsWith('-device');
  return lanes.some((l) => l.state === 'fail') && lanes.some((l) => !device(l.lane)) && lanes.every((l) => (device(l.lane) ? true : l.state === 'pass'));
}

// reads, imports and packages come from a traced run of every step (scripts/regen-trace.ts); a run that reads anything else fails.
const FIXTURES = 'packages/parity/fixtures/**';
// TXT1a-1: the engine measures every face, Ahem included, through HarfBuzz over the vendored font files, so every step that lays
// text out reads them.
const FONTS = 'vendor/fonts/**';
// The translator reads the layout engine's sources as text and lowers them to Swift and Kotlin.
const ENGINE_SOURCES = ['packages/layout/src/**', 'packages/layout/package.json'];
export const STEPS: readonly Step[] = [
  { name: 'grammar', argv: pnpm('grammar:gen'), outputs: ['packages/dragon/src/css/grammar.generated.ts'] },
  { name: 'notices', argv: pnpm('notices:gen'), outputs: ['THIRD_PARTY_NOTICES.md'], reads: ['docs/ports.json', 'vendor/harfbuzz/COPYING'] },
  { name: 'ua', argv: pnpm('ua:capture'), outputs: ['packages/dragon/src/ua/*.generated.ts'], reads: [FONTS] },
  { name: 'capture', argv: pnpm('parity:capture'), outputs: ['packages/parity/expected/darwin-arm64/**', 'packages/parity/emitted/**', 'packages/parity/expected-fonts/**'], reads: [FIXTURES, FONTS] },
  // profile:rows judges every captured and generated output, and writes the native lanes verdict (P6a, T075J) from lanes.json.
  {
    name: 'profile-rows',
    argv: pnpm('profile:rows'),
    outputs: ['packages/dragon/src/profiles/ios.ts', 'packages/dragon/src/profiles/android.ts', 'packages/dragon/src/profiles/web.ts', 'packages/dragon/src/profiles/native-lanes.ts'],
    reads: [FIXTURES, FONTS, 'packages/parity/expected/**', 'packages/parity/expected-*/**', 'packages/parity/out/*.json', 'packages/layout/vectors/**', 'packages/layout/break-vectors/**', 'packages/layout/rt-vectors/**', 'packages/layout/generated/**', 'packages/translate/corpus.json', 'packages/translate/corpus-dpr.json'],
  },
  { name: 'dpr-capture', argv: pnpm('parity:dpr-capture'), outputs: ['packages/parity/expected-dpr/**'], reads: [FIXTURES, FONTS] },
  { name: 'hit-capture', argv: pnpm('parity:hit-capture'), outputs: ['packages/parity/expected-hit/*.hit.json'], reads: [FIXTURES, FONTS], lists: ['packages/parity/expected-hit'] },
  { name: 'vectors', argv: pnpm('layout:vectors'), outputs: ['packages/layout/vectors/*.json'], reads: [FIXTURES, FONTS, 'packages/parity/expected/**'], lists: ['packages/layout/vectors'] },
  { name: 'dpr-vectors', argv: pnpm('layout:dpr-vectors'), outputs: ['packages/layout/vectors/dpr-*/**'], reads: [FIXTURES, FONTS, 'packages/parity/expected-dpr/**'] },
  { name: 'hit-vectors', argv: pnpm('parity:hit-capture', '--vectors'), outputs: ['packages/layout/rt-vectors/hit/**'], reads: [FIXTURES, FONTS] },
  { name: 'break-vectors', argv: pnpm('layout:break-vectors'), outputs: ['packages/layout/break-vectors/**'], reads: [FIXTURES, FONTS] },
  { name: 'break-capture', argv: pnpm('parity:break-capture'), outputs: ['packages/parity/expected-breaks/**'], reads: [FIXTURES, FONTS, 'packages/layout/break-vectors/**'] },
  { name: 'pixel-capture', argv: pnpm('parity:pixel-capture'), outputs: ['packages/parity/expected-pixels/**'], reads: [FIXTURES, FONTS] },
  // T065: the frame captures (frozen-timeline Chrome) of the frame fixtures; profile:rows reads them (expected-*).
  { name: 'anim-capture', argv: pnpm('parity:anim-capture'), outputs: ['packages/parity/expected-frames/**'], reads: [FIXTURES, FONTS] },
  // EMS: each paint feature's vectors from its committed inputs.jsonl through the TypeScript harness (units mode).
  { name: 'paint-vectors', argv: pnpm('layout:paint-vectors'), outputs: ['packages/layout/paint-vectors/*/vectors.json'], reads: ['packages/layout/paint-vectors/**', ...ENGINE_SOURCES], imports: ['packages/translate/src/generate.ts', 'packages/translate/harness/harness.ts'] },
  { name: 'native-gen', argv: pnpm('native:gen'), outputs: ['packages/layout/generated/**', 'packages/translate/corpus.json', 'packages/translate/corpus-dpr.json'], reads: [...ENGINE_SOURCES, 'packages/layout/vectors/**', 'packages/layout/rt-vectors/**', 'packages/translate/corpus-m1-cases.json', 'packages/translate/package.json'] },
  { name: 'north-star', argv: pnpm('north-star:check'), outputs: ['examples/music-player/dragon/north-star-check.json'], reads: [FONTS, 'examples/music-player/snapshot.html', 'examples/music-player/styles.css', 'examples/music-player/tree/**'] },
  // wpt:update-expectations merges the run into expectations/web.json and copies the run's Chrome snapshots into snapshots/.
  { name: 'wpt', argv: ['sh', '-c', 'pnpm -s run wpt:run --target web && pnpm -s run wpt:update-expectations --target web'], outputs: ['packages/wpt/expectations/web.json', 'packages/wpt/snapshots/**'], env: ['DRAGON_WPT_DIR'], reads: ['packages/wpt/wpt.lock', 'packages/wpt/interop-labels.json'] },
  { name: 'tw-sweep', argv: pnpm('tw:sweep'), outputs: ['packages/tailwind-sweep/snapshot/**'], reads: [FONTS] },
  { name: 'glyph-b3', argv: pnpm('parity:glyph-b3', '--write-bottom-pins'), outputs: ['packages/parity/expected-glyphs/bottom-scanlines.json'], reads: [FIXTURES, FONTS] },
  { name: 'media-sweep', argv: ['node', '--conditions=dragon-internal', 'packages/parity/src/cli/media-sweep.ts'], outputs: ['packages/parity/expected-media/**'], reads: [FIXTURES, FONTS] },
  // lanes-host builds the generated engine with swiftc and kotlinc and runs the host lanes over every vector and capture.
  {
    name: 'lanes-host',
    argv: pnpm('parity:lanes', '--run-host'),
    outputs: ['packages/parity/out/lanes.json'],
    env: ['JAVA_HOME', 'ANDROID_HOME'],
    verdict: lanesVerdict,
    reads: [FIXTURES, FONTS, ...ENGINE_SOURCES, 'packages/parity/expected-*/**', 'packages/layout/vectors/**', 'packages/layout/break-vectors/**', 'packages/layout/rt-vectors/**', 'packages/layout/generated/**', 'packages/translate/corpus*.json', 'packages/translate/package.json', 'packages/translate/harness/**', 'packages/translate/src/**'],
    imports: ['packages/translate/src/native.ts', 'packages/translate/src/cli/native.ts'],
    packages: ['typescript'],
  },
];

/** Regen outputs a merge must not keep from one side: wpt fail entries carry a hand-written reason, deviation and issue. */
export const MERGE_BY_HAND: readonly { readonly path: string; readonly why: string }[] = [
  { path: 'packages/wpt/expectations/web.json', why: 'fail entries keep a hand-written reason, deviation and issue across runs' },
];

/** Tracked outputs under the generated shapes of .macroscope/ignore.md that regen does not rebuild, and what produces them. */
export const MANUAL: readonly { readonly command: string; readonly outputs: readonly string[] }[] = [
  { command: '/tmp/device-lease.sh pnpm run parity:devices (device lanes)', outputs: ['packages/parity/out/device-failures-*.json'] },
  { command: 'pnpm run north-star:capture', outputs: ['examples/*/chrome/**'] },
  // A paint package's vector inputs are written from the input list it pins (paint-dash.test.ts dashVectorInputs, PNT2's
  // paint-transform-cases.ts); its test fails when the committed file differs, and the paint-vectors step reads it.
  { command: 'DRAGON_WRITE_DASH_INPUTS=1 npx vitest run packages/layout/test/paint-dash.test.ts; node packages/layout/test/paint-transform-cases.ts > packages/layout/paint-vectors/transform/inputs.jsonl', outputs: ['packages/layout/paint-vectors/*/inputs.jsonl'] },
  { command: 'pnpm run rt:oracle', outputs: ['packages/layout/rt-oracle/**', 'packages/layout/rt-vectors/**'] },
  { command: 'node scripts/capture-interpolable.ts', outputs: ['packages/dragon/test/data/chrome-145-interpolable.json'] },
  { command: 'pnpm run parity:hit-capture -- --identity-base <rev> (the pointer-events identity manifest, once per base)', outputs: ['packages/parity/expected-hit/identity-base.json'] },
  { command: 'pnpm run parity:glyph-calibration', outputs: ['packages/parity/expected-glyphs/darwin-arm64/**'] },
  { command: 'node scripts/gen-script-data.ts', outputs: ['packages/layout/src/script-data.ts'] },
  { command: 'packages/layout/test/fixtures/linebreak/capture/*.mjs', outputs: ['packages/layout/test/fixtures/linebreak/*.json'] },
  { command: 'node scripts/gen-baseline-source-matrix.ts, node scripts/gen-granularity-fixtures.ts', outputs: ['packages/parity/generated/**'] },
  { command: 'node packages/parity/test/css-token-fuzz/generate.ts', outputs: ['packages/parity/test/css-token-fuzz/generated/**'] },
  { command: 'scripts/capture-grid-probe.ts, packages/parity/test/grid-fuzz/generate.ts', outputs: ['packages/dragon/test/data/grid-*.json'] },
  { command: 'scripts/capture-selector-validity.ts', outputs: ['packages/dragon/src/css/selector-validity.generated.ts'] },
  { command: 'scripts/capture-form-data.ts', outputs: ['packages/dragon/src/forms/*.generated.ts', 'packages/dragon/test/forms/chrome-145/**'] },
  { command: 'scripts/capture-font-data.ts, scripts/capture-font-reference.ts', outputs: ['packages/dragon/test/fonts/captures/**', 'packages/dragon/test/fonts/reference/**'] },
  { command: 'scripts/capture-image-data.ts', outputs: ['packages/dragon/test/images/chrome-145/**', 'packages/dragon/test/images/corpus/**'] },
  { command: 'scripts/capture-media-data.ts', outputs: ['packages/dragon/test/media/captures/**', 'packages/dragon/test/media/corpus.json'] },
  { command: 'packages/parity/src/cli/math-validity-capture.ts', outputs: ['packages/dragon/test/math-validity-oracle/**'] },
  { command: 'packages/text-shaper/scripts/replay.ts, replay-device.ts', outputs: ['packages/text-shaper/transcripts/**'] },
  { command: 'pnpm run wpt:run --target web --reftest-layout, then wpt:update-expectations', outputs: ['packages/wpt/reftest-captures/**', 'packages/wpt/expectations/web.reftest-layout.json'] },
  { command: 'none: frozen by hand (calc goldens, the M1 case list, vector format notes)', outputs: ['packages/layout/vectors/calc/**', 'packages/layout/vectors/README.md', 'packages/translate/corpus-m1-cases.json'] },
  { command: 'the research spikes\' own probes and notes', outputs: ['docs/research/**'] },
];

export const MAX_PASSES = 5;
export const DEFAULT_JOBS = 2;

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export const matcher = (globs: readonly string[]): ((path: string) => boolean) => {
  const compiled = globs.map(compilePattern);
  return (path) => compiled.some((c) => matchSegments(c, path.split('/')));
};

/** The literal leading segments of a glob, up to its first wildcard segment. */
const literalPrefix = (glob: string): string[] => {
  const segs = glob.includes('/') ? glob.split('/') : ['**'];
  const i = segs.findIndex((s) => /[*?]/.test(s));
  return i < 0 ? segs : segs.slice(0, i);
};

/** Whether two globs may match a common path: one's literal prefix is a prefix of the other's (conservative). */
export function globsMayOverlap(a: string, b: string): boolean {
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) if (pa[i] !== pb[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------- step inputs

/** What a step's key covers, read from the working tree. */
export type Context = {
  readonly tree: Tree;
  readonly read: ReadText;
  /** The root package.json's scripts. */
  readonly scripts: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** platform, arch, node version: the run's machine facts. */
  readonly machine: string;
};

/** The node entry files and script texts of a step's command: `pnpm -s run <script>`, `node [flags] <file>`, `sh -c '<a> && <b>'`. */
export function commandOf(argv: readonly string[], scripts: Readonly<Record<string, string>>): { entries: string[]; scripts: string[] } {
  const entries: string[] = [];
  const texts: string[] = [];
  const words = (s: string): string[] => s.trim().split(/\s+/);
  const visit = (a: readonly string[], depth: number): void => {
    if (depth > 4) throw new Error(`regen: command nests too deeply: ${a.join(' ')}`);
    if (a[0] === 'sh' && a[1] === '-c' && a.length === 3) {
      for (const part of a[2]!.split(/&&|;/)) visit(words(part), depth + 1);
      return;
    }
    if (a[0] === 'pnpm') {
      const i = a.indexOf('run');
      const name = a[i + 1];
      if (i < 0 || name === undefined || a.slice(1, i).some((f) => f !== '-s')) throw new Error(`regen: unsupported pnpm command ${a.join(' ')}`);
      const text = scripts[name];
      if (text === undefined) throw new Error(`regen: package.json has no script ${name}`);
      texts.push(`${name}=${text}`);
      visit(words(text), depth + 1);
      return;
    }
    if (a[0] === 'node') {
      const file = a.slice(1).find((w) => !w.startsWith('-'));
      if (file === undefined) throw new Error(`regen: node command without a file: ${a.join(' ')}`);
      entries.push(file);
      return;
    }
    throw new Error(`regen: a step command runs ${a[0]}, which regen cannot key; run it from a node script`);
  };
  visit(argv, 0);
  return { entries, scripts: texts };
}

export type Inputs = {
  /** The cache key. */
  readonly key: string;
  /** Tree files the key covers (own outputs included, though their content is left out of the key). */
  readonly files: ReadonlySet<string>;
  /** Package names whose installed files the step may read. */
  readonly packages: ReadonlySet<string>;
  /** path -> blob of the keyed files, to name what changed between two keys. */
  readonly blobs: Readonly<Record<string, string>>;
};

/** Memo of per-tree work shared by every step's inputs. */
export type Shared = { ws: Workspace; lock: ReturnType<typeof parseLock> | null; scans: Map<string, { specifiers: string[]; urls: string[] }> };

export function shared(ctx: Context, prev?: Shared): Shared {
  const lockBlob = ctx.tree.get('pnpm-lock.yaml');
  return { ws: workspaceOf(ctx.tree, ctx.read), lock: lockBlob === undefined ? null : parseLock(ctx.read('pnpm-lock.yaml')), scans: prev?.scans ?? new Map() };
}

export function stepInputs(step: Step, ctx: Context, sh: Shared): Inputs {
  const cmd = commandOf(step.argv, ctx.scripts);
  const scan = (p: string): { specifiers: string[]; urls: string[] } => {
    const k = ctx.tree.get(p)!;
    let hit = sh.scans.get(k);
    if (hit === undefined) {
      hit = scanSource(ctx.read(p));
      sh.scans.set(k, hit);
    }
    return hit;
  };
  const closure = importClosure([...cmd.entries, ...(step.imports ?? [])], ctx.tree, ctx.read, sh.ws, scan);
  if (closure.unresolved.length > 0) throw new Error(`regen: ${step.name}: imports that resolve to no tree file: ${closure.unresolved.join('; ')}`);
  const reads = matcher(step.reads ?? []);
  const files = new Set(closure.files);
  for (const p of ctx.tree.keys()) if (reads(p)) files.add(p);
  const externals = new Set(closure.externals);
  for (const name of step.packages ?? []) externals.add(`.\0${name}`);
  if (externals.size > 0 && sh.lock === null) throw new Error(`regen: ${step.name} imports packages but the tree has no pnpm-lock.yaml`);
  const lock = sh.lock === null ? { key: [], names: new Set<string>() } : lockClosure(sh.lock, externals);
  const own = matcher(step.outputs);
  const blobs: Record<string, string> = {};
  for (const p of [...files].sort()) if (!own(p)) blobs[p] = ctx.tree.get(p)!;
  const listings = (step.lists ?? []).map((d) => `${d}\0${listing(ctx.tree, d).join('\0')}`);
  const facts = JSON.stringify({ argv: step.argv, scripts: cmd.scripts, outputs: step.outputs, reads: step.reads ?? [], lists: listings, imports: step.imports ?? [], packages: step.packages ?? [], env: (step.env ?? []).map((k) => [k, ctx.env[k] ?? null]), machine: ctx.machine });
  const h = createHash('sha256').update(facts).update('\0');
  for (const [p, b] of Object.entries(blobs)) h.update(p).update('\0').update(b).update('\0');
  for (const l of lock.key) h.update(l).update('\0');
  return { key: h.digest('hex'), files, packages: lock.names, blobs };
}

/** The names directly inside a tree directory: its files and the directories that have files. */
export function listing(tree: Tree, dir: string): string[] {
  const names = new Set<string>();
  for (const p of tree.keys()) if (p.startsWith(`${dir}/`)) names.add(p.slice(dir.length + 1).split('/')[0]!);
  return [...names].sort();
}

/** The tree's files matching a step's outputs, path -> blob. */
export const outputsOf = (step: Step, tree: Tree): Record<string, string> => {
  const own = matcher(step.outputs);
  const out: Record<string, string> = {};
  for (const p of [...tree.keys()].sort()) if (own(p)) out[p] = tree.get(p)!;
  return out;
};

const sameMap = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
};

export const changedPaths = (a: Tree, b: Tree): string[] => [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p)).sort();

/** The paths whose blobs differ between two path -> blob maps. */
export const changedKeys = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): string[] => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]).sort();

// ---------------------------------------------------------------------------------------------------------------- trace check

/** The preload every step process loads; not an input of any step. */
export const TRACER = 'scripts/regen-trace.ts';

/**
 * Checks what a step's processes read (regen-trace.ts lines) against its inputs. Tree files read, listed directories' tree
 * contents and tree paths named on a child's command line must be keyed; installed package files must belong to a keyed
 * package. Returns the problems, and whether the step read any of its own outputs.
 */
export function checkTrace(step: Step, inputs: Inputs, tree: Tree, lines: readonly string[], roots: readonly string[]): { problems: string[]; readOwn: boolean } {
  const own = matcher(step.outputs);
  const problems = new Set<string>();
  let readOwn = false;
  const dirs = new Map<string, string[]>();
  const under = (d: string): string[] => {
    let hit = dirs.get(d);
    if (hit === undefined) {
      hit = d === '' ? [...tree.keys()] : [...tree.keys()].filter((p) => p.startsWith(`${d}/`));
      dirs.set(d, hit);
    }
    return hit;
  };
  const rel = (abs: string): string | null => {
    for (const r of roots) {
      if (abs === r) return '';
      if (abs.startsWith(r + sep)) return relative(r, abs).split(sep).join('/');
    }
    return null;
  };
  const keyed = (p: string): boolean => inputs.files.has(p) || own(p);
  const pkgOf = (p: string): string | null => {
    const i = p.lastIndexOf('node_modules/');
    if (i < 0) return null;
    const rest = p.slice(i + 'node_modules/'.length).split('/');
    if (rest[0] === undefined || rest[0] === '' || rest[0].startsWith('.')) return null;
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  };
  // pnpm, starting the script, reads the workspace manifests; the script texts are keyed instead.
  const PNPM_FILES = new Set(['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.npmrc']);
  let isPnpm = false;
  const file = (p: string, how: string): void => {
    if (!tree.has(p) || p === TRACER) return;
    if (own(p)) {
      if (how === 'read') readOwn = true;
      return;
    }
    if (isPnpm && (PNPM_FILES.has(p) || p.endsWith('/package.json'))) return;
    if (!inputs.files.has(p)) problems.add(`${how} ${p}`);
  };
  const dir = (p: string, how: string): void => {
    const inside = under(p);
    const missing = inside.filter((q) => !keyed(q));
    if (missing.length > 0) problems.add(`${how} ${p === '' ? '.' : p}/ (${missing.length} unkeyed files, such as ${missing.slice(0, 3).join(', ')})`);
  };
  const argvOf = (text: string | undefined): string[] | null => {
    try {
      const v: unknown = JSON.parse(text ?? '');
      return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null;
    } catch {
      return null;
    }
  };
  // Every Node process the step starts loads the tracer and names itself in an A line; one that did not was not traced.
  let headers = 0;
  let nodeChildren = 0;
  for (const line of lines) {
    if (line === '') continue;
    const [kind, abs, extra] = line.split('\t') as [string, string | undefined, string | undefined];
    if (!['A', 'R', 'D', 'P', 'G', 'X'].includes(kind) || abs === undefined || ((kind === 'A' || kind === 'X') && argvOf(extra) === null)) {
      problems.add(`unreadable trace line ${JSON.stringify(line.slice(0, 200))}`);
      continue;
    }
    if (kind === 'A') {
      // A process header: the argv of the process whose lines follow.
      const argv = argvOf(extra)!;
      // pnpm's own process (its bin, or its dist files for a worker thread).
      isPnpm = [argv[0], argv[1]].some((a) => /(^|\/)pnpm(\.c?js)?$|\/node_modules\/pnpm\/dist\//.test(a ?? ''));
      headers++;
      continue;
    }
    const r = rel(abs);
    if (r === null) continue;
    const pkg = pkgOf(r);
    if (r.startsWith('node_modules/') || r.includes('/node_modules/')) {
      if (pkg !== null && !inputs.packages.has(pkg) && kind === 'R' && !isPnpm) problems.add(`read installed package ${pkg} (${r})`);
      continue;
    }
    if (kind === 'R') file(r, 'read');
    else if (kind === 'D') {
      if (tree.has(r) || (step.lists ?? []).includes(r)) continue;
      if (under(r).every((q) => own(q))) continue;
      if (!isPnpm) dir(r, 'listed');
    } else if (kind === 'P') {
      // A probe of a tree file is a read of whether it exists; of a directory, a read of whether any file is inside.
      if (tree.has(r)) file(r, 'probed');
      else if (r !== '' && under(r).length > 0 && !under(r).some(keyed) && !isPnpm) problems.add(`probed ${r}/ (none of its files keyed)`);
    } else if (kind === 'G') {
      if (!isPnpm) dir(r, `globbed ${extra ?? ''} in`);
    } else if (kind === 'X') {
      const argv = argvOf(extra)!;
      const cmd = argv[0] ?? '';
      const isNode = /(^|\/)(node|pnpm|npx|sh)$/.test(cmd);
      if (/(^|\/)(node|pnpm|npx)$/.test(cmd)) nodeChildren++;
      if (!isNode && r !== '' && under(r).length > 0) dir(r, `ran ${cmd} in`);
      for (const w of argv.slice(1)) {
        if (isNode && !w.startsWith('/')) continue;
        const t = rel(resolve(abs, w));
        if (t === null || t === '' || t.startsWith('node_modules/')) continue;
        if (tree.has(t)) file(t, `passed to ${cmd}`);
        else if (under(t).length > 0 && !isNode) dir(t, `passed to ${cmd}`);
      }
    }
  }
  if (headers === 0 || headers < nodeChildren + (lines.some((l) => l.startsWith('A\t')) ? 1 : 0)) problems.add(`${headers} traced processes for ${nodeChildren} Node children: a process ran without scripts/regen-trace.ts`);
  return { problems: [...problems].sort(), readOwn };
}

// ---------------------------------------------------------------------------------------------------------------- the cache

/** A recorded run: the outputs it left, and whether they may be restored without running (it wrote all of them, read none). */
export type Entry = { readonly outputs: Readonly<Record<string, string>>; readonly restorable: boolean; readonly inputs: Readonly<Record<string, string>> };

export type Store = {
  readonly get: (step: string, key: string) => Entry | null;
  readonly put: (step: string, key: string, entry: Entry) => void;
  /** The most recently recorded entry of the step, to name what changed. */
  readonly latest: (step: string) => Entry | null;
};

/** An entry file that is not in the expected shape is no entry: the step runs. */
export function parseEntry(text: string): Entry | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const e = v as { version?: unknown; outputs?: unknown; restorable?: unknown; inputs?: unknown };
  const isMap = (m: unknown): m is Record<string, string> => typeof m === 'object' && m !== null && !Array.isArray(m) && Object.values(m).every((b) => typeof b === 'string' && /^[0-9a-f]{40,64}$/.test(b));
  if (e.version !== 2 || !isMap(e.outputs) || !isMap(e.inputs) || typeof e.restorable !== 'boolean') return null;
  return { outputs: e.outputs, restorable: e.restorable, inputs: e.inputs };
}

/** Entries as files <dir>/<step>/<key>.json, written atomically, so worktrees and parallel runs share them safely. */
export function fileStore(dir: string): Store {
  const path = (step: string, key: string): string => join(dir, step, `${key}.json`);
  return {
    get: (step, key) => (existsSync(path(step, key)) ? parseEntry(readFileSync(path(step, key), 'utf8')) : null),
    put: (step, key, entry) => {
      mkdirSync(join(dir, step), { recursive: true });
      const tmp = `${path(step, key)}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, `${JSON.stringify({ version: 2, ...entry })}\n`);
        renameSync(tmp, path(step, key));
      } finally {
        rmSync(tmp, { force: true });
      }
    },
    latest: (step) => {
      const d = join(dir, step);
      if (!existsSync(d)) return null;
      const files = readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => ({ f, t: statSync(join(d, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      return files.length === 0 ? null : parseEntry(readFileSync(join(d, files[0]!.f), 'utf8'));
    },
  };
}

/** Deletes entries older than maxAgeDays (their blobs may have been pruned by git gc by then). */
export function pruneStore(dir: string, maxAgeDays: number, now: number): number {
  let n = 0;
  if (!existsSync(dir)) return 0;
  for (const s of readdirSync(dir)) {
    const d = join(dir, s);
    if (!statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      // Another regen may rename or prune the same entry meanwhile.
      const st = statSync(p, { throwIfNoEntry: false });
      if (st !== undefined && now - st.mtimeMs > maxAgeDays * 86_400_000) {
        rmSync(p, { force: true });
        n++;
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------- the chain

export type RunResult = {
  readonly code: number;
  readonly log: string;
  /** The trace lines of every process the step started. */
  readonly trace: readonly string[];
  /** Of the given output paths, the ones written or created since the run started. */
  readonly touched: (paths: readonly string[]) => ReadonlySet<string>;
};

export type Io = {
  readonly snapshot: () => Tree;
  readonly context: (tree: Tree) => Context;
  readonly run: (step: Step) => Promise<RunResult>;
  /** Writes the given outputs (null deletes); false when a blob is missing. */
  readonly restore: (files: Readonly<Record<string, string | null>>) => boolean;
  readonly store: Store;
  readonly roots: readonly string[];
  readonly log: (line: string) => void;
  readonly now: () => number;
};

/** explain: decide every step of one pass (skip, restore or run, and why) and change nothing. */
export type Options = { readonly force: boolean; readonly check: boolean; readonly from: string | null; readonly jobs?: number; readonly explain?: boolean };
export type StepRecord = { readonly pass: number; readonly step: string; readonly action: 'skipped' | 'restored' | 'ran' | 'would restore' | 'would run'; readonly ms: number; readonly changed: number; readonly why: string };
export type Result = { readonly ok: boolean; readonly changed: readonly string[]; readonly ran: number; readonly passes: number; readonly error: string | null; readonly records: readonly StepRecord[] };

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** Whether two steps must not run at the same time: one writes what the other reads or writes. */
function conflict(a: Step, ai: Inputs, b: Step, bi: Inputs): boolean {
  const writes = (s: Step, other: Step, oi: Inputs): boolean => {
    const out = matcher(s.outputs);
    if ([...oi.files].some(out)) return true;
    return s.outputs.some((o) => [...(other.reads ?? []), ...other.outputs].some((g) => globsMayOverlap(o, g)));
  };
  return writes(a, b, bi) || writes(b, a, ai);
}

/** Names what changed between the latest recorded run of a step and now. */
const why = (store: Store, step: Step, inputs: Inputs, outputs: Record<string, string>, force: boolean): string => {
  if (force) return 'forced';
  const last = store.latest(step.name);
  if (last === null) return 'no recorded run';
  const ins = changedKeys(last.inputs, inputs.blobs);
  if (ins.length > 0) return `inputs changed: ${ins.slice(0, 3).join(', ')}${ins.length > 3 ? ` and ${ins.length - 3} more` : ''}`;
  const outs = changedKeys(last.outputs, outputs);
  if (outs.length > 0) return `outputs differ from the recorded run: ${outs.slice(0, 3).join(', ')}${outs.length > 3 ? ` and ${outs.length - 3} more` : ''}`;
  return 'command, environment or packages changed';
};

/** The chain to a fixed point: passes until one changes nothing, at most maxPasses. */
export async function regen(steps: readonly Step[], opts: Options, io: Io, maxPasses: number = MAX_PASSES): Promise<Result> {
  const records: StepRecord[] = [];
  const fail = (error: string, changed: string[] = [], ran = 0, passes = 0): Result => ({ ok: false, changed, ran, passes, error, records });
  for (const [i, s] of steps.entries()) if (steps.findIndex((x) => x.name === s.name) !== i) return fail(`step ${s.name} is named twice`);
  const first = opts.from === null ? 0 : steps.findIndex((s) => s.name === opts.from);
  if (first < 0) return fail(`unknown step ${opts.from}; the steps are ${steps.map((s) => s.name).join(', ')}`);
  const jobs = Math.max(1, opts.jobs ?? DEFAULT_JOBS);
  const start = io.snapshot();
  const t0 = io.now();
  // Entries recorded by this run: --force trusts only these.
  const session = new Map<string, Entry>();
  const lookup = (step: string, key: string): Entry | null => (opts.force ? (session.get(`${step}\0${key}`) ?? null) : io.store.get(step, key));
  let tree = start;
  let sh: Shared | null = null;
  let memoTree: Tree | null = null;
  let ctx: Context | null = null;
  const memo = new Map<string, Inputs>();
  const inputsOf = (s: Step, t: Tree): Inputs => {
    if (memoTree !== t) {
      ctx = io.context(t);
      sh = shared(ctx, sh ?? undefined);
      memoTree = t;
      memo.clear();
    }
    let hit = memo.get(s.name);
    if (hit === undefined) {
      hit = stepInputs(s, ctx!, sh!);
      memo.set(s.name, hit);
    }
    return hit;
  };
  let ran = 0;
  let lastChanged: string[] = [];
  for (let pass = 1; pass <= maxPasses; pass++) {
    const touched = new Set<string>();
    const tp = io.now();
    const pending = steps.slice(pass === 1 ? first : 0);
    const running = new Map<string, { step: Step; inputs: Inputs; promise: Promise<{ name: string; r: RunResult }>; ts: number; why: string }>();
    let error: string | null = null;
    const finish = (s: Step, before: Inputs, after: Tree, ts: number, action: 'ran' | 'restored', reason: string, r: RunResult | null): string | null => {
      const beside = [...running.values()].filter((x) => x.step !== s);
      const others = beside.map((x) => matcher(x.step.outputs));
      const own = matcher(s.outputs);
      const changed = changedPaths(tree, after).filter((p) => !others.some((m) => m(p)));
      const stray = changed.filter((p) => !own(p));
      const who = beside.length === 0 ? s.name : `${s.name} (or ${beside.map((x) => x.step.name).join(', ')}, running beside it)`;
      if (stray.length > 0) return `${who} changed files outside its declared outputs: ${stray.join(', ')}`;
      // Take this step's changes into the tree; a running step's partial outputs wait for its own finish.
      const next = new Map(tree);
      for (const p of changed) {
        const b = after.get(p);
        if (b === undefined) next.delete(p);
        else next.set(p, b);
      }
      tree = next;
      for (const p of changed) touched.add(p);
      const outputs = outputsOf(s, tree);
      if (r !== null) {
        const check = checkTrace(s, before, tree, r.trace, io.roots);
        if (check.problems.length > 0) return `${s.name} read files its cache key does not cover; add them to its reads (or packages) in scripts/regen.ts:\n  ${check.problems.slice(0, 40).join('\n  ')}`;
        const untouched = Object.keys(outputs).filter((p) => !r.touched([p]).has(p));
        const afterInputs = inputsOf(s, tree);
        if (afterInputs.key !== before.key) io.log(`${s.name}: its inputs changed while it ran; not recorded, it runs again next pass`);
        else {
          const entry: Entry = { outputs, restorable: !check.readOwn && untouched.length === 0, inputs: before.blobs };
          io.store.put(s.name, before.key, entry);
          session.set(`${s.name}\0${before.key}`, entry);
        }
      }
      const ms = io.now() - ts;
      records.push({ pass, step: s.name, action, ms, changed: changed.length, why: reason });
      io.log(`pass ${pass} ${s.name}: ${action} in ${secs(ms)}, ${changed.length} files changed (${reason})`);
      return null;
    };
    while ((pending.length > 0 && error === null) || running.size > 0) {
      // Start, in order, every pending step that no earlier pending or running step conflicts with.
      let started = true;
      while (started && error === null && running.size < jobs) {
        started = false;
        for (let i = 0; i < pending.length; i++) {
          const s = pending[i]!;
          let ins: Inputs;
          let blocked: boolean;
          try {
            ins = inputsOf(s, tree);
            const blockers = [...pending.slice(0, i).map((p) => ({ step: p, inputs: inputsOf(p, tree) })), ...[...running.values()]];
            blocked = blockers.some((b) => conflict(s, ins, b.step, b.inputs));
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            break;
          }
          if (blocked) continue;
          pending.splice(i, 1);
          const outputs = outputsOf(s, tree);
          const hit = lookup(s.name, ins.key);
          if (hit !== null && sameMap(hit.outputs, outputs)) {
            records.push({ pass, step: s.name, action: 'skipped', ms: 0, changed: 0, why: 'unchanged' });
            io.log(`pass ${pass} ${s.name}: unchanged, skipped`);
            started = true;
            break;
          }
          const reason = why(io.store, s, ins, outputs, opts.force && pass === 1);
          if (opts.explain === true) {
            const action = hit !== null && hit.restorable ? 'would restore' : 'would run';
            records.push({ pass, step: s.name, action, ms: 0, changed: 0, why: reason });
            io.log(`${s.name}: ${action} (${reason})`);
            started = true;
            break;
          }
          if (hit !== null && hit.restorable) {
            const ts = io.now();
            const files: Record<string, string | null> = { ...hit.outputs };
            for (const p of Object.keys(outputs)) if (!(p in hit.outputs)) files[p] = null;
            let restored: boolean;
            try {
              restored = io.restore(files);
            } catch (e) {
              error = `${s.name}: restoring its recorded outputs failed: ${e instanceof Error ? e.message : String(e)}`;
              break;
            }
            if (restored) {
              const after = io.snapshot();
              if (!sameMap(outputsOf(s, after), hit.outputs)) {
                error = `${s.name}: restoring its recorded outputs left different files`;
                break;
              }
              error = finish(s, ins, after, ts, 'restored', reason, null);
              started = true;
              break;
            }
            io.log(`${s.name}: a recorded output blob is missing; running it`);
          }
          ran++;
          const ts = io.now();
          io.log(`pass ${pass} ${s.name}: running (${reason})`);
          running.set(s.name, { step: s, inputs: ins, ts, why: reason, promise: io.run(s).then((r) => ({ name: s.name, r })) });
          started = true;
          break;
        }
      }
      if (running.size === 0) {
        if (pending.length > 0 && error === null) error = `no step can start: ${pending.map((s) => s.name).join(', ')}`;
        break;
      }
      const { name, r } = await Promise.race([...running.values()].map((x) => x.promise));
      const job = running.get(name)!;
      const after = io.snapshot();
      if (r.code !== 0 && !(job.step.verdict?.(r.code, r.log) ?? false)) {
        running.delete(name);
        // Its partial outputs stay on disk; take them into the tree so the steps still running are not blamed for them.
        const own = matcher(job.step.outputs);
        const next = new Map(tree);
        for (const p of changedPaths(tree, after).filter(own)) {
          const b = after.get(p);
          if (b === undefined) next.delete(p);
          else next.set(p, b);
        }
        tree = next;
        const last = r.log.split('\n').slice(-40).join('\n');
        error ??= `${name} exited ${r.code}; the last lines of its output:\n${last}`;
        continue;
      }
      if (r.code !== 0) io.log(`${name} exited ${r.code}: a verdict it recorded, not a regeneration failure`);
      const e = finish(job.step, job.inputs, after, job.ts, 'ran', job.why, r);
      running.delete(name);
      error ??= e;
    }
    if (error !== null) return fail(error, changedPaths(start, io.snapshot()), ran, pass);
    if (opts.explain === true) return { ok: true, changed: [], ran: 0, passes: 1, error: null, records };
    // A pass changes nothing only when no step in it changed a file, even if a later step changed it back.
    const passChanged = [...touched].sort();
    lastChanged = passChanged;
    io.log(`pass ${pass}: ${secs(io.now() - tp)}, ${passChanged.length} files changed`);
    if (passChanged.length === 0 && (pass > 1 || first === 0)) {
      const changed = changedPaths(start, tree);
      const restored = records.filter((x) => x.action === 'restored').length;
      io.log(`fixed point after ${pass} passes, ${ran} steps run, ${restored} restored, ${secs(io.now() - t0)}${ran + restored === 0 ? ': nothing to do' : ''}`);
      return { ok: true, changed, ran, passes: pass, error: null, records };
    }
  }
  return fail(`no fixed point after ${maxPasses} passes; the last pass changed ${lastChanged.join(', ')}`, changedPaths(start, tree), ran, maxPasses);
}

// ---------------------------------------------------------------------------------------------------------------- the real io

const git = (args: readonly string[], env?: NodeJS.ProcessEnv): string => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: env ?? process.env });

/** The working tree as git would commit it with `git add -A`, read through a copy of the index so the real index is untouched. */
export function snapshotTree(root: string): Tree {
  const dir = mkdtempSync(join(tmpdir(), 'dragon-regen-'));
  try {
    const index = join(dir, 'index');
    const real = resolve(root, git(['-C', root, 'rev-parse', '--git-path', 'index']).trim());
    if (existsSync(real)) copyFileSync(real, index);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    git(['-C', root, 'add', '-A'], env);
    const tree = new Map<string, string>();
    for (const rec of git(['-C', root, 'ls-files', '-s', '-z'], env).split('\0')) {
      if (rec === '') continue;
      const m = /^\d+ ([0-9a-f]+) (\d)\t(.+)$/s.exec(rec);
      if (m === null) throw new Error(`regen: unexpected git ls-files record ${JSON.stringify(rec)}`);
      tree.set(m[3]!, m[1]!);
    }
    return tree;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Reads every trace file under dir, each process's lines after an "A" header naming its argv. */
function readTrace(dir: string): string[] {
  const lines: string[] = [];
  for (const f of readdirSync(dir)) lines.push(...readFileSync(join(dir, f), 'utf8').split('\n'));
  return lines;
}

/** Writes blobs from the object database to the tree (null deletes); false, writing nothing, when a blob is missing. */
export function restoreBlobs(root: string, files: Readonly<Record<string, string | null>>): boolean {
  const shas = [...new Set(Object.values(files).filter((b): b is string => b !== null))];
  const contents = new Map<string, Buffer>();
  if (shas.length > 0) {
    const r = spawnSync('git', ['-C', root, 'cat-file', '--batch'], { input: `${shas.join('\n')}\n`, maxBuffer: 4 * 1024 * 1024 * 1024 });
    if (r.status !== 0) return false;
    const out = r.stdout;
    let at = 0;
    for (const sha of shas) {
      const nl = out.indexOf(10, at);
      const header = out.subarray(at, nl).toString('utf8');
      const m = /^([0-9a-f]+) blob (\d+)$/.exec(header);
      if (m === null || m[1] !== sha) return false;
      const size = Number(m[2]);
      contents.set(sha, out.subarray(nl + 1, nl + 1 + size));
      at = nl + 1 + size + 1;
    }
  }
  for (const [p, b] of Object.entries(files)) {
    const abs = join(root, p);
    if (b === null) {
      if (existsSync(abs)) unlinkSync(abs);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents.get(b)!);
  }
  return true;
}

/** The Io of a working tree: steps run as processes under the tracer, the cache in storeDir, step output in logDir. */
export function localIo(root: string, storeDir: string, logDir: string): Io {
  const roots = [...new Set([root, realpathSync(root)])];
  const tracer = join(root, TRACER);
  const machine = JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version });
  const texts = new Map<string, string>();
  return {
    snapshot: () => snapshotTree(root),
    context: (tree) => {
      const read = (p: string): string => {
        const b = tree.get(p);
        if (b === undefined) throw new Error(`regen: ${p} is not in the tree`);
        let t = texts.get(b);
        if (t === undefined) {
          t = readFileSync(join(root, p), 'utf8');
          texts.set(b, t);
        }
        return t;
      };
      const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
      return { tree, read, scripts: pkg.scripts ?? {}, env: process.env, machine };
    },
    run: (step) =>
      new Promise((done) => {
        const logFile = join(logDir, `${step.name}.log`);
        const traceDir = mkdtempSync(join(tmpdir(), `dragon-regen-trace-${step.name}-`));
        console.log(`regen: ${step.name}: ${step.argv.join(' ')} (output in ${logFile})`);
        const out = createWriteStream(logFile);
        const started = Date.now();
        let settled = false;
        const finish = (code: number, note: string): void => {
          if (settled) return;
          settled = true;
          out.end(note, () => {
            let trace: string[];
            try {
              trace = readTrace(traceDir);
            } catch (e) {
              trace = [`unreadable trace directory: ${e instanceof Error ? e.message : String(e)}`];
            }
            rmSync(traceDir, { recursive: true, force: true });
            const touched = (paths: readonly string[]): Set<string> => new Set(paths.filter((p) => existsSync(join(root, p)) && statSync(join(root, p)).mtimeMs >= started - 1));
            done({ code, log: readFileSync(logFile, 'utf8'), trace, touched });
          });
        };
        const env = { ...process.env, DRAGON_REGEN_TRACE: traceDir, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${JSON.stringify(tracer)}`.trim() };
        const child = spawn(step.argv[0]!, step.argv.slice(1), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
        child.stdout.pipe(out, { end: false });
        child.stderr.pipe(out, { end: false });
        child.on('error', (e) => finish(127, `regen: could not start ${step.argv[0]}: ${e.message}\n`));
        child.on('close', (code, signal) => finish(code ?? 1, signal === null ? '' : `regen: killed by ${signal}\n`));
      }),
    restore: (files) => restoreBlobs(root, files),
    store: fileStore(storeDir),
    roots,
    log: (line) => console.log(`regen: ${line}`),
    now: () => Date.now(),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opts: { force: boolean; check: boolean; from: string | null; jobs: number; explain: boolean } = { force: false, check: false, from: null, jobs: Number(process.env.DRAGON_REGEN_JOBS ?? DEFAULT_JOBS), explain: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force') opts.force = true;
    else if (a === '--check') opts.check = true;
    else if (a === '--explain') opts.explain = true;
    else if (a === '--from' && i + 1 < args.length && !args[i + 1]!.startsWith('--')) opts.from = args[++i]!;
    else if (a === '--jobs' && i + 1 < args.length && /^[1-9]\d*$/.test(args[i + 1]!)) opts.jobs = Number(args[++i]!);
    else {
      console.error(`regen: unknown argument ${JSON.stringify(a)}; usage: pnpm regen [--check] [--force] [--from <step>] [--jobs <n>] [--explain]`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(opts.jobs) || opts.jobs < 1) {
    console.error(`regen: DRAGON_REGEN_JOBS must be a positive integer, not ${JSON.stringify(process.env.DRAGON_REGEN_JOBS)}`);
    process.exit(2);
  }
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const logDir = join(root, 'node_modules/.cache/dragon-regen');
  mkdirSync(logDir, { recursive: true });
  const storeDir = join(resolve(root, git(['-C', root, 'rev-parse', '--git-common-dir']).trim()), 'dragon-regen', 'v2');
  mkdirSync(storeDir, { recursive: true });
  const pruned = pruneStore(storeDir, 30, Date.now());
  if (pruned > 0) console.log(`regen: pruned ${pruned} cache entries older than 30 days`);
  let driver = '';
  try {
    driver = git(['-C', root, 'config', '--get', 'merge.dragon-generated.driver']).trim();
  } catch {
    // Unset: git config exits 1.
  }
  if (driver !== 'true') console.log('regen: run pnpm setup:git once so merges keep generated files instead of stopping on them');
  const io = localIo(root, storeDir, logDir);
  const r = await regen(STEPS, opts, io);
  writeFileSync(join(logDir, 'last-run.json'), `${JSON.stringify(r.records, null, 1)}\n`);
  if (r.error !== null) console.error(`regen: FAILED: ${r.error}`);
  if (opts.check && r.changed.length > 0) console.error(`regen --check: ${r.changed.length} files were stale:\n${r.changed.join('\n')}`);
  process.exitCode = r.ok && !(opts.check && r.changed.length > 0) ? 0 : 1;
}

if (import.meta.main) await main();
