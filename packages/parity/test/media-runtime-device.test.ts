// MQ-R1 PR 2 (notes/T067-mq-r-spec.md R5, R6, R7): the runtime's host half. The resize prefix scripts and the device-env rotation
// are emitted into the host apps on the band programs, the device-states and device-env runners judge fake device dumps the way they
// judge real ones (the device runs are the landing driver's), and the band oracle answers as Chrome does. MQ-R2 (R9): the scripts of
// the media-environment fixtures inject their readings with env steps, device-states holds a dump to the readings its script
// injected, and device-env holds every phase to the platform rule's readings of the inputs it recorded, with Android's reduced-motion
// phases.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rtBand } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { emitStatePrograms, expectedDigest, expectedDump, nativeBandPrograms, nativeBands, programInput } from 'dragon';
import { launchChrome, openPage } from '../src/chrome.ts';
import { bandEnvironmentOfReadings, bandOracle, ENV_SCRIPT, envEmits, envIds, evaluateEnv, motionScaleOf, platformReadings } from '../src/device-env.ts';
import type { DeviceRecord } from '../src/device-run.ts';
import { ENV_LANE, evaluateStates, scriptCases, STATE_LANE } from '../src/device-lanes.ts';
import { referenceDump } from '../src/native-compare.ts';
import type { NativeDump } from '../src/native-dump.ts';
import { BACKEND_OF, engineBoxes, expectedEngine, hostSources, nativeCompile } from '../src/native-host.ts';
import { resizeEmits, resizePrefixes } from '../src/resize-scripts.ts';
import { captureResize, rendering as resizeRendering, resizeCases, scriptPoints } from '../src/resize-capture.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { envCaseIds, resizeScriptIds, stateScriptIds } from '../src/targets.ts';

// Made in beforeAll: `vitest list` runs module scope but no hooks, so a folder made here would leak.
let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dragon-mqr-device-'));
});
afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});
const DPR = 3;
/** An iPhone's platform readings: a touch screen, no motion preference. */
type Readings = NonNullable<NativeDump['environment']>['readings'];
const PHONE: Readings = { pointer: 'coarse', hover: 'none', anyPointer: ['coarse'], anyHover: 'none', reducedMotion: 'no-preference', source: 'platform', inputs: [0, 0] };
const device = { name: 'fake', platform: 'ios', os: 'host', build: 'host', profileScale: DPR, appScale: DPR, windowPx: [0, 0], stagePx: [0, 0], rootOriginPx: [0, 0], textScale: 'none' } as unknown as DeviceRecord;

/** A fake device dump of a program at a size: the engine's frames, the expected applied values, an environment record. */
function fakeDump(id: string, fixture: string, compilerDigest: string, program: NativeProgram, viewport: { width: number; height: number }, environment: NativeDump['environment']): NativeDump {
  const m = expectedEngine();
  const ref = referenceDump({ platform: 'ios', caseId: id, fixture, dpr: DPR, direction: 'ltr', compilerDigest, input: programInput(program, viewport, DPR), engine: engineBoxes(program, viewport, DPR) });
  const e = expectedDump(program, id, viewport, DPR, m);
  return {
    ...ref,
    lane: 'ios-sim',
    case: { ...ref.case, expectedDigest: expectedDigest(e) },
    device: { platform: 'ios', os: 'fake', model: 'fake', abi: 'host', scale: DPR, toolchain: 'host', renderer: 'none' },
    nodes: ref.nodes.map((x) => ({ ...x, native: e.nodes.find((y) => y.id === x.id)?.native ?? x.native, applied: e.nodes.find((y) => y.id === x.id)?.applied ?? {} })),
    // A device dump always has pixels and timing; the fake's capture holds no samples, so device-pixels fails it by design.
    pixels: { capture: 'drawHierarchy', colorSpace: 'sRGB', width: Math.ceil(viewport.width * DPR), height: Math.ceil(viewport.height * DPR), sha256: 'fake', samples: [] },
    timing: { settleMs: 0, dumpMs: 0 },
    environment,
  };
}

