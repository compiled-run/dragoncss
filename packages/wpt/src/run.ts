// Every CSS WPT test file for a target: its kind from the manifest, Dragon's result for numeric tests, and, when asked, Chrome's
// result on the same checks from the original file.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { webProfile } from 'dragon';
import type { Browser, ChromeOutcome, WptServer } from './chrome.ts';
import { launchChrome, runInChrome, serveWpt } from './chrome.ts';
import type { DragonOutcome, Fixture, NumericRun, Target } from './dragon.ts';
import { runNumeric, runTranslations } from './dragon.ts';
import type { ChromeCount, Entry, Expectations } from './expectations.ts';
import type { InteropLabels } from './interop.ts';
import { interopMarkdown, labelsByPath, loadInteropLabels } from './interop.ts';
import type { ManifestEntry, TestKind } from './manifest.ts';
import { buildManifest, countKinds, TEST_KINDS } from './manifest.ts';
import { lockedCommit, packagePath, pinnedWptDir } from './paths.ts';
import type { ReftestEntry, ReftestLayoutReport } from './reftest.ts';
import { captureReftest, judgeReftest, readReftestCapture, REFTEST_CAPTURE_DIR, REFTEST_LAYOUT_KIND, reftestDragonSide, RUN_REFTEST_CAPTURE_DIR, writeReftestCapture } from './reftest.ts';
import type { SnapshotFile } from './snapshot.ts';
import type { DeadRuleFaults } from './translate.ts';
import { NO_DEAD_RULE_FAULTS } from './translate.ts';
import { captureSnapshot, chromeFromSnapshot, liveDeadRulesInSnapshot, needsSnapshot, readSnapshot, RUN_SNAPSHOT_DIR, SNAPSHOT_DIR, snapshotProblem, translateSnapshot, writeSnapshot } from './snapshot.ts';

export type TestRecord = {
  readonly path: string;
  readonly kind: TestKind;
  readonly dragon: DragonOutcome | null;
  readonly fixtures: NumericRun['fixtures'];
  readonly chrome: ChromeOutcome | null;
  /** 'static': translated from the file itself; 'snapshot': from Chrome's DOM snapshots after the test's scripts ran. */
  readonly origin: 'static' | 'snapshot' | null;
  /** The snapshot path's refusal or states, for the summary. */
  readonly snapshot?: SnapshotFile['result'] | null;
};

export type RunResult = {
  readonly expectations: Expectations;
  readonly records: readonly TestRecord[];
  readonly manifest: readonly ManifestEntry[];
  readonly interop: InteropLabels;
  /** The numeric files that took the snapshot path (their static translation met script logic), sorted. */
  readonly snapshotPaths: readonly string[];
  /** The experimental reftest-layout report, when asked for (report-only: never in the headline or the check's gate). */
  readonly reftestLayout: ReftestLayoutReport | null;
};

export const PROFILE_REVISIONS: Readonly<Record<Target, string>> = { web: webProfile.revision };

export type RunOptions = {
  readonly target: Target;
  readonly filter: string | null;
  /** 'runnable': Chrome on the files Dragon runs (what expectations need); 'translated': also every other translated numeric file. */
  readonly chrome: 'none' | 'runnable' | 'translated';
  /**
   * Where script-driven tests get their snapshots: 'capture' runs the original pages in Chrome now (into out/snapshots/);
   * 'committed' reads packages/wpt/snapshots/. Default: 'capture' unless chrome is 'none'.
   */
  readonly snapshots?: 'capture' | 'committed';
  /** The committed snapshot store to read (default packages/wpt/snapshots/). */
  readonly snapshotDir?: string;
  /** Also run the experimental reftest-layout lane (src/reftest.ts). */
  readonly reftestLayout?: boolean;
  readonly log?: (line: string) => void;
};

/** A dropped dead rule that Chrome's querySelectorAll matched in the original page refuses the test. */
export const DEAD_RULE_LIVE: DragonOutcome = { status: 'not-runnable', missing: 'translate:dead-rule-live' };

