// Tailwind's documentation sections (tailwindcss.com/docs, v4.3), plus colours: a utility whose value is a theme colour (or
// current, transparent, inherit) is counted under colours, whatever property it colours. Every other utility takes the section
// of the first standard property its rules declare; a custom-property-only utility takes its companion's (sweep.ts).
export const CATEGORIES = [
  'layout',
  'flexbox-grid',
  'spacing',
  'sizing',
  'typography',
  'colours',
  'backgrounds',
  'borders',
  'effects',
  'filters',
  'tables',
  'transitions-animation',
  'transforms',
  'interactivity',
  'svg',
  'accessibility',
] as const;
export type Category = (typeof CATEGORIES)[number];

const SECTIONS: { readonly [C in Exclude<Category, 'colours'>]: readonly string[] } = {
  layout: [
    'aspect-ratio', 'columns', 'break-after', 'break-before', 'break-inside', '-webkit-box-decoration-break', 'box-sizing', 'display', 'float',
    'clear', 'isolation', 'object-fit', 'object-position', 'overflow', 'overflow-x', 'overflow-y', 'overscroll-behavior', 'overscroll-behavior-x',
    'overscroll-behavior-y', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'inset-block', 'inset-block-start', 'inset-block-end',
    'inset-inline', 'inset-inline-start', 'inset-inline-end', 'visibility', 'z-index', 'container-type', 'contain', 'zoom',
  ],
  'flexbox-grid': [
    'flex', 'flex-basis', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'order', 'grid-template-columns', 'grid-template-rows',
    'grid-column', 'grid-column-start', 'grid-column-end', 'grid-row', 'grid-row-start', 'grid-row-end', 'grid-auto-flow', 'grid-auto-columns',
    'grid-auto-rows', 'gap', 'row-gap', 'column-gap', 'justify-content', 'justify-items', 'justify-self', 'align-content', 'align-items',
    'align-self', 'place-content', 'place-items', 'place-self',
  ],
  spacing: [
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-block', 'margin-block-start', 'margin-block-end',
    'margin-inline', 'margin-inline-start', 'margin-inline-end', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'padding-block', 'padding-block-start', 'padding-block-end', 'padding-inline', 'padding-inline-start', 'padding-inline-end',
  ],
  sizing: [
    'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'inline-size', 'min-inline-size', 'max-inline-size', 'block-size',
    'min-block-size', 'max-block-size',
  ],
  typography: [
    'font-family', 'font-size', '-webkit-font-smoothing', 'font-style', 'font-weight', 'font-stretch', 'font-variant-numeric', 'letter-spacing',
    'line-height', 'list-style-image', 'list-style-position', 'list-style-type', 'text-align', 'color', 'text-decoration-line',
    'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness', 'text-underline-offset', 'text-transform', 'text-overflow',
    'text-wrap', 'text-indent', 'vertical-align', 'white-space', 'word-break', 'overflow-wrap', '-webkit-hyphens', 'content', 'tab-size',
    '-webkit-line-clamp',
  ],
  backgrounds: ['background-attachment', 'background-clip', 'background-color', 'background-image', 'background-origin', 'background-position', 'background-repeat', 'background-size'],
  borders: [
    'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'border-start-start-radius', 'border-start-end-radius', 'border-end-start-radius', 'border-end-end-radius', 'border-width', 'border-top-width',
    'border-right-width', 'border-bottom-width', 'border-left-width', 'border-block-width', 'border-block-start-width', 'border-block-end-width',
    'border-inline-width', 'border-inline-start-width', 'border-inline-end-width', 'border-color', 'border-top-color', 'border-right-color',
    'border-bottom-color', 'border-left-color', 'border-block-color', 'border-block-start-color', 'border-block-end-color', 'border-inline-color',
    'border-inline-start-color', 'border-inline-end-color', 'border-style', 'border-top-style', 'border-right-style', 'border-bottom-style',
    'border-left-style', 'border-block-style', 'border-block-start-style', 'border-block-end-style', 'border-inline-style',
    'border-inline-start-style', 'border-inline-end-style', 'outline-width', 'outline-color', 'outline-style', 'outline-offset',
  ],
  effects: [
    'box-shadow', 'text-shadow', 'opacity', 'mix-blend-mode', 'background-blend-mode', 'mask-clip', 'mask-composite', 'mask-image', 'mask-mode',
    'mask-origin', 'mask-position', 'mask-repeat', 'mask-size', 'mask-type',
  ],
  filters: ['filter', '-webkit-backdrop-filter', 'backdrop-filter'],
  tables: ['border-collapse', 'border-spacing', 'table-layout', 'caption-side'],
  'transitions-animation': ['transition-property', 'transition-behavior', 'transition-duration', 'transition-timing-function', 'transition-delay', 'animation'],
  transforms: ['backface-visibility', 'perspective', 'perspective-origin', 'rotate', 'scale', 'transform', 'transform-origin', 'transform-style', 'transform-box', 'translate'],
  interactivity: [
    'accent-color', 'appearance', 'caret-color', 'color-scheme', 'cursor', 'field-sizing', 'pointer-events', 'resize', 'scroll-behavior',
    'scroll-margin', 'scroll-margin-top', 'scroll-margin-right', 'scroll-margin-bottom', 'scroll-margin-left', 'scroll-margin-block',
    'scroll-margin-block-start', 'scroll-margin-block-end', 'scroll-margin-inline', 'scroll-margin-inline-start', 'scroll-margin-inline-end',
    'scroll-padding', 'scroll-padding-top', 'scroll-padding-right', 'scroll-padding-bottom', 'scroll-padding-left', 'scroll-padding-block',
    'scroll-padding-block-start', 'scroll-padding-block-end', 'scroll-padding-inline', 'scroll-padding-inline-start', 'scroll-padding-inline-end',
    'scroll-snap-align', 'scroll-snap-stop', 'scroll-snap-type', 'touch-action', '-webkit-user-select', 'user-select', 'will-change',
    'scrollbar-color', 'scrollbar-gutter', 'scrollbar-width',
  ],
  svg: ['fill', 'stroke', 'stroke-width'],
  accessibility: ['forced-color-adjust'],
};

const BY_PROPERTY: ReadonlyMap<string, Category> = new Map(Object.entries(SECTIONS).flatMap(([c, ps]) => ps.map((p) => [p, c as Category] as const)));

/** Utilities the docs file under a section their first property does not name. */
const BY_NAME: readonly (readonly [RegExp, Category])[] = [
  [/^(not-)?sr-only$/, 'accessibility'],
  [/^line-clamp-/, 'typography'],
  [/^truncate$/, 'typography'],
];

/** The category of a utility with standard properties; a property missing from the table throws, so the table stays complete. */
export function categoryOf(name: string, colour: boolean, properties: readonly string[]): Category {
  if (colour) return 'colours';
  for (const [re, c] of BY_NAME) if (re.test(name)) return c;
  const first = properties[0];
  if (first === undefined) throw new Error(`${name} declares no standard property`);
  const c = BY_PROPERTY.get(first);
  if (c === undefined) throw new Error(`${name}: the category table has no entry for ${first}`);
  return c;
}
