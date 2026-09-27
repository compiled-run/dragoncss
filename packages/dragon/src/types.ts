// Public input and result types (docs/api.md §2.1-2.2, §3.1), narrowed to the milestone-1 slice.

export type SupportStatus = 'exact' | 'caveat' | 'approx' | 'unsupported' | 'no-effect';

export type Target = 'web' | 'ios' | 'android' | 'email';

export type Targets = {
  web?: {};
  ios?: { minimum: string };
};

export type Configured<T> = Extract<keyof T, keyof Targets>;

export type SourceRef = { readonly uri: string; readonly revision: string; readonly hash: string };
export type Range = { readonly start: number; readonly end: number };
export type Span = Range & { readonly source: SourceRef };

export type SourceFile = {
  readonly ref: SourceRef;
  readonly text: string;
  readonly displayPath: string;
};

export type SourceSnapshot = {
  readonly projectId: string;
  readonly revision: string;
  readonly sources: readonly SourceFile[];
  readonly assets: readonly { readonly id: string; readonly hash: string; readonly bytes: Uint8Array }[];
  readonly resolutions: readonly {
    readonly from: SourceRef;
    readonly specifier: string;
    readonly kind: 'source' | 'css' | 'asset';
    readonly to: string | null;
  }[];
};

export type ElementNode = {
  readonly kind: 'element';
  readonly id: string;
  readonly tag: string;
  readonly classes: readonly string[];
  readonly attributes: readonly { readonly name: string; readonly value: string }[];
  readonly children: readonly TreeNode[];
  readonly origin: Span;
};

export type TextNode = { readonly kind: 'text'; readonly id: string; readonly text: string; readonly origin: Span };

export type TreeNode = ElementNode | TextNode;

export type StyleUse = {
  readonly id: string;
  readonly css: Span;
  readonly scope: { readonly kind: 'component'; readonly owner: string } | { readonly kind: 'document' };
};

export type ComponentDefinition = { readonly id: string; readonly module: string; readonly root: readonly TreeNode[] };

export type DocumentEntry = {
  readonly id: string;
  readonly rootInstance: string;
  readonly documentElement: string;
  readonly styles: readonly string[];
  readonly initial: readonly never[];
};

export type DraftTree = {
  readonly schema: 'dragon/tree@0';
  readonly schemaRevision: string;
  readonly modules: readonly { readonly id: string; readonly source: string }[];
  readonly components: readonly ComponentDefinition[];
  readonly documents: readonly DocumentEntry[];
  readonly styles: readonly StyleUse[];
};

export type FrontEndResult = {
  readonly producer: { readonly name: string; readonly version: string; readonly schemaRevision: string };
  readonly snapshot: SourceSnapshot;
  readonly diagnostics: readonly Diagnostic[];
  readonly tree: DraftTree | null;
  readonly completeness: 'closed-application' | 'library' | 'unknown';
};

export type DiagnosticCode =
  | 'DRAGON_CONFIG_INVALID'
  | 'DRAGON_INPUT_INVALID'
  | 'DRAGON_PRODUCER_ERROR'
  | 'DRAGON_INCOMPLETE_INPUT'
  | 'DRAGON_SOURCE_HASH_MISMATCH'
  | 'DRAGON_SPAN_INVALID'
  | 'DRAGON_TREE_SCHEMA'
  | 'DRAGON_TREE_UNSUPPORTED'
  | 'DRAGON_CSS_PARSE'
  | 'DRAGON_CSS_INVALID_VALUE'
  | 'DRAGON_UNSUPPORTED_AT_RULE'
  | 'DRAGON_UNSUPPORTED_SELECTOR'
  | 'DRAGON_UNSUPPORTED_IMPORTANT'
  | 'DRAGON_UNSUPPORTED_PROPERTY'
  | 'DRAGON_UNSUPPORTED_VALUE'
  | 'DRAGON_UNSUPPORTED_ELEMENT'
  | 'DRAGON_UNSUPPORTED_ATTRIBUTE'
  | 'DRAGON_UNSUPPORTED_FONT'
  | 'DRAGON_LOWERING_FAILED';

export type Diagnostic = {
  readonly code: DiagnosticCode;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  /** Null only for configuration and whole-input errors that have no source location. */
  readonly span: Span | null;
  /** The configured targets this diagnostic blocks; empty means every target. */
  readonly targets: readonly Target[];
  readonly fix: string | null;
};

export type Dependency = { readonly kind: 'source' | 'stylesheet'; readonly uri: string; readonly hash: string };

export type CheckReport<K extends string> = {
  readonly ok: boolean;
  readonly revision: string;
  readonly digest: string;
  readonly sources: readonly SourceFile[];
  readonly dependencies: readonly Dependency[];
  readonly diagnostics: readonly Diagnostic[];
  readonly targets: { readonly [P in K]: 'checked' | 'blocked' };
};

export type GeneratedFile = { readonly path: string; readonly text: string };

export type ArtifactState =
  | { readonly kind: 'ready'; readonly digest: string; readonly files: readonly GeneratedFile[] }
  | { readonly kind: 'analysis-only'; readonly digest: string; readonly reason: string }
  | { readonly kind: 'blocked'; readonly diagnostics: readonly Diagnostic[] };

export type ExplainQuery<K extends string> = { readonly target: K; readonly node: string; readonly property: string };

export type ExplainResult<K extends string> =
  | {
      readonly kind: 'resolved';
      readonly target: K;
      readonly node: string;
      readonly property: string;
      readonly value: string;
      readonly origin: 'author' | 'inherited' | 'user-agent' | 'initial';
      readonly span: Span | null;
    }
  | { readonly kind: 'unknown'; readonly reason: string };

export type Compiled<K extends string> = CheckReport<K> & {
  readonly outputs: { readonly [P in K]: ArtifactState };
  explain(query: ExplainQuery<K>): ExplainResult<K>;
};

export interface Project<K extends string> {
  compile(input: FrontEndResult): Compiled<K>;
  check(input: FrontEndResult): CheckReport<K>;
}
