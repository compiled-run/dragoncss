// The longhands the milestone-1 compiler resolves per element, and the shorthands it expands into them. This file is the
// aggregate: each family's lists and tables live in properties/<family>.ts, concatenated here in a fixed family order (the
// order of LONGHANDS and SHORTHANDS is pinned by test/seams.test.ts). Tables that cut across families (TEXT_LONGHANDS,
// COLOR_LONGHANDS) stay here.
import { BACKGROUND_ASPECTS, BACKGROUND_CONTAINER, BACKGROUND_INHERITED, BACKGROUND_LONGHANDS, BACKGROUND_SHORTHANDS, BACKGROUND_TEXT_ROLE } from './properties/background.ts';
import { BORDER_ASPECTS, BORDER_CONTAINER, BORDER_INHERITED, BORDER_LONGHANDS, BORDER_SHORTHANDS, BORDER_TEXT_ROLE } from './properties/border.ts';
import { BOX_ASPECTS, BOX_CONTAINER, BOX_INHERITED, BOX_LONGHANDS, BOX_SHORTHANDS, BOX_TEXT_ROLE } from './properties/box.ts';
import { FLEX_ASPECTS, FLEX_CONTAINER, FLEX_INHERITED, FLEX_LONGHANDS, FLEX_SHORTHANDS, FLEX_TEXT_ROLE } from './properties/flex.ts';
import { GRID_ASPECTS, GRID_CONTAINER, GRID_INHERITED, GRID_LONGHANDS, GRID_SHORTHANDS, GRID_TEXT_ROLE } from './properties/grid.ts';
import { LOGICAL_ASPECTS, LOGICAL_CONTAINER, LOGICAL_INHERITED, LOGICAL_LONGHANDS, LOGICAL_SHORTHANDS, LOGICAL_TEXT_ROLE } from './properties/logical.ts';
import { OVERFLOW_ASPECTS, OVERFLOW_CONTAINER, OVERFLOW_INHERITED, OVERFLOW_LONGHANDS, OVERFLOW_SHORTHANDS, OVERFLOW_TEXT_ROLE } from './properties/overflow.ts';
import { POSITION_ASPECTS, POSITION_CONTAINER, POSITION_INHERITED, POSITION_LONGHANDS, POSITION_SHORTHANDS, POSITION_TEXT_ROLE } from './properties/position.ts';
import { TEXT_DECORATION_ASPECTS, TEXT_DECORATION_CONTAINER, TEXT_DECORATION_INHERITED, TEXT_DECORATION_LONGHANDS, TEXT_DECORATION_SHORTHANDS, TEXT_DECORATION_TEXT_ROLE } from './properties/text-decoration.ts';
import { TEXT_FAMILY_ASPECTS, TEXT_FAMILY_CONTAINER, TEXT_FAMILY_INHERITED, TEXT_FAMILY_LONGHANDS, TEXT_FAMILY_SHORTHANDS, TEXT_FAMILY_TEXT_ROLE } from './properties/text.ts';
import { TEXT_WRAP_ASPECTS, TEXT_WRAP_CONTAINER, TEXT_WRAP_INHERITED, TEXT_WRAP_LONGHANDS, TEXT_WRAP_SHORTHANDS, TEXT_WRAP_TEXT_ROLE } from './properties/text-wrap.ts';
import { INLINE_ASPECTS, INLINE_CONTAINER, INLINE_INHERITED, INLINE_LONGHANDS, INLINE_SHORTHANDS, INLINE_TEXT_ROLE } from './properties/inline.ts';
import { WRITING_MODE_ASPECTS, WRITING_MODE_CONTAINER, WRITING_MODE_INHERITED, WRITING_MODE_LONGHANDS, WRITING_MODE_SHORTHANDS, WRITING_MODE_TEXT_ROLE } from './properties/writing-mode.ts';
// Paint families (EMS seams, notes/T046-paint-spec.md §3 item 4): empty until their packages fill them.
import { RADIUS_ASPECTS, RADIUS_CONTAINER, RADIUS_INHERITED, RADIUS_LONGHANDS, RADIUS_SHORTHANDS, RADIUS_TEXT_ROLE } from './properties/radius.ts';
import { SHADOW_ASPECTS, SHADOW_CONTAINER, SHADOW_INHERITED, SHADOW_LONGHANDS, SHADOW_SHORTHANDS, SHADOW_TEXT_ROLE } from './properties/shadow.ts';
import { EFFECTS_ASPECTS, EFFECTS_CONTAINER, EFFECTS_INHERITED, EFFECTS_LONGHANDS, EFFECTS_SHORTHANDS, EFFECTS_TEXT_ROLE } from './properties/effects.ts';
import { OUTLINE_ASPECTS, OUTLINE_CONTAINER, OUTLINE_INHERITED, OUTLINE_LONGHANDS, OUTLINE_SHORTHANDS, OUTLINE_TEXT_ROLE } from './properties/outline.ts';
import { TRANSFORM_ASPECTS, TRANSFORM_CONTAINER, TRANSFORM_INHERITED, TRANSFORM_LONGHANDS, TRANSFORM_SHORTHANDS, TRANSFORM_TEXT_ROLE } from './properties/transform.ts';
import { BACKGROUND_LAYERS_ASPECTS, BACKGROUND_LAYERS_CONTAINER, BACKGROUND_LAYERS_INHERITED, BACKGROUND_LAYERS_LONGHANDS, BACKGROUND_LAYERS_SHORTHANDS, BACKGROUND_LAYERS_TEXT_ROLE } from './properties/background-layers.ts';
import { SCROLLBAR_ASPECTS, SCROLLBAR_CONTAINER, SCROLLBAR_INHERITED, SCROLLBAR_LONGHANDS, SCROLLBAR_SHORTHANDS, SCROLLBAR_TEXT_ROLE } from './properties/scrollbar.ts';

