// Structural validation of the FrontEndResult and the milestone-1 dragon/tree@0 subset (docs/api.md §2.1, §3.1, §10).
import { sha256Hex } from '../digest.ts';
import { diag } from '../css/stylesheet.ts';
import type { Diagnostic, DraftTree, ElementNode, FrontEndResult, SourceFile, Span, TreeNode } from '../types.ts';

export const TREE_SCHEMA_REVISION = '0.1';

export type ValidInput = {
  readonly tree: DraftTree;
  readonly document: DraftTree['documents'][number];
  readonly root: ElementNode;
  readonly sources: ReadonlyMap<string, SourceFile>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function exactKeys(v: unknown, keys: readonly string[], optional: readonly string[] = []): boolean {
  if (!isRecord(v)) return false;
  for (const k of keys) if (!(k in v)) return false;
  for (const k of Object.keys(v)) if (!keys.includes(k) && !optional.includes(k)) return false;
  return true;
}

function invalid(message: string): Diagnostic {
  return diag('DRAGON_INPUT_INVALID', message, null, 'Supply a complete FrontEndResult matching docs/api.md §2.1.');
}

/** Returns the validated input, or null after pushing blocking diagnostics. */
export function validateInput(input: FrontEndResult, projectId: string, diagnostics: Diagnostic[]): ValidInput | null {
  const raw: unknown = input;
  if (!exactKeys(raw, ['producer', 'snapshot', 'diagnostics', 'tree', 'completeness'])) {
    diagnostics.push(invalid('FrontEndResult must have exactly producer, snapshot, diagnostics, tree and completeness'));
    return null;
  }
  const snap: unknown = input.snapshot;
  if (!exactKeys(snap, ['projectId', 'revision', 'sources', 'assets', 'resolutions']) || !Array.isArray(input.snapshot.sources)) {
    diagnostics.push(invalid('snapshot must have exactly projectId, revision, sources, assets and resolutions'));
    return null;
  }
  if (input.snapshot.projectId !== projectId) {
    diagnostics.push(invalid(`snapshot.projectId "${input.snapshot.projectId}" does not match the project "${projectId}"`));
    return null;
  }
  for (const d of input.diagnostics) {
    if (d.severity === 'error') {
      diagnostics.push({ ...d, code: 'DRAGON_PRODUCER_ERROR', message: `producer error: ${d.message}`, targets: [] });
    }
  }
  const sources = new Map<string, SourceFile>();
  for (const s of input.snapshot.sources) {
    if (!exactKeys(s, ['ref', 'text', 'displayPath'], ['virtualOf']) || !exactKeys(s.ref, ['uri', 'revision', 'hash'])) {
      diagnostics.push(invalid('each source needs exactly ref {uri, revision, hash}, text and displayPath'));
      return null;
    }
    const expected = `sha256:${sha256Hex(s.text)}`;
    if (s.ref.hash !== expected) {
      diagnostics.push(diag('DRAGON_SOURCE_HASH_MISMATCH', `hash of ${s.ref.uri} is ${expected}, not ${s.ref.hash}`, null, 'Recompute the hash over the exact UTF-8 text.'));
      return null;
    }
    sources.set(s.ref.uri, s);
  }
  if (input.completeness !== 'closed-application') {
    diagnostics.push(diag('DRAGON_INCOMPLETE_INPUT', `completeness "${input.completeness}" cannot produce application outputs`, null, 'Pass a closed application.'));
  }
  if (input.tree === null) {
    diagnostics.push(diag('DRAGON_INCOMPLETE_INPUT', 'the producer supplied no element tree', null, 'Fix the producer errors so it can supply a tree.'));
    return null;
  }
  const tree = input.tree;
  if (!exactKeys(tree, ['schema', 'schemaRevision', 'modules', 'components', 'documents', 'styles'])
    || tree.schema !== 'dragon/tree@0' || tree.schemaRevision !== TREE_SCHEMA_REVISION) {
    diagnostics.push(diag('DRAGON_TREE_SCHEMA', `tree must be dragon/tree@0 revision ${TREE_SCHEMA_REVISION}`, null, `Emit schema "dragon/tree@0" with schemaRevision "${TREE_SCHEMA_REVISION}".`));
    return null;
  }
  const checkSpan = (span: Span, what: string): boolean => {
    const src = sources.get(span.source.uri);
    const ok = src !== undefined && src.ref.hash === span.source.hash && src.ref.revision === span.source.revision
      && Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.start <= span.end && span.end <= src.text.length;
    if (!ok) diagnostics.push(diag('DRAGON_SPAN_INVALID', `${what} points outside its source snapshot`, null, 'Point spans at a source in the snapshot, in UTF-16 offsets.'));
    return ok;
  };
  if (tree.documents.length !== 1 || tree.components.length !== 1) {
    diagnostics.push(diag('DRAGON_TREE_UNSUPPORTED', 'milestone-1 S1 compiles exactly one document entry with one component', null, 'Split the input into one document per compile.'));
    return null;
  }
  const document = tree.documents[0] as DraftTree['documents'][number];
  const component = tree.components[0] as DraftTree['components'][number];
  if (!exactKeys(document, ['id', 'rootInstance', 'documentElement', 'styles', 'initial']) || document.initial.length !== 0) {
    diagnostics.push(invalid('document entries need exactly id, rootInstance, documentElement, styles and an empty initial list in S1'));
    return null;
  }
  if (document.rootInstance !== component.id || component.root.length !== 1) {
    diagnostics.push(diag('DRAGON_TREE_UNSUPPORTED', 'the document must instantiate its single component, whose root is one element', null, null));
    return null;
  }
  const root = component.root[0] as TreeNode;
  if (root.kind !== 'element' || root.id !== document.documentElement || root.tag !== 'html') {
    diagnostics.push(diag('DRAGON_TREE_UNSUPPORTED', 'the document element must be the component root <html>', null, null));
    return null;
  }
  const styleIds = new Set(tree.styles.map((s) => s.id));
  for (const s of tree.styles) {
    if (s.scope.kind !== 'document') diagnostics.push(diag('DRAGON_TREE_UNSUPPORTED', `component-scoped style use ${s.id} arrives in S3`, s.css, null));
    checkSpan(s.css, `style use ${s.id}`);
  }
  for (const id of document.styles) {
    if (!styleIds.has(id)) diagnostics.push(invalid(`document ${document.id} names unknown style use ${id}`));
  }
  const ids = new Set<string>();
  let ok = true;
  const walk = (n: TreeNode): void => {
    const keysOk = n.kind === 'element'
      ? exactKeys(n, ['kind', 'id', 'tag', 'classes', 'attributes', 'children', 'origin'])
      : n.kind === 'text'
        ? exactKeys(n, ['kind', 'id', 'text', 'origin'])
        : false;
    if (!keysOk) {
      ok = false;
      diagnostics.push(diag('DRAGON_TREE_UNSUPPORTED', `node kind "${String((n as { kind: unknown }).kind)}" or its fields are not supported in S1`, null, 'Use element and text nodes.'));
      return;
    }
    if (ids.has(n.id)) {
      ok = false;
      diagnostics.push(invalid(`duplicate node id ${n.id}`));
    }
    ids.add(n.id);
    if (!checkSpan(n.origin, `node ${n.id}`)) ok = false;
    if (n.kind === 'element') n.children.forEach(walk);
  };
  walk(root);
  if (!ok) return null;
  return { tree, document, root, sources };
}
