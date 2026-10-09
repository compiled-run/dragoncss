// The longhands the milestone-1 compiler resolves per element, and the shorthands it expands into them. This file is the
// aggregate: each family's lists and tables live in properties/<family>.ts, and FAMILIES registers each family on one line, in
// table order (the order of LONGHANDS and SHORTHANDS is pinned by test/seams.test.ts). A new family adds its file and one line
// after the family it follows. Tables that cut across families (TEXT_LONGHANDS, COLOR_LONGHANDS) stay here.
import { BACKGROUND_ASPECTS, BACKGROUND_CONTAINER, BACKGROUND_INHERITED, BACKGROUND_LONGHANDS, BACKGROUND_SHORTHANDS, BACKGROUND_TEXT_ROLE } from './properties/background.ts';
import { BORDER_ASPECTS, BORDER_CONTAINER, BORDER_INHERITED, BORDER_LONGHANDS, BORDER_SHORTHANDS, BORDER_TEXT_ROLE } from './properties/border.ts';
import { BOX_ASPECTS, BOX_CONTAINER, BOX_INHERITED, BOX_LONGHANDS, BOX_SHORTHANDS, BOX_TEXT_ROLE } from './properties/box.ts';
import { FLEX_ASPECTS, FLEX_CONTAINER, FLEX_INHERITED, FLEX_LONGHANDS, FLEX_SHORTHANDS, FLEX_TEXT_ROLE } from './properties/flex.ts';
import { GRID_ASPECTS, GRID_CONTAINER, GRID_INHERITED, GRID_LONGHANDS, GRID_SHORTHANDS, GRID_TEXT_ROLE } from './properties/grid.ts';
import { LOGICAL_ASPECTS, LOGICAL_CONTAINER, LOGICAL_INHERITED, LOGICAL_LONGHANDS, LOGICAL_SHORTHANDS, LOGICAL_TEXT_ROLE } from './properties/logical.ts';
import { OVERFLOW_ASPECTS, OVERFLOW_CONTAINER, OVERFLOW_INHERITED, OVERFLOW_LONGHANDS, OVERFLOW_SHORTHANDS, OVERFLOW_TEXT_ROLE } from './properties/overflow.ts';
import { POSITION_ASPECTS, POSITION_CONTAINER, POSITION_INHERITED, POSITION_LONGHANDS, POSITION_SHORTHANDS, POSITION_TEXT_ROLE } from './properties/position.ts';
import { TEXT_FAMILY_ASPECTS, TEXT_FAMILY_CONTAINER, TEXT_FAMILY_INHERITED, TEXT_FAMILY_LONGHANDS, TEXT_FAMILY_SHORTHANDS, TEXT_FAMILY_TEXT_ROLE } from './properties/text.ts';
import { WRITING_MODE_ASPECTS, WRITING_MODE_CONTAINER, WRITING_MODE_INHERITED, WRITING_MODE_LONGHANDS, WRITING_MODE_SHORTHANDS, WRITING_MODE_TEXT_ROLE } from './properties/writing-mode.ts';
// Paint families (EMS seams, notes/T046-paint-spec.md §3 item 4): empty until their packages fill them.
import { RADIUS_ASPECTS, RADIUS_CONTAINER, RADIUS_INHERITED, RADIUS_LONGHANDS, RADIUS_SHORTHANDS, RADIUS_TEXT_ROLE } from './properties/radius.ts';
import { SHADOW_ASPECTS, SHADOW_CONTAINER, SHADOW_INHERITED, SHADOW_LONGHANDS, SHADOW_SHORTHANDS, SHADOW_TEXT_ROLE } from './properties/shadow.ts';
import { EFFECTS_ASPECTS, EFFECTS_CONTAINER, EFFECTS_INHERITED, EFFECTS_LONGHANDS, EFFECTS_SHORTHANDS, EFFECTS_TEXT_ROLE } from './properties/effects.ts';
import { OUTLINE_ASPECTS, OUTLINE_CONTAINER, OUTLINE_INHERITED, OUTLINE_LONGHANDS, OUTLINE_SHORTHANDS, OUTLINE_TEXT_ROLE } from './properties/outline.ts';
import { TRANSFORM_ASPECTS, TRANSFORM_CONTAINER, TRANSFORM_INHERITED, TRANSFORM_LONGHANDS, TRANSFORM_SHORTHANDS, TRANSFORM_TEXT_ROLE } from './properties/transform.ts';
import { BACKGROUND_LAYERS_ASPECTS, BACKGROUND_LAYERS_CONTAINER, BACKGROUND_LAYERS_INHERITED, BACKGROUND_LAYERS_LONGHANDS, BACKGROUND_LAYERS_SHORTHANDS, BACKGROUND_LAYERS_TEXT_ROLE } from './properties/background-layers.ts';
import { LISTS_ASPECTS, LISTS_CONTAINER, LISTS_INHERITED, LISTS_LONGHANDS, LISTS_SHORTHANDS, LISTS_TEXT_ROLE } from './properties/lists.ts';
import { SVG_ASPECTS, SVG_CONTAINER, SVG_INHERITED, SVG_LONGHANDS, SVG_SHORTHANDS, SVG_TEXT_ROLE } from './properties/svg.ts';
import { SCROLLBAR_ASPECTS, SCROLLBAR_CONTAINER, SCROLLBAR_INHERITED, SCROLLBAR_LONGHANDS, SCROLLBAR_SHORTHANDS, SCROLLBAR_TEXT_ROLE } from './properties/scrollbar.ts';

