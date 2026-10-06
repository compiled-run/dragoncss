// MQ-R1 device-env (notes/T067-mq-r-spec.md R6, R7 (c)): one real rotation per device. The host app runs the fill-the-stage
// fixture mqr-rotate (its Dragon root is the device's stage) in three phases, each a dump with the environment record: portrait
// after one setter (open = true), landscape after the scene or activity rotates in place, and portrait again. The host judges each
// dump against what it reports: the root's orientation, the band the band lookup gives its whole device px (and MQ-R0's partition
// its media size), the band Chrome matches in an iframe of exactly those device px at the device DPR (the band oracle), and frames
// and applied values equal to the engine's of (open = true, that band) at the dumped size. Pixels are compared by the resize scripts
// (device-states), not here, and the rotation animation is never compared (the dumps are taken once the root has settled).
import { createHash } from 'node:crypto';
import type { Browser } from 'playwright';
import { rtBand } from '@dragon/layout';
import type { Assignment, Compiled, NativeProgram, StateEmit } from 'dragon';
import { bandEnvironmentOf, DESKTOP_DEVICE, expectedDump, nativeBandOfViewport, nativeBandProgram, nativeBandPrograms, nativeBands, stateKey } from 'dragon';
import { launchChrome } from './chrome.ts';
import type { DeviceRecord } from './device-run.ts';
import type { LaneFailure } from './device-lanes.ts';
import type { DeviceSet } from './device-lanes.ts';
import { dumpFile, ENV_LANE, readDump } from './device-lanes.ts';
import { FIXTURES } from './fixtures.ts';
import type { FixtureSpec } from './fixtures.ts';
import { checkAgainstEngine, checkApplied } from './native-compare.ts';
import { validateNativeDump } from './native-dump.ts';
import type { NativeDump } from './native-dump.ts';
import { BACKEND_OF, engineBoxes, expectedEngine, nativeCompile } from './native-host.ts';
import type { NativeTarget } from './targets.ts';
import { ENV_CASE_IDS } from './targets.ts';

export const ENV_FIXTURE = 'mqr-rotate';
export const ENV_SCRIPT = `${ENV_FIXTURE}~env`;
export type EnvPhase = 'portrait' | 'landscape' | 'back';
/** The env case ids, in the order one launch runs them (targets.ts declares the lane with them). */
export const ENV_IDS: readonly string[] = ENV_CASE_IDS;
/** The setter the env script runs before the first dump; the state must survive both rotations (R6). */
const ENV_SET = { state: stateKey('doc', 'open'), value: true } as const;

let compiled: Compiled<'ios' | 'android'> | null = null;
function envCompile(): Compiled<'ios' | 'android'> {
  if (compiled !== null) return compiled;
  const spec = FIXTURES.find((f) => f.id === ENV_FIXTURE) as FixtureSpec | undefined;
  if (spec === undefined || spec.kind !== 'layout') throw new Error(`${ENV_FIXTURE} is not a layout fixture`);
  compiled = nativeCompile(spec, 'ltr');
  return compiled;
}

/** The env script as a state program for the host apps: the band program of mqr-rotate with its one setter and no expected digests. */
export function envEmits(target: NativeTarget): StateEmit[] {
  const c = envCompile();
  return [{
    id: ENV_SCRIPT,
    fixture: ENV_FIXTURE,
    direction: 'ltr',
    compilerDigest: c.digest,
    viewport: { width: 400, height: 300 },
    program: nativeBandProgram(c, BACKEND_OF[target]),
    band: nativeBands(c)?.table ?? { atoms: [], bands: [[]] },
    // The host builds each phase's case at the size the root settled at; its references are computed here from the dump.
    scripts: [{ id: ENV_SCRIPT, steps: [{ kind: 'set', state: ENV_SET.state, value: ENV_SET.value }, { kind: 'dump' }], expectedDigests: [] }],
  }];
}

