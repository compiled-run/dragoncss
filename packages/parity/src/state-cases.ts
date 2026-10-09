// SELD-R1a (notes/T047-runtime-spec.md §3.3): the state programs of every tree fixture with free states, their derived case
// scripts, the host run of each script on the TypeScript runtime reference, and the script cases the host apps carry. The oracle is
// the per-case program: after any script, the runtime's program, its expected dump and its engine frames must equal those of the
// assignment the script ends in, at every device DPR. Scripts are derived, never written by hand: for every reachable assignment X,
// initial -> X -> initial -> X (A to B to A), with a virtual-clock step between; the initial assignment's script goes to its first
// neighbour and back.
import type { LayoutRect } from '@dragon/layout';
import type { NativeBackend, NativeProgram, ScriptStep, StateEmit, StateFaults, StateProgram, WebClassTable } from 'dragon';
import { deriveStateProgram, expectedDigest, expectedDump, NO_STATE_FAULTS, programAt, StateRuntime, VirtualClock, webClassMap } from 'dragon';
import type { NativeCase } from './native-host.ts';
import { BACKEND_OF, emitCases, engineBoxes, expectedEngine, nativeCases } from './native-host.ts';
import { compileFixture } from './pipeline.ts';
import type { FixtureSpec } from './fixtures.ts';
import { directionSuffix } from './fixtures.ts';
import type { NativeTarget } from './targets.ts';
import { deviceDprs } from './targets.ts';

/** One tree fixture in one direction with free states: its layout cases in the compiler's enumeration order. */
export type StateGroup = { readonly spec: FixtureSpec; readonly direction: 'ltr' | 'rtl'; readonly id: string; readonly cases: readonly NativeCase[] };

let groups: readonly StateGroup[] | null = null;

/** Every tree fixture and direction whose cases carry free states, in layout-case order. */
export function stateGroups(): readonly StateGroup[] {
  if (groups !== null) return groups;
  const out: { spec: FixtureSpec; direction: 'ltr' | 'rtl'; id: string; cases: NativeCase[] }[] = [];
  for (const n of nativeCases()) {
    if (n.spec.format !== 'tree' || n.case.assignment.length === 0) continue;
    const direction = n.case.environment.direction;
    const id = `${n.spec.id}${directionSuffix(direction)}`;
    let g = out.find((x) => x.id === id);
    if (g === undefined) {
      g = { spec: n.spec, direction, id, cases: [] };
      out.push(g);
    }
    g.cases.push(n);
  }
  groups = out;
  return out;
}

/** The state program of a group for a backend. */
export function stateProgramOf(g: StateGroup, backend: NativeBackend, faults: StateFaults = NO_STATE_FAULTS): StateProgram {
  return deriveStateProgram(backend, g.cases.map((n) => ({ assignment: n.case.assignment, isInitial: n.case.isInitial, program: n.programs[backend] })), faults);
}

// ---------------------------------------------------------------- derived scripts

type Move = { readonly state: string; readonly value: StateProgram['states'][number]['domain'][number] };

/** The shortest single-state path from one assignment to another over sp.next (breadth first, states then values in order). */
export function pathBetween(sp: StateProgram, from: number, to: number): Move[] {
  const back = new Map<number, { readonly prev: number; readonly move: Move }>();
  const seen = new Set([from]);
  const queue = [from];
  for (let i = 0; i < queue.length && !seen.has(to); i++) {
    const a = queue[i] as number;
    sp.states.forEach((s, si) => s.domain.forEach((v, vi) => {
      const b = ((sp.next[a] as readonly (readonly number[])[])[si] as readonly number[])[vi] as number;
      if (b < 0 || seen.has(b)) return;
      seen.add(b);
      back.set(b, { prev: a, move: { state: s.key, value: v } });
      queue.push(b);
    }));
  }
  if (!seen.has(to)) throw new Error(`assignment ${to} is not reachable from ${from} by single-state setter calls`);
  const moves: Move[] = [];
  for (let at = to; at !== from;) {
    const step = back.get(at) as { prev: number; move: Move };
    moves.unshift(step.move);
    at = step.prev;
  }
  return moves;
}

/** The virtual-clock step between the legs of a script: one 60 Hz frame; nothing animates in SELD-R1a, so it must change nothing. */
export const SCRIPT_FRAME_MS = 1000 / 60;

export type Script = { readonly id: string; readonly ends: number; readonly steps: readonly ScriptStep[] };

const sets = (moves: readonly Move[]): ScriptStep[] => moves.map((m) => ({ kind: 'set', state: m.state, value: m.value }));