/** What a longhand affects: layout (box geometry) and paint (pixels). */
export type PropertyAspect = { readonly layout: boolean; readonly paint: boolean };

export const POINTER_LONGHANDS = ['pointer-events'] as const;
const POINTER_ASPECTS: { readonly [P in (typeof POINTER_LONGHANDS)[number]]: PropertyAspect } = { 'pointer-events': { layout: false, paint: false } };

/** One property family: its longhands and shorthands, and which of its longhands are inherited, container or text properties. */
type Family<L extends string, S extends string> = {
  readonly id: string;
  readonly longhands: readonly L[];
  readonly shorthands: readonly S[];
  readonly inherited: readonly L[];
  readonly aspects: { readonly [P in L]: PropertyAspect };
  readonly container: readonly L[];
  readonly textRole: readonly L[];
};

function family<const L extends readonly string[], const S extends readonly string[]>(id: string, longhands: L, shorthands: S, inherited: readonly L[number][], aspects: { readonly [P in L[number]]: PropertyAspect }, container: readonly L[number][], textRole: readonly L[number][]): Family<L[number], S[number]> {
  return { id, longhands, shorthands, inherited, aspects, container, textRole };
}

/** Every family, in table order. */
const FAMILIES = [
  family('position', POSITION_LONGHANDS, POSITION_SHORTHANDS, POSITION_INHERITED, POSITION_ASPECTS, POSITION_CONTAINER, POSITION_TEXT_ROLE),
  family('overflow', OVERFLOW_LONGHANDS, OVERFLOW_SHORTHANDS, OVERFLOW_INHERITED, OVERFLOW_ASPECTS, OVERFLOW_CONTAINER, OVERFLOW_TEXT_ROLE),
  family('box', BOX_LONGHANDS, BOX_SHORTHANDS, BOX_INHERITED, BOX_ASPECTS, BOX_CONTAINER, BOX_TEXT_ROLE),
  family('border', BORDER_LONGHANDS, BORDER_SHORTHANDS, BORDER_INHERITED, BORDER_ASPECTS, BORDER_CONTAINER, BORDER_TEXT_ROLE),
  family('flex', FLEX_LONGHANDS, FLEX_SHORTHANDS, FLEX_INHERITED, FLEX_ASPECTS, FLEX_CONTAINER, FLEX_TEXT_ROLE),
  family('text', TEXT_FAMILY_LONGHANDS, TEXT_FAMILY_SHORTHANDS, TEXT_FAMILY_INHERITED, TEXT_FAMILY_ASPECTS, TEXT_FAMILY_CONTAINER, TEXT_FAMILY_TEXT_ROLE),
  family('background', BACKGROUND_LONGHANDS, BACKGROUND_SHORTHANDS, BACKGROUND_INHERITED, BACKGROUND_ASPECTS, BACKGROUND_CONTAINER, BACKGROUND_TEXT_ROLE),
  family('logical', LOGICAL_LONGHANDS, LOGICAL_SHORTHANDS, LOGICAL_INHERITED, LOGICAL_ASPECTS, LOGICAL_CONTAINER, LOGICAL_TEXT_ROLE),
  family('writing-mode', WRITING_MODE_LONGHANDS, WRITING_MODE_SHORTHANDS, WRITING_MODE_INHERITED, WRITING_MODE_ASPECTS, WRITING_MODE_CONTAINER, WRITING_MODE_TEXT_ROLE),
  // Grid (css-grid-2) goes after the writing-mode family.
  family('grid', GRID_LONGHANDS, GRID_SHORTHANDS, GRID_INHERITED, GRID_ASPECTS, GRID_CONTAINER, GRID_TEXT_ROLE),
  // SELD-R1b (notes/T047-runtime-spec.md RT-9): pointer-events, inherited, read only by Dragon's hit test; auto and none only.
  family('pointer', POINTER_LONGHANDS, [], POINTER_LONGHANDS, POINTER_ASPECTS, [], []),
  // The paint families (EMS seams, notes/T046-paint-spec.md §3 item 4) go last.
  family('radius', RADIUS_LONGHANDS, RADIUS_SHORTHANDS, RADIUS_INHERITED, RADIUS_ASPECTS, RADIUS_CONTAINER, RADIUS_TEXT_ROLE),
  family('shadow', SHADOW_LONGHANDS, SHADOW_SHORTHANDS, SHADOW_INHERITED, SHADOW_ASPECTS, SHADOW_CONTAINER, SHADOW_TEXT_ROLE),
  family('effects', EFFECTS_LONGHANDS, EFFECTS_SHORTHANDS, EFFECTS_INHERITED, EFFECTS_ASPECTS, EFFECTS_CONTAINER, EFFECTS_TEXT_ROLE),
  family('outline', OUTLINE_LONGHANDS, OUTLINE_SHORTHANDS, OUTLINE_INHERITED, OUTLINE_ASPECTS, OUTLINE_CONTAINER, OUTLINE_TEXT_ROLE),
  family('transform', TRANSFORM_LONGHANDS, TRANSFORM_SHORTHANDS, TRANSFORM_INHERITED, TRANSFORM_ASPECTS, TRANSFORM_CONTAINER, TRANSFORM_TEXT_ROLE),
  family('background-layers', BACKGROUND_LAYERS_LONGHANDS, BACKGROUND_LAYERS_SHORTHANDS, BACKGROUND_LAYERS_INHERITED, BACKGROUND_LAYERS_ASPECTS, BACKGROUND_LAYERS_CONTAINER, BACKGROUND_LAYERS_TEXT_ROLE),
  family('scrollbar', SCROLLBAR_LONGHANDS, SCROLLBAR_SHORTHANDS, SCROLLBAR_INHERITED, SCROLLBAR_ASPECTS, SCROLLBAR_CONTAINER, SCROLLBAR_TEXT_ROLE),
  // GEN-b (notes/T151-gen-spec.md R13): content and list-style, after the paint families.
  family('lists', LISTS_LONGHANDS, LISTS_SHORTHANDS, LISTS_INHERITED, LISTS_ASPECTS, LISTS_CONTAINER, LISTS_TEXT_ROLE),
  // SVG-a1: the paint of inline SVG shapes.
  family('svg', SVG_LONGHANDS, SVG_SHORTHANDS, SVG_INHERITED, SVG_ASPECTS, SVG_CONTAINER, SVG_TEXT_ROLE),
] as const;

