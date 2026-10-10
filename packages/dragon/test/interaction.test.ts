// SELD-R2 (notes/T064-seld-r2-spec.md R3, R4, R5, R7, R13): :hover, :active, :focus and :focus-visible as interaction states.
// - Completeness: every state a pointer, a press or focus can reach (every hover chain × every active chain × every focus value)
//   and every element forced alone into each pseudo-class resolves, directly, exactly as the partition state it maps to; the
//   plants interactionRuleDropped and comboStateDropped are caught.
// - Collapse and cap: states that resolve alike are stored once (R5); more than 256 reachable states are refused (R7).
// - Web: the generated conditions are mutually exclusive under each media gate, name only dg classes, and every :hover
//   condition holds only under (hover: hover) (R3; the plant webHoverUngated is caught).
// - Hit model: on native, an interaction rule in a case with an unmodelled paint fact is refused (R13; hitUnmodelledNotRefused).
// - Identity: a document without interaction rules, or with one that matches nothing, compiles as it did.
import { describe, expect, it } from 'vitest';
import type { CompilerFaults, Diagnostic, FrontEndResult, InteractionPartition, InteractionState } from '../src/internal.ts';
import { interactionPartition, isFocusable } from '../src/analysis/interaction.ts';
import type { LinkedElement } from '../src/analysis/link.ts';
import { comboIndex, conditionsExclusive, createProjectWith, gatedConditions, HIT_MODELLED, hitUnmodelledFact, interactionCondition, laneOnlyNative, LONGHANDS, NO_FAULTS, stateMembers } from '../src/internal.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { resolveTree, valueToString } from '../src/analysis/resolve.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { internalRecord } from '../src/project.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { DOC, div, eq, inputFor, text } from './helpers.ts';

const CSS = [
  'body { font-family: Ahem; font-size: 10px; }',
  '.a { width: 100px; height: 20px; background-color: #ccc; } .a:hover { background-color: #0c0; } .a:active { width: 90px; }',
  '.b { width: 50px; height: 10px; } .a:hover + .b { margin-left: 10px; } .a:active .z { height: 1px; }',
  '.card { width: 120px; padding: 4px; } .card:hover .title { width: 60px; } .title { width: 30px; height: 10px; }',
  '.title:hover:focus { height: 30px; } .song:hover { background-color: #555; } .song.selected { background-color: #090; }',
  '.f:focus { width: 80px; } .f:focus-visible { height: 7px; } .g:focus-visible { background-color: #c00; } .x:hover .y:hover { height: 5px; }',
  ':not(.n:hover) > .m { height: 3px; } .open:hover { width: 7px; } .card:hover .f:focus { margin-top: 2px; }',
].join('\n');

const tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [
  div(r, 'a', ['a'], [div(r, 'z', ['z'])]),
  div(r, 'b', ['b']),
  div(r, 'card', ['card'], [div(r, 'title', ['title']), text(r, 't', 'XX'), div(r, 'f', ['f'])]),
  div(r, 's1', ['song']),
  div(r, 's2', ['song', 'selected']),
  div(r, 'g', ['g']),
  div(r, 'x', ['x'], [div(r, 'y', ['y'])]),
  div(r, 'n', ['n'], [div(r, 'm', ['m'])]),
];

type Component = NonNullable<FrontEndResult['tree']>['components'][number];

/** inputFor's document with its one component given the states built from it. */
function withStates(base: FrontEndResult, states: (c0: Component) => Component['states']): FrontEndResult {
  const c0 = base.tree?.components[0];
  if (base.tree === null || c0 === undefined) throw new Error('inputFor gives a tree with one component');
  return { ...base, tree: { ...base.tree, components: [{ ...c0, states: states(c0) }] } };
}

/** The document above with one free state: o carries class open only when open is true. */
function input(css = CSS, body = tree): FrontEndResult {
  const base = inputFor(css, (r) => {
    const origin = { kind: 'authored' as const, span: { source: r, start: 0, end: 0 } };
    const o = { ...div(r, 'o', []), classes: [{ value: [{ when: eq('open', true), value: { owner: DOC, sheet: 's', name: 'open' } }, { when: { kind: 'not' as const, value: eq('open', true) }, value: { owner: DOC, sheet: 's', name: 'shut' } }], origin }] };
    return [...body(r), o];
  });
  return withStates(base, (c0) => [{ id: 'open', domain: [false, true], initial: false, origin: c0.origin }]);
}

