// The north star as a tree fixture (examples/music-player/tree, notes/T025 §2 TREE item 5): the Markless demo's components with
// libraryStatus and isPlaying as free states. Each of the 4 cases, rendered by the parity renderer, must equal the Chrome
// reference's free-state snapshot (tools/snapshot.ts freeStateHtml), so the tree and the reference cannot drift apart. The
// hand-declared expectation (free states, cases, initial assignment, text topology) is checked against the renderer, Dragon's
// case enumeration, an independent walk of the tree and, for each text context, the Chrome reference dumps.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Assignment, ComponentDefinition, Condition, FrontEndResult, Scalar, TreeNode } from 'dragon';
import { createProject } from 'dragon';
import { parseFixtureHtml } from '../src/fixture-reader.ts';
import { repoPath } from '../src/paths.ts';
import { caseCountProblems } from '../src/pipeline.ts';
import { authoredModel } from '../src/render.ts';
import type { TopologySpec } from '../src/tree-fixture.ts';
import { readTreeFixtureDir, readTreeFixtureFile } from '../src/tree-fixture.ts';

const TREE_DIR = 'examples/music-player/tree';
const exampleDir = repoPath('examples/music-player');
type FreeStateId = 'main' | 'library-open' | 'playing' | 'library-open-playing';
type Snapshot = {
  FREE_STATES: readonly { readonly id: FreeStateId; readonly libraryStatus: boolean; readonly isPlaying: boolean }[];
  readSnapshot(): { html: string; css: string };
  freeStateHtml(html: string, state: FreeStateId): string;
};
const loadSnapshot = async (): Promise<Snapshot> => (await import(pathToFileURL(join(exampleDir, 'tools/snapshot.ts')).href)) as Snapshot;

type Raw = ReturnType<typeof parseFixtureHtml>['root'];
type Norm = { readonly id: string; readonly tag: string; readonly classes: readonly string[]; readonly attrs: readonly (readonly [string, string])[]; readonly children: readonly (Norm | string)[] };

/** The element tree without the head: tag, class list, other attributes and text, in order; unscope strips the renderer's class prefix. */
function normalize(el: Raw, unscope: (c: string) => string): Norm {
  const classes = (el.attrs.get('class') ?? '').split(/\s+/).filter((c) => c !== '').map(unscope);
  const attrs = [...el.attrs.entries()].filter(([k]) => k !== 'class' && k !== 'data-dragon-id').sort(([a], [b]) => (a < b ? -1 : 1));
  const children = el.children.filter((c) => !('tag' in c) || c.tag !== 'head').map((c) => ('tag' in c ? normalize(c, unscope) : c.text));
  return { id: el.attrs.get('data-dragon-id') ?? '', tag: el.tag, classes, attrs, children };
}
const shape = (n: Norm): unknown => ({ tag: n.tag, classes: n.classes, attrs: n.attrs, children: n.children.map((c) => (typeof c === 'string' ? c : shape(c))) });

/** Pairs each rendered element address with the snapshot's data-dragon-id, walking both trees in step. */
function pairIds(rendered: Norm, snapshot: Norm, out = new Map<string, Norm>()): Map<string, Norm> {
  out.set(rendered.id, snapshot);
  rendered.children.forEach((c, i) => {
    const s = snapshot.children[i];
    if (typeof c !== 'string' && s !== undefined && typeof s !== 'string') pairIds(c, s, out);
  });
  return out;
}

type TextEntry = Omit<TopologySpec, 'context' | 'when'>;

