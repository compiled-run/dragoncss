// SELD-R1a (notes/T047-runtime-spec.md §3.3): the state program on synthetic programs. Base plus delta must equal each per-case
// program; setters validate before any change, move only between reachable assignments and lay out again only when the engine
// input variant changes; the table limit refuses, never truncates; the emitted runtime carries typed setters; the web attribute
// program writes each assignment's classes. The full fixture oracle is packages/parity/test/state-cases.test.ts.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { Assignment, NativeProgram, ProgramNode, ScriptCase, StateCase, StateEmit, StateProgram } from 'dragon';
import { applyDelta, ClockError, deriveStateProgram, emitNativeSupport, emitStatePrograms, MAX_STATE_TABLE_ASSIGNMENTS, NO_FAULTS, programAt, stateKey, StateProgramError, StateRuntime, StateValueError, typedSetters, VirtualClock, webStateModule, webStateProgram } from 'dragon';

const px = (value: number) => ({ kind: 'px', value });
const auto = { kind: 'auto' };
const style = (width: number): LayoutBox['style'] => ({
  display: 'block', position: 'static', top: auto, right: auto, bottom: auto, left: auto, overflowX: 'visible', overflowY: 'visible', direction: 'ltr', boxSizing: 'content-box',
  width: px(width), height: auto, minWidth: auto, minHeight: auto, maxWidth: { kind: 'none' }, maxHeight: { kind: 'none' }, marginTop: px(0), marginRight: px(0), marginBottom: px(0), marginLeft: px(0),
  paddingTop: px(0), paddingRight: px(0), paddingBottom: px(0), paddingLeft: px(0), borderTopWidth: px(0), borderRightWidth: px(0), borderBottomWidth: px(0), borderLeftWidth: px(0),
  flexDirection: 'row', flexWrap: 'nowrap', flexGrow: 0, flexShrink: 1, flexBasis: auto, order: 0, justifyContent: 'flex-start', alignItems: 'stretch', alignSelf: 'auto', alignContent: 'normal',
  rowGap: { kind: 'normal' }, columnGap: { kind: 'normal' }, textAlign: 'start',
}) as unknown as LayoutBox['style'];
const box = (id: string, width: number, children: LayoutBox['children'] = []): LayoutBox => ({ kind: 'box', id, boxType: 'element', style: style(width), children });

const node = (id: string, parent: string | null, color: number): ProgramNode => ({
  id,
  parent,
  host: parent,
  kind: 'element',
  native: 'DragonBoxView',
  clips: false,
  text: null,
  writes: [{ kind: 'background-color', color: { r: color, g: 0, b: 0, alpha: 255 }, key: 'backgroundColor', technique: 'native-property', detail: 'test', css: ['background-color'] }],
  facts: {},
});

const program = (root: LayoutBox, nodes: readonly ProgramNode[]): NativeProgram => ({ version: 'dragon.uikit-program/1', backend: 'uikit', root, rootFontSize: 16, nodes });

const a = (open: boolean, side: string): Assignment => [{ state: { instance: 'doc', state: 'open' }, value: open }, { state: { instance: 'doc', state: 'side' }, value: side }];

// Four assignments: paint only (open), layout (side), a branch node (open and end).
const CASES: StateCase[] = [
  { assignment: a(false, 'start'), isInitial: true, program: program(box('r', 10), [node('r', null, 1)]) },
  { assignment: a(true, 'start'), isInitial: false, program: program(box('r', 10), [node('r', null, 2)]) },
  { assignment: a(false, 'end'), isInitial: false, program: program(box('r', 20), [node('r', null, 1)]) },
  { assignment: a(true, 'end'), isInitial: false, program: program(box('r', 20, [box('b', 5)]), [node('r', null, 2), node('b', 'r', 3)]) },
];

