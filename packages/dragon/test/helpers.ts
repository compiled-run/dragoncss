import { expect } from 'vitest';
import type {
  ClassBinding,
  ClassSymbol,
  Compiled,
  Condition,
  Diagnostic,
  DraftTree,
  ElementNode,
  ExplainedCase,
  FrontEndResult,
  Origin,
  Scalar,
  SourceFile,
  SourceRef,
  Span,
  TreeNode,
} from '../src/index.ts';
import { TREE_SCHEMA_REVISION } from '../src/index.ts';
import { sha256Hex } from '../src/digest.ts';
import { CATALOGUE } from '../src/diagnostics/catalogue.ts';

export const DOC = 'doc';
export const always: Condition = { kind: 'true' };
export const eq = (state: string, value: Scalar, instance = '.'): Condition => ({ kind: 'eq', ref: { instance, state }, value });
export const not = (value: Condition): Condition => ({ kind: 'not', value });
export const and = (...values: Condition[]): Condition => ({ kind: 'and', values });

/** Builds a one-document FrontEndResult: the source text is the CSS; nodes point at offset 0; classes are document-owned. */
export function inputFor(css: string, body: (ref: SourceRef) => TreeNode[], opts: { hash?: string } = {}): FrontEndResult {
  const ref: SourceRef = { uri: 'dragon-source://test/app.css', revision: 'r1', hash: opts.hash ?? `sha256:${sha256Hex(css)}` };
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
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
      components: [{ id: 'App', module: 'm', params: [], states: [], slots: [], root: [html], origin }],
      documents: [{ id: DOC, rootInstance: 'App', documentElement: 'html', styles: ['s'], initial: [] }],
      styles: [{ id: 's', css: { source: ref, start: 0, end: css.length }, scope: { kind: 'document' } }],
    },
    completeness: 'closed-application',
  };
}

export const staticClass = (symbol: ClassSymbol, origin: Origin): ClassBinding => ({ value: [{ when: always, value: symbol }], origin });

export function div(ref: SourceRef, id: string, classes: string[], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag: 'div', classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

export function text(ref: SourceRef, id: string, value: string): TreeNode {
  return { kind: 'text', id, text: value, origin: { kind: 'authored', span: { source: ref, start: 0, end: 0 } } };
}

/** A multi-file snapshot whose origins are spans found in the real source text. */
export class Sources {
  readonly files: ReadonlyMap<string, SourceFile>;
  constructor(files: { readonly [name: string]: string }, revision = 'r1') {
    this.files = new Map(Object.entries(files).map(([name, text]) => [name, {
      ref: { uri: `dragon-source://test/${name}`, revision, hash: `sha256:${sha256Hex(text)}` },
      text,
      displayPath: name,
    }]));
  }
  ref(file: string): SourceRef {
    const f = this.files.get(file);
    if (f === undefined) throw new Error(`no ${file}`);
    return f.ref;
  }
  span(file: string, find: string, nth = 0): Span {
    const f = this.files.get(file);
    if (f === undefined) throw new Error(`no ${file}`);
    let at = -1;
    for (let i = 0; i <= nth; i++) {
      at = f.text.indexOf(find, at + 1);
      if (at < 0) throw new Error(`"${find}" not in ${file}`);
    }
    return { source: f.ref, start: at, end: at + find.length };
  }
  at(file: string, find: string, nth = 0): Origin {
    return { kind: 'authored', span: this.span(file, find, nth) };
  }
  whole(file: string): Span {
    const f = this.files.get(file);
    if (f === undefined) throw new Error(`no ${file}`);
    return { source: f.ref, start: 0, end: f.text.length };
  }
  input(tree: Omit<DraftTree, 'schema' | 'schemaRevision'>, extra: Partial<Pick<FrontEndResult, 'diagnostics' | 'completeness'>> = {}): FrontEndResult {
    return {
      producer: { name: 'test', version: '0', schemaRevision: TREE_SCHEMA_REVISION },
      snapshot: { projectId: 'test', revision: 'r1', sources: [...this.files.values()], assets: [], resolutions: [] },
      diagnostics: extra.diagnostics ?? [],
      tree: { schema: 'dragon/tree@0', schemaRevision: TREE_SCHEMA_REVISION, ...tree },
      completeness: extra.completeness ?? 'closed-application',
    };
  }
}

/** Every diagnostic must use a catalogue code with the catalogue's severity and fix kind. */
export function expectCatalogued(diagnostics: readonly Diagnostic[]): void {
  for (const d of diagnostics) {
    const entry = CATALOGUE[d.code];
    expect(entry, d.code).toBeDefined();
    expect(d.severity, d.code).toBe(entry.severity);
    expect(d.why, d.code).toBe(entry.why);
    expect(d.fix, d.code).not.toBeNull();
    expect(d.fix !== null && 'manual' in d.fix ? 'manual' : 'edit', d.code).toBe(entry.fix.kind);
  }
}

/** The single explained case of a one-case document. */
export function explainOne<K extends string>(c: Compiled<K>, target: K, node: string, property: string, instance = DOC): ExplainedCase {
  const r = c.explain({ target, at: { node, instance }, property });
  if (r.kind !== 'found') throw new Error(`${node} ${property}: ${JSON.stringify(r)}`);
  expect(r.cases.length).toBe(1);
  return r.cases[0] as ExplainedCase;
}

export function spanTextOf(input: FrontEndResult, d: Diagnostic): string | null {
  if (d.origin.kind !== 'authored') return null;
  const span = d.origin.span;
  const src = input.snapshot.sources.find((s) => s.ref.uri === span.source.uri);
  return src === undefined ? null : src.text.slice(span.start, span.end);
}