const readWptFrom = (wpt: string) => (p: string): string | null => {
  try {
    return readFileSync(join(wpt, p), 'utf8');
  } catch {
    return null;
  }
};

/** The Dragon side of a script-driven test from its snapshot file (or the reason it cannot be used). */
export function runSnapshotTest(wpt: string, path: string, commit: string, target: Target, file: SnapshotFile | null, source: string = readFileSync(join(wpt, path), 'utf8'), deadRuleFaults: DeadRuleFaults = NO_DEAD_RULE_FAULTS): NumericRun {
  const problem = snapshotProblem(file, source, commit);
  if (problem !== null) return { outcome: { status: 'not-runnable', missing: problem }, fixtures: [] };
  const result = (file as SnapshotFile).result;
  if ('refused' in result) return { outcome: { status: 'not-runnable', missing: result.refused }, fixtures: [] };
  return runTranslations(translateSnapshot(path, result.states, commit, readWptFrom(wpt), deadRuleFaults), target);
}

/** The Dragon side of one numeric test file in the WPT copy. */
export function runDragonTest(wpt: string, path: string, commit: string, target: Target, source: string = readFileSync(join(wpt, path), 'utf8')): NumericRun {
  return runNumeric(path, source, commit, target, readWptFrom(wpt));
}

/** The expectations entry of one record; a failure carries the placeholder reason until a person writes one. */
export function entryOf(r: TestRecord): Entry {
  if (r.dragon === null) return { status: 'not-runnable', missing: `kind:${r.kind}` };
  const d = r.dragon;
  if (d.status === 'not-runnable') return { status: 'not-runnable', missing: d.missing };
  let chrome: ChromeCount | null = null;
  if (r.chrome !== null) {
    const c = r.chrome;
    const alsoFails = d.results.flatMap((s) => s.checks).filter((x, i) => !x.pass && !(c.checks[i]?.pass ?? false)).length;
    chrome = {
      harness: c.harness,
      subtests: { pass: c.subtests.filter((s) => s.pass).length, total: c.subtests.length },
      checks: { pass: c.checks.filter((x) => x.pass).length, total: c.checks.length },
      alsoFails,
    };
  }
  if (d.status === 'pass') return { status: 'pass', subtests: d.subtests, chrome };
  return { status: 'fail', subtests: d.subtests, checks: d.checks, chrome, reason: 'TODO' };
}

