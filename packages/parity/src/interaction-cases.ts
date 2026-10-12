// SELD-R2 PR 3 (notes/T064-seld-r2-spec.md R6, R7, R12, R16): the host check of the interaction runtime. For every fixture
// and direction with interaction states, per native backend: every (app, state) program from the interaction program equals its
// per-case program, and derived traces of pointer, touch, key and forced steps run on the runtime reference (rt-interaction.ts over
// the compiled tables, hit tested on the live program) leave, at every step, the matches the R6 rules give, the state those
// matches resolve as in the partition, and that state's per-case program. The R6 expectations here come from the partition's
// own elements and dimensions (analysis/interaction.ts), not from rt-interaction.ts, so the check is independent of the runtime.
import type { InteractionFaults } from '@dragon/layout';
import { rtInteraction } from '@dragon/layout';
import type { InteractionLevelInput, InteractionPartition, InteractionProgram, NativeBackend, NativeProgram } from 'dragon';
import { deriveInteractionProgram, deriveStateProgram, focusTargetOf, hitFacts, interactionLevelInput, interactionPartitionOf, interactionProgramAt } from 'dragon';
import type { InteractionSnapshot, InteractionStep } from './interaction-runtime.ts';
import { InteractionRuntime } from './interaction-runtime.ts';
import { hitAt, prepareHit } from '../../layout/src/rt-hit.ts';
import { isForcedCaseId } from './cases.ts';
import { programHitTable } from './hit-capture.ts';
import type { NativeCase } from './native-host.ts';
import { BACKEND_OF, nativeCases } from './native-host.ts';
import { canonicalJsonText, pathBetween } from './state-cases.ts';
import type { FixtureSpec } from './fixtures.ts';
import { directionSuffix } from './fixtures.ts';

const LU = 64;

/** One fixture in one direction whose cases have interaction states: its layout cases in the compiler's enumeration order. */
export type InteractionGroup = { readonly spec: FixtureSpec; readonly direction: 'ltr' | 'rtl'; readonly id: string; readonly cases: readonly NativeCase[] };

let groups: readonly InteractionGroup[] | null = null;

/** Every fixture and direction with at least one interaction state in some case, forced cases left out. */
export function interactionGroups(): readonly InteractionGroup[] {
  if (groups !== null) return groups;
  const out: { spec: FixtureSpec; direction: 'ltr' | 'rtl'; id: string; cases: NativeCase[] }[] = [];
  for (const n of nativeCases()) {
    if (isForcedCaseId(n.case.id)) continue;
    const id = `${n.spec.id}${directionSuffix(n.case.environment.direction)}`;
    let g = out.find((x) => x.id === id);
    if (g === undefined) {
      g = { spec: n.spec, direction: n.case.environment.direction, id, cases: [] };
      out.push(g);
    }
    g.cases.push(n);
  }
  groups = out.filter((g) => g.cases.some((n) => (interactionPartitionOf(n.compiled, n.case.assignment)?.states.length ?? 0) > 0));
  return groups;
}

/** The level inputs of a group for a backend, one per case. */
export function levelInputs(g: InteractionGroup, backend: NativeBackend): InteractionLevelInput[] {
  return g.cases.map((n) => {
    const l = interactionLevelInput(n.compiled, n.case.assignment, backend);
    if (typeof l === 'string') throw new Error(`${n.case.id}: no interaction level: ${l}`);
    return l;
  });
}

/** The interaction program of a group for a backend, over the state program of its cases. */
export function interactionProgramOf(g: InteractionGroup, backend: NativeBackend, inputs: readonly InteractionLevelInput[] = levelInputs(g, backend)): InteractionProgram {
  const sp = deriveStateProgram(backend, g.cases.map((n) => ({ assignment: n.case.assignment, isInitial: n.case.isInitial, program: n.programs[backend] })));
  return deriveInteractionProgram(sp, inputs);
}

