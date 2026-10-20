// T065 R18 (ANIM-b1 3b): the device-anim lane's cases. Every dump of a frame script is one sample: a case script that runs the
// frame script through that dump on a state mount, under its own id, so the device dumps the mounted tree with the frame applied.
// Its references are the TypeScript reference's live program at that dump (expected dump, engine boxes, break vector) and Chrome's
// frame capture at that sample, so the device is judged against exactly what the host frame lanes prove against Chrome.
import type { NativeBackend, NativeProgram, ScriptStep, StateEmit } from 'dragon';
import { animTablesOf, expectedDigest, expectedDump, programAt, StateRuntime } from 'dragon';
import type { AnimCase, FrameStep } from './anim-cases.ts';
import { Animator, animCasesOf, animFixtures, frameScript, frameStateProgram } from './anim-cases.ts';
import { BACKEND_OF, expectedEngine, referenceMeasurer } from './native-host.ts';
import { canonicalJsonText } from './state-cases.ts';
import type { NativeTarget } from './targets.ts';
import { deviceDprs } from './targets.ts';

/** One frame sample as the device runs it. */
export type AnimSample = {
  readonly id: string;
  readonly case: AnimCase;
  /** The dump's index in the frame script, which is the sample's index in the Chrome frame capture. */
  readonly index: number;
  readonly at: number;
  readonly settle: boolean;
  /** The frame script through this dump, one setter call per state set (R4: each call is one style change event). */
  readonly steps: readonly ScriptStep[];
  readonly assignment: number;
  /** The live program of the target's backend at the dump: the assignment's program with the frame written in (R16). */
  readonly program: NativeProgram;
  /** True when nothing animates at the dump, so the live program must be the assignment's static program (the settle rule). */
  readonly still: boolean;
};

export const animSampleId = (caseId: string, k: number): string => `${caseId}~f${k}`;

/** A frame script as case script steps; a state step that sets several states is refused, as the device would raise several events. */
export function scriptStepsOf(caseId: string, steps: readonly FrameStep[]): ScriptStep[] {
  return steps.map((s): ScriptStep => {
    if (s.kind === 'advance') return { kind: 'advance', ms: s.ms };
    if (s.kind === 'dump') return { kind: 'dump' };
    const only = s.sets[0];
    if (s.sets.length !== 1 || only === undefined) throw new Error(`${caseId}: a state step sets ${s.sets.length} states; the device raises one event per setter call, so a frame step sets exactly one`);
    return { kind: 'set', state: only.state, value: only.value };
  });
}

/** The samples of a frame case for a backend: the reference animator run over the backend's state program, as the mount runs it. */
export function animSamplesOf(c: AnimCase, backend: NativeBackend): AnimSample[] {
  const steps = frameScript(c);
  const script = scriptStepsOf(c.id, steps);
  const sp = frameStateProgram(c, backend);
  const rt = new StateRuntime(sp);
  const animator = new Animator(sp, c.ap, c.viewport, referenceMeasurer());
  const out: AnimSample[] = [];
  steps.forEach((s, i) => {
    if (s.kind === 'set') {
      for (const x of s.sets) rt.set(x.state, x.value);
      animator.event(rt.assignment);
    } else if (s.kind === 'advance') animator.advance(s.ms);
    else {
      const still = animator.frame().size === 0;
      const program = animator.program(rt.program());
      if (still && canonicalJsonText(program) !== canonicalJsonText(programAt(sp, rt.assignment))) throw new Error(`${c.id} dump ${out.length}: nothing animates, yet the live program is not assignment ${rt.assignment}'s`);
      out.push({ id: animSampleId(c.id, out.length), case: c, index: out.length, at: s.at, settle: s.settle, steps: script.slice(0, i + 1), assignment: rt.assignment, program, still });
    }
  });
  return out;
}

let cases: readonly AnimCase[] | null = null;
const samples = new Map<NativeTarget, readonly (readonly AnimSample[])[]>();

/** Every frame case of the corpus (computed once). */
export function allAnimCases(): readonly AnimCase[] {
  if (cases === null) cases = animFixtures().flatMap(animCasesOf);
  return cases;
}

/** Every frame case's samples for a target, per case in corpus order (computed once). */
export function animSamples(target: NativeTarget): readonly (readonly AnimSample[])[] {
  const hit = samples.get(target);
  if (hit !== undefined) return hit;
  const out = allAnimCases().map((c) => animSamplesOf(c, BACKEND_OF[target]));
  samples.set(target, out);
  return out;
}

/** Every device-anim case id of a target, in corpus and dump order. */
export function animSampleIds(target: NativeTarget): readonly string[] {
  return animSamples(target).flatMap((xs) => xs.map((s) => s.id));
}

const emits = new Map<NativeTarget, StateEmit[]>();

/**
 * The frame cases' state programs as the host apps carry them: their animation tables, and one case script per sample with its
 * expected digest at every device DPR of the target (what the dump's expectedDigest must equal).
 */
export function animEmits(target: NativeTarget): StateEmit[] {
  const hit = emits.get(target);
  if (hit !== undefined) return hit;
  const m = expectedEngine();
  const out = allAnimCases().map((c, k): StateEmit => ({
    id: c.id,
    fixture: c.fixture.id,
    direction: c.direction,
    compilerDigest: c.compiled.digest,
    viewport: c.viewport,
    program: frameStateProgram(c, BACKEND_OF[target]),
    scripts: (animSamples(target)[k] as readonly AnimSample[]).map((s) => ({
      id: s.id,
      steps: s.steps,
      expectedDigests: deviceDprs(target).map((dpr) => ({ dpr, sha256: expectedDigest(expectedDump(s.program, s.id, c.viewport, dpr, m)) })),
    })),
    anim: animTablesOf(c.ap),
  }));
  emits.set(target, out);
  return out;
}
