// pnpm run parity:lanes (docs/research/native-strategy.md 3.6): lane, case-list, tolerance, sample-rule and dump-fault parity of
// every native target, a source scan for numeric tolerance literals in lane code, the host engine lane run through the existing
// native:swift and native:kotlin CLIs, the TS-engine-plus-snapRect reference proof, and out/lanes.json. Lane states are pass,
// fail, blocked (owner tooling) when a tool lookup fails, and not run. Device lanes carry their run records (P5, device-lanes.ts):
// the device and OS per DPR set, the counts compared per check, failures by kind, the run digests and the real-dump fault rows.
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
import type { Compared, DeviceSet, FaultRow, LaneFailure, TrustRow } from './device-lanes.ts';
import { DEVICE_CHECK_LANES, failuresByKind, laneFailures } from './device-lanes.ts';
import type { DeviceEvidence } from './device-evidence.ts';
import { deviceEvidence, evidenceProblems } from './device-evidence.ts';
import type { DeviceRecord } from './device-run.ts';
import { TRUST_CASES } from './device-run.ts';
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

// Any suite-shaped line, so a suite the manifest does not declare is counted and judgeHost fails it instead of dropping it.
const SUITE_LINE = /^([a-z0-9][a-z0-9 -]*) (\d+)\/(\d+)/;
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
  /** A device lane's run: per DPR set the device and its record, the counts compared per check and the failures by kind. */
  readonly device: DeviceLaneRun | null;
  /** A device lane's evidence stamp, written by the device run (device-evidence.ts); null for host lanes and lanes not run. */
  readonly evidence: DeviceEvidence | null;
};

/** One DPR set of a device lane run. */
export type DeviceSetRecord = {
  readonly dpr: number;
  readonly device: DeviceRecord;
  readonly cases: number;
  readonly dumps: number;
  readonly compared: Compared;
  readonly dumpsSha256: string;
  readonly failures: number;
  readonly failuresByKind: Readonly<Record<string, number>>;
};

export type DeviceLaneRun = {
  readonly sets: readonly DeviceSetRecord[];
  readonly failuresByKind: Readonly<Record<string, number>>;
  /** The first failures, named (every failure is printed by the run and written to out/device-failures-<target>.json). */
  readonly firstFailures: readonly LaneFailure[];
  /** device-pixels: the capture-trust probe per device (points compared, mismatches). */
  readonly trust: readonly { readonly device: string; readonly dpr: number; readonly cases: number; readonly points: number; readonly mismatches: number }[] | null;
};

/** What a device run hands the lanes file for one target. */
export type DeviceRun = {
  readonly vectors: (HostRun & { readonly device: string }) | null;
  readonly sets: readonly DeviceSet[];
  readonly trust: readonly { readonly device: string; readonly dpr: number; readonly rows: readonly TrustRow[] }[];
  /** A tooling fault that stopped the run (a device that failed to boot twice, a device that cannot hold the root). */
  readonly blocked: string | null;
  /** The evidence stamp of the code, reference data and app the run was made and judged with. */
  readonly evidence: DeviceEvidence;
};

/** The real-dump fault rows of a target, per DPR. */
export type FaultRecord = { readonly dpr: number; readonly rows: readonly FaultRow[] };

export const FIRST_FAILURES = 20;

export type LanesFile = {
  readonly schema: 'dragon.lanes/2';
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
    readonly dumpFaults: readonly FaultRecord[] | null;
  }[];
};

export const DEVICE_NOT_RUN = 'run pnpm run parity:lanes -- --run-device (simulators and emulators); the tools are installed, so this is not blocked';

function laneRecord(l: LaneConfig, state: LaneState, reason: string | null, run: LaneRecord['run'], device: DeviceLaneRun | null = null, evidence: DeviceEvidence | null = null): LaneRecord {
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
    device,
    evidence,
  };
}

/** A device check lane's record from the run: pass only with a dump for every case at every declared DPR and no failure. */
/** Every declared DPR's device must have run the capture-trust probe, over every trust case in order. */
export function trustCoverageProblems(dprs: readonly number[], trust: DeviceRun['trust']): string[] {
  const out: string[] = [];
  for (const dpr of dprs) {
    const t = trust.find((x) => x.dpr === dpr);
    if (t === undefined) out.push(`capture trust did not run at DPR ${dpr}`);
    else if (JSON.stringify(t.rows.map((x) => x.case)) !== JSON.stringify(TRUST_CASES)) out.push(`capture trust at DPR ${dpr} covered ${t.rows.map((x) => x.case).join(', ') || 'no case'}, not ${TRUST_CASES.join(', ')}`);
  }
  return out;
}