/** The hit test of a group's live program at DPR 1: rt-hit over the program's engine input, with the (app, state)'s hit facts. */
export function groupHit(g: InteractionGroup, inputs: readonly InteractionLevelInput[]): (program: NativeProgram, app: number, state: number, x: number, y: number) => string | null {
  return (program, app, state, x, y) => {
    const n = g.cases[app] as NativeCase;
    const key = state < 0 ? null : (inputs[app] as InteractionLevelInput).partition.states[state]?.key;
    if (key === undefined) throw new Error(`${n.case.id}: no interaction state ${state}`);
    const facts = hitFacts(n.compiled, n.case.assignment, key);
    if (facts === null) throw new Error(`${n.case.id}: no hit facts for interaction state ${state}`);
    const t = programHitTable(program, facts, n.case.environment.viewport, 1);
    const id = t.ids[hitAt(prepareHit(t.nodes, { ignorePointerEventsNone: false, reversedOrder: false }), x * LU, y * LU)] as string;
    // The view hit returns the document element when nothing else is hit; the hit names element addresses only.
    return (inputs[app] as InteractionLevelInput).partition.elements.some((e) => e.address === id) ? id : null;
  };
}

/** One point per element the hit test reaches in a case's none-state program, in element order: the first grid centre that hits it. */
export function elementPoints(g: InteractionGroup, inputs: readonly InteractionLevelInput[], app: number, backend: NativeBackend): { readonly address: string; readonly x: number; readonly y: number }[] {
  const n = g.cases[app] as NativeCase;
  const hit = groupHit(g, inputs);
  const program = n.programs[backend];
  const found = new Map<string, { x: number; y: number }>();
  const { width, height } = n.case.environment.viewport;
  // Pixel centres on a 4 px grid reach every box the fixtures draw (each is at least 8 px on both axes).
  for (let y = 2; y < height; y += 4) for (let x = 2; x < width; x += 4) {
    const a = hit(program, app, -1, x, y);
    if (a !== null && !found.has(a)) found.set(a, { x, y });
  }
  return (inputs[app] as InteractionLevelInput).partition.elements.flatMap((e) => {
    const p = found.get(e.address);
    return p === undefined ? [] : [{ address: e.address, x: p.x, y: p.y }];
  });
}

/** The derived trace of a group: for every app assignment (reached by setter paths) and element point, the R6 step kinds in turn. */
export function deriveTrace(g: InteractionGroup, ip: InteractionProgram, inputs: readonly InteractionLevelInput[], backend: NativeBackend): InteractionStep[] {
  const sp = ip.program;
  const steps: InteractionStep[] = [];
  let at = sp.initial;
  const order = [sp.initial, ...sp.assignments.map((_, i) => i).filter((i) => i !== sp.initial)];
  for (const app of order) {
    for (const m of pathBetween(sp, at, app)) steps.push({ kind: 'set', state: m.state, value: m.value });
    at = app;
    const points = elementPoints(g, inputs, app, backend);
    if (points.length === 0) throw new Error(`${g.id}: app assignment ${app} has no element the hit test reaches`);
    for (const p of points) {
      steps.push({ kind: 'move', x: p.x, y: p.y }, { kind: 'mouse-down', x: p.x, y: p.y }, { kind: 'mouse-up' }, { kind: 'key', modified: true }, { kind: 'key', modified: false });
      steps.push({ kind: 'exit-start' }, { kind: 'mouse-down', x: p.x, y: p.y }, { kind: 'frame' }, { kind: 'mouse-up' }, { kind: 'exit' });
      steps.push({ kind: 'touch-down', x: p.x, y: p.y }, { kind: 'touch-up', x: p.x, y: p.y }, { kind: 'touch-down', x: p.x, y: p.y }, { kind: 'touch-cancel' });
    }
    const pa = (inputs[app] as InteractionLevelInput).partition;
    const forced: [InteractionStep & { kind: 'force' }, readonly string[]][] = [];
    for (const [pseudo, cands] of [['hover', pa.candidates.hover], ['active', pa.candidates.active], ['focus', pa.candidates.focus], ['focus-visible', pa.candidates.focusVisible]] as const) {
      for (const a of cands) forced.push([{ kind: 'force', pseudo, address: a }, cands]);
    }
    for (const [f] of forced) steps.push(f);
    steps.push({ kind: 'force', pseudo: 'none', address: null }, { kind: 'exit' });
    // The pointer is left over the first point, so the next app's setter re-hits it (P11).
    const first = points[0];
    if (first !== undefined) steps.push({ kind: 'move', x: first.x, y: first.y });
  }
  return steps;
}

export type InteractionFailure = { readonly group: string; readonly backend: NativeBackend; readonly check: 'delta' | 'trace'; readonly step: number; readonly detail: string };

