// Structural validation of the FrontEndResult and the milestone-1 dragon/tree@0 subset (docs/api.md §2.1, §3.1-3.4, §10):
// schema, source hashes and spans, unique ids, references, domains, conditions and per-template ownership. Linking,
// aliases and reachability are checked in link.ts.
import { sha256Hex, sha256HexBytes } from '../digest.ts';
import { authored, diagnostic, unlocated } from '../diagnostics/catalogue.ts';
import type {
  CallNode,
  ComponentDefinition,
  Diagnostic,
  DocumentEntry,
  DraftTree,
  ElementNode,
  FrontEndResult,
  Origin,
  Scalar,
  SourceFile,
  Span,
  StyleUse,
  TreeNode,
} from '../types.ts';

export const TREE_SCHEMA_REVISION = '0.2';

export type ValidInput = {
  readonly tree: DraftTree;
  readonly document: DocumentEntry;
  readonly rootComponent: ComponentDefinition;
  readonly components: ReadonlyMap<string, ComponentDefinition>;
  readonly styles: ReadonlyMap<string, StyleUse>;
  readonly sources: ReadonlyMap<string, SourceFile>;
  /** The owner of each style use's class symbols: the component, or the document id for document-scoped uses. */
  readonly styleOwner: ReadonlyMap<string, string>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function exactKeys<T>(v: T, keys: readonly string[], optional: readonly string[] = []): v is T & Record<string, unknown> {
  if (!isRecord(v)) return false;
  for (const k of keys) if (!(k in v)) return false;
  for (const k of Object.keys(v)) if (!keys.includes(k) && !optional.includes(k)) return false;
  return true;
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** docs/api.md §3.2: typed JSON scalars; NaN, Infinity and -0 have no stable identity. */
export function isScalar(v: unknown): v is Scalar {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  return typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0);
}

/** Identity by type plus value: true, "true" and 1 have different keys. */
export function scalarKey(v: Scalar): string {
  return JSON.stringify(v);
}

export function inDomain(domain: readonly Scalar[], v: Scalar): boolean {
  return domain.some((d) => d === v);
}

function describeScalar(v: unknown): string {
  if (typeof v === 'number' && Object.is(v, -0)) return '-0';
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v) ?? String(v);
}