describe('deriveStateProgram', () => {
  const sp = deriveStateProgram('uikit', CASES);

  it('holds every state, its domain and the transition table', () => {
    expect(sp.states.map((s) => [s.key, s.domain])).toEqual([['doc#open', [false, true]], ['doc#side', ['start', 'end']]]);
    expect(sp.initial).toBe(0);
    expect(sp.next[0]).toEqual([[0, 1], [0, 2]]);
    expect(sp.next[3]).toEqual([[2, 3], [1, 3]]);
  });

  it('gives base plus delta equal to every per-case program', () => {
    CASES.forEach((c, i) => expect(programAt(sp, i)).toEqual(c.program));
    expect(sp.deltas.map((d) => [d.layout, d.variant, d.changed.map((n) => n.id), d.removed])).toEqual([['none', 0, [], []], ['none', 0, ['r'], []], ['styles', 1, [], []], ['tree', 2, ['r', 'b'], []]]);
  });

  it('refuses rather than truncates', () => {
    expect(() => deriveStateProgram('uikit', [])).toThrow(StateProgramError);
    expect(() => deriveStateProgram('uikit', CASES.map((c) => ({ ...c, isInitial: true })))).toThrow(/exactly one initial/);
    expect(() => deriveStateProgram('uikit', [CASES[0] as StateCase, { ...(CASES[0] as StateCase), isInitial: false }])).toThrow(/same assignment/);
    expect(() => deriveStateProgram('android-views', CASES)).toThrow(/uikit program in a android-views/);
    const many = Array.from({ length: MAX_STATE_TABLE_ASSIGNMENTS + 1 }, (_, i): StateCase => ({ assignment: [{ state: { instance: 'doc', state: 'n' }, value: i }], isInitial: i === 0, program: program(box('r', 10), [node('r', null, 1)]) }));
    expect(() => deriveStateProgram('uikit', many)).toThrow(/65 reachable assignments exceed the state table limit of 64/);
    expect(deriveStateProgram('uikit', many.slice(0, MAX_STATE_TABLE_ASSIGNMENTS)).assignments).toHaveLength(64);
  });

  it('keys two free states apart even when their parts concatenate to the same text (Macroscope 4157246873)', () => {
    expect(stateKey('doc/a', 'b#c')).not.toBe(stateKey('doc/a#b', 'c'));
    expect(stateKey('a\\', '#b')).not.toBe(stateKey('a\\#', 'b'));
    expect(stateKey('doc', 'open')).toBe('doc#open');
    const two = (x: boolean, y: boolean): Assignment => [{ state: { instance: 'doc/a', state: 'b#c' }, value: x }, { state: { instance: 'doc/a#b', state: 'c' }, value: y }];
    const r = (w: number) => program(box('r', w), [node('r', null, w)]);
    const p = deriveStateProgram('uikit', [{ assignment: two(false, false), isInitial: true, program: r(1) }, { assignment: two(true, false), isInitial: false, program: r(2) }, { assignment: two(false, true), isInitial: false, program: r(3) }]);
    expect(p.states.map((x) => x.key)).toEqual(['doc/a#b\\#c', 'doc/a\\#b#c']);
    const rt = new StateRuntime(p);
    rt.set('doc/a\\#b#c', true);
    expect(rt.program()).toEqual(r(3));
  });

  it('plants stateDeltaDropped: the last changed node record of a delta is lost', () => {
    const planted = deriveStateProgram('uikit', CASES, { ...NO_FAULTS, stateDeltaDropped: true });
    expect(programAt(planted, 1)).not.toEqual(CASES[1]?.program);
    expect(() => applyDelta(planted, planted.deltas[3] as StateProgram['deltas'][number])).toThrow(/orders b/);
  });
});

