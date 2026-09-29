// The device runner and matrix (notes/T015-p4-review-p5-plan.md sections 3.4 and 4 item 1), without booting anything: the matrix
// covers every device DPR of each target with exactly one device, AVD display keys are pinned, and a device record fails on a scale
// disagreement, a root that does not fit (never cropped) and a text scale other than the pinned one.
import { describe, expect, it } from 'vitest';
import type { DeviceRecord, DeviceSpec } from '../src/device-run.ts';
import { avdKeys, avdScale, DEVICE_MATRIX, judgeGlyphPlant, matrixProblems, PLANT_AXIS, PLANT_DEVICES, PLANT_MARGIN_DEVICE_PX, PLANT_SHIFT_DEVICE_PX, PLANT_SHIFT_SPREAD_DEVICE_PX, recordProblems, TEXT_SCALE, TRUST_CASES, VECTOR_DEVICES } from '../src/device-run.ts';
import { emitNativeSupport, SUPPORT_PLANTS } from 'dragon';
import { GATE_GLYPH_POSITION_DEVICE_PX } from '../src/compare.ts';
import type { GlyphPosition } from '../src/native-compare.ts';
import { layoutCaseIds } from '../src/targets.ts';
import { deviceDprs } from '../src/targets.ts';

// The iOS device type scales as capabilities.plist gives them (iPhone 17 is 3, every iPad 2); the runner reads them from the plist.
const PROFILE: Readonly<Record<string, number>> = { 'iPhone 17': 3, 'iPad (A16)': 2 };
const scaleOf = (d: DeviceSpec): number => (d.target === 'ios' ? (PROFILE[d.name] ?? 0) : avdScale(d));

describe('device matrix', () => {
  it('one device per device DPR of each target, derived from deviceDprs', () => {
    expect(matrixProblems(scaleOf)).toEqual([]);
    for (const t of ['ios', 'android'] as const) expect(DEVICE_MATRIX.filter((d) => d.target === t).map(scaleOf).sort()).toEqual([...deviceDprs(t)].sort());
  });
  it('a dropped device, a duplicated DPR or a device outside the target DPRs is a problem', () => {
    expect(matrixProblems(scaleOf, DEVICE_MATRIX.filter((d) => d.name !== 'dragon-480'))).toEqual(['android DPR 3: 0 devices (none); the matrix needs exactly one']);
    const dup = DEVICE_MATRIX.map((d) => (d.name === 'dragon-320' ? { ...d, density: 480 } : d));
    expect(matrixProblems(scaleOf, dup)).toContainEqual('android DPR 3: 2 devices (dragon-320, dragon-480); the matrix needs exactly one');
    const odd = DEVICE_MATRIX.map((d) => (d.name === 'dragon-smoke' ? { ...d, density: 400 } : d));
    expect(matrixProblems(scaleOf, odd)).toContainEqual('dragon-smoke: scale 2.5 is not one of the android device DPRs (2, 3, 2.625)');
  });
  it('AVDs are addressed by their own console ports; the AVD keys pin density, panel size and the android-36 image', () => {
    const avds = DEVICE_MATRIX.filter((d) => d.target === 'android');
    expect(new Set(avds.map((d) => (d.target === 'android' ? d.port : 0))).size).toBe(avds.length);
    for (const d of avds) {
      if (d.target !== 'android') continue;
      expect(d.port % 2).toBe(0);
      const k = avdKeys(d);
      expect(k.get('hw.lcd.density')).toBe(String(d.density));
      expect(k.get('image.sysdir.1')).toBe('system-images/android-36/default/arm64-v8a/');
      // The panel holds the 400 css px wide root at the device scale.
      expect(d.width).toBeGreaterThanOrEqual(Math.ceil(400 * avdScale(d)));
    }
  });
  it('the vectors, plant and trust devices and cases are in the matrix and the corpus', () => {
    for (const t of ['ios', 'android'] as const) {
      expect(DEVICE_MATRIX.some((d) => d.target === t && d.name === VECTOR_DEVICES[t])).toBe(true);
      expect(DEVICE_MATRIX.some((d) => d.target === t && d.name === PLANT_DEVICES[t])).toBe(true);
    }
    for (const id of TRUST_CASES) expect(layoutCaseIds()).toContain(id);
  });
});

describe('device records', () => {
  const good: DeviceRecord = { name: 'dragon-smoke', target: 'android', model: 'x', os: 'Android 16', build: 'b', profileScale: 2.625, appScale: 2.625, windowPx: [1080, 2400], stagePx: [1080, 2138], rootOriginPx: [0, 136], textScale: TEXT_SCALE.android };
  const root = { width: 1050, height: 788 };
  it('passes when both scales agree, the stage holds the root and the text scale is pinned', () => {
    expect(recordProblems(good, root)).toEqual([]);
  });
  it('names a scale disagreement, a root that does not fit (a tooling fault, never cropped) and an unpinned text scale', () => {
    expect(recordProblems({ ...good, appScale: 2.5 }, root)).toEqual(['dragon-smoke: the device profile scale 2.625 differs from the app\'s 2.5']);
    expect(recordProblems({ ...good, stagePx: [1000, 2138] }, root)[0]).toMatch(/cannot hold the 1050x788 root \(device fit, tooling fault; never cropped\)$/);
    expect(recordProblems({ ...good, textScale: '1.3' }, root)).toEqual(['dragon-smoke: text scale 1.3, pinned 1.0']);
  });
});

