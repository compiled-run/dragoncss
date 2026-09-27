import type { ElementNode, FrontEndResult, SourceRef, TreeNode } from '../src/index.ts';
import { TREE_SCHEMA_REVISION } from '../src/index.ts';
import { sha256Hex } from '../src/digest.ts';

/** Builds a one-document FrontEndResult: the source text is the CSS followed by nothing else; nodes point at offset 0. */
export function inputFor(css: string, body: (ref: SourceRef) => TreeNode[], opts: { hash?: string } = {}): FrontEndResult {
  const ref: SourceRef = { uri: 'dragon-source://test/app.css', revision: 'r1', hash: opts.hash ?? `sha256:${sha256Hex(css)}` };
  const origin = { source: ref, start: 0, end: 0 };
  const html: ElementNode = {
    kind: 'element', id: 'html', tag: 'html', classes: [], attributes: [], origin,
    children: [{ kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], origin, children: body(ref) }],
  };
  return {
    producer: { name: 'test', version: '0', schemaRevision: TREE_SCHEMA_REVISION },
    snapshot: { projectId: 'test', revision: 'r1', sources: [{ ref, text: css, displayPath: 'app.css' }], assets: [], resolutions: [] },
    diagnostics: [],
    tree: {
      schema: 'dragon/tree@0',
      schemaRevision: TREE_SCHEMA_REVISION,
      modules: [{ id: 'm', source: ref.uri }],
      components: [{ id: 'App', module: 'm', root: [html] }],
      documents: [{ id: 'doc', rootInstance: 'App', documentElement: 'html', styles: ['s'], initial: [] }],
      styles: [{ id: 's', css: { source: ref, start: 0, end: css.length }, scope: { kind: 'document' } }],
    },
    completeness: 'closed-application',
  };
}

export function div(ref: SourceRef, id: string, classes: string[], children: TreeNode[] = []): ElementNode {
  return { kind: 'element', id, tag: 'div', classes, attributes: [], children, origin: { source: ref, start: 0, end: 0 } };
}