/** The derived scripts of a state program: one per reachable assignment, each ending in it. */
export function deriveScripts(g: StateGroup, sp: StateProgram): Script[] {
  const init = sp.initial;
  return sp.assignments.map((_, x): Script => {
    const id = `${g.spec.id}~script${x}${directionSuffix(g.direction)}`;
    const tick: ScriptStep = { kind: 'advance', ms: SCRIPT_FRAME_MS };
    if (x !== init) return { id, ends: x, steps: [...sets(pathBetween(sp, init, x)), tick, ...sets(pathBetween(sp, x, init)), tick, ...sets(pathBetween(sp, init, x)), { kind: 'dump' }] };
    const neighbour = sp.assignments.findIndex((__, y) => y !== init);
    if (neighbour < 0) return { id, ends: x, steps: [tick, { kind: 'dump' }] };
    return { id, ends: x, steps: [...sets(pathBetween(sp, init, neighbour)), tick, ...sets(pathBetween(sp, neighbour, init)), { kind: 'dump' }] };
  });
}

// ---------------------------------------------------------------- the host run

/**
 * A script's dumps on the runtime reference, mounted as the device mounts it (DragonStateMount): the program rendered at the start
 * and again after every committed setter, the assignment, and the taps since the previous dump (hit on the rendered program).
 */
export function runScript(sp: StateProgram, steps: readonly ScriptStep[], faults: StateFaults = NO_STATE_FAULTS, tap: ((program: NativeProgram, assignment: number, x: number, y: number) => string | null) | null = null): { readonly assignment: number; readonly program: NativeProgram; readonly taps: readonly (string | null)[] }[] {
  const rt = new StateRuntime(sp, faults);
  let rendered = rt.program();
  rt.onChange = () => {
    rendered = rt.program();
  };
  const clock = new VirtualClock();
  const out: { assignment: number; program: NativeProgram; taps: (string | null)[] }[] = [];
  let taps: (string | null)[] = [];
  for (const s of steps) {
    switch (s.kind) {
      case 'set':
        rt.set(s.state, s.value);
        break;
      case 'advance':
        clock.advance(s.ms);
        break;
      case 'tap':
        // RT-9 tap dispatch on the rendered program: the activation target the hit test reaches, recorded with the next dump.
        if (tap === null) throw new Error(`tap(${s.x}, ${s.y}) needs a tap handler (the hit table of the live program)`);
        taps.push(tap(rendered, rt.assignment, s.x, s.y));
        break;
      case 'dump':
        out.push({ assignment: rt.assignment, program: rendered, taps });
        taps = [];
        break;
    }
  }
  if (taps.length > 0) throw new Error(`${taps.length} tap(s) after the last dump would be recorded nowhere`);
  return out;
}

export type StateFailure = { readonly group: string; readonly backend: NativeBackend; readonly check: 'delta' | 'script'; readonly id: string; readonly dpr: number | null; readonly detail: string };

const framesOf = (p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number): readonly LayoutRect[] => engineBoxes(p, viewport, dpr);

/**
 * The host states check (the host half of device-states): every assignment's base-plus-delta program equals its per-case program,
 * and every derived script ends on a program whose record, expected dump and engine frames equal the end assignment's at every
 * device DPR of the backend's target. Faults plant the state lowering or the setter.
 */