const TARGETS = { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } };
/** lanes: compile as the parity lanes do (interactionLanes), which keep the interaction states on native; the default here. */
const compile = (faults: Partial<CompilerFaults> = {}, css = CSS, body = tree, targets: { readonly web: object } = TARGETS, profiles: 'enforce' | 'derive' = 'enforce', lanes = true) =>
  createProjectWith({ projectId: 'test', targets }, { faults: { ...NO_FAULTS, ...faults }, profiles, direction: 'ltr', ...(lanes ? { interactionLanes: true } : {}) }).compile(input(css, body));

/** The body font every small document below sets, so the native targets have a layout font. */
const BODY = 'body { font-family: Ahem; font-size: 10px; } ';
const errors = (ds: readonly Diagnostic[]) => ds.filter((d) => d.severity === 'error').map((d) => `${d.code}${d.target === null ? '' : ` [${d.target}]`} ${d.message}`);
const otherErrors = errors;

/**
 * A linked case tree with tabindex on the given elements: every focusable tag and tabindex are refused until FORM-a and SELD-R2's
 * focusability package, so the focus dimension is exercised on the linked tree directly. No selector here tests tabindex.
 */
function withFocusable(root: LinkedElement, focusable: readonly string[]): LinkedElement {
  const children = root.children.map((c) => (c.kind === 'element' ? withFocusable(c, focusable) : c));
  return { ...root, children, attributes: focusable.includes(root.address) ? new Map([...root.attributes, ['tabindex', '0']]) : root.attributes };
}

const ENV = { direction: 'ltr' as const, rootFont: 'ua-default' as const, ua: referenceDataset() };

/** The rules and linked case trees of the document, f focusable, with each case's partition built as project.ts builds it. */
function partitions(faults: Partial<CompilerFaults> = {}, css = CSS, focusable: readonly string[] = ['f'], body = tree) {
  const record = internalRecord(compile({}, css, body));
  if (record === undefined || record.linked === null) throw new Error('no record');
  const src = input(css, body).snapshot.sources[0];
  if (src === undefined) throw new Error('no source');
  const rules = parseStylesheet(css, { source: src.ref, start: 0, end: css.length }, { id: 's', owner: DOC, scope: 'document' }, 0, []);
  return record.linked.cases.map((lc) => {
    const root = withFocusable(lc.root, focusable);
    const built = interactionPartition(root, (ix) => resolveTree(root, rules, { ...NO_FAULTS, ...faults }, ENV, ix), { ...NO_FAULTS, ...faults });
    return { key: lc.key, root, rules, base: resolveTree(root, rules, NO_FAULTS, ENV), ...built };
  });
}