describe('the resize prefix scripts in the host apps', () => {
  it('are every prefix of every resize script, after the state groups\' scripts, as the lanes and the case table list them', () => {
    const ids = scriptCases('ios').map((s) => s.script.case.id);
    expect(ids.slice(-resizeScriptIds().length)).toEqual([...resizeScriptIds()]);
    expect(ids).toEqual([...stateScriptIds()]);
    expect(resizeEmits('ios').flatMap((e) => e.scripts.map((s) => s.id))).toEqual([...resizeScriptIds()]);
  });
  it('emit the band table and env#band, the resize steps in CSS px, the start and end sizes, and no typed setter for env#band', () => {
    const e = resizeEmits('ios').filter((x) => x.id === 'mqr-state-band~resize');
    const swift = emitStatePrograms('uikit', e).map((f) => f.text).join('\n');
    expect(swift).toMatch(/band: DragonBandBinding\(dragonStates0Bands, 1\), initialBand: 2\)/);
    expect(swift).toContain('.resize(352.0, 304.0)');
    expect(swift).toContain('viewport: (width: 352.0, height: 304.0), start: (400.0, 304.0)');
    expect(swift).toContain('public func set_doc_open(_ v: Bool)');
    expect(swift).not.toMatch(/set__env_band/);
    const kotlin = emitStatePrograms('android-views', resizeEmits('android').filter((x) => x.id === 'mqr-state-band~resize')).map((f) => f.text).join('\n');
    expect(kotlin).toContain('DragonScriptStep.Resize(352.0, 304.0)');
    expect(kotlin).toMatch(/DragonBandBinding\(dragonStates0Bands, 1\), 2\)/);
    // The resize step keeps the stage's LayoutParams type (a FrameLayout's measure pass casts to MarginLayoutParams), and the media
    // root measures a tree root rendered inside its own layout (a rotation's size change) before laying it out.
    const host = hostSources('android', 'x');
    const support = host.find((f) => f.path.endsWith('views/DragonState.kt'))?.text ?? '';
    expect(support).toContain('val lp = media.layoutParams\n    lp.width = pxOf(width)');
    expect(support).not.toContain('media.layoutParams = ViewGroup.LayoutParams(');
    const media = host.find((f) => f.path.endsWith('DragonMedia.kt'))?.text ?? '';
    expect(media).toMatch(/override fun onLayout[\s\S]*c\.measure\(View\.MeasureSpec\.makeMeasureSpec\(lp\.width, View\.MeasureSpec\.EXACTLY\)[\s\S]*super\.onLayout/);
  });
});

describe('device-states judges a resize step with its environment record', () => {
  const c = resizeCases().find((x) => x.id === 'mqr-width-switch~resize');
  if (c === undefined) throw new Error('no mqr-width-switch resize case');
  const prefixes = resizePrefixes(c);
  const scripts = scriptCases('ios').filter((s) => s.script.case.id.startsWith('mqr-width-switch~resize'));
  const write = (at: string, k: number, env: (e: NonNullable<NativeDump['environment']>) => NativeDump['environment'] = (e) => e, programOf = k): void => {
    const p = prefixes[k];
    const q = prefixes[programOf];
    if (p === undefined || q === undefined) throw new Error(`no prefix ${k}`);
    const px = [p.end.width * DPR, p.end.height * DPR];
    const d = fakeDump(p.id, c.spec.id, c.compiled.digest, q.programsAt(DPR).uikit, p.end, env({ rootPx: px, dpr: DPR, media: px.map((v) => rtBand.mediaSize(v, DPR)), band: p.bandAt(DPR), readings: PHONE }));
    writeFileSync(join(at, `${p.id}@${DPR}.json`), JSON.stringify(d));
  };
  it('passes every check but pixels on the engine\'s own dumps (the fake has none); a wrong band, a missing record or another step\'s program fails', () => {
    const at = join(dir, 'resize');
    mkdirSync(at);
    prefixes.forEach((_, k) => write(at, k));
    const states = evaluateStates('ios', DPR, at, device, scripts);
    expect(states.dumps).toBe(prefixes.length);
    expect([...new Set(states.failures.map((f) => `${f.lane} ${f.kind}`))]).toEqual([`${STATE_LANE} pixel`]);
    const bad = join(dir, 'resize-bad');
    mkdirSync(bad);
    prefixes.forEach((_, k) => write(bad, k));
    write(bad, 1, (e) => ({ ...e, band: (e.band + 1) % 4 }));
    write(bad, 2, () => null);
    write(bad, 3, (e) => e, 0);
    const wrong = evaluateStates('ios', DPR, bad, device, scripts).failures.filter((f) => f.kind !== 'pixel');
    expect(wrong.filter((f) => f.case === prefixes[1]?.id).map((f) => f.kind)).toEqual(['environment']);
    expect(wrong.filter((f) => f.case === prefixes[2]?.id).map((f) => f.kind)).toEqual(['environment']);
    expect(wrong.filter((f) => f.case === prefixes[3]?.id).length).toBeGreaterThan(0);
  });
});

