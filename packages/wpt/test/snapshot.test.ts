import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, WptServer } from '../src/chrome.ts';
import { launchChrome, serveWpt } from '../src/chrome.ts';
import { runTranslation } from '../src/dragon.ts';
import { lockedCommit, PACKAGE_DIR, pinnedWptDir } from '../src/paths.ts';
import { runDragonTest, runSnapshotTest } from '../src/run.ts';
import type { SnapshotFile, SnapshotNode, SnapshotState } from '../src/snapshot.ts';
import { captureSnapshot, chromeFromSnapshot, decodeStates, encodeStates, flatten, needsSnapshot, NO_SNAPSHOT_FAULTS, parseSnapshot, resultOf, serializeSnapshot, sha256, snapshotProblem, translateSnapshot } from '../src/snapshot.ts';
import { translate } from '../src/translate.ts';

const wpt = pinnedWptDir();
const commit = lockedCommit();
const DATA = resolve(PACKAGE_DIR, 'test/data');
/** The synthetic pages are served at this WPT-like path so they load WPT's own /resources/ harness. */
const PREFIX = 'css/dragon-test/';
const source = (name: string): string => readFileSync(join(DATA, 'snapshot', name), 'utf8');
const pathOf = (name: string): string => `${PREFIX}snapshot/${name}`;

// An offline snapshot: .c > #t, where a script set style="width: 50px" and the check expects 50.
const HEAD: SnapshotNode = { t: 'head', a: [], c: [{ t: 'style', a: [], c: ['.box { width: 10px; height: 10px; }'] }] };
const target = (style: string | null): SnapshotNode => ({
  t: 'div',
  a: [['id', 't'], ['class', 'box'], ['data-expected-width', '50'], ...(style === null ? [] : [['style', style] as const])],
  c: [], v: { width: 50 },
});
const tree = (style: string | null): SnapshotNode => ({
  t: 'html', a: [], c: [HEAD, { t: 'body', a: [], c: [{ t: 'div', a: [['class', 'c']], c: [target(style)] }] }],
});
const file = (states: readonly SnapshotState[], src = 'x'): SnapshotFile => ({
  source: 'css/x/case.html', wpt: commit, chrome: '145', sha256: sha256(src),
  result: { states, harness: { status: 0, tests: states.map((s, i) => ({ name: `${s.call} ${i + 1}`, pass: true })) } },
});

