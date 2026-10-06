// MQ-R1 PR 2 (notes/T067-mq-r-spec.md R5, R6, R7): the runtime's host half. The resize prefix scripts and the device-env rotation
// are emitted into the host apps on the band programs, the device-states and device-env runners judge fake device dumps the way they
// judge real ones (the device runs are the landing driver's), and the band oracle answers as Chrome does.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { rtBand } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { bandEnvironmentOf, DESKTOP_DEVICE, emitStatePrograms, expectedDigest, expectedDump, nativeBandPrograms, nativeBands, programInput } from 'dragon';

/** MQ-R2: headless Chrome's desktop readings at a scale. */
const desk = (dpr: number) => bandEnvironmentOf({ ...DESKTOP_DEVICE, dpr });
import { launchChrome, openPage } from '../src/chrome.ts';
import { bandOracle, ENV_IDS, ENV_SCRIPT, envEmits, evaluateEnv } from '../src/device-env.ts';
import type { DeviceRecord } from '../src/device-run.ts';
import { ENV_LANE, evaluateStates, scriptCases, STATE_LANE } from '../src/device-lanes.ts';
import { referenceDump } from '../src/native-compare.ts';
import type { NativeDump } from '../src/native-dump.ts';
import { BACKEND_OF, engineBoxes, expectedEngine, hostSources, nativeCompile } from '../src/native-host.ts';
import { resizeEmits, resizePrefixes } from '../src/resize-scripts.ts';
import { captureResize, rendering as resizeRendering, resizeCases, scriptPoints } from '../src/resize-capture.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { ENV_CASE_IDS, resizeScriptIds, stateScriptIds } from '../src/targets.ts';

const dir = mkdtempSync(join(tmpdir(), 'dragon-mqr-device-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const DPR = 3;
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
    const d = fakeDump(p.id, c.spec.id, c.compiled.digest, q.programs.uikit, p.end, env({ rootPx: px, dpr: DPR, media: px.map((v) => rtBand.mediaSize(v, DPR)), band: p.band }));
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

describe('device-env (one real rotation per device)', () => {
  const spec = FIXTURES.find((f) => f.id === 'mqr-rotate');
  if (spec === undefined) throw new Error('no mqr-rotate fixture');
  const compiled = nativeCompile(spec, 'ltr');
  const bands = nativeBands(compiled);
  if (bands === null) throw new Error('mqr-rotate has no bands');
  const open = (v: boolean) => [{ state: { instance: 'doc', state: 'open' }, value: v }];
  const phase = (at: string, id: string, size: { width: number; height: number }, opts: { open?: boolean; band?: (b: number) => number; rootPx?: number[] } = {}): void => {
    const px = opts.rootPx ?? [size.width * DPR, size.height * DPR];
    const band = rtBand.bandAtPx(bands.table, px[0] as number, px[1] as number, desk(DPR), rtBand.NO_BAND_FAULTS);
    const p = nativeBandPrograms(compiled, open(opts.open ?? true), band);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const d = fakeDump(id, 'mqr-rotate', compiled.digest, p.programs.uikit, size, { rootPx: px, dpr: DPR, media: px.map((v) => rtBand.mediaSize(v, DPR)), band: (opts.band ?? ((b) => b))(band) });
    writeFileSync(join(at, `${id}@${DPR}.json`), JSON.stringify(d));
  };
  const PORTRAIT = { width: 402, height: 778 };
  const LANDSCAPE = { width: 778, height: 402 };
  const [portrait, landscape, back] = ENV_IDS as [string, string, string];
  it('declares the lane with the three phases and emits the env script on the band program, its setter first', () => {
    expect(ENV_IDS).toEqual(ENV_CASE_IDS);
    expect(ENV_IDS).toEqual(['mqr-rotate~env~portrait', 'mqr-rotate~env~landscape', 'mqr-rotate~env~back']);
    const e = envEmits('ios');
    expect(e.map((x) => [x.id, x.scripts.map((s) => s.id), x.band?.atoms.map((a) => a.feature)])).toEqual([[ENV_SCRIPT, [ENV_SCRIPT], ['orientation', 'width']]]);
    expect(emitStatePrograms('uikit', e).map((f) => f.text).join('\n')).toContain('expectedDigests: [:], make: dragonStates0Machine, steps: [.set(0, 1), .dump]');
    expect(emitStatePrograms('android-views', envEmits('android')).map((f) => f.text).join('\n')).toContain('mapOf(), ::dragonStates0Machine');
  });
  it('passes on the engine\'s own dumps at the rotated sizes (no oracle here); a wrong band, orientation, lost state or size fails', async () => {
    const ok = join(dir, 'env-ok');
    mkdirSync(ok);
    phase(ok, portrait, PORTRAIT);
    phase(ok, landscape, LANDSCAPE);
    phase(ok, back, PORTRAIT);
    expect((await evaluateEnv('ios', DPR, ok, device, null)).failures).toEqual([]);
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
    expect((await evaluateEnv('ios', DPR, none, device, null)).failures.map((x) => x.kind)).toEqual(['dump-missing', 'dump-missing', 'dump-missing']);
  });
  it('the band oracle is Chrome\'s matchMedia in an iframe of exactly the device px, and agrees with the band lookup', async () => {
    const browser = await launchChrome(DPR);
    try {
      for (const px of [[1206, 2334], [2334, 1206], [1500, 1200], [1502, 1503]] as const) {
        const want = rtBand.bandAtPx(bands.table, px[0], px[1], desk(DPR), rtBand.NO_BAND_FAULTS);
        expect(await bandOracle(browser, bands.conditions, px[0], px[1], DPR), px.join('x')).toEqual([want]);
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
