// pnpm regen [--check] [--force] [--from <step>]: regenerates every generated output from the sources, in the order below, and
// repeats the chain until a pass changes nothing (profile rows feed the captures, lanes.json feeds the profile rows). A step is
// skipped while its input digest and its outputs' digest equal those of its last successful run (node_modules/.cache/dragon-regen).
// --check exits 1 naming every file the run changed (and leaves them regenerated); --force ignores the cache for the first pass;
// --from starts the first pass at that step. A failed step leaves its partial outputs and loses its cache entry, so it reruns.
// Device lanes are never run: lanes-host rewrites only the host rows of lanes.json and keeps device records that are still current.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compilePattern, matchSegments } from './macroscope-ignore.ts';

export type Step = {
  readonly name: string;
  readonly argv: readonly string[];
  /** Every committed path the step writes (macroscope-ignore glob syntax); a change anywhere else fails the run. */
  readonly outputs: readonly string[];
  /**
   * The later steps whose outputs this step reads. Sources and earlier steps' outputs are always inputs; a later step's outputs
   * are inputs only when named here (from a traced run: fs reads and module loads), so its changes rerun this step next pass.
   */
  readonly readsLater?: readonly string[];
  /** Environment variables that are inputs of the step. */
  readonly env?: readonly string[];
  /** Whether a non-zero exit is a verdict the step recorded rather than a failure to regenerate. */
  readonly verdict?: (code: number, log: string) => boolean;
};

const node = (...a: string[]): string[] => ['node', '--conditions=dragon-internal', ...a];
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

export const STEPS: readonly Step[] = [
  { name: 'grammar', argv: pnpm('grammar:gen'), outputs: ['packages/dragon/src/css/grammar.generated.ts'] },
  { name: 'notices', argv: pnpm('notices:gen'), outputs: ['THIRD_PARTY_NOTICES.md'] },
  { name: 'ua', argv: pnpm('ua:capture'), outputs: ['packages/dragon/src/ua/*.generated.ts'], readsLater: ['profile-rows'] },
  { name: 'capture', argv: pnpm('parity:capture'), outputs: ['packages/parity/expected/darwin-arm64/**', 'packages/parity/emitted/**', 'packages/parity/expected-fonts/**'], readsLater: ['profile-rows'] },
  { name: 'profile-rows', argv: pnpm('profile:rows'), outputs: ['packages/dragon/src/profiles/ios.ts', 'packages/dragon/src/profiles/android.ts', 'packages/dragon/src/profiles/web.ts'] },
  { name: 'dpr-capture', argv: pnpm('parity:dpr-capture'), outputs: ['packages/parity/expected-dpr/**'] },
  { name: 'vectors', argv: pnpm('layout:vectors'), outputs: ['packages/layout/vectors/*.json'] },
  { name: 'dpr-vectors', argv: pnpm('layout:dpr-vectors'), outputs: ['packages/layout/vectors/dpr-*/**'] },
  { name: 'break-vectors', argv: pnpm('layout:break-vectors'), outputs: ['packages/layout/break-vectors/**'] },
  { name: 'break-capture', argv: pnpm('parity:break-capture'), outputs: ['packages/parity/expected-breaks/**'] },
  { name: 'pixel-capture', argv: pnpm('parity:pixel-capture'), outputs: ['packages/parity/expected-pixels/**'] },
  { name: 'native-gen', argv: pnpm('native:gen'), outputs: ['packages/layout/generated/**', 'packages/translate/corpus.json', 'packages/translate/corpus-dpr.json'] },
  { name: 'north-star', argv: pnpm('north-star:check'), outputs: ['examples/music-player/dragon/north-star-check.json'] },
  // wpt:update-expectations merges the run into expectations/web.json and copies the run's Chrome snapshots into snapshots/.
  { name: 'wpt', argv: ['sh', '-c', 'pnpm -s run wpt:run --target web && pnpm -s run wpt:update-expectations --target web'], outputs: ['packages/wpt/expectations/web.json', 'packages/wpt/snapshots/**'], env: ['DRAGON_WPT_DIR'] },
  { name: 'tw-sweep', argv: pnpm('tw:sweep'), outputs: ['packages/tailwind-sweep/snapshot/**'] },
  { name: 'glyph-b3', argv: pnpm('parity:glyph-b3', '--write-bottom-pins'), outputs: ['packages/parity/expected-glyphs/bottom-scanlines.json'] },
  { name: 'media-sweep', argv: node('packages/parity/src/cli/media-sweep.ts'), outputs: ['packages/parity/expected-media/**'] },
  { name: 'lanes-host', argv: pnpm('parity:lanes', '--run-host'), outputs: ['packages/parity/out/lanes.json'], env: ['JAVA_HOME', 'ANDROID_HOME'], verdict: lanesVerdict },
];

