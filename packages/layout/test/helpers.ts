import type { FontSpec, InlineBox, InlineChild, LayoutBox, LayoutStyle, LineBreak, LineStrut, ReplacedLeaf, SafeAreaInsets, TextLeaf, Viewport, ViewportUnitSizes } from '../src/index.ts';

/** Test-only: the CSS initial values for a block div, spelled out so each test states what it overrides. */
export const divStyle: LayoutStyle = {
  display: 'block',
  position: 'static',
  top: { kind: 'auto' },
  right: { kind: 'auto' },
  bottom: { kind: 'auto' },
  left: { kind: 'auto' },
  overflowX: 'visible',
  overflowY: 'visible',
  direction: 'ltr',
  boxSizing: 'content-box',
  width: { kind: 'auto' },
  height: { kind: 'auto' },
  minWidth: { kind: 'auto' },
  minHeight: { kind: 'auto' },
  maxWidth: { kind: 'none' },
  maxHeight: { kind: 'none' },
  marginTop: { kind: 'px', value: 0 },
  marginRight: { kind: 'px', value: 0 },
  marginBottom: { kind: 'px', value: 0 },
  marginLeft: { kind: 'px', value: 0 },
  paddingTop: { kind: 'px', value: 0 },
  paddingRight: { kind: 'px', value: 0 },
  paddingBottom: { kind: 'px', value: 0 },
  paddingLeft: { kind: 'px', value: 0 },
  borderTopWidth: { kind: 'px', value: 0 },
  borderRightWidth: { kind: 'px', value: 0 },
  borderBottomWidth: { kind: 'px', value: 0 },
  borderLeftWidth: { kind: 'px', value: 0 },
  flexDirection: 'row',
  flexWrap: 'nowrap',
  flexGrow: 0,
  flexShrink: 1,
  flexBasis: { kind: 'auto' },
  order: 0,
  justifyContent: 'normal',
  alignItems: 'normal',
  alignSelf: 'auto',
  alignContent: 'normal',
  rowGap: { kind: 'normal' },
  columnGap: { kind: 'normal' },
  textAlign: 'start',
  aspectRatio: { kind: 'auto' },
  verticalAlign: { kind: 'keyword', value: 'baseline' },
};

type Child = LayoutBox | ReplacedLeaf | InlineChild;

/** The strut the compiler writes for inline content: the container's font and line-height, here its first text leaf's (or 10px Ahem). */
export function strutFor(children: readonly Child[]): LineStrut | null {
  if (!children.some((c) => c.kind === 'text' || c.kind === 'inline' || c.kind === 'br')) return null;
  const first = firstLeaf(children);
  return first === null ? { font: ahemFont(10), lineHeight: { kind: 'normal' } } : { font: first.font, lineHeight: first.lineHeight };
}

function firstLeaf(children: readonly Child[]): TextLeaf | null {
  for (const c of children) {
    if (c.kind === 'text') return c;
    if (c.kind === 'inline') {
      const t = firstLeaf(c.children);
      if (t !== null) return t;
    }
  }
  return null;
}

export function box(id: string, style: Partial<LayoutStyle>, children: Child[] = [], strut: LineStrut | null = strutFor(children)): LayoutBox {
  return { kind: 'box', id, boxType: 'element', style: { ...divStyle, ...style }, strut, children };
}

export function anon(id: string, style: Partial<LayoutStyle>, children: Child[] = [], strut: LineStrut | null = strutFor(children)): LayoutBox {
  return { kind: 'box', id, boxType: 'anonymous', style: { ...divStyle, ...style }, strut, children };
}

/** An inline box (display inline) with a 10px Ahem font and line-height normal unless given. */
export function span(id: string, children: InlineChild[], over: Partial<Omit<InlineBox, 'kind' | 'id' | 'children'>> = {}): InlineBox {
  return { kind: 'inline', id, style: { ...divStyle, display: 'inline' }, font: ahemFont(10), lineHeight: { kind: 'normal' }, children, ...over };
}

/** A <br> with a 10px Ahem font and line-height normal unless given. */
export function br(id: string, over: Partial<Omit<LineBreak, 'kind' | 'id'>> = {}): LineBreak {
  return { kind: 'br', id, font: ahemFont(10), lineHeight: { kind: 'normal' }, ...over };
}

/** A 10px Ahem text leaf, already collapsed, with the inherited text properties the compiler writes onto it. */
export function text(id: string, value: string, over: Partial<TextLeaf> = {}): TextLeaf {
  return { kind: 'text', id, text: value, font: ahemFont(10), lineHeight: { kind: 'normal' }, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap', overflowWrap: 'normal', wordBreak: 'normal', ...over };
}

export const px = (value: number) => ({ kind: 'px', value }) as const;
export const pct = (value: number) => ({ kind: 'percent', value }) as const;

/** An Ahem font at a px size: the specified size is that px leaf, absolute, and the computed size at the reference environment. */
export function ahemFont(size: number): FontSpec {
  return { family: 'Ahem', size, specifiedSize: { kind: 'px', value: size }, absoluteSize: true };
}

/** The environment inputs of a case at a viewport: every viewport unit reads it, no safe area, and a 16px root font size. */
export function neutralEnvironment(viewport: Viewport): { readonly viewportUnits: ViewportUnitSizes; readonly safeArea: SafeAreaInsets; readonly rootFontSize: number } {
  return { viewportUnits: { small: viewport, large: viewport, dynamic: viewport }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16 };
}
