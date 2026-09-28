import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Entry, Expectations } from '../src/expectations.ts';
import { compareExpectations, DEVIATION_IDS, expectationsPath, failEntryProblems, mergeExpectations, readExpectations, readRunForUpdate, serializeExpectations, TODO } from '../src/expectations.ts';
import { labelsByPath, loadInteropLabels } from '../src/interop.ts';
import { buildManifest, countKinds, isTestFile, kindOf, testFilePaths } from '../src/manifest.ts';
import { lockedCommit, pinnedWptDir, REPO_ROOT, vendoredCommit } from '../src/paths.ts';
import { entryOf, PROFILE_REVISIONS, runDragonTest } from '../src/run.ts';

const wpt = pinnedWptDir();
const committed = readExpectations(expectationsPath('web'));
const committedText = readFileSync(expectationsPath('web'), 'utf8');
const manifest = buildManifest(wpt);
const CANDIDATE = 'css/css-flexbox/flexbox-lines-must-be-stretched-by-default.html';
/** Chrome's counts for a file whose checks are also its subtests. */
const CHROME = (pass: number, total: number, alsoFails: number) => ({ harness: 0, subtests: { pass, total }, checks: { pass, total }, alsoFails });

describe('manifest', () => {
  it('lists every test file under css/ once, sorted, with its kind', () => {
    const paths = manifest.map((e) => e.path);
    expect(paths).toEqual([...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(paths).size).toBe(paths.length);
    // Every test-shaped file is in the manifest unless it is a harness-less page without rel=help (not a test).
    const listed = new Set(paths);
    const dropped = testFilePaths(wpt).filter((p) => !listed.has(p));
    for (const p of dropped) expect(kindOf(p, readFileSync(join(wpt, p), 'utf8'))).toBeNull();
    expect(manifest.length + dropped.length).toBe(testFilePaths(wpt).length);
    // The scout's count at this commit (classify.py --all).
    expect(countKinds(manifest)).toEqual({ numeric: 1138, 'testharness-other': 6609, reftest: 25145, crashtest: 1208, manual: 368, other: 3586 });
    expect(manifest.length).toBe(38054);
  });

  it('classifies by the scout rules', () => {
    expect(isTestFile('support/a.html')).toBe(false);
    expect(isTestFile('a-ref.html')).toBe(false);
    expect(isTestFile('a.any.js')).toBe(true);
    expect(kindOf('css/a/x-manual.html', '')).toBe('manual');
    expect(kindOf('css/a/crashtests/x.html', '')).toBe('crashtest');
    expect(kindOf('css/a/x.html', '<link rel="match" href="r.html">')).toBe('reftest');
    expect(kindOf('css/a/x.html', 'testharness.js check-layout-th.js')).toBe('numeric');
    expect(kindOf('css/a/x.html', 'testharness.js <div data-offset-x=1>')).toBe('numeric');
    expect(kindOf('css/a/x.html', 'testharness.js')).toBe('testharness-other');
    expect(kindOf('css/a/x.html', '<link rel=help href=x>')).toBe('other');
    expect(kindOf('css/a/x.html', '<p>')).toBeNull();
  });
});

describe('committed expectations (expectations/web.json)', () => {
  it('pins the locked WPT commit, which the WPT copy is at, and the web profile revision', () => {
    expect(committed.wpt).toBe(lockedCommit());
    expect(vendoredCommit(wpt)).toBe(lockedCommit());
    expect(committed.target).toBe('web');
    expect(committed.profileRevision).toBe(PROFILE_REVISIONS.web);
  });

  it('lists every manifest file and nothing else, deterministically', () => {
    expect(Object.keys(committed.tests)).toEqual(manifest.map((e) => e.path));
    expect(serializeExpectations(committed)).toBe(committedText);
    expect(committedText).not.toMatch(/"(time|duration|ms|elapsed)"/);
    for (const e of manifest) {
      const { interop: _labels, ...x } = committed.tests[e.path] as Entry;
      if (e.kind !== 'numeric') expect(x).toEqual({ status: 'not-runnable', missing: `kind:${e.kind}` });
    }
  });

  it('every fail entry has a real reason and a deviation id that resolves, or an issue', () => {
    for (const [p, x] of Object.entries(committed.tests)) {
      if (x.status === 'fail') expect(failEntryProblems(p, x)).toEqual([]);
    }
    expect(committedText).not.toContain(`"reason":"${TODO}"`);
  });
});

describe('the check and the update merge', () => {
  const base: Expectations = { wpt: 'w', target: 'web', profileRevision: 'r', tests: {
    'a.html': { status: 'pass', subtests: { pass: 2, total: 2 }, chrome: null },
    'b.html': { status: 'fail', subtests: { pass: 0, total: 1 }, checks: { pass: 0, total: 1 }, chrome: CHROME(0, 1, 1), reason: 'spec 51, Dragon 50', deviation: 'half-leading-floor' },
    'c.html': { status: 'not-runnable', missing: 'kind:reftest' },
  } };
  const withTests = (tests: Record<string, Entry>): Expectations => ({ ...base, tests: { ...base.tests, ...tests } });

  it('fails on an unexpected pass, an unexpected fail, a status change, a subtest change and added or removed files', () => {
    expect(compareExpectations(base, base)).toEqual([]);
    expect(compareExpectations(base, withTests({ 'b.html': { status: 'pass', subtests: { pass: 1, total: 1 }, chrome: null } }))[0]).toMatch(/^b\.html: unexpected pass/);
    const failA: Entry = { status: 'fail', subtests: { pass: 1, total: 2 }, checks: { pass: 1, total: 2 }, chrome: null, reason: 'x' };
    expect(compareExpectations(base, withTests({ 'a.html': failA }))[0]).toMatch(/^a\.html: unexpected fail/);
    expect(compareExpectations(base, withTests({ 'c.html': { status: 'pass', subtests: { pass: 1, total: 1 }, chrome: null } }))[0]).toMatch(/^c\.html: became runnable/);
    expect(compareExpectations(base, withTests({ 'a.html': { status: 'not-runnable', missing: 'x' } }))[0]).toMatch(/^a\.html: became not-runnable/);
    expect(compareExpectations(base, withTests({ 'a.html': { status: 'pass', subtests: { pass: 3, total: 3 }, chrome: null } }))[0]).toMatch(/^a\.html: subtests changed/);
    expect(compareExpectations(base, withTests({ 'd.html': { status: 'not-runnable', missing: 'kind:manual' } }))[0]).toMatch(/^d\.html: new test file/);
    const { 'c.html': _gone, ...rest } = base.tests;
    expect(compareExpectations(base, { ...base, tests: rest })[0]).toMatch(/^c\.html: in the expectations but no longer/);
    expect(compareExpectations(base, { ...base, wpt: 'v' })[0]).toMatch(/^WPT commit/);
  });

  it('rejects a TODO reason, an unknown deviation, and a classification its Chrome result contradicts', () => {
    const f = base.tests['b.html'] as Extract<Entry, { status: 'fail' }>;
    expect(DEVIATION_IDS.has('half-leading-floor')).toBe(true);
    expect(failEntryProblems('b', f)).toEqual([]);
    expect(failEntryProblems('b', { ...f, reason: TODO })[0]).toMatch(/needs a reason/);
    expect(failEntryProblems('b', { ...f, deviation: 'no-such-deviation' })[0]).toMatch(/not a Chrome deviation id/);
    const { deviation: _d, ...noDeviation } = f;
    expect(failEntryProblems('b', { ...noDeviation, issue: 'dragon#1' })[0]).toMatch(/Chrome also fails 1 .* deviation id is required/);
    expect(failEntryProblems('b', { ...f, chrome: CHROME(1, 1, 0) })[0]).toMatch(/Chrome passes 1 .* Dragon issue is required/);
  });

  it('update keeps fail reasons, never turns a fail entry into a pass, and gives a new failure the TODO placeholder', () => {
    const run = withTests({
      'a.html': { status: 'fail', subtests: { pass: 1, total: 2 }, checks: { pass: 1, total: 2 }, chrome: CHROME(2, 2, 0), reason: 'machine' },
      'b.html': { status: 'pass', subtests: { pass: 1, total: 1 }, chrome: null },
    });
    const merged = mergeExpectations(base, run);
    expect(merged.tests['a.html']).toEqual({ status: 'fail', subtests: { pass: 1, total: 2 }, checks: { pass: 1, total: 2 }, chrome: CHROME(2, 2, 0), reason: TODO });
    expect(merged.tests['b.html']).toEqual(base.tests['b.html']);
    expect(compareExpectations(merged, run).some((p) => p.startsWith('a.html: fail entry needs a reason'))).toBe(true);
    expect(compareExpectations(merged, run).some((p) => p.startsWith('b.html: unexpected pass'))).toBe(true);
  });
  it('update reports a missing, unreadable, filtered, Chrome-less, other-target or stale run file as a problem instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dragon-wpt-update-'));
    const write = (name: string, body: unknown) => {
      const file = join(dir, name);
      writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
      return file;
    };
    const good = { wpt: 'w', target: 'web', filter: null, chrome: 'runnable', expectations: base };
    expect(readRunForUpdate(write('good.json', good), 'web', 'w')).toEqual({ run: good });
    const problem = (file: string, locked = 'w') => {
      const r = readRunForUpdate(file, 'web', locked);
      return 'problem' in r ? r.problem : null;
    };
    expect(problem(join(dir, 'absent.json'))).toMatch(/^no .*absent\.json: run pnpm wpt:run --target web first$/);
    expect(problem(write('truncated.json', '{"wpt": "w", "expec'))).toMatch(/is not readable JSON/);
    expect(problem(write('empty.json', {}))).toMatch(/has no expectations/);
    expect(problem(write('filtered.json', { ...good, filter: 'css/css-flexbox' }))).toMatch(/is a filtered run \(css\/css-flexbox\)/);
    expect(problem(write('nochrome.json', { ...good, chrome: 'none' }))).toMatch(/was run with --no-chrome/);
    expect(problem(write('stale.json', good), 'v')).toMatch(/is at WPT w, packages\/wpt\/wpt\.lock pins v/);
    expect(problem(write('other.json', { ...good, expectations: { ...base, target: 'ios' } }))).toMatch(/is a ios run, not web/);
  });
});

