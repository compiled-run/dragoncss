// The engine input. Every field is required and set by the compiler; the engine has no defaults.

export type Px = { readonly kind: 'px'; readonly value: number };
/** A CSS percentage where 100 means the whole basis. */
export type Percent = { readonly kind: 'percent'; readonly value: number };
export type Auto = { readonly kind: 'auto' };
export type NoneValue = { readonly kind: 'none' };
export type ContentValue = { readonly kind: 'content' };
export type NormalValue = { readonly kind: 'normal' };
export type NumberValue = { readonly kind: 'number'; readonly value: number };

/** A viewport-percentage length (css-values-4 §6.1.2); the compiler maps vi and vb to width and height (horizontal writing mode). */
export type ViewportLength = { readonly kind: 'viewport'; readonly value: number; readonly axis: 'width' | 'height' | 'min' | 'max' };
/**
 * A font-relative length inside a math function: value * float(fontSize * zoom) (Blink css_length_resolver.cc kEms, kRems). The
 * compiler writes fontSize as the specified font size in px: the element's for em, the root's at text scale 1 for rem.
 */
export type EmLength = { readonly kind: 'em'; readonly value: number; readonly fontSize: CalcExpr };
/** Terms added left to right; a subtracted term arrives negated. */
export type CalcSum = { readonly kind: 'sum'; readonly terms: readonly CalcExpr[] };
/** Factors multiplied left to right. */
export type CalcProduct = { readonly kind: 'product'; readonly terms: readonly CalcExpr[] };
/** 1 / term: a division by term is a product with its inverse (Blink CSSMathExpressionOperation::CreateArithmeticOperation). */
export type CalcInvert = { readonly kind: 'invert'; readonly term: CalcExpr };
export type CalcMin = { readonly kind: 'min'; readonly terms: readonly CalcExpr[] };
export type CalcMax = { readonly kind: 'max'; readonly terms: readonly CalcExpr[] };
export type CalcClamp = { readonly kind: 'clamp'; readonly min: CalcExpr; readonly value: CalcExpr; readonly max: CalcExpr };
/** Blink PixelsAndPercent in zoomed px, written only by the environment pass (environment.ts): pixels + percent / 100 * basis in float. */
export type PixelsAndPercent = {
  readonly kind: 'pixels-and-percent';
  readonly pixels: number;
  readonly percent: number;
  readonly explicitPixels: boolean;
  readonly explicitPercent: boolean;
};
/**
 * A css-values-4 §10 calculation. The compiler writes the tree after Blink's parse-time simplification, with CSS-level leaves;
 * the environment pass rewrites it into Blink's CalculationExpression shape (numbers and pixels-and-percent leaves) in zoomed px.
 */
export type CalcExpr =
  | Px
  | Percent
  | NumberValue
  | ViewportLength
  | EmLength
  | CalcSum
  | CalcProduct
  | CalcInvert
  | CalcMin
  | CalcMax
  | CalcClamp
  | PixelsAndPercent;
/** A math function in a length property; non-negative clamps the result to 0 (Blink CalculationValue::Evaluate). */
export type LengthCalc = { readonly kind: 'calc'; readonly expr: CalcExpr; readonly range: 'all' | 'non-negative' };

export type SizeValue = Px | Percent | Auto | LengthCalc;
export type MinSizeValue = Px | Percent | Auto | LengthCalc;
export type MaxSizeValue = Px | Percent | NoneValue | LengthCalc;
export type MarginValue = Px | Percent | Auto | LengthCalc;
export type PaddingValue = Px | Percent | LengthCalc;
/**
 * R5 (Chrome deviation initial-line-width-unzoomed, chrome-deviations-dpr.ts): an initial line width in device px. Blink stores
 * the initial border width 3 in zoomed px without ZoomedComputedPixels, so it stays 3 device px at every pixel ratio. The compiler
 * writes it only for a border width that is its initial value (no width declared, or a shorthand that omits it).
 */
export type DevicePx = { readonly kind: 'device-px'; readonly value: number };
/** The computed border width before device-pixel snapping, which the engine applies for the environment: CSS px, R5 device px, or a calculation without a percentage. */
export type BorderWidthValue = Px | DevicePx | LengthCalc;
export type FlexBasisValue = Px | Percent | Auto | ContentValue | LengthCalc;
export type GapValue = Px | Percent | NormalValue | LengthCalc;
/** CSS2 §9.3.2 box offsets (css-position-3 inset properties). */
export type InsetValue = Px | Percent | Auto | LengthCalc;
export type LineHeightValue = NormalValue | NumberValue | Px;
/**
 * css-sizing-4 §5.1 aspect-ratio as Blink's layout ratio (StyleAspectRatio::GetLayoutRatio): width and height are raw LayoutUnit
 * values, positive integers, which the compiler derives from the <ratio> as Blink's LayoutRatioFromSizeF does. ratio is
 * `<ratio>`; auto-ratio is `auto && <ratio>`, which sizes the content box whatever box-sizing says. A degenerate ratio is auto.
 */
export type AspectRatioValue =
  | Auto
  | { readonly kind: 'ratio'; readonly width: number; readonly height: number }
  | { readonly kind: 'auto-ratio'; readonly width: number; readonly height: number };

/** display: none subtrees generate no boxes (CSS2 §9.2.4); the compiler omits them from the layout input. */
export type Display = 'block' | 'flex';
/** CSS2 §9.3.1: relative offsets a box after layout; absolute takes it out of flow (§10.3.7, §10.6.4). fixed and sticky are refused by the compiler. */
export type Position = 'static' | 'relative' | 'absolute';
/** css-overflow-3 §3: hidden makes a scroll container; the validator requires both axes to be equal (the §3.1 computed pair). */
export type Overflow = 'visible' | 'hidden';
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
  readonly top: InsetValue;
  readonly right: InsetValue;
  readonly bottom: InsetValue;
  readonly left: InsetValue;
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
  readonly aspectRatio: AspectRatioValue;
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

/** The initial containing block in CSS px. */
export type Viewport = { readonly width: number; readonly height: number };

export type LayoutInput = {
  readonly viewport: Viewport;
  /** Device pixels per CSS px in the target environment; border widths snap to whole device px (css-values-4 §6.1). */
  readonly devicePixelRatio: number;
  readonly root: LayoutBox;
};
