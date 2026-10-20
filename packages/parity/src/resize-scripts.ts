// MQ-R1 (notes/T067-mq-r-spec.md R5, R7 (a)): the resize scripts as device case scripts. Each resize case (resize-capture.ts) runs
// on its band program (env#band last) in the host apps, as one case script per prefix of its script: script k is the start and the
// first k steps, then a dump, so the device lanes compare frames, applied values and pixels after every step. Script k's reference
// is the per-case program of (the app assignment after step k, the band MQ-R0's partition gives its size) laid out at that size,
// Chrome's resize capture after step k at the device DPR, and Chrome's pixels after step k. MQ-R2: a script of a sheet with device
// features starts by injecting Chrome's desktop readings (a mouse, no motion preference) and its env steps inject theirs, so the
// device answers them as Chrome's emulation did; the band and program of a step can then differ by DPR (resolution).
import { rtBand } from '@dragon/layout';
import type { MediaDevice, NativeBackend, NativeProgram, ScriptStep, StateEmit } from 'dragon';
import { expectedDigest, expectedDump, nativeBandOfViewport, nativeBandPrograms, nativeBands } from 'dragon';
import type { CaseReference, ScriptCase } from './device-lanes.ts';
import type { Size } from './fixture-groups/media-runtime.ts';
import type { NativeCase } from './native-host.ts';
import { BACKEND_OF, engineBoxes, expectedEngine } from './native-host.ts';
import { casePoints } from './pixel-reference.ts';
import type { ResizeCase } from './resize-capture.ts';
import { committedResize, committedResizePixels, deviceAt, resizeCases, resizeProgram, scriptPoints } from './resize-capture.ts';
import type { NativeTarget } from './targets.ts';
import { deviceDprs } from './targets.ts';

/** The id of prefix script k of a resize case ("<fixture>[-rtl]~resize<k>"). */
export const resizeScriptId = (caseId: string, k: number): string => `${caseId.replace(/~resize$/, '')}~resize${k}`;

type Programs = { readonly [B in NativeBackend]: NativeProgram };

/**
 * Prefix script k: its steps (the first k steps, then a dump), where it ends, the device readings it ends with, and its band and
 * end programs at a DPR (the same at every DPR unless the sheet reads the scale).
 */
export type ResizePrefix = {
  readonly id: string;
  readonly k: number;
  readonly steps: readonly ScriptStep[];
  readonly start: Size;
  readonly end: Size;
  readonly device: MediaDevice;
  readonly bandAt: (dpr: number) => number;
  readonly programsAt: (dpr: number) => Programs;
};

/** Whether a compile's bands read the device (MQ-R2): its script then injects the readings. */
const readsDevice = (c: ResizeCase): boolean => (nativeBands(c.compiled)?.table.atoms ?? []).some((a) => !['width', 'height', 'orientation', 'aspect-ratio'].includes(a.feature));

/** Chrome's start readings, injected first by the script of a sheet that reads the device. */
const START_STEPS: readonly ScriptStep[] = [{ kind: 'env', reading: 'pointer', value: 'desktop' }, { kind: 'env', reading: 'motion', value: 'no-preference' }];

/** Every prefix script of a resize case, with both backends' end programs at each DPR. */
export function resizePrefixes(c: ResizeCase): ResizePrefix[] {
  const points = scriptPoints(c);
  const inject = readsDevice(c);
  return points.map((pt, k): ResizePrefix => {
    const bands = new Map<number, number>();
    const programs = new Map<number, Programs>();
    const bandAt = (dpr: number): number => {
      const hit = bands.get(dpr);
      if (hit !== undefined) return hit;
      const band = nativeBandOfViewport(c.compiled, pt.size, deviceAt(pt, dpr));
      if (band === null) throw new Error(`${c.id} step ${k}: no band of the partition holds ${pt.size.width}x${pt.size.height} at DPR ${dpr}`);
      bands.set(dpr, band);
      return band;
    };
    const programsAt = (dpr: number): Programs => {
      const hit = programs.get(dpr);
      if (hit !== undefined) return hit;
      const p = nativeBandPrograms(c.compiled, pt.assignment, bandAt(dpr));
      if (p.kind !== 'ready') throw new Error(`${c.id} step ${k} at DPR ${dpr}: no per-case program: ${p.reason}`);
      programs.set(dpr, p.programs);
      return p.programs;
    };
    const steps: ScriptStep[] = [
      ...(inject ? START_STEPS : []),
      ...c.script.steps.slice(0, k).map((s): ScriptStep => (s.kind === 'resize' ? { kind: 'resize', width: s.width, height: s.height } : s.kind === 'env' ? s : { kind: 'set', state: s.state, value: s.value })),
      { kind: 'dump' },
    ];
    return { id: resizeScriptId(c.id, k), k, steps, start: c.script.start, end: pt.size, device: pt.device, bandAt, programsAt };
  });
}

