// Conformance cases through the public createProject().compile() path (docs/api.md §3, §10).
import { describe, expect, it } from 'vitest';
import type { Assignment, ClassBinding, Compiled, ComponentDefinition, Condition, ElementNode, ExplainedCase, Origin, TreeNode } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { compiledCases, createProjectWith, iosLayoutProjection, NO_FAULTS, webClassMap } from '../src/internal.ts';
import { always, eq, expectCatalogued, not, Sources } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const web = () => createProject({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' } } });

const sym = (owner: string, sheet: string, name: string) => ({ owner, sheet, name });
const cls = (origin: Origin, owner: string, sheet: string, name: string): ClassBinding => ({ value: [{ when: always, value: sym(owner, sheet, name) }], origin });
const when = (origin: Origin, c: Condition, owner: string, sheet: string, name: string): ClassBinding => ({ value: [{ when: c, value: sym(owner, sheet, name) }, { when: not(c), value: null }], origin });
const el = (origin: Origin, id: string, classes: ClassBinding[], children: TreeNode[] = []): ElementNode => ({ kind: 'element', id, tag: 'div', classes, attributes: [], children, origin });
const call = (origin: Origin, id: string, component: string, extra: Partial<Extract<TreeNode, { kind: 'call' }>> = {}): TreeNode => ({ kind: 'call', id, component, args: [], aliases: [], slots: [], origin, ...extra });

function component(s: Sources, file: string, id: string, root: TreeNode[], extra: Partial<ComponentDefinition> = {}): ComponentDefinition {
  return { id, module: file.replace(/\.dg$/, ''), params: [], states: [], slots: [], root, origin: s.at(file, `component ${id}`), ...extra };
}

function document(s: Sources, file: string, body: TreeNode[]): ElementNode {
  return { kind: 'element', id: 'html', tag: 'html', classes: [], attributes: [], origin: s.at(file, '<html>'), children: [
    { kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], origin: s.at(file, '<body>'), children: body },
  ] };
}

function explainAll<K extends string>(c: Compiled<K>, target: K, node: string, instance: string, property: string, assignment: Assignment = []): ExplainedCase[] {
  const r = c.explain({ target, at: { node, instance }, property, assignment });
  if (r.kind !== 'found') throw new Error(`${instance} ${node} ${property}: ${JSON.stringify(r)}`);
  return [...r.cases];
}

const originText = (s: Sources, c: ExplainedCase): string => {
  if (c.origin.kind !== 'authored') return c.origin.kind;
  const o = c.origin.span;
  const f = [...s.files.values()].find((x) => x.ref.uri === o.source.uri);
  return `${f?.displayPath}:${f?.text.slice(o.start, o.end)}`;
};

describe('multi-file ordered sheets', () => {
  const s = new Sources({
    'box.dg': 'component App { <html><body><Box box /></body></html> }\ncomponent Box { <div frame class="box" /> }',
    'base.css': '.box { width: 100px; height: 20px; }\n',
    'theme.css': '.box { width: 60px; }\n',
  });
  const input = (order: string[]) => s.input({
    modules: [{ id: 'box', source: s.ref('box.dg').uri }],
    components: [
      component(s, 'box.dg', 'App', [document(s, 'box.dg', [call(s.at('box.dg', '<Box box />'), 'box', 'Box')])]),
      component(s, 'box.dg', 'Box', [el(s.at('box.dg', '<div frame'), 'frame', [cls(s.at('box.dg', 'class="box"'), 'Box', 'base', 'box'), cls(s.at('box.dg', 'class="box"'), 'Box', 'theme', 'box')])]),
    ],
    documents: [{ id: 'doc', rootInstance: 'App', documentElement: 'html', styles: order, initial: [] }],
    styles: [
      { id: 'base', css: s.whole('base.css'), scope: { kind: 'component', owner: 'Box' } },
      { id: 'theme', css: s.whole('theme.css'), scope: { kind: 'component', owner: 'Box' } },
    ],
  });
  it('reversing the document style order flips the winner of equal specificity', () => {
    const forward = explainAll(web().compile(input(['base', 'theme'])), 'web', 'frame', 'doc/box', 'width')[0] as ExplainedCase;
    const reversed = explainAll(web().compile(input(['theme', 'base'])), 'web', 'frame', 'doc/box', 'width')[0] as ExplainedCase;
    expect([forward.value, originText(s, forward)]).toEqual(['60px', 'theme.css:width: 60px']);
    expect([reversed.value, originText(s, reversed)]).toEqual(['100px', 'base.css:width: 100px']);
    expect(forward.losing.map((l) => l.origin.kind === 'authored' && l.origin.span.source.uri)).toEqual([s.ref('base.css').uri]);
    expect(web().compile(input(['base', 'theme'])).dependencies.filter((d) => d.kind === 'stylesheet').map((d) => d.uri)).toEqual([s.ref('base.css').uri, s.ref('theme.css').uri]);
  });
});

describe('ownership: same-name classes do not leak', () => {
  const s = new Sources({
    'widgets.dg': 'component App { <html><body><Badge badge /><Chip chip /><Nav nav /></body></html> }\ncomponent Badge { <div label class="label" /> }\ncomponent Chip { <div label class="label" /> }',
    'nav.dg': 'component Nav { <div bar class="label" /> }',
    'badge.css': '.label { width: 40px; height: 10px; }\n',
    'chip.css': '.label { width: 70px; height: 16px; }\n',
    'nav.css': '.label { width: 90px; height: 4px; }\n',
  });
  const input = (badgeClass = sym('Badge', 'badge', 'label')) => s.input({
    modules: [{ id: 'widgets', source: s.ref('widgets.dg').uri }, { id: 'nav', source: s.ref('nav.dg').uri }],
    components: [
      component(s, 'widgets.dg', 'App', [document(s, 'widgets.dg', [
        call(s.at('widgets.dg', '<Badge badge />'), 'badge', 'Badge'),
        call(s.at('widgets.dg', '<Chip chip />'), 'chip', 'Chip'),
        call(s.at('widgets.dg', '<Nav nav />'), 'nav', 'Nav'),
      ])]),
      component(s, 'widgets.dg', 'Badge', [el(s.at('widgets.dg', '<div label', 0), 'label', [{ value: [{ when: always, value: badgeClass }], origin: s.at('widgets.dg', 'class="label"', 0) }])]),
      component(s, 'widgets.dg', 'Chip', [el(s.at('widgets.dg', '<div label', 1), 'label', [cls(s.at('widgets.dg', 'class="label"', 1), 'Chip', 'chip', 'label')])]),
      component(s, 'nav.dg', 'Nav', [el(s.at('nav.dg', '<div bar'), 'bar', [cls(s.at('nav.dg', 'class="label"'), 'Nav', 'nav', 'label')])]),
    ],
    documents: [{ id: 'doc', rootInstance: 'App', documentElement: 'html', styles: ['badge', 'chip', 'nav'], initial: [] }],
    styles: [
      { id: 'badge', css: s.whole('badge.css'), scope: { kind: 'component', owner: 'Badge' } },
      { id: 'chip', css: s.whole('chip.css'), scope: { kind: 'component', owner: 'Chip' } },
      { id: 'nav', css: s.whole('nav.css'), scope: { kind: 'component', owner: 'Nav' } },
    ],
  });
  it('two components in one module and a third module keep their own .label', () => {
    const c = web().compile(input());
    expect(c.ok).toBe(true);
    const width = (node: string, instance: string) => (explainAll(c, 'web', node, instance, 'width')[0] as ExplainedCase).value;
    expect(width('label', 'doc/badge')).toBe('40px');
    expect(width('label', 'doc/chip')).toBe('70px');
    expect(width('bar', 'doc/nav')).toBe('90px');
    const badge = explainAll(c, 'web', 'label', 'doc/badge', 'width')[0] as ExplainedCase;
    expect(badge.losing).toEqual([]);
  });
  it("an element cannot carry another component's class symbol", () => {
    const c = web().compile(input(sym('Chip', 'chip', 'label')));
    expect(c.diagnostics.map((d) => d.code)).toEqual(['DRAGON_CLASS_OWNER']);
    expectCatalogued(c.diagnostics);
    expect(c.outputs.web.kind).toBe('blocked');
  });
  it('a compound without a class in a component-scoped sheet is refused, so a tag cannot reach other owners', () => {
    const t = new Sources({ ...Object.fromEntries([...s.files].map(([k, v]) => [k, v.text])), 'nav.css': 'div { width: 90px; }\n' });
    const i = input();
    const swapped = { ...i, snapshot: { ...i.snapshot, sources: [...t.files.values()] }, tree: { ...(i.tree as NonNullable<typeof i.tree>), styles: (i.tree as NonNullable<typeof i.tree>).styles.map((u) => (u.id === 'nav' ? { ...u, css: t.whole('nav.css') } : u)) } };
    const c = web().compile(swapped);
    expect(c.diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_SELECTOR']);
  });
});

describe('named-slot projection', () => {
  const s = new Sources({
    'card.dg': 'component App { <html><body><Card card><slot header><div title class="row" /></slot></Card></body></html> }\ncomponent Card(compact) slots(header) { <div frame class="card"><div head class="row head">{header}</div></div> }',
    'app.css': '.row { height: 10px; }\n',
    'card.css': '.card { width: 200px; }\n.row { height: 50px; }\n.head { color: #a00000; }\n.card.compact { width: 120px; }\n',
  });
  const input = s.input({
    modules: [{ id: 'card', source: s.ref('card.dg').uri }],
    components: [
      component(s, 'card.dg', 'App', [document(s, 'card.dg', [call(s.at('card.dg', '<Card card>'), 'card', 'Card', {
        slots: [{ name: 'header', origin: s.at('card.dg', '<slot header>'), children: [el(s.at('card.dg', '<div title'), 'title', [cls(s.at('card.dg', 'class="row"'), 'App', 'app', 'row')])] }],
      })])]),
      component(s, 'card.dg', 'Card', [el(s.at('card.dg', '<div frame'), 'frame', [cls(s.at('card.dg', 'class="card"'), 'Card', 'card', 'card'), when(s.at('card.dg', 'compact'), eq('compact', true), 'Card', 'card', 'compact')], [
        el(s.at('card.dg', '<div head'), 'head', [cls(s.at('card.dg', 'class="row head"'), 'Card', 'card', 'row'), cls(s.at('card.dg', 'class="row head"'), 'Card', 'card', 'head')], [
          { kind: 'projection', id: 'header-slot', slot: 'header', origin: s.at('card.dg', '{header}') },
        ]),
      ])], {
        states: [{ id: 'compact', domain: [false, true], initial: false, origin: s.at('card.dg', 'compact') }],
        slots: [{ name: 'header', origin: s.at('card.dg', 'slots(header)') }],
      }),
    ],
    documents: [{ id: 'doc', rootInstance: 'App', documentElement: 'html', styles: ['app', 'card'], initial: [] }],
    styles: [
      { id: 'app', css: s.whole('app.css'), scope: { kind: 'component', owner: 'App' } },
      { id: 'card', css: s.whole('card.css'), scope: { kind: 'component', owner: 'Card' } },
    ],
  });
  it("projected children keep their authored owner and address, and inherit from the insertion parent", () => {
    const c = web().compile(input);
    expect(c.ok).toBe(true);
    for (const k of compiledCases(c)) {
      // The projected element is App's: it is addressed in App's instance and matches only App's .row.
      const height = explainAll(c, 'web', 'title', 'doc', 'height', k.assignment)[0] as ExplainedCase;
      expect([height.value, originText(s, height)]).toEqual(['10px', 'app.css:height: 10px']);
      const color = explainAll(c, 'web', 'title', 'doc', 'color', k.assignment)[0] as ExplainedCase;
      expect(color.value).toBe('rgb(160, 0, 0)');
      expect(color.origin).toMatchObject({ kind: 'inherited', element: 'card/head', from: { kind: 'authored' } });
      expect(webClassMap(c, k.assignment)?.has('title')).toBe(true);
      const p = iosLayoutProjection(c, ENV, k.assignment);
      if (p.kind !== 'ready') throw new Error(p.reason);
      const head = p.input.root.children[0]?.kind === 'box' ? p.input.root.children[0].children[0] : undefined;
      const frame = head?.kind === 'box' ? head : undefined;
      expect(frame?.id).toBe('card/frame');
      const projected = frame?.children[0]?.kind === 'box' ? frame.children[0].children[0] : undefined;
      expect(projected?.id).toBe('title');
    }
  });
});

describe('finite states: instances, aliases and branches', () => {
  const s = new Sources({
    'app.dg': [
      'component App(open: boolean = false) { <html><body><Switch a /><Switch b /><Panel p open={open} /><Panel q /></body></html> }',
      'component Switch(checked: boolean = false) { <div trigger class="switch on" /> }',
      'component Panel(expanded: boolean = false) { <div box class="panel">{expanded ? <div body class="body" /> : <div stub class="stub" />}</div> }',
    ].join('\n'),
    'app.css': '.switch { width: 10px; height: 10px; }\n.on { width: 30px; }\n.panel { width: 80px; }\n.body { height: 20px; }\n.stub { height: 4px; }\n',
  });
  const input = (initial: { instance: string; state: string; value: boolean }[] = [], stubTag = 'div') => s.input({
    modules: [{ id: 'app', source: s.ref('app.dg').uri }],
    components: [
      component(s, 'app.dg', 'App', [document(s, 'app.dg', [
        call(s.at('app.dg', '<Switch a />'), 'a', 'Switch'),
        call(s.at('app.dg', '<Switch b />'), 'b', 'Switch'),
        call(s.at('app.dg', '<Panel p open={open} />'), 'p', 'Panel', { aliases: [{ local: { instance: '.', state: 'expanded' }, caller: { instance: '.', state: 'open' } }] }),
        call(s.at('app.dg', '<Panel q />'), 'q', 'Panel'),
      ])], { states: [{ id: 'open', domain: [false, true], initial: false, origin: s.at('app.dg', 'open: boolean = false') }] }),
      component(s, 'app.dg', 'Switch', [el(s.at('app.dg', '<div trigger'), 'trigger', [cls(s.at('app.dg', 'switch on'), 'doc', 'app', 'switch'), when(s.at('app.dg', 'switch on'), eq('checked', true), 'doc', 'app', 'on')])], {
        states: [{ id: 'checked', domain: [false, true], initial: false, origin: s.at('app.dg', 'checked: boolean = false') }],
      }),
      component(s, 'app.dg', 'Panel', [el(s.at('app.dg', '<div box'), 'box', [cls(s.at('app.dg', 'class="panel"'), 'doc', 'app', 'panel')], [
        { kind: 'branch', id: 'more', when: eq('expanded', true), origin: s.at('app.dg', '{expanded ?'),
          then: [el(s.at('app.dg', '<div body'), 'body', [cls(s.at('app.dg', 'class="body"'), 'doc', 'app', 'body')])],
          else: [{ ...el(s.at('app.dg', '<div stub'), 'stub', [cls(s.at('app.dg', 'class="stub"'), 'doc', 'app', 'stub')]), tag: stubTag }] },
      ])], { states: [{ id: 'expanded', domain: [false, true], initial: false, origin: s.at('app.dg', 'expanded: boolean = false') }] }),
    ],
    documents: [{ id: 'doc', rootInstance: 'App', documentElement: 'html', styles: ['app'], initial: initial.map((i) => ({ state: { instance: i.instance, state: i.state }, value: i.value })) }],
    styles: [{ id: 'app', css: s.whole('app.css'), scope: { kind: 'document' } }],
  });
  // The classes here are document-owned (a document-scoped sheet), which every component may use.

  it('enumerates the product of the free domains; the aliased state adds no case', () => {
    const c = web().compile(input());
    expect(c.ok).toBe(true);
    // Free: doc.open, doc/a.checked, doc/b.checked, doc/q.expanded; doc/p.expanded follows doc.open.
    const cases = compiledCases(c);
    expect(cases.length).toBe(16);
    expect(cases[0]?.assignment.map((a) => `${a.state.instance}.${a.state.state}`)).toEqual(['doc.open', 'doc/a.checked', 'doc/b.checked', 'doc/q.expanded']);
    expect(cases.filter((k) => k.isInitial).length).toBe(1);
  });

  it('the two instances are independent', () => {
    const c = web().compile(input());
    const at = (a: boolean, b: boolean): Assignment => [
      { state: { instance: 'doc/a', state: 'checked' }, value: a },
      { state: { instance: 'doc/b', state: 'checked' }, value: b },
      { state: { instance: 'doc', state: 'open' }, value: false },
      { state: { instance: 'doc/q', state: 'expanded' }, value: false },
    ];
    const width = (instance: string, assignment: Assignment) => (explainAll(c, 'web', 'trigger', instance, 'width', assignment)[0] as ExplainedCase).value;
    expect([width('doc/a', at(true, false)), width('doc/b', at(true, false))]).toEqual(['30px', '10px']);
    expect([width('doc/a', at(false, true)), width('doc/b', at(false, true))]).toEqual(['10px', '30px']);
    const one = webClassMap(c, at(true, false));
    const other = webClassMap(c, at(false, false));
    expect(one?.get('a/trigger')).not.toBe(other?.get('a/trigger'));
    expect(one?.get('b/trigger')).toBe(other?.get('b/trigger'));
    const open = explainAll(c, 'web', 'trigger', 'doc/a', 'width', [{ state: { instance: 'doc/a', state: 'checked' }, value: true }]);
    expect(open.length).toBe(8);
  });

  it('controlled aliases take the caller\'s initial value; uncontrolled state keeps its own', () => {
    const c = web().compile(input([{ instance: 'doc', state: 'open', value: true }]));
    const initial = compiledCases(c).find((k) => k.isInitial);
    expect(initial?.assignment).toEqual([
      { state: { instance: 'doc', state: 'open' }, value: true },
      { state: { instance: 'doc/a', state: 'checked' }, value: false },
      { state: { instance: 'doc/b', state: 'checked' }, value: false },
      { state: { instance: 'doc/q', state: 'expanded' }, value: false },
    ]);
    const a = initial?.assignment ?? [];
    // Panel p is controlled by App.open (initially true): its expanded arm renders; Panel q keeps its own false.
    expect(explainAll(c, 'web', 'body', 'doc/p', 'height', a).map((x) => x.value)).toEqual(['20px']);
    expect(c.explain({ target: 'web', at: { node: 'stub', instance: 'doc/p' }, property: 'height', assignment: a }).kind).toBe('not-found');
    expect(explainAll(c, 'web', 'stub', 'doc/q', 'height', a).map((x) => x.value)).toEqual(['4px']);
    // An explicit document value for the controlled local state must agree with the caller's.
    const agree = web().compile(input([{ instance: 'doc', state: 'open', value: true }, { instance: 'doc/p', state: 'expanded', value: true }]));
    expect(agree.ok).toBe(true);
  });

  it('both branch arms are compiled and checked', () => {
    const c = web().compile(input());
    const arms = compiledCases(c).map((k) => [
      c.explain({ target: 'web', at: { node: 'body', instance: 'doc/q' }, property: 'height', assignment: k.assignment }).kind,
      c.explain({ target: 'web', at: { node: 'stub', instance: 'doc/q' }, property: 'height', assignment: k.assignment }).kind,
    ].join(' '));
    expect(new Set(arms)).toEqual(new Set(['found not-found', 'not-found found']));
    // A structural error in the arm the initial state does not show still blocks every output.
    const bad = web().compile(input([], 'pre'));
    expect(bad.diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_ELEMENT']);
    expect(bad.outputs.web.kind).toBe('blocked');
    expect(bad.outputs.ios.kind).toBe('blocked');
  });

  it('stateCollapse keeps one element at its initial classes while the others follow the state', () => {
    const faulty = createProjectWith({ projectId: 'test', targets: { web: {} } }, { faults: { ...NO_FAULTS, stateCollapse: 'a/trigger' }, profiles: 'enforce', direction: 'ltr' }).compile(input());
    const checked: Assignment = [{ state: { instance: 'doc/a', state: 'checked' }, value: true }, { state: { instance: 'doc/b', state: 'checked' }, value: true }];
    expect(explainAll(faulty, 'web', 'trigger', 'doc/a', 'width', checked).map((x) => x.value)).toEqual(['10px', '10px', '10px', '10px']);
    expect(explainAll(faulty, 'web', 'trigger', 'doc/b', 'width', checked).map((x) => x.value)).toEqual(['30px', '30px', '30px', '30px']);
  });
});
