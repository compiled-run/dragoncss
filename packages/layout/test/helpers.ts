import type { LayoutBox, LayoutStyle, TextLeaf } from '../src/index.ts';

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
};

export function box(id: string, style: Partial<LayoutStyle>, children: (LayoutBox | TextLeaf)[] = []): LayoutBox {
  return { kind: 'box', id, boxType: 'element', style: { ...divStyle, ...style }, children };
}

export function anon(id: string, style: Partial<LayoutStyle>, children: (LayoutBox | TextLeaf)[] = []): LayoutBox {
  return { kind: 'box', id, boxType: 'anonymous', style: { ...divStyle, ...style }, children };
}

/** A 10px Ahem text leaf, already collapsed, with the inherited text properties the compiler writes onto it. */
export function text(id: string, value: string, over: Partial<TextLeaf> = {}): TextLeaf {
  return { kind: 'text', id, text: value, font: { family: 'Ahem', size: 10 }, lineHeight: { kind: 'normal' }, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap', ...over };
}

export const px = (value: number) => ({ kind: 'px', value }) as const;
export const pct = (value: number) => ({ kind: 'percent', value }) as const;