/** The app assignment the env script ends in: the initial one with open = true. */
function envAssignment(c: Compiled<'ios' | 'android'>): Assignment {
  return nativeInitial(c).map((e) => (stateKey(e.state.instance, e.state.state) === ENV_SET.state ? { state: e.state, value: ENV_SET.value } : e));
}

function nativeInitial(c: Compiled<'ios' | 'android'>): Assignment {
  const sp = nativeBandProgram(c, 'uikit');
  const a = sp.assignments[sp.initial]?.assignment;
  if (a === undefined) throw new Error(`${ENV_FIXTURE}: no initial assignment`);
  return a.filter((e) => e.state.instance !== '@env');
}

/** The band Chrome matches for a root of whole device px at a DPR: every band condition in an iframe of exactly those px (M1, M4). */
export async function bandOracle(browser: Browser, conditions: readonly string[], widthPx: number, heightPx: number, dpr: number): Promise<number[]> {
  const context = await browser.newContext({ viewport: { width: 2400, height: 2400 }, deviceScaleFactor: dpr });
  try {
    const page = await context.newPage();
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0"><iframe style="border:0;display:block;width:${widthPx / dpr}px;height:${heightPx / dpr}px" srcdoc="<!DOCTYPE html><html><body></body></html>"></iframe></body></html>`);
    const handle = await page.waitForSelector('iframe', { state: 'attached' });
    const frame = await handle.contentFrame();
    if (frame === null) throw new Error(`no iframe document for ${widthPx}x${heightPx} px at ${dpr}`);
    await frame.waitForLoadState();
    const got = await frame.evaluate((cs) => ({ matches: cs.map((c) => matchMedia(c).matches), dpr: window.devicePixelRatio }), [...conditions]);
    if (got.dpr !== dpr) throw new Error(`the iframe reports devicePixelRatio ${got.dpr}, not ${dpr}`);
    return got.matches.flatMap((m, k) => (m ? [k] : []));
  } finally {
    await context.close();
  }
}

export type EnvOutcome = DeviceSet;

/**
 * device-env at one DPR: the three phase dumps in dir, each judged as the header says, failures under device-env. browser is a
 * Chrome launched at the device's DPR (chrome.ts launchChrome), for the band oracle.
 */
