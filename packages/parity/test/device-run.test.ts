// The device runner and matrix (notes/T015-p4-review-p5-plan.md sections 3.4 and 4 item 1), without booting anything: the matrix
// covers every device DPR of each target with exactly one device, AVD display keys are pinned, and a device record fails on a scale
// disagreement, a root that does not fit (never cropped) and a text scale other than the pinned one.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';
import { trustCoverageProblems } from '../src/lanes.ts';
import type { DeviceRecord, DeviceSpec } from '../src/device-run.ts';
import { ANDROID_IMAGE_API, avdKeys, avdScale, DEVICE_MATRIX, liveProblems, matrixProblems, parseAppRecord, spawnDetached, PLANT_DEVICES, recordProblems, TEXT_SCALE, TRUST_CASES, VECTOR_DEVICES } from '../src/device-run.ts';
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
  it('the problems are those of the selected targets only: a bad android entry does not fail an ios-only check', () => {
    const odd = DEVICE_MATRIX.map((d) => (d.name === 'dragon-smoke' ? { ...d, density: 400 } : d));
    expect(matrixProblems(scaleOf, odd, ['ios'])).toEqual([]);
    expect(matrixProblems(scaleOf, odd, ['android'])).toContainEqual('dragon-smoke: scale 2.5 is not one of the android device DPRs (2, 3, 2.625)');
  });
  it('a missing emulator binary is a thrown, catchable error, not an unhandled spawn error', async () => {
    const p = spawnDetached('/nonexistent/dragon-emulator', []);
    await new Promise((r) => setTimeout(r, 200));
    expect(() => p.check()).toThrow(/\/nonexistent\/dragon-emulator could not be started: .*ENOENT/);
  });
  it('only a spawned child still running counts as alive, so a failed boot never kills a serial it does not own', async () => {
    const missing = spawnDetached('/nonexistent/dragon-emulator', []);
    const quick = spawnDetached(process.execPath, ['-e', '']);
    const slow = spawnDetached(process.execPath, ['-e', 'setTimeout(() => {}, 1500)']);
    await new Promise((r) => setTimeout(r, 700));
    expect(missing.alive()).toBe(false);
    expect(quick.alive()).toBe(false);
    expect(slow.alive()).toBe(true);
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
  const good: DeviceRecord = { name: 'dragon-smoke', target: 'android', model: 'Android SDK built for arm64 / dragon-smoke', os: 'Android 16', build: 'b', profileScale: 2.625, appScale: 2.625, windowPx: [1080, 2400], stagePx: [1080, 2138], rootOriginPx: [0, 136], textScale: TEXT_SCALE.android };
  const root = { width: 1050, height: 788 };
  it('passes when both scales agree, the stage holds the root and the text scale is pinned', () => {
    expect(recordProblems(good, root)).toEqual([]);
  });
  it('names a scale disagreement, a root that does not fit (a tooling fault, never cropped) and an unpinned text scale', () => {
    expect(recordProblems({ ...good, appScale: 2.5 }, root)).toEqual(['dragon-smoke: the device profile scale 2.625 differs from the app\'s 2.5']);
    expect(recordProblems({ ...good, stagePx: [1000, 2138] }, root)[0]).toMatch(/cannot hold the 1050x788 root \(device fit, tooling fault; never cropped\)$/);
    expect(recordProblems({ ...good, textScale: '1.3' }, root)).toEqual(['dragon-smoke: text scale 1.3, pinned 1.0']);
    expect(recordProblems({ ...good, model: 'Android SDK built for arm64 / dragon-320' }, root)).toEqual(['dragon-smoke: the app ran on "Android SDK built for arm64 / dragon-320", not dragon-smoke']);
    expect(recordProblems({ ...good, target: 'ios', name: 'iPhone 17', model: 'iPad (A16)', textScale: TEXT_SCALE.ios }, root)).toEqual(['iPhone 17: the app ran on "iPad (A16)", not iPhone 17']);
  });
});