const emits = new Map<NativeTarget, StateEmit[]>();

/** The resize cases as state programs with their prefix scripts and expected digests at the target's device DPRs (computed once). */
export function resizeEmits(target: NativeTarget): StateEmit[] {
  const cached = emits.get(target);
  if (cached !== undefined) return cached;
  const backend = BACKEND_OF[target];
  const m = expectedEngine();
  const out = resizeCases().map((c): StateEmit => ({
    id: c.id,
    fixture: c.spec.id,
    direction: c.direction,
    compilerDigest: c.compiled.digest,
    viewport: c.script.start,
    program: resizeProgram(c, undefined, backend),
    band: nativeBands(c.compiled)?.table ?? { atoms: [], bands: [[]] },
    scripts: resizePrefixes(c).map((p) => ({
      id: p.id,
      steps: p.steps,
      start: p.start,
      viewport: p.end,
      expectedDigests: deviceDprs(target).map((dpr) => ({ dpr, sha256: expectedDigest(expectedDump(p.programsAt(dpr)[backend], p.id, p.end, dpr, m)) })),
    })),
  }));
  emits.set(target, out);
  return out;
}

/** A resize prefix script as a device script case: a native case at its end size, whose end case is itself. */
export function resizeScriptCases(target: NativeTarget): (ScriptCase & { readonly reference: (dpr: number) => CaseReference })[] {
  return resizeCases().flatMap((c) => {
    const parity = c.cases[0];
    if (parity === undefined) throw new Error(`${c.id}: no parity case`);
    return resizePrefixes(c).map((p) => {
      // The case's own programs are the DPR 1 ones; every device check takes the programs of its DPR from the reference.
      const n: NativeCase = { spec: c.spec, case: { ...parity, id: p.id, environment: { ...parity.environment, viewport: p.end } }, compiled: c.compiled, programs: p.programsAt(1) };
      return { script: n, end: n, reference: (dpr: number) => resizeReference(target, c, p, dpr) };
    });
  });
}

/** The references of prefix script k at a device DPR: the end program's engine boxes and expected dump at its size, Chrome's capture and pixels after step k. */
export function resizeReference(target: NativeTarget, c: ResizeCase, p: ResizePrefix, dpr: number): CaseReference {
  const program = p.programsAt(dpr)[BACKEND_OF[target]];
  const cap = committedResize(c.id, 'authored', dpr);
  const sample = cap?.samples[p.k];
  if (cap === null || sample === undefined || sample.size.width !== p.end.width || sample.size.height !== p.end.height) throw new Error(`${p.id}: no committed resize capture of step ${p.k} at DPR ${dpr} (pnpm run parity:resize-capture)`);
  return {
    engine: engineBoxes(program, p.end, dpr),
    expected: expectedDump(program, p.id, p.end, dpr, expectedEngine()),
    chrome: { fixture: p.id, chrome: cap.chrome, browser: '', platform: '', viewport: p.end, devicePixelRatio: dpr, direction: c.direction, nodes: sample.nodes },
    // A resize step's lines are judged by their boxes against Chrome's and the engine's (device-lines); no break capture is taken.
    breaks: null,
    chromeBreaks: null,
    breaksNotCompared: 'a resize step has no break capture; its line boxes are compared with Chrome and the engine',
    points: casePoints(program, p.end, dpr),
    pixels: committedResizePixels(c.id, dpr, p.k),
    // The environment the root view must report: its size in whole device px, Chrome's media size of it, and the partition's band.
    environment: {
      rootPx: [p.end.width * dpr, p.end.height * dpr],
      media: [rtBand.mediaSize(p.end.width * dpr, dpr), rtBand.mediaSize(p.end.height * dpr, dpr)],
      band: p.bandAt(dpr),
      // MQ-R2: a script that injects its readings must report them; the platform's own readings are device-env's to judge.
      readings: readsDevice(c) ? p.device : null,
    },
  };
}
