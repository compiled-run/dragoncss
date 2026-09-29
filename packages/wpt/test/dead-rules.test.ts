import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, WptServer } from '../src/chrome.ts';
import { launchChrome, runInChrome, serveWpt } from '../src/chrome.ts';
import { runTranslation } from '../src/dragon.ts';
import { lockedCommit, PACKAGE_DIR, pinnedWptDir } from '../src/paths.ts';
import { runSnapshotTest } from '../src/run.ts';
import type { SnapshotFile } from '../src/snapshot.ts';
import { captureSnapshot, liveDeadRulesInSnapshot } from '../src/snapshot.ts';
import type { DeadRuleFaults, Sidecar } from '../src/translate.ts';
import { NO_DEAD_RULE_FAULTS, translate } from '../src/translate.ts';

const wpt = pinnedWptDir();
const commit = lockedCommit();
const DATA = resolve(PACKAGE_DIR, 'test/data');
/** The synthetic pages are served at this WPT-like path so they load WPT's own /resources/ harness. */
const PREFIX = 'css/dragon-test/';
const source = (name: string): string => readFileSync(join(DATA, 'dead-rules', name), 'utf8');
const pathOf = (name: string): string => `${PREFIX}dead-rules/${name}`;
const fixture = (name: string, faults: DeadRuleFaults = NO_DEAD_RULE_FAULTS) => {
  const t = translate(pathOf(name), source(name), commit, () => null, { deadRuleFaults: faults });
  if (t.kind !== 'fixture') throw new Error(t.missing);
  return t;
};

describe('dead rules, offline', () => {
  it('drops only rules no selector of which can match; the rule text goes whole, and the sidecar lists it', () => {
    const t = fixture('static.html');
    expect(t.sidecar.deadRules).toEqual(['.never', 'section > .box, .box + .missing']);
    expect(t.html).not.toContain('float');
    expect(t.html).toContain('.box { width: 10px; height: 10px; }');
    expect(t.html).toContain('.c > .box:first-child { height: 20px; }');
    expect(runTranslation(t, 'web').outcome.status).toBe('pass');
  });

  it('PLANTED: dropLiveRule and dropUnknownSelector drop rules that apply, and Dragon then fails', () => {
    const live = fixture('static.html', { ...NO_DEAD_RULE_FAULTS, dropLiveRule: true });
    expect(live.sidecar.deadRules).toContain('.box');
    expect(runTranslation(live, 'web').outcome.status).toBe('fail');
    const unknown = fixture('static.html', { ...NO_DEAD_RULE_FAULTS, dropUnknownSelector: true });
    expect(unknown.sidecar.deadRules).toContain('.c > .box:first-child');
    expect(runTranslation(unknown, 'web').outcome.status).toBe('fail');
  });
});

describe('dead rules confirmed in Chrome 145 (querySelectorAll on the original page)', () => {
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
  const live = async (sidecar: Sidecar): Promise<readonly string[]> => (await runInChrome(browser, server.origin, sidecar)).deadRulesLive;

  it('the dropped rules match nothing in Chrome; PLANTED dropLiveRule and dropUnknownSelector are caught as live', async () => {
    const clean = await runInChrome(browser, server.origin, fixture('static.html').sidecar);
    expect(clean.agrees).toBe(true);
    expect(clean.deadRulesLive).toEqual([]);
    expect(await live(fixture('static.html', { ...NO_DEAD_RULE_FAULTS, dropLiveRule: true }).sidecar)).toEqual(['.box']);
    expect(await live(fixture('static.html', { ...NO_DEAD_RULE_FAULTS, dropUnknownSelector: true }).sidecar)).toEqual(['.c > .box:first-child']);
  });

  it('a snapshot test judges each state on its own DOM; PLANTED dropFirstStateOnly is caught at the second state', async () => {
    const f: SnapshotFile = await captureSnapshot(browser, server.origin, pathOf('dynamic.html'), source('dynamic.html'), commit);
    if ('refused' in f.result) throw new Error(f.result.refused);
    const run = runSnapshotTest(wpt, pathOf('dynamic.html'), commit, 'web', f, source('dynamic.html'));
    const perState = run.fixtures.map((x) => x.sidecar.deadRules ?? []);
    expect(perState).toEqual([['.wide .box', '.gone'], ['.gone']]);
    expect(run.outcome.status).toBe('pass');
    expect(await liveDeadRulesInSnapshot(browser, server.origin, pathOf('dynamic.html'), perState)).toEqual([]);
    const planted = runSnapshotTest(wpt, pathOf('dynamic.html'), commit, 'web', f, source('dynamic.html'), { ...NO_DEAD_RULE_FAULTS, dropFirstStateOnly: true });
    const plantedStates = planted.fixtures.map((x) => x.sidecar.deadRules ?? []);
    expect(plantedStates).toEqual([['.wide .box', '.gone'], ['.wide .box', '.gone']]);
    expect(planted.outcome.status).toBe('fail');
    expect(await liveDeadRulesInSnapshot(browser, server.origin, pathOf('dynamic.html'), plantedStates)).toEqual(['state 1: .wide .box']);
  });
});