/** What a longhand affects: layout (box geometry) and paint (pixels). */
export type PropertyAspect = { readonly layout: boolean; readonly paint: boolean };

export const LONGHANDS = [
  ...POSITION_LONGHANDS,
  ...OVERFLOW_LONGHANDS,
  ...BOX_LONGHANDS,
  ...BORDER_LONGHANDS,
  ...FLEX_LONGHANDS,
  ...TEXT_FAMILY_LONGHANDS,
  ...TEXT_DECORATION_LONGHANDS,
  ...BACKGROUND_LONGHANDS,
  ...LOGICAL_LONGHANDS,
  ...WRITING_MODE_LONGHANDS,

  // Grid (css-grid-2) goes after the writing-mode family in every table below.
  ...GRID_LONGHANDS,

  // TXT2-a (css-text-3 §5): after the grid family and before the paint families in every table below.
  ...TEXT_WRAP_LONGHANDS,

  // INL2b (CSS2 §10.8.1): after the TXT2-a family in every table below.
  ...INLINE_LONGHANDS,

  // The paint families (EMS seams) go last in every table below.
  ...RADIUS_LONGHANDS,
  ...SHADOW_LONGHANDS,
  ...EFFECTS_LONGHANDS,
  ...OUTLINE_LONGHANDS,
  ...TRANSFORM_LONGHANDS,
  ...BACKGROUND_LAYERS_LONGHANDS,
  ...SCROLLBAR_LONGHANDS,
] as const;

export type Longhand = (typeof LONGHANDS)[number];

export const SHORTHANDS = [
  ...POSITION_SHORTHANDS,
  ...BOX_SHORTHANDS,
  ...BORDER_SHORTHANDS,
  ...FLEX_SHORTHANDS,
  ...OVERFLOW_SHORTHANDS,
  ...TEXT_FAMILY_SHORTHANDS,
  ...TEXT_DECORATION_SHORTHANDS,
  ...BACKGROUND_SHORTHANDS,
  ...LOGICAL_SHORTHANDS,
  ...WRITING_MODE_SHORTHANDS,

  ...GRID_SHORTHANDS,

  ...TEXT_WRAP_SHORTHANDS,

  ...INLINE_SHORTHANDS,

  ...RADIUS_SHORTHANDS,
  ...SHADOW_SHORTHANDS,
  ...EFFECTS_SHORTHANDS,
  ...OUTLINE_SHORTHANDS,
  ...TRANSFORM_SHORTHANDS,
  ...BACKGROUND_LAYERS_SHORTHANDS,
  ...SCROLLBAR_SHORTHANDS,
] as const;

export type Shorthand = (typeof SHORTHANDS)[number];

export const INHERITED: ReadonlySet<Longhand> = new Set<Longhand>([
  ...POSITION_INHERITED,
  ...OVERFLOW_INHERITED,
  ...BOX_INHERITED,
  ...BORDER_INHERITED,
  ...FLEX_INHERITED,
  ...TEXT_FAMILY_INHERITED,
  ...TEXT_DECORATION_INHERITED,
  ...BACKGROUND_INHERITED,
  ...LOGICAL_INHERITED,
  ...WRITING_MODE_INHERITED,

  ...GRID_INHERITED,

  ...TEXT_WRAP_INHERITED,

  ...INLINE_INHERITED,

  ...RADIUS_INHERITED,
  ...SHADOW_INHERITED,
  ...EFFECTS_INHERITED,
  ...OUTLINE_INHERITED,
  ...TRANSFORM_INHERITED,
  ...BACKGROUND_LAYERS_INHERITED,
  ...SCROLLBAR_INHERITED,
]);

/**
 * The inherited text properties every resolved text node carries itself (goal.md principle 3), each with an inherited Origin,
 * so the lowering reads only the text node.
 */
export const TEXT_LONGHANDS = ['font-family', 'font-size', 'line-height', 'color', 'text-align', 'white-space-collapse', 'text-wrap-mode', 'direction', 'overflow-wrap', 'word-break', 'letter-spacing'] as const satisfies readonly Longhand[];

export type TextLonghand = (typeof TEXT_LONGHANDS)[number];

/** Longhands whose values are <color>; their channels are checked against Chrome exactly. */
export const COLOR_LONGHANDS = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'] as const satisfies readonly Longhand[];