describe('raster plants judged against the clean run (T093 ruling A)', () => {
  const G = GATE_GLYPH_POSITION_DEVICE_PX;
  const line = (l: string, axis: 'x' | 'y', native: number, chrome: number): GlyphPosition => ({ line: l, axis, native, chrome });
  const clean = { failures: 0, centres: [line('a:line0', 'x', 100.1, 100), line('a:line0', 'y', 50.2, 50), line('b:line0', 'x', 200, 200.05)] };
  it('the constants and one axis per plant', () => {
    expect([PLANT_SHIFT_DEVICE_PX, PLANT_SHIFT_SPREAD_DEVICE_PX, PLANT_MARGIN_DEVICE_PX]).toEqual([1, 0.05, 0.2]);
    expect(SUPPORT_PLANTS).toEqual(['glyph-offset-1', 'glyph-offset-y-1']);
    expect(PLANT_AXIS).toEqual({ 'glyph-offset-1': 'x', 'glyph-offset-y-1': 'y' });
  });
  it('each plant changes one line of each backend support: its glyph offset constant from 0 to 1', () => {
    for (const backend of ['uikit', 'android-views'] as const) {
      const clean = emitNativeSupport(backend).flatMap((f) => f.text.split('\n'));
      for (const plant of SUPPORT_PLANTS) {
        const planted = emitNativeSupport(backend, plant).flatMap((f) => f.text.split('\n'));
        const changed = planted.flatMap((l, i) => (l === clean[i] ? [] : [[clean[i], l]]));
        expect(changed.length, `${backend} ${plant}`).toBe(1);
        const [from, to] = changed[0] as [string, string];
        expect(from.replace(/= 0(\.0)?$/, '')).toBe(to.replace(/= 1(\.0)?$/, ''));
        expect(from).toMatch(PLANT_AXIS[plant] === 'x' ? /(dragonGlyphPlantDevicePx|DRAGON_GLYPH_PLANT_DEVICE_PX)\b/ : /(dragonGlyphPlantYDevicePx|DRAGON_GLYPH_PLANT_Y_DEVICE_PX)\b/);
      }
    }
  });
  it('caught: every line on the axis moved 1 device px and fails the position check with the margin', () => {
    const v = judgeGlyphPlant('glyph-offset-1', clean, [line('a:line0', 'x', 101.12, 100), line('a:line0', 'y', 50.2, 50), line('b:line0', 'x', 200.98, 200.05)], G);
    expect(v).toMatchObject({ caught: true, problems: [] });
    expect(v.lines.map((l) => l.line)).toEqual(['a:line0', 'b:line0']);
    expect(judgeGlyphPlant('glyph-offset-y-1', clean, [line('a:line0', 'y', 51.21, 50)], G).caught).toBe(true);
  });
  it('not caught: a dirty clean run, a shift off 1 by more than the spread, a thin margin, a missing line or no line', () => {
    const planted = [line('a:line0', 'x', 101.12, 100), line('b:line0', 'x', 200.98, 200.05)];
    expect(judgeGlyphPlant('glyph-offset-1', { ...clean, failures: 2 }, planted, G).problems).toEqual(['the clean run has 2 device-pixels failure(s)']);
    expect(judgeGlyphPlant('glyph-offset-1', clean, [line('a:line0', 'x', 101.2, 100), planted[1] as GlyphPosition], G).problems).toEqual(['a:line0: the glyph centre moved 1.100 device px from the clean run, not 1 within 0.05']);
    // Chrome's centre 0.35 right of the clean native one: the plant's centre error is 0.65, 0.15 beyond the gate.
    const thin = { failures: 0, centres: [line('c:line0', 'x', 10, 10.35)] };
    expect(judgeGlyphPlant('glyph-offset-1', thin, [line('c:line0', 'x', 11, 10.35)], G).problems).toEqual(['c:line0: the position check fails by 0.150 device px beyond the gate, less than 0.2']);
    expect(judgeGlyphPlant('glyph-offset-1', clean, planted.slice(0, 1), G).problems).toEqual(['the planted run measured 1 x position lines, the clean run 2, not the same lines']);
    expect(judgeGlyphPlant('glyph-offset-y-1', clean, [line('a:line0', 'y', 50.9, 50)], G).problems).toEqual(['a:line0: the glyph bottom edge moved 0.700 device px from the clean run, not 1 within 0.05']);
    expect(judgeGlyphPlant('glyph-offset-y-1', { failures: 0, centres: [] }, [], G).problems).toEqual(['no y glyph position line was measured']);
  });
});