describe('planted faults', () => {
  it('altering a data-expected value in a passing WPT test makes the recomputed result differ from the expectations', () => {
    const source = readFileSync(join(wpt, CANDIDATE), 'utf8');
    const planted = source.replace('data-expected-height=51', 'data-expected-height=53');
    expect(planted).not.toBe(source);
    const clean = runDragonTest(wpt, CANDIDATE, lockedCommit(), 'web', source);
    const faulty = runDragonTest(wpt, CANDIDATE, lockedCommit(), 'web', planted);
    const record = (dragon: typeof clean) => ({ path: CANDIDATE, kind: 'numeric' as const, dragon: dragon.outcome, fixture: dragon.fixture, chrome: null });
    const labels = labelsByPath(loadInteropLabels()).get(CANDIDATE);
    const actual = (e: Entry): Expectations => ({ ...committed, tests: { [CANDIDATE]: labels === undefined ? e : { ...e, interop: labels } } });
    expect(compareExpectations(committed, actual(entryOf(record(clean))), CANDIDATE)).toEqual([]);
    const problems = compareExpectations(committed, actual(entryOf(record(faulty))), CANDIDATE);
    expect(problems).toEqual([`${CANDIDATE}: unexpected fail: expected pass 1/1, got fail 0/1`]);
  });

  it('pnpm wpt:check exits non-zero when an expected value in the expectations file is altered', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dragon-wpt-planted-'));
    const check = (tests: Record<string, Entry>) => {
      const file = join(dir, `${Object.keys(tests).length}-${JSON.stringify(tests).length}.json`);
      writeFileSync(file, serializeExpectations({ ...committed, tests: { ...committed.tests, ...tests } }));
      return spawnSync(process.execPath, ['--conditions=dragon-internal', join(REPO_ROOT, 'packages/wpt/src/cli/check.ts'), '--target', 'web', '--filter', CANDIDATE, '--expectations', file], { encoding: 'utf8', env: process.env });
    };
    const ok = check({});
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    const altered = check({ [CANDIDATE]: { status: 'pass', subtests: { pass: 2, total: 2 }, chrome: null } });
    expect(altered.status).toBe(1);
    expect(altered.stderr).toContain(`${CANDIDATE}: subtests changed: expected pass 2/2, got pass 1/1`);
    const listedFail = check({ [CANDIDATE]: { status: 'fail', subtests: { pass: 0, total: 1 }, checks: { pass: 1, total: 2 }, chrome: CHROME(2, 2, 0), reason: 'planted', issue: 'planted' } });
    expect(listedFail.status).toBe(1);
    expect(listedFail.stderr).toContain(`${CANDIDATE}: unexpected pass`);
  });
});