function serialize(root: ResolvedElement): string {
  const out: string[] = [];
  const walk = (el: ResolvedElement): void => {
    out.push(`${el.element.address} ${LONGHANDS.map((p) => valueToString((el.props.get(p) as { value: Parameters<typeof valueToString>[0] }).value)).join(';')}`);
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return out.join('\n');
}

/** Every reachable or forced state that resolves differently from the partition state it maps to. */
function completenessFailures(faults: Partial<CompilerFaults>): string[] {
  const failures: string[] = [];
  const none = new Set<string>();
  for (const c of partitions(faults)) {
    const p = c.partition;
    const mapped = (k: number): string => serialize(k < 0 ? c.base : (c.resolved[k] as ResolvedElement));
    const direct = (ix: InteractionState): string => serialize(resolveTree(c.root, c.rules, NO_FAULTS, ENV, ix));
    const chain = (address: string | null): Set<string> => {
      const out = new Set<string>();
      for (let a = address; a !== null;) {
        out.add(a);
        a = (p.elements.find((x) => x.address === a) as { parent: string | null }).parent;
      }
      return out;
    };
    // The focus a real pointer or keyboard gives: none, each element's tap target, and keyboard focus (with focus-visible).
    const focusable = p.elements.filter((e) => e.focusable).map((e) => e.address);
    const focusStates: [string, Set<string>, Set<string>, number][] = [['none', none, none, 0]];
    p.elements.forEach((e, j) => {
      const target = [...chain(e.address)].find((x) => focusable.includes(x)) ?? null;
      focusStates.push([`tap(${e.address})`, target === null ? none : new Set([target]), none, p.pointerFocusOf[j] as number]);
      if (e.focusable) focusStates.push([`key(${e.address})`, new Set([e.address]), new Set([e.address]), p.keyboardFocusOf[j] as number]);
    });
    const pointers: [string, number][] = [['none', -1], ...p.elements.map((e, j) => [e.address, j] as [string, number])];
    for (const [hn, hj] of pointers) {
      for (const [an, aj] of pointers) {
        for (const [fn, focus, visible, fk] of focusStates) {
          const h = hj < 0 ? 0 : (p.chainOf[hj] as number);
          const a = aj < 0 ? 0 : (p.activeChainOf[aj] as number);
          const ix = { hover: hj < 0 ? none : chain(hn), active: aj < 0 ? none : chain(an), focus, focusVisible: visible };
          if (direct(ix) !== mapped(p.combos[comboIndex(p, h, a, fk)] as number)) failures.push(`${c.key} hover(${hn}) active(${an}) ${fn}`);
        }
      }
    }
    p.elements.forEach((e, j) => {
      const one = new Set([e.address]);
      const forced: [string, InteractionState, readonly number[]][] = [
        ['hover', { hover: one, active: none, focus: none, focusVisible: none }, p.forcedHoverOf],
        ['active', { hover: none, active: one, focus: none, focusVisible: none }, p.forcedActiveOf],
        ['focus', { hover: none, active: none, focus: one, focusVisible: none }, p.forcedFocusOf],
        ['focus-visible', { hover: none, active: none, focus: none, focusVisible: one }, p.forcedFocusVisibleOf],
      ];
      for (const [name, ix, table] of forced) if (direct(ix) !== mapped(table[j] as number)) failures.push(`${c.key} forced ${name}(${e.address})`);
    });
  }
  return failures;
}

describe('interaction states: compile', () => {
  it('compiles every interaction rule on every target, with case keys and counts unchanged', () => {
    const c = compile();
    expect(otherErrors(c.diagnostics)).toEqual([]);
    const record = internalRecord(c);
    expect(record?.cases.map((x) => x.key)).toEqual(record?.linked?.cases.map((x) => x.key));
    expect(record?.cases.length).toBe(2);
    expect(record?.cases[0]?.partition?.candidates).toEqual({ hover: ['a', 'card', 'title', 's1', 's2', 'x', 'y', 'n'], active: ['a'], focus: ['title', 'f'], focusVisible: ['f', 'g'] });
    // Nothing is focusable in the compiled document (every focusable tag and tabindex are refused today): focus is none only.
    expect(record?.cases[0]?.partition?.dimensions.focus.length).toBe(1);
    const p = (partitions()[0] as { partition: InteractionPartition }).partition;
    // R4: hover values are the distinct chains, none first; the active dimension is none and a's chain; focus is none, a tap on
    // f (focus without focus-visible) and keyboard focus on f (with it).
    expect(p.dimensions.active.map((v) => v.set)).toEqual([[], ['a']]);
    expect(p.dimensions.focus.map((v) => [v.focus, v.focusVisible])).toEqual([[null, null], ['f', null], ['f', 'f']]);
    expect(p.combos.length).toBe(p.dimensions.hover.length * 2 * 3);
    // .x:hover .y:hover tests x only once y is hovered: the candidates grow to a fixed point.
    expect(p.dimensions.hover.map((v) => v.set)).toContainEqual(['x', 'y']);
    // A forced hover on y alone matches nothing (.x:hover .y:hover needs x): it is the none state. g's focus-visible is
    // reachable only forced (g is not focusable), so it is a forced state of its own.
    expect(p.forcedHoverOf[p.elements.findIndex((e) => e.address === 'y')]).toBe(-1);
    // f's alone (without :focus) differs from keyboard focus on f, which sets both.
    expect(p.states.filter((s) => s.kind === 'forced-focus-visible').map((s) => s.focusVisible)).toEqual(['f', 'g']);
    expect(record?.cases[1]?.partition?.candidates.hover).toContain('o');
    expect(record?.cases[0]?.partition?.candidates.hover).not.toContain('o');
  });

  it('resolves every reachable and forced state as the partition state it maps to (completeness)', () => {
    expect(completenessFailures({})).toEqual([]);
  });

  it('catches the plants interactionRuleDropped and comboStateDropped', () => {
    expect(completenessFailures({ interactionRuleDropped: true }).length).toBeGreaterThan(0);
    const combo = completenessFailures({ comboStateDropped: true });
    expect(combo.length).toBeGreaterThan(0);
    // Only combinations of two or more dimensions resolve wrongly under the plant.
    expect(combo.every((f) => !/hover\(none\) active\(none\)/.test(f))).toBe(true);
  });

  it('forces what a real pointer and focus give for a reachable state, and one element for a forced state', () => {
    const p = (partitions()[0] as { partition: InteractionPartition }).partition;
    const card = p.states.find((s) => s.kind === 'reachable' && s.hover.join() === 'card' && s.active.length === 0 && s.focus === null);
    expect(card?.force).toEqual(['html', 'body', 'card'].map((address) => ({ address, pseudo: 'hover' })));
    const pressed = p.states.find((s) => s.kind === 'reachable' && s.hover.length === 0 && s.active.join() === 'a' && s.focus === 'f');
    expect(pressed?.force).toEqual([...['html', 'body', 'a'].map((address) => ({ address, pseudo: 'active' })), { address: 'f', pseudo: 'focus' }]);
    const g = p.states.find((s) => s.kind === 'forced-focus-visible' && s.focusVisible === 'g');
    expect(g?.force).toEqual([{ address: 'g', pseudo: 'focus-visible' }]);
  });

  it('checks every state as it checks the case: a refusal only a hover state reaches is reported', () => {
    expect(otherErrors(compile({}, `${CSS}\nhtml { width: 300px; }`).diagnostics)).toEqual([]);
    const bad = compile({}, `${CSS}\nhtml:active { position: absolute; }`);
    expect(errors(bad.diagnostics).some((m) => m.includes('position: absolute on the root element html'))).toBe(true);
  });

  it('refuses direction in an interaction rule; :active compiles and :focus-within stays refused', () => {
    expect(errors(compile({}, `${BODY}.a:hover { direction: rtl; }`).diagnostics)).toEqual(['DRAGON_UNSUPPORTED_SELECTOR direction in a rule that tests :hover, :active, :focus or :focus-visible is not supported: direction is resolved before the interaction states']);
    expect(errors(compile({}, `${BODY}.a:active { width: 1px; }`).diagnostics)).toEqual([]);
    expect(errors(compile({}, `${BODY}.a:focus-within { width: 1px; }`).diagnostics)[0]).toMatch(/^DRAGON_UNSUPPORTED_SELECTOR :focus-within depends on user interaction/);
  });
});

describe('interaction states: what no target can carry yet', () => {
  it('refuses every interaction rule on native outside the lanes, naming the runtime PRs, and compiles it on web', () => {
    const css = `${BODY}.a:active { background-color: #0c0; } .card:hover .title { width: 60px; }`;
    const c = compile({}, css, tree, TARGETS, 'enforce', false);
    expect(errors(c.diagnostics)).toEqual([
      'DRAGON_UNSUPPORTED_SELECTOR [ios] :active is not supported on ios yet: the native interaction runtime arrives with SELD-R2 PR 3 and PR 4',
      'DRAGON_UNSUPPORTED_SELECTOR [ios] :hover is not supported on ios yet: the native interaction runtime arrives with SELD-R2 PR 3 and PR 4',
      'DRAGON_UNSUPPORTED_SELECTOR [android] :active is not supported on android yet: the native interaction runtime arrives with SELD-R2 PR 3 and PR 4',
      'DRAGON_UNSUPPORTED_SELECTOR [android] :hover is not supported on android yet: the native interaction runtime arrives with SELD-R2 PR 3 and PR 4',
    ]);
    const states = c.targets as Record<string, string>;
    expect([states.ios, states.android]).toEqual(['blocked', 'blocked']);
    expect(c.outputs.web.kind).toBe('ready');
    expect(errors(compile({}, css, tree, { web: {} }, 'enforce', false).diagnostics)).toEqual([]);
    // The lanes compile the states on native; a document without interaction rules is not refused anywhere.
    expect(errors(compile({}, css).diagnostics)).toEqual([]);
    expect(errors(compile({}, `${BODY}.a { width: 1px; }`, tree, TARGETS, 'enforce', false).diagnostics)).toEqual([]);
    // A lanes compile records the targets a user's compile refuses, so its cases prove no native profile row (profile-rows.ts).
    expect(laneOnlyNative(compile({}, css), 'ios')).toBe(true);
    expect(laneOnlyNative(compile({}, css), 'android')).toBe(true);
    expect(laneOnlyNative(compile({}, `${BODY}.a { width: 1px; }`), 'ios')).toBe(false);
    expect(laneOnlyNative(compile({}, css, tree, { web: {}, ios: { minimum: '15.0' } } as { readonly web: object }), 'android')).toBe(false);
  });

  it('refuses transition and animation declarations in an interaction rule on every target, as before SELD-R2', () => {
    const refused = (property: string): string => `DRAGON_UNSUPPORTED_SELECTOR ${property} in a rule that tests :hover, :active, :focus or :focus-visible is not supported: transitions and animations are resolved without the interaction states (a later SELD-R2 package)`;
    const keyframes = '@keyframes k { from { width: 10px; } to { width: 20px; } } ';
    expect(errors(compile({}, `${BODY}.a:hover { width: 60px; transition: width 1s linear; }`, tree, { web: {} }).diagnostics)).toEqual([refused('transition')]);
    expect(errors(compile({}, `${BODY}${keyframes}.a { animation: k 1s; } .a:hover { animation-play-state: paused; }`, tree, { web: {} }).diagnostics)).toEqual([refused('animation-play-state')]);
    expect(errors(compile({}, `${BODY}${keyframes}:is(.a:focus) { animation: k 1s; }`, tree, { web: {} }).diagnostics)).toEqual([refused('animation')]);
    expect(errors(compile({}, `${BODY}.a:active { transition-duration: 1s; }`, tree, { web: {} }).diagnostics)).toEqual([refused('transition-duration')]);
    // A transition set outside the interaction rule compiles: the browser runs it when a state rule changes the property.
    expect(errors(compile({}, `${BODY}.a { transition: width 1s linear; } .a:hover { width: 60px; }`, tree, { web: {} }).diagnostics)).toEqual([]);
  });
});

describe('interaction states: collapse and cap (R5, R7)', () => {
  const flat = (n: number) => (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => Array.from({ length: n }, (_, i) => div(r, `e${i}`, ['e']));

  it('stores states that resolve alike once, and keeps every combination they stand for', () => {
    // Hovering p or p2 gives q the same style: one state, two hover values. A :focus that changes nothing collapses to none.
    const css = '.q { width: 10px; } .p:hover .q, .p2:hover .q { width: 20px; } .z { width: 60px; } .z:focus { width: 60px; }';
    const body = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'p', ['p'], [div(r, 'q1', ['q'])]), div(r, 'p2', ['p2'], [div(r, 'q2', ['q'])]), div(r, 'z', ['z'])];
    const p = (partitions({}, css, ['z'], body)[0] as { partition: InteractionPartition }).partition;
    expect(p.dimensions.hover.length).toBe(3);
    expect(p.dimensions.focus.map((v) => v.focus)).toEqual([null, 'z']);
    // q1 and q2 differ, so p and p2 are two states; every focus value of each collapses into it (6 combinations, 2 states).
    expect(p.states.filter((s) => s.kind === 'reachable').length).toBe(2);
    expect(p.combos).toEqual([-1, -1, 0, 0, 1, 1]);
    expect(stateMembers(p).map((m) => m.length)).toEqual([2, 2]);
    const same = '.q { width: 10px; } .p:hover .q1, .p2:hover .q1 { width: 20px; }';
    const one = internalRecord(compile({}, same, (r) => [div(r, 'p', ['p'], [div(r, 'q1', ['q1'])]), div(r, 'p2', ['p2'])]))?.cases[0]?.partition as InteractionPartition;
    expect(one.states.map((s) => s.kind)).toEqual(['reachable']);
    expect(stateMembers(one)[0]?.map((m) => m.hover)).toEqual([['p']]);
  });

  it('refuses more than 256 reachable states in one app assignment, and compiles 255', () => {
    const css = (n: number) => BODY + Array.from({ length: n }, (_, i) => `.e:nth-child(${i + 1}):hover { width: ${i + 1}px; } .e:nth-child(${i + 1}):active { height: ${i + 1}px; }`).join('\n');
    // n siblings, each with its own hover and active style: (n + 1)^2 - 1 combinations, all distinct.
    expect(otherErrors(compile({}, css(15), flat(15), { web: {} }).diagnostics)).toEqual([]);
    expect(internalRecord(compile({}, css(15), flat(15), { web: {} }))?.cases[0]?.interaction.filter((i) => i.value.kind === 'reachable').length).toBe(255);
    const over = compile({}, css(16), flat(16), { web: {} });
    expect(otherErrors(over.diagnostics)).toEqual(['DRAGON_UNSUPPORTED_SELECTOR more than 256 interaction states in the case open=false; at most 256 are compiled (package SELD-R2s)', 'DRAGON_UNSUPPORTED_SELECTOR more than 256 interaction states in the case open=true; at most 256 are compiled (package SELD-R2s)']);
    expect(over.outputs.web.kind).toBe('blocked');
  });

  it('refuses more than 4096 combinations without resolving them', () => {
    // 65 siblings with their own hover and active styles: 66 × 66 = 4356 combinations.
    const css = (n: number) => BODY + Array.from({ length: n }, (_, i) => `.e:nth-child(${i + 1}):hover { width: ${i + 2}px; } .e:nth-child(${i + 1}):active { height: ${i + 2}px; }`).join('\n');
    const started = Date.now();
    expect(otherErrors(compile({}, css(65), flat(65), { web: {} }).diagnostics)[0]).toBe('DRAGON_UNSUPPORTED_SELECTOR 4356 interaction combinations, above the 4096 Dragon resolves, in the case open=false; at most 256 are compiled (package SELD-R2s)');
    expect(Date.now() - started).toBeLessThan(20_000);
  });
});