export type ColorLonghand = (typeof COLOR_LONGHANDS)[number];

export function isLonghand(name: string): name is Longhand {
  return (LONGHANDS as readonly string[]).includes(name);
}

export function isShorthand(name: string): name is Shorthand {
  return (SHORTHANDS as readonly string[]).includes(name);
}

export const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/**
 * What each longhand affects, for proof classification (docs/api.md §4.1, §6.3). layout: box geometry, proven by the layout
 * lanes. paint: pixels no milestone-1 lane renders natively, so iOS rows for it are capped at caveat. border-*-style is both:
 * none/hidden zero the border width, and every other style paints.
 */
export const PROPERTY_ASPECTS: { readonly [P in Longhand]: PropertyAspect } = {
  ...POSITION_ASPECTS,
  ...OVERFLOW_ASPECTS,
  ...BOX_ASPECTS,
  ...BORDER_ASPECTS,
  ...FLEX_ASPECTS,
  ...TEXT_FAMILY_ASPECTS,
  ...TEXT_DECORATION_ASPECTS,
  ...BACKGROUND_ASPECTS,
  ...LOGICAL_ASPECTS,
  ...WRITING_MODE_ASPECTS,

  ...GRID_ASPECTS,

  ...TEXT_WRAP_ASPECTS,

  ...INLINE_ASPECTS,

  ...RADIUS_ASPECTS,
  ...SHADOW_ASPECTS,
  ...EFFECTS_ASPECTS,
  ...OUTLINE_ASPECTS,
  ...TRANSFORM_ASPECTS,
  ...BACKGROUND_LAYERS_ASPECTS,
  ...SCROLLBAR_ASPECTS,
};

/** The role of a longhand in its row key (M2): which formatting context, if any, the row names. */
export type PropertyRole = 'item' | 'container' | 'text' | 'paint';

const CONTAINER_LONGHANDS: readonly Longhand[] = [
  ...POSITION_CONTAINER,
  ...OVERFLOW_CONTAINER,
  ...BOX_CONTAINER,
  ...BORDER_CONTAINER,
  ...FLEX_CONTAINER,
  ...TEXT_FAMILY_CONTAINER,
  ...TEXT_DECORATION_CONTAINER,
  ...BACKGROUND_CONTAINER,
  ...LOGICAL_CONTAINER,
  ...WRITING_MODE_CONTAINER,

  ...GRID_CONTAINER,

  ...TEXT_WRAP_CONTAINER,

  ...INLINE_CONTAINER,

  ...RADIUS_CONTAINER,
  ...SHADOW_CONTAINER,
  ...EFFECTS_CONTAINER,
  ...OUTLINE_CONTAINER,
  ...TRANSFORM_CONTAINER,
  ...BACKGROUND_LAYERS_CONTAINER,
  ...SCROLLBAR_CONTAINER,
];
const TEXT_ROLE_LONGHANDS: readonly Longhand[] = [
  ...POSITION_TEXT_ROLE,
  ...OVERFLOW_TEXT_ROLE,
  ...BOX_TEXT_ROLE,
  ...BORDER_TEXT_ROLE,
  ...FLEX_TEXT_ROLE,
  ...TEXT_FAMILY_TEXT_ROLE,
  ...TEXT_DECORATION_TEXT_ROLE,
  ...BACKGROUND_TEXT_ROLE,
  ...LOGICAL_TEXT_ROLE,
  ...WRITING_MODE_TEXT_ROLE,

  ...GRID_TEXT_ROLE,

  ...TEXT_WRAP_TEXT_ROLE,

  ...INLINE_TEXT_ROLE,

  ...RADIUS_TEXT_ROLE,
  ...SHADOW_TEXT_ROLE,
  ...EFFECTS_TEXT_ROLE,
  ...OUTLINE_TEXT_ROLE,
  ...TRANSFORM_TEXT_ROLE,
  ...BACKGROUND_LAYERS_TEXT_ROLE,
  ...SCROLLBAR_TEXT_ROLE,
];

/**
 * Which formatting context a longhand's row key names (M2): container properties name the element's own flex line mode, text
 * properties the context of each text node they reach (analysis/context.ts), paint properties only the element's direction
 * (their value is resolved without layout, T036), and every other longhand the context the element's box takes part in.
 * paint is derived from PROPERTY_ASPECTS: exactly the longhands with a paint aspect and no layout aspect. direction is a
 * container property: the element's own inline flow, text alignment and flex axes read it, while its own box is placed by its
 * parent's direction.
 */
export const PROPERTY_ROLE: { readonly [P in Longhand]: PropertyRole } = Object.fromEntries(
  LONGHANDS.map((p) => {
    const a = PROPERTY_ASPECTS[p];
    const role: PropertyRole = !a.layout && a.paint ? 'paint' : CONTAINER_LONGHANDS.includes(p) ? 'container' : TEXT_ROLE_LONGHANDS.includes(p) ? 'text' : 'item';
    return [p, role];
  }),
) as { readonly [P in Longhand]: PropertyRole };