function deviceLaneRecord(l: LaneConfig, r: DeviceRun): LaneRecord {
  const lane = l.lane as (typeof DEVICE_CHECK_LANES)[number];
  const failures = laneFailures(r.sets, lane);
  const problems: string[] = [];
  for (const s of l.sets) {
    const got = r.sets.filter((x) => x.dpr === s.dpr);
    if (got.length === 0) problems.push(`DPR ${s.dpr} was not run`);
    else if (got.length > 1) problems.push(`DPR ${s.dpr} was run ${got.length} times (${got.map((x) => x.device.name).join(', ')})`);
    else if ((got[0] as DeviceSet).dumps !== s.ids.length) problems.push(`DPR ${s.dpr}: ${(got[0] as DeviceSet).dumps}/${s.ids.length} dumps`);
  }
  for (const x of r.sets) if (!l.sets.some((s) => s.dpr === x.dpr)) problems.push(`DPR ${x.dpr} (${x.device.name}) is not a declared DPR of the lane`);
  const trust = lane === 'device-pixels' ? r.trust.map((t) => ({ device: t.device, dpr: t.dpr, cases: t.rows.length, points: t.rows.reduce((n, x) => n + x.points, 0), mismatches: t.rows.reduce((n, x) => n + x.mismatches.length, 0) })) : null;
  if (trust !== null) {
    for (const t of trust) if (t.mismatches > 0 || t.points === 0) problems.push(`capture trust on ${t.device}: ${t.mismatches} mismatches in ${t.points} points`);
    problems.push(...trustCoverageProblems(l.sets.map((s) => s.dpr), r.trust));
  }
  if (failures.length > 0) problems.push(`${failures.length} failures (${Object.entries(failuresByKind(failures)).map(([k, n]) => `${k} ${n}`).join(', ')})`);
  if (r.blocked !== null) problems.unshift(r.blocked);
  const state: LaneState = r.blocked !== null && r.sets.length === 0 ? 'blocked (owner tooling)' : problems.length === 0 ? 'pass' : 'fail';
  const sets = r.sets.map((s): DeviceSetRecord => {
    const mine = s.failures.filter((f) => f.lane === lane);
    return { dpr: s.dpr, device: s.device, cases: s.cases, dumps: s.dumps, compared: s.compared, dumpsSha256: s.dumpsSha256, failures: mine.length, failuresByKind: failuresByKind(mine) };
  });
  return laneRecord(l, state, problems.length === 0 ? null : problems.join('; '), null, { sets, failuresByKind: failuresByKind(failures), firstFailures: failures.slice(0, FIRST_FAILURES), trust }, r.evidence);
}

/**
 * The lanes file of one run: host lanes from their runs (not run without one); device lanes from a device run, else carried from
 * the committed file when it still describes the configuration, else not run.
 */
export function lanesFile(targets: readonly TargetConfig[], problems: readonly string[], host: ReadonlyMap<NativeTarget, HostRun>, reference: ReturnType<typeof referenceProof> | null, device: ReadonlyMap<NativeTarget, DeviceRun> = new Map(), carried: LanesFile | null = null): LanesFile {
  const file = lanesFileOf(targets, problems, host, reference, device, carried);
  const runProblems = runRecordProblems(file);
  if (runProblems.length === 0) return file;
  const all = [...problems, ...runProblems];
  return { ...file, parity: { pass: false, problems: all } };
}