describe('interaction states: hit model (R13)', () => {
  const css = BODY + '.h { width: 10px; height: 10px; transform: translateX(5px); } .k:hover { background-color: #0c0; }';
  const body = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'h', ['h']), div(r, 'k', ['k'])];

  // Since PNT2 (#74) the enforced profiles compile translateX() too, so R13 refuses in both modes (spec §10: the owned rise that
  // SELD-R2b clears).
  it('refuses an interaction rule on native in a case with an unmodelled paint fact, and not on web', () => {
    expect(otherErrors(compile({}, css, body, TARGETS, 'derive').diagnostics)).toEqual([
      'DRAGON_UNSUPPORTED_SELECTOR [ios] :hover needs Dragon hit testing through transform on h, which is not built yet (package SELD-R2b)',
      'DRAGON_UNSUPPORTED_SELECTOR [android] :hover needs Dragon hit testing through transform on h, which is not built yet (package SELD-R2b)',
    ]);
    const web = compile({}, css, body, { web: {} }, 'derive');
    expect(otherErrors(web.diagnostics)).toEqual([]);
    expect(errors(compile({}, css, body).diagnostics).filter((m) => m.startsWith('DRAGON_UNSUPPORTED_SELECTOR'))).toEqual([
      'DRAGON_UNSUPPORTED_SELECTOR [ios] :hover needs Dragon hit testing through transform on h, which is not built yet (package SELD-R2b)',
      'DRAGON_UNSUPPORTED_SELECTOR [android] :hover needs Dragon hit testing through transform on h, which is not built yet (package SELD-R2b)',
    ]);
    expect(otherErrors(compile({}, css.replace('transform: translateX(5px);', ''), body, TARGETS, 'derive').diagnostics)).toEqual([]);
  });

  it('counts an overflow value computed from a refused partner as refused, and leaves R13 to the lanes', () => {
    // overflow-x: clip beside visible is refused (OVFL-c); its refusal stands alone, with no hit-model refusal beside it.
    const clip = `${BODY}.h { overflow-x: clip; } .k:hover { background-color: #0c0; }`;
    const found = errors(compile({}, clip, body).diagnostics);
    expect(found.some((m) => m.includes('OVFL-c'))).toBe(true);
    expect(found.filter((m) => m.includes('needs Dragon hit testing'))).toEqual([]);
    // OVFL: rt-hit clips hidden and clip at the padding box, and html's propagated overflow-x: hidden leaves html and body
    // visible, so those are modelled facts. auto and scroll (overflow-x: hidden alone computes overflow-y: auto) are native scroll
    // views the user scrolls (OVFL-B), whose offsets the hit test does not read yet: unmodelled, so R13 refuses the hover on native.
    for (const extra of ['html { overflow-x: hidden; }', '.h { overflow: clip; }', '.h { overflow: hidden; }']) {
      expect(errors(compile({}, `${BODY}${extra} .k:hover { background-color: #0c0; }`, body).diagnostics), extra).toEqual([]);
    }
    for (const extra of ['.h { overflow: auto; }', '.h { overflow: scroll; }', '.h { overflow-x: hidden; }']) {
      const found = errors(compile({}, `${BODY}${extra} .k:hover { background-color: #0c0; }`, body).diagnostics);
      expect(found.filter((m) => m.includes('needs Dragon hit testing')).length, extra).toBe(2);
      expect(found.every((m) => m.includes('needs Dragon hit testing')), extra).toBe(true);
    }
    // Outside the lanes the interaction rules are refused on native already, so R13 adds nothing.
    expect(otherErrors(compile({}, css, body, TARGETS, 'derive', false).diagnostics)).toEqual([
      'DRAGON_UNSUPPORTED_SELECTOR [ios] :hover is not supported on ios yet: the native interaction runtime arrives with SELD-R2 PR 3 and PR 4',
      'DRAGON_UNSUPPORTED_SELECTOR [android] :hover is not supported on android yet: the native interaction runtime arrives with SELD-R2 PR 3 and PR 4',
    ]);
  });

  it('catches the plant hitUnmodelledNotRefused', () => {
    expect(otherErrors(compile({ hitUnmodelledNotRefused: true }, css, body, TARGETS, 'derive').diagnostics)).toEqual([]);
  });

  it('is fail closed: every paint longhand but the listed ones is unmodelled at any value but its initial one', () => {
    const record = internalRecord(compile({}, css, body, TARGETS, 'derive'));
    const root = record?.cases[0]?.resolved as ResolvedElement;
    expect(hitUnmodelledFact(root, referenceDataset())).toEqual({ property: 'transform', address: 'h' });
    expect([...HIT_MODELLED.keys()]).not.toContain('transform');
    const plain = internalRecord(compile({}, css.replace('transform: translateX(5px);', 'overflow: hidden; transform-origin: 0 0;'), body, TARGETS, 'derive'))?.cases[0]?.resolved as ResolvedElement;
    expect(hitUnmodelledFact(plain, referenceDataset())).toBeNull();
  });
});

