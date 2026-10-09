// T065 R18: the device-anim lane. Every frame case runs on the device as one case per sample: a fresh state program with its
// animation tables, mounted, its frame script run up to that sample's dump (the clock steps' renders deferred to it), then dumped.
// Each sample's dump is checked as a layout case's is, against that sample's references: Chrome's boxes of the frame capture at
// the device DPR (device-frames' check a, and line boxes), the TS engine's boxes of the frame-applied program (check d), and the
// expected dump of the frame-applied program (check b, native classes and the expected digest). Pixels and line breaks have no
// per-sample Chrome reference (the frame capture records boxes and computed values), so they are not judged here; the settled
// sample equals the end assignment's static program (anim-lanes.test). Failures are relabelled device-anim.
import type { FrameEmit, FrameScriptStep, NativeBackend, NativeProgram, StateEmit } from 'dragon';
import { expectedDigest, expectedDump } from 'dragon';
import type { AnimCase, AnimFrame } from './anim-cases.ts';
import { animCasesOf, animFixtures, frameScript, frameStateProgram, runFrameScript } from './anim-cases.ts';
import type { WebCapture } from './capture.ts';
import type { CaseReference, DeviceSet, LaneFailure } from './device-lanes.ts';
import { ANIM_LANE, evaluateSet } from './device-lanes.ts';
import type { DeviceRecord } from './device-run.ts';
import { committedFrames } from './frame-capture.ts';
import { ENVIRONMENT } from './fixtures.ts';
import { BREAK_MISMATCH } from './line-breaks.ts';
import type { NativeCase } from './native-host.ts';
import { BACKEND_OF, engineBoxes, expectedEngine } from './native-host.ts';
import type { NativeTarget } from './targets.ts';
import { deviceDprs } from './targets.ts';

/** A frame sample's case id: the frame case id and the sample's index among its dumps. */
export const sampleId = (caseId: string, k: number): string => `${caseId}~f${k}`;

/** One frame case on one backend: its state program's dumps through the TS reference, each with the frame applied. */
type FrameRun = { readonly c: AnimCase; readonly backend: NativeBackend; readonly steps: ReturnType<typeof frameScript>; readonly programs: readonly NativeProgram[]; readonly frames: readonly AnimFrame[] };

const runs = new Map<string, FrameRun[]>();

/** Every frame case's run on a backend (cached): the script and the program of each dump. */
export function frameRuns(backend: NativeBackend): readonly FrameRun[] {
  const hit = runs.get(backend);
  if (hit !== undefined) return hit;
  const out = animFixtures().flatMap(animCasesOf).map((c): FrameRun => {
    const steps = frameScript(c);
    const sp = frameStateProgram(c, backend);
    const dumps = runFrameScript(c, steps, undefined, undefined, sp);
    return { c, backend, steps, programs: dumps.map((d) => d.program), frames: dumps.map((d) => d.frame) };
  });
  runs.set(backend, out);
  return out;
}

/** A frame script as the host runs it: a state step sets one state (R4); a step setting several is refused until one is needed. */
function hostSteps(r: FrameRun): FrameScriptStep[] {
  return r.steps.map((s): FrameScriptStep => {
    if (s.kind === 'advance') return { kind: 'advance', ms: s.ms };
    if (s.kind === 'dump') return { kind: 'dump' };
    const only = s.sets[0];
    if (s.sets.length !== 1 || only === undefined) throw new Error(`${r.c.id}: a frame step setting ${s.sets.length} states at once has no host step yet`);
    return { kind: 'set', state: only.state, value: only.value };
  });
}

/**
 * The frame cases for the host apps of a target, on the machines of `emits` (the exact list the host passes to emitStatePrograms,
 * which names machine k dragonStates<k>): each frame case runs on the one entry with its id and animation tables, and its steps
 * resolve against that entry's program, so a reordered or filtered list cannot put a script on another case's machine.
 */
export function frameCaseEmits(target: NativeTarget, emits: readonly StateEmit[]): FrameEmit[] {
  const engine = expectedEngine();
  return frameRuns(BACKEND_OF[target]).map((r): FrameEmit => {
    const at = emits.flatMap((e, k) => (e.id === r.c.id && e.anim !== undefined ? [k] : []));
    const k = at[0];
    if (at.length !== 1 || k === undefined) throw new Error(`${r.c.id}: ${at.length} state programs with animation tables carry this frame case, not 1`);
    return {
      id: r.c.id,
      fixture: r.c.fixture.id,
      direction: r.c.direction,
      compilerDigest: r.c.compiled.digest,
      viewport: r.c.viewport,
      machine: `dragonStates${k}`,
      program: (emits[k] as StateEmit).program,
      steps: hostSteps(r),
      samples: r.programs.map((p, j) => ({ id: sampleId(r.c.id, j), expectedDigests: deviceDprs(target).map((dpr) => ({ dpr, sha256: expectedDigest(expectedDump(p, sampleId(r.c.id, j), r.c.viewport, dpr, engine)) })) })),
    };
  });
}

