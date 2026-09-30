// The parity corpus. Every fixture is attempted in every run; none carries its own tolerance.
import type { BackgroundResetLonghand, DiagnosticCode, Environment } from 'dragon';
import { ATTRIBUTES } from './fixture-groups/attributes.ts';
import { BACKGROUND } from './fixture-groups/background.ts';
import { BLOCK_ELEMENTS } from './fixture-groups/block-elements.ts';
import { CONTEXTS } from './fixture-groups/contexts.ts';
import { CASCADE_VAR } from './fixture-groups/cascade-var.ts';
import { GRID } from './fixture-groups/grid.ts';
import { LOGICAL_PROPS } from './fixture-groups/logical-props.ts';
import { MILESTONE_1 } from './fixture-groups/milestone-1.ts';
import { SELECTORS } from './fixture-groups/selectors.ts';
import { UNITS } from './fixture-groups/units.ts';
import { VALUES } from './fixture-groups/values.ts';

/**
 * The reference environment of every case in this lane (docs/api.md §7, §10.1): an input to the projection, the engine and Chrome.
 * The root font-family is Ahem, so no capture depends on the platform's default font; fixtures that compare Chrome's UA font
 * declare rootFont 'ua-default' and compare against the keyed UA dataset.
 */
export const ENVIRONMENT: Environment = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ahem' };

/** The same environment right-to-left (docs/api.md §7): every tree fixture case also runs here, as its own case ("<case>-rtl"). */
export const RTL_ENVIRONMENT: Environment = { ...ENVIRONMENT, direction: 'rtl' };

/** The environments a layout fixture's cases run in, from its registry field: tree fixtures run in both directions, HTML fixtures
 * in the directions they declare (left-to-right unless the registry says otherwise). */
export function environmentsOf(spec: FixtureSpec): readonly Environment[] {
  if (spec.kind !== 'layout') return [ENVIRONMENT];
  return spec.environments.map((d) => ({ ...(d === 'rtl' ? RTL_ENVIRONMENT : ENVIRONMENT), rootFont: spec.rootFont }));
}

/** The case id suffix of a direction: none for ltr, "-rtl" for rtl. */
export const directionSuffix = (direction: Environment['direction']): string => (direction === 'rtl' ? '-rtl' : '');

export type FixtureSpec =
  | {
      readonly id: string;
      readonly format: 'html' | 'tree';
      readonly kind: 'layout';
      readonly gate: 'default';
      /** The environment directions the fixture runs in, each with its own cases and captures ('<case>-rtl' for rtl). */
      readonly environments: readonly Environment['direction'][];
      /** hand-written, or written by a committed generator (scripts/gen-*.ts) from its committed selection. */
      readonly source: 'hand-written' | 'generated';
      /** The environment root font: 'ahem', or 'ua-default' for a fixture that compares Chrome's UA font with the keyed dataset. */
      readonly rootFont: Environment['rootFont'];
      /**
       * Background longhands Dragon does not model, captured and compared besides LONGHANDS: in both renderings Chrome must compute
       * each to the initial value Dragon holds it at (BACKGROUND_RESET_LONGHANDS). Absent means none.
       */
      readonly computedExtra?: readonly BackgroundResetLonghand[];
    }
  | {
      readonly id: string;
      readonly format: 'html' | 'tree';
      readonly kind: 'reject';
      /** spanText null: the diagnostic is unlocated. messagePrefix: the diagnostic message must start with it (M4), or null. */
      readonly expect: { readonly code: DiagnosticCode; readonly spanText: string | null; readonly messagePrefix: string | null };
    };

/**
 * The fixture groups, in run order: FIXTURES is their concatenation. milestone-1 comes first and never changes; a feature
 * package adds its own packages/parity/src/fixture-groups/<group>.ts and appends one entry here.
 */
export const FIXTURE_GROUPS: readonly { readonly id: string; readonly fixtures: readonly FixtureSpec[] }[] = [
  { id: 'milestone-1', fixtures: MILESTONE_1 },
  { id: 'logical-props', fixtures: LOGICAL_PROPS },
  { id: 'background', fixtures: BACKGROUND },
  { id: 'selectors', fixtures: SELECTORS },
  { id: 'block-elements', fixtures: BLOCK_ELEMENTS },
  { id: 'units', fixtures: UNITS },
  { id: 'contexts', fixtures: CONTEXTS },
  { id: 'cascade-var', fixtures: CASCADE_VAR },
  { id: 'attributes', fixtures: ATTRIBUTES },
  { id: 'grid', fixtures: GRID },
  { id: 'values', fixtures: VALUES },
];

export const FIXTURES: readonly FixtureSpec[] = FIXTURE_GROUPS.flatMap((g) => g.fixtures);
