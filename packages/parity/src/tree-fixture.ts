// Reads a tree fixture (packages/parity/fixtures/<id>/): fixture.json plus its source files. It plays the framework
// producer: every origin is a span found in the real source text, so the FrontEndResult carries the same provenance a
// front end would supply. fixture.json is a compact authoring form of dragon/tree@0 (see TreeFixtureFile).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import type { ClassSymbol, Condition, FrontEndResult, Origin, Scalar, SourceFile, SourceRef, StateRef, TreeNode } from 'dragon';
import { TREE_SCHEMA_REVISION } from 'dragon';
import { DOCUMENT_ID, PROJECT_ID } from './fixture-reader.ts';
import { repoPath } from './paths.ts';

/** "text" or ["text", n]: the n-th (0-based) occurrence of text in the component's module source. */
type At = string | readonly [string, number];
/** true | [state, value] | {not} | {and} | {or} | {ref: {instance, state}, value}. */
type Cond = true | readonly [string, Scalar] | { not: Cond } | { and: readonly Cond[] } | { or: readonly Cond[] } | { ref: StateRef; value: Scalar };
type ClassSpec = string | { when: Cond; class: string; at?: At } | { choice: readonly { when: Cond; class: string | null }[]; at?: At };
type AttrSpec = { name: string; value: string; at?: At } | { name: string; when: Cond; value: string; at?: At } | { name: string; choice: readonly { when: Cond; value: string | null }[]; at?: At };
type NodeSpec =
  | { el: string; id: string; at: At; class?: readonly ClassSpec[]; attr?: readonly AttrSpec[]; children?: readonly NodeSpec[] }
  | { text: string; id: string; at: At }
  | { call: string; id: string; at: At; args?: { readonly [param: string]: Scalar }; aliases?: readonly { local: string; caller: string | StateRef }[]; slots?: { readonly [name: string]: readonly NodeSpec[] } }
  | { slot: string; id: string; at: At }
  | { if: Cond; id: string; at: At; then: readonly NodeSpec[]; else: readonly NodeSpec[] }
  | { raw: Record<string, unknown>; at: At };

export type TreeFixtureFile = {
  /** Source files of the fixture directory, in snapshot order. */
  readonly sources: readonly string[];
  readonly modules: readonly { readonly id: string; readonly source: string }[];
  /** scope: a component id, or "document". */
  readonly styles: readonly { readonly id: string; readonly file: string; readonly scope: string }[];
  readonly document: {
    readonly root: string;
    readonly documentElement: string;
    readonly styles: readonly string[];
    readonly initial?: readonly { readonly instance: string; readonly state: string; readonly value: Scalar }[];
  };
  readonly components: readonly {
    readonly id: string;
    readonly module: string;
    readonly at: At;
    readonly params?: readonly { readonly id: string; readonly domain: readonly Scalar[]; readonly at: At }[];
    readonly states?: readonly { readonly id: string; readonly domain: readonly Scalar[]; readonly initial: Scalar; readonly at: At }[];
    readonly slots?: readonly { readonly name: string; readonly at: At }[];
    readonly root: readonly NodeSpec[];
  }[];
  /** Errors the producer recovered from; they must propagate and block outputs. */
  readonly producerDiagnostics?: readonly { readonly code: string; readonly message: string; readonly file: string; readonly at: At }[];
  /** Declared by hand for every layout tree fixture; checked against the renderer and Dragon, never derived from either. */
  readonly expected?: TreeExpectation;
};

/** One text node of the declared topology; when lists the [instance, state, value] terms of the cases it appears in. */
export type TopologySpec = {
  readonly address: string;
  readonly component: string;
  readonly template: string;
  /** The source text of the text node's authored origin. */
  readonly at: string;
  readonly ownerInstance: string;
  readonly insertionParent: string;
  /** The text context, with its facets, in each environment direction (docs/api.md §7, §10.1). */
  readonly context: { readonly ltr: string; readonly rtl: string };
  readonly when?: readonly (readonly [string, string, Scalar])[];
};

/** MF1 and docs/api.md §10: the hand-declared free states, case count, initial assignment and text topology of a tree fixture. */
export type TreeExpectation = {
  readonly freeStates: readonly { readonly instance: string; readonly state: string; readonly domain: readonly Scalar[] }[];
  readonly cases: number;
  readonly initial: readonly { readonly instance: string; readonly state: string; readonly value: Scalar }[];
  readonly textTopology: readonly TopologySpec[];
};

export function readTreeExpectation(id: string): TreeExpectation | null {
  const spec = JSON.parse(readFileSync(repoPath(`packages/parity/fixtures/${id}/fixture.json`), 'utf8')) as TreeFixtureFile;
  return spec.expected === undefined ? null : spec.expected;
}

