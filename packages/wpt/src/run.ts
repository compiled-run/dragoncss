// Every CSS WPT test file for a target: its kind from the manifest, Dragon's result for numeric tests, and, when asked, Chrome's
// result on the same checks from the original file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { webProfile } from 'dragon';
import type { ChromeOutcome } from './chrome.ts';
import { launchChrome, runInChrome, serveWpt } from './chrome.ts';
import type { DragonOutcome, NumericRun, Target } from './dragon.ts';
import { runNumeric } from './dragon.ts';
import type { ChromeCount, Entry, Expectations } from './expectations.ts';
import type { InteropLabels } from './interop.ts';
import { interopMarkdown, labelsByPath, loadInteropLabels } from './interop.ts';
import type { ManifestEntry, TestKind } from './manifest.ts';
import { buildManifest, countKinds, TEST_KINDS } from './manifest.ts';
import { lockedCommit, packagePath, pinnedWptDir } from './paths.ts';

export type TestRecord = {
  readonly path: string;
  readonly kind: TestKind;
  readonly dragon: DragonOutcome | null;
  readonly fixture: NumericRun['fixture'];
  readonly chrome: ChromeOutcome | null;
};

export type RunResult = {
  readonly expectations: Expectations;
  readonly records: readonly TestRecord[];
  readonly manifest: readonly ManifestEntry[];
  readonly interop: InteropLabels;
};

export const PROFILE_REVISIONS: Readonly<Record<Target, string>> = { web: webProfile.revision };

export type RunOptions = {
  readonly target: Target;
  readonly filter: string | null;
  /** 'runnable': Chrome on the files Dragon runs (what expectations need); 'translated': also every other translated numeric file. */
  readonly chrome: 'none' | 'runnable' | 'translated';
  readonly log?: (line: string) => void;
};

/** The Dragon side of one numeric test file in the WPT copy. */
export function runDragonTest(wpt: string, path: string, commit: string, target: Target, source: string = readFileSync(join(wpt, path), 'utf8')): NumericRun {
  const readWpt = (p: string): string | null => {
    try {
      return readFileSync(join(wpt, p), 'utf8');
    } catch {
      return null;
    }
  };
  return runNumeric(path, source, commit, target, readWpt);
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
  for (const e of manifest) {
    if (e.kind !== 'numeric') {
      records.push({ path: e.path, kind: e.kind, dragon: null, fixture: null, chrome: null });
      continue;
    }
    const run = runDragonTest(wpt, e.path, commit, opts.target);
    records.push({ path: e.path, kind: e.kind, dragon: run.outcome, fixture: run.fixture, chrome: null });
  }
  if (opts.chrome !== 'none') {
    const runnable = records.filter((r) => r.fixture !== null && (opts.chrome === 'translated' || (r.dragon !== null && r.dragon.status !== 'not-runnable')));
    const server = await serveWpt(wpt);
    const browser = await launchChrome();
    try {
      for (const r of runnable) {
        const chrome = await runInChrome(browser, server.origin, (r.fixture as NonNullable<NumericRun['fixture']>).sidecar);
        records[records.indexOf(r)] = { ...r, chrome };
        log(`chrome ${r.path}: harness ${chrome.harness}, ${chrome.checks.filter((c) => c.pass).length}/${chrome.checks.length} checks${chrome.agrees ? '' : ' (DISAGREES with the per-check reading)'}`);
      }
    } finally {
      await browser.close();
      await server.close();
    }
  }
  const interop = loadInteropLabels();
  const labelsOf = labelsByPath(interop);
  const tests: Record<string, Entry> = {};
  for (const r of records) {
    const labels = labelsOf.get(r.path);
    tests[r.path] = labels === undefined ? entryOf(r) : { ...entryOf(r), interop: labels };
  }
  return { expectations: { wpt: commit, target: opts.target, profileRevision: PROFILE_REVISIONS[opts.target], tests }, records, manifest, interop };
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
    const group = code.startsWith('DRAGON_UNSUPPORTED_PROPERTY') || code.startsWith('DRAGON_CSS_INVALID_VALUE') ? `${code}:${rest.split(':')[0]?.trim()}` : code === 'translate' || code === 'assert' ? `${code}:${rest.split(':')[0]}` : code;
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  const top = (m: Map<string, number>, n: number): string[] => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([k, v]) => `| \`${k}\` | ${v} |`);
  const perTest = ran.map((r) => {
    const d = r.dragon as Extract<DragonOutcome, { status: 'pass' | 'fail' }>;
    const c = r.chrome;
    return `| ${r.path} | ${d.status} ${d.subtests.pass}/${d.subtests.total} subtests, ${d.checks.pass}/${d.checks.total} checks | ${c === null ? 'not run' : `${c.subtests.filter((s) => s.pass).length}/${c.subtests.length} subtests, ${c.checks.filter((x) => x.pass).length}/${c.checks.length} checks${c.agrees ? '' : ' (disagrees)'}`} |`;
  });
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
  ].join('\n');
  return { line, markdown };
}

/** Writes each translated fixture (with its WPT source and commit in the sheet header) and its checks sidecar for debugging. */
export function writeGenerated(records: readonly TestRecord[]): void {
  for (const r of records) {
    if (r.fixture === null) continue;
    const base = packagePath(`generated/${r.path.replace(/\.[^./]+$/, '')}`);
    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(`${base}.html`, r.fixture.html);
    writeFileSync(`${base}.checks.json`, `${JSON.stringify(r.fixture.sidecar, null, 2)}\n`);
  }
}
