// SELD-R1a (notes/T047-runtime-spec.md §3.3 items 1, 3 and 4): the host half of device-states. Every tree fixture with free
// states, in both directions and for both backends: base plus delta equals each per-case program, and every derived script
// (initial -> X -> initial -> X) ends on the end assignment's program, expected dump and engine frames at every device DPR. The two
// plants each fail the check; the web attribute program lands on each assignment's classes; the host apps carry every script.
import { describe, expect, it } from 'vitest';
import type { NativeCase } from '../src/native-host.ts';
import { hostSources } from '../src/native-host.ts';
import { NO_FAULTS, webStateModule, webStateProgram } from 'dragon';
import { checkStates, deriveScripts, runScript, SCRIPT_FRAME_MS, stateEmits, stateGroups, stateProgramOf, webClassTables } from '../src/state-cases.ts';
import { deviceDprs } from '../src/targets.ts';

describe('the state programs of every tree fixture with states', () => {
  it('covers the tree fixtures with free states, both directions, within the 64-assignment table', () => {
    const groups = stateGroups();
    // Derived-count pins: 11 tree fixtures with free states, each in ltr and rtl.
    expect(groups.map((g) => g.id)).toEqual([
      'tree-switch-two-instances', 'tree-switch-two-instances-rtl', 'tree-correlated-state', 'tree-correlated-state-rtl', 'tree-controlled-aliases', 'tree-controlled-aliases-rtl',
      'tree-branch-arms', 'tree-branch-arms-rtl', 'tree-slot-projection', 'tree-slot-projection-rtl', 'tree-nested-instances', 'tree-nested-instances-rtl',
      'tree-attribute-equality', 'tree-attribute-equality-rtl', 'tree-projected-text', 'tree-projected-text-rtl', 'tree-position-toggle', 'tree-position-toggle-rtl',
      'tree-selectors-state', 'tree-selectors-state-rtl', 'tree-var-state', 'tree-var-state-rtl',
    ]);
    expect(groups.reduce((n, g) => n + g.cases.length, 0)).toBe(126);
    for (const g of groups) expect(g.cases.length).toBeLessThanOrEqual(64);
  });

  it('holds paint-only, style and tree deltas', () => {
    const kinds = new Set(stateGroups().flatMap((g) => stateProgramOf(g, 'uikit').deltas.map((d) => `${d.layout}:${d.removed.length > 0 || d.order !== null ? 'nodes' : 'same-nodes'}`)));
    expect([...kinds].sort()).toEqual(['none:same-nodes', 'styles:same-nodes', 'tree:nodes', 'tree:same-nodes']);
  });

  it('equals every per-case program, and every script ends on its end assignment at every device DPR', () => {
    const r = checkStates();
    expect(r.failures).toEqual([]);
    expect({ groups: r.groups, assignments: r.assignments, scripts: r.scripts }).toEqual({ groups: 22, assignments: 252, scripts: 252 });
    // Per backend: 126 delta comparisons, and 126 scripts at ios 2 and 3 or android 2, 2.625 and 3.
    expect(r.compared).toBe(126 + 126 * deviceDprs('ios').length + 126 + 126 * deviceDprs('android').length);
  });

  it('derives A to B to A scripts with a virtual-clock frame between the legs', () => {
    const g = stateGroups()[0] as (typeof stateGroups extends () => readonly (infer G)[] ? G : never);
    const sp = stateProgramOf(g, 'uikit');
    const scripts = deriveScripts(g, sp);
    expect(scripts.map((s) => s.ends)).toEqual(sp.assignments.map((_, i) => i));
    for (const s of scripts) {
      expect(s.steps[s.steps.length - 1]).toEqual({ kind: 'dump' });
      expect(s.steps.filter((x) => x.kind === 'advance').every((x) => x.kind === 'advance' && x.ms === SCRIPT_FRAME_MS)).toBe(true);
      expect(runScript(sp, s.steps).map((d) => d.assignment)).toEqual([s.ends]);
    }
    expect(() => runScript(sp, [{ kind: 'tap', x: 1, y: 1 }])).toThrow(/SELD-R1b/);
  });
});

