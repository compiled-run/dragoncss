// T154 slice 2d: the device-select lane on the host. The gestures cover presses and both handles on every selection document;
// the expected record runs them through the Chrome-proven selection model as each target's glue does; a record equal to it passes
// and one from the planted glue (every caret index a point picks one caret on, the select-index-off-by-one support plant) fails,
// as do a missing, cut or malformed record. The plant changes one line of each backend's selection runtime, and the host apps
// carry every select case with its facts and gestures.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitNativeSupport, SUPPORT_PLANTS } from 'dragon';
import { caretIndex, caretList, wordAt } from '../../layout/src/rt-select.ts';
import type { Caret } from '../../layout/src/rt-select.ts';
import { evaluateSelectSet, SELECT_LANE } from '../src/device-lanes.ts';
import type { DeviceRecord } from '../src/device-run.ts';
import { isPaintPlant, isSelectPlant, judgeSelectPlant } from '../src/device-run.ts';
import { SELECT_DOCS, selectCase } from '../src/select-cases.ts';
import { compareSelect, deviceLu, deviceSelectSource, evaluateSelect, SELECT_LINE, selectCaseId, selectCaseIds, selectEmits, selectFile, selectGestures, selectReference } from '../src/select-lane.ts';
import { declaredLane, deviceDprs } from '../src/targets.ts';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dragon-select-'));
});
afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

const PLANTED = { indexShift: 1 };
const write = (name: string, lines: (d: (typeof SELECT_DOCS)[number]) => string | null, dpr: number): string => {
  const at = join(dir, name);
  mkdirSync(at);
  for (const d of SELECT_DOCS) {
    const text = lines(d);
    if (text !== null) writeFileSync(selectFile(at, selectCaseId(d), dpr), text);
  }
  return at;
};
const record = (xs: readonly string[]): string => xs.map((l) => `${l}\n`).join('');

describe('device-select gestures and the expected records', () => {
  it('drives every document with presses that select words and drags of both handles', () => {
    for (const d of SELECT_DOCS) {
      const g = selectGestures(d);
      expect(g[0]?.kind, d.id).toBe('p');
      expect(g.filter((x) => x.kind === 'p').length, d.id).toBeGreaterThan(20);
      for (const kind of ['e', 's'] as const) expect(g.filter((x) => x.kind === kind).length, d.id).toBe(g.filter((x) => x.kind === 'p').length * 16);
      for (const [target, dpr] of [['ios', 3], ['android', 2.625]] as const) {
        const r = selectReference(d, target, dpr);
        expect(r.length, d.id).toBe(g.length);
        expect(r.every((l) => SELECT_LINE.test(l)), d.id).toBe(true);
        expect(r.filter((l) => l.startsWith('p ') && !l.endsWith(' -')).length, `${d.id} ${target}`).toBeGreaterThan(5);
        expect(r.filter((l) => !l.startsWith('p ') && !l.endsWith(' -')).length, `${d.id} ${target}`).toBeGreaterThan(100);
      }
    }
  });

  it('selects the word Chrome double clicks on both targets, except an empty block whose line break no caret range holds', () => {
    for (const d of SELECT_DOCS) {
      const t = selectCase(d).table;
      const carets = caretList(t);
      for (const dpr of [2, 3]) {
        const ios = selectReference(d, 'ios', dpr);
        const android = selectReference(d, 'android', dpr);
        // The model at DPR 1 is the one select-model.test.ts proves against Chrome; the DPR's own table only rescales it.
        ios.forEach((l, k) => {
          if (!l.startsWith('p ')) return;
          expect(l, `${d.id}@${dpr} gesture ${k}`).toBe(android[k]);
        });
      }
      for (const g of selectGestures(d).filter((x) => x.kind === 'p')) {
        const w = wordAt(t, deviceLu(g.x, 1), deviceLu(g.y, 1));
        const want = w.length === 2 && caretIndex(carets, w[0] as Caret) !== caretIndex(carets, w[1] as Caret) ? `${caretIndex(carets, w[0] as Caret)} ${caretIndex(carets, w[1] as Caret)}` : '-';
        const line = (selectReference(d, 'android', 1).find((l) => l.startsWith(`p ${g.x} ${g.y} `)) as string).split(' ');
        expect(line[3] === '-' ? '-' : `${line[3]} ${line[4]}`, `${d.id} press ${g.x},${g.y}`).toBe(want);
      }
    }
  });

  it('lands every gesture point on the device LU the reference reads, at every device DPR', () => {
    expect([deviceLu(1024, 2), deviceLu(1024, 2.625), deviceLu(64 * 61, 3)]).toEqual([2048, 2688, 11712]);
  });
});