describe('the device CLIs refuse an unknown --target', () => {
  it.each([['native-devices.ts', 'foo'], ['native-devices.ts', null], ['lanes.ts', 'web']] as const)('%s --target %s exits 2 before running anything', (cli, value) => {
    const r = spawnSync(process.execPath, ['--conditions=dragon-internal', repoPath(`packages/parity/src/cli/${cli}`), '--target', ...(value === null ? [] : [value])], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--target takes ios or android/);
  });
});

describe('round 6: live devices and device records', () => {
  const smoke = DEVICE_MATRIX.find((d) => d.name === 'dragon-smoke');
  if (smoke === undefined || smoke.target !== 'android') throw new Error('no dragon-smoke');
  const live = { name: 'dragon-smoke', size: `${smoke.width}x${smoke.height}`, density: String(smoke.density), sdk: String(ANDROID_IMAGE_API) };
  it('a running emulator is the matrix device only with its live name, display, density and API level', () => {
    expect(ANDROID_IMAGE_API).toBe(36);
    expect(liveProblems(smoke, live, ANDROID_IMAGE_API)).toEqual([]);
    expect(liveProblems(smoke, { ...live, size: '1080x1920' }, ANDROID_IMAGE_API)).toEqual(['display 1080x1920, the matrix 1080x2400']);
    expect(liveProblems(smoke, { ...live, density: '440' }, ANDROID_IMAGE_API)).toEqual(['density 440, the matrix 420']);
    expect(liveProblems(smoke, { ...live, sdk: '35' }, ANDROID_IMAGE_API)).toEqual(['API 35, the image 36']);
    expect(liveProblems(smoke, { ...live, name: 'dragon-320' }, ANDROID_IMAGE_API)).toEqual(['it runs the AVD "dragon-320", not dragon-smoke']);
    // The floor probe AVD is outside the matrix: its name only.
    expect(liveProblems({ ...smoke, name: 'dragon-api31' }, { ...live, name: 'dragon-api31', sdk: '31' }, null)).toEqual([]);
  });
  const rec = { platform: 'android', model: 'Android SDK built for arm64 / dragon-smoke', os: 'Android 16', build: 'b', scale: 2.625, densityDpi: 420, windowPx: [1080, 2400], stagePx: [1080, 2138], rootOriginPx: [0, 136], textScale: '1.0' };
  it('the app device record is checked field by field', () => {
    expect(parseAppRecord(JSON.stringify(rec), 'android').scale).toBe(2.625);
    expect(() => parseAppRecord(JSON.stringify(rec), 'ios')).toThrow(/platform "android", the target ios/);
    expect(() => parseAppRecord(JSON.stringify({ ...rec, stagePx: undefined }), 'android')).toThrow(/stagePx is not two whole non-negative device px/);
    expect(() => parseAppRecord(JSON.stringify({ ...rec, rootOriginPx: [0, -1] }), 'android')).toThrow(/rootOriginPx/);
    expect(() => parseAppRecord(JSON.stringify({ ...rec, scale: 0 }), 'android')).toThrow(/scale is not a positive number/);
    expect(() => parseAppRecord(JSON.stringify({ ...rec, extra: 1 }), 'android')).toThrow(/unknown key extra/);
    expect(() => parseAppRecord('{"platform":', 'android')).toThrow(/not JSON/);
  });
  it('capture trust must have run at every declared DPR over every trust case', () => {
    const rows = TRUST_CASES.map((c) => ({ case: c, points: 10, mismatches: [] }));
    expect(trustCoverageProblems([2, 3], [{ device: 'a', dpr: 2, rows }, { device: 'b', dpr: 3, rows }])).toEqual([]);
    expect(trustCoverageProblems([2, 3], [{ device: 'a', dpr: 2, rows }])).toEqual(['capture trust did not run at DPR 3']);
    expect(trustCoverageProblems([2], [{ device: 'a', dpr: 2, rows: rows.slice(1) }])[0]).toMatch(/^capture trust at DPR 2 covered /);
  });
});