export async function runTarget(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const wpt = pinnedWptDir();
  const commit = lockedCommit();
  const manifest = buildManifest(wpt).filter((e) => opts.filter === null || e.path.startsWith(opts.filter));
  const records: TestRecord[] = [];
  const snapshotPaths: string[] = [];
  for (const e of manifest) {
    if (e.kind !== 'numeric') {
      records.push({ path: e.path, kind: e.kind, dragon: null, fixtures: [], chrome: null, origin: null });
      continue;
    }
    const run = runDragonTest(wpt, e.path, commit, opts.target);
    if (run.outcome.status === 'not-runnable' && needsSnapshot(run.outcome.missing)) snapshotPaths.push(e.path);
    records.push({ path: e.path, kind: e.kind, dragon: run.outcome, fixtures: run.fixtures, chrome: null, origin: 'static' });
  }
  const capture = (opts.snapshots ?? (opts.chrome === 'none' ? 'committed' : 'capture')) === 'capture';
  let reftestLayout: ReftestLayoutReport | null = null;
  let session: { browser: Browser; server: WptServer } | null = null;
  const chromeSession = async (): Promise<{ browser: Browser; server: WptServer }> => {
    session ??= { server: await serveWpt(wpt), browser: await launchChrome() };
    return session;
  };
  try {
    // Script-driven tests: Chrome's snapshots of the original pages, captured now or read from the committed store.
    if (capture && opts.filter === null) rmSync(RUN_SNAPSHOT_DIR, { recursive: true, force: true });
    for (const path of snapshotPaths) {
      const source = readFileSync(join(wpt, path), 'utf8');
      let file: SnapshotFile | null;
      if (capture) {
        const { browser, server } = await chromeSession();
        file = await captureSnapshot(browser, server.origin, path, source, commit);
        writeSnapshot(RUN_SNAPSHOT_DIR, file);
        log(`snapshot ${path}: ${'refused' in file.result ? file.result.refused : `${file.result.states.length} state(s)`}`);
      } else file = readSnapshot(opts.snapshotDir ?? SNAPSHOT_DIR, path);
      let run = runSnapshotTest(wpt, path, commit, opts.target, file, source);
      const at = records.findIndex((r) => r.path === path);
      const result = file === null ? null : file.result;
      let chrome: ChromeOutcome | null = null;
      const translatedAll = result !== null && !('refused' in result) && run.fixtures.length === result.states.length;
      // Dropped dead rules are confirmed in the original page at each state's checkLayout call.
      if (capture && translatedAll && run.fixtures.some((f) => (f.sidecar.deadRules ?? []).length > 0)) {
        const { browser, server } = await chromeSession();
        const live = await liveDeadRulesInSnapshot(browser, server.origin, path, run.fixtures.map((f) => f.sidecar.deadRules ?? []));
        if (live.length > 0) {
          log(`dead rule live ${path}: ${live.join(' | ')}`);
          run = { ...run, outcome: DEAD_RULE_LIVE };
        }
      }
      if (capture && translatedAll && (opts.chrome === 'translated' || run.outcome.status !== 'not-runnable')) {
        chrome = chromeFromSnapshot(result as Extract<SnapshotFile['result'], { states: unknown }>, run.fixtures.map((f) => f.sidecar));
      }
      records[at] = { ...(records[at] as TestRecord), dragon: run.outcome, fixtures: run.fixtures, chrome, origin: 'snapshot', snapshot: result };
    }
    if (opts.reftestLayout === true) {
      if (capture && opts.filter === null) rmSync(RUN_REFTEST_CAPTURE_DIR, { recursive: true, force: true });
      const excluded: Record<string, number> = {};
      const entries: Record<string, ReftestEntry> = {};
      for (const e of manifest) {
        if (e.kind !== 'reftest') continue;
        const d = reftestDragonSide(e.path, readFileSync(join(wpt, e.path), 'utf8'), commit, opts.target, readWptFrom(wpt));
        if (d.kind === 'excluded') {
          excluded[d.missing] = (excluded[d.missing] ?? 0) + 1;
          continue;
        }
        if (d.kind === 'blocked') {
          entries[e.path] = { status: 'not-runnable', missing: d.missing };
          continue;
        }
        let c;
        if (capture) {
          const { browser, server } = await chromeSession();
          c = await captureReftest(browser, server.origin, e.path, d.ref, commit);
          writeReftestCapture(RUN_REFTEST_CAPTURE_DIR, c);
        } else c = readReftestCapture(REFTEST_CAPTURE_DIR, e.path);
        if (c === null) entries[e.path] = { status: 'not-runnable', missing: 'reftest-layout:capture-missing' };
        else if (c.wpt !== commit || c.ref !== d.ref) entries[e.path] = { status: 'not-runnable', missing: 'reftest-layout:capture-stale' };
        else if ('refused' in c.result) entries[e.path] = { status: 'not-runnable', missing: c.result.refused };
        else entries[e.path] = judgeReftest(d.translation, d.laid, c.result, d.ref);
        const x = entries[e.path] as ReftestEntry;
        log(`reftest-layout ${e.path}: ${x.status === 'not-runnable' ? x.missing : `${x.status} (${x.differingPixels} px)`}`);
      }
      reftestLayout = { wpt: commit, target: opts.target, profileRevision: PROFILE_REVISIONS[opts.target], kind: REFTEST_LAYOUT_KIND, excluded, tests: entries };
    }
    if (opts.chrome !== 'none') {
      const runnable = records.filter((r) => r.origin === 'static' && r.fixtures.length > 0 && (opts.chrome === 'translated' || (r.dragon !== null && r.dragon.status !== 'not-runnable')));
      for (const r of runnable) {
        const { browser, server } = await chromeSession();
        const chrome = await runInChrome(browser, server.origin, (r.fixtures[0] as Fixture).sidecar);
        if (chrome.deadRulesLive.length > 0) log(`dead rule live ${r.path}: ${chrome.deadRulesLive.join(' | ')}`);
        records[records.indexOf(r)] = { ...r, chrome, ...(chrome.deadRulesLive.length > 0 ? { dragon: DEAD_RULE_LIVE } : {}) };
        log(`chrome ${r.path}: harness ${chrome.harness}, ${chrome.checks.filter((c) => c.pass).length}/${chrome.checks.length} checks${chrome.agrees ? '' : ' (DISAGREES with the per-check reading)'}`);
      }
    }
  } finally {
    const s = session as { browser: Browser; server: WptServer } | null;
    if (s !== null) {
      await s.browser.close();
      await s.server.close();
    }
  }
  const interop = loadInteropLabels();
  const labelsOf = labelsByPath(interop);
  const tests: Record<string, Entry> = {};
  for (const r of records) {
    const labels = labelsOf.get(r.path);
    tests[r.path] = labels === undefined ? entryOf(r) : { ...entryOf(r), interop: labels };
  }
  return { expectations: { wpt: commit, target: opts.target, profileRevision: PROFILE_REVISIONS[opts.target], tests }, records, manifest, interop, snapshotPaths, reftestLayout };
}