export type Longhand = (typeof FAMILIES)[number] extends infer F ? (F extends Family<infer L, string> ? L : never) : never;
export type Shorthand = (typeof FAMILIES)[number] extends infer F ? (F extends Family<string, infer S> ? S : never) : never;

type AnyFamily = Omit<Family<Longhand, Shorthand>, 'aspects'> & { readonly aspects: { readonly [P in Longhand]?: PropertyAspect } };
/** Every family, in table order (test/registry-claims.test.ts checks no longhand or shorthand is in two). */
export const PROPERTY_FAMILIES: readonly AnyFamily[] = FAMILIES;
const ALL = PROPERTY_FAMILIES;

export const LONGHANDS: readonly Longhand[] = ALL.flatMap((f) => f.longhands);

/** The shorthands follow FAMILIES, except overflow's, which follow flex's (they were added after the flex shorthands). */
export const SHORTHANDS_MOVED = { family: 'overflow', after: 'flex' } as const;

export const SHORTHANDS: readonly Shorthand[] = ALL.filter((f) => f.id !== SHORTHANDS_MOVED.family)
  .flatMap((f) => (f.id === SHORTHANDS_MOVED.after ? [f, ...ALL.filter((m) => m.id === SHORTHANDS_MOVED.family)] : [f]))
  .flatMap((f) => f.shorthands);

export const INHERITED: ReadonlySet<Longhand> = new Set<Longhand>(ALL.flatMap((f) => f.inherited));

if (new Set(LONGHANDS).size !== LONGHANDS.length || new Set(SHORTHANDS).size !== SHORTHANDS.length) throw new Error('a longhand or shorthand belongs to two property families');

/**
 * The inherited text properties every resolved text node carries itself (goal.md principle 3), each with an inherited Origin,
 * so the lowering reads only the text node.
 */
export const TEXT_LONGHANDS = ['font-family', 'font-size', 'line-height', 'color', 'text-align', 'white-space-collapse', 'text-wrap-mode', 'direction'] as const satisfies readonly Longhand[];

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
export const PROPERTY_ASPECTS: { readonly [P in Longhand]: PropertyAspect } = Object.assign({}, ...ALL.map((f) => f.aspects)) as { readonly [P in Longhand]: PropertyAspect };

/** The role of a longhand in its row key (M2): which formatting context, if any, the row names. */
export type PropertyRole = 'item' | 'container' | 'text' | 'paint';

const CONTAINER_LONGHANDS: readonly Longhand[] = ALL.flatMap((f) => f.container);
const TEXT_ROLE_LONGHANDS: readonly Longhand[] = ALL.flatMap((f) => f.textRole);

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