/** The chain of an address in a partition: it and its ancestors, root first. */
function chain(p: InteractionPartition, address: string | null): string[] {
  const parent = new Map(p.elements.map((e) => [e.address, e.parent]));
  const out: string[] = [];
  for (let a: string | null | undefined = address; a !== null && a !== undefined; a = parent.get(a)) out.unshift(a);
  return out;
}

/** The state matches resolve as (R7), found from the partition's dimensions by set equality; -1 is none. */
export function stateOfMatches(p: InteractionPartition, m: Pick<InteractionSnapshot, 'hover' | 'active' | 'focus' | 'focusVisible'>, forced: InteractionStep & { kind: 'force' } | null): number {
  const only = (set: readonly string[], cands: readonly string[]): string => JSON.stringify(set.filter((a) => cands.includes(a)));
  if (forced !== null && forced.pseudo !== 'none') {
    const i = p.elements.findIndex((e) => e.address === forced.address);
    const table = forced.pseudo === 'hover' ? p.forcedHoverOf : forced.pseudo === 'active' ? p.forcedActiveOf : forced.pseudo === 'focus' ? p.forcedFocusOf : p.forcedFocusVisibleOf;
    return table[i] as number;
  }
  const h = p.dimensions.hover.findIndex((v) => JSON.stringify(v.set) === only(m.hover, p.candidates.hover));
  const a = p.dimensions.active.findIndex((v) => JSON.stringify(v.set) === only(m.active, p.candidates.active));
  const focus = m.focus !== null && p.candidates.focus.includes(m.focus) ? m.focus : null;
  const visible = m.focusVisible !== null && p.candidates.focusVisible.includes(m.focusVisible) ? m.focusVisible : null;
  const f = p.dimensions.focus.findIndex((v) => v.focus === focus && v.focusVisible === visible);
  if (h < 0 || a < 0 || f < 0) throw new Error(`the matches ${JSON.stringify(m)} name no dimension value`);
  return p.combos[(h * p.dimensions.active.length + a) * p.dimensions.focus.length + f] as number;
}

/** What the R6 rules give for one step, from the snapshot before it and the element the step's point hits (null: none). */
function expectedAfter(p: InteractionPartition, before: InteractionSnapshot & { pending: boolean; keyboard: boolean }, s: InteractionStep, hit: string | null, consumes: (a: string) => boolean, keyboardInput: (a: string) => boolean): InteractionSnapshot & { pending: boolean; keyboard: boolean } {
  const pointerFocus = (x: InteractionSnapshot & { pending: boolean; keyboard: boolean }): InteractionSnapshot & { pending: boolean; keyboard: boolean } => {
    const f = focusTargetOf(p, hit);
    return { ...x, focus: f, focusVisible: f !== null && keyboardInput(f) ? f : null, keyboard: false };
  };
  switch (s.kind) {
    case 'move':
      return { ...before, hover: chain(p, hit), pending: false };
    case 'exit':
      return { ...before, hover: [], pending: false };
    case 'exit-start':
      return { ...before, pending: true };
    case 'frame':
      return before.pending ? { ...before, hover: [], pending: false } : before;
    case 'mouse-down':
      return { ...pointerFocus({ ...before, pending: false }), active: chain(p, hit) };
    case 'mouse-up':
    case 'touch-cancel':
      return { ...before, active: [] };
    case 'touch-down':
      return { ...before, active: chain(p, hit) };
    case 'touch-up': {
      const released = { ...before, active: [] };
      return hit !== null && consumes(hit) ? released : pointerFocus(released);
    }
    case 'key':
      return s.modified ? before : { ...before, keyboard: true, focusVisible: before.focus };
    case 'force':
    case 'set':
      return before;
  }
}

/**
 * The host interaction check. faults plants the runtime; every plant must leave at least one failure. Returns the failures and how
 * many groups, programs and steps were compared.
 */
