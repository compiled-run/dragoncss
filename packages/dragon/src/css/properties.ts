// The longhands the milestone-1 compiler resolves per element, and the shorthands it expands into them.

export const LONGHANDS = [
  'display', 'position', 'overflow-x', 'overflow-y', 'direction', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'justify-content', 'align-items', 'align-self', 'align-content', 'row-gap', 'column-gap',
  'font-size', 'font-family', 'line-height', 'text-align',
] as const;

export type Longhand = (typeof LONGHANDS)[number];

export const SHORTHANDS = [
  'margin', 'padding', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color', 'flex', 'flex-flow', 'gap', 'overflow',
] as const;

export type Shorthand = (typeof SHORTHANDS)[number];

export const INHERITED: ReadonlySet<Longhand> = new Set<Longhand>(['direction', 'font-size', 'font-family', 'line-height', 'text-align']);

export function isLonghand(name: string): name is Longhand {
  return (LONGHANDS as readonly string[]).includes(name);
}

export function isShorthand(name: string): name is Shorthand {
  return (SHORTHANDS as readonly string[]).includes(name);
}

export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
