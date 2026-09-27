// Linking (docs/api.md §3.1-3.2): expands the document's component calls into instances, substitutes state aliases,
// enumerates every reachable assignment of the free states, and builds the logical element tree of each case.
// Nothing is deduplicated or truncated: a state space above MAX_STATE_ASSIGNMENTS blocks with a typed diagnostic.
import { diagnostic } from '../diagnostics/catalogue.ts';
import type {
  Assignment,
  CallNode,
  ClassSymbol,
  ComponentDefinition,
  Condition,
  Diagnostic,
  ElementNode,
  Origin,
  Scalar,
  TextNode,
  TreeNode,
} from '../types.ts';
import type { ValidInput } from './input.ts';
import { inDomain, scalarKey } from './input.ts';

/** The largest number of reachable assignments one document may have; above it the compile blocks, never truncates. */
export const MAX_STATE_ASSIGNMENTS = 1024;

export type Instance = {
  /** Absolute instance path: the document id, then call-site ids ("doc/a"). */
  readonly path: string;
  readonly component: ComponentDefinition;
  readonly parent: Instance | null;
  readonly call: CallNode | null;
  /** Slot contents supplied by the call, built in the caller's instance so they keep the caller's owner. */
  readonly slots: ReadonlyMap<string, { readonly children: readonly TreeNode[]; readonly caller: Instance }>;
};

export type StateVar = {
  readonly key: string;
  readonly instance: string;
  readonly state: string;
  readonly kind: 'state' | 'param';
  readonly domain: readonly Scalar[];
  readonly initial: Scalar;
  readonly origin: Origin;
};

export type LinkedElement = {
  readonly kind: 'element';
  /** Instance-path node address: call-site ids then the template node id ("a/trigger"); root-instance nodes use their id. */
  readonly address: string;
  readonly node: ElementNode;
  readonly instance: string;
  /** The component whose template authored this element. */
  readonly owner: string;
  readonly tag: string;
  readonly classes: readonly ClassSymbol[];
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly (LinkedElement | LinkedText)[];
};

/**
 * Literal text in the logical tree. address: "<insertion parent>:text<k>" (k counts text that is not whitespace-only), or
 * "<insertion parent>:space<k>" for whitespace-only text (k counts those), so no text node shares an address (MF4).
 * owner and instance are the authoring component and instance: projected text keeps its caller's (docs/api.md §3.1).
 */
export type LinkedText = {
  readonly kind: 'text';
  readonly address: string;
  readonly node: TextNode;
  readonly instance: string;
  readonly owner: string;
  readonly text: string;
};

export type CaseTree = {
  /** Canonical key of the assignment: typed values, so true, "true" and 1 differ. */
  readonly key: string;
  readonly assignment: Assignment;
  readonly isInitial: boolean;
  readonly root: LinkedElement;
};

export type Linked = {
  readonly documentId: string;
  readonly instances: ReadonlyMap<string, Instance>;
  readonly free: readonly StateVar[];
  readonly initial: ReadonlyMap<string, Scalar>;
  readonly cases: readonly CaseTree[];
};

export type LinkOptions = {
  /** Fault switch: this element address evaluates its classes and attributes at the initial assignment. */
  readonly stateCollapse: string | null;
};

const varKey = (instance: string, state: string): string => `${instance}\u0000${state}`;

/** The canonical key of an assignment over absolute state references. */
export function assignmentKey(assignment: Assignment): string {
  const entries = assignment.map((a) => [a.state.instance, a.state.state, scalarKey(a.value)] as const);
  entries.sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) : x[0] < y[0] ? -1 : 1));
  return JSON.stringify(entries);
}

