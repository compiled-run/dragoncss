// The parity-owned authored reference renderer (docs/api.md §7). From the source tree alone it links calls, aliases,
// projections and branches, enumerates every reachable assignment, and writes the logical markup of each case. Scoping is
// expressed only by renaming each class token per owner and sheet, in the markup and in the CSS. It imports nothing from
// Dragon's analysis, emitter or lowering: only the input types.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { Assignment, ComponentDefinition, Condition, FrontEndResult, Scalar, SourceFile, TreeNode } from 'dragon';

type Inst = {
  readonly path: string;
  readonly component: ComponentDefinition;
  readonly args: ReadonlyMap<string, Scalar>;
  readonly slots: ReadonlyMap<string, { readonly children: readonly TreeNode[]; readonly caller: Inst }>;
};

export type FreeState = { readonly instance: string; readonly state: string; readonly domain: readonly Scalar[]; readonly initial: Scalar };

export type Classes = { readonly kind: 'authored' } | { readonly kind: 'compiled'; readonly classOf: ReadonlyMap<string, string>; readonly css: string };

export type AuthoredModel = {
  readonly free: readonly FreeState[];
  /** Every reachable assignment, first free state varying slowest. */
  readonly assignments: readonly Assignment[];
  readonly initialIndex: number;
  readonly render: (assignment: Assignment, classes: Classes) => string;
};

const key = (instance: string, state: string): string => `${instance}\u0000${state}`;
const ID = /^[A-Za-z][A-Za-z0-9-]*$/;

/** The scoped class token: owner and sheet ids never contain "_", so the token is unique per (owner, sheet, name). */
export function scopedToken(owner: string, sheet: string, name: string): string {
  if (!ID.test(owner) || !ID.test(sheet)) throw new Error(`owner "${owner}" and sheet "${sheet}" must match ${String(ID)}`);
  return `${owner}__${sheet}__${name}`;
}

const escText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Renames every class selector of a sheet to its scoped token; everything else in the CSS text is kept byte for byte. */
export function renameSheet(css: string, owner: string, sheet: string): string {
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as CssNode & { toArray?: () => unknown[] };
    if (typeof n.toArray === 'function') {
      for (const c of n.toArray()) visit(c);
      return;
    }
    if (n.type === 'ClassSelector') {
      if (n.loc === null || n.loc === undefined) throw new Error('class selector without a location');
      edits.push({ start: n.loc.start.offset, end: n.loc.end.offset, text: `.${scopedToken(owner, sheet, String(n['name']))}` });
      return;
    }
    for (const [k, v] of Object.entries(n)) if (k !== 'loc') visit(v);
  };
  visit(parse(css, { positions: true, onParseError: (e) => { throw new Error(`authored CSS does not parse: ${e.message}`); } }));
  edits.sort((a, b) => b.start - a.start);
  let out = css;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