function lanesFileOf(targets: readonly TargetConfig[], problems: readonly string[], host: ReadonlyMap<NativeTarget, HostRun>, reference: ReturnType<typeof referenceProof> | null, device: ReadonlyMap<NativeTarget, DeviceRun>, carried: LanesFile | null): LanesFile {
  const stale = carried === null ? [] : staleLanes(carried, targets);
  return {
    schema: 'dragon.lanes/2',
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
        const kept = carried?.targets.find((x) => x.target === t.target)?.lanes.find((x) => x.lane === l.lane);
        const keep = kept !== undefined && kept.state !== 'not run' && !stale.some((p) => staleCovers(p, t.target, l.lane));
        if (l.where === 'host') {
          const h = host.get(t.target);
          if (h === undefined && keep) return { ...kept, device: kept.device ?? null, evidence: null };
          return h === undefined ? laneRecord(l, 'not run', 'run pnpm run parity:lanes -- --run-host', null) : laneRecord(l, h.state, h.reason, { toolchain: h.toolchain, suites: h.suites, digests: h.digests });
        }
        const d = device.get(t.target);
        if (d !== undefined) {
          if (l.lane !== 'layout-vectors-device') return deviceLaneRecord(l, d);
          if (d.vectors === null) return laneRecord(l, d.blocked === null ? 'not run' : 'blocked (owner tooling)', d.blocked ?? DEVICE_NOT_RUN, null);
          return laneRecord(l, d.vectors.state, d.vectors.reason, { toolchain: d.vectors.toolchain, suites: d.vectors.suites, digests: d.vectors.digests }, null, d.evidence);
        }
        // A device lane is carried only with the current evidence stamp: same lane code, reference data and app source.
        if (keep && evidenceProblems(kept.evidence, deviceEvidence(t.target)).length === 0) return { ...kept, device: kept.device ?? null };
        return laneRecord(l, 'not run', DEVICE_NOT_RUN, null);
      }),
      referenceProof: reference?.find((r) => r.target === t.target)?.rows.map(({ failures: _f, ...row }) => row) ?? carried?.targets.find((x) => x.target === t.target)?.referenceProof ?? null,
      dumpFaults: faultRecords(device.get(t.target)) ?? carried?.targets.find((x) => x.target === t.target)?.dumpFaults ?? null,
    })),
  };
}

function faultRecords(r: DeviceRun | undefined): FaultRecord[] | null {
  if (r === undefined || r.sets.length === 0) return null;
  return r.sets.map((s) => ({ dpr: s.dpr, rows: s.faults }));
}

/**
 * Parity of the run records: both targets run the same lanes and checks; every device lane that ran holds, per shared DPR, the same
 * case count on both targets; every fault record lists DUMP_FAULTS in order with an applicable count above 0 and nothing uncaught.
 */
export function runRecordProblems(f: LanesFile): string[] {
  const out: string[] = [];
  const [a, b] = f.targets;
  if (a !== undefined && b !== undefined) {
    if (JSON.stringify(a.lanes.map((l) => l.lane)) !== JSON.stringify(b.lanes.map((l) => l.lane))) out.push(`run records: ${a.target} and ${b.target} list different lanes`);
    // Both directions, so a shared DPR one target ran and the other did not is found whichever target ran it.
    for (const [x, y] of [[a, b], [b, a]] as const) {
      for (const lx of x.lanes) {
        const ly = y.lanes.find((l) => l.lane === lx.lane);
        if (lx.device === null || lx.device === undefined || ly === undefined || ly.device === null || ly.device === undefined) continue;
        for (const s of lx.device.sets) {
          if (!f.sharedDprs.includes(s.dpr)) continue;
          const t = ly.device.sets.find((z) => z.dpr === s.dpr);
          if (t === undefined) out.push(`run records: ${lx.lane} at DPR ${s.dpr} ran on ${x.target} but not on ${y.target}`);
          else if (t.cases !== s.cases) out.push(`run records: ${lx.lane} at DPR ${s.dpr}: ${x.target} ${s.cases} cases, ${y.target} ${t.cases}`);
          else if (JSON.stringify(Object.keys(t.compared)) !== JSON.stringify(Object.keys(s.compared))) out.push(`run records: ${lx.lane} at DPR ${s.dpr}: the targets compare different checks`);
        }
      }
    }
  }
  for (const t of f.targets) {
    // Every DPR set a device check lane ran must have its real-dump fault rows.
    const ran = new Set(t.lanes.flatMap((l) => (l.lane === 'layout-vectors-device' ? [] : (l.device?.sets ?? []).map((s) => s.dpr))));
    for (const dpr of ran) if (!(t.dumpFaults ?? []).some((r) => r.dpr === dpr)) out.push(`run records: ${t.target} DPR ${dpr} ran device lanes but has no dump fault rows`);
    for (const r of t.dumpFaults ?? []) {
      if (JSON.stringify(r.rows.map((x) => x.fault)) !== JSON.stringify(DUMP_FAULTS)) out.push(`run records: ${t.target} DPR ${r.dpr} fault rows are not DUMP_FAULTS`);
      for (const x of r.rows) {
        if (x.applicable === 0) out.push(`run records: ${t.target} DPR ${r.dpr}: dump fault ${x.fault} applies to no real dump`);
        if (x.caught !== x.applicable) out.push(`run records: ${t.target} DPR ${r.dpr}: dump fault ${x.fault} uncaught in ${x.applicable - x.caught} of ${x.applicable} dumps (${x.uncaught.slice(0, 5).join(', ')})`);
      }
    }
  }
  if (JSON.stringify(f.sampleRules) !== JSON.stringify(SAMPLE_RULES)) out.push('run records: the sample rules are not SAMPLE_RULES');
  return out;
}