/** An independent walk of the tree for one assignment: every text node with its address, template, instance and insertion parent. */
function textEntries(input: FrontEndResult, assignment: Assignment): TextEntry[] {
  const tree = input.tree as NonNullable<FrontEndResult['tree']>;
  const doc = tree.documents[0] as NonNullable<(typeof tree.documents)[0]>;
  const comp = (id: string): ComponentDefinition => tree.components.find((c) => c.id === id) as ComponentDefinition;
  const spanText = (n: TreeNode): string => {
    if (n.origin.kind !== 'authored') throw new Error('unlocated text');
    const span = n.origin.span;
    return (input.snapshot.sources.find((s) => s.ref.uri === span.source.uri) as { text: string }).text.slice(span.start, span.end);
  };
  type Inst = { path: string; args: Map<string, Scalar>; aliases: Map<string, { inst: Inst; state: string }> };
  const read = (inst: Inst, state: string): Scalar => {
    if (inst.args.has(state)) return inst.args.get(state) as Scalar;
    const alias = inst.aliases.get(state);
    if (alias !== undefined) return read(alias.inst, alias.state);
    const hit = assignment.find((a) => a.state.instance === inst.path && a.state.state === state);
    if (hit === undefined) throw new Error(`no value for ${inst.path}.${state}`);
    return hit.value;
  };
  const holds = (c: Condition, inst: Inst): boolean => {
    if (c.kind === 'true') return true;
    if (c.kind === 'eq') return read(inst, c.ref.state) === c.value;
    if (c.kind === 'not') return !holds(c.value, inst);
    return c.kind === 'and' ? c.values.every((v) => holds(v, inst)) : c.values.some((v) => holds(v, inst));
  };
  const rel = (inst: Inst): string => (inst.path === doc.id ? '' : `${inst.path.slice(doc.id.length + 1)}/`);
  const out: TextEntry[] = [];
  const walk = (nodes: readonly TreeNode[], inst: Inst, component: string, parent: string, counter: { n: number }): void => {
    for (const n of nodes) {
      if (n.kind === 'text') out.push({ address: `${parent}:text${counter.n++}`, component, template: n.id, at: spanText(n), ownerInstance: inst.path, insertionParent: parent });
      else if (n.kind === 'element') walk(n.children, inst, component, `${rel(inst)}${n.id}`, { n: 0 });
      else if (n.kind === 'branch') walk(holds(n.when, inst) ? n.then : n.else, inst, component, parent, counter);
      else if (n.kind === 'call') {
        const child: Inst = { path: `${inst.path}/${n.id}`, args: new Map(n.args.map((a) => [a.param, a.value])), aliases: new Map(n.aliases.map((a) => [a.local.state, { inst, state: a.caller.state }])) };
        walk(comp(n.component).root, child, n.component, parent, counter);
      } else throw new Error(`unexpected ${n.kind}`);
    }
  };
  walk(comp(doc.rootInstance).root, { path: doc.id, args: new Map(), aliases: new Map() }, doc.rootInstance, '', { n: 0 });
  return out;
}

type Dump = { readonly properties: readonly string[]; readonly elements: readonly { readonly id: string; readonly values: readonly string[] }[] };

/** Dragon's textContext rule (analysis/context.ts) applied to Chrome's computed values of the snapshot elements. */
function chromeTextContext(dump: Dump, el: Norm, parent: Norm | null): string {
  const value = (n: Norm, p: string): string => {
    const e = dump.elements.find((x) => x.id === n.id);
    if (e === undefined) throw new Error(`${n.id} is not in the Chrome dump`);
    return e.values[dump.properties.indexOf(p)] as string;
  };
  const dir = value(el, 'direction') === 'rtl' ? 'rtl' : 'ltr';
  const axis = (n: Norm): string => (value(n, 'flex-direction').startsWith('column') ? 'column' : 'row');
  const display = value(el, 'display');
  if (display === 'none') return `text-in-display-none/${dir}`;
  if (display === 'flex') return `text-as-anonymous-flex-item/${axis(el)}/${dir}`;
  if (el.children.some((c) => typeof c !== 'string' && value(c, 'display') !== 'none')) return `text-in-anonymous-block/${dir}`;
  if (parent !== null && value(parent, 'display') === 'flex' && value(el, 'position') !== 'absolute') return `text-in-flex-item/${axis(parent)}/${dir}`;
  return `text-in-block/${dir}`;
}

