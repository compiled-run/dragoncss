// Compile-time benchmark: node --conditions=dragon-internal scripts/bench-compile.ts [suite...] [--reps N]
// Suites: small, large, music, all, web-only, ios-only, android-only. Prints wall ms per suite and an output digest (outputs, targets, diagnostics) that must not change.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { Compiled, FontMap, FrontEndResult } from '../packages/dragon/src/index.ts';
import { createProjectWith, NO_FAULTS } from '../packages/dragon/src/internal.ts';
import { createProject } from '../packages/dragon/src/index.ts';
import { compileFixture, fixtureCompileInput } from '../packages/parity/src/pipeline.ts';
import { FIXTURES, environmentsOf } from '../packages/parity/src/fixtures.ts';
import { fontMapOf } from '../packages/parity/src/fixture-groups/fonts.ts';
import { PROJECT_ID } from '../packages/parity/src/fixture-reader.ts';
import { REFERENCE_PLATFORM } from '../packages/parity/src/platform.ts';
import { ENVIRONMENT } from '../packages/parity/src/fixtures.ts';
import { readTreeFixtureDir } from '../packages/parity/src/tree-fixture.ts';

const args = process.argv.slice(2);
const repsAt = args.indexOf('--reps');
const reps = repsAt < 0 ? 1 : Number(args[repsAt + 1]);
const suites = args.filter((a, i) => !a.startsWith('--') && (repsAt < 0 || i !== repsAt + 1));

const digestOf = (c: Compiled<string>): string => {
  const h = createHash('sha256');
  h.update(JSON.stringify(c.targets));
  h.update(JSON.stringify(c.diagnostics));
  for (const [k, o] of Object.entries(c.outputs).sort()) {
    h.update(k + o.kind);
    if (o.kind === 'ready') {
      h.update(o.digest);
      for (const f of o.files) h.update(`${f.path}\0${f.text}\0`);
      for (const a of o.assets) h.update(`${a.path}\0${createHash('sha256').update(a.bytes).digest('hex')}\0`);
    } else if (o.kind === 'analysis-only') h.update(o.digest + o.reason);
    else h.update(JSON.stringify(o.diagnostics));
  }
  return h.digest('hex');
};

type Job = { id: string; run: () => Compiled<string> };

const fixtureJobs = (specs: typeof FIXTURES): Job[] =>
  specs.flatMap((s) => environmentsOf(s).map((e) => ({ id: `${s.id}:${e.direction}`, run: () => compileFixture(s, NO_FAULTS, 'enforce', e.direction).compiled })));

const inputSize = (s: (typeof FIXTURES)[number]): number => fixtureCompileInput(s).snapshot.sources.reduce((n, src) => n + src.text.length, 0);
const bySize = [...FIXTURES].map((s) => ({ s, n: inputSize(s) })).sort((a, b) => b.n - a.n);

// The music player's font map lives in its own TypeScript project, so it is loaded at run time.
const musicFonts = (await import(new URL('../examples/music-player/tools/font-map.ts', import.meta.url).href)) as { FONTS: FontMap; pinnedFaceSrcs(map: FontMap): readonly string[] };

function musicJob(): Job {
  const { FONTS, pinnedFaceSrcs } = musicFonts;
  const read = readTreeFixtureDir('examples/music-player/tree', 'north-star');
  const assets = [...pinnedFaceSrcs(FONTS)].sort().map((id) => {
    const bytes = new Uint8Array(readFileSync(id));
    return { id, hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, bytes };
  });
  const input: FrontEndResult = { ...read, snapshot: { ...read.snapshot, assets: [...read.snapshot.assets, ...assets] } };
  const targets = { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } } as const;
  return { id: 'music-player', run: () => createProject({ projectId: 'dragon-parity', targets, fonts: FONTS }).compile(input) };
}

/** One target at a time over the large fixtures: the per-target cost of the compile. */
function targetJobs(target: 'web' | 'ios' | 'android'): Job[] {
  const t = { web: { web: {} }, ios: { ios: { minimum: '15.0' } }, android: { android: { minSdk: 31 } } }[target];
  return bySize.slice(0, 10).map(({ s }) => {
    const fonts = fontMapOf(s.id);
    const input = fixtureCompileInput(s);
    const rootFont = s.kind === 'layout' ? s.rootFont : 'ahem';
    return { id: `${target}:${s.id}`, run: () => createProjectWith({ projectId: PROJECT_ID, targets: t, ...(fonts === undefined ? {} : { fonts }) }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont, foldViewport: ENVIRONMENT.viewport }).compile(input) };
  });
}

const SUITES: Record<string, () => Job[]> = {
  small: () => fixtureJobs([bySize.filter((x) => x.s.kind === 'layout').at(-1)!.s]),
  large: () => fixtureJobs(bySize.slice(0, 10).map((x) => x.s)),
  music: () => [musicJob()],
  all: () => fixtureJobs(FIXTURES),
  'web-only': () => targetJobs('web'),
  'ios-only': () => targetJobs('ios'),
  'android-only': () => targetJobs('android'),
};

for (const name of suites.length === 0 ? ['small', 'large', 'music'] : suites) {
  const make = SUITES[name];
  if (make === undefined) throw new Error(`unknown suite ${name}; known: ${Object.keys(SUITES).join(', ')}`);
  const jobs = make();
  const times: number[] = [];
  let digest = '';
  for (let r = 0; r < reps; r++) {
    const h = createHash('sha256');
    const t0 = performance.now();
    for (const j of jobs) h.update(`${j.id}=${digestOf(j.run())}\n`);
    times.push(performance.now() - t0);
    const d = h.digest('hex').slice(0, 16);
    if (digest !== '' && d !== digest) throw new Error(`${name}: output digest differs between repetitions`);
    digest = d;
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`${name.padEnd(13)} jobs=${String(jobs.length).padStart(4)} first=${times[0]!.toFixed(0)}ms min=${sorted[0]!.toFixed(0)}ms median=${sorted[Math.floor(sorted.length / 2)]!.toFixed(0)}ms digest=${digest}`);
}
