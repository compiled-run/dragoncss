// The entry point a framework build calls for one component's native styles (docs/markless-native-styles.md): the component's CSS
// and element tree in, per native backend the state program (plain data) and the Swift or Kotlin generated from that same program.
import type { ImageAssetMap } from './images/manifest.ts';
import type { CompilerFaults } from './faults.ts';
import { NO_FAULTS } from './faults.ts';
import type { StateEmit } from './emit/runtime/state.ts';
import { emitStatePrograms, StateEmitError } from './emit/runtime/state.ts';
import { animProgramOf, BAND_STATE, compiledCases, ENV_INSTANCE, forcedOnlyStatesIn, interactionLevelInputIn, interactionPartitionIn, nativeBandProgramFor, nativeBands, stateGroupsIn, usedSchemeOf } from './internal.ts';
import type { InteractionLevel, InteractionProgram } from './lower/interaction-program.ts';
import type { InteractionValue } from './analysis/interaction.ts';
import { deriveInteractionProgram, interactionProgramAt } from './lower/interaction-program.ts';
import type { AnimProgram } from './lower/anim-program.ts';
import type { rtBand } from '@dragon/layout';
import type { RuntimeImageLayout } from './images/runtime.ts';
import { BandProgramError, bandStateProgram } from './lower/band-program.ts';
import type { NativeBackend, NativeProgram } from './lower/native-program.ts';
import type { StateProgram } from './lower/state-program.ts';
import { deriveStateProgram, programAt, stateKey, StateProgramError } from './lower/state-program.ts';
import { BAND_KEY } from './lower/band-program.ts';
import { canonicalJson } from './digest.ts';
import type { LayoutBox } from '@dragon/layout';
import { NATIVE_LANES } from './profiles/native-lanes.ts';
import { createProjectWith, internalRecord } from './project.ts';
import type { BrotliDecompress } from './fonts/woff.ts';
import type { Rgba8 } from './css/color.ts';
import type { ArtifactState, Assignment, Compiled, Diagnostic, FontMap, FrontEndResult, GeneratedFile } from './types.ts';

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
   * 'host': the host draws and edits every single-line text field natively (its caret, selection and keyboard), over the editor
   * box Dragon lays out, so an editable field is laid out as a readonly one is. Absent: an editable field is refused on native.
   */
  readonly textEditing?: 'host';
  /** factored: a page whose assignments native cannot hold in one table gets one table per group of states (analysis/link.ts StateGroup). */
  readonly states?: 'factored' | 'factored-always';
  /**
   * The image map (docs/api.md): each `<img src>` the component shows that is not a data: URL, to the snapshot asset holding its
   * bytes. Dragon sizes the element from the file's natural size and lists its bytes for the native image paint.
   */
  readonly images?: ImageAssetMap;
  /**
   * 'host': the host draws each <img>'s picture itself from the file's bytes (a Markless host). Dragon sizes the <img> from the file's
   * natural size and writes no image content for it, so a JPEG or GIF is laid out rather than refused; an object-fit other than fill
   * is refused, as the host draws the picture filling its box.
   */
  readonly imagePaint?: 'host';
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
  /** REPL-r1: the export devices an img whose src is set at run time is proven at, with their measurers; without it such an img is refused. */
  readonly runtimeImageLayout?: RuntimeImageLayout;
  /** Planted compiler faults (faults.ts), for the fault proofs only; absent: none. */
  readonly faults?: CompilerFaults;
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
   * With support 'lanes' only: the transitions and animations of the program's assignments, in its assignment order, for the
   * host to run with Dragon's animator (layout/src/rt-animator.ts); absent when the sheet has none.
   */
  readonly anim?: AnimProgram;
  /**
   * With support 'lanes' only: the interaction program over `program` (lower/interaction-program.ts), for the host to run with
   * Dragon's interaction runtime (layout/src/rt-interaction.ts); absent when no assignment has an interaction state.
   */
  readonly interaction?: InteractionProgram;
  /** With interaction: per level, each state's value (analysis/interaction.ts): what it matches and what Chrome forces to reach it. */
  readonly interactionValues?: readonly (readonly InteractionValue[])[];
  /**
   * The sheet's @media bands, or null without @media: each atom is one media feature the device evaluates, each band the truth
   * vector of every atom; the program's env#band state selects one, so a band change is a setter like any other.
   */
  readonly bands: { readonly table: rtBand.BandTable; readonly conditions: readonly string[]; readonly initial: number } | null;
  /** With system fonts, each bundled face's system fallback by face id ('' where two family lists go on to different ones). */
  readonly fontFallbacks?: Readonly<Record<string, string>>;
  /** Per program assignment: the root's used colour scheme there (css-color-adjust-1 §2.1) and Chrome's Canvas colour in it. */
  readonly schemes: readonly { readonly colorScheme: 'light' | 'dark'; readonly canvas: Rgba8 }[];
  /**
   * Factored states (config states 'factored', analysis/link.ts StateGroup): program then holds the initial assignment alone (in each
   * band), and each group its own table over the group's states with every other state initial. A node takes its record from the
   * table of the group that owns it, or from program when no group does.
   */
  readonly groups?: readonly NativeStateGroup[];
};

