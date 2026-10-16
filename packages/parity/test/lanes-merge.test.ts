// The lanes.json merge driver (scripts/lanes-merge.ts): device records only come from device runs, so a merge keeps the side that
// changed each device lane record and dump fault rows, never ours by default (which dragon-generated did, reverting a newer
// device run when a branch merged master); host parts stay ours for regen to rebuild.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MERGE_DRIVERS } from '../../../scripts/floor-merge.ts';
import { LANES_MERGE_DRIVER, mergeLanesFile, Refuse } from '../../../scripts/lanes-merge.ts';
import { repoPath } from '../src/paths.ts';

type Rec = { lane: string; where: string; state: string; reason: string | null; device: unknown; evidence: unknown; run: unknown; ran?: unknown };
const rec = (lane: string, where: string, state: string, evidence: string | null): Rec => ({ lane, where, state, reason: null, device: state === 'not run' ? null : { sets: [] }, evidence: evidence === null ? null : { laneCode: evidence }, run: null });
const file = (frames: Rec, host: Rec, faults: unknown = null, caseLists?: Record<string, string[]>): string =>
  `${JSON.stringify({ schema: 'dragon.lanes/2', targets: [{ target: 'ios', lanes: [host, frames], dumpFaults: faults }], ...(caseLists === undefined ? {} : { caseLists }) }, null, 2)}\n`;
const parsed = (s: string): { targets: { lanes: Rec[]; dumpFaults: unknown }[]; caseLists?: Record<string, string[]> } => JSON.parse(s);

describe('lanes-merge', () => {
  const host = rec('layout-vectors-host', 'host', 'pass', null);
  const base = file(rec('device-frames', 'device', 'pass', 'old'), host, [{ dpr: 2 }]);

  it('takes theirs for a device record only theirs changed (a branch merging master after a device run), ours for the rest', () => {
    const ours = file({ ...rec('device-frames', 'device', 'pass', 'old'), ran: { sets: [], corpora: 'x' } }, { ...host, reason: 'ours host' }, [{ dpr: 2 }]);
    const theirs = file(rec('device-frames', 'device', 'fail', 'new'), { ...host, reason: 'theirs host' }, [{ dpr: 3 }], { k: ['a'] });
    const m = parsed(mergeLanesFile(base, ours, theirs));
    expect(m.targets[0]!.lanes[1]).toMatchObject({ state: 'fail', evidence: { laneCode: 'new' } });
    expect(m.targets[0]!.lanes[0]!.reason).toBe('ours host');
    expect(m.targets[0]!.dumpFaults).toEqual([{ dpr: 3 }]);
    expect(m.caseLists).toEqual({ k: ['a'] });
  });
  it('keeps ours when only ours changed, and when both hold the same run', () => {
    const ours = file(rec('device-frames', 'device', 'fail', 'new'), host, [{ dpr: 3 }]);
    expect(parsed(mergeLanesFile(base, ours, base)).targets[0]!.lanes[1]!.evidence).toEqual({ laneCode: 'new' });
    expect(parsed(mergeLanesFile(base, ours, ours)).targets[0]!.lanes[1]!.evidence).toEqual({ laneCode: 'new' });
  });
  it('refuses two different device runs, a missing base and a malformed side', () => {
    const ours = file(rec('device-frames', 'device', 'pass', 'a'), host);
    const theirs = file(rec('device-frames', 'device', 'pass', 'b'), host);
    expect(() => mergeLanesFile(base, ours, theirs)).toThrow(Refuse);
    expect(() => mergeLanesFile('', ours, ours)).toThrow(/no base/);
    expect(() => mergeLanesFile(base, '{', ours)).toThrow(/ours is not JSON/);
    expect(() => mergeLanesFile(base, ours, '{"targets":[{"target":"ios"}]}')).toThrow(/theirs is not/);
  });
  it('a side regen reset to not run (stale there) yields to the other side\'s device run, and lanes or targets only theirs has are kept', () => {
    const reset = file({ ...rec('device-frames', 'device', 'not run', null), reason: 'run pnpm run parity:lanes' }, host);
    const ran = file(rec('device-frames', 'device', 'pass', 'new'), host);
    expect(parsed(mergeLanesFile(base, reset, ran)).targets[0]!.lanes[1]!.evidence).toEqual({ laneCode: 'new' });
    expect(parsed(mergeLanesFile(base, ran, reset)).targets[0]!.lanes[1]!.evidence).toEqual({ laneCode: 'new' });
    // Both sides reset: either.
    expect(parsed(mergeLanesFile(base, reset, reset)).targets[0]!.lanes[1]!.state).toBe('not run');
    const extra = JSON.parse(ran) as { targets: { target: string; lanes: Rec[] }[] };
    extra.targets[0]!.lanes.push(rec('device-hit', 'device', 'pass', 'new'));
    extra.targets.push({ target: 'android', lanes: [rec('device-frames', 'device', 'pass', 'new')] });
    const m = parsed(mergeLanesFile(base, base, `${JSON.stringify(extra)}\n`));
    expect(m.targets[0]!.lanes.map((l) => l.lane)).toEqual(['layout-vectors-host', 'device-frames', 'device-hit']);
    expect(m.targets).toHaveLength(2);
  });
  it('runs as git\'s merge driver for lanes.json, registered by setup:git and marked in .gitattributes', () => {
    expect(MERGE_DRIVERS).toContainEqual(['merge.dragon-lanes.driver', LANES_MERGE_DRIVER]);
    const marked = execFileSync('git', ['ls-files', '-z', ':(attr:merge=dragon-lanes)'], { cwd: repoPath('.'), encoding: 'utf8' }).split('\0').filter((p) => p !== '');
    expect(marked).toEqual(['packages/parity/out/lanes.json']);
    const dir = mkdtempSync(join(tmpdir(), 'lanes-merge-'));
    try {
      const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 't');
      git('config', 'user.email', 't@t');
      git('config', 'merge.dragon-lanes.driver', `node ${repoPath('scripts/lanes-merge.ts')} %O %A %B %P`);
      writeFileSync(join(dir, '.gitattributes'), 'lanes.json merge=dragon-lanes\n');
      writeFileSync(join(dir, 'lanes.json'), base);
      git('add', '.');
      git('commit', '-q', '-m', 'base');
      git('checkout', '-q', '-b', 'master-side');
      writeFileSync(join(dir, 'lanes.json'), file(rec('device-frames', 'device', 'fail', 'new'), host, [{ dpr: 2 }]));
      git('commit', '-q', '-am', 'device run');
      git('checkout', '-q', 'main');
      writeFileSync(join(dir, 'lanes.json'), file(rec('device-frames', 'device', 'pass', 'old'), { ...host, reason: 'regen' }, [{ dpr: 2 }]));
      git('commit', '-q', '-am', 'branch regen');
      git('merge', '-q', '--no-edit', 'master-side');
      const m = parsed(readFileSync(join(dir, 'lanes.json'), 'utf8'));
      expect(m.targets[0]!.lanes[1]!.evidence).toEqual({ laneCode: 'new' });
      expect(m.targets[0]!.lanes[0]!.reason).toBe('regen');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