function parents(n: Norm, parent: Norm | null = null, out = new Map<Norm, Norm | null>()): Map<Norm, Norm | null> {
  out.set(n, parent);
  for (const c of n.children) if (typeof c !== 'string') parents(c, n, out);
  return out;
}

describe('the north star as a tree fixture', () => {
  const input = readTreeFixtureDir(TREE_DIR, 'north-star');
  const declared = readTreeFixtureFile(TREE_DIR).expected;
  if (declared === undefined) throw new Error('examples/music-player/tree/fixture.json declares no expected');
  const model = authoredModel(input);
  const freeOf = async (a: Assignment): Promise<FreeStateId> => {
    const { FREE_STATES } = await loadSnapshot();
    const value = (s: string): Scalar => (a.find((e) => e.state.state === s) as { value: Scalar }).value;
    return (FREE_STATES.find((f) => f.libraryStatus === value('libraryStatus') && f.isPlaying === value('isPlaying')) as { id: FreeStateId }).id;
  };

  it('declares libraryStatus and isPlaying as free states, 4 cases and the initial assignment; the renderer and Dragon agree', () => {
    expect(declared.cases).toBe(4);
    expect(declared.freeStates.map((f) => f.state)).toEqual(['libraryStatus', 'isPlaying']);
    const compiled = createProject({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, web: {} } }).compile(input);
    expect(caseCountProblems(declared, input, compiled)).toEqual([]);
  });

  it('each case renders exactly the Chrome reference snapshot of its free state', async () => {
    const { readSnapshot, freeStateHtml } = await loadSnapshot();
    const { html } = readSnapshot();
    const seen = new Set<FreeStateId>();
    for (const a of model.assignments) {
      const id = await freeOf(a);
      seen.add(id);
      const rendered = normalize(parseFixtureHtml(model.render(a, { kind: 'authored' })).root, (c) => c.replace(/^doc__styles__/, ''));
      const reference = normalize(parseFixtureHtml(freeStateHtml(html, id)).root, (c) => c);
      expect(shape(rendered), id).toEqual(shape(reference));
    }
    expect([...seen].sort()).toEqual(['library-open', 'library-open-playing', 'main', 'playing']);
  });

  it('the declared text topology equals the tree walk in every case, with contexts read from the Chrome reference dumps', async () => {
    const { readSnapshot, freeStateHtml } = await loadSnapshot();
    const { html } = readSnapshot();
    for (const a of model.assignments) {
      const id = await freeOf(a);
      const holds = (t: readonly [string, string, Scalar]): boolean => a.some((e) => e.state.instance === t[0] && e.state.state === t[1] && e.value === t[2]);
      const expected = declared.textTopology.filter((e) => (e.when ?? []).every(holds));
      expect(expected.map(({ context: _x, when: _y, ...rest }) => rest), id).toEqual(textEntries(input, a));
      const rendered = normalize(parseFixtureHtml(model.render(a, { kind: 'authored' })).root, (c) => c);
      const reference = normalize(parseFixtureHtml(freeStateHtml(html, id)).root, (c) => c);
      const byAddress = pairIds(rendered, reference);
      const up = parents(reference);
      const dump = JSON.parse(readFileSync(join(exampleDir, `chrome/ios-390x844/dpr-3/${id}-top.json`), 'utf8')) as Dump;
      for (const e of expected) {
        const el = byAddress.get(e.insertionParent);
        if (el === undefined) throw new Error(`${e.insertionParent} is not rendered`);
        expect(e.context.ltr, `${id} ${e.address}`).toBe(chromeTextContext(dump, el, up.get(el) ?? null));
        expect(e.context.rtl, `${id} ${e.address}`).toBe(e.context.ltr.replace(/\/ltr$/, '/rtl'));
      }
    }
  });
});
