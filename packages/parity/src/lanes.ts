// pnpm run parity:lanes (docs/research/native-strategy.md 3.6): lane, case-list, tolerance, sample-rule and dump-fault parity of
// every native target, a source scan for numeric tolerance literals in lane code, the host engine lane run through the existing
// native:swift and native:kotlin CLIs, the TS-engine-plus-snapRect reference proof, and out/lanes.json. Lane states are pass,
// fail, blocked (owner tooling) when a tool lookup fails, and not run; device lanes are not run until P5.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { LayoutRect } from '@dragon/layout';
import { layoutWithFaults, measurerFor, NO_ENGINE_FAULTS, validateLayoutInput } from '@dragon/layout';
import type { Compiled, Environment } from 'dragon';
import { nativeLayoutProjection, NO_FAULTS } from 'dragon';
import { GATE_CHANNEL_DELTA, GATE_DEVICE_PX } from './compare.ts';
import { atDpr, committedDprCapture, DPRS, EXTRA_DPRS, layoutCases, SHARED_DPRS } from './dpr.ts';
import type { FixtureSpec } from './fixtures.ts';
import { checkAgainstChrome, checkAgainstEngine, DUMP_FAULTS, referenceDump } from './native-compare.ts';
import { validateNativeDump } from './native-dump.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import { compileFixture } from './pipeline.ts';
import { SAMPLE_RULES } from './samples.ts';
import type { CaseSet, LaneConfig, LaneId, NativeTarget, TargetConfig } from './targets.ts';
import { declaredLane, declaredSuites, extendedManifest, LANES, layoutCaseIds, m1CaseIds, NATIVE_TARGETS, p1Manifest } from './targets.ts';

export type LaneState = 'pass' | 'fail' | 'blocked (owner tooling)' | 'not run';

/** Lane code the literal scan reads: a tolerance in any of these must be an imported constant. */
export const LANE_FILES: readonly string[] = [
  'packages/parity/src/targets.ts',
  'packages/parity/src/lanes.ts',
  'packages/parity/src/native-compare.ts',
  'packages/parity/src/native-dump.ts',
  'packages/parity/src/samples.ts',
  'packages/parity/src/cli/lanes.ts',
];

export type SourceFile = { readonly path: string; readonly text: string };
export const laneSources = (): SourceFile[] => LANE_FILES.map((path) => ({ path, text: readFileSync(repoPath(path), 'utf8') }));

