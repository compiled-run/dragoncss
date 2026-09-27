// Negative type cases (docs/api.md §2.2, §6.2), checked by tsc -b: absent target keys, unknown configuration keys and
// wrong-target queries are TypeScript errors. Each @ts-expect-error fails the typecheck if the error ever disappears.
import { createProject } from '../src/index.ts';
import type { Compiled, FrontEndResult } from '../src/index.ts';

declare const input: FrontEndResult;
const project = createProject({ projectId: 'p', targets: { ios: { minimum: '15.0' } } });
const compiled = project.compile(input);
const report = project.check(input);

export const iosOutput = compiled.outputs.ios;
export const iosTarget = compiled.targets.ios;
export const iosReport = report.targets.ios;
export const iosExplain = compiled.explain({ target: 'ios', at: { node: 'a', instance: 'doc' }, property: 'width' });

// @ts-expect-error web is not configured: no outputs.web
export const web = compiled.outputs.web;
// @ts-expect-error android is not a configured key
export const android = compiled.outputs.android;
// @ts-expect-error email is not a configured key
export const email = compiled.outputs.email;
// @ts-expect-error web is not configured: no targets.web
export const webTarget = compiled.targets.web;
// @ts-expect-error web is not configured: no targets.web on the check report
export const webReport = report.targets.web;
// @ts-expect-error there is no public properties() reader
export const reader = compiled.properties;
// @ts-expect-error there is no outputs reader on a check report
export const reportOutputs = report.outputs;

// @ts-expect-error explain accepts only configured targets
export const wrongTarget = compiled.explain({ target: 'web', at: { node: 'a', instance: 'doc' }, property: 'width' });
// @ts-expect-error android is not a target at all
export const unknownTarget = compiled.explain({ target: 'android', at: { node: 'a', instance: 'doc' }, property: 'width' });

// @ts-expect-error unknown configuration key
export const extraKey = createProject({ projectId: 'p', targets: { web: {} }, extra: true });
// @ts-expect-error unknown target key
export const extraTarget = createProject({ projectId: 'p', targets: { android: {} } });
// @ts-expect-error ios needs a minimum
export const noMinimum = createProject({ projectId: 'p', targets: { ios: {} } });

function needsWeb(c: Compiled<'web'>): Compiled<'web'> {
  return c;
}
// @ts-expect-error Compiled<'ios'> is not assignable where Compiled<'web'> is required
export const notWeb = needsWeb(compiled);

const both = createProject({ projectId: 'p', targets: { ios: { minimum: '15.0' }, web: {} } }).compile(input);
export const bothWeb = both.outputs.web;
export const bothIos = both.outputs.ios;
// @ts-expect-error Compiled<'ios' | 'web'> is not Compiled<'web'>: its explain results may name the ios target
export const widened: Compiled<'web'> = both;

// MF2: the public entry has no internal options: createProject takes the configuration only, and InternalOptions is not exported.
// @ts-expect-error createProject takes no options argument
export const withOptions = createProject({ projectId: 'p', targets: { web: {} } }, { profiles: 'derive' });
// @ts-expect-error InternalOptions is internal (dragon-internal condition only)
export type Options = import('../src/index.ts').InternalOptions;
// S4a: the environment, and its direction, stay internal: the public entry compiles for the ltr reference environment only.
// @ts-expect-error Environment is internal (dragon-internal condition only)
export type Env = import('../src/index.ts').Environment;
// @ts-expect-error createProject takes no direction option
export const withDirection = createProject({ projectId: 'p', targets: { web: {} } }, { direction: 'rtl' });

// M2 (T036): the exact unions of ExplainedCase.cascade and Origin are pinned; a widening or narrowing fails the typecheck.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type PinnedOrigin =
  | { readonly kind: 'authored'; readonly span: import('../src/index.ts').Span }
  | { readonly kind: 'inherited'; readonly element: string; readonly from: import('../src/index.ts').Origin }
  | { readonly kind: 'builtin'; readonly dataset: string; readonly entry: string }
  | { readonly kind: 'generated'; readonly pass: string; readonly causes: readonly import('../src/index.ts').Origin[] }
  | { readonly kind: 'unlocated'; readonly reason: string };
export const cascadeUnion: Equal<import('../src/index.ts').ExplainedCase['cascade'], 'author' | 'inherited' | 'user-agent' | 'initial' | 'environment'> = true;
export const originUnion: Equal<import('../src/index.ts').Origin, PinnedOrigin> = true;
export const originKinds: Equal<import('../src/index.ts').Origin['kind'], 'authored' | 'inherited' | 'builtin' | 'generated' | 'unlocated'> = true;
// @ts-expect-error a cascade union without 'environment' is not the pinned union
export const narrowed: Equal<import('../src/index.ts').ExplainedCase['cascade'], 'author' | 'inherited' | 'user-agent' | 'initial'> = true;