/** One group's table: its states' keys, its program over them (every other state initial), and the nodes only it changes. */
export type NativeStateGroup = {
  readonly states: readonly string[];
  readonly program: StateProgram;
  readonly owned: readonly string[];
  readonly schemes: NativeStyleOutput['schemes'];
  readonly interaction?: InteractionProgram;
  readonly interactionValues?: readonly (readonly InteractionValue[])[];
  /**
   * When two @media bands, but not all, share the group's rows: per band, the band whose rows it reads, the only values its band
   * state takes; the band state of a combined page takes that band's value in this group.
   */
  readonly bandClasses?: readonly number[];
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
    { projectId: config.projectId, targets: { ...config.targets }, ...(config.fonts === undefined ? {} : { fonts: config.fonts }), ...(config.images === undefined ? {} : { images: config.images }) },
    {
      ...(support === 'enforced'
        ? { faults: config.faults ?? NO_FAULTS, profiles: 'enforce' as const, direction: 'ltr' as const, nativeLanes: NATIVE_LANES }
        : { faults: config.faults ?? NO_FAULTS, profiles: 'derive' as const, direction: 'ltr' as const, foldViewport: { width, height }, nativeRealFaces: true, interactionLanes: true }),
      ...(config.topLayer === 'host' ? { hostTopLayer: true } : {}),
      ...(config.canvas === 'host' ? { hostCanvas: true } : {}),
      ...(config.forms === 'host' ? { hostForms: true } : {}),
      ...(config.textEditing === 'host' ? { hostTextEditing: true } : {}),
      hostUnforced: true,
      ...(config.imagePaint === 'host' ? { hostImages: true } : {}),
      ...(config.states === 'factored' ? { factorStates: 'over-limits' as const } : config.states === 'factored-always' ? { factorStates: 'always' as const } : {}),
      ...(config.brotliDecompress === undefined ? {} : { brotliDecompress: config.brotliDecompress }),
      ...(config.systemFonts === 'measured' ? { systemFonts: true } : {}),
      ...(config.runtimeImageLayout === undefined ? {} : { runtimeImageLayout: config.runtimeImageLayout }),
    },
  );
  if (config.systemFonts !== undefined && (config.systemFonts !== 'measured' || support !== 'lanes')) throw new Error(`compileNativeStyles: systemFonts ${JSON.stringify(config.systemFonts)} is 'measured', with support 'lanes'`);
  if (config.topLayer !== undefined && config.topLayer !== 'host') throw new Error(`compileNativeStyles: topLayer ${JSON.stringify(config.topLayer)} is not 'host'`);
  if (config.canvas !== undefined && config.canvas !== 'host') throw new Error(`compileNativeStyles: canvas ${JSON.stringify(config.canvas)} is not 'host'`);
  if (config.forms !== undefined && config.forms !== 'host') throw new Error(`compileNativeStyles: forms ${JSON.stringify(config.forms)} is not 'host'`);
  if (config.states !== undefined && config.states !== 'factored' && config.states !== 'factored-always') throw new Error(`compileNativeStyles: states ${JSON.stringify(config.states)} is neither 'factored' nor 'factored-always'`);
  if (config.textEditing !== undefined && config.textEditing !== 'host') throw new Error(`compileNativeStyles: textEditing ${JSON.stringify(config.textEditing)} is not 'host'`);
  const output = config.output ?? 'program-and-sources';
  if (output !== 'program-and-sources' && output !== 'program') throw new Error(`compileNativeStyles: output ${JSON.stringify(output)} is neither 'program-and-sources' nor 'program'`);
  const compiled = project.compile(input) as unknown as Compiled<NativeStyleTarget>;
  const out: { [T in NativeStyleTarget]?: NativeStyleOutput | NativeStyleBlocked } = {};
  for (const t of targets) out[t] = targetOutput(compiled, t, config.name, config.viewport, output === 'program-and-sources', support === 'lanes' && output === 'program');
  return { styles: { ok: targets.every((t) => out[t]?.kind === 'emitted'), digest: compiled.digest, diagnostics: compiled.diagnostics, targets: out }, compiled };
}