describe('StateRuntime', () => {
  const sp = deriveStateProgram('uikit', CASES);

  it('lands on the per-case program after every setter, and A to B to A equals A', () => {
    const rt = new StateRuntime(sp);
    expect(rt.program()).toEqual(CASES[0]?.program);
    rt.set('doc#open', true);
    expect(rt.program()).toEqual(CASES[1]?.program);
    rt.set('doc#side', 'end');
    expect(rt.program()).toEqual(CASES[3]?.program);
    rt.set('doc#open', false);
    expect(rt.program()).toEqual(CASES[2]?.program);
    rt.set('doc#side', 'start');
    expect(rt.program()).toEqual(CASES[0]?.program);
  });

  it('validates before any change', () => {
    const rt = new StateRuntime(sp);
    expect(() => rt.set('doc#closed', true)).toThrow(StateValueError);
    expect(() => rt.set('doc#open', 'yes')).toThrow(/not in the domain/);
    expect(() => rt.set('doc#open', 1)).toThrow(/not in the domain/);
    expect(rt.assignment).toBe(0);
    const partial = deriveStateProgram('uikit', CASES.slice(0, 3));
    const p = new StateRuntime(partial);
    p.set('doc#open', true);
    expect(() => p.set('doc#side', 'end')).toThrow(/unreachable/);
    expect(p.assignment).toBe(1);
  });

  it('calls onChange once after each committed setter and never after a refused one (Macroscope 4157246848)', () => {
    const rt = new StateRuntime(sp);
    const seen: number[] = [];
    rt.onChange = () => seen.push(rt.assignment);
    rt.set('doc#open', true);
    expect(() => rt.set('doc#open', 'yes')).toThrow(StateValueError);
    rt.set('doc#side', 'end');
    expect(seen).toEqual([1, 3]);
  });

  it('plants setterSkipsRelayout: the engine input stays the one first laid out', () => {
    const rt = new StateRuntime(sp, { ...NO_FAULTS, setterSkipsRelayout: true });
    rt.set('doc#side', 'end');
    expect(rt.program().nodes).toEqual(CASES[2]?.program.nodes);
    expect(rt.program().root).toEqual(CASES[0]?.program.root);
  });
});