describe('interaction states: focusability (R9)', () => {
  const el = (tag: string, attributes: Record<string, string> = {}): LinkedElement => ({ tag, attributes: new Map(Object.entries(attributes)) }) as unknown as LinkedElement;
  it('follows HTML: a valid tabindex, a with href, and form controls but input type=hidden', () => {
    expect(isFocusable(el('div', { tabindex: '0' }))).toBe(true);
    expect(isFocusable(el('div', { tabindex: ' -1' }))).toBe(true);
    expect(isFocusable(el('div', { tabindex: '+2' }))).toBe(true);
    expect(isFocusable(el('div', { tabindex: 'x' }))).toBe(false);
    expect(isFocusable(el('div', { tabindex: '' }))).toBe(false);
    expect(isFocusable(el('div', { tabindex: '-' }))).toBe(false);
    expect(isFocusable(el('div'))).toBe(false);
    expect(isFocusable(el('a'))).toBe(false);
    expect(isFocusable(el('a', { href: '' }))).toBe(true);
    expect(isFocusable(el('input'))).toBe(true);
    expect(isFocusable(el('input', { type: 'HIDDEN' }))).toBe(false);
    expect(isFocusable(el('input', { type: 'hidden', tabindex: '0' }))).toBe(false);
    expect(isFocusable(el('button'))).toBe(true);
  });
});