/** The interaction program over a target's state program: one level per program assignment, from its case in its band. */
function interactionProgramOf(compiled: Compiled<NativeStyleTarget>, program: StateProgram, backend: NativeBackend, bandless = 0): { readonly program: InteractionProgram; readonly values: readonly (readonly InteractionValue[])[] } | string {
  const isBand = (x: StateProgram['assignments'][number]['assignment'][number]): boolean => x.state.instance === ENV_INSTANCE && x.state.state === BAND_STATE;
  const inputs = [];
  const values: InteractionValue[][] = [];
  for (const { assignment } of program.assignments) {
    const band = (assignment.find(isBand)?.value ?? bandless) as number;
    const input = interactionLevelInputIn(compiled, assignment.filter((x) => !isBand(x)), band, backend);
    if (typeof input === 'string') return input;
    inputs.push(input);
    const skipped = forcedOnlyStatesIn(compiled, assignment.filter((x) => !isBand(x)), band);
    // A skipped state keeps its matches but is the assignment's own styles, so it forces nothing.
    values.push(input.partition.states.map((v, k) => (skipped[k] === true ? { ...v, force: [] } : v)));
  }
  return { program: deriveInteractionProgram(program, inputs), values };
}

function targetOutput(compiled: Compiled<NativeStyleTarget>, t: NativeStyleTarget, name: string, viewport: NativeStylesConfig['viewport'], sources: boolean, hostAnimates: boolean): NativeStyleOutput | NativeStyleBlocked {
  if (compiled.targets[t] !== 'checked') return { kind: 'blocked', reason: `the ${t} compile has errors; see the diagnostics` };
  const record = internalRecord(compiled);
  if (record === undefined) throw new Error('compileNativeStyles: the compile result carries no internal record');
  const animated = record.animation !== null && record.animation.features.length > 0;
  // A host that runs Dragon's animator itself (support 'lanes', program only) gets the tables; generated sources do not run them yet.
  if (animated && !hostAnimates) return { kind: 'blocked', reason: `the ${t} output has transitions or animations, which this entry point does not emit yet` };
  const backend = BACKEND[t];
  const bands = nativeBands(compiled);
  if (animated && bands !== null) return { kind: 'blocked', reason: `the ${t} output has transitions or animations under @media, which a host does not run yet` };
  const count = bands === null ? 1 : bands.table.bands.length;
  const all = compiledCases(compiled);
  const groups = stateGroupsIn(compiled);
  if (groups !== null && animated) return { kind: 'blocked', reason: `the ${t} output has transitions or animations and states in groups, which a host does not run yet` };
  let interactive = false;
  // One table's per-case programs over the given cases in the bands it holds: every band, or a group's band classes (analysis
  // bandClasses), the band each class reads; a group whose elements style alike in every band is laid out in the initial band alone,
  // with no band state.
  type TableCase = { readonly assignment: Assignment; readonly isInitial: boolean; readonly band: number; readonly program: NativeProgram };
  const heldBands = (classes: readonly number[] | null): readonly number[] => (classes === null ? [...Array(count).keys()] : [...new Set(classes)].sort((x, y) => x - y));
  const oneBandOf = (classes: readonly number[] | null): boolean => bands !== null && classes !== null && heldBands(classes).length === 1;
  const casesOf = (given: readonly { readonly assignment: Assignment; readonly isInitial: boolean }[], classes: readonly number[] | null = null): TableCase[] | string => {
    const cases: TableCase[] = [];
    for (const c of given) {
      for (const band of heldBands(classes)) {
        const partition = interactionPartitionIn(compiled, c.assignment, band);
        if (partition !== null && partition.states.length > 0) {
          // A host that runs Dragon's interaction runtime itself (support 'lanes', program only) gets the interaction program.
          if (!hostAnimates) return `the ${t} output has interaction states (:hover, :active, :focus), which this entry point does not emit yet`;
          interactive = true;
        }
        const p = nativeBandProgramFor(compiled, c.assignment, band, t);
        if (p.kind === 'blocked') return p.reason;
        cases.push({ assignment: c.assignment, isInitial: c.isInitial, band, program: p.program });
      }
    }
    return cases;
  };
  // Its program and each assignment's colour scheme.
  const tableOf = (cases: readonly TableCase[], classes: readonly number[] | null = null) => {
    const oneBand = oneBandOf(classes);
    const program = bands === null || oneBand ? deriveStateProgram(backend, cases) : bandStateProgram(backend, cases, count, bands.initial, undefined, undefined, heldBands(classes));
    const schemes = program.assignments.map(({ assignment }) => {
      const isBand = (x: (typeof assignment)[number]): boolean => x.state.instance === ENV_INSTANCE && x.state.state === BAND_STATE;
      const band = assignment.find(isBand)?.value ?? (oneBand && bands !== null ? bands.initial : 0);
      const s = usedSchemeOf(compiled, assignment.filter((x) => !isBand(x)), band as number);
      if (typeof s === 'string') throw new Error(`compileNativeStyles: ${s}`);
      return s;
    });
    return { program, schemes };
  };
  const pageCases = casesOf(groups === null ? all : all.filter((c) => c.isInitial));
  if (typeof pageCases === 'string') return { kind: 'blocked', reason: pageCases };
  const groupCases = (groups ?? []).map((g) => casesOf(g.cases, g.bandClasses));
  const groupRefused = groupCases.find((c): c is string => typeof c === 'string');
  if (groupRefused !== undefined) return { kind: 'blocked', reason: groupRefused };
  try {
    const { program, schemes } = tableOf(pageCases);
    let factored: NativeStateGroup[] | null = null;
    if (groups !== null) {
      const tables = groups.map((g, k) => {
        const table = tableOf(groupCases[k] as TableCase[], g.bandClasses);
        const interaction = interactive ? interactionProgramOf(compiled, table.program, backend, bands === null ? 0 : bands.initial) : null;
        return { table, interaction };
      });
      const refused = tables.find((x) => typeof x.interaction === 'string');
      if (refused !== undefined) return { kind: 'blocked', reason: refused.interaction as string };
      const built = groupTables(tables.map(({ table, interaction }, k) => ({ ...table, interaction: interaction as Exclude<typeof interaction, string>, bandClasses: (groups[k] as { readonly bandClasses: readonly number[] | null }).bandClasses })), program);
      if (typeof built === 'string') return { kind: 'blocked', reason: built };
      factored = built;
    }
    const anim = animated ? animProgramOf(compiled, program.assignments.map((a) => a.assignment)) : null;
    // The animator's tables cover the program's assignments only, so a state would run with no tables for it.
    if (interactive && animated) return { kind: 'blocked', reason: `the ${t} output has transitions or animations and interaction states together, which a host does not run yet` };
    const interaction = interactive ? interactionProgramOf(compiled, program, backend) : null;
    if (typeof interaction === 'string') return { kind: 'blocked', reason: interaction };
    const fallbacks = record.fontFallbacks.size === 0 ? {} : { fontFallbacks: Object.fromEntries(record.fontFallbacks) };
    if (!sources) return { kind: 'emitted', backend, program, files: [], readiness: compiled.outputs[t], bands, schemes, ...fallbacks, ...(anim === null ? {} : { anim }), ...(interaction === null ? {} : { interaction: interaction.program, interactionValues: interaction.values }), ...(factored === null ? {} : { groups: factored }) };
    if (factored !== null) return { kind: 'blocked', reason: `the ${t} output has states in groups, which the generated sources do not run yet` };
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

/**
 * The groups' tables, each owning the nodes and layout boxes its assignments, or their interaction states, change from the group's
 * initial assignment in the same band. An id two groups change, or a paragraph two groups' texts share, is the analysis's error
 * (analysis/link.ts groups states that read one element), reported as the reason.
 */
function groupTables(tables: readonly { readonly program: StateProgram; readonly schemes: NativeStyleOutput['schemes']; readonly interaction: { readonly program: InteractionProgram; readonly values: readonly (readonly InteractionValue[])[] } | null; readonly bandClasses: readonly number[] | null }[], page: StateProgram): NativeStateGroup[] | string {
  const owner = new Map<string, number>();
  const out: NativeStateGroup[] = [];
  const pageInitial = page.assignments[page.initial]?.assignment ?? [];
  const valueOf = (a: Assignment, key: string): unknown => a.find((x) => stateKey(x.state.instance, x.state.state) === key)?.value;
  for (const [k, { program, schemes, interaction, bandClasses }] of tables.entries()) {
    const states = program.states.filter((v) => v.domain.length > 1 && v.key !== BAND_KEY).map((v) => v.key);
    const initialIn = (a: Assignment): number => program.assignments.findIndex((x) => valueOf(x.assignment, BAND_KEY) === valueOf(a, BAND_KEY) && states.every((s) => valueOf(x.assignment, s) === valueOf(pageInitial, s)));
    const owned = new Set<string>();
    program.assignments.forEach(({ assignment }, i) => {
      const j = initialIn(assignment);
      if (j < 0) throw new Error(`compileNativeStyles: group ${states.join(', ')} has no initial assignment in a band`);
      if (i === j) return;
      for (const id of changedIds(programAt(program, i), programAt(program, j))) owned.add(id);
      // Every hovered, pressed and focused element a host's runtime can reach, in the assignment and in the initial one.
      if (interaction !== null) for (const id of interactionChanges(interaction.program, i, j)) owned.add(id);
    });
    for (const id of owned) {
      const other = owner.get(id);
      if (other !== undefined) return `${id} changes with the states of two groups (${(out[other] as NativeStateGroup).states.join(', ')}; ${states.join(', ')}), so their tables cannot be combined`;
      owner.set(id, k);
    }
    // Its band state holds only the bands its classes read when two bands share one (and none when every band does).
    const classed = bandClasses !== null && new Set(bandClasses).size > 1 && new Set(bandClasses).size < bandClasses.length;
    out.push({ states, program, owned: [...owned].sort(), schemes, ...(interaction === null ? {} : { interaction: interaction.program, interactionValues: interaction.values }), ...(classed ? { bandClasses } : {}) });
  }
  // A phone shapes a paragraph's text only as Dragon laid it out, a whole font run at a time: at most one group may change it.
  const ownerOf = (id: string): number => owner.get(`box:${id}`) ?? -1;
  const mixed = (root: LayoutBox): string | null => {
    const inline = root.children.filter((c) => c.kind === 'text' || c.kind === 'inline');
    const owners = new Set(inline.map((c) => ownerOf((c as { readonly id: string }).id)).filter((o) => o >= 0));
    if (owners.size > 1) return root.id;
    for (const c of root.children) {
      if (c.kind !== 'box') continue;
      const found = mixed(c);
      if (found !== null) return found;
    }
    return null;
  };
  for (const g of out) {
    for (let i = 0; i < g.program.assignments.length; i++) {
      const found = mixed(programAt(g.program, i).root);
      if (found !== null) return `the text of ${found} changes with more than one group of states, and a phone shapes a paragraph only as Dragon laid it out`;
    }
  }
  return out;
}

/**
 * The ids whose records differ between assignments i and j of a table in some interaction state a host reaches: every hovered,
 * pressed and focused (by pointer or key) element, each entry's state for it as the interaction runtime picks it from the level's
 * tables (layout/src/rt-interaction.ts interactionCombo). A host never forces a state, so forced ones are not compared.
 */
function interactionChanges(ip: InteractionProgram, i: number, j: number): Set<string> {
  const out = new Set<string>();
  const li = ip.levels[i] as InteractionLevel;
  const lj = ip.levels[j] as InteractionLevel;
  const addresses = [...new Set([...li.addresses, ...lj.addresses])];
  // A combination's state depends on the elements only through their hover chain, active chain and focus values, so each
  // dimension's distinct (value in i, value in j) pairs are collected over the elements, and only their product is looked up.
  const indexes = new Map([li, lj].map((l) => [l, new Map(l.addresses.map((x, k) => [x, k]))] as const));
  const valueIn = (level: InteractionLevel, address: string | null, of: (t: InteractionLevel['tables'], e: number) => number): number => {
    const e = address === null ? -1 : ((indexes.get(level) as Map<string, number>).get(address) ?? -1);
    return e < 0 ? 0 : of(level.tables, e);
  };
  const pairsOf = (of: (t: InteractionLevel['tables'], e: number) => number): [number, number][] => {
    const seen = new Map<string, [number, number]>();
    for (const x of [null, ...addresses]) {
      const pair: [number, number] = [valueIn(li, x, of), valueIn(lj, x, of)];
      seen.set(pair.join(','), pair);
    }
    return [...seen.values()];
  };
  const hovers = pairsOf((t, e) => t.chainOf[e] as number);
  const actives = pairsOf((t, e) => t.activeChainOf[e] as number);
  const focuses = [...pairsOf((t, e) => t.pointerFocusOf[e] as number), ...pairsOf((t, e) => (t.focusable[e] === true ? (t.keyboardFocusOf[e] as number) : 0))];
  const comboIn = (t: InteractionLevel['tables'], h: number, a: number, f: number): number => t.combos[(h * t.activeValues + a) * t.focusValues + f] as number;
  const pairs = new Set<string>();
  for (const [hi, hj] of hovers) for (const [ai, aj] of actives) for (const [fi, fj] of focuses) pairs.add(`${comboIn(li.tables, hi, ai, fi)},${comboIn(lj.tables, hj, aj, fj)}`);
  const shown = (at: number, k: number): NativeProgram => (k < 0 ? programAt(ip.program, at) : interactionProgramAt(ip, at, k));
  for (const pair of pairs) {
    const [ki, kj] = pair.split(',').map(Number) as [number, number];
    for (const id of changedIds(shown(i, ki), shown(j, kj))) out.add(id);
  }
  return out;
}

/** The node and layout box ids whose record (a box's without its child boxes) differs, or that one program has and the other not. */
function changedIds(a: NativeProgram, b: NativeProgram): Set<string> {
  // A paint-order write's rank and index count the layer items shown beside it: they change with another group's items, while the
  // order among the items both programs show is the node's own. Where that order is the same, the numbers are left out.
  const stacked = (p: NativeProgram): Map<string, { readonly host: string; readonly bucket: number; readonly rank: number }> => new Map(p.nodes.flatMap((n) => n.writes.flatMap((w) => (w.kind === 'paint-order' ? [[n.id, w as unknown as { readonly host: string; readonly bucket: number; readonly rank: number }] as const] : []))));
  const [sa, sb] = [stacked(a), stacked(b)];
  const reordered = new Set<string>();
  for (const host of new Set([...sa.values()].map((w) => w.host))) {
    const common = (s: typeof sa, t: typeof sa): string[] => [...s].filter(([id, w]) => w.host === host && t.get(id)?.host === host).sort(([, x], [, y]) => x.bucket - y.bucket || x.rank - y.rank).map(([id]) => id);
    if (common(sa, sb).join('\u0000') !== common(sb, sa).join('\u0000')) reordered.add(host);
  }
  const relative = (n: NativeProgram['nodes'][number]): NativeProgram['nodes'][number]['writes'] => n.writes.map((w) => {
    if (w.kind !== 'paint-order') return w;
    const { rank: _rank, index: _index, ...rest } = w as unknown as { readonly host: string; readonly rank: number; readonly index: number };
    return (reordered.has(rest.host) ? w : rest) as unknown as typeof w;
  });
  const records = (p: NativeProgram): Map<string, string> => {
    const out = new Map<string, string>();
    // A node's analysis facts (its rank in the page's paint order) are not exported; its writes, which a host applies, are.
    for (const { facts: _facts, ...n } of p.nodes) out.set(`node:${n.id}`, canonicalJson({ ...n, writes: relative(n as NativeProgram['nodes'][number]) }));
    const hasId = (c: LayoutBox['children'][number]): c is LayoutBox['children'][number] & { readonly id: string } => 'id' in c && typeof c.id === 'string';
    // A box's child list is its children's presence, which each child's own group decides; children without an id are its own. Its
    // parent is part of it: a leaf an anonymous box wraps moves.
    const walk = (box: LayoutBox, parent: string): void => {
      const { children, ...own } = box;
      out.set(`box:${box.id}`, canonicalJson({ own, parent, leaves: children.filter((c) => !hasId(c)) }));
      for (const c of children) {
        if (c.kind === 'box') walk(c, box.id);
        else if (hasId(c)) out.set(`box:${c.id}`, canonicalJson({ leaf: c, parent: box.id }));
      }
    };
    walk(p.root, '');
    return out;
  };
  const x = records(a);
  const y = records(b);
  const out = new Set<string>();
  for (const key of new Set([...x.keys(), ...y.keys()])) if (x.get(key) !== y.get(key)) out.add(key);
  return out;
}

