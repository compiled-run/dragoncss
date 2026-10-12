// SELD-R2 PR 4 (notes/T064-seld-r2-spec.md R6, R7, R14, R16): the device-traces lane on the host. Every interaction group (a
// fixture and direction with interaction states) gets one script: its derived trace (interaction-cases.ts deriveTrace) with a trace
// step after every step. The device runs it on the generated DragonInteractionMachine and writes one record line per trace step to
// <script>@<scale>.trace; the TS reference (interaction-runtime.ts InteractionRuntime) gives the expected lines, which the device
// must equal line for line at every DPR. The steps are derived once, on the uikit program, since the partition, its element
// addresses and the hit test's engine input are the same for both backends; each backend's script runs its own program.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InteractionFaults } from '@dragon/layout';
import { rtInteraction } from '@dragon/layout';
import type { GeneratedFile, InteractionEmit, InteractionLevelInput, InteractionProgram, InteractionScriptStep, NativeBackend } from 'dragon';
import { emitInteractionPrograms, hitFacts, TRACE_LINE, traceLineOf } from 'dragon';
import type { InteractionGroup } from './interaction-cases.ts';
import { deriveTrace, groupHit, interactionGroups, interactionProgramOf, levelInputs } from './interaction-cases.ts';
import type { InteractionSnapshot, InteractionStep } from './interaction-runtime.ts';
import { InteractionRuntime } from './interaction-runtime.ts';
import type { NativeCase } from './native-host.ts';
import { BACKEND_OF } from './native-host.ts';
import type { NativeTarget } from './targets.ts';

/**
 * At most this many steps (trace steps not counted) per script: a group's derived trace is cut there, so one script stays a few
 * seconds on a device and its generated literal stays small. Every derived trace of the current fixtures fits; a cut is reported
 * by traceScriptCuts, never silent.
 */
export const MAX_TRACE_STEPS = 1200;

/** A group's device-traces script id: the group id (fixture and direction) and ~trace. */
export const traceScriptId = (g: InteractionGroup): string => `${g.id}~trace`;

/** The record file of a script at a device scale, beside the dumps. */
export const traceFile = (dir: string, id: string, scale: number): string => join(dir, `${id}@${scale}.trace`);

type Derived = { readonly id: string; readonly group: InteractionGroup; readonly steps: readonly InteractionStep[]; readonly cut: number };

let derived: readonly Derived[] | null = null;

function derive(): readonly Derived[] {
  if (derived !== null) return derived;
  derived = interactionGroups().map((g) => {
    const inputs = levelInputs(g, 'uikit');
    const all = deriveTrace(g, interactionProgramOf(g, 'uikit', inputs), inputs, 'uikit');
    return { id: traceScriptId(g), group: g, steps: all.slice(0, MAX_TRACE_STEPS), cut: Math.max(0, all.length - MAX_TRACE_STEPS) };
  });
  return derived;
}

function scriptOf(id: string): Derived {
  const d = derive().find((x) => x.id === id);
  if (d === undefined) throw new Error(`no device-traces script ${id}`);
  return d;
}

/** Every device-traces script id, in interaction group order. */
export function traceScriptIds(): string[] {
  return derive().map((d) => d.id);
}

/** The scripts whose derived trace was cut at MAX_TRACE_STEPS, with how many steps were left out. */
export function traceScriptCuts(): { readonly id: string; readonly omitted: number }[] {
  return derive().flatMap((d) => (d.cut > 0 ? [{ id: d.id, omitted: d.cut }] : []));
}

type Program = { readonly inputs: readonly InteractionLevelInput[]; readonly ip: InteractionProgram };
const programs = new Map<string, Program>();

function programOf(g: InteractionGroup, backend: NativeBackend): Program {
  const key = `${g.id}|${backend}`;
  let p = programs.get(key);
  if (p === undefined) {
    const inputs = levelInputs(g, backend);
    p = { inputs, ip: interactionProgramOf(g, backend, inputs) };
    programs.set(key, p);
  }
  return p;
}

/** A snapshot as a record line: addresses become table indices of the snapshot's app assignment. */
function lineOf(ip: InteractionProgram, index: number, s: InteractionSnapshot): string {
  const addresses = ip.levels[s.app]?.addresses;
  if (addresses === undefined) throw new Error(`no app assignment ${s.app}`);
  const at = (a: string | null): number => {
    if (a === null) return -1;
    const i = addresses.indexOf(a);
    if (i < 0) throw new Error(`${a} is not in app assignment ${s.app}'s tables`);
    return i;
  };
  return traceLineOf(index, s.app, s.state, s.hover.map(at), s.active.map(at), at(s.focus), at(s.focusVisible));
}

/**
 * Runs a script on the TS reference for a backend: the expected record lines (one after every step) and the script's device steps
 * (force names the table index of the app assignment it runs in). faults plants the reference runtime.
 */