describe('snapshot path, offline', () => {
  it('script logic, helper scripts and handler attributes send a test down the snapshot path', () => {
    expect(needsSnapshot('translate:script')).toBe(true);
    expect(needsSnapshot('translate:script-src:style-change.js')).toBe(true);
    expect(needsSnapshot('translate:event-attribute')).toBe(true);
    expect(needsSnapshot('translate:no-checklayout')).toBe(false);
  });

  it('a snapshot with the script-set inline style passes; PLANTED: the same snapshot missing that style fails', () => {
    const run = (style: string | null) => runSnapshotTest(wpt, 'css/x/case.html', commit, 'web', file([{ call: '.c', matched: 1, tree: tree(style) }]), 'x').outcome;
    const good = run('width: 50px;');
    expect(good.status).toBe('pass');
    const planted = run(null);
    expect(planted.status).toBe('fail');
    if (planted.status !== 'fail') throw new Error('unreachable');
    expect(planted.results[0]?.checks[0]).toMatchObject({ actual: 10, pass: false, check: { attribute: 'width', expected: '50' } });
  });

  it('the lifted inline style becomes a class rule in the fixture, and each state is its own case numbered across calls', () => {
    const states: SnapshotState[] = [{ call: '.c', matched: 1, tree: tree('width: 50px;') }, { call: '.c', matched: 1, tree: tree('width: 50px;') }];
    const ts = translateSnapshot('css/x/case.html', states, commit, () => null);
    const [a, b] = ts.map((t) => {
      if (t.kind !== 'fixture') throw new Error(t.missing);
      return t;
    });
    expect(a?.id).toBe('wpt/css/x/case.html.state-0');
    expect(b?.id).toBe('wpt/css/x/case.html.state-1');
    expect(a?.html).toContain('.wpt-inline-0 { width: 50px; }');
    expect([a?.sidecar.subtests[0]?.name, b?.sidecar.subtests[0]?.name]).toEqual(['.c 1', '.c 2']);
    expect(runTranslation(a as NonNullable<typeof a>, 'web').outcome.status).toBe('pass');
    const chrome = chromeFromSnapshot(file(states).result as Extract<SnapshotFile['result'], { states: unknown }>, [a, b].map((t) => (t as NonNullable<typeof a>).sidecar));
    expect(chrome.agrees).toBe(true);
    expect(chrome.checks.map((c) => c.actual)).toEqual([50, 50]);
  });

  it('a missing, stale or refused snapshot is not runnable with a precise reason', () => {
    expect(snapshotProblem(null, 'x', commit)).toBe('snapshot:missing');
    expect(snapshotProblem(file([]), 'changed', commit)).toBe('snapshot:stale');
    expect(snapshotProblem({ ...file([]), wpt: 'other' }, 'x', commit)).toBe('snapshot:stale');
    const refused: SnapshotFile = { ...file([]), result: { refused: 'script:timing:setTimeout', flags: ['script:timing:setTimeout'] } };
    expect(runSnapshotTest(wpt, 'css/x/case.html', commit, 'web', refused, 'x').outcome).toEqual({ status: 'not-runnable', missing: 'script:timing:setTimeout' });
    expect(runSnapshotTest(wpt, 'css/x/case.html', commit, 'web', null, 'x').outcome).toEqual({ status: 'not-runnable', missing: 'snapshot:missing' });
  });

  it('raw captures are refused in a fixed order: flags, harness, no call, other subtests, quirks, scroll, animation', () => {
    const state = { call: '.c', matched: 1, tree: tree(null), compatMode: 'CSS1Compat', scrolled: false, animations: 0, adopted: 0 };
    const raw = { flags: [], states: [state], harness: { status: 0, tests: [{ name: '.c 1', status: 0 }] }, userAgent: '' };
    expect('states' in resultOf(raw)).toBe(true);
    expect(resultOf({ ...raw, flags: ['script:timing:setTimeout', 'script:event:click'] })).toEqual({ refused: 'script:event:click', flags: ['script:event:click', 'script:timing:setTimeout'] });
    expect(resultOf({ ...raw, harness: null })).toEqual({ refused: 'snapshot:harness-incomplete' });
    expect(resultOf({ ...raw, harness: { status: 1, tests: [] } })).toEqual({ refused: 'snapshot:harness-status:1' });
    expect(resultOf({ ...raw, states: [] })).toEqual({ refused: 'snapshot:no-checklayout' });
    expect(resultOf({ ...raw, harness: { status: 0, tests: [{ name: '.c 1', status: 0 }, { name: 'other', status: 0 }] } })).toEqual({ refused: 'snapshot:other-subtests' });
    expect(resultOf({ ...raw, states: [{ ...state, compatMode: 'BackCompat' }] })).toEqual({ refused: 'snapshot:quirks-mode' });
    expect(resultOf({ ...raw, states: [{ ...state, scrolled: true }] })).toEqual({ refused: 'snapshot:scrolled' });
    expect(resultOf({ ...raw, states: [{ ...state, animations: 1 }] })).toEqual({ refused: 'snapshot:animation-running' });
  });

  it('serializes deterministically, one state per line, later states as patches that decode to the same trees', () => {
    const states: SnapshotState[] = [
      { call: '.c', matched: 1, tree: tree(null) },
      { call: '.c', matched: 1, tree: tree('width: 50px;') },
      { call: '.c', matched: 1, tree: { ...tree('width: 50px;'), c: [HEAD] } },
    ];
    const f = file(states);
    const text = serializeSnapshot(f);
    expect(serializeSnapshot(parseSnapshot(text))).toBe(text);
    expect(parseSnapshot(text)).toEqual(f);
    expect(text.split('\n').filter((l) => l.includes('"call"'))).toHaveLength(3);
    const stored = encodeStates(states);
    expect(stored[1]).toEqual({ call: '.c', matched: 1, patch: { '5': { a: [['id', 't'], ['class', 'box'], ['data-expected-width', '50'], ['style', 'width: 50px;']] } } });
    expect('tree' in (stored[2] as object)).toBe(true); // the element structure changed: stored whole
    expect(decodeStates(stored)).toEqual(states);
  });
});

