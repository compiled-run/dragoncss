// The parity corpus. Every fixture is attempted in every run; none carries its own tolerance.
import type { BackgroundResetLonghand, DiagnosticCode, Environment, WritingModeResetLonghand } from 'dragon';
import { ALIASES } from './fixture-groups/aliases.ts';
import { ANIMATIONS } from './fixture-groups/animations.ts';
import { ATOMIC_INLINE } from './fixture-groups/atomic-inline.ts';
import { ATTRIBUTES } from './fixture-groups/attributes.ts';
import { BACKGROUND } from './fixture-groups/background.ts';
import { BG_POSITION } from './fixture-groups/bg-position.ts';
import { BLOCK_ELEMENTS } from './fixture-groups/block-elements.ts';
import { BORDER_PAINT } from './fixture-groups/border-paint.ts';
import { CASC_LAYER } from './fixture-groups/casc-layer.ts';
import { CASC_PROPERTY } from './fixture-groups/casc-property.ts';
import { CASC } from './fixture-groups/casc.ts';
import { CASCADE_VAR } from './fixture-groups/cascade-var.ts';
import { CHARSET } from './fixture-groups/charset.ts';
import { CLIP_RECT } from './fixture-groups/clip-rect.ts';
import { CONTEXTS } from './fixture-groups/contexts.ts';
import { CTX_PROOF } from './fixture-groups/ctx-proof.ts';
import { DISPLAY_LEGACY } from './fixture-groups/display-legacy.ts';
import { EFFECTS } from './fixture-groups/effects.ts';
import { ENV } from './fixture-groups/env.ts';
import { FONT_SHORTHAND } from './fixture-groups/font-shorthand.ts';
import { FONTS } from './fixture-groups/fonts.ts';
import { GRADIENTS } from './fixture-groups/gradients.ts';
import { GRID } from './fixture-groups/grid.ts';
import { INERT_LAYOUT } from './fixture-groups/inert-layout.ts';
import { INHERIT_CONTEXTS } from './fixture-groups/inherit-contexts.ts';
import { INLINE_TAGS } from './fixture-groups/inline-tags.ts';
import { INLINE } from './fixture-groups/inline.ts';
import { INTERACTION } from './fixture-groups/interaction.ts';
import { LINE_CLAMP } from './fixture-groups/line-clamp.ts';
import { LIST_ITEMS } from './fixture-groups/list-items.ts';
import { LOGICAL_PROPS } from './fixture-groups/logical-props.ts';
import { MEDIA_RUNTIME } from './fixture-groups/media-runtime.ts';
import { MEDIA } from './fixture-groups/media.ts';
import { MILESTONE_1 } from './fixture-groups/milestone-1.ts';
import { OUTLINE } from './fixture-groups/outline.ts';
import { OVERFLOW } from './fixture-groups/overflow.ts';
import { PHRASING_BLOCKIFIED } from './fixture-groups/phrasing-blockified.ts';
import { RADIUS } from './fixture-groups/radius.ts';
import { REM_CONTEXTS } from './fixture-groups/rem-contexts.ts';
import { REPLACED } from './fixture-groups/replaced.ts';
import { RESIZE } from './fixture-groups/resize.ts';
import { SELECTION } from './fixture-groups/selection.ts';
import { SELECTORS } from './fixture-groups/selectors.ts';
import { SHADOW } from './fixture-groups/shadow.ts';
import { SHOWCASE } from './fixture-groups/showcase.ts';
import { SIZING_KEYWORDS } from './fixture-groups/sizing-keywords.ts';
import { SIZING } from './fixture-groups/sizing.ts';
import { STATES } from './fixture-groups/states.ts';
import { SVG } from './fixture-groups/svg.ts';
import { TEXT_BREAK } from './fixture-groups/text-break.ts';
import { TEXT_CALIBRATION } from './fixture-groups/text-calibration.ts';
import { TEXT_DECORATION } from './fixture-groups/text-decoration.ts';
import { TEXT_FILL_STROKE } from './fixture-groups/text-fill-stroke.ts';
import { TEXT_FONT_FEATURES } from './fixture-groups/text-font-features.ts';
import { TEXT_FONT_SIZE } from './fixture-groups/text-font-size.ts';
import { TEXT_FONT_STRETCH } from './fixture-groups/text-font-stretch.ts';
import { TEXT_FONT_TUNING } from './fixture-groups/text-font-tuning.ts';
import { TEXT_FONT_VARIANT } from './fixture-groups/text-font-variant.ts';
import { TEXT_INDENT } from './fixture-groups/text-indent.ts';
import { TEXT_JUSTIFY } from './fixture-groups/text-justify.ts';
import { TEXT_LATIN } from './fixture-groups/text-latin.ts';
import { TEXT_OVERFLOW } from './fixture-groups/text-overflow.ts';
import { TEXT_SHADOW } from './fixture-groups/text-shadow.ts';
import { TEXT_SPACING } from './fixture-groups/text-spacing.ts';
import { TEXT_TRANSFORM } from './fixture-groups/text-transform.ts';
import { TEXT_WEIGHT } from './fixture-groups/text-weight.ts';
import { TOUCH_ACTION } from './fixture-groups/touch-action.ts';
import { TRANSFORMS } from './fixture-groups/transforms.ts';
import { UNIT_CONTEXTS } from './fixture-groups/unit-contexts.ts';
import { UNITS } from './fixture-groups/units.ts';
import { VALUES } from './fixture-groups/values.ts';
import { VISIBILITY } from './fixture-groups/visibility.ts';
import { WHITE_SPACE } from './fixture-groups/white-space.ts';
import { WRITING_MODE } from './fixture-groups/writing-mode.ts';

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
       * each to the initial value Dragon holds it at (BACKGROUND_RESET_LONGHANDS), and likewise the writing-mode family
       * (WRITING_MODE_RESET_LONGHANDS). Absent means none.
       */
      readonly computedExtra?: readonly (BackgroundResetLonghand | WritingModeResetLonghand)[];
    }
  | {
      readonly id: string;
      readonly format: 'html' | 'tree';
      readonly kind: 'reject';
      /** spanText null: the diagnostic is unlocated. messagePrefix: the diagnostic message must start with it (M4), or null. */
      readonly expect: { readonly code: DiagnosticCode; readonly spanText: string | null; readonly messagePrefix: string | null };
    };