export function checkStates(faults: StateFaults = NO_STATE_FAULTS): { readonly failures: readonly StateFailure[]; readonly groups: number; readonly assignments: number; readonly scripts: number; readonly compared: number } {
  const failures: StateFailure[] = [];
  const m = expectedEngine();
  let assignments = 0;
  let scripts = 0;
  let compared = 0;
  const all = stateGroups();
  for (const g of all) {
    for (const target of ['ios', 'android'] as const) {
      const backend = BACKEND_OF[target];
      let sp: StateProgram;
      try {
        sp = stateProgramOf(g, backend, faults);
      } catch (e) {
        failures.push({ group: g.id, backend, check: 'delta', id: g.id, dpr: null, detail: `no state program: ${e instanceof Error ? e.message : String(e)}` });
        continue;
      }
      assignments += sp.assignments.length;
      const viewport = (g.cases[0] as NativeCase).case.environment.viewport;
      g.cases.forEach((n, i) => {
        compared++;
        let got: string;
        try {
          got = canonicalJsonText(programAt(sp, i));
        } catch (e) {
          failures.push({ group: g.id, backend, check: 'delta', id: n.case.id, dpr: null, detail: e instanceof Error ? e.message : String(e) });
          return;
        }
        if (got !== canonicalJsonText(n.programs[backend])) failures.push({ group: g.id, backend, check: 'delta', id: n.case.id, dpr: null, detail: 'base plus delta differs from the per-case program' });
      });
      for (const s of deriveScripts(g, sp)) {
        scripts++;
        const want = (g.cases[s.ends] as NativeCase).programs[backend];
        let dumps: ReturnType<typeof runScript>;
        try {
          dumps = runScript(sp, s.steps, faults);
        } catch (e) {
          failures.push({ group: g.id, backend, check: 'script', id: s.id, dpr: null, detail: e instanceof Error ? e.message : String(e) });
          continue;
        }
        const last = dumps[dumps.length - 1];
        if (last === undefined || last.assignment !== s.ends) {
          failures.push({ group: g.id, backend, check: 'script', id: s.id, dpr: null, detail: `ends in assignment ${last === undefined ? 'none' : last.assignment}, not ${s.ends}` });
          continue;
        }
        if (canonicalJsonText(last.program.nodes) !== canonicalJsonText(want.nodes)) failures.push({ group: g.id, backend, check: 'script', id: s.id, dpr: null, detail: 'the node records differ from the end assignment\'s program' });
        for (const dpr of deviceDprs(target)) {
          compared++;
          try {
            if (expectedDigest(expectedDump(last.program, s.id, viewport, dpr, m)) !== expectedDigest(expectedDump(want, s.id, viewport, dpr, m))) failures.push({ group: g.id, backend, check: 'script', id: s.id, dpr, detail: 'the expected dump differs from the end assignment\'s' });
            if (canonicalJsonText(framesOf(last.program, viewport, dpr)) !== canonicalJsonText(framesOf(want, viewport, dpr))) failures.push({ group: g.id, backend, check: 'script', id: s.id, dpr, detail: 'the engine frames differ from the end assignment\'s' });
          } catch (e) {
            failures.push({ group: g.id, backend, check: 'script', id: s.id, dpr, detail: e instanceof Error ? e.message : String(e) });
          }
        }
      }
    }
  }
  return { failures, groups: all.length, assignments, scripts, compared };
}

/** JSON with object keys sorted, so two equal records compare equal whatever order their fields were written in. */
export function canonicalJsonText(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJsonText).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJsonText(x)}`).join(',')}}`;
}

// ---------------------------------------------------------------- the host apps' script cases

const emits = new Map<NativeTarget, StateEmit[]>();

/**
 * The host apps look a case id up in the layout case table and the script case table together, and a shared id would silently run
 * one of the two (the Swift merge keeps the layout case, the Kotlin one the script), so no script may share a layout case's id.
 */
export function assertDistinctCaseIds(states: readonly StateEmit[], layoutIds: readonly string[]): void {
  const layout = new Set(layoutIds);
  const shared = states.flatMap((e) => e.scripts.map((s) => s.id)).filter((id) => layout.has(id));
  if (shared.length > 0) throw new Error(`case scripts share ids with layout cases: ${shared.join(', ')}`);
}

/** Every state program of a target with its script cases and their expected digests at the target's device DPRs (computed once). */
export function stateEmits(target: NativeTarget): StateEmit[] {
  const cached = emits.get(target);
  if (cached !== undefined) return cached;
  const backend = BACKEND_OF[target];
  const m = expectedEngine();
  const out = stateGroups().map((g): StateEmit => {
    const sp = stateProgramOf(g, backend);
    const first = g.cases[0] as NativeCase;
    const viewport = first.case.environment.viewport;
    return {
      id: g.id,
      fixture: g.spec.id,
      direction: g.direction,
      compilerDigest: first.compiled.digest,
      viewport,
      program: sp,
      scripts: deriveScripts(g, sp).map((s) => ({
        id: s.id,
        steps: s.steps,
        expectedDigests: deviceDprs(target).map((dpr) => ({ dpr, sha256: expectedDigest(expectedDump((g.cases[s.ends] as NativeCase).programs[backend], s.id, viewport, dpr, m)) })),
      })),
    };
  });
  assertDistinctCaseIds(out, emitCases(target).map((c) => c.id));
  emits.set(target, out);
  return out;
}

/** The web class tables of a group, per assignment in enumeration order, from the web compile of its fixture and direction. */
export function webClassTables(g: StateGroup): WebClassTable[] {
  const compiled = compileFixture(g.spec, undefined, 'enforce', g.direction).compiled;
  return g.cases.map((n) => {
    const t = webClassMap(compiled, n.case.assignment);
    if (t === null) throw new Error(`${n.case.id}: the web output is not ready`);
    return t;
  });
}