describe('snapshot path in Chrome 145 (the original pages run with their scripts)', () => {
  let browser: Browser;
  let server: WptServer;
  beforeAll(async () => {
    server = await serveWpt(wpt, { [`/${PREFIX}`]: DATA });
    browser = await launchChrome();
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });
  const capture = (name: string, faults = NO_SNAPSHOT_FAULTS) => captureSnapshot(browser, server.origin, pathOf(name), source(name), commit, faults);
  const dragon = (name: string, f: SnapshotFile) => runSnapshotTest(wpt, pathOf(name), commit, 'web', f, source(name));

  it('a script-set inline style is in the snapshot and Dragon passes; PLANTED: a capture dropping style attributes fails', async () => {
    expect(translate(pathOf('script-style.html'), source('script-style.html'), commit)).toEqual({ kind: 'refused', missing: 'translate:script' });
    const f = await capture('script-style.html');
    if ('refused' in f.result) throw new Error(f.result.refused);
    const t = flatten(f.result.states[0]?.tree as SnapshotNode).find((n) => n.a.some(([k, v]) => k === 'id' && v === 't'));
    expect(t?.a).toContainEqual(['style', 'width: 50px;']);
    expect(t?.v).toEqual({ width: 50, height: 10 });
    expect(f.result.states.flatMap((s) => flatten(s.tree)).some((n) => n.t === 'script')).toBe(false);
    const run = dragon('script-style.html', f);
    expect(run.outcome.status).toBe('pass');
    const chrome = chromeFromSnapshot(f.result, run.fixtures.map((x) => x.sidecar));
    expect(chrome.agrees).toBe(true);
    const planted = await capture('script-style.html', { ...NO_SNAPSHOT_FAULTS, dropStyleAttributes: true });
    const faulty = dragon('script-style.html', planted).outcome;
    expect(faulty.status).toBe('fail');
    if (faulty.status !== 'fail') throw new Error('unreachable');
    expect(faulty.checks).toEqual({ pass: 1, total: 2 });
  });

  it('a script-modified <style> text is what the fixture uses', async () => {
    const f = await capture('style-text.html');
    const run = dragon('style-text.html', f);
    expect(run.fixtures[0]?.html).toContain('.box { width: 30px; height: 10px; }');
    expect(run.outcome.status).toBe('pass');
  });

  it('a dynamic test becomes one case per checkLayout call; PLANTED: snapshotting only the first state fails', async () => {
    const f = await capture('dynamic.html');
    if ('refused' in f.result) throw new Error(f.result.refused);
    expect(f.result.states.map((s) => [s.call, s.matched])).toEqual([['.s1', 1], ['.s2', 1]]);
    expect(f.result.harness.tests).toEqual([{ name: '.s1 1', pass: true }, { name: '.s2 2', pass: true }]);
    const run = dragon('dynamic.html', f);
    expect(run.fixtures.map((x) => x.id)).toEqual([`wpt/${pathOf('dynamic.html')}.state-0`, `wpt/${pathOf('dynamic.html')}.state-1`]);
    expect(run.outcome.status === 'pass' ? run.outcome.subtests : run.outcome).toEqual({ pass: 2, total: 2 });
    expect(chromeFromSnapshot(f.result, run.fixtures.map((x) => x.sidecar)).agrees).toBe(true);
    const planted = dragon('dynamic.html', await capture('dynamic.html', { ...NO_SNAPSHOT_FAULTS, firstStateOnly: true })).outcome;
    expect(planted.status === 'fail' ? planted.subtests : planted).toEqual({ pass: 1, total: 2 });
  });

  it('a helper script that computes data-expected-* runs in Chrome and its attributes are read back', async () => {
    expect(translate(pathOf('helper.html'), source('helper.html'), commit)).toEqual({ kind: 'refused', missing: 'translate:script-src:expect-helper.js' });
    const f = await capture('helper.html');
    if ('refused' in f.result) throw new Error(f.result.refused);
    const run = dragon('helper.html', f);
    expect(run.fixtures[0]?.sidecar.subtests[0]?.checks).toEqual([{ node: 'n5', element: 5, attribute: 'width', expected: '30' }]);
    expect(run.outcome.status).toBe('pass');
  });

  it('timing, events, randomness, scrolling, CSSOM sheet edits and animations are refused precisely', async () => {
    const reasons: Record<string, string> = {};
    for (const k of ['timing', 'raf', 'event', 'random', 'scroll', 'cssom', 'animation']) {
      const f = await capture(`refuse-${k}.html`);
      reasons[k] = 'refused' in f.result ? f.result.refused : 'NOT REFUSED';
    }
    expect(reasons).toEqual({
      timing: 'script:timing:setTimeout',
      raf: 'script:timing:requestAnimationFrame',
      event: 'script:event:resize',
      random: 'script:nondeterministic:Math.random',
      scroll: 'script:scroll',
      cssom: 'script:cssom-sheet',
      animation: 'script:animation',
    });
  });

  it('a WPT test the static translator runs gives the same Dragon result through its snapshot', async () => {
    const path = 'css/css-flexbox/flexbox-lines-must-be-stretched-by-default.html';
    const src = readFileSync(join(wpt, path), 'utf8');
    const f = await captureSnapshot(browser, server.origin, path, src, commit);
    const viaSnapshot = runSnapshotTest(wpt, path, commit, 'web', f, src).outcome;
    const viaStatic = runDragonTest(wpt, path, commit, 'web', src).outcome;
    const counts = (o: typeof viaStatic) => (o.status === 'not-runnable' ? o : [o.status, o.subtests, o.checks]);
    expect(counts(viaSnapshot)).toEqual(counts(viaStatic));
  });
});