/**
 * Every fixture group, one line per group, sorted by id: a feature adds its packages/parity/src/fixture-groups/<group>.ts, its
 * import and one line here, each in sorted order (test/registry-claims.test.ts).
 */
export const GROUPS = {
  aliases: ALIASES,
  animations: ANIMATIONS,
  'atomic-inline': ATOMIC_INLINE,
  attributes: ATTRIBUTES,
  background: BACKGROUND,
  'bg-position': BG_POSITION,
  'block-elements': BLOCK_ELEMENTS,
  'border-paint': BORDER_PAINT,
  casc: CASC,
  'casc-layer': CASC_LAYER,
  'casc-property': CASC_PROPERTY,
  'cascade-var': CASCADE_VAR,
  charset: CHARSET,
  'clip-rect': CLIP_RECT,
  contexts: CONTEXTS,
  'ctx-proof': CTX_PROOF,
  'display-legacy': DISPLAY_LEGACY,
  effects: EFFECTS,
  env: ENV,
  'font-shorthand': FONT_SHORTHAND,
  fonts: FONTS,
  gradients: GRADIENTS,
  grid: GRID,
  'inert-layout': INERT_LAYOUT,
  'inherit-contexts': INHERIT_CONTEXTS,
  inline: INLINE,
  'inline-tags': INLINE_TAGS,
  interaction: INTERACTION,
  'line-clamp': LINE_CLAMP,
  'list-items': LIST_ITEMS,
  'logical-props': LOGICAL_PROPS,
  media: MEDIA,
  'media-runtime': MEDIA_RUNTIME,
  'milestone-1': MILESTONE_1,
  outline: OUTLINE,
  overflow: OVERFLOW,
  'phrasing-blockified': PHRASING_BLOCKIFIED,
  radius: RADIUS,
  'rem-contexts': REM_CONTEXTS,
  replaced: REPLACED,
  resize: RESIZE,
  selection: SELECTION,
  selectors: SELECTORS,
  shadow: SHADOW,
  showcase: SHOWCASE,
  'sizing-keywords': SIZING_KEYWORDS,
  'sizing-ratio': SIZING,
  states: STATES,
  svg: SVG,
  'text-break': TEXT_BREAK,
  'text-calibration': TEXT_CALIBRATION,
  'text-decoration': TEXT_DECORATION,
  'text-fill-stroke': TEXT_FILL_STROKE,
  'text-font-features': TEXT_FONT_FEATURES,
  'text-font-size': TEXT_FONT_SIZE,
  'text-font-stretch': TEXT_FONT_STRETCH,
  'text-font-tuning': TEXT_FONT_TUNING,
  'text-font-variant': TEXT_FONT_VARIANT,
  'text-indent': TEXT_INDENT,
  'text-justify': TEXT_JUSTIFY,
  'text-latin': TEXT_LATIN,
  'text-overflow': TEXT_OVERFLOW,
  'text-shadow': TEXT_SHADOW,
  'text-spacing': TEXT_SPACING,
  'text-transform': TEXT_TRANSFORM,
  'text-weight': TEXT_WEIGHT,
  'touch-action': TOUCH_ACTION,
  transforms: TRANSFORMS,
  'unit-contexts': UNIT_CONTEXTS,
  units: UNITS,
  values: VALUES,
  visibility: VISIBILITY,
  'white-space': WHITE_SPACE,
  'writing-mode': WRITING_MODE,
} as const satisfies { readonly [id: string]: readonly FixtureSpec[] };

export type FixtureGroupId = keyof typeof GROUPS;

/**
 * The run order of the groups that landed before the per-feature split, frozen: milestone-1 first and never changes, and values
 * stays the last before states (the extended corpus keys its vectors on the values- prefix, values.test.ts).
 */
export const LEGACY_RUN_ORDER: readonly FixtureGroupId[] = [
  'milestone-1',
  'logical-props',
  'background',
  'selectors',
  'block-elements',
  'units',
  'contexts',
  'writing-mode',
  'cascade-var',
  'attributes',
  'grid',
  'showcase',
  'phrasing-blockified',
  'fonts',
  'media',
  'border-paint',
  'sizing-ratio',
  'inline',
  'animations',
  'values',
  'states',
];

/**
 * The fixture groups, in run order: the legacy groups, then every later group in id order. FIXTURES is their concatenation.
 * A new group can therefore land between two later groups and move their cases in FIXTURES; no check depends on that position
 * (pin a group's place in LEGACY_RUN_ORDER instead), and `pnpm regen` rebuilds the outputs that list cases in run order.
 */
export const FIXTURE_GROUPS: readonly { readonly id: string; readonly fixtures: readonly FixtureSpec[] }[] = [
  ...LEGACY_RUN_ORDER,
  ...(Object.keys(GROUPS) as FixtureGroupId[]).filter((id) => !LEGACY_RUN_ORDER.includes(id)).sort(),
].map((id) => ({ id, fixtures: GROUPS[id] }));

export const FIXTURES: readonly FixtureSpec[] = FIXTURE_GROUPS.flatMap((g) => g.fixtures);
