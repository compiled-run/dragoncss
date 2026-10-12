// The device runner and matrix (notes/T015-p4-review-p5-plan.md sections 3.4 and 4 item 1), without booting anything: the matrix
// covers every device DPR of each target with exactly one device, AVD display keys are pinned, and a device record fails on a scale
// disagreement, a root that does not fit (never cropped) and a text scale other than the pinned one.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';
import { trustCoverageProblems } from '../src/lanes.ts';
import type { AvdDeviceSpec, DeviceRecord, DeviceSpec, GoldenParts } from '../src/device-run.ts';
import type { SettleState } from '../src/device-run.ts';
import { ANDROID_RENDERER, avdDir, dropGolden, deviceRecord, dropSuspect, emulatorArgs, failedAttemptStep, GOLDEN_SNAPSHOT, goldenEnabled, GUEST_TIMEZONE, IOS_SPRINGBOARD_PINS, snapshotLoadFailed, goldenCurrent, goldenKey, goldenKeyFile, springboardPinsToWrite } from '../src/device-run.ts';
import { installWithRetries, ToolingFault, transientInstallFailure, SYSTEMUI_RESTART_AFTER, systemUiRestart } from '../src/device-run.ts';
import type { ExecResult } from '../src/device-exec.ts';
import { ANDROID_IMAGE_API, avdKeys, parseWindowFocus, SETTLE_SAMPLES, SETTLE_START, settleStep, settleTimeoutMessage, avdScale, DEVICE_MATRIX, isGlyphPlant, isLinePlant, isPaintPlant, judgeGlyphPlant, judgeLinePlant, LINE_PLANT_CASE, liveProblems, matrixProblems, parseAppRecord, spawnDetached, PLANT_AXIS, PLANT_CASES, PLANT_DEVICES, PLANT_RULES, PLANT_MARGIN_DEVICE_PX, PLANT_SHIFT_DEVICE_PX, PLANT_SHIFT_SPREAD_DEVICE_PX, recordProblems, TEXT_SCALE, TRUST_CASES, VECTOR_DEVICES } from '../src/device-run.ts';
import { emitNativeSupport, SUPPORT_PLANTS } from 'dragon';
import { paintPlants } from '../../dragon/src/emit/paint/registry.ts';
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
    expect(recordProblems({ ...good, stagePx: [1000, 2138] }, root)[0]).toMatch(/cannot hold the 1050x788 root \(device fit; never cropped\)$/);
    expect(recordProblems({ ...good, textScale: '1.3' }, root)).toEqual(['dragon-smoke: text scale 1.3, pinned 1.0']);
    expect(recordProblems({ ...good, model: 'Android SDK built for arm64 / dragon-320' }, root)).toEqual(['dragon-smoke: the app ran on "Android SDK built for arm64 / dragon-320", not dragon-smoke']);
    expect(recordProblems({ ...good, target: 'ios', name: 'iPhone 17', model: 'iPad (A16)', textScale: TEXT_SCALE.ios }, root)).toEqual(['iPhone 17: the app ran on "iPad (A16)", not iPhone 17']);
  });
});