const NUM = String.raw`[-+]?(?:\d|\.\d)`;
const TOLERANCE_WORD = String.raw`\w*(?:gate|tolerance|delta|epsilon|threshold|allowance)\w*`;
/** A numeric literal bound to a tolerance name, compared with a tolerance name, or compared with an absolute difference. */
const LITERAL_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\b${TOLERANCE_WORD}\s*(?::|=(?!=))\s*${NUM}`, 'i'),
  new RegExp(String.raw`\b${TOLERANCE_WORD}\s*(?:<=|>=|<|>|===|!==)\s*${NUM}`, 'i'),
  new RegExp(String.raw`Math\.abs\([^;]*?\)\s*(?:\*\s*[\w.]+\s*)?(?:<=|>=|<|>)\s*${NUM}`),
  new RegExp(String.raw`${NUM}[\d.]*\s*(?:<=|>=|<|>)\s*Math\.abs\(`),
];

/** Every line of lane code that holds a numeric tolerance literal. */
export function toleranceLiterals(sources: readonly SourceFile[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    s.text.split('\n').forEach((line, i) => {
      if (LITERAL_PATTERNS.some((p) => p.test(line))) out.push(`${s.path}:${i + 1}: numeric tolerance literal: ${line.trim()}`);
    });
  }
  return out;
}

const setKey = (s: CaseSet): string => `${s.dpr} ${s.role} ${s.extra ?? '-'}`;

function compareLane(target: NativeTarget, have: LaneConfig, want: LaneConfig, problems: string[]): void {
  const label = `${target} ${want.lane}`;
  if (have.kind !== want.kind || have.where !== want.where) problems.push(`${label}: kind ${have.kind}/${have.where}, declared ${want.kind}/${want.where}`);
  for (const w of want.sets) {
    const h = have.sets.find((s) => s.dpr === w.dpr);
    if (h === undefined) {
      problems.push(`${label}: drops every case at DPR ${w.dpr} (${w.ids.length} declared)`);
      continue;
    }
    const got = new Set(h.ids);
    const missing = w.ids.filter((id) => !got.has(id));
    if (missing.length > 0) problems.push(`${label}: drops ${missing.length} declared case(s) at DPR ${w.dpr}: ${missing.slice(0, 5).join(', ')} (declared ${w.ids.length}, configured ${h.ids.length})`);
    const declared = new Set(w.ids);
    const unknown = h.ids.filter((id) => !declared.has(id));
    if (unknown.length > 0) problems.push(`${label}: ${unknown.length} case(s) at DPR ${w.dpr} that no layout case declares: ${unknown.slice(0, 5).join(', ')}`);
    if (setKey(h) !== setKey(w)) problems.push(`${label}: DPR ${w.dpr} is configured as ${setKey(h)}, declared ${setKey(w)}`);
  }
  for (const h of have.sets) if (!want.sets.some((w) => w.dpr === h.dpr)) problems.push(`${label}: configures DPR ${h.dpr}, which the declared lane does not have`);
  for (const w of want.corpora) {
    const h = have.corpora.find((c) => c.corpus === w.corpus && c.suite === w.suite);
    if (h === undefined) problems.push(`${label}: drops corpus suite ${w.corpus}/${w.suite} (${w.cases} cases)`);
    else if (h.cases !== w.cases) problems.push(`${label}: corpus suite ${w.corpus}/${w.suite} has ${h.cases} cases, declared ${w.cases}`);
  }
  for (const h of have.corpora) if (!want.corpora.some((w) => w.corpus === h.corpus && w.suite === h.suite)) problems.push(`${label}: corpus suite ${h.corpus}/${h.suite} is not declared`);
}

/** Every DPR outside the shared set must be an extra named in EXTRA_DPRS, and a device lane's extra must be its own platform's. */
function checkExtras(t: TargetConfig, problems: string[]): void {
  for (const l of t.lanes) {
    for (const s of l.sets) {
      if (s.role === 'top-level' && s.dpr === 1) continue;
      if (SHARED_DPRS.includes(s.dpr) && s.role === 'shared') continue;
      const named = EXTRA_DPRS.find((e) => e.dpr === s.dpr && e.name === s.extra);
      if (s.role !== 'extra' || named === undefined) problems.push(`${t.target} ${l.lane}: DPR ${s.dpr} is neither shared (${SHARED_DPRS.join(', ')}) nor an extra named in EXTRA_DPRS (unnamed extra DPR)`);
      else if (l.kind === 'device' && named.platform !== t.target) problems.push(`${t.target} ${l.lane}: extra ${named.name} (DPR ${s.dpr}) is named for ${named.platform}, not ${t.target}`);
    }
  }
  for (const d of t.dprs) if (!SHARED_DPRS.includes(d) && !EXTRA_DPRS.some((e) => e.dpr === d && e.platform === t.target)) problems.push(`${t.target}: device DPR ${d} is neither shared nor an extra named for ${t.target} (unnamed extra DPR)`);
}

/** The manifests must agree with the counts derived from the layout cases and the DPR constants. */
function checkManifests(problems: string[]): void {
  const p1 = p1Manifest();
  const x = extendedManifest();
  const top = layoutCaseIds();
  const m1 = m1CaseIds();
  if (!m1.every((id) => top.includes(id))) problems.push('corpus-m1-cases.json names a case that is not a layout case');
  if (JSON.stringify(x.dprSets) !== JSON.stringify(DPRS)) problems.push(`corpus-dpr.json dprSets ${JSON.stringify(x.dprSets)} is not DPRS ${JSON.stringify(DPRS)}`);
  for (const s of declaredSuites(declaredLane('ios', 'layout-vectors-host'))) {
    const m = (s.corpus === 'p1' ? p1 : x).cases[s.suite];
    if (m !== s.cases) problems.push(`${s.corpus === 'p1' ? 'corpus.json' : 'corpus-dpr.json'} declares ${m ?? 'no'} ${s.suite} cases; derived ${s.cases}`);
  }
}

/** Lane, case-list, tolerance, sample-rule, dump-fault and projection parity, and the literal scan. Empty when every target agrees. */
export function checkLaneParity(targets: readonly TargetConfig[], sources: readonly SourceFile[]): string[] {
  const problems: string[] = [];
  const names = targets.map((t) => t.target);
  for (const want of NATIVE_TARGETS) if (!names.includes(want)) problems.push(`native target ${want} is not configured`);
  for (const t of targets) {
    const lanes = t.lanes.map((l) => l.lane);
    for (const l of LANES) if (!lanes.includes(l)) problems.push(`${t.target} lacks lane ${l} (missing lane)`);
    for (const l of lanes) if (!(LANES as readonly string[]).includes(l)) problems.push(`${t.target} has lane ${l}, which is not a native lane`);
    if (JSON.stringify(lanes) !== JSON.stringify(LANES.filter((l) => lanes.includes(l)))) problems.push(`${t.target} lanes are out of order: ${lanes.join(', ')}`);
    checkExtras(t, problems);
    for (const l of t.lanes) if ((LANES as readonly string[]).includes(l.lane)) compareLane(t.target, l, declaredLane(t.target, l.lane), problems);
    if (t.tolerances.gateDevicePx !== GATE_DEVICE_PX) problems.push(`${t.target} tolerance gateDevicePx ${t.tolerances.gateDevicePx} is not the imported GATE_DEVICE_PX ${GATE_DEVICE_PX}`);
    if (t.tolerances.channelDelta !== GATE_CHANNEL_DELTA) problems.push(`${t.target} tolerance channelDelta ${t.tolerances.channelDelta} is not the imported GATE_CHANNEL_DELTA ${GATE_CHANNEL_DELTA}`);
    if (JSON.stringify(t.sampleRules) !== JSON.stringify(SAMPLE_RULES)) problems.push(`${t.target} sample rules ${t.sampleRules.join(', ')} are not SAMPLE_RULES`);
    if (JSON.stringify(t.plantedFaults) !== JSON.stringify(DUMP_FAULTS)) problems.push(`${t.target} planted faults ${t.plantedFaults.join(', ')} are not DUMP_FAULTS`);
    if (t.projection !== nativeLayoutProjection) problems.push(`${t.target} does not bind the shared nativeLayoutProjection`);
  }
  // Across targets: every lane's shared sets and corpora are identical, and a vectors lane is identical in full.
  for (const a of targets) {
    for (const b of targets) {
      if (a === b) continue;
      for (const la of a.lanes) {
        const lb = b.lanes.find((l) => l.lane === la.lane);
        if (lb === undefined) continue;
        const shared = (l: LaneConfig): string => JSON.stringify({ sets: l.sets.filter((s) => la.kind === 'vectors' || s.role !== 'extra'), corpora: l.corpora });
        if (shared(la) !== shared(lb)) problems.push(`${la.lane}: ${a.target} and ${b.target} differ in ${la.kind === 'vectors' ? 'their case lists' : 'their shared cases'} (${a.target} ${caseCount(la)}, ${b.target} ${caseCount(lb)})`);
      }
    }
  }
  checkManifests(problems);
  problems.push(...toleranceLiterals(sources));
  return [...new Set(problems)];
}

export const caseCount = (l: LaneConfig): number => l.sets.reduce((n, s) => n + s.ids.length, 0);

// ---------------------------------------------------------------- planted faults

export const LANE_FAULTS = ['missing-lane', 'dropped-case', 'tolerance-literal-2', 'unnamed-extra-dpr'] as const;
export type LaneFault = (typeof LANE_FAULTS)[number];

/** The planted value of tolerance-literal-2: a gate written as a number in lane code instead of the imported constant. */
const PLANTED_LITERAL = 2;

/** A planted copy of the configuration and sources; the real ones are never changed. */
export function plantLaneFault(fault: LaneFault, targets: readonly TargetConfig[], sources: readonly SourceFile[]): { targets: TargetConfig[]; sources: SourceFile[] } {
  const android = (f: (t: TargetConfig) => TargetConfig): TargetConfig[] => targets.map((t) => (t.target === 'android' ? f(t) : t));
  switch (fault) {
    case 'missing-lane':
      return { targets: android((t) => ({ ...t, lanes: t.lanes.filter((l) => l.lane !== 'device-pixels') })), sources: [...sources] };
    case 'dropped-case':
      return {
        targets: android((t) => ({ ...t, lanes: t.lanes.map((l) => (l.lane === 'device-frames' ? { ...l, sets: l.sets.map((s, i) => (i === 0 ? { ...s, ids: s.ids.slice(1) } : s)) } : l)) })),
        sources: [...sources],
      };
    case 'tolerance-literal-2': {
      const path = 'packages/parity/src/targets.ts';
      const needle = 'gateDevicePx: GATE_DEVICE_PX';
      return {
        targets: android((t) => ({ ...t, tolerances: { ...t.tolerances, gateDevicePx: PLANTED_LITERAL } })),
        sources: sources.map((s) => {
          if (s.path !== path) return s;
          if (!s.text.includes(needle)) throw new Error(`the planted literal needs "${needle}" in ${path}`);
          return { path, text: s.text.replace(needle, `gateDevicePx: ${PLANTED_LITERAL}`) };
        }),
      };
    }
    case 'unnamed-extra-dpr': {
      const unnamed = 1.5;
      return {
        targets: android((t) => ({
          ...t,
          dprs: [...t.dprs, unnamed],
          lanes: t.lanes.map((l) => (l.kind === 'device' ? { ...l, sets: [...l.sets, { dpr: unnamed, role: 'extra' as const, extra: null, ids: l.sets[0]?.ids ?? [] }] } : l)),
        })),
        sources: [...sources],
      };
    }
  }
}

// ---------------------------------------------------------------- the host engine lane

/** Where the Kotlin tools are looked for (packages/translate native.ts KotlinLookup); a test passes one that finds nothing. */
export type KotlinLookup = { readonly javaHomeEnv: string | null; readonly javaHomeCommand: string; readonly jdkHomes: readonly string[]; readonly kotlincs: readonly string[] };
type TranslateNative = {
  readonly swiftTool: () => { readonly version: string } | null;
  readonly kotlinTool: (lookup?: KotlinLookup) => { readonly javaHome: string; readonly version: string } | null;
  readonly defaultKotlinLookup: () => KotlinLookup;
};
// packages/parity does not depend on packages/translate, so the tool lookups are loaded at run time from its source.
const translateNative = async (): Promise<TranslateNative> => (await import(pathToFileURL(repoPath('packages/translate/src/native.ts')).href)) as TranslateNative;

export type SuiteCount = { readonly corpus: 'p1' | 'extended'; readonly suite: string; readonly declared: number; readonly total: number | null; readonly pass: number | null };
export type HostRun = { readonly state: LaneState; readonly reason: string | null; readonly toolchain: string | null; readonly suites: readonly SuiteCount[]; readonly digests: { readonly p1: string | null; readonly extended: string | null } };

const SUITE_LINE = /^(vectors|units|engine corpus|library corpus|vectors-m2|vectors-dpr|engine-dpr|units-m2|snap) (\d+)\/(\d+)/;
const FINAL_LINE = /^native:(swift|kotlin): P1 corpus digest ([0-9a-f]+); extended corpus digest ([0-9a-f]+); status (pass|fail|blocked \(owner tooling\))$/m;

/** Parses the native CLI's output into the P1 and extended suite counts, digests and status; null when it cannot. */
export function parseNativeOutput(text: string): { suites: { corpus: 'p1' | 'extended'; suite: string; total: number; pass: number }[]; p1: string; extended: string; status: string; toolchain: string | null } | null {
  const fin = FINAL_LINE.exec(text);
  if (fin === null) return null;
  const lines = text.split('\n');
  const split = lines.findIndex((l) => l.startsWith('extended corpus:'));
  const suites: { corpus: 'p1' | 'extended'; suite: string; total: number; pass: number }[] = [];
  lines.forEach((l, i) => {
    const m = SUITE_LINE.exec(l);
    if (m === null) return;
    suites.push({ corpus: split >= 0 && i > split ? 'extended' : 'p1', suite: (m[1] as string).replace(/ corpus$/, ''), pass: Number(m[2]), total: Number(m[3]) });
  });
  const tool = /^native:(?:swift|kotlin): (.*)$/m.exec(text);
  return { suites, p1: fin[2] as string, extended: fin[3] as string, status: fin[4] as string, toolchain: tool === null || (tool[1] as string).startsWith('P1 corpus') ? null : (tool[1] as string) };
}

const hostLane = (t: TargetConfig): LaneConfig => {
  const l = t.lanes.find((x) => x.lane === 'layout-vectors-host');
  if (l === undefined) throw new Error(`${t.target} has no layout-vectors-host lane`);
  return l;
};
const unrun = (t: TargetConfig): SuiteCount[] => declaredSuites(hostLane(t)).map((d) => ({ corpus: d.corpus, suite: d.suite, declared: d.cases, total: null, pass: null }));

/** The host lane's verdict from a parsed run: pass only if every count equals the declared case list and both digests match. */
export function judgeHost(t: TargetConfig, parsed: ReturnType<typeof parseNativeOutput>): HostRun {
  const declared = declaredSuites(hostLane(t));
  if (parsed === null) return { state: 'fail', reason: `${t.hostCli} output could not be parsed`, toolchain: null, suites: unrun(t), digests: { p1: null, extended: null } };
  const want = { p1: p1Manifest().digest, extended: extendedManifest().digest };
  const suites = declared.map((d): SuiteCount => {
    const got = parsed.suites.find((s) => s.corpus === d.corpus && s.suite === d.suite);
    return { corpus: d.corpus, suite: d.suite, declared: d.cases, total: got?.total ?? null, pass: got?.pass ?? null };
  });
  const problems: string[] = [];
  if (parsed.status.startsWith('blocked')) return { state: 'blocked (owner tooling)', reason: `${t.hostCli} reported blocked (owner tooling)`, toolchain: parsed.toolchain, suites: unrun(t), digests: { p1: null, extended: null } };
  if (parsed.status !== 'pass') problems.push(`${t.hostCli} status ${parsed.status}`);
  for (const s of suites) if (s.total !== s.declared || s.pass !== s.declared) problems.push(`${s.corpus}/${s.suite} ${s.pass ?? '-'}/${s.total ?? '-'}, declared ${s.declared}`);
  for (const s of parsed.suites) if (!declared.some((d) => d.corpus === s.corpus && d.suite === s.suite)) problems.push(`${s.corpus}/${s.suite} is not a declared suite`);
  if (parsed.p1 !== want.p1) problems.push(`P1 corpus digest ${parsed.p1}, manifest ${want.p1}`);
  if (parsed.extended !== want.extended) problems.push(`extended corpus digest ${parsed.extended}, manifest ${want.extended}`);
  return { state: problems.length === 0 ? 'pass' : 'fail', reason: problems.length === 0 ? null : problems.join('; '), toolchain: parsed.toolchain, suites, digests: { p1: parsed.p1, extended: parsed.extended } };
}

export type HostOptions = { readonly kotlinLookup?: KotlinLookup };

/** Runs the target's generated engine on the host through its existing CLI; blocked (owner tooling) only when a tool lookup fails. */
export async function runHostLane(t: TargetConfig, opts: HostOptions = {}): Promise<HostRun> {
  const native = await translateNative();
  const blocked = (reason: string): HostRun => ({ state: 'blocked (owner tooling)', reason, toolchain: null, suites: unrun(t), digests: { p1: null, extended: null } });
  let env: NodeJS.ProcessEnv = process.env;
  if (t.hostCli === 'native:swift') {
    if (native.swiftTool() === null) return blocked('swiftc was not found');
  } else {
    const tool = native.kotlinTool(opts.kotlinLookup ?? native.defaultKotlinLookup());
    if (tool === null) return blocked('no JDK 17+ or kotlinc was found (docs/decisions.md, Native lanes, milestone 2)');
    env = { ...process.env, JAVA_HOME: tool.javaHome };
  }
  const script = t.hostCli === 'native:swift' ? 'swift' : 'kotlin';
  const r = spawnSync(process.execPath, [repoPath('packages/translate/src/cli/native.ts'), script], { cwd: repoPath('.'), env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return judgeHost(t, parseNativeOutput(`${r.stdout ?? ''}${r.stderr ?? ''}`));
}

// ---------------------------------------------------------------- the reference proof

/** Per DPR: cases, valid dumps, cases passing (a) and (d), and the nodes and line boxes each check compared. */
export type ReferenceRow = { readonly dpr: number; readonly role: 'shared' | 'extra'; readonly cases: number; readonly valid: number; readonly chrome: number; readonly engine: number; readonly chromeCompared: number; readonly engineCompared: number; readonly failures: readonly string[] };

/**
 * For every layout case at every device DPR of each target: the TS engine through the target's projection, snapped by snapRect
 * into a ts-reference dump, which must validate and pass (a) against Chrome at that DPR and (d) against the engine.
 */
export function referenceProof(targets: readonly TargetConfig[]): { readonly target: NativeTarget; readonly rows: readonly ReferenceRow[] }[] {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  const compiled = new Map<string, Compiled<'ios' | 'web'>>();
  const compiledFor = (spec: FixtureSpec, direction: Environment['direction']): Compiled<'ios' | 'web'> => {
    const key = `${spec.id} ${direction}`;
    let c = compiled.get(key);
    if (c === undefined) {
      c = compileFixture(spec, NO_FAULTS, 'enforce', direction).compiled;
      compiled.set(key, c);
    }
    return c;
  };
  const all = layoutCases();
  return targets.map((t) => ({
    target: t.target,
    rows: t.dprs.map((dpr): ReferenceRow => {
      let valid = 0;
      let chrome = 0;
      let engine = 0;
      let chromeCompared = 0;
      let engineCompared = 0;
      const failures: string[] = [];
      let cases = 0;
      for (const f of all) {
        for (const c of f.cases) {
          cases++;
          const comp = compiledFor(f.spec, c.environment.direction);
          const env = atDpr(c.environment, dpr);
          const p = t.projection(comp, env, c.assignment);
          if (p.kind === 'blocked') {
            failures.push(`${c.id}@${dpr}: projection blocked: ${p.reason}`);
            continue;
          }
          const v = validateLayoutInput(JSON.parse(JSON.stringify(p.input)));
          if (!v.ok) {
            failures.push(`${c.id}@${dpr}: layout input rejected`);
            continue;
          }
          const out = layoutWithFaults(v.input, m.measurer, NO_ENGINE_FAULTS);
          if (out.kind !== 'ok') {
            failures.push(`${c.id}@${dpr}: LayoutUnsupported ${out.unsupported.code}`);
            continue;
          }
          const boxes: readonly LayoutRect[] = out.boxes;
          const dump = referenceDump({ platform: t.target, caseId: c.id, fixture: f.spec.id, dpr, direction: c.environment.direction, compilerDigest: comp.digest, input: v.input, engine: boxes });
          const checked = validateNativeDump(JSON.parse(JSON.stringify(dump)));
          if (!checked.ok) {
            failures.push(`${c.id}@${dpr}: dump invalid: ${checked.errors.slice(0, 3).map((e) => `${e.path} ${e.code}`).join('; ')}`);
            continue;
          }
          valid++;
          const a = checkAgainstChrome(checked.dump, committedDprCapture(c.id, dpr));
          const d = checkAgainstEngine(checked.dump, boxes);
          chromeCompared += a.compared;
          engineCompared += d.compared;
          if (a.pass) chrome++;
          else failures.push(`${c.id}@${dpr} (a): ${a.problems.slice(0, 3).join('; ')}`);
          if (d.pass) engine++;
          else failures.push(`${c.id}@${dpr} (d): ${d.problems.slice(0, 3).join('; ')}`);
        }
      }
      return { dpr, role: SHARED_DPRS.includes(dpr) ? 'shared' : 'extra', cases, valid, chrome, engine, chromeCompared, engineCompared, failures };
    }),
  }));
}

// ---------------------------------------------------------------- out/lanes.json

export const LANES_JSON = 'packages/parity/out/lanes.json';

export type LaneRecord = {
  readonly lane: LaneId;
  readonly where: 'host' | 'device';
  readonly state: LaneState;
  readonly reason: string | null;
  /** Case ids per DPR set: counts and the sha256 of the id list; the total counts the corpora too. */
  readonly sets: readonly { readonly dpr: number; readonly role: CaseSet['role']; readonly extra: string | null; readonly cases: number }[];
  readonly corpora: readonly { readonly corpus: 'p1' | 'extended'; readonly suite: string; readonly cases: number }[];
  readonly caseListSha256: string;
  readonly totalCases: number;
  readonly run: { readonly toolchain: string | null; readonly suites: readonly SuiteCount[]; readonly digests: HostRun['digests'] } | null;
};

export type LanesFile = {
  readonly schema: 'dragon.lanes/1';
  readonly tolerances: { readonly gateDevicePx: number; readonly channelDelta: number };
  readonly sharedDprs: readonly number[];
  readonly extras: typeof EXTRA_DPRS;
  readonly sampleRules: readonly string[];
  readonly dumpFaults: readonly string[];
  readonly parity: { readonly pass: boolean; readonly problems: readonly string[] };
  readonly targets: readonly {
    readonly target: NativeTarget;
    readonly dprs: readonly number[];
    readonly projection: string;
    readonly lanes: readonly LaneRecord[];
    readonly referenceProof: readonly Omit<ReferenceRow, 'failures'>[] | null;
  }[];
};

export const DEVICE_NOT_RUN = 'device lanes run from P5 (simulator and emulator); the tools are installed, so this is not blocked';

function laneRecord(l: LaneConfig, state: LaneState, reason: string | null, run: LaneRecord['run']): LaneRecord {
  const ids = l.sets.map((s) => ({ dpr: s.dpr, ids: s.ids }));
  return {
    lane: l.lane,
    where: l.where,
    state,
    reason,
    sets: l.sets.map((s) => ({ dpr: s.dpr, role: s.role, extra: s.extra, cases: s.ids.length })),
    corpora: l.corpora.map((c) => ({ corpus: c.corpus, suite: c.suite, cases: c.cases })),
    caseListSha256: createHash('sha256').update(JSON.stringify({ ids, corpora: l.corpora })).digest('hex'),
    totalCases: caseCount(l) + l.corpora.reduce((n, c) => n + c.cases, 0),
    run,
  };
}

/** The lanes file of one run: host lanes from their runs (not run without one), device lanes not run. */
export function lanesFile(targets: readonly TargetConfig[], problems: readonly string[], host: ReadonlyMap<NativeTarget, HostRun>, reference: ReturnType<typeof referenceProof> | null): LanesFile {
  return {
    schema: 'dragon.lanes/1',
    tolerances: { gateDevicePx: GATE_DEVICE_PX, channelDelta: GATE_CHANNEL_DELTA },
    sharedDprs: SHARED_DPRS,
    extras: EXTRA_DPRS,
    sampleRules: SAMPLE_RULES,
    dumpFaults: DUMP_FAULTS,
    parity: { pass: problems.length === 0, problems },
    targets: targets.map((t) => ({
      target: t.target,
      dprs: t.dprs,
      projection: t.projection.name,
      lanes: t.lanes.map((l) => {
        if (l.where === 'host') {
          const h = host.get(t.target);
          return h === undefined ? laneRecord(l, 'not run', 'run pnpm run parity:lanes -- --run-host', null) : laneRecord(l, h.state, h.reason, { toolchain: h.toolchain, suites: h.suites, digests: h.digests });
        }
        return laneRecord(l, 'not run', DEVICE_NOT_RUN, null);
      }),
      referenceProof: reference?.find((r) => r.target === t.target)?.rows.map(({ failures: _f, ...row }) => row) ?? null,
    })),
  };
}

export const lanesJsonText = (f: LanesFile): string => `${JSON.stringify(f, null, 2)}\n`;

export function writeLanesFile(f: LanesFile): void {
  mkdirSync(repoPath('packages/parity/out'), { recursive: true });
  writeFileSync(repoPath(LANES_JSON), lanesJsonText(f));
}

export function readLanesFile(): LanesFile | null {
  return existsSync(repoPath(LANES_JSON)) ? (JSON.parse(readFileSync(repoPath(LANES_JSON), 'utf8')) as LanesFile) : null;
}

/** Problems when a committed lanes file does not describe the current configuration (a stale file proves nothing). */
export function staleLanes(f: LanesFile, targets: readonly TargetConfig[]): string[] {
  const out: string[] = [];
  for (const t of targets) {
    const ft = f.targets.find((x) => x.target === t.target);
    if (ft === undefined) {
      out.push(`${LANES_JSON} has no target ${t.target}`);
      continue;
    }
    for (const l of t.lanes) {
      const fl = ft.lanes.find((x) => x.lane === l.lane);
      if (fl === undefined || fl.caseListSha256 !== laneRecord(l, 'not run', null, null).caseListSha256) out.push(`${LANES_JSON}: ${t.target} ${l.lane} does not match the configured case list`);
    }
  }
  return out;
}

/** Every lane that did not pass, named: --require-all fails on any. */
export function notPassed(f: LanesFile): string[] {
  return f.targets.flatMap((t) => t.lanes.filter((l) => l.state !== 'pass').map((l) => `${t.target} ${l.lane}: ${l.state}${l.reason === null ? '' : ` (${l.reason})`}`));
}

