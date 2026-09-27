// The engine input. Every field is required and set by the compiler; the engine has no defaults.

export type Px = { readonly kind: 'px'; readonly value: number };
/** A CSS percentage where 100 means the whole basis. */
export type Percent = { readonly kind: 'percent'; readonly value: number };
export type Auto = { readonly kind: 'auto' };
export type NoneValue = { readonly kind: 'none' };
export type ContentValue = { readonly kind: 'content' };
export type NormalValue = { readonly kind: 'normal' };
export type NumberValue = { readonly kind: 'number'; readonly value: number };

export type SizeValue = Px | Percent | Auto;
export type MinSizeValue = Px | Percent | Auto;
export type MaxSizeValue = Px | Percent | NoneValue;
export type MarginValue = Px | Percent | Auto;
export type PaddingValue = Px | Percent;
/** The computed border width in CSS px before device-pixel snapping, which the engine applies for the environment. */
export type BorderWidthValue = Px;
export type FlexBasisValue = Px | Percent | Auto | ContentValue;
export type GapValue = Px | Percent | NormalValue;
export type LineHeightValue = NormalValue | NumberValue | Px;

export type Display = 'block' | 'flex' | 'none';
export type Position = 'static';
export type Overflow = 'visible';
export type Direction = 'ltr' | 'rtl';
export type BoxSizing = 'content-box' | 'border-box';
export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';
export type JustifyContent =
  | 'normal'
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'space-between'
  | 'space-around'
  | 'space-evenly'
  | 'stretch'
  | 'start'
  | 'end'
  | 'left'
  | 'right';
export type AlignItems =
  | 'normal'
  | 'stretch'
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'baseline'
  | 'start'
  | 'end'
  | 'self-start'
  | 'self-end';
export type AlignSelf = 'auto' | AlignItems;
export type AlignContent =
  | 'normal'
  | 'stretch'
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'space-between'
  | 'space-around'
  | 'space-evenly'
  | 'baseline'
  | 'start'
  | 'end';
export type TextAlign = 'start' | 'end' | 'left' | 'right' | 'center' | 'justify';

export type LayoutStyle = {
  readonly display: Display;
  readonly position: Position;
  readonly overflowX: Overflow;
  readonly overflowY: Overflow;
  readonly direction: Direction;
  readonly boxSizing: BoxSizing;
  readonly width: SizeValue;
  readonly height: SizeValue;
  readonly minWidth: MinSizeValue;
  readonly minHeight: MinSizeValue;
  readonly maxWidth: MaxSizeValue;
  readonly maxHeight: MaxSizeValue;
  readonly marginTop: MarginValue;
  readonly marginRight: MarginValue;
  readonly marginBottom: MarginValue;
  readonly marginLeft: MarginValue;
  readonly paddingTop: PaddingValue;
  readonly paddingRight: PaddingValue;
  readonly paddingBottom: PaddingValue;
  readonly paddingLeft: PaddingValue;
  readonly borderTopWidth: BorderWidthValue;
  readonly borderRightWidth: BorderWidthValue;
  readonly borderBottomWidth: BorderWidthValue;
  readonly borderLeftWidth: BorderWidthValue;
  readonly flexDirection: FlexDirection;
  readonly flexWrap: FlexWrap;
  readonly flexGrow: number;
  readonly flexShrink: number;
  readonly flexBasis: FlexBasisValue;
  readonly order: number;
  readonly justifyContent: JustifyContent;
  readonly alignItems: AlignItems;
  readonly alignSelf: AlignSelf;
  readonly alignContent: AlignContent;
  readonly rowGap: GapValue;
  readonly columnGap: GapValue;
  readonly textAlign: TextAlign;
};

export type TextFont = { readonly family: 'Ahem'; readonly size: number };

/** css-text-4 §3.1 white-space-collapse: only collapse is supported; the compiler has already applied phase I collapsing. */
export type WhiteSpaceCollapse = 'collapse';
/** css-text-4 §5.1 text-wrap-mode. */
export type TextWrapMode = 'wrap' | 'nowrap';

/** A text run with every inherited text property written on it by the compiler (goal.md principle 3). */
export type TextLeaf = {
  readonly kind: 'text';
  readonly id: string;
  /** Text after white-space phase I collapsing (css-text-3 §4.1.1): no tabs, segment breaks or doubled spaces. */
  readonly text: string;
  readonly font: TextFont;
  readonly lineHeight: LineHeightValue;
  readonly whiteSpaceCollapse: WhiteSpaceCollapse;
  readonly textWrapMode: TextWrapMode;
};

/** element: the box of an authored element. anonymous: a box the compiler generated (CSS2 §9.2.1.1, css-flexbox-1 §4). */
export type BoxType = 'element' | 'anonymous';

/** Children are either all boxes or all text leaves: the compiler wraps mixed text in anonymous boxes. */
export type LayoutBox = {
  readonly kind: 'box';
  readonly id: string;
  readonly boxType: BoxType;
  readonly style: LayoutStyle;
  readonly children: readonly (LayoutBox | TextLeaf)[];
};

export type LayoutInput = {
  readonly viewport: { readonly width: number; readonly height: number };
  /** Device pixels per CSS px in the target environment; border widths snap to whole device px (css-values-4 §6.1). */
  readonly devicePixelRatio: number;
  readonly root: LayoutBox;
};