export function readTreeFixture(id: string): FrontEndResult {
  const dir = `packages/parity/fixtures/${id}`;
  const spec = JSON.parse(readFileSync(repoPath(`${dir}/fixture.json`), 'utf8')) as TreeFixtureFile;
  return treeFixtureInput(id, spec, (file) => ({ uri: `dragon-source://${PROJECT_ID}/fixtures/${id}/${file}`, displayPath: `${dir}/${file}`, text: readFileSync(repoPath(sourcePath(id, dir, file)), 'utf8') }));
}

/** The repo-relative path of a listed source; a backslash or a path leaving the repository is refused. */
function sourcePath(id: string, dir: string, file: string): string {
  const path = posix.normalize(`${dir}/${file}`);
  if (file.includes('\\') || path === '..' || path.startsWith('../') || posix.isAbsolute(path)) throw new Error(`${id}: source ${file} is outside the repository or not a posix path`);
  return path;
}

/** A tree fixture directory anywhere in the repository (repo-relative dir); its source paths may leave the directory ("../x.css"). */
export type TreeFixtureDirOptions = {
  /** Replaces a source file's text (same length and offsets are the caller's concern), for example a probe stylesheet. */
  readonly text?: (file: string, text: string) => string;
  /** Rewrites the parsed fixture.json before it is read, for example a projected tree. */
  readonly spec?: (spec: TreeFixtureFile) => TreeFixtureFile;
};

export function readTreeFixtureFile(dir: string): TreeFixtureFile {
  return JSON.parse(readFileSync(repoPath(`${dir}/fixture.json`), 'utf8')) as TreeFixtureFile;
}

export function readTreeFixtureDir(dir: string, id: string, options: TreeFixtureDirOptions = {}): FrontEndResult {
  const read = readTreeFixtureFile(dir);
  const spec = options.spec === undefined ? read : options.spec(read);
  return treeFixtureInput(id, spec, (file) => {
    const path = sourcePath(id, dir, file);
    const text = readFileSync(repoPath(path), 'utf8');
    return { uri: `dragon-source://${PROJECT_ID}/${path}`, displayPath: path, text: options.text === undefined ? text : options.text(file, text) };
  });
}