describe('MQ-R2: the media-environment scripts', () => {
  const caseOf = (id: string) => {
    const c = resizeCases().find((x) => x.id === id);
    if (c === undefined) throw new Error(`no resize case ${id}`);
    return c;
  };
  it('inject Chrome\'s start readings, then each env step\'s, as the steps of every prefix', () => {
    const e = resizeEmits('ios').filter((x) => x.id === 'mqr2-pointer-hover~resize');
    const swift = emitStatePrograms('uikit', e).map((f) => f.text).join('\n');
    expect(swift).toContain('steps: [.env(0, 0), .env(1, 0), .env(0, 1), .dump]');
    expect(swift).toContain('steps: [.env(0, 0), .env(1, 0), .env(0, 1), .env(0, 0), .resize(352.0, 304.0), .dump]');
    const kotlin = emitStatePrograms('android-views', resizeEmits('android').filter((x) => x.id === 'mqr2-reduced-motion~resize')).map((f) => f.text).join('\n');
    expect(kotlin).toContain('DragonScriptStep.Env(0, 0), DragonScriptStep.Env(1, 0), DragonScriptStep.Env(1, 1), DragonScriptStep.Dump');
    // A sheet without device features starts on the platform's readings: its steps are unchanged.
    expect(resizePrefixes(caseOf('mqr-width-switch~resize'))[1]?.steps.map((x) => x.kind)).toEqual(['resize', 'dump']);
  });
  it('take the band and program of each DPR: resolution moves mqr2-resolution\'s band between DPR 1, 2, 2.625 and 3', () => {
    const p = resizePrefixes(caseOf('mqr2-resolution~resize'))[0];
    if (p === undefined) throw new Error('no prefix');
    const bands = [1, 2, 2.625, 3].map((d) => p.bandAt(d));
    expect(new Set(bands).size).toBe(4);
    expect(JSON.stringify(p.programsAt(2).uikit)).not.toBe(JSON.stringify(p.programsAt(3).uikit));
  });
  it('device-states holds a dump to the readings its script injected', () => {
    const c = caseOf('mqr2-pointer-hover~resize');
    const prefixes = resizePrefixes(c);
    const scripts = scriptCases('ios').filter((x) => x.script.case.id.startsWith('mqr2-pointer-hover~resize'));
    const write = (at: string, k: number, readings: (r: Readings) => Readings): void => {
      const p = prefixes[k];
      if (p === undefined) throw new Error(`no prefix ${k}`);
      const px = [p.end.width * DPR, p.end.height * DPR];
      const injected: Readings = { pointer: p.device.pointer, hover: p.device.hover, anyPointer: [...p.device.anyPointer], anyHover: p.device.anyHover, reducedMotion: p.device.reducedMotion, source: 'injected', inputs: [0, 0] };
      const d = fakeDump(p.id, c.spec.id, c.compiled.digest, p.programsAt(DPR).uikit, p.end, { rootPx: px, dpr: DPR, media: px.map((v) => rtBand.mediaSize(v, DPR)), band: p.bandAt(DPR), readings: readings(injected) });
      writeFileSync(join(at, `${p.id}@${DPR}.json`), JSON.stringify(d));
    };
    const ok = join(dir, 'env-scripts');
    mkdirSync(ok);
    prefixes.forEach((_, k) => write(ok, k, (r) => r));
    expect(evaluateStates('ios', DPR, ok, device, scripts).failures.filter((f) => f.kind !== 'pixel')).toEqual([]);
    const bad = join(dir, 'env-scripts-bad');
    mkdirSync(bad);
    prefixes.forEach((_, k) => write(bad, k, (r) => (k === 1 ? { ...r, source: 'platform' } : k === 2 ? { ...r, pointer: r.pointer === 'fine' ? 'coarse' : 'fine' } : r)));
    const wrong = evaluateStates('ios', DPR, bad, device, scripts).failures.filter((f) => f.kind !== 'pixel');
    expect(wrong.map((f) => [f.case, f.kind])).toEqual([[prefixes[1]?.id, 'environment'], [prefixes[2]?.id, 'environment']]);
  });
});