export function checkInteractions(faults: InteractionFaults = rtInteraction.NO_INTERACTION_FAULTS): { readonly failures: readonly InteractionFailure[]; readonly groups: number; readonly programs: number; readonly steps: number } {
  const failures: InteractionFailure[] = [];
  let programs = 0;
  let steps = 0;
  const all = interactionGroups();
  for (const g of all) {
    for (const target of ['ios', 'android'] as const) {
      const backend = BACKEND_OF[target];
      const fail = (check: InteractionFailure['check'], step: number, detail: string): void => {
        failures.push({ group: g.id, backend, check, step, detail });
      };
      let inputs: InteractionLevelInput[];
      let ip: InteractionProgram;
      try {
        inputs = levelInputs(g, backend);
        ip = interactionProgramOf(g, backend, inputs);
      } catch (e) {
        fail('delta', -1, `no interaction program: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      inputs.forEach((input, app) => input.programs.forEach((want, k) => {
        programs++;
        if (canonicalJsonText(interactionProgramAt(ip, app, k)) !== canonicalJsonText(want)) fail('delta', -1, `app ${app} state ${k}: base plus delta differs from the per-case program`);
      }));
      const hit = groupHit(g, inputs);
      const rt = new InteractionRuntime(ip, hit, faults);
      let model: InteractionSnapshot & { pending: boolean; keyboard: boolean } = { ...rt.snapshot(), pending: false, keyboard: false };
      let forced: (InteractionStep & { kind: 'force' }) | null = null;
      let last: { x: number; y: number } | null = null;
      const trace = deriveTrace(g, ip, inputs, backend);
      for (let i = 0; i < trace.length; i++) {
        const s = trace[i] as InteractionStep;
        steps++;
        const p = (inputs[rt.assignment] as InteractionLevelInput).partition;
        const point = 'x' in s ? s : null;
        const at = point === null ? null : hit(rt.program(), rt.assignment, rt.state, point.x, point.y);
        const rootBefore = canonicalJsonText(rt.program().root);
        let got: InteractionSnapshot;
        try {
          got = rt.step(s);
        } catch (e) {
          fail('trace', i, `${s.kind}: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
        if (s.kind === 'force') forced = s.pseudo === 'none' ? null : s;
        if (s.kind === 'move' || s.kind === 'mouse-down') last = { x: s.x, y: s.y };
        const input = inputs[got.app] as InteractionLevelInput;
        const pa = input.partition;
        if (s.kind === 'set') {
          // An app setter keeps what survives in the new tree and re-hits a hovering pointer's last point (P11).
          const keep = (a: string | null): string | null => (a !== null && pa.elements.some((e) => e.address === a) ? a : null);
          const hovering = model.hover.length > 0 && last !== null;
          const hovered = hovering && last !== null ? hit(rt.program(), got.app, got.state, last.x, last.y) : null;
          const focus = keep(model.focus);
          const active = model.active.length === 0 ? null : keep(model.active[model.active.length - 1] as string);
          model = { ...model, hover: hovering ? chain(pa, hovered) : [], active: chain(pa, active), focus, focusVisible: focus === null ? null : keep(model.focusVisible), app: got.app };
          if (forced !== null && keep(forced.address) === null) forced = null;
        } else {
          model = expectedAfter(p, model, s, at, input.touchConsumesTap, input.keyboardInput);
          // A step that lays out another engine input under a hovering pointer re-hits its last point once (P11).
          if (model.hover.length > 0 && last !== null && canonicalJsonText(rt.program().root) !== rootBefore) model = { ...model, hover: chain(pa, hit(rt.program(), got.app, got.state, last.x, last.y)) };
        }
        const want: InteractionSnapshot = forced === null ? model : { hover: forced.pseudo === 'hover' ? [forced.address as string] : [], active: forced.pseudo === 'active' ? [forced.address as string] : [], focus: forced.pseudo === 'focus' ? forced.address : null, focusVisible: forced.pseudo === 'focus-visible' ? forced.address : null, app: got.app, state: -1 };
        const matches = (x: InteractionSnapshot): string => JSON.stringify([x.hover, x.active, x.focus, x.focusVisible]);
        if (matches(got) !== matches(want)) {
          fail('trace', i, `${s.kind}: the runtime matches ${matches(got)}, the R6 rules give ${matches(want)}`);
          continue;
        }
        const state = stateOfMatches(pa, got, forced);
        if (got.state !== state) {
          fail('trace', i, `${s.kind}: the runtime shows state ${got.state}, the matches resolve as ${state}`);
          continue;
        }
        const program = state < 0 ? (g.cases[got.app] as NativeCase).programs[backend] : (input.programs[state] as NativeProgram);
        if (canonicalJsonText(rt.program().nodes) !== canonicalJsonText(program.nodes)) fail('trace', i, `${s.kind}: the live node records differ from state ${state}'s per-case program`);
      }
    }
  }
  return { failures, groups: all.length, programs, steps };
}