export function authoredModel(input: FrontEndResult): AuthoredModel {
  const tree = input.tree;
  if (tree === null) throw new Error('no tree');
  const doc = tree.documents[0];
  if (doc === undefined || tree.documents.length !== 1) throw new Error('the renderer takes one document');
  const components = new Map(tree.components.map((c) => [c.id, c]));
  const comp = (id: string): ComponentDefinition => {
    const c = components.get(id);
    if (c === undefined) throw new Error(`unknown component ${id}`);
    return c;
  };

  const instances = new Map<string, Inst>();
  const expand = (inst: Inst): void => {
    instances.set(inst.path, inst);
    const walk = (nodes: readonly TreeNode[]): void => {
      for (const n of nodes) {
        if (n.kind === 'element') walk(n.children);
        else if (n.kind === 'branch') {
          walk(n.then);
          walk(n.else);
        } else if (n.kind === 'call') {
          walk(n.slots.flatMap((s) => s.children));
          expand({
            path: `${inst.path}/${n.id}`,
            component: comp(n.component),
            args: new Map(n.args.map((a) => [a.param, a.value])),
            slots: new Map(n.slots.map((s) => [s.name, { children: s.children, caller: inst }])),
          });
        }
      }
    };
    walk(inst.component.root);
  };
  expand({ path: doc.id, component: comp(doc.rootInstance), args: new Map(), slots: new Map() });

  const aliases = new Map<string, string>();
  const findCall = (parent: Inst, id: string): TreeNode | undefined => {
    const search = (nodes: readonly TreeNode[]): TreeNode | undefined => {
      for (const n of nodes) {
        if (n.kind === 'call' && n.id === id) return n;
        const inner = n.kind === 'element' ? search(n.children) : n.kind === 'branch' ? search([...n.then, ...n.else]) : n.kind === 'call' ? search(n.slots.flatMap((s) => s.children)) : undefined;
        if (inner !== undefined) return inner;
      }
      return undefined;
    };
    return search(parent.component.root);
  };
  for (const inst of instances.values()) {
    const cut = inst.path.lastIndexOf('/');
    if (cut < 0) continue;
    const parent = instances.get(inst.path.slice(0, cut)) as Inst;
    const call = findCall(parent, inst.path.slice(cut + 1));
    if (call === undefined || call.kind !== 'call') throw new Error(`no call site for ${inst.path}`);
    for (const a of call.aliases) {
      aliases.set(key(inst.path, a.local.state), key(a.caller.instance === '.' ? parent.path : a.caller.instance, a.caller.state));
    }
  }
  const owner = (k: string): string => {
    const seen = new Set<string>();
    let at = k;
    while (aliases.has(at)) {
      if (seen.has(at)) throw new Error('alias cycle');
      seen.add(at);
      at = aliases.get(at) as string;
    }
    return at;
  };

  const free: FreeState[] = [];
  for (const inst of instances.values()) {
    for (const s of inst.component.states) {
      if (!aliases.has(key(inst.path, s.id))) free.push({ instance: inst.path, state: s.id, domain: s.domain, initial: s.initial });
    }
  }
  const initial = new Map(free.map((f) => [key(f.instance, f.state), f.initial]));
  for (const i of doc.initial) initial.set(owner(key(i.state.instance, i.state.state)), i.value);

  const assignments: Assignment[] = [];
  const total = free.reduce((n, f) => n * f.domain.length, 1);
  for (let n = 0; n < total; n++) {
    let rest = n;
    const values: Scalar[] = [];
    for (let i = free.length - 1; i >= 0; i--) {
      const f = free[i] as FreeState;
      values[i] = f.domain[rest % f.domain.length] as Scalar;
      rest = Math.floor(rest / f.domain.length);
    }
    assignments.push(free.map((f, i) => ({ state: { instance: f.instance, state: f.state }, value: values[i] as Scalar })));
  }
  const initialIndex = assignments.findIndex((a) => a.every((e) => initial.get(key(e.state.instance, e.state.state)) === e.value));

  const styleOwner = (id: string): string => {
    const use = tree.styles.find((s) => s.id === id);
    if (use === undefined) throw new Error(`unknown style use ${id}`);
    return use.scope.kind === 'document' ? doc.id : use.scope.owner;
  };
  const sourceText = (uri: string): SourceFile => {
    const s = input.snapshot.sources.find((x) => x.ref.uri === uri);
    if (s === undefined) throw new Error(`no source ${uri}`);
    return s;
  };
  const authoredCss = doc.styles.map((id) => {
    const use = tree.styles.find((s) => s.id === id);
    if (use === undefined) throw new Error(`unknown style use ${id}`);
    return renameSheet(sourceText(use.css.source.uri).text.slice(use.css.start, use.css.end), styleOwner(id), id);
  });

  const render = (assignment: Assignment, classes: Classes): string => {
    const values = new Map(assignment.map((a) => [key(a.state.instance, a.state.state), a.value]));
    if (values.size !== free.length || !free.every((f) => values.has(key(f.instance, f.state)))) throw new Error('the assignment must give every free state');
    const read = (instance: string, state: string): Scalar => {
      const k = owner(key(instance, state));
      const cut = k.indexOf('\u0000');
      const inst = instances.get(k.slice(0, cut));
      const name = k.slice(cut + 1);
      if (inst !== undefined && inst.args.has(name)) return inst.args.get(name) as Scalar;
      if (!values.has(k)) throw new Error(`no value for ${k}`);
      return values.get(k) as Scalar;
    };
    const holds = (c: Condition, inst: Inst): boolean => {
      if (c.kind === 'true') return true;
      if (c.kind === 'eq') return read(c.ref.instance === '.' ? inst.path : c.ref.instance, c.ref.state) === c.value;
      if (c.kind === 'not') return !holds(c.value, inst);
      return c.kind === 'and' ? c.values.every((v) => holds(v, inst)) : c.values.some((v) => holds(v, inst));
    };
    const pick = <V>(choice: readonly { when: Condition; value: V }[], inst: Inst): V => {
      const hits = choice.filter((a) => holds(a.when, inst));
      if (hits.length !== 1) throw new Error(`${hits.length} choice arms hold`);
      return (hits[0] as { value: V }).value;
    };
    const rel = (path: string): string => (path === doc.id ? '' : path.slice(doc.id.length + 1));
    const head = classes.kind === 'authored'
      ? authoredCss.map((css) => `<style>${css}</style>`).join('')
      : `<style>${classes.css}</style>`;
    // Each tree text node is written as its own DOM text node, text byte for byte: the HTML parser would merge adjacent text,
    // so an empty comment (no box, no layout effect) separates text that follows text in the same parent.
    type Part = { readonly text: boolean; readonly html: string };
    const join = (parts: readonly Part[]): string => parts.map((p, i) => (p.text && i > 0 && (parts[i - 1] as Part).text ? `<!---->${p.html}` : p.html)).join('');
    const out = (nodes: readonly TreeNode[], inst: Inst): Part[] => nodes.flatMap((n): Part[] => {
      switch (n.kind) {
        case 'text':
          return [{ text: true, html: escText(n.text) }];
        case 'call':
          return out((instances.get(`${inst.path}/${n.id}`) as Inst).component.root, instances.get(`${inst.path}/${n.id}`) as Inst);
        case 'projection': {
          const slot = inst.slots.get(n.slot);
          return slot === undefined ? [] : out(slot.children, slot.caller);
        }
        case 'branch':
          return out(holds(n.when, inst) ? n.then : n.else, inst);
        case 'element': {
          const address = rel(inst.path) === '' ? n.id : `${rel(inst.path)}/${n.id}`;
          let cls: string;
          if (classes.kind === 'authored') {
            cls = n.classes.map((b) => pick(b.value, inst)).filter((s) => s !== null).map((s) => scopedToken(s.owner, s.sheet, s.name)).join(' ');
          } else {
            const c = classes.classOf.get(address);
            if (c === undefined) throw new Error(`no compiled class for ${address}`);
            cls = c;
          }
          const attrs = n.attributes.map((a) => [a.name, pick(a.value, inst)] as const).filter((a): a is readonly [string, string] => a[1] !== null);
          const open = `<${n.tag} data-dragon-id="${escAttr(address)}"${cls === '' ? '' : ` class="${escAttr(cls)}"`}${attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')}>`;
          const inner = n.tag === 'html' ? `<head>${head}</head>${join(out(n.children, inst))}` : join(out(n.children, inst));
          return [{ text: false, html: `${open}${inner}</${n.tag}>` }];
        }
      }
    });
    return `<!DOCTYPE html>\n${join(out(comp(doc.rootInstance).root, instances.get(doc.id) as Inst))}\n`;
  };
  return { free, assignments, initialIndex, render };
}