describe('the generated runtime', () => {
  const sp = deriveStateProgram('uikit', CASES);
  const emit: StateEmit = { id: 'demo', fixture: 'demo', direction: 'ltr', compilerDigest: 'sha256:0', viewport: { width: 400, height: 300 }, program: sp, scripts: [{ id: 'demo~script3', steps: [{ kind: 'set', state: 'doc#open', value: true }, { kind: 'set', state: 'doc#side', value: 'end' }, { kind: 'advance', ms: 16 }, { kind: 'dump' }], expectedDigests: [{ dpr: 2, sha256: 'x' }] }] };

  it('names a boolean setter per boolean state and an enum per other state', () => {
    expect(typedSetters(sp)).toEqual([{ name: 'set_doc_open', boolean: true, cases: ['v_false', 'v_true'] }, { name: 'set_doc_side', boolean: false, cases: ['v_start', 'v_end'] }]);
  });

  it('gives a state a Bool setter only when both true and false are reachable', () => {
    const one = deriveStateProgram('uikit', [{ ...(CASES[0] as StateCase), assignment: [{ state: { instance: 'doc', state: 'on' }, value: true }] }]);
    expect(typedSetters(one)).toEqual([{ name: 'set_doc_on', boolean: false, cases: ['v_true'] }]);
    const swift = emitStatePrograms('uikit', [{ ...emit, program: one, scripts: [] }]).map((f) => f.text).join('\n');
    expect(swift).toContain('public enum DragonStates0_doc_on: Int { case v_true = 0 }');
    expect(swift).not.toContain('v ? 0 : -1');
  });

  it('refuses a node write it has no state-node form for and a text node without its run; keeps keys inside their doc comments', () => {
    const odd = { ...(CASES[0] as StateCase), program: program(box('r', 10), [{ ...node('r', null, 1), writes: [{ kind: 'shadow' } as unknown as ProgramNode['writes'][number]] }]) };
    expect(() => emitStatePrograms('uikit', [{ ...emit, program: deriveStateProgram('uikit', [odd]), scripts: [] }])).toThrow(/r: no state-node write for \{"kind":"shadow"\}/);
    const bare = { ...(CASES[0] as StateCase), program: program(box('r', 10), [{ ...node('r', null, 1), kind: 'text', writes: [] }]) };
    expect(() => emitStatePrograms('uikit', [{ ...emit, program: deriveStateProgram('uikit', [bare]), scripts: [] }])).toThrow(/r: a text node without a text run/);
    const weird = deriveStateProgram('uikit', [{ ...(CASES[0] as StateCase), assignment: [{ state: { instance: 'a*/b\nc', state: 'on' }, value: 'x' }] }]);
    for (const backend of ['uikit', 'android-views'] as const) {
      const text = emitStatePrograms(backend, [{ ...emit, id: 'demo*/\nx', program: { ...weird, backend }, scripts: [] }]).map((f) => f.text).join('\n');
      // Every comment line holds its whole text and closes only where the emitter closes it; the key stays verbatim in its string literal.
      const comments = text.split('\n').filter((l) => /^\s*(\/\/|\/\*\*)/.test(l));
      expect(comments.filter((l) => l.includes('a* /b c#on'))).toHaveLength(1);
      expect(comments.filter((l) => l.includes('demo* / x'))).toHaveLength(3);
      for (const l of comments) expect(l.replace(/\*\/$/, '')).not.toContain('*/');
      expect(text.split('\n').some((l) => /^x\b/.test(l))).toBe(false);
    }
  });

  it('emits typed setters, the tables, the layout variants and the script case in Swift and Kotlin', () => {
    const swift = emitStatePrograms('uikit', [emit]).map((f) => f.text).join('\n');
    expect(swift).toContain('public func set_doc_open(_ v: Bool) { machine.set(0, v ? 1 : 0) }');
    expect(swift).toContain('public enum DragonStates0_doc_side: Int { case v_start = 0; case v_end = 1 }');
    expect(swift).toContain('private func dragonStates0Input2(_ dpr: Double) -> LayoutInput');
    expect(swift).toContain('steps: [.set(0, 1), .set(1, 1), .advance(16.0), .dump])');
    expect(swift).toContain('skipRelayout: false');
    expect(swift).toContain('public let dragonStateCaseList: [DragonStateScript] = [dragonStates0Script0]');
    const kotlin = emitStatePrograms('android-views', [{ ...emit, program: deriveStateProgram('android-views', CASES.map((c) => ({ ...c, program: { ...c.program, backend: 'android-views', version: 'dragon.android-views-program/1' } }))) }]).map((f) => f.text).join('\n');
    expect(kotlin).toContain('fun set_doc_open(v: Boolean) = machine.set(0, if (v) 1 else 0)');
    expect(kotlin).toContain('enum class DragonStates0_doc_side { v_start, v_end }');
    expect(kotlin).toContain('listOf(DragonScriptStep.Set(0, 1), DragonScriptStep.Set(1, 1), DragonScriptStep.Advance(16.0), DragonScriptStep.Dump)');
    expect(emitStatePrograms('uikit', [emit], { ...NO_FAULTS, setterSkipsRelayout: true }).map((f) => f.text).join('\n')).toContain('skipRelayout: true');
  });

  it('refuses a tap until hit testing lands, a bad step and a duplicate script id', () => {
    expect(() => emitStatePrograms('uikit', [{ ...emit, scripts: [{ ...(emit.scripts[0] as ScriptCase), steps: [{ kind: 'tap', x: 1, y: 1 }] }] }])).toThrow(/device hit runtime/);
    expect(() => emitStatePrograms('uikit', [{ ...emit, scripts: [{ ...(emit.scripts[0] as ScriptCase), steps: [{ kind: 'advance', ms: -1 }] }] }])).toThrow(/finite, non-negative/);
    expect(() => emitStatePrograms('uikit', [{ ...emit, scripts: [{ ...(emit.scripts[0] as ScriptCase), steps: [{ kind: 'set', state: 'doc#open', value: 'x' }] }] }])).toThrow(/no value "x"/);
    expect(() => emitStatePrograms('uikit', [emit, emit])).toThrow(/share an id/);
  });

  it('the web attribute program writes each assignment\'s classes and validates before any mutation', async () => {
    const tables = [new Map([['r', 'a']]), new Map([['r', 'b']]), new Map([['r', 'a'], ['x', 'c']]), new Map([['r', null]])];
    const w = webStateProgram(sp, tables);
    const source = webStateModule(w);
    const mod = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)) as { createDragonStates: (f: (a: string) => unknown) => { set: (s: string, v: unknown) => void; readonly assignment: number } };
    const attrs = new Map<string, string | null>();
    const writes: string[] = [];
    const el = (address: string) => ({ setAttribute: (_: string, v: string) => { attrs.set(address, v); writes.push(address); }, removeAttribute: () => { attrs.set(address, null); writes.push(address); } });
    const states = mod.createDragonStates(el);
    expect(Object.fromEntries(attrs)).toEqual({ r: 'a', x: null });
    writes.length = 0;
    states.set('doc#side', 'end');
    expect(Object.fromEntries(attrs)).toEqual({ r: 'a', x: 'c' });
    expect(writes).toEqual(['x']);
    states.set('doc#open', true);
    expect(Object.fromEntries(attrs)).toEqual({ r: null, x: null });
    expect(() => states.set('doc#open', 'yes')).toThrow(/not in the domain/);
    expect(() => states.set('doc#nope', true)).toThrow(/no state/);
    expect(states.assignment).toBe(3);
    expect(() => webStateProgram(sp, tables.slice(1))).toThrow(/3 class tables for 4 assignments/);
    // A missing element fails before any attribute is written: r sorts before x, so a write-as-you-go apply would change r first.
    let missing = 'x';
    const lookup = (address: string) => (address === missing ? null : el(address));
    attrs.clear();
    writes.length = 0;
    expect(() => mod.createDragonStates(lookup)).toThrow(/no element x/);
    expect(writes).toEqual([]);
    missing = '';
    const again = mod.createDragonStates(lookup);
    again.set('doc#side', 'end');
    expect(again.assignment).toBe(2);
    missing = 'x';
    writes.length = 0;
    expect(() => again.set('doc#open', true)).toThrow(/no element x/);
    expect(writes).toEqual([]);
    expect(Object.fromEntries(attrs)).toEqual({ r: 'a', x: 'c' });
    expect(again.assignment).toBe(2);
  });
});

