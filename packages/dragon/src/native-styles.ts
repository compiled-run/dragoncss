// The entry point a framework build calls for one component's native styles (docs/markless-native-styles.md): the component's CSS
// and element tree in, per native backend the state program (plain data) and the Swift or Kotlin generated from that same program.
import { NO_FAULTS } from './faults.ts';
import type { StateEmit } from './emit/runtime/state.ts';
import { emitStatePrograms, StateEmitError } from './emit/runtime/state.ts';
import { compiledCases, interactionPartitionOf, nativeProgramFor } from './internal.ts';
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
  /**
   * 'enforced' (the default): the committed support profiles refuse what is not device-proven, and readiness is judged by the
   * committed lanes verdict. 'lanes': compile as the parity device lanes do (support derived, real bundled faces, interaction
   * states), to produce the output a device proof runs; its readiness is never 'ready'.
   */
  readonly support?: 'enforced' | 'lanes';
  /**
   * 'program-and-sources' (the default): the state program and the Swift or Kotlin generated from it. 'program': the state program
   * only, for a host that applies the program as data itself; files is empty, and a write only the generated runtime lacks does not
   * block the target.
   */
  readonly output?: 'program-and-sources' | 'program';
};

/** One backend's output: the program is the data the generated code is written from, so the two cannot disagree. */
export type NativeStyleOutput = {
  readonly kind: 'emitted';
  readonly backend: NativeBackend;
  /** Every reachable state assignment's styles: the initial one in full, each other one as a delta, plus the setter transitions. */
  readonly program: StateProgram;
  /** The generated source: the state machine and a typed setter per state (UIKit Swift, or Android Views Kotlin); empty for output 'program'. */
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
  const support = config.support ?? 'enforced';
  if (support !== 'enforced' && support !== 'lanes') throw new Error(`compileNativeStyles: support ${JSON.stringify(support)} is neither 'enforced' nor 'lanes'`);
  const project = createProjectWith(
    { projectId: config.projectId, targets: { ...config.targets }, ...(config.fonts === undefined ? {} : { fonts: config.fonts }) },
    support === 'enforced'
      ? { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', nativeLanes: NATIVE_LANES }
      : { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', foldViewport: { width, height }, nativeRealFaces: true, interactionLanes: true },
  );
  const output = config.output ?? 'program-and-sources';
  if (output !== 'program-and-sources' && output !== 'program') throw new Error(`compileNativeStyles: output ${JSON.stringify(output)} is neither 'program-and-sources' nor 'program'`);
  const compiled = project.compile(input) as unknown as Compiled<NativeStyleTarget>;
  const out: { [T in NativeStyleTarget]?: NativeStyleOutput | NativeStyleBlocked } = {};
  for (const t of targets) out[t] = targetOutput(compiled, t, config.name, config.viewport, output === 'program-and-sources');
  return { ok: targets.every((t) => out[t]?.kind === 'emitted'), digest: compiled.digest, diagnostics: compiled.diagnostics, targets: out };
}

function targetOutput(compiled: Compiled<NativeStyleTarget>, t: NativeStyleTarget, name: string, viewport: NativeStylesConfig['viewport'], sources: boolean): NativeStyleOutput | NativeStyleBlocked {
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
    const p = nativeProgramFor(compiled, c.assignment, t);
    if (p.kind === 'blocked') return { kind: 'blocked', reason: p.reason };
    cases.push({ assignment: c.assignment, isInitial: c.isInitial, program: p.program });
  }
  try {
    const program = deriveStateProgram(backend, cases);
    if (!sources) return { kind: 'emitted', backend, program, files: [], readiness: compiled.outputs[t] };
    const emit: StateEmit = { id: name, name, fixture: '', direction: 'ltr', compilerDigest: compiled.digest, viewport, program, scripts: [] };
    const path = backend === 'uikit' ? `Cases/Dragon${name}States.swift` : `kotlin/dev/dragon/cases/Dragon${name}States.kt`;
    const file = emitStatePrograms(backend, [emit]).find((f) => f.path === path);
    if (file === undefined) throw new Error(`compileNativeStyles: the ${backend} state emitter wrote no ${path}`);
    return { kind: 'emitted', backend, program, files: [file], readiness: compiled.outputs[t] };
  } catch (e) {
    if (e instanceof StateProgramError || e instanceof StateEmitError) return { kind: 'blocked', reason: e.message };
    throw e;
  }
}