export async function evaluateEnv(target: NativeTarget, dpr: number, dir: string, device: DeviceRecord, browser: Browser | null, extra: readonly LaneFailure[] = []): Promise<DeviceSet> {
  const failures: LaneFailure[] = [...extra];
  const c = envCompile();
  const bands = nativeBands(c);
  if (bands === null) throw new Error(`${ENV_FIXTURE} has no @media bands`);
  const backend = BACKEND_OF[target];
  const assignment = envAssignment(c);
  let dumps = 0;
  let compared = 0;
  const h = createHash('sha256');
  const roots: (readonly number[])[] = [];
  for (const id of ENV_IDS) {
    const phase = id.slice(id.lastIndexOf('~') + 1) as EnvPhase;
    const fail = (kind: LaneFailure['kind'], detail: string, node: string | null = null): void => {
      failures.push({ lane: ENV_LANE, case: id, dpr, node, kind, detail });
    };
    const read = readDump(dumpFile(dir, id, dpr));
    if (read.kind !== 'ok') {
      fail(read.kind === 'missing' ? 'dump-missing' : 'dump-invalid', read.kind === 'missing' ? 'the device wrote no dump' : read.detail);
      continue;
    }
    const v = validateNativeDump(read.raw);
    if (!v.ok) {
      fail('dump-invalid', v.errors.slice(0, 5).map((e) => `${e.path} ${e.code}`).join('; '));
      continue;
    }
    dumps++;
    const dump: NativeDump = v.dump;
    h.update(id).update('\0').update(JSON.stringify({ ...dump, timing: null })).update('\0');
    const e = dump.environment;
    if (dump.case.id !== id || dump.device.scale !== dpr || dump.case.dpr !== dpr) fail('device-scale', `case ${dump.case.id} at ${dump.case.dpr}, scale ${dump.device.scale}; expected ${id} at ${dpr}`);
    if (dump.case.compilerDigest !== c.digest) fail('compiler-digest', `compilerDigest ${dump.case.compilerDigest}, the compile under test ${c.digest}`);
    if (e === null) {
      fail('environment', 'the dump has no environment record');
      continue;
    }
    const [wPx, hPx] = e.rootPx as [number, number];
    roots.push(e.rootPx);
    compared++;
    // The root's own orientation, whole device px, the media size of them, and the dumped viewport its CSS size.
    if (phase === 'landscape' ? !(wPx > hPx) : !(wPx <= hPx)) fail('environment', `the root is ${wPx}x${hPx} px in the ${phase} phase`);
    if (e.dpr !== dpr || !Number.isInteger(wPx) || !Number.isInteger(hPx)) fail('environment', `root ${wPx}x${hPx} px at scale ${e.dpr}; expected whole px at ${dpr}`);
    const media = [rtBand.mediaSize(wPx, dpr), rtBand.mediaSize(hPx, dpr)];
    if (e.media[0] !== media[0] || e.media[1] !== media[1]) fail('environment', `media ${e.media.join('x')}, the media size of ${wPx}x${hPx} px is ${media.join('x')}`);
    const viewport = dump.case.viewport;
    if (Math.abs(viewport.width * dpr - wPx) > 1e-9 || Math.abs(viewport.height * dpr - hPx) > 1e-9) fail('environment', `viewport ${viewport.width}x${viewport.height} css px is not the root's ${wPx}x${hPx} px at ${dpr}`);
    // The band: the device's, the band lookup's, MQ-R0's partition's and Chrome's must be one band.
    const lookup = rtBand.bandAtPx(bands.table, wPx, hPx, bandEnvironmentOf({ ...DESKTOP_DEVICE, dpr }), rtBand.NO_BAND_FAULTS);
    const partition = nativeBandOfViewport(c, { width: media[0] as number, height: media[1] as number });
    if (e.band !== lookup || partition !== lookup) fail('environment', `band ${e.band}; the band lookup gives ${lookup}, the partition ${partition}`);
    if (browser !== null) {
      const chrome = await bandOracle(browser, bands.conditions, wPx, hPx, dpr);
      if (chrome.length !== 1 || chrome[0] !== lookup) fail('environment', `Chrome matches band ${JSON.stringify(chrome)} in an iframe of ${wPx}x${hPx} device px at ${dpr}, the band lookup ${lookup}`);
    }
    // The state survived and the frames and applied values are the engine's of (open = true, that band) at the dumped size.
    const p = nativeBandPrograms(c, assignment, lookup);
    if (p.kind !== 'ready') {
      fail('environment', `no program of the band: ${p.reason}`);
      continue;
    }
    const program: NativeProgram = p.programs[backend];
    for (const x of checkAgainstEngine(dump, engineBoxes(program, viewport, dpr)).problems) fail('frame-engine', x, x.split(':')[0] ?? null);
    const expected = expectedDump(program, id, viewport, dpr, expectedEngine());
    for (const x of checkApplied(dump, new Map(expected.nodes.map((n) => [n.id, n.applied]))).problems) fail('applied', x, x.split(':')[0] ?? null);
  }
  // Back to portrait: the root is the size it started at.
  const [first, , back] = roots;
  if (first !== undefined && back !== undefined && (first[0] !== back[0] || first[1] !== back[1])) failures.push({ lane: ENV_LANE, case: ENV_IDS[2] as string, dpr, node: null, kind: 'environment', detail: `the root is ${back.join('x')} px back in portrait, ${first.join('x')} px before the rotation` });
  return { dpr, device, cases: ENV_IDS.length, dumps, compared: { a: 0, b: compared, c: 0, d: 0, breaks: 0 }, dumpsSha256: h.digest('hex'), failures, faults: [] };
}

/** A Chrome launch for the band oracle at a device DPR; null when the caller judges without it (a host test of recorded dumps). */
export async function envOracleBrowser(dpr: number): Promise<Browser> {
  return launchChrome(dpr);
}