/** Returns the validated input, or null after pushing blocking diagnostics. */
export function validateInput(input: FrontEndResult, projectId: string, diagnostics: Diagnostic[]): ValidInput | null {
  let ok = true;
  const invalid = (message: string, origin: Origin = unlocated('malformed input')): void => {
    ok = false;
    diagnostics.push(diagnostic('DRAGON_INPUT_INVALID', { origin, message }));
  };
  const raw: unknown = input;
  if (!exactKeys(raw, ['producer', 'snapshot', 'diagnostics', 'tree', 'completeness'])) {
    invalid('FrontEndResult must have exactly producer, snapshot, diagnostics, tree and completeness');
    return null;
  }
  const snap: unknown = input.snapshot;
  if (!exactKeys(snap, ['projectId', 'revision', 'sources', 'assets', 'resolutions']) || !Array.isArray(input.snapshot.sources)) {
    invalid('snapshot must have exactly projectId, revision, sources, assets and resolutions');
    return null;
  }
  if (input.snapshot.projectId !== projectId) {
    invalid(`snapshot.projectId "${input.snapshot.projectId}" does not match the project "${projectId}"`);
    return null;
  }
  const sources = new Map<string, SourceFile>();
  let sourcesOk = true;
  for (const s of input.snapshot.sources) {
    if (!exactKeys(s, ['ref', 'text', 'displayPath'], ['virtualOf']) || !exactKeys(s.ref, ['uri', 'revision', 'hash']) || !isString(s.text)) {
      invalid('each source needs exactly ref {uri, revision, hash}, text and displayPath');
      return null;
    }
    if (sources.has(s.ref.uri)) {
      diagnostics.push(diagnostic('DRAGON_TREE_DUPLICATE_ID', { origin: unlocated(`source ${s.ref.uri}`), message: `source ${s.ref.uri} appears twice in the snapshot` }));
      sourcesOk = false;
    }
    const expected = `sha256:${sha256Hex(s.text)}`;
    if (s.ref.hash !== expected) {
      diagnostics.push(diagnostic('DRAGON_SOURCE_HASH_MISMATCH', {
        origin: unlocated(`source ${s.ref.uri}`),
        message: `hash of ${s.ref.uri} is ${expected}, not ${s.ref.hash}`,
        manual: `Pass hash "${expected}" for the supplied text, or supply the text the hash was computed from.`,
      }));
      sourcesOk = false;
    }
    sources.set(s.ref.uri, s);
  }
  // docs/api.md §10.1: every asset matches its hash, and every resolution names a source or asset in the snapshot.
  const missing = (reason: string, message: string): void => {
    diagnostics.push(diagnostic('DRAGON_MISSING_ASSET', { origin: unlocated(reason), message }));
  };
  let snapshotOk = true;
  const assets = new Set<string>();
  if (!Array.isArray(input.snapshot.assets) || !Array.isArray(input.snapshot.resolutions)) {
    invalid('snapshot assets and resolutions must be lists');
    return null;
  }
  for (const a of input.snapshot.assets) {
    if (!exactKeys(a, ['id', 'hash', 'bytes']) || !isString(a.id) || !isString(a.hash) || !(a.bytes instanceof Uint8Array)) {
      invalid('each asset needs exactly id, hash and bytes (a Uint8Array)');
      return null;
    }
    if (assets.has(a.id)) {
      diagnostics.push(diagnostic('DRAGON_TREE_DUPLICATE_ID', { origin: unlocated(`asset ${a.id}`), message: `asset ${a.id} appears twice in the snapshot` }));
      snapshotOk = false;
    }
    assets.add(a.id);
    const expected = `sha256:${sha256HexBytes(a.bytes)}`;
    if (a.hash !== expected) {
      missing(`asset ${a.id}`, `the bytes of asset ${a.id} hash to ${expected}, not ${a.hash}`);
      snapshotOk = false;
    }
  }
  for (const r of input.snapshot.resolutions) {
    if (!exactKeys(r, ['from', 'specifier', 'kind', 'to']) || !exactKeys(r.from, ['uri', 'revision', 'hash']) || !isString(r.specifier)
      || !['source', 'css', 'asset'].includes(String(r.kind)) || !(r.to === null || isString(r.to))) {
      invalid('each resolution needs exactly from {uri, revision, hash}, specifier, kind (source, css or asset) and to (a string or null)');
      return null;
    }
    const what = `resolution of "${r.specifier}" from ${r.from.uri}`;
    if (!sources.has(r.from.uri)) {
      missing(what, `the ${what} starts in a source that is not in the snapshot`);
      snapshotOk = false;
    }
    if (r.to === null) {
      missing(what, `the ${what} is unresolved (to is null)`);
      snapshotOk = false;
    } else if (r.kind === 'asset' ? !assets.has(r.to) : !sources.has(r.to)) {
      missing(what, `the ${what} names ${r.kind === 'asset' ? 'asset' : 'source'} ${r.to}, which is not in the snapshot`);
      snapshotOk = false;
    }
  }
  const checkSpan = (span: unknown, what: string): boolean => {
    const ok = exactKeys(span, ['source', 'start', 'end']) && exactKeys(span['source'], ['uri', 'revision', 'hash']);
    const sp = span as Span;
    const src = ok ? sources.get(sp.source.uri) : undefined;
    const inside = src !== undefined && src.ref.hash === sp.source.hash && src.ref.revision === sp.source.revision
      && Number.isInteger(sp.start) && Number.isInteger(sp.end) && sp.start >= 0 && sp.start <= sp.end && sp.end <= src.text.length;
    if (!inside) {
      diagnostics.push(diagnostic('DRAGON_SPAN_INVALID', {
        origin: unlocated(what),
        message: ok ? `${what} points at ${sp.source.uri} ${sp.start}-${sp.end}, outside its source snapshot` : `${what} has a malformed span`,
      }));
    }
    return inside;
  };
  const checkOrigin = (o: unknown, what: string): boolean => {
    if (!isRecord(o)) {
      invalid(`${what} has no origin`);
      return false;
    }
    switch (o['kind']) {
      case 'authored':
        return exactKeys(o, ['kind', 'span']) && checkSpan(o['span'], what);
      case 'inherited':
        return exactKeys(o, ['kind', 'element', 'from']) && checkOrigin(o['from'], what);
      case 'builtin':
        return exactKeys(o, ['kind', 'dataset', 'entry']);
      case 'generated':
        return exactKeys(o, ['kind', 'pass', 'causes']) && Array.isArray(o['causes']) && o['causes'].every((c) => checkOrigin(c, what));
      case 'unlocated':
        return exactKeys(o, ['kind', 'reason']);
      default:
        invalid(`${what} has an unknown origin kind`);
        return false;
    }
  };
  const originOr = (o: unknown, reason: string): Origin => {
    if (isRecord(o) && o['kind'] === 'authored' && exactKeys(o, ['kind', 'span'])) {
      const sp = o['span'] as Span;
      const src = isRecord(sp) && isRecord(sp.source) ? sources.get(sp.source.uri) : undefined;
      if (src !== undefined && src.ref.hash === sp.source.hash && sp.start >= 0 && sp.end <= src.text.length && sp.start <= sp.end) return o as Origin;
    }
    return unlocated(reason);
  };
  if (!Array.isArray(input.diagnostics)) {
    invalid('diagnostics must be a list');
    return null;
  }
  for (const d of input.diagnostics) {
    if (!isRecord(d) || !isString(d['code']) || !isString(d['message']) || !['error', 'warning', 'info'].includes(String(d['severity']))) {
      invalid('each producer diagnostic needs a code, a severity and a message');
      continue;
    }
    if (d['severity'] !== 'error') continue;
    const origin = originOr(d['origin'], `producer ${input.producer.name}`);
    diagnostics.push(diagnostic('DRAGON_PRODUCER_ERROR', {
      origin,
      message: `${input.producer.name} reported ${d['code']}: ${d['message']}`,
      related: [{ origin, message: `${d['code']}: ${d['message']}` }],
    }));
  }
  if (input.completeness !== 'closed-application') {
    diagnostics.push(diagnostic('DRAGON_INCOMPLETE_INPUT', { origin: unlocated('completeness'), message: `completeness "${input.completeness}" cannot produce application outputs` }));
  }
  if (input.tree === null) {
    diagnostics.push(diagnostic('DRAGON_INCOMPLETE_INPUT', { origin: unlocated('tree'), message: 'the producer supplied no element tree', manual: 'Fix the producer errors so it can supply a tree.' }));
    return null;
  }
  const tree = input.tree;
  if (!exactKeys(tree, ['schema', 'schemaRevision', 'modules', 'components', 'documents', 'styles'])
    || tree.schema !== 'dragon/tree@0' || tree.schemaRevision !== TREE_SCHEMA_REVISION) {
    diagnostics.push(diagnostic('DRAGON_TREE_SCHEMA', {
      origin: unlocated('tree schema'),
      message: `tree must be dragon/tree@0 revision ${TREE_SCHEMA_REVISION}`,
      manual: `Emit schema "dragon/tree@0" with schemaRevision "${TREE_SCHEMA_REVISION}".`,
    }));
    return null;
  }
  if (!Array.isArray(tree.modules) || !Array.isArray(tree.components) || !Array.isArray(tree.documents) || !Array.isArray(tree.styles)) {
    invalid('tree modules, components, documents and styles must be lists');
    return null;
  }
  if (!sourcesOk || !snapshotOk) ok = false;
  const refError = (origin: Origin, message: string): void => {
    ok = false;
    diagnostics.push(diagnostic('DRAGON_TREE_REFERENCE', { origin, message }));
  };
  const duplicate = (origin: Origin, message: string): void => {
    ok = false;
    diagnostics.push(diagnostic('DRAGON_TREE_DUPLICATE_ID', { origin, message }));
  };

  const modules = new Set<string>();
  for (const m of tree.modules) {
    if (!exactKeys(m, ['id', 'source']) || !isString(m.id) || !isString(m.source)) {
      invalid('each module needs exactly id and source');
      return null;
    }
    if (modules.has(m.id)) duplicate(unlocated(`module ${m.id}`), `module id ${m.id} is declared twice`);
    modules.add(m.id);
    if (!sources.has(m.source)) refError(unlocated(`module ${m.id}`), `module ${m.id} names source ${m.source}, which is not in the snapshot`);
  }

  const components = new Map<string, ComponentDefinition>();
  for (const c of tree.components) {
    if (!exactKeys(c, ['id', 'module', 'params', 'states', 'slots', 'root', 'origin']) || !isString(c.id) || !Array.isArray(c.params) || !Array.isArray(c.states) || !Array.isArray(c.slots) || !Array.isArray(c.root)) {
      invalid('each component needs exactly id, module, params, states, slots, root and origin');
      return null;
    }
    if (components.has(c.id)) duplicate(originOr(c.origin, `component ${c.id}`), `component id ${c.id} is declared twice`);
    components.set(c.id, c);
  }

  const document = tree.documents[0];
  if (tree.documents.length !== 1 || document === undefined) {
    diagnostics.push(diagnostic('DRAGON_TREE_UNSUPPORTED', { origin: unlocated('documents'), message: 'milestone 1 compiles exactly one document entry per project', manual: 'Split the input into one document per compile.' }));
    return null;
  }
  if (!exactKeys(document, ['id', 'rootInstance', 'documentElement', 'styles', 'initial']) || !isString(document.id) || !Array.isArray(document.styles) || !Array.isArray(document.initial)) {
    invalid('document entries need exactly id, rootInstance, documentElement, styles and initial');
    return null;
  }
  if (document.id.includes('/') || document.id.length === 0) invalid(`document id "${document.id}" must be non-empty and contain no "/"`);

  const styles = new Map<string, StyleUse>();
  const styleOwner = new Map<string, string>();
  for (const s of tree.styles) {
    if (!exactKeys(s, ['id', 'css', 'scope']) || !isString(s.id) || !isRecord(s.scope)) {
      invalid('each style use needs exactly id, css and scope');
      return null;
    }
    if (styles.has(s.id)) duplicate(unlocated(`style use ${s.id}`), `style use id ${s.id} is declared twice`);
    styles.set(s.id, s);
    const cssSource = isRecord(s.css) && isRecord(s.css.source) ? s.css.source.uri : undefined;
    if (isString(cssSource) && !sources.has(cssSource)) {
      missing(`style use ${s.id}`, `style use ${s.id} names source ${cssSource}, which is not in the snapshot`);
      ok = false;
    } else if (!checkSpan(s.css, `style use ${s.id}`)) ok = false;
    if (s.scope.kind === 'component') {
      if (!exactKeys(s.scope, ['kind', 'owner']) || !components.has(s.scope.owner)) refError(unlocated(`style use ${s.id}`), `style use ${s.id} is owned by unknown component ${String((s.scope as { owner?: unknown }).owner)}`);
      else styleOwner.set(s.id, s.scope.owner);
    } else if (s.scope.kind === 'document' && exactKeys(s.scope, ['kind'])) {
      styleOwner.set(s.id, document.id);
    } else {
      invalid(`style use ${s.id} has an unknown scope`);
      ok = false;
    }
  }
  for (const id of document.styles) {
    if (!styles.has(id)) refError(unlocated(`document ${document.id}`), `document ${document.id} names unknown style use ${id}`);
  }
  if (new Set(document.styles).size !== document.styles.length) duplicate(unlocated(`document ${document.id}`), `document ${document.id} lists a style use twice`);

  // Per component: parameters, states, slots, then the template with its conditions, bindings, calls and projections.
  for (const c of components.values()) {
    if (!checkOrigin(c.origin, `component ${c.id}`)) ok = false;
    if (!modules.has(c.module)) refError(originOr(c.origin, `component ${c.id}`), `component ${c.id} names unknown module ${c.module}`);
    const vars = new Map<string, readonly Scalar[]>();
    const stateIds = new Set<string>();
    const declareVar = (v: unknown, kind: 'param' | 'state'): void => {
      const keys = kind === 'param' ? ['id', 'domain', 'origin'] : ['id', 'domain', 'initial', 'origin'];
      if (!exactKeys(v, keys) || !isString(v['id'])) {
        invalid(`component ${c.id}: each ${kind} needs exactly ${keys.join(', ')}`);
        ok = false;
        return;
      }
      const id = v['id'];
      const origin = originOr(v['origin'], `${kind} ${c.id}.${id}`);
      if (!checkOrigin(v['origin'], `${kind} ${c.id}.${id}`)) ok = false;
      if (vars.has(id)) duplicate(origin, `${c.id} declares ${id} twice`);
      const domain = v['domain'];
      if (!Array.isArray(domain) || domain.length === 0 || !domain.every(isScalar) || new Set(domain.map((d) => scalarKey(d as Scalar))).size !== domain.length) {
        ok = false;
        const bad = Array.isArray(domain) ? domain.filter((d) => !isScalar(d)).map(describeScalar) : [];
        diagnostics.push(diagnostic('DRAGON_STATE_DOMAIN_INVALID', {
          origin,
          message: `${c.id}.${id} has an invalid domain${bad.length > 0 ? ` (${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a finite JSON scalar)` : Array.isArray(domain) && domain.length === 0 ? ' (empty)' : ' (duplicate values or not a list)'}`,
        }));
        vars.set(id, []);
        return;
      }
      vars.set(id, domain as Scalar[]);
      if (kind === 'state') {
        stateIds.add(id);
        if (!isScalar(v['initial']) || !inDomain(domain as Scalar[], v['initial'])) {
          ok = false;
          diagnostics.push(diagnostic('DRAGON_STATE_VALUE_DOMAIN', { origin, message: `initial value ${describeScalar(v['initial'])} of ${c.id}.${id} is not in its domain ${JSON.stringify(domain)}` }));
        }
      }
    };
    for (const p of c.params) declareVar(p, 'param');
    for (const s of c.states) declareVar(s, 'state');
    const slotNames = new Set<string>();
    for (const s of c.slots) {
      if (!exactKeys(s, ['name', 'origin']) || !isString(s.name)) {
        invalid(`component ${c.id}: each slot needs exactly name and origin`);
        ok = false;
        continue;
      }
      if (!checkOrigin(s.origin, `slot ${c.id}.${s.name}`)) ok = false;
      if (slotNames.has(s.name)) duplicate(originOr(s.origin, `slot ${c.id}.${s.name}`), `${c.id} declares slot ${s.name} twice`);
      slotNames.add(s.name);
    }
    const nodeIds = new Set<string>();
    const projected = new Map<string, number>();

    // Conditions in this template read "." (this instance) states and parameters, compared by type plus value.
    const checkCondition = (cond: unknown, where: Origin): boolean => {
      if (!isRecord(cond)) {
        invalid(`${c.id}: malformed condition`, where);
        return false;
      }
      switch (cond['kind']) {
        case 'true':
          return exactKeys(cond, ['kind']) || (invalid(`${c.id}: malformed condition`, where), false);
        case 'eq': {
          if (!exactKeys(cond, ['kind', 'ref', 'value']) || !exactKeys(cond['ref'], ['instance', 'state'])) {
            invalid(`${c.id}: malformed eq condition`, where);
            return false;
          }
          const ref = cond['ref'] as { instance: unknown; state: unknown };
          const domain = ref.instance === '.' && isString(ref.state) ? vars.get(ref.state) : undefined;
          if (domain === undefined) {
            ok = false;
            diagnostics.push(diagnostic('DRAGON_STATE_UNKNOWN', {
              origin: where,
              message: `${c.id} reads ${JSON.stringify(ref)}, which is not a state or parameter of this instance`,
              manual: `Use { instance: ".", state } with one of: ${[...vars.keys()].join(', ') || '(none declared)'}.`,
            }));
            return false;
          }
          if (!isScalar(cond['value']) || (domain.length > 0 && !inDomain(domain, cond['value']))) {
            ok = false;
            diagnostics.push(diagnostic('DRAGON_STATE_VALUE_DOMAIN', { origin: where, message: `${c.id} compares ${String(ref.state)} with ${describeScalar(cond['value'])}, which is not in its domain ${JSON.stringify(domain)}` }));
            return false;
          }
          return true;
        }
        case 'not':
          return exactKeys(cond, ['kind', 'value']) ? checkCondition(cond['value'], where) : (invalid(`${c.id}: malformed not condition`, where), false);
        case 'and':
        case 'or':
          if (!exactKeys(cond, ['kind', 'values']) || !Array.isArray(cond['values'])) {
            invalid(`${c.id}: malformed ${String(cond['kind'])} condition`, where);
            return false;
          }
          return cond['values'].map((v) => checkCondition(v, where)).every((x) => x);
        default:
          invalid(`${c.id}: unknown condition kind ${String(cond['kind'])}`, where);
          return false;
      }
    };
    const checkChoice = (choice: unknown, where: Origin, value: (v: unknown) => boolean): boolean => {
      if (!Array.isArray(choice) || choice.length === 0) {
        invalid(`${c.id}: a choice needs at least one arm`, where);
        return false;
      }
      let good = true;
      for (const arm of choice) {
        if (!exactKeys(arm, ['when', 'value'])) {
          invalid(`${c.id}: each choice arm needs exactly when and value`, where);
          good = false;
          continue;
        }
        if (!checkCondition(arm['when'], where)) good = false;
        if (!value(arm['value'])) good = false;
      }
      return good;
    };

    const walk = (n: unknown): void => {
      if (!isRecord(n)) {
        invalid(`${c.id}: a node must be an object`);
        ok = false;
        return;
      }
      const kind = n['kind'];
      const id = isString(n['id']) ? n['id'] : '?';
      const where = originOr(n['origin'], `node ${c.id}/${id}`);
      const shapes: { readonly [k: string]: readonly string[] } = {
        element: ['kind', 'id', 'tag', 'classes', 'attributes', 'children', 'origin'],
        text: ['kind', 'id', 'text', 'origin'],
        call: ['kind', 'id', 'component', 'args', 'aliases', 'slots', 'origin'],
        projection: ['kind', 'id', 'slot', 'origin'],
        branch: ['kind', 'id', 'when', 'then', 'else', 'origin'],
      };
      if (kind === 'raw-html') {
        ok = false;
        diagnostics.push(diagnostic('DRAGON_TREE_RAW_HTML', { origin: where, message: `${c.id}/${id} is raw HTML; resolved native output needs element and text nodes` }));
        return;
      }
      const shape = isString(kind) ? shapes[kind] : undefined;
      if (shape === undefined) {
        ok = false;
        diagnostics.push(diagnostic('DRAGON_TREE_NODE_KIND', { origin: where, message: `${c.id}/${id} has unknown node kind "${String(kind)}"` }));
        return;
      }
      if (!exactKeys(n, shape) || !isString(n['id']) || id.length === 0 || id.includes('/') || id.includes(':')) {
        invalid(`${c.id}/${id}: a ${String(kind)} node needs exactly ${shape.join(', ')}, and an id without "/" or ":"`, where);
        ok = false;
        return;
      }
      if (!checkOrigin(n['origin'], `node ${c.id}/${id}`)) ok = false;
      if (nodeIds.has(id)) duplicate(where, `node id ${id} appears twice in ${c.id}`);
      nodeIds.add(id);
      const node = n as unknown as TreeNode;
      switch (node.kind) {
        case 'element':
          checkElement(node, where);
          return;
        case 'text':
          if (!isString(node.text)) invalid(`${c.id}/${id}: text must be a string`, where);
          return;
        case 'projection':
          if (!slotNames.has(node.slot)) refError(where, `${c.id}/${id} projects undeclared slot ${node.slot}`);
          projected.set(node.slot, (projected.get(node.slot) ?? 0) + 1);
          if ((projected.get(node.slot) as number) > 1) duplicate(where, `${c.id} projects slot ${node.slot} more than once`);
          return;
        case 'branch':
          if (!checkCondition(node.when, where)) ok = false;
          if (!Array.isArray(node.then) || !Array.isArray(node.else)) invalid(`${c.id}/${id}: a branch needs then and else lists`, where);
          else {
            node.then.forEach(walk);
            node.else.forEach(walk);
          }
          return;
        case 'call':
          checkCall(node, where);
          return;
      }
    };
    const checkElement = (el: ElementNode, where: Origin): void => {
      if (!isString(el.tag) || !Array.isArray(el.classes) || !Array.isArray(el.attributes) || !Array.isArray(el.children)) {
        invalid(`${c.id}/${el.id}: malformed element`, where);
        ok = false;
        return;
      }
      for (const b of el.classes) {
        if (!exactKeys(b, ['value', 'origin'])) {
          invalid(`${c.id}/${el.id}: each class binding needs exactly value and origin`, where);
          ok = false;
          continue;
        }
        const bWhere = originOr(b.origin, `class of ${c.id}/${el.id}`);
        if (!checkOrigin(b.origin, `class of ${c.id}/${el.id}`)) ok = false;
        const good = checkChoice(b.value, bWhere, (v) => {
          if (v === null) return true;
          if (!exactKeys(v, ['owner', 'sheet', 'name']) || !isString(v['owner']) || !isString(v['sheet']) || !isString(v['name']) || !/^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(v['name'])) {
            invalid(`${c.id}/${el.id}: a class symbol needs exactly owner, sheet and an identifier name`, bWhere);
            return false;
          }
          const owner = styleOwner.get(v['sheet']);
          if (!styles.has(v['sheet'])) {
            refError(bWhere, `${c.id}/${el.id} uses class ${v['name']} of unknown style use ${v['sheet']}`);
            return false;
          }
          if (owner !== v['owner'] || (v['owner'] !== c.id && v['owner'] !== document.id)) {
            ok = false;
            diagnostics.push(diagnostic('DRAGON_CLASS_OWNER', {
              origin: bWhere,
              message: `${c.id}/${el.id} carries class ${v['name']} owned by ${v['owner']} in ${v['sheet']}; ${c.id} may use only its own or the document's classes`,
            }));
            return false;
          }
          return true;
        });
        if (!good) ok = false;
      }
      const names = new Set<string>();
      for (const a of el.attributes) {
        if (!exactKeys(a, ['name', 'value', 'origin']) || !isString(a.name)) {
          invalid(`${c.id}/${el.id}: each attribute binding needs exactly name, value and origin`, where);
          ok = false;
          continue;
        }
        const aWhere = originOr(a.origin, `attribute ${a.name} of ${c.id}/${el.id}`);
        if (!checkOrigin(a.origin, `attribute ${a.name} of ${c.id}/${el.id}`)) ok = false;
        if (names.has(a.name)) duplicate(aWhere, `${c.id}/${el.id} binds attribute ${a.name} twice`);
        names.add(a.name);
        const good = checkChoice(a.value, aWhere, (v) => v === null || isString(v) || (invalid(`${c.id}/${el.id}: attribute ${a.name} values must be strings or null`, aWhere), false));
        if (!good) ok = false;
      }
      el.children.forEach(walk);
    };
    const checkCall = (call: CallNode, where: Origin): void => {
      const callee = components.get(call.component);
      if (!Array.isArray(call.args) || !Array.isArray(call.aliases) || !Array.isArray(call.slots)) {
        invalid(`${c.id}/${call.id}: a call needs args, aliases and slots lists`, where);
        ok = false;
        return;
      }
      if (callee === undefined) {
        refError(where, `${c.id}/${call.id} calls unknown component ${call.component}`);
        return;
      }
      const params = new Map<string, readonly Scalar[]>();
      const calleeStates = new Map<string, readonly Scalar[]>();
      for (const p of callee.params) if (isRecord(p) && isString(p.id) && Array.isArray(p.domain)) params.set(p.id, p.domain);
      for (const s of callee.states) if (isRecord(s) && isString(s.id) && Array.isArray(s.domain)) calleeStates.set(s.id, s.domain);
      const given = new Set<string>();
      for (const a of call.args) {
        if (!exactKeys(a, ['param', 'value', 'origin'])) {
          invalid(`${c.id}/${call.id}: each argument needs exactly param, value and origin`, where);
          ok = false;
          continue;
        }
        const aWhere = originOr(a.origin, `argument ${a.param} of ${c.id}/${call.id}`);
        if (!checkOrigin(a.origin, `argument of ${c.id}/${call.id}`)) ok = false;
        const domain = params.get(a.param);
        if (domain === undefined) {
          refError(aWhere, `${c.id}/${call.id} passes ${a.param}, which ${call.component} does not declare`);
          continue;
        }
        if (given.has(a.param)) duplicate(aWhere, `${c.id}/${call.id} passes ${a.param} twice`);
        given.add(a.param);
        if (!isScalar(a.value) || !inDomain(domain, a.value)) {
          ok = false;
          diagnostics.push(diagnostic('DRAGON_STATE_VALUE_DOMAIN', { origin: aWhere, message: `argument ${a.param} = ${describeScalar(a.value)} is not in ${call.component}.${a.param}'s domain ${JSON.stringify(domain)}` }));
        }
      }
      for (const p of params.keys()) if (!given.has(p)) refError(where, `${c.id}/${call.id} does not pass ${call.component}.${p}`);
      const controlled = new Set<string>();
      for (const al of call.aliases) {
        if (!exactKeys(al, ['local', 'caller']) || !exactKeys(al.local, ['instance', 'state']) || !exactKeys(al.caller, ['instance', 'state'])) {
          invalid(`${c.id}/${call.id}: each alias needs exactly local {instance, state} and caller {instance, state}`, where);
          ok = false;
          continue;
        }
        if (al.local.instance !== '.' || !calleeStates.has(al.local.state)) {
          ok = false;
          diagnostics.push(diagnostic('DRAGON_STATE_UNKNOWN', { origin: where, message: `${c.id}/${call.id} aliases ${JSON.stringify(al.local)}, which is not a state of ${call.component} ("." is the callee)` }));
          continue;
        }
        if (controlled.has(al.local.state)) duplicate(where, `${c.id}/${call.id} aliases ${call.component}.${al.local.state} twice`);
        controlled.add(al.local.state);
        if (al.caller.instance === '.' && !vars.has(al.caller.state)) {
          ok = false;
          diagnostics.push(diagnostic('DRAGON_STATE_UNKNOWN', { origin: where, message: `${c.id}/${call.id} aliases ${call.component}.${al.local.state} to ${al.caller.state}, which ${c.id} does not declare` }));
        } else if (al.caller.instance !== '.' && !(al.caller.instance === document.id || al.caller.instance.startsWith(`${document.id}/`))) {
          ok = false;
          diagnostics.push(diagnostic('DRAGON_STATE_UNKNOWN', { origin: where, message: `${c.id}/${call.id} aliases to instance ${al.caller.instance}, which is neither "." nor an absolute path under ${document.id}` }));
        }
      }
      const slotted = new Set<string>();
      const calleeSlots = new Set(callee.slots.map((s) => s.name));
      for (const s of call.slots) {
        if (!exactKeys(s, ['name', 'children', 'origin']) || !Array.isArray(s.children)) {
          invalid(`${c.id}/${call.id}: each slot content needs exactly name, children and origin`, where);
          ok = false;
          continue;
        }
        if (!checkOrigin(s.origin, `slot ${s.name} of ${c.id}/${call.id}`)) ok = false;
        if (!calleeSlots.has(s.name)) refError(originOr(s.origin, `slot ${s.name}`), `${c.id}/${call.id} fills slot ${s.name}, which ${call.component} does not declare`);
        if (slotted.has(s.name)) duplicate(where, `${c.id}/${call.id} fills slot ${s.name} twice`);
        slotted.add(s.name);
        // Slot content is authored by the caller: it keeps the caller's owner, conditions and ids.
        s.children.forEach(walk);
      }
    };
    c.root.forEach(walk);
  }

  const rootComponent = components.get(document.rootInstance);
  if (rootComponent === undefined) {
    refError(unlocated(`document ${document.id}`), `document ${document.id} instantiates unknown component ${document.rootInstance}`);
    return null;
  }
  if (rootComponent.params.length > 0 || rootComponent.slots.length > 0) {
    diagnostics.push(diagnostic('DRAGON_TREE_UNSUPPORTED', { origin: originOr(rootComponent.origin, rootComponent.id), message: `the document root component ${rootComponent.id} cannot take parameters or slots`, manual: 'Wrap the component in a root component that passes its arguments.' }));
    return null;
  }
  const root = rootComponent.root[0];
  if (rootComponent.root.length !== 1 || !isRecord(root) || root.kind !== 'element' || root.id !== document.documentElement || root.tag !== 'html') {
    diagnostics.push(diagnostic('DRAGON_TREE_UNSUPPORTED', { origin: originOr(rootComponent.origin, rootComponent.id), message: `the root of ${rootComponent.id} must be the single <html> element ${document.documentElement}` }));
    return null;
  }
  if (!ok) return null;
  return { tree, document, rootComponent, components, styles, sources, styleOwner };
}
