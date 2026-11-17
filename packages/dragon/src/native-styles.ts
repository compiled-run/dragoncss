// The entry point a framework build calls for one component's native styles (docs/markless-native-styles.md): the component's CSS
// and element tree in, per native backend the state program (plain data) and the Swift or Kotlin generated from that same program.
import { NO_FAULTS } from './faults.ts';
import type { StateEmit } from './emit/runtime/state.ts';
import { emitStatePrograms, StateEmitError } from './emit/runtime/state.ts';
import { compiledCases, interactionPartitionOf, nativePrograms } from './internal.ts';
import type { NativeBackend } from './lower/native-program.ts';
import type { StateProgram } from './lower/state-program.ts';
import { deriveStateProgram, StateProgramError } from './lower/state-program.ts';
import { NATIVE_LANES } from './profiles/native-lanes.ts';
import { createProjectWith, internalRecord } from './project.ts';
import type { ArtifactState, Compiled, Diagnostic, FontMap, FrontEndResult, GeneratedFile } from './types.ts';

export const NATIVE_STYLES_VERSION = 'dragon.native-styles/1';

export type NativeStyleTarget = 'ios' | 'android';

export type NativeStylesConfig = {
  readonly projectId: string;
  /** The component's name, an identifier starting with an ASCII capital: the generated class is Dragon<name>States. */
  readonly name: string;
  /** The native targets to compile; each is checked, and one target's error blocks only that target's output. */
  readonly targets: { readonly ios?: { readonly minimum: string }; readonly android?: { readonly minSdk: number } };
  readonly fonts?: FontMap;
  /** The CSS size the component's root starts at, before the view it mounts in reports its own size. */
  readonly viewport: { readonly width: number; readonly height: number };
};

/** One backend's output: the program is the data the generated code is written from, so the two cannot disagree. */
export type NativeStyleOutput = {
  readonly kind: 'emitted';
  readonly backend: NativeBackend;
  /** Every reachable state assignment's styles: the initial one in full, each other one as a delta, plus the setter transitions. */
  readonly program: StateProgram;
  /** The generated source: the state machine and a typed setter per state (UIKit Swift, or Android Views Kotlin). */
  readonly files: readonly GeneratedFile[];
  /** Whether the target's committed device lanes all pass: only 'ready' is a shipping output (docs/api.md §2.2). */
  readonly readiness: ArtifactState;
};

export type NativeStyleBlocked = { readonly kind: 'blocked'; readonly reason: string };

export type NativeStyles = {
  /** True only when every configured target emitted. */
  readonly ok: boolean;
  /** The compile's digest: the same input, config and compiler give the same digest. */
  readonly digest: string;
  /** Every diagnostic of the compile, for every target; an error names the property, value or selector and its source span. */
  readonly diagnostics: readonly Diagnostic[];
  readonly targets: { readonly [T in NativeStyleTarget]?: NativeStyleOutput | NativeStyleBlocked };
};

const BACKEND: { readonly [T in NativeStyleTarget]: NativeBackend } = { ios: 'uikit', android: 'android-views' };

/**
 * Compiles one component's styles for the configured native targets. A target whose compile has an error is blocked with no
 * code; nothing is dropped silently.
 */
export function compileNativeStyles(config: NativeStylesConfig, input: FrontEndResult): NativeStyles {
  const targets = (['ios', 'android'] as const).filter((t) => config.targets[t] !== undefined);
  if (targets.length === 0) throw new Error('compileNativeStyles needs at least one native target (ios or android)');
  if (!/^[A-Z][A-Za-z0-9]*$/.test(config.name)) throw new Error(`compileNativeStyles: the name ${JSON.stringify(config.name)} is not an identifier starting with an ASCII capital`);
  const { width, height } = config.viewport;
  if (![width, height].every((v) => Number.isFinite(v) && v > 0)) throw new Error(`compileNativeStyles: viewport ${width}x${height} is not a positive size`);
  const project = createProjectWith(
    { projectId: config.projectId, targets: { ...config.targets }, ...(config.fonts === undefined ? {} : { fonts: config.fonts }) },
    { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', nativeLanes: NATIVE_LANES },
  );
  const compiled = project.compile(input) as unknown as Compiled<NativeStyleTarget>;
  const out: { [T in NativeStyleTarget]?: NativeStyleOutput | NativeStyleBlocked } = {};
  for (const t of targets) out[t] = targetOutput(compiled, t, config.name, config.viewport);
  return { ok: targets.every((t) => out[t]?.kind === 'emitted'), digest: compiled.digest, diagnostics: compiled.diagnostics, targets: out };
}

function targetOutput(compiled: Compiled<NativeStyleTarget>, t: NativeStyleTarget, name: string, viewport: NativeStylesConfig['viewport']): NativeStyleOutput | NativeStyleBlocked {
  if (compiled.targets[t] !== 'checked') return { kind: 'blocked', reason: `the ${t} compile has errors; see the diagnostics` };
  const record = internalRecord(compiled);
  if (record === undefined) throw new Error('compileNativeStyles: the compile result carries no internal record');
  if (record.animation !== null && record.animation.features.length > 0) return { kind: 'blocked', reason: `the ${t} output has transitions or animations, which this entry point does not emit yet` };
  if (record.bands !== null) return { kind: 'blocked', reason: `the ${t} output has @media bands, which this entry point does not emit yet` };
  const backend = BACKEND[t];
  const cases = [];
  for (const c of compiledCases(compiled)) {
    const partition = interactionPartitionOf(compiled, c.assignment);
    if (partition !== null && partition.states.length > 0) return { kind: 'blocked', reason: `the ${t} output has interaction states (:hover, :active, :focus), which this entry point does not emit yet` };
    const p = nativePrograms(compiled, c.assignment);
    if (p.kind === 'blocked') return { kind: 'blocked', reason: p.reason };
    cases.push({ assignment: c.assignment, isInitial: c.isInitial, program: p.programs[backend] });
  }
  try {
    const program = deriveStateProgram(backend, cases);
    const emit: StateEmit = { id: name, name, fixture: '', direction: 'ltr', compilerDigest: compiled.digest, viewport, program, scripts: [] };
    // The second file is the lanes' script case table, empty here: a component has no case scripts.
    const files = emitStatePrograms(backend, [emit]).slice(0, 1);
    return { kind: 'emitted', backend, program, files, readiness: compiled.outputs[t] };
  } catch (e) {
    if (e instanceof StateProgramError || e instanceof StateEmitError) return { kind: 'blocked', reason: e.message };
    throw e;
  }
}
