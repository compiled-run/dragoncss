// The entry point a framework build calls for one component's native styles (docs/markless-native-styles.md): the component's CSS
// and element tree in, per native backend the state program (plain data) and the Swift or Kotlin generated from that same program.
import { NO_FAULTS } from './faults.ts';
import type { StateEmit } from './emit/runtime/state.ts';
import { emitStatePrograms, StateEmitError } from './emit/runtime/state.ts';
import { BAND_STATE, compiledCases, ENV_INSTANCE, interactionPartitionIn, nativeBandProgramFor, nativeBands, usedSchemeOf } from './internal.ts';
import type { rtBand } from '@dragon/layout';
import { BandProgramError, bandStateProgram } from './lower/band-program.ts';
import type { NativeBackend } from './lower/native-program.ts';
import type { StateProgram } from './lower/state-program.ts';
import { deriveStateProgram, StateProgramError } from './lower/state-program.ts';
import { NATIVE_LANES } from './profiles/native-lanes.ts';
import { createProjectWith, internalRecord } from './project.ts';
import type { BrotliDecompress } from './fonts/woff.ts';
import type { Rgba8 } from './css/color.ts';
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
  /** The host's Brotli decoder for WOFF2 @font-face sources (Node: zlib.brotliDecompressSync); without one a WOFF2 is refused. */
  readonly brotliDecompress?: BrotliDecompress;
  /** The CSS size the component's root starts at, before the view it mounts in reports its own size. */
  readonly viewport: { readonly width: number; readonly height: number };
  /**
   * 'enforced' (the default): the committed support profiles refuse what is not device-proven, and readiness is judged by the
   * committed lanes verdict. 'lanes': compile as the parity device lanes do (support derived, real bundled faces, interaction
   * states), to produce the output a device proof runs; its readiness is never 'ready'.
   */
  readonly support?: 'enforced' | 'lanes';
  /**
   * 'host': the host presents the top layer itself, so every <dialog> is laid out as shown with showModal(): in the top layer, a
   * child of the root box with its frame against the viewport, after its ::backdrop box. Absent: <dialog> is refused.
   */
  readonly topLayer?: 'host';
  /**
   * 'host': the host paints the canvas behind the page in each assignment's used colour scheme (NativeStyleOutput.schemes), so a
   * root whose color-scheme picks dark is drawn with Chrome's dark UA colours. Absent: a root color-scheme that can be dark is refused.
   */
  readonly canvas?: 'host';
  /**
   * 'host': the host app runs a form's submission and reset itself (a Markless app), so a submit or reset button inside a <form>
   * compiles. Absent: such a button is refused, as the native outputs submit and reset nothing.
   */
  readonly forms?: 'host';
  /**
   * 'program-and-sources' (the default): the state program and the Swift or Kotlin generated from it. 'program': the state program
   * only, for a host that applies the program as data itself; files is empty, and a write only the generated runtime lacks does not
   * block the target.
   */
  readonly output?: 'program-and-sources' | 'program';
  /**
   * 'measured': the font map's platform generics (system-ui, sans-serif, serif, monospace) and a font-family left at its initial
   * value resolve to system faces (fonts/system-faces.ts), each the platform's own font, measured per target at build time by the
   * caller's export; nothing is bundled. Only with support 'lanes'. Absent: native refuses them.
   */
  readonly systemFonts?: 'measured';
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
  /**
   * The sheet's @media bands, or null without @media: each atom is one media feature the device evaluates, each band the truth
   * vector of every atom; the program's env#band state selects one, so a band change is a setter like any other.
   */
  readonly bands: { readonly table: rtBand.BandTable; readonly conditions: readonly string[]; readonly initial: number } | null;
  /** Per program assignment: the root's used colour scheme there (css-color-adjust-1 §2.1) and Chrome's Canvas colour in it. */
  readonly schemes: readonly { readonly colorScheme: 'light' | 'dark'; readonly canvas: Rgba8 }[];
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
  return compileNativeStylesWith(config, input).styles;
}

