// Public input and result types (docs/api.md §2.1-2.2, §3.1-3.2, §6.1-6.2), narrowed to the milestone-1 slice.
import type { DiagnosticCode } from './diagnostics/codes.ts';

export type { DiagnosticCode } from './diagnostics/codes.ts';

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

/** Where a value or node came from (docs/api.md §6.1). Built-in and generated values never invent authored spans. */
export type Origin =
  | { readonly kind: 'authored'; readonly span: Span }
  | { readonly kind: 'inherited'; readonly element: string; readonly from: Origin }
  | { readonly kind: 'builtin'; readonly dataset: string; readonly entry: string }
  | { readonly kind: 'generated'; readonly pass: string; readonly causes: readonly Origin[] }
  | { readonly kind: 'unlocated'; readonly reason: string };

/** A typed JSON scalar. true, "true" and 1 are different values; NaN, Infinity and -0 are rejected (docs/api.md §3.2). */
export type Scalar = string | number | boolean | null;

/**
 * A qualified state reference. Inside a component definition "." is the enclosing instance; in a call's aliases, local "."
 * is the callee and caller "." the calling instance. Absolute instance paths start with the document id ("doc/a").
 */
export type StateRef = { readonly instance: string; readonly state: string };

export type Condition =
  | { readonly kind: 'true' }
  | { readonly kind: 'eq'; readonly ref: StateRef; readonly value: Scalar }
  | { readonly kind: 'not'; readonly value: Condition }
  | { readonly kind: 'and' | 'or'; readonly values: readonly Condition[] };

/** Exactly one arm must hold for every reachable assignment. */
export type Choice<V> = readonly { readonly when: Condition; readonly value: V }[];

export type ClassSymbol = { readonly owner: string; readonly sheet: string; readonly name: string };

export type State = { readonly id: string; readonly domain: readonly Scalar[]; readonly initial: Scalar; readonly origin: Origin };

/** A finite typed argument fixed at each call site. */
export type Param = { readonly id: string; readonly domain: readonly Scalar[]; readonly origin: Origin };

export type StateAlias = { readonly local: StateRef; readonly caller: StateRef };

export type ClassBinding = { readonly value: Choice<ClassSymbol | null>; readonly origin: Origin };

/** null means the attribute is absent; the empty string means present (docs/api.md §3.2). */
export type AttributeBinding = { readonly name: string; readonly value: Choice<string | null>; readonly origin: Origin };

export type ElementNode = {
  readonly kind: 'element';
  readonly id: string;
  readonly tag: string;
  readonly classes: readonly ClassBinding[];
  readonly attributes: readonly AttributeBinding[];
  readonly children: readonly TreeNode[];
  readonly origin: Origin;
};

export type TextNode = { readonly kind: 'text'; readonly id: string; readonly text: string; readonly origin: Origin };

export type CallNode = {
  readonly kind: 'call';
  readonly id: string;
  readonly component: string;
  readonly args: readonly { readonly param: string; readonly value: Scalar; readonly origin: Origin }[];
  readonly aliases: readonly StateAlias[];
  readonly slots: readonly { readonly name: string; readonly children: readonly TreeNode[]; readonly origin: Origin }[];
  readonly origin: Origin;
};

export type ProjectionNode = { readonly kind: 'projection'; readonly id: string; readonly slot: string; readonly origin: Origin };

export type BranchNode = {
  readonly kind: 'branch';
  readonly id: string;
  readonly when: Condition;
  readonly then: readonly TreeNode[];
  readonly else: readonly TreeNode[];
  readonly origin: Origin;
};

export type TreeNode = ElementNode | TextNode | CallNode | ProjectionNode | BranchNode;

export type StyleUse = {
  readonly id: string;
  readonly css: Span;
  readonly scope: { readonly kind: 'component'; readonly owner: string } | { readonly kind: 'document' };
};

export type ComponentDefinition = {
  readonly id: string;
  readonly module: string;
  readonly params: readonly Param[];
  readonly states: readonly State[];
  readonly slots: readonly { readonly name: string; readonly origin: Origin }[];
  readonly root: readonly TreeNode[];
  readonly origin: Origin;
};

/** rootInstance names the component instantiated at the document root; that instance's path is the document id. */
export type DocumentEntry = {
  readonly id: string;
  readonly rootInstance: string;
  readonly documentElement: string;
  readonly styles: readonly string[];
  readonly initial: readonly { readonly state: StateRef; readonly value: Scalar }[];
};

export type DraftTree = {
  readonly schema: 'dragon/tree@0';
  readonly schemaRevision: string;
  readonly modules: readonly { readonly id: string; readonly source: string }[];
  readonly components: readonly ComponentDefinition[];
  readonly documents: readonly DocumentEntry[];
  readonly styles: readonly StyleUse[];
};

export type Fix =
  | { readonly title: string; readonly edits: readonly { readonly span: Span; readonly replacement: string }[] }
  | { readonly title: string; readonly manual: string };

/** The profile fact a diagnostic rests on (docs/api.md §6.3). */
export type ProofRef = {
  readonly target: string;
  readonly profileRevision: string;
  readonly feature: string;
  readonly context: string | null;
  readonly status: SupportStatus;
};

export type Diagnostic = {
  readonly code: DiagnosticCode;
  readonly severity: 'error' | 'warning' | 'info';
  /** The configured target this diagnostic blocks; null means every target. */
  readonly target: string | null;
  readonly origin: Origin;
  readonly message: string;
  readonly why: string;
  readonly related: readonly { readonly origin: Origin; readonly message: string }[];
  readonly fix: Fix | null;
  readonly profile: ProofRef | null;
};

/** A diagnostic reported by the front end; its code belongs to the producer. */
export type ProducerDiagnostic = Omit<Diagnostic, 'code'> & { readonly code: string };

export type FrontEndResult = {
  readonly producer: { readonly name: string; readonly version: string; readonly schemaRevision: string };
  readonly snapshot: SourceSnapshot;
  readonly diagnostics: readonly ProducerDiagnostic[];
  readonly tree: DraftTree | null;
  readonly completeness: 'closed-application' | 'library' | 'unknown';
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

export type Assignment = readonly { readonly state: StateRef; readonly value: Scalar }[];

export type ExplainQuery<K extends string> = {
  readonly target: K;
  readonly at: { readonly node: string; readonly instance: string };
  readonly property: string;
  /** A partial assignment over absolute state references; the other states stay open and every matching case is returned. */
  readonly assignment?: Assignment;
};

export type ExplainedCase = {
  readonly node: string;
  readonly instance: string;
  readonly target: string;
  /** The complete reachable assignment of this case. */
  readonly assignment: Assignment;
  readonly property: string;
  readonly value: string;
  readonly cascade: 'author' | 'inherited' | 'user-agent' | 'initial';
  readonly origin: Origin;
  readonly losing: readonly { readonly origin: Origin; readonly reason: string }[];
  readonly support: { readonly feature: string; readonly context: string; readonly status: SupportStatus } | null;
};

export type ExplainResult<K extends string> =
  | { readonly kind: 'found'; readonly target: K; readonly cases: readonly ExplainedCase[] }
  | { readonly kind: 'not-found'; readonly reason: string }
  | { readonly kind: 'invalid-query'; readonly diagnostics: readonly Diagnostic[] };

export type Compiled<K extends string> = CheckReport<K> & {
  readonly outputs: { readonly [P in K]: ArtifactState };
  explain(query: ExplainQuery<K>): ExplainResult<K>;
};

export interface Project<K extends string> {
  compile(input: FrontEndResult): Compiled<K>;
  check(input: FrontEndResult): CheckReport<K>;
}