/** "web: P pass of N CSS WPT files (numeric runnable R)" and the report sections behind it. */
export function summarize(result: RunResult): { line: string; markdown: string } {
  const { expectations: e, records, manifest } = result;
  const entries = Object.values(e.tests);
  const count = (f: (x: Entry) => boolean): number => entries.filter(f).length;
  const pass = count((x) => x.status === 'pass');
  const fail = count((x) => x.status === 'fail');
  const runnable = pass + fail;
  const line = `${e.target}: ${pass} pass of ${entries.length} CSS WPT files (numeric runnable ${runnable})`;
  const kinds = countKinds(manifest);
  const numeric = records.filter((r) => r.dragon !== null);
  const ran = numeric.filter((r) => r.dragon !== null && r.dragon.status !== 'not-runnable');
  const checks = (f: (r: TestRecord) => readonly boolean[]): { pass: number; total: number } => {
    const all = ran.flatMap(f);
    return { pass: all.filter((x) => x).length, total: all.length };
  };
  const dragonChecks = checks((r) => (r.dragon !== null && r.dragon.status !== 'not-runnable' ? r.dragon.results.flatMap((s) => s.checks.map((c) => c.pass)) : []));
  const dragonSubtests = checks((r) => (r.dragon !== null && r.dragon.status !== 'not-runnable' ? r.dragon.results.map((s) => s.pass) : []));
  const withChrome = ran.filter((r) => r.chrome !== null);
  const translatedChrome = numeric.filter((r) => r.chrome !== null);
  const agreeing = translatedChrome.filter((r) => r.chrome !== null && r.chrome.agrees).length;
  const chromeChecks = checks((r) => (r.chrome === null ? [] : r.chrome.checks.map((c) => c.pass)));
  const chromeSubtests = checks((r) => (r.chrome === null ? [] : r.chrome.subtests.map((s) => s.pass)));
  const reasons = new Map<string, number>();
  const groups = new Map<string, number>();
  for (const r of numeric) {
    const x = e.tests[r.path];
    if (x === undefined || x.status !== 'not-runnable') continue;
    reasons.set(x.missing, (reasons.get(x.missing) ?? 0) + 1);
    const [code, rest] = [x.missing.slice(0, x.missing.indexOf(':')), x.missing.slice(x.missing.indexOf(':') + 1)];
    const group = code.startsWith('DRAGON_UNSUPPORTED_PROPERTY') || code.startsWith('DRAGON_CSS_INVALID_VALUE') ? `${code}:${rest.split(':')[0]?.trim()}` : code === 'translate' || code === 'assert' || code === 'script' || code === 'snapshot' ? `${code}:${rest.split(':')[0]}` : code;
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  const top = (m: Map<string, number>, n: number): string[] => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([k, v]) => `| \`${k}\` | ${v} |`);
  const perTest = ran.map((r) => {
    const d = r.dragon as Extract<DragonOutcome, { status: 'pass' | 'fail' }>;
    const c = r.chrome;
    return `| ${r.path}${r.origin === 'snapshot' ? ` (snapshot, ${r.fixtures.length} state${r.fixtures.length === 1 ? '' : 's'})` : ''} | ${d.status} ${d.subtests.pass}/${d.subtests.total} subtests, ${d.checks.pass}/${d.checks.total} checks | ${c === null ? 'not run' : `${c.subtests.filter((s) => s.pass).length}/${c.subtests.length} subtests, ${c.checks.filter((x) => x.pass).length}/${c.checks.length} checks${c.agrees ? '' : ' (disagrees)'}`} |`;
  });
  // Script-driven numeric files: the snapshot path.
  const viaSnapshot = numeric.filter((r) => r.origin === 'snapshot');
  const snapshotRefused = viaSnapshot.filter((r) => r.snapshot === null || r.snapshot === undefined || 'refused' in r.snapshot);
  const snapshotStates = viaSnapshot.reduce((n, r) => n + (r.snapshot !== null && r.snapshot !== undefined && !('refused' in r.snapshot) ? r.snapshot.states.length : 0), 0);
  const snapshotRan = viaSnapshot.filter((r) => r.dragon !== null && r.dragon.status !== 'not-runnable');
  const snapshotReasons = new Map<string, number>();
  for (const r of snapshotRefused) {
    const x = e.tests[r.path];
    if (x !== undefined && x.status === 'not-runnable') snapshotReasons.set(x.missing, (snapshotReasons.get(x.missing) ?? 0) + 1);
  }
  const rl = result.reftestLayout;
  const rlEntries = rl === null ? [] : Object.values(rl.tests);
  const rlReasons = new Map<string, number>();
  for (const x of rlEntries) {
    if (x.status !== 'not-runnable') continue;
    const k = x.missing.startsWith('DRAGON_') || x.missing.startsWith('layout-projection') ? x.missing.split(':')[0] as string : x.missing;
    rlReasons.set(k, (rlReasons.get(k) ?? 0) + 1);
  }
  const reftestSection = rl === null ? [] : [
    '',
    '## reftest-layout (experimental, report-only: not in the headline number or the check\'s gate)',
    '',
    `- Reftest files: ${kinds.reftest}; excluded by the static filter: ${Object.values(rl.excluded).reduce((a, b) => a + b, 0)}; candidates: ${rlEntries.length}.`,
    `- Candidates with a verdict: ${rlEntries.filter((x) => x.status !== 'not-runnable').length}; pass ${rlEntries.filter((x) => x.status === 'pass').length}, fail ${rlEntries.filter((x) => x.status === 'fail').length}.`,
    '',
    '| excluded by the static filter | files |',
    '|---|---:|',
    ...top(new Map(Object.entries(rl.excluded)), 12),
    '',
    '| candidate without a verdict (grouped) | files |',
    '|---|---:|',
    ...top(rlReasons, 12),
    '',
    '| reftest-layout file | verdict |',
    '|---|---|',
    ...Object.entries(rl.tests).filter(([, x]) => x.status !== 'not-runnable').map(([p, x]) => (x.status === 'not-runnable' ? '' : `| ${p} | ${x.status} (${x.differingPixels} px differ; geometry ${x.geometry.match}/${x.geometry.total}) |`)),
  ];
  const markdown = [
    `# WPT ${e.target} summary`,
    '',
    line,
    '',
    `WPT commit \`${e.wpt}\`, ${e.target} profile ${e.profileRevision}.`,
    '',
    '| kind | files |',
    '|---|---:|',
    ...TEST_KINDS.map((k) => `| ${k} | ${kinds[k]} |`),
    `| **total** | **${manifest.length}** |`,
    '',
    `- Numeric (check-layout) files: ${numeric.length}; runnable for ${e.target}: ${runnable}; Dragon pass ${pass}, fail ${fail}.`,
    `- Dragon on the runnable files: ${dragonSubtests.pass}/${dragonSubtests.total} subtests, ${dragonChecks.pass}/${dragonChecks.total} checks.`,
    `- Script-driven numeric files (snapshot path: the original page runs in Chrome 145, each checkLayout call's DOM state is a case): ${viaSnapshot.length}; refused by the snapshot path: ${snapshotRefused.length}; snapshotted: ${viaSnapshot.length - snapshotRefused.length} with ${snapshotStates} states; runnable: ${snapshotRan.length} (pass ${snapshotRan.filter((r) => r.dragon?.status === 'pass').length}, fail ${snapshotRan.filter((r) => r.dragon?.status === 'fail').length}).`,
    `- Chrome 145 on the same files (original WPT pages, ${withChrome.length} of ${ran.length} run): ${chromeSubtests.pass}/${chromeSubtests.total} subtests, ${chromeChecks.pass}/${chromeChecks.total} checks.`,
    `- Translator cross-check: on ${translatedChrome.length} translated numeric files run in Chrome, the harness's own subtests equal the translated checks read in the same page for ${agreeing}.`,
    ...(translatedChrome.length > ran.length
      ? [`- Chrome 145 on all ${translatedChrome.length} translated numeric files (informational): ${translatedChrome.flatMap((r) => (r.chrome as ChromeOutcome).subtests).filter((x) => x.pass).length}/${translatedChrome.flatMap((r) => (r.chrome as ChromeOutcome).subtests).length} subtests, ${translatedChrome.flatMap((r) => (r.chrome as ChromeOutcome).checks).filter((x) => x.pass).length}/${translatedChrome.flatMap((r) => (r.chrome as ChromeOutcome).checks).length} checks; ${translatedChrome.filter((r) => (r.chrome as ChromeOutcome).subtests.every((x) => x.pass) && (r.chrome as ChromeOutcome).harness === 0).length} files pass every subtest.`]
      : []),
    '',
    '| runnable file | Dragon | Chrome |',
    '|---|---|---|',
    ...perTest,
    '',
    '## Snapshot path refusals (script-driven numeric files)',
    '',
    '| reason | files |',
    '|---|---:|',
    ...top(snapshotReasons, 30),
    '',
    '## Top not-runnable reasons (numeric files, grouped)',
    '',
    '| reason | files |',
    '|---|---:|',
    ...top(groups, 20),
    '',
    '## Top not-runnable reasons (numeric files, exact first diagnostic or refusal)',
    '',
    '| reason | files |',
    '|---|---:|',
    ...top(reasons, 20),
    '',
    ...interopMarkdown(e, result.interop),
    ...reftestSection,
  ].join('\n');
  return { line, markdown };
}

/** Writes each translated fixture (with its WPT source and commit in the sheet header) and its checks sidecar for debugging. */
export function writeGenerated(records: readonly TestRecord[]): void {
  for (const r of records) {
    r.fixtures.forEach((f, i) => {
      const base = packagePath(`generated/${r.path.replace(/\.[^./]+$/, '')}${r.fixtures.length > 1 ? `.state-${i}` : ''}`);
      mkdirSync(dirname(base), { recursive: true });
      writeFileSync(`${base}.html`, f.html);
      writeFileSync(`${base}.checks.json`, `${JSON.stringify(f.sidecar, null, 2)}\n`);
    });
  }
}