/** A frame sample as a native case for the device checks, and its program on each backend. */
export type FrameSampleCase = { readonly sample: NativeCase; readonly caseId: string; readonly index: number };

/** Every frame sample of a target as a native case (identity: the frame fixture, its direction and viewport, the compile digest). */
export function frameSampleCases(): FrameSampleCase[] {
  const uikit = frameRuns('uikit');
  const android = frameRuns('android-views');
  return uikit.flatMap((r, i) => {
    const a = android[i];
    if (a === undefined || a.c.id !== r.c.id || a.programs.length !== r.programs.length) throw new Error(`${r.c.id}: the android frame run does not match the uikit one`);
    return r.programs.map((p, k): FrameSampleCase => {
      const id = sampleId(r.c.id, k);
      const environment = { ...ENVIRONMENT, direction: r.c.direction, viewport: r.c.viewport };
      const sample = { spec: r.c.fixture.spec, case: { id, fixture: r.c.fixture.id, index: k, environment, computedExtra: [], assignment: [], isInitial: false, authoredHtml: '', compiledHtml: () => '' }, compiled: r.c.compiled, programs: { uikit: p, 'android-views': a.programs[k] as NativeProgram } } as unknown as NativeCase;
      return { sample, caseId: r.c.id, index: k };
    });
  });
}

/** Chrome's boxes of one sample at a DPR as a capture the device-frames check reads (its fixture field is the sample id). */
export function sampleCapture(s: FrameSampleCase, dpr: number): WebCapture {
  const c = committedFrames(s.caseId, 'authored', dpr);
  if (c === null) throw new Error(`${s.caseId}: no authored frame capture at DPR ${dpr} (pnpm run parity:anim-capture)`);
  const at = c.samples[s.index];
  if (at === undefined) throw new Error(`${s.caseId}@${dpr}: the frame capture has ${c.samples.length} samples, not ${s.index + 1}`);
  return { fixture: s.sample.case.id, chrome: c.chrome, browser: '', platform: '', viewport: c.viewport, devicePixelRatio: dpr, direction: c.direction, nodes: at.nodes };
}

/** The references of one sample at a DPR: the frame-applied program's engine boxes and expected dump, and Chrome's boxes. */
export function sampleReference(target: NativeTarget, s: FrameSampleCase, dpr: number): CaseReference {
  const p = s.sample.programs[BACKEND_OF[target]];
  const viewport = s.sample.case.environment.viewport;
  return { engine: engineBoxes(p, viewport, dpr), expected: expectedDump(p, s.sample.case.id, viewport, dpr, expectedEngine()), chrome: sampleCapture(s, dpr), breaks: null, chromeBreaks: null, points: [], pixels: null };
}

/** The failure kinds device-anim does not judge: pixels and line breaks have no per-sample Chrome reference. */
const UNJUDGED = new Set<string>(['pixel', 'raster-size', 'capture-kind', 'blank-capture', BREAK_MISMATCH]);

/** device-anim at one DPR: every sample's dump checked against its references, failures under device-anim. */
export function evaluateAnim(target: NativeTarget, dpr: number, dir: string, device: DeviceRecord, samples: readonly FrameSampleCase[], extra: readonly LaneFailure[] = []): DeviceSet {
  const byId = new Map(samples.map((s) => [s.sample.case.id, s]));
  const set = evaluateSet(target, dpr, dir, device, samples.map((s) => s.sample), [], (n) => {
    const s = byId.get(n.case.id);
    if (s === undefined) throw new Error(`${n.case.id}: not a frame sample of this run`);
    return sampleReference(target, s, dpr);
  });
  // One failure per kind, case and detail: the check lanes report a missing or invalid dump each.
  const seen = new Set<string>();
  const failures: LaneFailure[] = [...extra];
  for (const f of set.failures) {
    if (UNJUDGED.has(f.kind)) continue;
    const k = `${f.case}\0${f.node ?? ''}\0${f.kind}\0${f.detail}`;
    if (seen.has(k)) continue;
    seen.add(k);
    failures.push({ ...f, lane: ANIM_LANE });
  }
  return { ...set, failures };
}