describe('interaction states: web conditions', () => {
  const web = (css = CSS, faults: Partial<CompilerFaults> = {}): string => {
    const out = compile(faults, css, tree, { web: {} }).outputs.web;
    if (out.kind !== 'ready') throw new Error('web not ready');
    return (out.files[0] as { text: string }).text;
  };

  it('are mutually exclusive within every partition, under each media gate', () => {
    const record = internalRecord(compile());
    for (const c of record?.cases ?? []) {
      const p = c.partition as InteractionPartition;
      const none = { hover: [], active: [], focus: null, focusVisible: null };
      const conds = [[none], ...stateMembers(p)].map((ms, k) => ms.flatMap((m) => gatedConditions(interactionCondition(m, p.candidates), true).map((g) => ({ k, ...g }))));
      const all = conds.flat();
      all.forEach((a, i) => all.forEach((b, j) => {
        if (i < j && a.k !== b.k && a.media === b.media) expect(conditionsExclusive(a.condition, b.condition), `${c.key} ${a.k} ${b.k} ${a.media}`).toBe(true);
      }));
    }
  });

  it('name only dg classes and the pseudo-classes: no author selector is copied', () => {
    const css = web();
    const selectors = css.split('\n').filter((l) => l.startsWith(':root'));
    expect(selectors.length).toBeGreaterThan(0);
    const test = String.raw`(?::(?:hover|active|focus|focus-visible)|:has\((?:\.dg\d+|:is\(\.dg\d+(?:, \.dg\d+)*\)):(?:hover|active|focus|focus-visible)\))`;
    const shape = new RegExp(String.raw`^:root(?:${test}|:not\(${test}\))*(?:\.dg\d+| \.dg\d+)(?: \{|,)$`);
    for (const s of selectors) expect(s).toMatch(shape);
    expect(css).not.toMatch(/\.(?:a|card|title|song|selected|open)\b/);
  });

  it('hold a :hover condition only under (hover: hover), so a tap leaves no hover style (R3)', () => {
    const css = web();
    /** The text of the top-level block that starts with header, braces matched. */
    const block = (header: string): string => {
      const at = css.indexOf(`\n${header} {\n`);
      if (at < 0) return '';
      let depth = 0;
      for (let i = css.indexOf('{', at); i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) return css.slice(at + 1, i + 1);
      }
      throw new Error(`${header} is not closed`);
    };
    const gate = block('@media (hover: hover)');
    const elsewhere = block('@media not all and (hover: hover)');
    expect(gate).not.toBe('');
    expect(elsewhere).not.toBe('');
    // Outside the hover gate, no condition requires a :hover candidate, and the no-hover block tests no :hover at all.
    const requiresHover = (line: string): boolean => line.replace(/:not\(:has\([^()]*(?:\([^()]*\))?[^()]*\)\)|:not\(:hover\)/g, '').includes(':hover');
    const outside = css.replace(gate, '').split('\n').filter((l) => l.startsWith(':root'));
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.filter(requiresHover)).toEqual([]);
    expect(gate.split('\n').filter((l) => l.startsWith(':root')).some(requiresHover)).toBe(true);
    expect(elsewhere).not.toMatch(/:hover/);
    // A document without :hover rules is not gated.
    expect(web('.a:active { width: 1px; } .f:focus { width: 2px; }')).not.toMatch(/@media/);
  });

  it('catches the plant webHoverUngated', () => {
    expect(web(CSS, { webHoverUngated: true })).not.toMatch(/@media \(hover: hover\)/);
  });

  it('keep an inherited colour inherit under an animated colour in every state (T065 R9)', () => {
    const css = `${BODY}@keyframes k { from { color: red; } to { color: blue; } } .a { color: black; animation: k 1s infinite; } .a:hover { color: green; }`;
    const body = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', ['a'], [div(r, 'z', ['z'])])];
    const out = compile({}, css, body, { web: {} });
    if (out.outputs.web.kind !== 'ready') throw new Error(errors(out.diagnostics).join('\n'));
    const text = (out.outputs.web.files[0] as { text: string }).text;
    const record = internalRecord(out);
    const cls = (address: string): string => record?.cases[0]?.webClassOf?.get(address) as string;
    expect(text).toContain(`.${cls('z')} {\n`);
    // z's base rule keeps color: inherit, and no state rule replaces it with a's static hover colour.
    const rules = text.split('}\n').filter((r) => r.includes(`.${cls('z')} {`) || r.includes(`.${cls('z')},`));
    expect(rules.some((r) => r.includes('color: inherit;'))).toBe(true);
    expect(rules.filter((r) => r.includes(':root')).join('')).not.toContain('color: rgb(0, 128, 0)');
    // a's own hover colour is still emitted (Chrome lets the animation outrank it, which the browser does here too).
    expect(text).toContain(` .${cls('a')} {\n  color: rgb(0, 128, 0);\n}`);
    // A colour z declares in a state is its own, not inherited, and is emitted.
    const own = compile({}, `${css} .a:hover .z { color: green; }`, body, { web: {} }).outputs.web;
    expect(own.kind === 'ready' && own.files[0]?.text.includes(' .' + cls('z') + ' {\n  color: rgb(0, 128, 0);')).toBe(true);
  });

  it('leave a document without interaction rules, or with one that matches nothing, as it was', () => {
    const body = (t: string): string => t.split('\n').slice(1).join('\n');
    const plain = '.a { width: 100px; height: 20px; } .b { width: 50px; height: 10px; }';
    expect(body(web(plain))).toEqual(body(web(`${plain} .nothing:hover { width: 1px; } .nothing:active { width: 2px; }`)));
    expect(internalRecord(compile({}, plain))?.cases[0]?.partition?.states).toEqual([]);
  });
});