describe('planted state faults (T047 §3.3 item 12, host half)', () => {
  it('stateDeltaDropped fails the delta and script checks', () => {
    const r = checkStates({ ...NO_FAULTS, stateDeltaDropped: true });
    expect(new Set(r.failures.map((f) => f.check))).toEqual(new Set(['delta', 'script']));
    // Every group with a delta that changes a node record fails; the others change only their engine input.
    const changing = stateGroups().filter((g) => stateProgramOf(g, 'uikit').deltas.some((d) => d.changed.length > 0)).map((g) => g.id);
    expect(changing.length).toBeGreaterThan(0);
    expect([...new Set(r.failures.map((f) => f.group))].sort()).toEqual([...changing].sort());
  });

  it('setterSkipsRelayout fails scripts, only ones that end on another engine input, in every group with a layout delta', () => {
    const r = checkStates({ ...NO_FAULTS, setterSkipsRelayout: true });
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.failures.every((f) => f.check === 'script')).toBe(true);
    const failed = new Set(r.failures.map((f) => `${f.backend} ${f.id}`));
    const groups = new Set<string>();
    for (const g of stateGroups()) {
      for (const backend of ['uikit', 'android-views'] as const) {
        const sp = stateProgramOf(g, backend);
        const relayouts = deriveScripts(g, sp).filter((s) => (sp.deltas[s.ends] as (typeof sp.deltas)[number]).variant !== (sp.deltas[sp.initial] as (typeof sp.deltas)[number]).variant);
        for (const s of deriveScripts(g, sp)) if (failed.has(`${backend} ${s.id}`)) expect(relayouts.map((x) => x.id)).toContain(s.id);
        if (relayouts.length > 0) groups.add(g.id);
      }
    }
    expect([...new Set(r.failures.map((f) => f.group))].sort()).toEqual([...groups].sort());
  });
});

describe('the web attribute program', () => {
  it('lands on each script end assignment\'s class attributes', async () => {
    for (const g of stateGroups()) {
      const sp = stateProgramOf(g, 'uikit');
      const tables = webClassTables(g);
      const mod = (await import(`data:text/javascript;base64,${Buffer.from(webStateModule(webStateProgram(sp, tables))).toString('base64')}`)) as { createDragonStates: (f: (a: string) => unknown) => { set: (s: string, v: unknown) => void } };
      for (const s of deriveScripts(g, sp)) {
        const attrs = new Map<string, string | null>();
        const states = mod.createDragonStates((address) => ({ setAttribute: (_: string, v: string) => attrs.set(address, v), removeAttribute: () => attrs.set(address, null) }));
        for (const step of s.steps) if (step.kind === 'set') states.set(step.state, step.value);
        const want = tables[s.ends] as ReadonlyMap<string, string | null>;
        for (const [address, c] of attrs) expect([s.id, address, c]).toEqual([s.id, address, want.get(address) ?? null]);
        for (const [address, c] of want) expect([s.id, address, attrs.get(address)]).toEqual([s.id, address, c]);
      }
    }
  });
});

describe('the host apps carry the case scripts', () => {
  it('registers every script with its end assignment\'s expected digests, and the hosts look scripts up beside the layout cases', () => {
    for (const target of ['ios', 'android'] as const) {
      const emits = stateEmits(target);
      const files = hostSources(target, 'test');
      const table = files.find((f) => f.path.endsWith(target === 'ios' ? 'Cases/DragonStateCaseTable.swift' : 'cases/DragonStateCaseTable.kt'));
      expect(table?.text).toContain(emits.flatMap((e, k) => e.scripts.map((_, j) => `dragonStates${k}Script${j}`)).join(', '));
      const sources = files.filter((f) => /DragonStates\d{3}\.(swift|kt)$/.test(f.path)).map((f) => f.text).join('\n');
      for (const e of emits) {
        for (const s of e.scripts) {
          expect(sources).toContain(JSON.stringify(s.id));
          expect(s.expectedDigests.map((d) => d.dpr)).toEqual([...deviceDprs(target)]);
          for (const d of s.expectedDigests) expect(sources).toContain(JSON.stringify(d.sha256));
        }
      }
      const main = files.find((f) => f.path === (target === 'ios' ? 'Host/main.swift' : 'kotlin/dev/dragon/host/DragonActivity.kt'))?.text ?? '';
      expect(main).toContain(target === 'ios' ? 'DragonHost.dragonCaseTable.merging(dragonStateCaseTable)' : 'dev.dragon.cases.dragonCaseTable + dev.dragon.cases.dragonStateCaseTable');
      expect(emits.reduce((n, e) => n + e.scripts.length, 0)).toBe(126);
    }
  });

  it('keeps the script cases out of the batch layout run', () => {
    const ids = new Set(stateEmits('ios').flatMap((e) => e.scripts.map((s) => s.id)));
    const cases: readonly NativeCase[] = stateGroups().flatMap((g) => g.cases);
    expect(cases.some((c) => ids.has(c.case.id))).toBe(false);
  });
});