describe('device-select on records', () => {
  it('passes the expected records and fails the planted glue on every document', () => {
    for (const target of ['ios', 'android'] as const) {
      const dpr = target === 'ios' ? 3 : 2.625;
      const clean = evaluateSelect(write(`clean-${target}`, (d) => record(selectReference(d, target, dpr)), dpr), target, dpr);
      expect([clean.passed, clean.failed, clean.details]).toEqual([SELECT_DOCS.length, 0, []]);
      const planted = evaluateSelect(write(`planted-${target}`, (d) => record(selectReference(d, target, dpr, PLANTED)), dpr), target, dpr);
      expect([planted.passed, planted.failed, planted.missing], target).toEqual([0, SELECT_DOCS.length, []]);
      expect(planted.details[0], target).toMatch(/differ; first at gesture \d+: device "[pes] /);
      expect(judgeSelectPlant(clean, planted, []).caught, target).toBe(true);
      expect(judgeSelectPlant(clean, clean as typeof planted, []).problems, target).toEqual(['device-select passed every case under the plant']);
    }
  });

  it('fails a missing, cut, malformed or short record', () => {
    const d = SELECT_DOCS[0] as (typeof SELECT_DOCS)[number];
    const want = selectReference(d, 'ios', 2);
    const file = (name: string, text: string | null): string => {
      const at = write(name, (x) => (x.id === d.id ? text : null), 2);
      return selectFile(at, selectCaseId(d), 2);
    };
    expect(compareSelect(file('missing', null), want)).toBe('the device wrote no select record');
    expect(compareSelect(file('cut', record(want).slice(0, -1)), want)).toMatch(/does not end with a newline/);
    expect(compareSelect(file('malformed', `${record(want)}p 1 2 x\n`), want)).toMatch(/is malformed/);
    expect(compareSelect(file('short', record(want.slice(1))), want)).toMatch(new RegExp(`^${want.length - 1} lines for ${want.length}`));
  });

  it('files each failure under its case as device-select, and a missing record as select-missing', () => {
    const at = write('set', (d) => (d.id === 'gaps' ? null : record(selectReference(d, 'android', 2.625, d.id === 'none' ? PLANTED : { indexShift: 0 }))), 2.625);
    const s = evaluateSelectSet('android', 2.625, at, { name: 'fake' } as unknown as DeviceRecord);
    expect(s.failures.map((f) => [f.lane, f.case, f.kind])).toEqual([[SELECT_LANE, 'select~gaps', 'select-missing'], [SELECT_LANE, 'select~none', 'select-mismatch']]);
    expect([s.cases, s.dumps, s.compared.b]).toEqual([SELECT_DOCS.length, SELECT_DOCS.length - 1, SELECT_DOCS.length]);
    const short = evaluateSelectSet('android', 2.625, at, { name: 'fake' } as unknown as DeviceRecord, [], () => ({ passed: 1, failed: 0, details: [], missing: [] }));
    expect(short.failures.map((f) => f.detail)).toEqual([`evaluateSelect judged 1 of ${SELECT_DOCS.length} select cases`]);
  });
});

describe('the select cases in the host apps', () => {
  it('declares device-select over the select cases at every device DPR', () => {
    for (const target of ['ios', 'android'] as const) expect(declaredLane(target, 'device-select').sets.map((s) => [s.dpr, s.ids])).toEqual(deviceDprs(target).map((d) => [d, selectCaseIds()]));
  });

  it('emits every select case with its program, facts and gestures', () => {
    for (const target of ['ios', 'android'] as const) {
      expect(selectEmits(target).map((c) => c.id)).toEqual(selectCaseIds());
      const src = deviceSelectSource(target).text;
      for (const d of SELECT_DOCS) {
        expect(src, `${target} ${d.id}`).toContain(JSON.stringify(selectCaseId(d)));
        expect(src, `${target} ${d.id}`).toContain(JSON.stringify(selectGestures(d).map((g) => `${g.kind} ${g.x} ${g.y}\n`).join('')));
      }
    }
  });

  it('plants the off-by-one in one line of each selection runtime, judged as a selection plant', () => {
    expect(SUPPORT_PLANTS).toContain('select-index-off-by-one');
    expect([isSelectPlant('select-index-off-by-one'), isPaintPlant('select-index-off-by-one')]).toEqual([true, false]);
    for (const backend of ['uikit', 'android-views'] as const) {
      const clean = emitNativeSupport(backend).flatMap((f) => f.text.split('\n'));
      const planted = emitNativeSupport(backend, 'select-index-off-by-one').flatMap((f) => f.text.split('\n'));
      const changed = planted.filter((l, i) => l !== clean[i]);
      expect(changed, backend).toEqual([backend === 'uikit' ? 'public let dragonSelectIndexPlant: Int = 1' : 'const val DRAGON_SELECT_INDEX_PLANT = 1']);
    }
  });
});
