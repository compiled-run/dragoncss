// The longhands the milestone-1 compiler resolves per element, and the shorthands it expands into them.

export const LONGHANDS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'overflow-x', 'overflow-y', 'direction', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'justify-content', 'align-items', 'align-self', 'align-content', 'row-gap', 'column-gap',
  'font-size', 'font-family', 'line-height', 'text-align', 'white-space-collapse', 'text-wrap-mode', 'color', 'background-color',
] as const;

export type Longhand = (typeof LONGHANDS)[number];

export const SHORTHANDS = [
  'background', 'margin', 'padding', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color', 'flex', 'flex-flow', 'gap', 'overflow', 'white-space',
] as const;

export type Shorthand = (typeof SHORTHANDS)[number];

export const INHERITED: ReadonlySet<Longhand> = new Set<Longhand>(['direction', 'font-size', 'font-family', 'line-height', 'text-align', 'white-space-collapse', 'text-wrap-mode', 'color']);

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
export const PROPERTY_ASPECTS: { readonly [P in Longhand]: { readonly layout: boolean; readonly paint: boolean } } = {
  display: { layout: true, paint: false },
  position: { layout: true, paint: false },
  top: { layout: true, paint: false },
  right: { layout: true, paint: false },
  bottom: { layout: true, paint: false },
  left: { layout: true, paint: false },
  // overflow: hidden also clips painting, which no milestone-1 lane renders natively.
  'overflow-x': { layout: true, paint: true },
  'overflow-y': { layout: true, paint: true },
  direction: { layout: true, paint: false },
  'box-sizing': { layout: true, paint: false },
  width: { layout: true, paint: false },
  height: { layout: true, paint: false },
  'min-width': { layout: true, paint: false },
  'min-height': { layout: true, paint: false },
  'max-width': { layout: true, paint: false },
  'max-height': { layout: true, paint: false },
  'margin-top': { layout: true, paint: false },
  'margin-right': { layout: true, paint: false },
  'margin-bottom': { layout: true, paint: false },
  'margin-left': { layout: true, paint: false },
  'padding-top': { layout: true, paint: false },
  'padding-right': { layout: true, paint: false },
  'padding-bottom': { layout: true, paint: false },
  'padding-left': { layout: true, paint: false },
  'border-top-width': { layout: true, paint: false },
  'border-right-width': { layout: true, paint: false },
  'border-bottom-width': { layout: true, paint: false },
  'border-left-width': { layout: true, paint: false },
  'border-top-style': { layout: true, paint: true },
  'border-right-style': { layout: true, paint: true },
  'border-bottom-style': { layout: true, paint: true },
  'border-left-style': { layout: true, paint: true },
  'border-top-color': { layout: false, paint: true },
  'border-right-color': { layout: false, paint: true },
  'border-bottom-color': { layout: false, paint: true },
  'border-left-color': { layout: false, paint: true },
  'flex-direction': { layout: true, paint: false },
  'flex-wrap': { layout: true, paint: false },
  'flex-grow': { layout: true, paint: false },
  'flex-shrink': { layout: true, paint: false },
  'flex-basis': { layout: true, paint: false },
  order: { layout: true, paint: false },
  'justify-content': { layout: true, paint: false },
  'align-items': { layout: true, paint: false },
  'align-self': { layout: true, paint: false },
  'align-content': { layout: true, paint: false },
  'row-gap': { layout: true, paint: false },
  'column-gap': { layout: true, paint: false },
  'font-size': { layout: true, paint: false },
  'font-family': { layout: true, paint: false },
  'line-height': { layout: true, paint: false },
  'text-align': { layout: true, paint: false },
  'white-space-collapse': { layout: true, paint: false },
  'text-wrap-mode': { layout: true, paint: false },
  color: { layout: false, paint: true },
  'background-color': { layout: false, paint: true },
};

/** The role of a longhand in its row key (M2): which formatting context, if any, the row names. */
export type PropertyRole = 'item' | 'container' | 'text' | 'paint';

const CONTAINER_LONGHANDS: readonly Longhand[] = ['flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'row-gap', 'column-gap', 'direction'];
const TEXT_ROLE_LONGHANDS: readonly Longhand[] = ['font-size', 'font-family', 'line-height', 'text-align', 'white-space-collapse', 'text-wrap-mode'];

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
