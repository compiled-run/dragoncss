// MQ-R1 (notes/T067-mq-r-spec.md R2, R4, R5): the band table, the band state program (env#band) and the media runtime reference.
// The atoms evaluated by the runtime's band lookup (packages/layout/src/rt-band.ts) must give Chrome 145's matchMedia answer on
// the whole captured media corpus, and its bands the band Chrome matches; the runtime must move bands as one delta and lay out once.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import { rtBand } from '@dragon/layout';
import type { Assignment, BandCase, NativeProgram, ProgramNode } from 'dragon';
import { BAND_KEY, bandAtom, bandOf, BandProgramError, bandStateProgram, bandTableOf, MAX_STATE_TABLE_ASSIGNMENTS, MediaRuntime, NO_BAND_RUNTIME_FAULTS, programAt, StateProgramError } from 'dragon';
import { band, evaluateWithOracle, parseMediaQueryList } from '../src/media/index.ts';
import { CAPTURE as capture, CORPUS } from './media/corpus.ts';

const atomsOf = (q: string) => parseMediaQueryList(q);

describe('the band atoms against Chrome 145 matchMedia (the captured media corpus)', () => {
  it('give Chrome\'s answer for every captured query Dragon evaluates, at every captured viewport', () => {
    let compared = 0;
    const mismatches: string[] = [];
    for (const q of capture.queries) {
      const list = atomsOf(q.query);
      const bits = q.matches['16'] as string;
      capture.points.forEach(([width, height], k) => {
        const r = evaluateWithOracle(list, (f) => rtBand.atomHolds(bandAtom(f), width, height, rtBand.NO_BAND_FAULTS));
        if (r.kind === 'refused') return;
        compared++;
        if (r.matches !== (bits[k] === '1')) mismatches.push(`${q.query} at ${width}x${height}: ${r.matches}`);
      });
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThan(15_000);
  });
  it('look up the band whose condition Chrome matches, for every captured band sheet at every viewport', () => {
    let compared = 0;
    for (const captured of capture.bands) {
      const sheet = CORPUS.bandSheets.find((s) => s.name === captured.sheet);
      if (sheet === undefined) throw new Error(`unknown band sheet ${captured.sheet}`);
      const p = band(sheet.queries.map(atomsOf));
      if (p.kind !== 'bands') throw new Error(p.detail);
      const table = bandTableOf(p);
      capture.points.forEach(([width, height], k) => {
        const chrome = captured.conditions.flatMap((c, i) => (c.matches['16']?.[k] === '1' ? [i] : []));
        compared++;
        expect([rtBand.bandIndex(table, width, height, rtBand.NO_BAND_FAULTS)], `${sheet.name} at ${width}x${height}`).toEqual(chrome);
      });
    }
    expect(compared).toBeGreaterThan(500);
  });
});

describe('bandAtom', () => {
  const atom = (q: string) => {
    const p = band([atomsOf(q)]);
    if (p.kind !== 'bands') throw new Error(p.detail);
    return bandTableOf(p).atoms;
  };
  it('writes min- as >=, max- as <=, the plain form as =, em at 16px, and a left range with Chrome\'s reversed operator', () => {
    expect(atom('(min-width: 20em)')).toEqual([{ feature: 'width', comparisons: [{ op: 'ge', value: 320, num: 0, den: 0 }], keyword: 'none' }]);
    expect(atom('(max-height: 300px)')).toEqual([{ feature: 'height', comparisons: [{ op: 'le', value: 300, num: 0, den: 0 }], keyword: 'none' }]);
    expect(atom('(width: 400px)')).toEqual([{ feature: 'width', comparisons: [{ op: 'eq', value: 400, num: 0, den: 0 }], keyword: 'none' }]);
    expect(atom('(320px < width <= 400px)')).toEqual([{ feature: 'width', comparisons: [{ op: 'gt', value: 320, num: 0, den: 0 }, { op: 'le', value: 400, num: 0, den: 0 }], keyword: 'none' }]);
    expect(atom('(400px >= height)')).toEqual([{ feature: 'height', comparisons: [{ op: 'le', value: 400, num: 0, den: 0 }], keyword: 'none' }]);
    expect(atom('(width)')).toEqual([{ feature: 'width', comparisons: [], keyword: 'none' }]);
  });
  it('refuses a feature it has no atom for, by name', () => {
    const [hover] = atomsOf('(hover)').queries.flatMap((q) => (q.valid && q.condition !== null && q.condition.type === 'feature' ? [q.condition] : []));
    expect(() => bandAtom(hover as Parameters<typeof bandAtom>[0])).toThrow(BandProgramError);
  });
});

// ---------------------------------------------------------------- the band state program

const px = (value: number) => ({ kind: 'px', value });
const auto = { kind: 'auto' };
const style = (width: number): LayoutBox['style'] => ({
  display: 'block', position: 'static', top: auto, right: auto, bottom: auto, left: auto, overflowX: 'visible', overflowY: 'visible', direction: 'ltr', boxSizing: 'content-box',
  width: px(width), height: auto, minWidth: auto, minHeight: auto, maxWidth: { kind: 'none' }, maxHeight: { kind: 'none' }, marginTop: px(0), marginRight: px(0), marginBottom: px(0), marginLeft: px(0),
  paddingTop: px(0), paddingRight: px(0), paddingBottom: px(0), paddingLeft: px(0), borderTopWidth: px(0), borderRightWidth: px(0), borderBottomWidth: px(0), borderLeftWidth: px(0),
  flexDirection: 'row', flexWrap: 'nowrap', flexGrow: 0, flexShrink: 1, flexBasis: auto, order: 0, justifyContent: 'flex-start', alignItems: 'stretch', alignSelf: 'auto', alignContent: 'normal',
  rowGap: { kind: 'normal' }, columnGap: { kind: 'normal' }, textAlign: 'start', aspectRatio: auto,
}) as unknown as LayoutBox['style'];
const box = (id: string, width: number): LayoutBox => ({ kind: 'box', id, boxType: 'element', style: style(width), children: [] });
const node = (id: string, color: number): ProgramNode => ({
  id, parent: null, host: null, kind: 'element', native: 'DragonBoxView', clips: false, text: null,
  writes: [{ kind: 'background-color', color: { r: color, g: 0, b: 0, alpha: 255 }, key: 'backgroundColor', technique: 'native-property', detail: 'test', css: ['background-color'] }],
  facts: {},
});
const program = (width: number, color: number): NativeProgram => ({ version: 'dragon.uikit-program/1', backend: 'uikit', root: box('r', width), rootFontSize: 16, nodes: [node('r', color)] });
const open = (v: boolean): Assignment => [{ state: { instance: 'doc', state: 'open' }, value: v }];

// Two app assignments (open: colour) by two bands (max-width 320: the width), the table of `(max-width: 320px)`.
const TABLE: rtBand.BandTable = { atoms: [{ feature: 'width', comparisons: [{ op: 'le', value: 320, num: 0, den: 0 }], keyword: 'none' }], bands: [[true], [false]] };
const CASES: BandCase[] = [0, 1].flatMap((b) => [false, true].map((v) => ({ assignment: open(v), isInitial: !v, band: b, program: program(b === 0 ? 100 : 200, v ? 2 : 1) })));

describe('bandStateProgram', () => {
  const sp = bandStateProgram('uikit', CASES, 2, 1);
  it('adds env#band after the app states, with the bands as its domain in order, and starts in the initial band', () => {
    expect(sp.states.map((s) => [s.key, s.domain])).toEqual([['doc#open', [false, true]], [BAND_KEY, [0, 1]]]);
    expect(BAND_KEY).toBe('@env#band');
    expect(sp.assignments.map((a) => a.key)).toHaveLength(4);
    expect(bandOf(sp, sp.initial)).toBe(1);
    CASES.forEach((c) => {
      const i = sp.assignments.findIndex((a) => JSON.stringify(a.assignment) === JSON.stringify([...c.assignment, { state: { instance: '@env', state: 'band' }, value: c.band }]));
      expect(programAt(sp, i), JSON.stringify(c.assignment)).toEqual(c.program);
    });
  });
  it('is not an app setter: the runtime refuses to take env#band from the app', () => {
    const rt = new MediaRuntime(sp, TABLE, 1, { widthPx: 400, heightPx: 300 });
    expect(() => rt.set(BAND_KEY, 0)).toThrow(/set by the root size, not by the app/);
  });
  it('refuses a band without every app assignment, a bad band index and an app state named env#band', () => {
    expect(() => bandStateProgram('uikit', CASES.slice(0, 3), 2, 0)).toThrow(/band 1 does not hold the same app assignments/);
    expect(() => bandStateProgram('uikit', CASES, 2, 2)).toThrow(/initial band 2/);
    expect(() => bandStateProgram('uikit', CASES.map((c) => ({ ...c, band: 2 })), 2, 0)).toThrow(/a case in band 2/);
    expect(() => bandStateProgram('uikit', [{ ...(CASES[0] as BandCase), assignment: [{ state: { instance: '@env', state: 'band' }, value: 0 }] }], 1, 0)).toThrow(/names @env#band/);
  });
  it('counts bands against the 64-assignment table limit', () => {
    const many = Array.from({ length: 33 }, (_, i) => i).flatMap((i) => [0, 1].map((b): BandCase => ({ assignment: [{ state: { instance: 'doc', state: 'n' }, value: i }], isInitial: i === 0, band: b, program: program(100, 1) })));
    expect(() => bandStateProgram('uikit', many, 2, 0)).toThrow(StateProgramError);
    expect(bandStateProgram('uikit', many.filter((c) => (c.assignment[0]?.value as number) < MAX_STATE_TABLE_ASSIGNMENTS / 2), 2, 0).assignments).toHaveLength(64);
  });
});

describe('MediaRuntime', () => {
  const sp = bandStateProgram('uikit', CASES, 2, 1);
  const widthOf = (rt: MediaRuntime): unknown => (rt.program().root.style as unknown as { width: unknown }).width;
  it('starts in the root\'s own band, whatever the program\'s initial band, with one layout', () => {
    const rt = new MediaRuntime(sp, TABLE, 2, { widthPx: 600, heightPx: 600 });
    expect([rt.band, widthOf(rt), rt.layouts, rt.viewport()]).toEqual([0, px(100), 1, { width: 300, height: 300 }]);
  });
  it('moves the band and lays out once per size change, keeps the app state, and lays out once per setter', () => {
    const rt = new MediaRuntime(sp, TABLE, 1, { widthPx: 400, heightPx: 300 });
    rt.set('doc#open', true);
    rt.resize({ widthPx: 320, heightPx: 300 });
    expect([rt.band, widthOf(rt), rt.program().nodes[0]?.writes[0], rt.layouts]).toEqual([0, px(100), expect.objectContaining({ color: { r: 2, g: 0, b: 0, alpha: 255 } }), 3]);
    rt.resize({ widthPx: 300, heightPx: 400 });
    expect([rt.band, rt.layouts, rt.viewport()]).toEqual([0, 4, { width: 300, height: 400 }]);
    rt.resize({ widthPx: 321, heightPx: 400 });
    expect([rt.band, widthOf(rt), rt.layouts]).toEqual([1, px(200), 5]);
  });
  it('each plant breaks what it names, and only that', () => {
    const run = (faults: Partial<typeof NO_BAND_RUNTIME_FAULTS>): [number, unknown, { width: number; height: number }] => {
      const rt = new MediaRuntime(bandStateProgram('uikit', CASES, 2, 1, undefined, { ...NO_BAND_RUNTIME_FAULTS, ...faults }), TABLE, 1, { widthPx: 400, heightPx: 300 }, { ...NO_BAND_RUNTIME_FAULTS, ...faults });
      rt.resize({ widthPx: 320, heightPx: 300 });
      return [rt.band, widthOf(rt), { ...rt.viewport() }];
    };
    expect(run({})).toEqual([0, px(100), { width: 320, height: 300 }]);
    expect(run({ bandBoundaryExclusive: true })).toEqual([1, px(200), { width: 320, height: 300 }]);
    expect(run({ bandStale: true })).toEqual([0, px(200), { width: 320, height: 300 }]);
    expect(run({ resizeSkipsRelayout: true })).toEqual([1, px(200), { width: 400, height: 300 }]);
    // Open in the initial band, then a band change: the band delta's node record (the open colour) is lost to the base's.
    const dropped = new MediaRuntime(bandStateProgram('uikit', CASES, 2, 1, undefined, { ...NO_BAND_RUNTIME_FAULTS, bandDeltaDropped: true }), TABLE, 1, { widthPx: 400, heightPx: 300 });
    dropped.set('doc#open', true);
    expect(dropped.program().nodes[0]?.writes[0]).toEqual(expect.objectContaining({ color: { r: 2, g: 0, b: 0, alpha: 255 } }));
    dropped.resize({ widthPx: 320, heightPx: 300 });
    expect([dropped.band, dropped.program().nodes[0]?.writes[0]]).toEqual([0, expect.objectContaining({ color: { r: 1, g: 0, b: 0, alpha: 255 } })]);
  });
  it('refuses a table whose bands are not the program\'s env#band domain', () => {
    expect(() => new MediaRuntime(sp, { atoms: TABLE.atoms, bands: [[true]] }, 1, { widthPx: 1, heightPx: 1 })).toThrow(/not the 1 bands of the table/);
  });
});
