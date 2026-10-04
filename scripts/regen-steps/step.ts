// The shape of a regen step (scripts/regen.ts), the helpers the step lists share, and how a feature's additions are placed.
export type Step = {
  readonly name: string;
  readonly argv: readonly string[];
  /** Every committed path the step writes (macroscope-ignore glob syntax); a change anywhere else fails the run. */
  readonly outputs: readonly string[];
  /** Tree files the step reads as data (fixtures, case lists, other steps' outputs), beyond the import closure of its code. */
  readonly reads?: readonly string[];
  /** Directories the step lists without reading every file below them: the names directly inside each are inputs. */
  readonly lists?: readonly string[];
  /** Modules the step imports by a computed path: their import closures are inputs too. */
  readonly imports?: readonly string[];
  /** Installed packages the step reads as files rather than importing them. */
  readonly packages?: readonly string[];
  /** Environment variables that are inputs of the step. */
  readonly env?: readonly string[];
  /** Whether a non-zero exit is a verdict the step recorded rather than a failure to regenerate. */
  readonly verdict?: (code: number, log: string) => boolean;
};

/** A tracked generated output regen does not rebuild, and the command that produces it. */
export type ManualOutput = { readonly command: string; readonly outputs: readonly string[] };

/** One feature's regen additions: steps placed after a named step, extra outputs of existing steps, and MANUAL entries. */
export type RegenFeature = {
  readonly steps: readonly { readonly after: string; readonly step: Step }[];
  readonly outputs: { readonly [step: string]: readonly string[] };
  readonly manual: readonly ManualOutput[];
};

export const NO_REGEN: RegenFeature = { steps: [], outputs: {}, manual: [] };

export const pnpm = (...a: string[]): string[] => ['pnpm', '-s', 'run', ...a];
export const FIXTURES = 'packages/parity/fixtures/**';
export const FONTS = 'vendor/fonts/**';
// The translator reads the layout engine's sources as text and lowers them to Swift and Kotlin.
export const ENGINE_SOURCES = ['packages/layout/src/**', 'packages/layout/package.json'];

/**
 * The steps in run order: the base steps, each followed by the feature steps that name it, features in id order (a feature step
 * may name an earlier feature's step), with every feature's extra outputs appended to the step they name. Throws on a step
 * name that is no step.
 */
export function placeSteps(base: readonly Step[], features: { readonly [feature: string]: RegenFeature }): Step[] {
  const out = [...base];
  // The step each placed step follows; a step goes after its anchor and after every step already placed after that anchor.
  const parent = new Map<string, string>();
  const follows = (name: string, anchor: string): boolean => {
    for (let p = parent.get(name); p !== undefined; p = parent.get(p)) if (p === anchor) return true;
    return false;
  };
  for (const id of Object.keys(features).sort()) {
    const f = features[id] as RegenFeature;
    for (const { after, step } of f.steps) {
      let at = out.findIndex((s) => s.name === after);
      if (at < 0) throw new Error(`regen: ${id} places step ${step.name} after ${after}, which is no step`);
      while (at + 1 < out.length && follows((out[at + 1] as Step).name, after)) at++;
      out.splice(at + 1, 0, step);
      parent.set(step.name, after);
    }
  }
  for (const id of Object.keys(features).sort()) {
    for (const [name, extra] of Object.entries((features[id] as RegenFeature).outputs)) {
      const at = out.findIndex((s) => s.name === name);
      if (at < 0) throw new Error(`regen: ${id} adds outputs to ${name}, which is no step`);
      out[at] = { ...(out[at] as Step), outputs: [...(out[at] as Step).outputs, ...extra] };
    }
  }
  return out;
}