/** The problems that fail parity:lanes for a lanes file: this run's configuration problems, the file's recorded parity problems and its run-record problems, rechecked. */
export function fileStatusProblems(f: LanesFile, problems: readonly string[]): string[] {
  return [...new Set([...problems, ...(f.parity.pass ? [] : f.parity.problems), ...runRecordProblems(f)])];
}

export const lanesJsonText = (f: LanesFile): string => `${JSON.stringify(f, null, 2)}\n`;

export function writeLanesFile(f: LanesFile): void {
  mkdirSync(repoPath('packages/parity/out'), { recursive: true });
  writeFileSync(repoPath(LANES_JSON), lanesJsonText(f));
}

export function readLanesFile(): LanesFile | null {
  return existsSync(repoPath(LANES_JSON)) ? (JSON.parse(readFileSync(repoPath(LANES_JSON), 'utf8')) as LanesFile) : null;
}

/** Whether a staleLanes problem invalidates a lane: its own case list, its target (missing, other projection), or every lane (a constant). */
export function staleCovers(problem: string, target: NativeTarget, lane: LaneId): boolean {
  const lanePrefix = /^\S+: (ios|android) (\S+) does not match/.exec(problem);
  if (lanePrefix !== null) return lanePrefix[1] === target && lanePrefix[2] === lane;
  const targetLevel = /^\S+(?: has no target |: )(ios|android)(?: projection |$)/.exec(problem);
  if (targetLevel !== null) return targetLevel[1] === target;
  return true;
}

/** Problems when a committed lanes file does not describe the current configuration (a stale file proves nothing). */
export function staleLanes(f: LanesFile, targets: readonly TargetConfig[]): string[] {
  const out: string[] = [];
  // The constants every lane is judged by: a file written under others describes another configuration.
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (f.schema !== 'dragon.lanes/2') out.push(`${LANES_JSON}: schema ${String(f.schema)}, not dragon.lanes/2`);
  if (!same(f.tolerances, { gateDevicePx: GATE_DEVICE_PX, channelDelta: GATE_CHANNEL_DELTA })) out.push(`${LANES_JSON}: tolerances ${JSON.stringify(f.tolerances)} are not the current gates`);
  if (!same(f.sampleRules, SAMPLE_RULES)) out.push(`${LANES_JSON}: sample rules ${JSON.stringify(f.sampleRules)} are not SAMPLE_RULES`);
  if (!same(f.dumpFaults, DUMP_FAULTS)) out.push(`${LANES_JSON}: dump faults ${JSON.stringify(f.dumpFaults)} are not DUMP_FAULTS`);
  if (!same(f.sharedDprs, SHARED_DPRS) || !same(f.extras, EXTRA_DPRS)) out.push(`${LANES_JSON}: the DPR sets are not SHARED_DPRS and EXTRA_DPRS`);
  for (const t of targets) {
    const ft = f.targets.find((x) => x.target === t.target);
    if (ft === undefined) {
      out.push(`${LANES_JSON} has no target ${t.target}`);
      continue;
    }
    if (ft.projection !== t.projection.name) out.push(`${LANES_JSON}: ${t.target} projection ${ft.projection}, configured ${t.projection.name}`);
    for (const l of t.lanes) {
      const fl = ft.lanes.find((x) => x.lane === l.lane);
      if (fl === undefined || fl.caseListSha256 !== laneRecord(l, 'not run', null, null).caseListSha256) out.push(`${LANES_JSON}: ${t.target} ${l.lane} does not match the configured case list`);
    }
  }
  return out;
}

/** Device lanes of a file whose evidence stamp is not the current one (missing stamps included); lanes not run are skipped. */
export function staleEvidence(f: LanesFile): string[] {
  const out: string[] = [];
  for (const t of f.targets) {
    for (const l of t.lanes) {
      if (l.where !== 'device' || l.state === 'not run') continue;
      for (const p of evidenceProblems(l.evidence, deviceEvidence(t.target))) out.push(`${LANES_JSON}: ${t.target} ${l.lane} evidence is stale: ${p}`);
    }
  }
  return out;
}

/** Every lane that did not pass, named: --require-all fails on any. */
export function notPassed(f: LanesFile): string[] {
  return f.targets.flatMap((t) => t.lanes.filter((l) => l.state !== 'pass').map((l) => `${t.target} ${l.lane}: ${l.state}${l.reason === null ? '' : ` (${l.reason})`}`));
}