export function linkDocument(valid: ValidInput, options: LinkOptions, diagnostics: Diagnostic[]): Linked | null {
  const docId = valid.document.id;
  const instances = new Map<string, Instance>();
  let ok = true;

  // Instances in preorder; a component already on the call stack is a cycle.
  const expand = (inst: Instance, stack: readonly string[]): void => {
    instances.set(inst.path, inst);
    const visit = (nodes: readonly TreeNode[]): void => {
      for (const n of nodes) {
        if (n.kind === 'element') visit(n.children);
        else if (n.kind === 'branch') {
          visit(n.then);
          visit(n.else);
        } else if (n.kind === 'call') {
          visit(n.slots.flatMap((s) => s.children));
          const callee = valid.components.get(n.component) as ComponentDefinition;
          if (stack.includes(callee.id)) {
            ok = false;
            diagnostics.push(diagnostic('DRAGON_CALL_CYCLE', { origin: n.origin, message: `${inst.component.id}/${n.id} calls ${callee.id}, which is already on the call path ${[...stack, callee.id].join(' -> ')}` }));
            continue;
          }
          const slots = new Map(n.slots.map((s) => [s.name, { children: s.children, caller: inst }]));
          expand({ path: `${inst.path}/${n.id}`, component: callee, parent: inst, call: n, slots }, [...stack, callee.id]);
        }
      }
    };
    visit(inst.component.root);
  };
  expand({ path: docId, component: valid.rootComponent, parent: null, call: null, slots: new Map() }, [valid.rootComponent.id]);
  if (!ok) return null;

  const vars = new Map<string, StateVar>();
  const params = new Map<string, Scalar>();
  const order: StateVar[] = [];
  for (const inst of instances.values()) {
    for (const p of inst.component.params) {
      const arg = inst.call === null ? undefined : inst.call.args.find((a) => a.param === p.id);
      const value = arg === undefined ? null : arg.value;
      const v: StateVar = { key: varKey(inst.path, p.id), instance: inst.path, state: p.id, kind: 'param', domain: [value], initial: value, origin: p.origin };
      vars.set(v.key, v);
      params.set(v.key, value);
    }
    for (const s of inst.component.states) {
      const v: StateVar = { key: varKey(inst.path, s.id), instance: inst.path, state: s.id, kind: 'state', domain: s.domain, initial: s.initial, origin: s.origin };
      vars.set(v.key, v);
      order.push(v);
    }
  }

  // Aliases substitute the caller's state for the callee's local state; every caller value must be a local value.
  const aliasOf = new Map<string, string>();
  for (const inst of instances.values()) {
    if (inst.call === null || inst.parent === null) continue;
    for (const al of inst.call.aliases) {
      const localKey = varKey(inst.path, al.local.state);
      const callerPath = al.caller.instance === '.' ? inst.parent.path : al.caller.instance;
      const callerVar = vars.get(varKey(callerPath, al.caller.state));
      const localVar = vars.get(localKey) as StateVar;
      if (callerVar === undefined) {
        ok = false;
        diagnostics.push(diagnostic('DRAGON_STATE_UNKNOWN', { origin: inst.call.origin, message: `${inst.path}.${al.local.state} is aliased to ${callerPath}.${al.caller.state}, which does not exist` }));
        continue;
      }
      const outside = callerVar.domain.filter((v) => !inDomain(localVar.domain, v));
      if (outside.length > 0) {
        ok = false;
        diagnostics.push(diagnostic('DRAGON_ALIAS_DOMAIN', {
          origin: inst.call.origin,
          message: `${inst.path}.${al.local.state} (domain ${JSON.stringify(localVar.domain)}) cannot be controlled by ${callerPath}.${al.caller.state} (domain ${JSON.stringify(callerVar.domain)}): ${outside.map((v) => JSON.stringify(v)).join(', ')} ${outside.length === 1 ? 'is' : 'are'} not local values`,
          related: [{ origin: localVar.origin, message: 'local state' }, { origin: callerVar.origin, message: 'caller state' }],
        }));
        continue;
      }
      aliasOf.set(localKey, callerVar.key);
    }
  }
  const reported = new Set<string>();
  for (const start of aliasOf.keys()) {
    const seen: string[] = [];
    let k: string | undefined = start;
    while (k !== undefined && !seen.includes(k)) {
      seen.push(k);
      k = aliasOf.get(k);
    }
    if (k !== undefined) {
      const cycle = seen.slice(seen.indexOf(k));
      const id = [...cycle].sort().join('|');
      if (!reported.has(id)) {
        reported.add(id);
        ok = false;
        const v = vars.get(k) as StateVar;
        const call = (instances.get(v.instance) as Instance).call;
        diagnostics.push(diagnostic('DRAGON_ALIAS_CYCLE', {
          origin: call === null ? v.origin : call.origin,
          message: `state aliases form a cycle: ${cycle.map((c) => c.replace('\u0000', '.')).join(' -> ')} -> ${k.replace('\u0000', '.')}`,
          related: [{ origin: v.origin, message: `${v.instance}.${v.state} is declared here` }],
        }));
      }
    }
  }
  if (!ok) return null;
  const rootOf = (key: string): string => {
    let k = key;
    for (let next = aliasOf.get(k); next !== undefined; next = aliasOf.get(k)) k = next;
    return k;
  };

  const free = order.filter((v) => !aliasOf.has(v.key));
  const initial = new Map<string, Scalar>(free.map((v) => [v.key, v.initial]));
  const explicit = new Map<string, { value: Scalar; state: string }>();
  for (const entry of valid.document.initial) {
    const v = vars.get(varKey(entry.state.instance, entry.state.state));
    const origin = valid.rootComponent.origin;
    if (v === undefined || v.kind !== 'state') {
      ok = false;
      diagnostics.push(diagnostic('DRAGON_STATE_UNKNOWN', { origin, message: `document ${docId} assigns ${entry.state.instance}.${entry.state.state}, which is not a state of that instance` }));
      continue;
    }
    const root = vars.get(rootOf(v.key)) as StateVar;
    if (!inDomain(v.domain, entry.value) || !inDomain(root.domain, entry.value)) {
      ok = false;
      diagnostics.push(diagnostic('DRAGON_STATE_VALUE_DOMAIN', {
        origin,
        message: `document ${docId} assigns ${JSON.stringify(entry.value)} to ${v.instance}.${v.state}, outside its domain ${JSON.stringify(root.kind === 'param' ? v.domain : root.domain)}`,
      }));
      continue;
    }
    const prior = explicit.get(root.key);
    if (root.kind === 'param' ? root.initial !== entry.value : prior !== undefined && prior.value !== entry.value) {
      ok = false;
      diagnostics.push(diagnostic('DRAGON_INITIAL_CONFLICT', {
        origin,
        message: `${v.instance}.${v.state} = ${JSON.stringify(entry.value)} conflicts with ${prior === undefined ? `the argument ${JSON.stringify(root.initial)}` : `${prior.state} = ${JSON.stringify(prior.value)}`}; both reach ${root.instance}.${root.state}`,
      }));
      continue;
    }
    explicit.set(root.key, { value: entry.value, state: `${v.instance}.${v.state}` });
    if (root.kind === 'state') initial.set(root.key, entry.value);
  }
  if (!ok) return null;

  let count = 1;
  for (const v of free) count *= v.domain.length;
  if (count > MAX_STATE_ASSIGNMENTS) {
    diagnostics.push(diagnostic('DRAGON_STATE_SPACE_LIMIT', {
      origin: valid.rootComponent.origin,
      message: `document ${docId} has ${count} reachable assignments over ${free.length} free states, above the limit of ${MAX_STATE_ASSIGNMENTS}`,
    }));
    return null;
  }

  // Odometer over the free states in instance preorder; the first state varies slowest.
  const assignments: Map<string, Scalar>[] = [];
  const cursor = free.map(() => 0);
  for (let n = 0; n < count; n++) {
    assignments.push(new Map(free.map((v, i) => [v.key, v.domain[cursor[i] as number] as Scalar])));
    for (let i = free.length - 1; i >= 0; i--) {
      const next = (cursor[i] as number) + 1;
      if (next < (free[i] as StateVar).domain.length) {
        cursor[i] = next;
        break;
      }
      cursor[i] = 0;
    }
  }

  const rel = (path: string): string => (path === docId ? '' : path.slice(docId.length + 1));
  const addressOf = (inst: Instance, id: string): string => (rel(inst.path) === '' ? id : `${rel(inst.path)}/${id}`);
  const choiceReported = new Set<string>();
  const cases: CaseTree[] = [];
  for (const values of assignments) {
    const read = (ref: { instance: string; state: string }, inst: Instance, at: ReadonlyMap<string, Scalar>): Scalar => {
      const path = ref.instance === '.' ? inst.path : ref.instance;
      const k = rootOf(varKey(path, ref.state));
      const p = params.get(k);
      if (p !== undefined || params.has(k)) return p as Scalar;
      const v = at.get(k);
      if (v === undefined && !at.has(k)) throw new Error(`unassigned state ${k}`);
      return v as Scalar;
    };
    const holds = (c: Condition, inst: Instance, at: ReadonlyMap<string, Scalar>): boolean => {
      switch (c.kind) {
        case 'true':
          return true;
        case 'eq':
          return read(c.ref, inst, at) === c.value;
        case 'not':
          return !holds(c.value, inst, at);
        case 'and':
          return c.values.every((v) => holds(v, inst, at));
        case 'or':
          return c.values.some((v) => holds(v, inst, at));
      }
    };
    const describe = (): string => free.map((v) => `${v.instance}.${v.state}=${JSON.stringify(values.get(v.key))}`).join(', ');
    const choose = <V>(choice: readonly { when: Condition; value: V }[], inst: Instance, at: ReadonlyMap<string, Scalar>, origin: Origin, what: string): V | null => {
      const hits = choice.filter((arm) => holds(arm.when, inst, at));
      if (hits.length === 1) return (hits[0] as { value: V }).value;
      const code = hits.length === 0 ? 'DRAGON_CHOICE_MISSING' : 'DRAGON_CHOICE_OVERLAP';
      const id = `${code}|${inst.path}|${what}`;
      if (!choiceReported.has(id)) {
        choiceReported.add(id);
        diagnostics.push(diagnostic(code, {
          origin,
          message: `${what} in ${inst.path}: ${hits.length === 0 ? 'no arm holds' : `${hits.length} arms hold`} for the reachable assignment ${describe() || '(no states)'}`,
        }));
      }
      return null;
    };
    const build = (nodes: readonly TreeNode[], inst: Instance): (LinkedElement | LinkedText)[] => {
      const out: (LinkedElement | LinkedText)[] = [];
      for (const n of nodes) {
        switch (n.kind) {
          case 'element': {
            const address = addressOf(inst, n.id);
            const at = options.stateCollapse === address ? initial : values;
            const classes: ClassSymbol[] = [];
            n.classes.forEach((b, i) => {
              const sym = choose(b.value, inst, at, b.origin, `class binding ${i} of ${n.id}`);
              if (sym !== null) classes.push(sym);
            });
            const attributes = new Map<string, string>();
            for (const a of n.attributes) {
              const v = choose(a.value, inst, at, a.origin, `attribute ${a.name} of ${n.id}`);
              if (v !== null) attributes.set(a.name, v);
            }
            const children = numberTexts(address, build(n.children, inst));
            out.push({ kind: 'element', address, node: n, instance: inst.path, owner: inst.component.id, tag: n.tag, classes, attributes, children });
            break;
          }
          case 'text':
            out.push({ kind: 'text', address: '', node: n, instance: inst.path, owner: inst.component.id, text: n.text });
            break;
          case 'call':
            out.push(...build((instances.get(`${inst.path}/${n.id}`) as Instance).component.root, instances.get(`${inst.path}/${n.id}`) as Instance));
            break;
          case 'projection': {
            const slot = inst.slots.get(n.slot);
            if (slot !== undefined) out.push(...build(slot.children, slot.caller));
            break;
          }
          case 'branch':
            out.push(...build(holds(n.when, inst, values) ? n.then : n.else, inst));
            break;
        }
      }
      return out;
    };
    const root = numberTexts('', build(valid.rootComponent.root, instances.get(docId) as Instance))[0] as LinkedElement;
    const assignment: Assignment = free.map((v) => ({ state: { instance: v.instance, state: v.state }, value: values.get(v.key) as Scalar }));
    cases.push({ key: assignmentKey(assignment), assignment, isInitial: free.every((v) => values.get(v.key) === initial.get(v.key)), root });
  }
  if (choiceReported.size > 0) return null;
  return { documentId: docId, instances, free, initial, cases };
}

const BLANK = /^[ \t\n\r\f]*$/;

/** Text children are addressed "<element address>:text<k>", and whitespace-only text "<element address>:space<k>". */
function numberTexts(parent: string, children: (LinkedElement | LinkedText)[]): (LinkedElement | LinkedText)[] {
  let k = 0;
  let blank = 0;
  return children.map((c) => (c.kind !== 'text' ? c : { ...c, address: BLANK.test(c.text) ? `${parent}:space${blank++}` : `${parent}:text${k++}` }));
}
