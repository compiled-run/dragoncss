// The per-target expectations file: one entry per CSS WPT test file, pinned to the WPT commit, sorted, without timings.
// wpt:check fails on any difference from a recomputed run; the update merge never rewrites an existing fail entry's reason.
import { existsSync, readFileSync } from 'node:fs';
import { chromeDeviations, dprChromeDeviations } from '@dragon/layout';
import type { Target } from './dragon.ts';
import { packagePath } from './paths.ts';

export type Count = { readonly pass: number; readonly total: number };
/**
 * Chrome 145 on the original page: the harness status (0 is OK), its subtests, the same checks Dragon ran, and how many of the
 * checks Dragon fails Chrome fails too.
 */
export type ChromeCount = { readonly harness: number; readonly subtests: Count; readonly checks: Count; readonly alsoFails: number };

/** interop: the Interop focus-area labels of the file (interop-labels.json), sorted; absent when it has none. */
export type Entry = (
  | { readonly status: 'pass'; readonly subtests: Count; readonly chrome: ChromeCount | null }
  | {
      readonly status: 'fail';
      readonly subtests: Count;
      readonly checks: Count;
      readonly chrome: ChromeCount | null;
      readonly reason: string;
      /** A Chrome deviation id (packages/layout/src/chrome-deviations*.ts), required when Chrome fails a check Dragon fails. */
      readonly deviation?: string;
      /** A Dragon issue, required when Chrome passes a check Dragon fails. */
      readonly issue?: string;
    }
  | { readonly status: 'not-runnable'; readonly missing: string }
) & { readonly interop?: readonly string[] };

export type Expectations = {
  readonly wpt: string;
  readonly target: Target;
  readonly profileRevision: string;
  readonly tests: { readonly [path: string]: Entry };
};

/** The placeholder a new failure gets; wpt:check rejects it until a person names the reason and the deviation or issue. */
export const TODO = 'TODO';

export const DEVIATION_IDS: ReadonlySet<string> = new Set([...chromeDeviations.map((d) => d.id), ...dprChromeDeviations.map((d) => d.id)]);

export const expectationsPath = (target: Target): string => packagePath(`expectations/${target}.json`);

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
};

/** Deterministic text: sorted keys everywhere, one test per line. */
export function serializeExpectations(e: Expectations): string {
  const paths = Object.keys(e.tests).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lines = paths.map((p, i) => `    ${JSON.stringify(p)}: ${JSON.stringify(sortKeys(e.tests[p]))}${i === paths.length - 1 ? '' : ','}`);
  return `{\n  "profileRevision": ${JSON.stringify(e.profileRevision)},\n  "target": ${JSON.stringify(e.target)},\n  "tests": {\n${lines.join('\n')}\n  },\n  "wpt": ${JSON.stringify(e.wpt)}\n}\n`;
}

export function readExpectations(file: string): Expectations {
  return JSON.parse(readFileSync(file, 'utf8')) as Expectations;
}

/** Problems with one fail entry on its own: its reason, and the deviation or issue its Chrome result calls for. */
export function failEntryProblems(path: string, e: Extract<Entry, { status: 'fail' }>): string[] {
  const out: string[] = [];
  if (e.reason.trim() === '' || e.reason === TODO) out.push(`${path}: fail entry needs a reason (got ${JSON.stringify(e.reason)})`);
  if (e.deviation === undefined && e.issue === undefined) out.push(`${path}: fail entry needs a deviation or an issue`);
  if (e.deviation !== undefined && !DEVIATION_IDS.has(e.deviation)) out.push(`${path}: deviation ${JSON.stringify(e.deviation)} is not a Chrome deviation id`);
  if (e.issue !== undefined && (e.issue.trim() === '' || e.issue === TODO)) out.push(`${path}: issue ${JSON.stringify(e.issue)} is a placeholder`);
  if (e.chrome === null) out.push(`${path}: fail entry has no Chrome result on the same checks`);
  else {
    const dragonFails = e.checks.total - e.checks.pass;
    if (e.chrome.checks.total !== e.checks.total) out.push(`${path}: Chrome read ${e.chrome.checks.total} checks, Dragon ${e.checks.total}`);
    if (e.chrome.alsoFails > 0 && e.deviation === undefined) out.push(`${path}: Chrome also fails ${e.chrome.alsoFails} of the checks Dragon fails, so a Chrome deviation id is required`);
    if (dragonFails - e.chrome.alsoFails > 0 && e.issue === undefined) out.push(`${path}: Chrome passes ${dragonFails - e.chrome.alsoFails} of the checks Dragon fails, so a Dragon issue is required`);
  }
  return out;
}

const describe = (e: Entry | undefined): string => (e === undefined ? 'absent' : e.status === 'not-runnable' ? `not-runnable (${e.missing})` : `${e.status} ${e.subtests.pass}/${e.subtests.total}`);

/**
 * Every difference between the committed expectations and a recomputed run, plus every invalid fail entry. filter limits the
 * comparison to paths starting with it (tests only; the published check runs without one).
 */