/** Regen outputs a merge must not keep from one side: wpt fail entries carry a hand-written reason, deviation and issue. */
export const MERGE_BY_HAND: readonly { readonly path: string; readonly why: string }[] = [
  { path: 'packages/wpt/expectations/web.json', why: 'fail entries keep a hand-written reason, deviation and issue across runs' },
];

/** Tracked outputs under the generated shapes of .macroscope/ignore.md that regen does not rebuild, and what produces them. */
export const MANUAL: readonly { readonly command: string; readonly outputs: readonly string[] }[] = [
  { command: '/tmp/device-lease.sh pnpm run parity:devices (device lanes)', outputs: ['packages/parity/out/device-failures-*.json'] },
  { command: 'pnpm run north-star:capture', outputs: ['examples/*/chrome/**'] },
  { command: 'pnpm run rt:oracle', outputs: ['packages/layout/rt-oracle/**', 'packages/layout/rt-vectors/**'] },
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

/** Paths no step reads (a traced run of every step: fs reads and module loads), so a docs, board or test change reruns nothing. */
export const NOT_READ: readonly string[] = ['docs/goals/**', 'docs/research/**', 'design/**', '.github/**', '.macroscope/**', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'packages/*/test/**', 'scripts/regen.ts'];

export const MAX_PASSES = 5;

/** path -> git blob sha of every tracked or untracked, not ignored file in the working tree. */
export type Tree = ReadonlyMap<string, string>;

const matcher = (globs: readonly string[]): ((path: string) => boolean) => {
  const compiled = globs.map(compilePattern);
  return (path) => compiled.some((c) => matchSegments(c, path.split('/')));
};

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const entriesDigest = (tree: Tree, keep: (path: string) => boolean): string => {
  const h = createHash('sha256');
  for (const p of [...tree.keys()].sort()) if (keep(p)) h.update(p).update('\0').update(tree.get(p)!).update('\0');
  return h.digest('hex');
};

/** The digests that decide whether a step reruns: its inputs (all but its outputs and unread later outputs) and its outputs. */
export function stepDigests(steps: readonly Step[], step: Step, tree: Tree, env: Readonly<Record<string, string | undefined>>): { inputs: string; outputs: string } {
  const own = matcher(step.outputs);
  const later = steps.slice(steps.indexOf(step) + 1).filter((s) => !(step.readsLater ?? []).includes(s.name));
  const ignored = matcher([...NOT_READ, ...later.flatMap((s) => s.outputs)]);
  const facts = JSON.stringify({ argv: step.argv, env: (step.env ?? []).map((k) => [k, env[k] ?? null]), platform: process.platform, arch: process.arch, node: process.version });
  return { inputs: sha256(`${facts}\0${entriesDigest(tree, (p) => !own(p) && !ignored(p))}`), outputs: entriesDigest(tree, own) };
}

export const changedPaths = (a: Tree, b: Tree): string[] => [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p)).sort();

export type Cache = Record<string, { inputs: string; outputs: string }>;

