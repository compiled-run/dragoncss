// The committed out/device-failures-<target>.json lists hold every device failure of the run recorded in out/lanes.json: per
// target, lane and DPR the count and the counts by kind equal the lanes.json set records, and each lane's first failures are
// the head of its full list (T008 MF1).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LaneFailure } from '../src/device-lanes.ts';
import { readLanesFile } from '../src/lanes.ts';
import { repoPath } from '../src/paths.ts';

const lanes = readLanesFile();
const countBy = <T>(xs: readonly T[], key: (x: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
};

describe('committed out/device-failures-<target>.json', () => {
  it('lanes.json holds device runs for ios and android', () => {
    expect(lanes?.targets.map((t) => t.target)).toEqual(['ios', 'android']);
  });
  for (const target of ['ios', 'android'] as const) {
    it(`${target}: every failure is listed, and the counts per lane, DPR and kind equal lanes.json`, () => {
      const t = lanes?.targets.find((x) => x.target === target);
      expect(t).toBeDefined();
      if (t === undefined) return;
      const path = repoPath(`packages/parity/out/device-failures-${target}.json`);
      expect(existsSync(path), path).toBe(true);
      const all = JSON.parse(readFileSync(path, 'utf8')) as LaneFailure[];
      const deviceLanes = t.lanes.filter((l) => l.device !== null);
      expect(deviceLanes.length).toBeGreaterThan(0);
      let recorded = 0;
      for (const l of deviceLanes) {
        const run = l.device;
        if (run === null) continue;
        const listed = all.filter((f) => f.lane === l.lane);
        for (const s of run.sets) {
          const atDpr = listed.filter((f) => f.dpr === s.dpr);
          expect(atDpr.length, `${target} ${l.lane} DPR ${s.dpr}`).toBe(s.failures);
          expect(countBy(atDpr, (f) => f.kind), `${target} ${l.lane} DPR ${s.dpr} by kind`).toEqual(s.failuresByKind);
          recorded += s.failures;
        }
        expect(listed.every((f) => run.sets.some((s) => s.dpr === f.dpr)), `${target} ${l.lane}: a failure at a DPR with no set`).toBe(true);
        expect(countBy(listed, (f) => f.kind), `${target} ${l.lane} by kind`).toEqual(run.failuresByKind);
        expect(run.firstFailures, `${target} ${l.lane} first failures`).toEqual(listed.slice(0, run.firstFailures.length));
      }
      expect(all.length, `${target}: failures of lanes with no device run`).toBe(recorded);
    });
  }
});