describe('the device CLIs refuse an unknown --target', () => {
  it.each([['native-devices.ts', 'foo'], ['native-devices.ts', null], ['lanes.ts', 'web'], ['glyph-b3.ts', 'web'], ['glyph-b3.ts', null]] as const)('%s --target %s exits 2 before running anything', (cli, value) => {
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

describe('raster plants judged against the clean run (T093 ruling A)', () => {
  const G = GATE_GLYPH_POSITION_DEVICE_PX;
  const line = (l: string, axis: 'x' | 'y', native: number, chrome: number): GlyphPosition => ({ line: l, axis, native, chrome });
  const clean = { failures: 0, centres: [line('a:line0', 'x', 100.1, 100), line('a:line0', 'y', 50.2, 50), line('b:line0', 'x', 200, 200.05)] };
  const ok = { hostErrors: [], frames: 0, lines: 0 };
  it('the constants and one axis per plant', () => {
    expect([PLANT_SHIFT_DEVICE_PX, PLANT_SHIFT_SPREAD_DEVICE_PX, PLANT_MARGIN_DEVICE_PX]).toEqual([1, 0.05, 0.2]);
    // PIN-DERIVE: the plant lists are floored in dragon test/paint-seams.test.ts; here the glyph plants lead, and every paint
    // module plant is a support plant with its case list and rule.
    const paint = paintPlants().map((p) => p.name);
    expect(SUPPORT_PLANTS.slice(0, 2 + paint.length)).toEqual(['glyph-offset-1', 'glyph-offset-y-1', ...paint]);
    expect(SUPPORT_PLANTS.filter(isGlyphPlant)).toEqual(['glyph-offset-1', 'glyph-offset-y-1']);
    expect(paint).toEqual(expect.arrayContaining(['dash-phase-1', 'dash-gap-unfitted']));
    expect(Object.keys(PLANT_CASES)).toEqual(paint);
    expect(Object.keys(PLANT_RULES)).toEqual(paint);
    // INL1a: the line plant is appended after them; it is neither a glyph plant nor a paint plant.
    expect(SUPPORT_PLANTS.filter(isLinePlant)).toEqual(['single-run-baseline']);
    expect(SUPPORT_PLANTS.filter(isPaintPlant)).toEqual(paint);
    // REPL-a: image-offset-1, the image paint module's raster plant, is judged on image-flat and edge rules, never border rules.
    expect(PLANT_RULES['image-offset-1'].test('image-flat:a1:0') && PLANT_RULES['image-offset-1'].test('edge:a1:top') && !PLANT_RULES['image-offset-1'].test('border:a1:top')).toBe(true);
    expect(PLANT_AXIS).toEqual({ 'glyph-offset-1': 'x', 'glyph-offset-y-1': 'y' });
    expect(SUPPORT_PLANTS.filter(isGlyphPlant)).toEqual(['glyph-offset-1', 'glyph-offset-y-1']);
  });
  it('each plant changes one line of each backend support: its glyph or image offset constant from 0 to 1', () => {
    for (const backend of ['uikit', 'android-views'] as const) {
      const clean = emitNativeSupport(backend).flatMap((f) => f.text.split('\n'));
      for (const plant of SUPPORT_PLANTS.filter(isGlyphPlant)) {
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
    const v = judgeGlyphPlant('glyph-offset-1', clean, [line('a:line0', 'x', 101.12, 100), line('a:line0', 'y', 50.2, 50), line('b:line0', 'x', 200.98, 200.05)], G, ok);
    expect(v).toMatchObject({ caught: true, problems: [] });
    expect(v.lines.map((l) => l.line)).toEqual(['a:line0', 'b:line0']);
    expect(judgeGlyphPlant('glyph-offset-y-1', clean, [line('a:line0', 'y', 51.21, 50)], G, ok).caught).toBe(true);
  });
  it('not caught: a dirty clean run, a shift off 1 by more than the spread, a thin margin, a missing line or no line', () => {
    const planted = [line('a:line0', 'x', 101.12, 100), line('b:line0', 'x', 200.98, 200.05)];
    expect(judgeGlyphPlant('glyph-offset-1', { ...clean, failures: 2 }, planted, G, ok).problems).toEqual(['the clean run has 2 device-pixels failure(s)']);
    expect(judgeGlyphPlant('glyph-offset-1', clean, [line('a:line0', 'x', 101.2, 100), planted[1] as GlyphPosition], G, ok).problems).toEqual(['a:line0: the glyph centre moved 1.100 device px from the clean run, not 1 within 0.05']);
    // Chrome's centre 0.35 right of the clean native one: the plant's centre error is 0.65, 0.15 beyond the gate.
    const thin = { failures: 0, centres: [line('c:line0', 'x', 10, 10.35)] };
    expect(judgeGlyphPlant('glyph-offset-1', thin, [line('c:line0', 'x', 11, 10.35)], G, ok).problems).toEqual(['c:line0: the position check fails by 0.150 device px beyond the gate, less than 0.2']);
    expect(judgeGlyphPlant('glyph-offset-1', clean, planted.slice(0, 1), G, ok).problems).toEqual(['the planted run measured 1 x position lines, the clean run 2, not the same lines']);
    expect(judgeGlyphPlant('glyph-offset-y-1', clean, [line('a:line0', 'y', 50.9, 50)], G, ok).problems).toEqual(['a:line0: the glyph bottom edge moved 0.700 device px from the clean run, not 1 within 0.05']);
    expect(judgeGlyphPlant('glyph-offset-y-1', { failures: 0, centres: [] }, [], G, ok).problems).toEqual(['no y glyph position line was measured']);
  });
  it('not caught: a host that did not finish, or a device-frames or device-lines failure in either run', () => {
    const planted = [line('a:line0', 'x', 101.12, 100), line('b:line0', 'x', 200.98, 200.05)];
    expect(judgeGlyphPlant('glyph-offset-1', clean, planted, G, { ...ok, hostErrors: ['the planted host did not finish: timed out'] })).toMatchObject({ caught: false, problems: ['the planted host did not finish: timed out'] });
    expect(judgeGlyphPlant('glyph-offset-1', clean, planted, G, { ...ok, frames: 1 })).toMatchObject({ caught: false, problems: ['device-frames has 1 failure(s) across the two runs'] });
    expect(judgeGlyphPlant('glyph-offset-1', clean, planted, G, { ...ok, lines: 2 })).toMatchObject({ caught: false, problems: ['device-lines has 2 failure(s) across the two runs'] });
  });
});

describe('an AVD settles on the home screen before the app starts (T112)', () => {
  // As `dumpsys window | grep -E 'mCurrentFocus=|mFocusedApp='` prints them on the API 36 image.
  const home = (w = 'd83b36a'): string => `  mCurrentFocus=Window{${w} u0 com.android.launcher3/com.android.launcher3.uioverrides.QuickstepLauncher}\n  mFocusedApp=ActivityRecord{143482133 u0 com.android.launcher3/.uioverrides.QuickstepLauncher t12}\n`;
  const anr = '  mCurrentFocus=Window{1a2b u0 Application Not Responding: com.android.systemui}\n  mFocusedApp=ActivityRecord{9 u0 com.android.launcher3/.uioverrides.QuickstepLauncher t12}\n';
  const booting = '  mCurrentFocus=null\n  mFocusedApp=null\n';
  const feed = (samples: readonly string[], need = SETTLE_SAMPLES): { readonly state: SettleState; readonly actions: string[] } => {
    let state = SETTLE_START;
    const actions: string[] = [];
    for (const s of samples) {
      const step = settleStep(state, s, need);
      state = step.state;
      actions.push(step.action);
    }
    return { state, actions };
  };

  it('reads both focus lines, and nothing from output without both, with an empty value or with two different values', () => {
    expect(parseWindowFocus(home())).toEqual({ currentFocus: 'Window{d83b36a u0 com.android.launcher3/com.android.launcher3.uioverrides.QuickstepLauncher}', focusedApp: 'ActivityRecord{143482133 u0 com.android.launcher3/.uioverrides.QuickstepLauncher t12}' });
    expect(parseWindowFocus(home() + home())).not.toBeNull();
    expect(parseWindowFocus('')).toBeNull();
    expect(parseWindowFocus('adb exited 1: error: device offline')).toBeNull();
    expect(parseWindowFocus('  mCurrentFocus=Window{d83b36a u0 com.android.launcher3/x.Launcher}\n')).toBeNull();
    expect(parseWindowFocus('  mCurrentFocus=\n  mFocusedApp=ActivityRecord{1 u0 a/.Launcher t1}\n')).toBeNull();
    expect(parseWindowFocus(home('aaa') + home('bbb'))).toBeNull();
  });
  it('a stable launcher focus is done after exactly SETTLE_SAMPLES samples in a row', () => {
    const { actions, state } = feed(Array.from({ length: SETTLE_SAMPLES }, () => home()));
    expect(actions).toEqual([...Array.from({ length: SETTLE_SAMPLES - 1 }, () => 'wait'), 'done']);
    expect(state.stable).toBe(SETTLE_SAMPLES);
    expect(SETTLE_SAMPLES).toBeGreaterThanOrEqual(2);
  });
  it('before the launcher: HOME while something else has the focus, BACK on an error dialog, and the run counts from the launcher', () => {
    const { actions } = feed([booting, anr, booting, ...Array.from({ length: 3 }, () => home())], 3);
    expect(actions).toEqual(['home', 'back', 'home', 'wait', 'wait', 'done']);
  });
  it('a flapping focus (the launcher window recreated, or leaving and returning) restarts the run and never settles', () => {
    const flap = feed(Array.from({ length: 40 }, (_, i) => home(i % 2 === 0 ? 'aaa' : 'bbb')), 3);
    expect(flap.actions).not.toContain('done');
    expect(flap.state.stable).toBe(1);
    expect(flap.state.changes).toBe(39);
    const away = feed([home(), home(), booting, home(), home()], 3);
    expect(away.actions).toEqual(['wait', 'wait', 'home', 'wait', 'wait']);
    const app = feed([home(), home(), home().replace(/t12/, 't13'), home().replace(/t12/, 't13')], 3);
    expect(app.actions).toEqual(['wait', 'wait', 'wait', 'wait']);
  });
  it('unparseable output never counts toward the run and breaks it', () => {
    const { actions, state } = feed([home(), home(), 'adb exited 1: ', home(), home(), home()], 3);
    expect(actions).toEqual(['wait', 'wait', 'wait', 'wait', 'wait', 'done']);
    expect(state.unparseable).toBe(1);
  });
  it('an error dialog that outlives SYSTEMUI_RESTART_AFTER BACK presses gets System UI restarted, again each time it stays', () => {
    const { actions, state } = feed([...Array.from({ length: 2 * SYSTEMUI_RESTART_AFTER }, () => anr), home(), home(), home()], 3);
    const back = Array.from({ length: SYSTEMUI_RESTART_AFTER - 1 }, () => 'back');
    expect(actions).toEqual([...back, 'restart-systemui', ...back, 'restart-systemui', 'wait', 'wait', 'done']);
    expect(state.restarts).toBe(2);
    // The dialog run counts only dialogs in a row: one cleared by BACK starts the count again.
    const cleared = feed([...Array.from({ length: SYSTEMUI_RESTART_AFTER - 1 }, () => anr), booting, anr], 3);
    expect(cleared.actions.filter((a) => a === 'restart-systemui')).toEqual([]);
    expect(cleared.state.dialogs).toBe(1);
    // The first restart is the documented am crash after closing the system dialogs; later ones also kill System UI as root.
    expect(systemUiRestart(1)).toEqual([['am', 'broadcast', '-a', 'android.intent.action.CLOSE_SYSTEM_DIALOGS'], ['am', 'crash', 'com.android.systemui']]);
    expect(systemUiRestart(2).slice(0, 2)).toEqual(systemUiRestart(1));
    expect(systemUiRestart(2)[2]).toEqual(['su', '0', 'sh', '-c', "'kill -9 $(pidof com.android.systemui)'"]);
    expect(settleTimeoutMessage('emulator-5584', 300_000, state, 3)).toMatch(/, 2 System UI restarts$/);
  });
  it('the timeout names the state it last read: the focus and its run, or the unparseable output', () => {
    const flap = feed([home('aaa'), home('bbb')], 3).state;
    expect(settleTimeoutMessage('emulator-5582', 300_000, flap, 3)).toBe('emulator-5582 did not settle on the home screen within 300 s (tooling fault): the last focus was mCurrentFocus=Window{bbb u0 com.android.launcher3/com.android.launcher3.uioverrides.QuickstepLauncher} mFocusedApp=ActivityRecord{143482133 u0 com.android.launcher3/.uioverrides.QuickstepLauncher t12}, held for 1 of 3 samples; 2 samples, 1 focus changes, 0 unparseable');
    const bad = feed(['adb exited 1: error: device offline'], 3).state;
    expect(settleTimeoutMessage('emulator-5582', 300_000, bad, 3)).toBe('emulator-5582 did not settle on the home screen within 300 s (tooling fault): the last dumpsys window output had no single mCurrentFocus and mFocusedApp: "adb exited 1: error: device offline"; 1 samples, 0 focus changes, 1 unparseable');
    expect(settleTimeoutMessage('emulator-5582', 300_000, SETTLE_START)).toMatch(/no sample was read/);
  });
});

describe('installs retried on a transient failure', () => {
  const result = (out: string, ok = false, extra: Partial<ExecResult> = {}): ExecResult => ({ cmd: 'adb install', status: ok ? 0 : 1, signal: null, error: null, errorCode: null, stdout: out, stderr: '', out, ok, ...extra });
  it('names the transient adb and simctl errors, and nothing else', () => {
    expect(transientInstallFailure('android', result('adb: device offline'))).toBe('device offline');
    expect(transientInstallFailure('android', result("cmd: Can't find service: package"))).toBe('package service unavailable');
    expect(transientInstallFailure('android', result('adb: error: closed'))).toBe('adb connection dropped');
    expect(transientInstallFailure('android', result('', false, { errorCode: 'ETIMEDOUT', signal: 'SIGKILL' }))).toBe('install timed out');
    expect(transientInstallFailure('ios', result('An error was encountered processing the command (domain=NSMachErrorDomain, code=-308)'))).toBe('CoreSimulator connection');
    expect(transientInstallFailure('ios', result('Unable to lookup in current state: Booting'))).toBe('simulator still booting');
    expect(transientInstallFailure('ios', result('CoreSimulatorService connection became invalid.'))).toBe('CoreSimulator connection');
    // Only the named codes: another Mach error, or a simulator shut down, is not retried.
    expect(transientInstallFailure('ios', result('(domain=NSMachErrorDomain, code=-3080)'))).toBeNull();
    expect(transientInstallFailure('ios', result('Unable to lookup in current state: Shutdown'))).toBeNull();
    // An app the device refuses is the tree's app at fault: never retried.
    expect(transientInstallFailure('android', result('Failure [INSTALL_PARSE_FAILED_MANIFEST_MALFORMED]'))).toBeNull();
    expect(transientInstallFailure('ios', result('Missing bundle ID'))).toBeNull();
    expect(transientInstallFailure('android', result('device offline', true))).toBeNull();
  });
  const run = async (outs: ExecResult[]) => {
    const logs: string[] = [];
    const waits: number[] = [];
    let calls = 0;
    const r = installWithRetries('android', 'adb install', () => outs[Math.min(calls++, outs.length - 1)]!, { log: (l) => void logs.push(l), wait: async (ms) => void waits.push(ms) });
    return { r, logs, waits, calls: () => calls };
  };
  it('retries a transient failure, logging the error, and returns the first success', async () => {
    const x = await run([result('error: device offline'), result('Success', true)]);
    expect((await x.r).out).toBe('Success');
    expect(x.calls()).toBe(2);
    expect(x.waits).toEqual([10_000]);
    expect(x.logs).toEqual(['adb install failed with a transient error (device offline), attempt 1 of 3; retrying in 10 s: error: device offline']);
  });
  it('a transient failure on the last of three attempts is a tooling fault; any other failure throws at once as the tree\'s', async () => {
    const x = await run([result('error: device offline')]);
    const e = await x.r.catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ToolingFault);
    expect((e as Error).message).toBe('adb install failed 3 times with a transient error (device offline; tooling fault): error: device offline');
    expect(x.calls()).toBe(3);
    const y = await run([result('Failure [INSTALL_PARSE_FAILED_MANIFEST_MALFORMED]')]);
    const f = await y.r.catch((err: unknown) => err);
    expect(f).not.toBeInstanceOf(ToolingFault);
    expect((f as Error).message).toBe('adb install failed: Failure [INSTALL_PARSE_FAILED_MANIFEST_MALFORMED]');
    expect(y.calls()).toBe(1);
  });
});

describe('the single-run-baseline line plant judged against the clean run (INL1a, T058J3 F)', () => {
  const G = GATE_GLYPH_POSITION_DEVICE_PX;
  const ok = { hostErrors: [], frames: 0, lines: 0 };
  const bl = (line: string, baseline: number) => ({ line, baseline });
  const bottom = (l: string, native: number, chrome: number): GlyphPosition => ({ line: l, axis: 'y', native, chrome });
  const clean = { failures: 0, baselines: [bl('t:line0', 40), bl('t:line1', 70)], bottoms: [bottom('t:line0', 48, 48), bottom('t:line1', 78, 78.1)] };
  it('the plant is one constant from 0 to 1 in each backend support, and runs LINE_PLANT_CASE', () => {
    expect(LINE_PLANT_CASE).toBe('inline-baselines');
    for (const backend of ['uikit', 'android-views'] as const) {
      const base = emitNativeSupport(backend).flatMap((f) => f.text.split('\n'));
      const planted = emitNativeSupport(backend, 'single-run-baseline').flatMap((f) => f.text.split('\n'));
      const changed = planted.flatMap((l, i) => (l === base[i] ? [] : [[base[i], l]]));
      expect(changed.length, backend).toBe(1);
      expect((changed[0] as [string, string])[0]).toMatch(/(dragonSingleRunBaselinePlant: Double|DRAGON_SINGLE_RUN_BASELINE_PLANT) = 0(\.0)?$/);
    }
  });
  it('caught: a later line moved by whole device px, and its glyph bottom edge moved with it past the gate', () => {
    const v = judgeLinePlant(clean, { baselines: [bl('t:line0', 40), bl('t:line1', 66)], bottoms: [bottom('t:line0', 48, 48), bottom('t:line1', 74, 78.1)] }, G, ok);
    expect(v).toMatchObject({ caught: true, problems: [] });
    expect(v.lines.map((l) => l.line)).toEqual(['t:line1']);
  });
  it('not caught: nothing moved, a first line moved, pixels did not follow, a dirty run, or different lines', () => {
    expect(judgeLinePlant(clean, { baselines: clean.baselines, bottoms: clean.bottoms }, G, ok).problems).toEqual(['no line baseline moved by a whole device px']);
    expect(judgeLinePlant(clean, { baselines: [bl('t:line0', 41), bl('t:line1', 66)], bottoms: [bottom('t:line1', 74, 78.1)] }, G, ok).problems).toEqual(['t:line0: a first line\'s baseline moved 1 device px']);
    expect(judgeLinePlant(clean, { baselines: [bl('t:line0', 40), bl('t:line1', 66)], bottoms: [bottom('t:line1', 78, 78.1)] }, G, ok).problems).toEqual(['t:line1: the glyph bottom edge moved 0.000 device px, the baseline -4', 't:line1: the position check fails by -0.400 device px beyond the gate, less than 0.2']);
    expect(judgeLinePlant({ ...clean, failures: 1 }, { baselines: [bl('t:line0', 40), bl('t:line1', 66)], bottoms: [bottom('t:line1', 74, 78.1)] }, G, { ...ok, frames: 1 }).problems).toEqual(['device-frames has 1 failure(s) across the two runs', 'the clean run has 1 device-pixels failure(s)']);
    expect(judgeLinePlant(clean, { baselines: [bl('t:line0', 40)], bottoms: [] }, G, ok).problems).toEqual(['the planted run dumped 1 text lines, the clean run 2, not the same lines']);
  });
});

// DEVICE-SPEED (b): a matrix AVD quickboots from its golden snapshot, taken after a cold boot and prepareAvd, while its key is current.
describe('the golden snapshot (Android quickboot)', () => {
  const avd = DEVICE_MATRIX.find((d) => d.target === 'android') as AvdDeviceSpec;
  const parts: GoldenParts = { emulator: 'Android emulator version 37.1.11.0', image: 'system-images;android-36;default;arm64-v8a', imageProperties: 'Pkg.Revision=2\n', config: 'hw.lcd.density=320\n', flags: emulatorArgs(avd, true), provision: 'async function prepareAvd() {}' };

  it('a cold boot saves nothing; a quickboot forces the golden snapshot and saves nothing back; both keep the pinned renderer', () => {
    const cold = emulatorArgs(avd, false);
    const quick = emulatorArgs(avd, true);
    // Both pin the guest timezone, so neither boot takes the host's.
    expect(cold).toEqual(['-avd', avd.name, '-port', String(avd.port), '-no-snapshot', '-no-window', '-no-audio', '-no-boot-anim', '-gpu', ANDROID_RENDERER, '-timezone', GUEST_TIMEZONE]);
    expect(quick).toEqual(['-avd', avd.name, '-port', String(avd.port), '-snapshot', GOLDEN_SNAPSHOT, '-force-snapshot-load', '-no-snapshot-save', '-no-window', '-no-audio', '-no-boot-anim', '-gpu', ANDROID_RENDERER, '-timezone', GUEST_TIMEZONE]);
    expect(ANDROID_RENDERER).toBe('swiftshader_indirect');
  });

  it('the key changes with the emulator, the image, its properties, the AVD config, the flags or the provisioning code', () => {
    const k = goldenKey(parts);
    expect(goldenKey({ ...parts })).toBe(k);
    for (const [field, v] of [['emulator', 'Android emulator version 37.2.0.0'], ['image', 'system-images;android-36;default;x86_64'], ['imageProperties', 'Pkg.Revision=3\n'], ['config', 'hw.lcd.density=420\n'], ['flags', emulatorArgs(avd, false)], ['provision', 'async function prepareAvd() { step(); }']] as const) {
      expect(goldenKey({ ...parts, [field]: v }), field).not.toBe(k);
    }
  });

  it('a snapshot is loaded only with its snapshot data and its recorded key equal to the current one; a dropped one never is', () => {
    const home = mkdtempSync(join(tmpdir(), 'dragon-golden-'));
    const was = process.env['HOME'];
    process.env['HOME'] = home;
    try {
      expect(avdDir(avd.name).startsWith(home)).toBe(true);
      mkdirSync(avdDir(avd.name), { recursive: true });
      const key = goldenKey(parts);
      expect(goldenCurrent(avd.name, key)).toBe(false);
      writeFileSync(goldenKeyFile(avd.name), `${key}\n`);
      // A key with no snapshot data (a save that never finished) is not loaded.
      expect(goldenCurrent(avd.name, key)).toBe(false);
      mkdirSync(join(avdDir(avd.name), 'snapshots', GOLDEN_SNAPSHOT), { recursive: true });
      writeFileSync(join(avdDir(avd.name), 'snapshots', GOLDEN_SNAPSHOT, 'snapshot.pb'), 'x');
      expect(goldenCurrent(avd.name, key)).toBe(true);
      expect(goldenCurrent(avd.name, goldenKey({ ...parts, config: 'hw.lcd.density=480\n' }))).toBe(false);
      dropGolden(avd.name);
      expect(goldenCurrent(avd.name, key)).toBe(false);
    } finally {
      process.env['HOME'] = was;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('the device record names how an AVD came up; an iOS profile (and an older record) has no boot field', () => {
    const app = { platform: 'android' as const, model: 'sdk_gphone / dragon-320', os: 'Android 16', build: 'B', scale: 2, windowPx: [1080, 2400] as const, stagePx: [1080, 2168] as const, rootOriginPx: [0, 136] as const, textScale: '1.0' };
    const prof = { name: 'dragon-320', target: 'android' as const, os: 'Android 16 (API 36)', build: 'B', profileScale: 2 };
    expect(deviceRecord({ ...prof, boot: 'snapshot' }, app).boot).toBe('snapshot');
    expect(deviceRecord({ ...prof, boot: 'cold' }, app).boot).toBe('cold');
    expect('boot' in deviceRecord(prof, app)).toBe(false);
  });

  it('a CI runner (fresh every job) neither loads nor saves a snapshot; this Mac does', () => {
    expect(goldenEnabled({ CI: 'true' })).toBe(false);
    expect(goldenEnabled({})).toBe(true);
    expect(goldenEnabled({ CI: 'false' })).toBe(true);
  });

  it('a snapshot that fails to boot is dropped and the retry is cold, even when the forced load made the emulator exit', () => {
    // A forced load that fails exits the emulator: the first attempt retries cold, dropping the snapshot at once.
    expect(failedAttemptStep(true, false, 1, true)).toEqual({ dropGolden: true, suspect: false, next: 'retry' });
    expect(failedAttemptStep(true, true, 1)).toEqual({ dropGolden: true, suspect: false, next: 'stop-then-retry' });
    expect(snapshotLoadFailed('ERROR | Failed to load snapshot dragon-golden | exiting')).toBe(true);
    expect(snapshotLoadFailed('WARNING | Snapshot dragon-golden can not be loaded (incompatible)')).toBe(true);
    expect(snapshotLoadFailed('ERROR | Port 5580 is already in use')).toBe(false);
    expect(snapshotLoadFailed('INFO | loading snapshot dragon-golden')).toBe(false);
    // A cold attempt keeps today's rules: an exited emulator is left alone, a live one is stopped and retried once.
    expect(failedAttemptStep(false, false, 1)).toEqual({ dropGolden: false, suspect: false, next: 'left-alone' });
    expect(failedAttemptStep(false, true, 1)).toEqual({ dropGolden: false, suspect: false, next: 'stop-then-retry' });
    expect(failedAttemptStep(false, false, 2)).toEqual({ dropGolden: false, suspect: false, next: 'left-alone' });
    expect(failedAttemptStep(false, true, 2)).toEqual({ dropGolden: false, suspect: false, next: 'stop-then-fail' });
  });

  it('an unexplained exit from the snapshot (a truncated snapshot that crashes) never wedges the AVD: the retry is cold, and the snapshot goes only if that boots', () => {
    // No load-failure line in the log: the snapshot is a suspect, kept for now, and the retry is cold.
    const step = failedAttemptStep(true, false, 1, false);
    expect(step).toEqual({ dropGolden: false, suspect: true, next: 'retry' });
    // The cold retry booted: the snapshot was the cause, so it is dropped (and retaken).
    expect(dropSuspect(step.suspect, true)).toBe(true);
    // The cold retry failed too (a taken port, a full disk): the environment is the cause, so the snapshot is kept.
    expect(dropSuspect(step.suspect, false)).toBe(false);
    expect(failedAttemptStep(false, false, 2)).toEqual({ dropGolden: false, suspect: false, next: 'left-alone' });
    // The loop follows these rules: the retry after any snapshot attempt is cold, and a suspect is dropped only after a boot.
    const src = readFileSync(repoPath('packages/parity/src/device-run.ts'), 'utf8');
    expect(src).toContain("if (golden && step.next !== 'left-alone') golden = false;");
    const booted = src.indexOf("console.log(`${serial}: ${golden ? `booted from the golden snapshot");
    const dropped = src.indexOf('if (dropSuspect(suspect, true)) {');
    expect(booted).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThan(booted);
    expect(src.slice(src.indexOf('async function bootAvdHeld'), booted)).not.toContain('dropSuspect(');
  });

  it('every emulator boot of the runner goes through emulatorArgs, so none can drop the renderer or save into the snapshot', () => {
    const src = readFileSync(repoPath('packages/parity/src/device-run.ts'), 'utf8');
    expect(src.match(/spawnDetached\(tools\.emulator, /g)).toHaveLength(1);
    expect(src).toContain('spawnDetached(tools.emulator, emulatorArgs(spec, golden), log)');
    // The snapshot is written only by saveGolden, right after a cold boot and prepareAvd, and the device settles again after it.
    expect(src.match(/'snapshot', 'save'/g)).toHaveLength(1);
    expect(src).toMatch(/await saveGolden\(h, key, [^\n]*\n {2}await waitForSettledFocus\(h\);/);
    expect(src).toContain('if (key !== null && !golden) await saveGoldenAndSettle(');
    expect(src).toMatch(/provision: \[prepareAvd, waitForSettledFocus, saveGolden, saveGoldenAndSettle,/);
  });
});

describe('the simulators run in Full Screen Apps (iPadOS 26 Windowed Apps kept the host in a scaled window)', () => {
  it('writes every pin a simulator does not hold as 0', () => {
    expect(IOS_SPRINGBOARD_PINS).toEqual(['SBMedusaMultitaskingEnabled', 'SBChamoisWindowingEnabled']);
    expect(springboardPinsToWrite(() => null)).toEqual([...IOS_SPRINGBOARD_PINS]);
    expect(springboardPinsToWrite(() => '0\n')).toEqual([]);
    expect(springboardPinsToWrite((k) => (k === 'SBChamoisWindowingEnabled' ? '1\n' : '0\n'))).toEqual(['SBChamoisWindowingEnabled']);
    expect(springboardPinsToWrite(() => '')).toEqual([...IOS_SPRINGBOARD_PINS]);
  });

  it('pins the mode on every iOS boot, rebooting once and reading the pins back, before the app is installed', () => {
    const src = readFileSync(repoPath('packages/parity/src/device-run.ts'), 'utf8');
    expect(src).toMatch(/ {2}await pinFullScreenApps\(spec, udid\);\n {2}exec\('xcrun', \['simctl', 'ui', udid, 'content_size', 'large'\]\);/);
    const pin = src.slice(src.indexOf('async function pinFullScreenApps'), src.indexOf('async function bootIosFrom'));
    expect(pin).toMatch(/'defaults', 'write', 'com\.apple\.springboard', k, '-bool', 'NO'/);
    expect(pin.indexOf("'shutdown'")).toBeLessThan(pin.indexOf("'boot', udid"));
    expect(pin).toContain('const still = springboardPinsToWrite(');
  });
});