describe('the generated state mount (Macroscope 4157246848)', () => {
  // The views on screen follow the setters: the machine reports every committed set, and a DragonStateMount rebuilds the views from
  // the live records, lays them out with the input the machine last laid out and swaps them in. The case scripts run on a mount.
  const support = (backend: 'uikit' | 'android-views'): string => emitNativeSupport(backend, null).map((f) => f.text).join('\n');

  it('Swift: set ends by calling onChange; the mount re-renders from it; a script runs only on a mount', () => {
    const t = support('uikit');
    expect(t).toMatch(/current = to\n {4}onChange\?\(\)\n {2}\}/);
    expect(t).toContain('machine.onChange = { [weak self] in self?.render() }');
    expect(t).toMatch(/let t = DragonTree\(\)\n {4}machine\.build\(t\)\n {4}stage\.addSubview\(t\.root\)\n {4}do \{\n {6}try t\.apply\(machine\.input\(scale\)/);
    expect(t).toMatch(/tree\.root\.removeFromSuperview\(\)\n {4}tree = t\n {4}renders \+= 1/);
    expect(t).toContain('case .set(let a, let b): m.set(a, b)');
    expect(t).toContain('runs on a state mount, not as a layout case');
  });

  it('Kotlin: set ends by calling onChange; the mount re-renders from it; a script runs only on a mount', () => {
    const t = support('android-views');
    expect(t).toMatch(/current = to\n {4}onChange\?\.invoke\(\)\n {2}\}/);
    expect(t).toContain('machine.onChange = { render() }');
    expect(t).toMatch(/val t = DragonTree\(stage\.context\)\n {4}machine\.build\(t\)\n {4}t\.apply\(machine\.input\(scale\), measurer, scale, bridge\)\n {4}stage\.addView\(t\.root/);
    expect(t).toMatch(/stage\.removeView\(tree\.root\)\n {4}tree = t\n {4}renders\+\+/);
    expect(t).toContain('is DragonScriptStep.Set -> m.set(s.s, s.v)');
    expect(t).toContain('runs on a state mount, not as a layout case');
  });
});

describe('VirtualClock', () => {
  it('moves only by finite, non-negative steps', () => {
    const c = new VirtualClock();
    c.advance(16.5);
    c.advance(0);
    expect(c.now).toBe(16.5);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => c.advance(bad)).toThrow(ClockError);
    expect(c.now).toBe(16.5);
  });
});