function treeFixtureInput(id: string, spec: TreeFixtureFile, load: (file: string) => { uri: string; displayPath: string; text: string }): FrontEndResult {
  const sources = new Map<string, SourceFile>();
  const uris = new Set<string>();
  for (const file of spec.sources) {
    const { uri, displayPath, text } = load(file);
    // Two entries for one file would become two snapshot sources with one uri.
    if (sources.has(file) || uris.has(uri)) throw new Error(`${id}: source ${file} is listed twice`);
    uris.add(uri);
    const ref: SourceRef = { uri, revision: 'fixture', hash: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}` };
    sources.set(file, { ref, text, displayPath });
  }
  const source = (file: string): SourceFile => {
    const s = sources.get(file);
    if (s === undefined) throw new Error(`${id}: ${file} is not listed in sources`);
    return s;
  };
  const find = (file: string, at: At): Origin => {
    const s = source(file);
    const [text, nth] = typeof at === 'string' ? [at, 0] : at;
    if (text === '' || !Number.isInteger(nth) || nth < 0) throw new Error(`${id}: bad origin ${JSON.stringify(at)} in ${file}`);
    let start = -1;
    for (let i = 0; i <= nth; i++) {
      start = s.text.indexOf(text, start + 1);
      if (start < 0) throw new Error(`${id}: "${text}" (occurrence ${nth}) not found in ${file}`);
    }
    return { kind: 'authored', span: { source: s.ref, start, end: start + text.length } };
  };
  const moduleFile = new Map(spec.modules.map((m) => [m.id, m.source]));
  const owners = new Map(spec.styles.map((s) => [s.id, s.scope === 'document' ? DOCUMENT_ID : s.scope]));
  const symbol = (ref: string): ClassSymbol => {
    const dot = ref.indexOf('.');
    const sheet = ref.slice(0, dot);
    const owner = owners.get(sheet);
    if (dot < 0 || owner === undefined) throw new Error(`${id}: class "${ref}" must be "<style use>.<name>"`);
    return { owner, sheet, name: ref.slice(dot + 1) };
  };
  const cond = (c: Cond): Condition => {
    if (c === true) return { kind: 'true' };
    if ('not' in c) return { kind: 'not', value: cond(c.not) };
    if ('and' in c) return { kind: 'and', values: c.and.map(cond) };
    if ('or' in c) return { kind: 'or', values: c.or.map(cond) };
    if ('ref' in c) return { kind: 'eq', ref: c.ref, value: c.value };
    const [state, value] = c as readonly [string, Scalar];
    return { kind: 'eq', ref: { instance: '.', state }, value };
  };
  const components = spec.components.map((comp) => {
    const file = moduleFile.get(comp.module);
    if (file === undefined) throw new Error(`${id}: unknown module ${comp.module}`);
    const at = (a: At): Origin => find(file, a);
    const node = (n: NodeSpec): TreeNode => {
      if ('raw' in n) return { ...n.raw, origin: at(n.at) } as unknown as TreeNode;
      const origin = at(n.at);
      if ('el' in n) {
        return {
          kind: 'element',
          id: n.id,
          tag: n.el,
          classes: (n.class === undefined ? [] : n.class).map((c) => {
            if (typeof c === 'string') return { value: [{ when: { kind: 'true' }, value: symbol(c) }], origin };
            const o = c.at === undefined ? origin : at(c.at);
            if ('choice' in c) return { value: c.choice.map((arm) => ({ when: cond(arm.when), value: arm.class === null ? null : symbol(arm.class) })), origin: o };
            const when = cond(c.when);
            return { value: [{ when, value: symbol(c.class) }, { when: { kind: 'not', value: when }, value: null }], origin: o };
          }),
          attributes: (n.attr === undefined ? [] : n.attr).map((a) => {
            const o = a.at === undefined ? origin : at(a.at);
            if ('choice' in a) return { name: a.name, value: a.choice.map((arm) => ({ when: cond(arm.when), value: arm.value })), origin: o };
            if ('when' in a) {
              const when = cond(a.when);
              return { name: a.name, value: [{ when, value: a.value }, { when: { kind: 'not', value: when }, value: null }], origin: o };
            }
            return { name: a.name, value: [{ when: { kind: 'true' }, value: a.value }], origin: o };
          }),
          children: (n.children === undefined ? [] : n.children).map(node),
          origin,
        };
      }
      if ('text' in n) return { kind: 'text', id: n.id, text: n.text, origin };
      if ('call' in n) {
        return {
          kind: 'call',
          id: n.id,
          component: n.call,
          args: Object.entries(n.args === undefined ? {} : n.args).map(([param, value]) => ({ param, value, origin })),
          aliases: (n.aliases === undefined ? [] : n.aliases).map((a) => ({
            local: { instance: '.', state: a.local },
            caller: typeof a.caller === 'string' ? { instance: '.', state: a.caller } : a.caller,
          })),
          slots: Object.entries(n.slots === undefined ? {} : n.slots).map(([name, children]) => ({ name, children: children.map(node), origin })),
          origin,
        };
      }
      if ('slot' in n) return { kind: 'projection', id: n.id, slot: n.slot, origin };
      return { kind: 'branch', id: n.id, when: cond(n.if), then: n.then.map(node), else: n.else.map(node), origin };
    };
    return {
      id: comp.id,
      module: comp.module,
      params: (comp.params === undefined ? [] : comp.params).map((p) => ({ id: p.id, domain: p.domain, origin: at(p.at) })),
      states: (comp.states === undefined ? [] : comp.states).map((s) => ({ id: s.id, domain: s.domain, initial: s.initial, origin: at(s.at) })),
      slots: (comp.slots === undefined ? [] : comp.slots).map((s) => ({ name: s.name, origin: at(s.at) })),
      root: comp.root.map(node),
      origin: at(comp.at),
    };
  });
  return {
    producer: { name: 'dragon-parity-tree-fixture', version: '0.0.0', schemaRevision: TREE_SCHEMA_REVISION },
    snapshot: { projectId: PROJECT_ID, revision: 'fixture', sources: [...sources.values()], assets: [], resolutions: [] },
    diagnostics: (spec.producerDiagnostics === undefined ? [] : spec.producerDiagnostics).map((d) => ({
      code: d.code,
      severity: 'error',
      target: null,
      origin: find(d.file, d.at),
      message: d.message,
      why: 'The producer recovered from this error while reading the source.',
      related: [],
      fix: null,
      profile: null,
    })),
    tree: {
      schema: 'dragon/tree@0',
      schemaRevision: TREE_SCHEMA_REVISION,
      modules: spec.modules.map((m) => ({ id: m.id, source: source(m.source).ref.uri })),
      components,
      documents: [{
        id: DOCUMENT_ID,
        rootInstance: spec.document.root,
        documentElement: spec.document.documentElement,
        styles: spec.document.styles,
        initial: (spec.document.initial === undefined ? [] : spec.document.initial).map((i) => ({ state: { instance: i.instance, state: i.state }, value: i.value })),
      }],
      styles: spec.styles.map((s) => {
        const src = source(s.file);
        return {
          id: s.id,
          css: { source: src.ref, start: 0, end: src.text.length },
          scope: s.scope === 'document' ? { kind: 'document' } : { kind: 'component', owner: s.scope },
        };
      }),
    },
    completeness: 'closed-application',
  };
}