function runScript(id: string, backend: NativeBackend, faults: InteractionFaults): { readonly lines: string[]; readonly steps: InteractionScriptStep[] } {
  const d = scriptOf(id);
  const { inputs, ip } = programOf(d.group, backend);
  const rt = new InteractionRuntime(ip, groupHit(d.group, inputs), faults);
  const lines: string[] = [];
  const steps: InteractionScriptStep[] = [];
  for (const s of d.steps) {
    if (s.kind === 'force') {
      const element = s.address === null ? -1 : (ip.levels[rt.assignment]?.addresses.indexOf(s.address) ?? -1);
      if (s.address !== null && element < 0) throw new Error(`${id}: forced ${s.address} is not in app assignment ${rt.assignment}'s tables`);
      steps.push({ kind: 'force', pseudo: s.pseudo, element });
    } else {
      steps.push(s);
    }
    lines.push(lineOf(ip, lines.length, rt.step(s)));
    steps.push({ kind: 'trace' });
  }
  return { lines, steps };
}

const references = new Map<string, string[]>();

/** The expected record lines of a script: the TS reference over the uikit program (traceReferenceFor gives a target's own). */
export function traceReference(scriptId: string): string[] {
  let r = references.get(scriptId);
  if (r === undefined) {
    r = runScript(scriptId, 'uikit', rtInteraction.NO_INTERACTION_FAULTS).lines;
    references.set(scriptId, r);
  }
  return r;
}

/** The record lines of a script on a target's own program, with the reference runtime planted by faults. */
export function traceReferenceFor(scriptId: string, target: NativeTarget, faults: InteractionFaults = rtInteraction.NO_INTERACTION_FAULTS): string[] {
  return runScript(scriptId, BACKEND_OF[target], faults).lines;
}

/** Every interaction program of a target with its device-traces script and the hit facts of every (app, state). */
export function traceEmits(target: NativeTarget): InteractionEmit[] {
  const backend = BACKEND_OF[target];
  return derive().map((d): InteractionEmit => {
    const { inputs, ip } = programOf(d.group, backend);
    const first = d.group.cases[0] as NativeCase;
    const facts = d.group.cases.map((n, app) => [null, ...(inputs[app] as InteractionLevelInput).partition.states.map((s) => s.key)].map((key) => {
      const f = hitFacts(n.compiled, n.case.assignment, key);
      if (f === null) throw new Error(`${n.case.id}: no hit facts for interaction state ${key ?? 'none'}`);
      return f;
    }));
    return {
      id: d.group.id,
      fixture: d.group.spec.id,
      direction: d.group.direction,
      compilerDigest: first.compiled.digest,
      viewport: first.case.environment.viewport,
      program: ip,
      facts,
      scripts: [{ id: d.id, steps: runScript(d.id, backend, rtInteraction.NO_INTERACTION_FAULTS).steps }],
    };
  });
}

/** The generated interaction sources of a target's host app (native-host hostSources): the programs and DragonInteractionCaseTable. faults plants the device runtime. */
export function deviceTraceSources(target: NativeTarget, faults: InteractionFaults | null = null): GeneratedFile[] {
  return emitInteractionPrograms(BACKEND_OF[target], traceEmits(target), faults);
}

/**
 * device-traces at one scale: every script's record in dir against its reference, line for line. A missing or unreadable record, a
 * malformed line, a line count that differs or any differing line fails the script; details name the first difference.
 */
export function evaluateTraces(dir: string, scale: number): { passed: number; failed: number; details: string[] } {
  let passed = 0;
  let failed = 0;
  const details: string[] = [];
  for (const id of traceScriptIds()) {
    const problem = compareTrace(traceFile(dir, id, scale), traceReference(id), scriptOf(id).steps.map((x) => x.kind));
    if (problem === null) passed++;
    else {
      failed++;
      details.push(`${id}@${scale}: ${problem}`);
    }
  }
  return { passed, failed, details };
}

/** Why a record file differs from the expected lines, or null when it equals them; kinds names the step before each trace. */
export function compareTrace(file: string, want: readonly string[], kinds: readonly string[] = []): string | null {
  if (!existsSync(file)) return 'the device wrote no trace record';
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return `the trace record is unreadable: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (text !== '' && !text.endsWith('\n')) return 'the trace record does not end with a newline (cut short?)';
  const got = text === '' ? [] : text.slice(0, -1).split('\n');
  const bad = got.findIndex((l) => !TRACE_LINE.test(l));
  if (bad >= 0) return `line ${bad + 1} is malformed: ${JSON.stringify(got[bad])}`;
  const differing = want.map((w, i) => (got[i] === w ? -1 : i)).filter((i) => i >= 0);
  if (got.length !== want.length || differing.length > 0) {
    const i = differing[0] ?? Math.min(got.length, want.length);
    const step = kinds[i] === undefined ? '' : ` (after a ${kinds[i]} step)`;
    return `${got.length} lines for ${want.length}; ${differing.length} differ; first at trace ${i}${step}: device ${JSON.stringify(got[i] ?? '(none)')}, reference ${JSON.stringify(want[i] ?? '(none)')}`;
  }
  return null;
}