describe('device-env (one real rotation per device)', () => {
  const spec = FIXTURES.find((f) => f.id === 'mqr-rotate');
  if (spec === undefined) throw new Error('no mqr-rotate fixture');
  const compiled = nativeCompile(spec, 'ltr');
  const bands = nativeBands(compiled);
  if (bands === null) throw new Error('mqr-rotate has no bands');
  const open = (v: boolean) => [{ state: { instance: 'doc', state: 'open' }, value: v }];
  const phase = (at: string, id: string, size: { width: number; height: number }, opts: { open?: boolean; band?: (b: number) => number; rootPx?: number[]; readings?: Readings; backend?: 'uikit' | 'android-views' } = {}): void => {
    const px = opts.rootPx ?? [size.width * DPR, size.height * DPR];
    const readings = opts.readings ?? PHONE;
    const band = rtBand.bandAtPx(bands.table, px[0] as number, px[1] as number, bandEnvironmentOfReadings(readings, DPR), rtBand.NO_BAND_FAULTS);
    const p = nativeBandPrograms(compiled, open(opts.open ?? true), band);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const d = fakeDump(id, 'mqr-rotate', compiled.digest, p.programs[opts.backend ?? 'uikit'], size, { rootPx: px, dpr: DPR, media: px.map((v) => rtBand.mediaSize(v, DPR)), band: (opts.band ?? ((b) => b))(band), readings });
    writeFileSync(join(at, `${id}@${DPR}.json`), JSON.stringify(d));
  };
  const PORTRAIT = { width: 402, height: 778 };
  const LANDSCAPE = { width: 778, height: 402 };
  const [portrait, landscape, back, motion, motionBack] = envIds('ios') as [string, string, string, string, string];
  const REDUCED: Readings = { ...PHONE, reducedMotion: 'reduce' };
  it('declares the lane with the three rotation phases and the two reduced-motion phases on both platforms, and emits the env script on the band program, its setter first', () => {
    expect(envIds('ios')).toEqual(envCaseIds('ios'));
    expect(envIds('ios')).toEqual(['mqr-rotate~env~portrait', 'mqr-rotate~env~landscape', 'mqr-rotate~env~back', 'mqr-rotate~env~motion', 'mqr-rotate~env~motion-back']);
    expect(envIds('android')).toEqual(envIds('ios'));
    expect(envIds('ios').map(motionScaleOf)).toEqual([null, null, null, 0, 1]);
    const e = envEmits('ios');
    expect(e.map((x) => [x.id, x.scripts.map((s) => s.id), x.band?.atoms.map((a) => a.feature)])).toEqual([[ENV_SCRIPT, [ENV_SCRIPT], ['orientation', 'width', 'prefers-reduced-motion']]]);
    expect(emitStatePrograms('uikit', e).map((f) => f.text).join('\n')).toContain('expectedDigests: [:], make: dragonStates0Machine, steps: [.set(0, 1), .dump]');
    expect(emitStatePrograms('android-views', envEmits('android')).map((f) => f.text).join('\n')).toContain('mapOf(), ::dragonStates0Machine');
  });
  it('passes on the engine\'s own dumps at the rotated sizes (no oracle here); a wrong band, orientation, lost state or size fails', async () => {
    const ok = join(dir, 'env-ok');
    mkdirSync(ok);
    phase(ok, portrait, PORTRAIT);
    phase(ok, landscape, LANDSCAPE);
    phase(ok, back, PORTRAIT);
    phase(ok, motion, PORTRAIT, { readings: REDUCED });
    phase(ok, motionBack, PORTRAIT);
    expect((await evaluateEnv('ios', DPR, ok, device, null)).failures).toEqual([]);
    // Reduce Motion turned on that the readings miss fails the motion phase alone.
    const missed = join(dir, 'env-ios-missed');
    mkdirSync(missed);
    for (const [id, size] of [[portrait, PORTRAIT], [landscape, LANDSCAPE], [back, PORTRAIT], [motion, PORTRAIT], [motionBack, PORTRAIT]] as const) phase(missed, id, size);
    expect((await evaluateEnv('ios', DPR, missed, device, null)).failures.map((f) => [f.case, f.kind])).toEqual([[motion, 'environment']]);
    const bad = join(dir, 'env-bad');
    mkdirSync(bad);
    phase(bad, portrait, PORTRAIT, { band: (b) => (b + 1) % bands.table.bands.length });
    phase(bad, landscape, PORTRAIT);
    phase(bad, back, { width: 402, height: 770 }, { open: false });
    const f = (await evaluateEnv('ios', DPR, bad, device, null)).failures;
    expect(f.every((x) => x.lane === ENV_LANE)).toBe(true);
    expect(f.filter((x) => x.case === portrait).map((x) => x.kind)).toContain('environment');
    expect(f.filter((x) => x.case === landscape).map((x) => x.detail)).toContain('the root is 1206x2334 px in the landscape phase');
    expect(f.filter((x) => x.case === back).map((x) => x.kind)).toEqual(expect.arrayContaining(['environment']));
    expect(f.filter((x) => x.case === back && x.kind !== 'environment').length).toBeGreaterThan(0);
    const none = join(dir, 'env-none');
    mkdirSync(none);
    expect((await evaluateEnv('ios', DPR, none, device, null)).failures.map((x) => x.kind)).toEqual(['dump-missing', 'dump-missing', 'dump-missing', 'dump-missing', 'dump-missing']);
  });
  it('MQ-R2: holds every phase to the platform rule\'s readings of its recorded inputs; Android\'s motion phases must follow the OS setting', async () => {
    const android = { ...device, platform: 'android' } as unknown as DeviceRecord;
    // An emulator with a touch screen and a keyboard: coarse, no hover; the motion phase reports reduce, the others no-preference.
    const inputs = [rtBand.SOURCE_TOUCHSCREEN, 0x101];
    const r = (reduced: boolean): Readings => ({ ...platformReadings('android', inputs, reduced), source: 'platform', inputs });
    const ids = envIds('android') as [string, string, string, string, string];
    const run = async (name: string, readingsOf: (id: string) => Readings) => {
      const at = join(dir, name);
      mkdirSync(at);
      for (const id of ids) phase(at, id, id.endsWith('~landscape') ? LANDSCAPE : PORTRAIT, { readings: readingsOf(id), backend: 'android-views' });
      return (await evaluateEnv('android', DPR, at, android, null)).failures;
    };
    expect(await run('env-android', (id) => r(id === ids[3]))).toEqual([]);
    // The planted reading (the transition scale) misses the OS setting: the motion phase reports no-preference.
    const missed = await run('env-android-missed', () => r(false));
    expect(missed.map((f) => [f.case, f.kind])).toEqual([[ids[3], 'environment']]);
    // A primary pointer the rule does not give (the desktop rule's fine first, with a mouse and a touch screen) fails.
    const both = [rtBand.SOURCE_TOUCHSCREEN, rtBand.SOURCE_MOUSE];
    const fine = await run('env-android-fine-first', (id) => ({ ...platformReadings('android', both, id === ids[3]), pointer: 'fine', source: 'platform', inputs: both }));
    expect(new Set(fine.map((f) => f.kind))).toEqual(new Set(['environment']));
    expect(fine.length).toBe(ids.length);
    // Injected readings are a script's, never the platform's.
    expect((await run('env-android-injected', (id) => ({ ...r(id === ids[3]), source: 'injected' }))).length).toBe(ids.length);
  });
  it('the band oracle is Chrome\'s matchMedia in an iframe of exactly the device px, and agrees with the band lookup', async () => {
    const browser = await launchChrome(DPR);
    try {
      for (const px of [[1206, 2334], [2334, 1206], [1500, 1200], [1502, 1503]] as const) {
        for (const readings of [PHONE, { ...PHONE, reducedMotion: 'reduce' as const }]) {
          const want = rtBand.bandAtPx(bands.table, px[0], px[1], bandEnvironmentOfReadings(readings, DPR), rtBand.NO_BAND_FAULTS);
          expect(await bandOracle(browser, bands.conditions, px[0], px[1], DPR, readings), `${px.join('x')} ${readings.reducedMotion}`).toEqual([want]);
        }
      }
    } finally {
      await browser.close();
    }
  }, 120_000);
});

