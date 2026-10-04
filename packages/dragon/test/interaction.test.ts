// SELD-R2a (notes/T047-runtime-spec.md, Amendment T064J): :hover, :focus and :focus-visible as interaction states.
// - Completeness: every state Chrome can reach (the hover chain of every element, and every element forced alone into each
//   pseudo-class) resolves, directly, exactly as the partition state it maps to; the plant interactionRuleDropped is caught.
// - Exclusivity: the generated web conditions of two states of one partition never hold together, and name only dg classes.
// - Identity: a document without interaction rules, or with one that matches nothing, compiles as it did.
import { describe, expect, it } from 'vitest';
import type { CompilerFaults, Diagnostic, FrontEndResult, InteractionPartition, InteractionState } from '../src/internal.ts';
import { conditionsExclusive, createProjectWith, interactionCondition, LONGHANDS, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { resolveTree, valueToString } from '../src/analysis/resolve.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { combinedStateRefusal } from '../src/analysis/interaction.ts';
import { internalRecord } from '../src/project.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { DOC, div, eq, inputFor, text } from './helpers.ts';

const CSS = [
  'body { font-family: Ahem; font-size: 10px; }',
  '.a { width: 100px; height: 20px; background-color: #ccc; } .a:hover { background-color: #0c0; }',
  '.b { width: 50px; height: 10px; } .a:hover + .b { margin-left: 10px; }',
  '.card { width: 120px; padding: 4px; } .card:hover .title { width: 60px; } .title { width: 30px; height: 10px; }',
  '.title:hover:focus { height: 30px; } .song:hover { background-color: #555; } .song.selected { background-color: #090; }',
  '.f:focus { width: 80px; } .g:focus-visible { background-color: #c00; } .x:hover .y:hover { height: 5px; }',
  ':not(.n:hover) > .m { height: 3px; } .open:hover { width: 7px; }',
].join('\n');

const tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [
  div(r, 'a', ['a']),
  div(r, 'b', ['b']),
  div(r, 'card', ['card'], [div(r, 'title', ['title']), text(r, 't', 'XX')]),
  div(r, 's1', ['song']),
  div(r, 's2', ['song', 'selected']),
  div(r, 'f', ['f']),
  div(r, 'g', ['g']),
  div(r, 'x', ['x'], [div(r, 'y', ['y'])]),
  div(r, 'n', ['n'], [div(r, 'm', ['m'])]),
];

/** The document above with one free state: o carries class open only when open is true. */
function input(css = CSS): FrontEndResult {
  const base = inputFor(css, (r) => {
    const origin = { kind: 'authored' as const, span: { source: r, start: 0, end: 0 } };
    const o = { ...div(r, 'o', []), classes: [{ value: [{ when: eq('open', true), value: { owner: DOC, sheet: 's', name: 'open' } }, { when: { kind: 'not' as const, value: eq('open', true) }, value: { owner: DOC, sheet: 's', name: 'shut' } }], origin }] };
    return [...tree(r), o];
  });
  return withStates(base, (c0) => [{ id: 'open', domain: [false, true], initial: false, origin: c0.origin }]);
}

type Component = NonNullable<FrontEndResult['tree']>['components'][number];

/** inputFor's document with its one component given the states built from it. */
function withStates(base: FrontEndResult, states: (c0: Component) => Component['states']): FrontEndResult {
  const c0 = base.tree?.components[0];
  if (base.tree === null || c0 === undefined) throw new Error('inputFor gives a tree with one component');
  return { ...base, tree: { ...base.tree, components: [{ ...c0, states: states(c0) }] } };
}

const compile = (faults: Partial<CompilerFaults> = {}, css = CSS) =>
  createProjectWith({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: { ...NO_FAULTS, ...faults }, profiles: 'enforce', direction: 'ltr' }).compile(input(css));

const errors = (ds: readonly Diagnostic[]) => ds.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`);

function serialize(root: ResolvedElement): string {
  const out: string[] = [];
  const walk = (el: ResolvedElement): void => {
    out.push(`${el.element.address} ${LONGHANDS.map((p) => valueToString((el.props.get(p) as { value: Parameters<typeof valueToString>[0] }).value)).join(';')}`);
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return out.join('\n');
}

/** Every state Chrome can reach that resolves differently from the partition state it maps to. */
function completenessFailures(faults: Partial<CompilerFaults>): string[] {
  const compiled = compile(faults);
  const record = internalRecord(compiled);
  if (record === undefined || record.linked === null) throw new Error('no record');
  const diagnostics: Diagnostic[] = [];
  const src = record.linked.cases.length > 0 ? input().snapshot.sources[0] : undefined;
  if (src === undefined) throw new Error('no source');
  const rules = parseStylesheet(CSS, { source: src.ref, start: 0, end: CSS.length }, { id: 's', owner: DOC, scope: 'document' }, 0, diagnostics);
  const env = { direction: 'ltr' as const, rootFont: 'ua-default' as const, ua: referenceDataset() };
  const failures: string[] = [];
  record.linked.cases.forEach((lc, i) => {
    const c = record.cases[i] as (typeof record.cases)[number];
    const p = c.partition as InteractionPartition;
    const mapped = (k: number): string => serialize(k < 0 ? (c.resolved as ResolvedElement) : (c.interaction[k] as { resolved: ResolvedElement }).resolved);
    const direct = (ix: InteractionState): string => serialize(resolveTree(lc.root, rules, NO_FAULTS, env, ix));
    const none = new Set<string>();
    p.elements.forEach((e, j) => {
      const chain = new Set<string>();
      for (let a: string | null = e.address; a !== null;) {
        chain.add(a);
        a = (p.elements.find((x) => x.address === a) as { parent: string | null }).parent;
      }
      const checks: [string, InteractionState, number][] = [
        [`chain(${e.address})`, { hover: chain, focus: none, focusVisible: none }, p.chainOf[j] as number],
        [`hover(${e.address})`, { hover: new Set([e.address]), focus: none, focusVisible: none }, p.forcedHoverOf[j] as number],
        [`focus(${e.address})`, { hover: none, focus: new Set([e.address]), focusVisible: none }, p.forcedFocusOf[j] as number],
        [`focus-visible(${e.address})`, { hover: none, focus: none, focusVisible: new Set([e.address]) }, p.forcedFocusVisibleOf[j] as number],
      ];
      for (const [name, ix, k] of checks) if (direct(ix) !== mapped(k)) failures.push(`${c.key} ${name}`);
    });
  });
  return failures;
}

describe('interaction states: compile', () => {
  it('compiles every interaction rule on every target, with case keys and counts unchanged', () => {
    const c = compile();
    expect(errors(c.diagnostics)).toEqual([]);
    const record = internalRecord(c);
    expect(record?.cases.map((x) => x.key)).toEqual(record?.linked?.cases.map((x) => x.key));
    expect(record?.cases.length).toBe(2);
    const p = record?.cases[0]?.partition as InteractionPartition;
    expect(p.candidates).toEqual({ hover: ['a', 'card', 'title', 's1', 's2', 'x', 'y', 'n'], focus: ['title', 'f'], focusVisible: ['g'] });
    // .x:hover .y:hover tests x only once y is hovered: the candidates grow to a fixed point.
    expect(p.states.map((s) => `${s.kind} ${s.key}`)).toContain('hover hover["x","y"]');
    // A forced hover on y alone matches no rule's compound chain except y's own test: it differs from y's chain.
    expect(p.states.map((s) => s.kind)).toContain('forced-hover');
    expect(record?.cases[1]?.partition?.candidates.hover).toContain('o');
    expect(record?.cases[0]?.partition?.candidates.hover).not.toContain('o');
  });

  it('resolves every reachable state as the partition state it maps to (completeness)', () => {
    expect(completenessFailures({})).toEqual([]);
  });

  it('catches the plant interactionRuleDropped', () => {
    expect(completenessFailures({ interactionRuleDropped: true }).length).toBeGreaterThan(0);
  });

  it('checks every state as it checks the case: a refusal only a hover state reaches is reported', () => {
    expect(compile({}, `${CSS}\nhtml { width: 300px; }`).ok).toBe(true);
    const bad = compile({}, `${CSS}\nhtml:hover { position: absolute; }`);
    expect(errors(bad.diagnostics).some((m) => m.includes('position: absolute on the root element html'))).toBe(true);
  });

  it('refuses direction in an interaction rule and keeps :active refused', () => {
    expect(errors(compile({}, '.a:hover { direction: rtl; }').diagnostics)).toEqual(['DRAGON_UNSUPPORTED_SELECTOR direction in a rule that tests :hover, :focus or :focus-visible is not supported: direction is resolved before the interaction states']);
    expect(errors(compile({}, '.a:active { width: 1px; }').diagnostics)[0]).toMatch(/^DRAGON_UNSUPPORTED_SELECTOR :active depends on user interaction/);
  });

  it('refuses a case whose pointer can give hover and focus at once, and not one with only one of them', () => {
    // Every focusable element is refused by its tag or attribute today, so the partition is built by hand: f is focusable.
    const origin = { kind: 'unlocated' as const, reason: 'test' };
    const css = '.f:focus { width: 1px; } .h:hover { width: 2px; }';
    const source = { uri: 'dragon-source://test/app.css', revision: 'r1', hash: 'sha256:0' };
    const rules = parseStylesheet(css, { source, start: 0, end: css.length }, { id: 's', owner: DOC, scope: 'document' }, 0, []);
    const part = (chain: number, focus: number, focusable: boolean): InteractionPartition => ({
      candidates: { hover: chain >= 0 ? ['h'] : [], focus: focus >= 0 ? ['f'] : [], focusVisible: [] },
      states: [],
      elements: [{ address: 'f', parent: null, focusable }, { address: 'h', parent: null, focusable: false }],
      chainOf: [-1, chain],
      forcedHoverOf: [-1, -1],
      forcedFocusOf: [focus, -1],
      forcedFocusVisibleOf: [-1, -1],
    });
    expect(combinedStateRefusal(part(0, 1, true), rules, origin)?.message).toBe(':focus on f together with :hover is not supported: a pointer can focus it and then hover, a state Dragon does not compile');
    expect(combinedStateRefusal(part(-1, 1, true), rules, origin)).toBeNull();
    expect(combinedStateRefusal(part(0, -1, true), rules, origin)).toBeNull();
    expect(combinedStateRefusal(part(0, 1, false), rules, origin)).toBeNull();
  });

  it('counts interaction states against the state-space limit', () => {
    // n cases of one free state, each with one hover state: 2n states in all.
    const doc = (n: number) => {
      const base = inputFor('.a:hover { width: 1px; }', (r) => [div(r, 'e', ['a'])]);
      const input = withStates(base, (c0) => [{ id: 'k', domain: Array.from({ length: n }, (_, i) => `v${i}`), initial: 'v0', origin: c0.origin }]);
      return createProjectWith({ projectId: 'test', targets: { web: {} } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' }).compile(input);
    };
    expect(errors(doc(512).diagnostics)).toEqual([]);
    expect(errors(doc(513).diagnostics)).toEqual(['DRAGON_STATE_SPACE_LIMIT document doc has 1026 reachable assignment and interaction states, above the limit of 1024']);
  });
});

describe('interaction states: web conditions', () => {
  const web = (css = CSS): string => {
    const out = compile({}, css).outputs.web;
    if (out.kind !== 'ready') throw new Error('web not ready');
    return (out.files[0] as { text: string }).text;
  };

  it('are mutually exclusive within every partition', () => {
    const record = internalRecord(compile());
    for (const c of record?.cases ?? []) {
      const p = c.partition as InteractionPartition;
      const conds = [interactionCondition({ hover: [], focus: null, focusVisible: null }, p.candidates), ...p.states.map((s) => interactionCondition(s, p.candidates))];
      conds.forEach((a, i) => conds.forEach((b, j) => {
        if (i < j) expect(conditionsExclusive(a, b), `${c.key} ${i} ${j}`).toBe(true);
      }));
    }
  });

  it('name only dg classes and the pseudo-classes: no author selector is copied', () => {
    const css = web();
    const selectors = css.split('\n').filter((l) => l.endsWith(' {') && l.startsWith(':root'));
    expect(selectors.length).toBeGreaterThan(0);
    const test = String.raw`(?::(?:hover|focus|focus-visible)|:has\((?:\.dg\d+|:is\(\.dg\d+(?:, \.dg\d+)*\)):(?:hover|focus|focus-visible)\))`;
    const shape = new RegExp(String.raw`^:root(?:${test}|:not\(${test}\))+(?:\.dg\d+| \.dg\d+) \{$`);
    for (const s of selectors) expect(s).toMatch(shape);
    expect(css).not.toMatch(/\.(?:a|card|title|song|selected|open)\b/);
  });

  it('leave a document without interaction rules, or with one that matches nothing, as it was', () => {
    const body = (t: string): string => t.split('\n').slice(1).join('\n');
    const plain = '.a { width: 100px; height: 20px; } .b { width: 50px; height: 10px; }';
    expect(body(web(plain))).toEqual(body(web(`${plain} .nothing:hover { width: 1px; }`)));
    expect(internalRecord(compile({}, plain))?.cases[0]?.partition?.states).toEqual([]);
  });
});