export function compareExpectations(expected: Expectations, actual: Expectations, filter: string | null = null): string[] {
  const out: string[] = [];
  if (expected.wpt !== actual.wpt) out.push(`WPT commit: expectations pin ${expected.wpt}, the run is at ${actual.wpt}`);
  if (expected.target !== actual.target) out.push(`target: expectations are for ${expected.target}, the run is ${actual.target}`);
  if (expected.profileRevision !== actual.profileRevision) out.push(`profile revision: expectations ${expected.profileRevision}, the run ${actual.profileRevision}`);
  const inScope = (p: string): boolean => filter === null || p.startsWith(filter);
  const paths = [...new Set([...Object.keys(expected.tests), ...Object.keys(actual.tests)])].filter(inScope).sort();
  for (const p of paths) {
    const e = expected.tests[p];
    const a = actual.tests[p];
    if (e !== undefined && e.status === 'fail') out.push(...failEntryProblems(p, e));
    if (e === undefined) {
      out.push(`${p}: new test file, not in the expectations (${describe(a)})`);
      continue;
    }
    if (a === undefined) {
      out.push(`${p}: in the expectations but no longer in the WPT copy`);
      continue;
    }
    if (e.status !== a.status) {
      const what = e.status === 'fail' && a.status === 'pass' ? 'unexpected pass'
        : a.status === 'fail' ? 'unexpected fail'
        : e.status === 'not-runnable' ? 'became runnable'
        : a.status === 'not-runnable' ? 'became not-runnable' : 'changed status';
      out.push(`${p}: ${what}: expected ${describe(e)}, got ${describe(a)}`);
      continue;
    }
    if (e.status === 'not-runnable' && a.status === 'not-runnable' && e.missing !== a.missing) out.push(`${p}: not-runnable reason changed: expected ${JSON.stringify(e.missing)}, got ${JSON.stringify(a.missing)}`);
    if (e.status !== 'not-runnable' && a.status !== 'not-runnable' && (e.subtests.pass !== a.subtests.pass || e.subtests.total !== a.subtests.total)) {
      out.push(`${p}: subtests changed: expected ${describe(e)}, got ${describe(a)}`);
    }
    if (e.status === 'fail' && a.status === 'fail' && (e.checks.pass !== a.checks.pass || e.checks.total !== a.checks.total)) {
      out.push(`${p}: checks changed: expected ${e.checks.pass}/${e.checks.total}, got ${a.checks.pass}/${a.checks.total}`);
    }
    if (JSON.stringify(e.interop ?? []) !== JSON.stringify(a.interop ?? [])) out.push(`${p}: Interop labels changed: expected ${JSON.stringify(e.interop ?? [])}, got ${JSON.stringify(a.interop ?? [])}`);
  }
  return out;
}

/**
 * The update merge: pass and not-runnable entries are rewritten from the run; an existing fail entry is kept with its reason,
 * deviation and issue (its counts follow the run while it still fails); a new failure gets the TODO placeholder.
 */
export function mergeExpectations(previous: Expectations | null, run: Expectations): Expectations {
  const tests: Record<string, Entry> = {};
  for (const [p, a] of Object.entries(run.tests)) {
    const e = previous === null ? undefined : previous.tests[p];
    const interop = a.interop === undefined ? {} : { interop: a.interop };
    if (e !== undefined && e.status === 'fail') {
      if (a.status === 'fail') {
        const kept: Entry = { status: 'fail', subtests: a.subtests, checks: a.checks, chrome: a.chrome, reason: e.reason };
        tests[p] = { ...kept, ...(e.deviation === undefined ? {} : { deviation: e.deviation }), ...(e.issue === undefined ? {} : { issue: e.issue }), ...interop };
      } else tests[p] = e;
      continue;
    }
    tests[p] = a.status === 'fail' ? { status: 'fail', subtests: a.subtests, checks: a.checks, chrome: a.chrome, reason: TODO, ...interop } : a;
  }
  return { wpt: run.wpt, target: run.target, profileRevision: run.profileRevision, tests };
}

/** The part of a wpt:run output (out/<target>.json) the update merge reads. */
export type RunOutput = { readonly wpt: string; readonly target: Target; readonly filter: string | null; readonly chrome: string; readonly snapshots?: string; readonly reftestLayout?: boolean; readonly expectations: Expectations };

/** Reads a wpt:run output for the update merge, or says in one line why it can't be used (missing, unreadable, filtered, no Chrome, stale commit). */
export function readRunForUpdate(runFile: string, target: Target, locked: string): { readonly run: RunOutput } | { readonly problem: string } {
  if (!existsSync(runFile)) return { problem: `no ${runFile}: run pnpm wpt:run --target ${target} first` };
  let run: RunOutput;
  try {
    run = JSON.parse(readFileSync(runFile, 'utf8')) as RunOutput;
  } catch (e) {
    return { problem: `${runFile} is not readable JSON (${(e as Error).message}): run pnpm wpt:run --target ${target} again` };
  }
  if (run === null || typeof run !== 'object' || run.expectations === undefined || typeof run.expectations.tests !== 'object') {
    return { problem: `${runFile} has no expectations: run pnpm wpt:run --target ${target} again` };
  }
  if (run.expectations.target !== target) return { problem: `${runFile} is a ${run.expectations.target} run, not ${target}` };
  if (run.filter !== null) return { problem: `${runFile} is a filtered run (${run.filter}); expectations are updated only from a full run` };
  if (run.chrome === 'none') return { problem: `${runFile} was run with --no-chrome; failures need Chrome's result on the same checks` };
  if (run.wpt !== locked) return { problem: `${runFile} is at WPT ${run.wpt}, packages/wpt/wpt.lock pins ${locked}` };
  return { run };
}