describe('the resize pixels Chrome gives (the device-states pixel reference)', () => {
  it('are the same bytes on every capture, and those of a page opened at the step\'s size', async () => {
    const c = resizeCases().find((x) => x.id === 'mqr-music-shape~resize');
    if (c === undefined) throw new Error('no mqr-music-shape resize case');
    const browser = await launchChrome(2);
    try {
      const hash = (png: Buffer): string => createHash('sha256').update(png).digest('hex');
      const runs: string[][] = [];
      for (let k = 0; k < 4; k++) {
        const run: string[] = [];
        await captureResize(browser, c, 2, 'authored', (_, png) => run.push(hash(png)));
        runs.push(run);
      }
      for (const r of runs) expect(r).toEqual(runs[0]);
      const at = scriptPoints(c)[1];
      if (at === undefined) throw new Error('no step 1');
      const page = await openPage(browser, resizeRendering(c, at.assignment, 'authored'), { viewport: at.size, devicePixelRatio: 2, direction: c.direction, rootFont: 'ahem' });
      try {
        const cdp = await page.context().newCDPSession(page);
        const fresh = Buffer.from(((await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string }).data, 'base64');
        expect(runs[0]?.[1]).toBe(hash(fresh));
      } finally {
        await page.context().close();
      }
    } finally {
      await browser.close();
    }
  }, 300_000);
});
