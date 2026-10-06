// MQ-R1 (notes/T067-mq-r-spec.md R5): the band runtime reference (src/media-runtime.ts) on a synthetic band program: a size change
// moves the band as one delta and lays out once, app setters keep their state and cannot set env#band, and each plant breaks what it
// names. The fixtures' runs against Chrome are media-runtime-resize.test.ts.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { Assignment, BandCase, NativeProgram, ProgramNode } from 'dragon';
import { BAND_KEY, bandStateProgram, NO_BAND_RUNTIME_FAULTS } from 'dragon';
import { MediaRuntime } from '../src/media-runtime.ts';
import { rtBand } from '@dragon/layout';
import { readFileSync } from 'node:fs';
import { bandTableOf, createProjectWith, nativeBandOfViewport, nativeBandPrograms, nativeBands, nativePrograms, NO_FAULTS } from 'dragon';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { NATIVE_CONFIG } from '../src/native-host.ts';
import { repoPath } from '../src/paths.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { band, parseMediaQueryList } from '../../dragon/src/media/index.ts';

const px = (value: number) => ({ kind: 'px', value });
const auto = { kind: 'auto' };
const style = (width: number): LayoutBox['style'] => ({
  display: 'block', position: 'static', top: auto, right: auto, bottom: auto, left: auto, overflowX: 'visible', overflowY: 'visible', direction: 'ltr', boxSizing: 'content-box',
  width: px(width), height: auto, minWidth: auto, minHeight: auto, maxWidth: { kind: 'none' }, maxHeight: { kind: 'none' }, marginTop: px(0), marginRight: px(0), marginBottom: px(0), marginLeft: px(0),
  paddingTop: px(0), paddingRight: px(0), paddingBottom: px(0), paddingLeft: px(0), borderTopWidth: px(0), borderRightWidth: px(0), borderBottomWidth: px(0), borderLeftWidth: px(0),
  flexDirection: 'row', flexWrap: 'nowrap', flexGrow: 0, flexShrink: 1, flexBasis: auto, order: 0, justifyContent: 'flex-start', alignItems: 'stretch', alignSelf: 'auto', alignContent: 'normal',
  rowGap: { kind: 'normal' }, columnGap: { kind: 'normal' }, textAlign: 'start', aspectRatio: auto,
  verticalAlign: { kind: 'keyword', value: 'baseline' }, grid: null, gridItem: null,
}) as unknown as LayoutBox['style'];
const box = (id: string, width: number): LayoutBox => ({ kind: 'box', id, boxType: 'element', style: style(width), strut: null, children: [] });
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

describe('the env#band variable', () => {
  it('is not an app setter: the runtime refuses to take it from the app', () => {
    const rt = new MediaRuntime(bandStateProgram('uikit', CASES, 2, 1), TABLE, 1, { widthPx: 400, heightPx: 300 });
    expect(() => rt.set(BAND_KEY, 0)).toThrow(/set by the root size, not by the app/);
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

describe('the band lookup over whole device px, off the 8 px grid (PR #140 review)', () => {
  const DPRS = [1, 1.75, 2, 2.625, 3, 3.5];
  const sheets = FIXTURES.filter((f): f is FixtureSpec & { kind: 'layout' } => f.kind === 'layout' && /^(media|mqr)-/.test(f.id)).map((f) => ({ id: f.id, compiled: nativeCompile(f, 'ltr') }));
  it('maps every root from 0 to 2048 device px wide or high at DPR 1, 1.75, 2, 2.625, 3 and 3.5 to the band MQ-R0\'s partition gives the same media size', () => {
    let checked = 0;
    for (const s of sheets) {
      const bands = nativeBands(s.compiled);
      if (bands === null) continue;
      for (const dpr of DPRS) {
        for (let px = 0; px <= 2048; px++) {
          for (const [w, h] of [[px, 600], [px, 1400], [600, px], [1400, px]] as const) {
            const k = rtBand.bandAtPx(bands.table, w, h, dpr, rtBand.NO_BAND_FAULTS);
            checked++;
            const want = nativeBandOfViewport(s.compiled, { width: rtBand.mediaSize(w, dpr), height: rtBand.mediaSize(h, dpr) });
            if (k !== want) expect(k, `${s.id} ${w}x${h} px at ${dpr}`).toBe(want);
          }
        }
      }
    }
    expect(sheets.map((s) => s.id)).toEqual(expect.arrayContaining(['media-range', 'media-epsilon', 'media-orientation', 'media-aspect-ratio']));
    expect(checked).toBeGreaterThan(700_000);
  }, 600_000);
  it('the review\'s sheet, (width <= 400px) with (width > 400px), finds the band where both hold at 1400 px and DPR 3.5 (400.0000305 css px)', () => {
    const p = band(['(width <= 400px)', '(width > 400px)'].map((q) => parseMediaQueryList(q)));
    if (p.kind !== 'bands') throw new Error(p.detail);
    expect(p.bands[rtBand.bandAtPx(bandTableOf(p), 1400, 1000, 3.5, rtBand.NO_BAND_FAULTS)]?.truth).toEqual([true, true]);
  });
});

describe('an img under a transform that only a band change moves (PR #140 review)', () => {
  it('is drawn directly (layer false) in every band\'s program, and in the per-case programs, so a band switch never resamples a stale layer', () => {
    const png = /src="(data:image\/png;base64,[^"]+)"/.exec(readFileSync(repoPath('packages/parity/fixtures/replaced-demo.html'), 'utf8'))?.[1];
    if (png === undefined) throw new Error('no PNG in replaced-demo');
    const html = `<!DOCTYPE html><html data-dragon-id="html"><head><style>body { margin: 0; font-family: Ahem; font-size: 10px; }
img { display: block; width: 40px; height: 20px; } .s { transform: scale(1); } @media (min-width: 384px) { .s { transform: scale(1.5); } }</style></head>
<body data-dragon-id="body"><div data-dragon-id="s" class="s"><img data-dragon-id="a" src="${png}"></div><img data-dragon-id="c" src="${png}"></body></html>`;
    const compiled = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', foldViewport: { width: 400, height: 300 } }).compile(fixtureToInput('img-band-transform', html));
    const layers = (p: ReturnType<typeof nativePrograms>, b: 'uikit' | 'android-views') => {
      if (p.kind !== 'ready') throw new Error(p.reason);
      return p.programs[b].nodes.flatMap((n) => n.writes.flatMap((w) => (w.kind === 'replaced-image' ? [[n.id, w.layer]] : [])));
    };
    const bands = nativeBands(compiled);
    expect(bands?.table.bands.length).toBe(2);
    for (const band of [0, 1]) for (const b of ['uikit', 'android-views'] as const) expect(layers(nativeBandPrograms(compiled, [], band), b), `band ${band} ${b}`).toEqual([['a', false], ['c', true]]);
    expect(layers(nativePrograms(compiled, []), 'uikit')).toEqual([['a', false], ['c', true]]);
  });
});