/** A cache file that is missing or not in the expected shape is an empty cache: every step runs. */
export function parseCache(text: string | null): { cache: Cache; problem: string | null } {
  if (text === null) return { cache: {}, problem: null };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { cache: {}, problem: 'not JSON' };
  }
  const steps = typeof v === 'object' && v !== null && (v as { version?: unknown }).version === 1 ? (v as { steps?: unknown }).steps : undefined;
  if (typeof steps !== 'object' || steps === null) return { cache: {}, problem: 'not a version 1 cache' };
  const cache: Cache = {};
  for (const [k, e] of Object.entries(steps)) {
    const { inputs, outputs } = (e ?? {}) as { inputs?: unknown; outputs?: unknown };
    if (typeof inputs !== 'string' || typeof outputs !== 'string') return { cache: {}, problem: `step ${k} has no digests` };
    cache[k] = { inputs, outputs };
  }
  return { cache, problem: null };
}

export type Io = {
  readonly snapshot: () => Tree;
  /** Runs a step; resolves with its exit code and its output. */
  readonly run: (step: Step) => Promise<{ readonly code: number; readonly log: string }>;
  readonly saveCache: (cache: Cache) => void;
  readonly log: (line: string) => void;
  readonly now: () => number;
  readonly env: Readonly<Record<string, string | undefined>>;
};