/** compileNativeStyles with the compile result it read, for the internal facts of its cases (internal.ts). */
export function compileNativeStylesWith(config: NativeStylesConfig, input: FrontEndResult): { readonly styles: NativeStyles; readonly compiled: object } {
  const targets = (['ios', 'android'] as const).filter((t) => config.targets[t] !== undefined);
  if (targets.length === 0) throw new Error('compileNativeStyles needs at least one native target (ios or android)');
  if (!/^[A-Z][A-Za-z0-9]*$/.test(config.name)) throw new Error(`compileNativeStyles: the name ${JSON.stringify(config.name)} is not an identifier starting with an ASCII capital`);
  const { width, height } = config.viewport;
  if (![width, height].every((v) => Number.isFinite(v) && v > 0)) throw new Error(`compileNativeStyles: viewport ${width}x${height} is not a positive size`);
  const support = config.support ?? 'enforced';
  if (support !== 'enforced' && support !== 'lanes') throw new Error(`compileNativeStyles: support ${JSON.stringify(support)} is neither 'enforced' nor 'lanes'`);
  const project = createProjectWith(
    { projectId: config.projectId, targets: { ...config.targets }, ...(config.fonts === undefined ? {} : { fonts: config.fonts }) },
    {
      ...(support === 'enforced'
        ? { faults: NO_FAULTS, profiles: 'enforce' as const, direction: 'ltr' as const, nativeLanes: NATIVE_LANES }
        : { faults: NO_FAULTS, profiles: 'derive' as const, direction: 'ltr' as const, foldViewport: { width, height }, nativeRealFaces: true, interactionLanes: true }),
      ...(config.topLayer === 'host' ? { hostTopLayer: true } : {}),
      ...(config.canvas === 'host' ? { hostCanvas: true } : {}),
      ...(config.forms === 'host' ? { hostForms: true } : {}),
      ...(config.brotliDecompress === undefined ? {} : { brotliDecompress: config.brotliDecompress }),
      ...(config.systemFonts === 'measured' ? { systemFonts: true } : {}),
    },
  );
  if (config.systemFonts !== undefined && (config.systemFonts !== 'measured' || support !== 'lanes')) throw new Error(`compileNativeStyles: systemFonts ${JSON.stringify(config.systemFonts)} is 'measured', with support 'lanes'`);
  if (config.topLayer !== undefined && config.topLayer !== 'host') throw new Error(`compileNativeStyles: topLayer ${JSON.stringify(config.topLayer)} is not 'host'`);
  if (config.canvas !== undefined && config.canvas !== 'host') throw new Error(`compileNativeStyles: canvas ${JSON.stringify(config.canvas)} is not 'host'`);
  if (config.forms !== undefined && config.forms !== 'host') throw new Error(`compileNativeStyles: forms ${JSON.stringify(config.forms)} is not 'host'`);
  const output = config.output ?? 'program-and-sources';
  if (output !== 'program-and-sources' && output !== 'program') throw new Error(`compileNativeStyles: output ${JSON.stringify(output)} is neither 'program-and-sources' nor 'program'`);
  const compiled = project.compile(input) as unknown as Compiled<NativeStyleTarget>;
  const out: { [T in NativeStyleTarget]?: NativeStyleOutput | NativeStyleBlocked } = {};
  for (const t of targets) out[t] = targetOutput(compiled, t, config.name, config.viewport, output === 'program-and-sources');
  return { styles: { ok: targets.every((t) => out[t]?.kind === 'emitted'), digest: compiled.digest, diagnostics: compiled.diagnostics, targets: out }, compiled };
}

function targetOutput(compiled: Compiled<NativeStyleTarget>, t: NativeStyleTarget, name: string, viewport: NativeStylesConfig['viewport'], sources: boolean): NativeStyleOutput | NativeStyleBlocked {
  if (compiled.targets[t] !== 'checked') return { kind: 'blocked', reason: `the ${t} compile has errors; see the diagnostics` };
  const record = internalRecord(compiled);
  if (record === undefined) throw new Error('compileNativeStyles: the compile result carries no internal record');
  if (record.animation !== null && record.animation.features.length > 0) return { kind: 'blocked', reason: `the ${t} output has transitions or animations, which this entry point does not emit yet` };
  const backend = BACKEND[t];
  const bands = nativeBands(compiled);
  const count = bands === null ? 1 : bands.table.bands.length;
  const cases = [];
  for (const c of compiledCases(compiled)) {
    for (let band = 0; band < count; band++) {
      const partition = interactionPartitionIn(compiled, c.assignment, band);
      if (partition !== null && partition.states.length > 0) return { kind: 'blocked', reason: `the ${t} output has interaction states (:hover, :active, :focus), which this entry point does not emit yet` };
      const p = nativeBandProgramFor(compiled, c.assignment, band, t);
      if (p.kind === 'blocked') return { kind: 'blocked', reason: p.reason };
      cases.push({ assignment: c.assignment, isInitial: c.isInitial, band, program: p.program });
    }
  }
  try {
    const program = bands === null ? deriveStateProgram(backend, cases) : bandStateProgram(backend, cases, count, bands.initial);
    const schemes = program.assignments.map(({ assignment }) => {
      const isBand = (x: (typeof assignment)[number]): boolean => x.state.instance === ENV_INSTANCE && x.state.state === BAND_STATE;
      const band = assignment.find(isBand)?.value ?? 0;
      const s = usedSchemeOf(compiled, assignment.filter((x) => !isBand(x)), band as number);
      if (typeof s === 'string') throw new Error(`compileNativeStyles: ${s}`);
      return s;
    });
    if (!sources) return { kind: 'emitted', backend, program, files: [], readiness: compiled.outputs[t], bands, schemes };
    const emit: StateEmit = { id: name, name, fixture: '', direction: 'ltr', compilerDigest: compiled.digest, viewport, program, scripts: [], ...(bands === null ? {} : { band: bands.table }) };
    const path = backend === 'uikit' ? `Cases/Dragon${name}States.swift` : `kotlin/dev/dragon/cases/Dragon${name}States.kt`;
    const file = emitStatePrograms(backend, [emit]).find((f) => f.path === path);
    if (file === undefined) throw new Error(`compileNativeStyles: the ${backend} state emitter wrote no ${path}`);
    return { kind: 'emitted', backend, program, files: [file], readiness: compiled.outputs[t], bands, schemes };
  } catch (e) {
    if (e instanceof StateProgramError || e instanceof StateEmitError || e instanceof BandProgramError) return { kind: 'blocked', reason: e.message };
    throw e;
  }
}