export type Options = { readonly force: boolean; readonly check: boolean; readonly from: string | null };
export type Result = { readonly ok: boolean; readonly changed: readonly string[]; readonly ran: number; readonly passes: number; readonly error: string | null };

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** The chain to a fixed point: passes until one changes nothing, at most MAX_PASSES. */
export async function regen(steps: readonly Step[], cache: Cache, opts: Options, io: Io, maxPasses: number = MAX_PASSES): Promise<Result> {
  const start = io.snapshot();
  const t0 = io.now();
  for (const [i, s] of steps.entries()) {
    const bad = (s.readsLater ?? []).filter((n) => !steps.slice(i + 1).some((l) => l.name === n));
    if (bad.length > 0 || steps.findIndex((x) => x.name === s.name) !== i) return { ok: false, changed: [], ran: 0, passes: 0, error: `step ${s.name} is named twice or reads no later step ${bad.join(', ')}` };
  }
  const first = opts.from === null ? 0 : steps.findIndex((s) => s.name === opts.from);
  if (first < 0) return { ok: false, changed: [], ran: 0, passes: 0, error: `unknown step ${opts.from}; the steps are ${steps.map((s) => s.name).join(', ')}` };
  let tree = start;
  let ran = 0;
  let lastChanged: string[] = [];
  for (let pass = 1; pass <= maxPasses; pass++) {
    const touched = new Set<string>();
    const tp = io.now();
    for (const step of steps.slice(pass === 1 ? first : 0)) {
      const d = stepDigests(steps, step, tree, io.env);
      const hit = cache[step.name];
      if (!opts.force && hit !== undefined && hit.inputs === d.inputs && hit.outputs === d.outputs) {
        io.log(`pass ${pass} ${step.name}: unchanged, skipped`);
        continue;
      }
      // Forced steps run once; later passes trust the digests this run records.
      const ts = io.now();
      delete cache[step.name];
      io.saveCache(cache);
      const { code, log } = await io.run(step);
      ran++;
      const after = io.snapshot();
      const changed = changedPaths(tree, after);
      if (code !== 0 && !(step.verdict?.(code, log) ?? false)) {
        const last = log.split('\n').slice(-40).join('\n');
        return { ok: false, changed: changedPaths(start, after), ran, passes: pass, error: `${step.name} exited ${code}; the last lines of its output:\n${last}` };
      }
      if (code !== 0) io.log(`${step.name} exited ${code}: a verdict it recorded, not a regeneration failure`);
      const own = matcher(step.outputs);
      const stray = changed.filter((p) => !own(p));
      if (stray.length > 0) return { ok: false, changed: changedPaths(start, after), ran, passes: pass, error: `${step.name} changed files outside its declared outputs: ${stray.join(', ')}` };
      tree = after;
      for (const p of changed) touched.add(p);
      cache[step.name] = { inputs: d.inputs, outputs: stepDigests(steps, step, tree, io.env).outputs };
      io.saveCache(cache);
      io.log(`pass ${pass} ${step.name}: ran in ${secs(io.now() - ts)}, ${changed.length} files changed`);
    }
    // A pass changes nothing only when no step in it changed a file, even if a later step changed it back.
    const passChanged = [...touched].sort();
    lastChanged = passChanged;
    io.log(`pass ${pass}: ${secs(io.now() - tp)}, ${passChanged.length} files changed`);
    if (passChanged.length === 0 && (pass > 1 || first === 0)) {
      const changed = changedPaths(start, tree);
      io.log(`fixed point after ${pass} passes, ${ran} steps run, ${secs(io.now() - t0)}${ran === 0 ? ': nothing to do' : ''}`);
      return { ok: true, changed, ran, passes: pass, error: null };
    }
    if (opts.force) opts = { ...opts, force: false };
  }
  return { ok: false, changed: changedPaths(start, tree), ran, passes: maxPasses, error: `no fixed point after ${maxPasses} passes; the last pass changed ${lastChanged.join(', ')}` };
}

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opts: { force: boolean; check: boolean; from: string | null } = { force: false, check: false, from: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force') opts.force = true;
    else if (a === '--check') opts.check = true;
    else if (a === '--from' && i + 1 < args.length && !args[i + 1]!.startsWith('--')) opts.from = args[++i]!;
    else {
      console.error(`regen: unknown argument ${JSON.stringify(a)}; usage: pnpm regen [--check] [--force] [--from <step>]`);
      process.exit(2);
    }
  }
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const cacheDir = join(root, 'node_modules/.cache/dragon-regen');
  mkdirSync(cacheDir, { recursive: true });
  const cacheFile = join(cacheDir, 'state.json');
  const parsed = parseCache(existsSync(cacheFile) ? readFileSync(cacheFile, 'utf8') : null);
  if (parsed.problem !== null) console.log(`regen: ignoring ${cacheFile} (${parsed.problem}); every step runs`);
  let driver = '';
  try {
    driver = git(['-C', root, 'config', '--get', 'merge.dragon-generated.driver']).trim();
  } catch {
    // Unset: git config exits 1.
  }
  if (driver !== 'true') console.log('regen: run pnpm setup:git once so merges keep generated files instead of stopping on them');
  const io: Io = {
    snapshot: () => snapshotTree(root),
    run: (step) =>
      new Promise((done) => {
        const logFile = join(cacheDir, `${step.name}.log`);
        console.log(`regen: ${step.name}: ${step.argv.join(' ')} (output in ${logFile})`);
        const out = createWriteStream(logFile);
        let settled = false;
        const finish = (code: number, note: string): void => {
          if (settled) return;
          settled = true;
          out.end(note, () => done({ code, log: readFileSync(logFile, 'utf8') }));
        };
        const child = spawn(step.argv[0]!, step.argv.slice(1), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.pipe(out, { end: false });
        child.stderr.pipe(out, { end: false });
        child.on('error', (e) => finish(127, `regen: could not start ${step.argv[0]}: ${e.message}\n`));
        child.on('close', (code, signal) => finish(code ?? 1, signal === null ? '' : `regen: killed by ${signal}\n`));
      }),
    saveCache: (cache) => writeFileSync(cacheFile, `${JSON.stringify({ version: 1, steps: cache }, null, 1)}\n`),
    log: (line) => console.log(`regen: ${line}`),
    now: () => Date.now(),
    env: process.env,
  };
  const r = await regen(STEPS, parsed.cache, opts, io);
  if (r.error !== null) console.error(`regen: FAILED: ${r.error}`);
  if (opts.check && r.changed.length > 0) console.error(`regen --check: ${r.changed.length} files were stale:\n${r.changed.join('\n')}`);
  process.exitCode = r.ok && !(opts.check && r.changed.length > 0) ? 0 : 1;
}

if (import.meta.main) await main();
