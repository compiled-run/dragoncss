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
/**
 * R5 (Chrome deviation initial-line-width-unzoomed, chrome-deviations-dpr.ts): an initial line width in device px. Blink stores
 * the initial border width 3 in zoomed px without ZoomedComputedPixels, so it stays 3 device px at every pixel ratio. The compiler
 * writes it only for a border width that is its initial value (no width declared, or a shorthand that omits it).
 */
export type DevicePx = { readonly kind: 'device-px'; readonly value: number };
/** The computed border width before device-pixel snapping, which the engine applies for the environment: CSS px, or R5 device px. */
export type BorderWidthValue = Px | DevicePx;
export type FlexBasisValue = Px | Percent | Auto | ContentValue;
export type GapValue = Px | Percent | NormalValue;
/** CSS2 §9.3.2 box offsets (css-position-3 inset properties). */
export type InsetValue = Px | Percent | Auto;
export type LineHeightValue = NormalValue | NumberValue | Px;

/** display: none subtrees generate no boxes (CSS2 §9.2.4); the compiler omits them from the layout input. */
export type Display = 'block' | 'flex' | 'grid';
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

/** css-grid-2 §7.2.1 <flex>: a fraction of the leftover space. */
export type Fr = { readonly kind: 'fr'; readonly value: number };
export type MinContent = { readonly kind: 'min-content' };
export type MaxContent = { readonly kind: 'max-content' };
/** css-grid-2 §7.2.1 <track-breadth>; a % breadth resolves against the grid container's content box in its axis. */
export type TrackBreadth = Px | Percent | Fr | Auto | MinContent | MaxContent;
/**
 * css-grid-2 §7.2.1 <track-size>, as Blink's GridTrackSize keeps it: a single breadth, minmax(min, max), or fit-content(limit).
 * A flexible breadth is never a minimum: the compiler writes minmax(auto, <flex>) as the <flex> breadth.
 */
export type TrackSize =
  | { readonly kind: 'breadth'; readonly breadth: TrackBreadth }
  | { readonly kind: 'minmax'; readonly min: TrackBreadth; readonly max: TrackBreadth }
  | { readonly kind: 'fit-content'; readonly limit: Px | Percent };
/**
 * One repeater of a track list (Blink GridTrackRepeater): a track written on its own is a repeater of count 1 with one size;
 * repeat(n, sizes) keeps its count unexpanded, since Chrome sizes each size of a repeater as one set of n tracks.
 */
export type TrackRepeater = { readonly count: number; readonly sizes: readonly TrackSize[] };
/**
 * An item's lines in one axis, resolved by the compiler (Blink GridLineResolver::ResolveGridPositionsFromStyle): definite lines
 * as 0-based indices from the explicit grid's start line, which are negative before it; or an automatic position of span lines.
 */
export type GridSpan =
  | { readonly kind: 'definite'; readonly start: number; readonly end: number }
  | { readonly kind: 'auto'; readonly span: number };
/** css-align-3 §6.1 self positions in a grid container; normal and stretch stretch an auto size. */
export type GridSelfAlign =
  | 'normal'
  | 'stretch'
  | 'start'
  | 'end'
  | 'center'
  | 'self-start'
  | 'self-end'
  | 'flex-start'
  | 'flex-end'
  | 'left'
  | 'right';
/**
 * A grid container's own grid properties (css-grid-2 §7). The explicit track counts are the larger of the template's and the
 * template areas' (css-grid-2 §7.1); tracks beyond the template are sized by the automatic tracks. autoColumns and autoRows
 * are never empty (the initial value is one auto track). justifyItems is the computed value with legacy already resolved.
 */
export type GridContainerStyle = {
  readonly templateColumns: readonly TrackRepeater[];
  readonly templateRows: readonly TrackRepeater[];
  readonly autoColumns: readonly TrackSize[];
  readonly autoRows: readonly TrackSize[];
  readonly explicitColumnCount: number;
  readonly explicitRowCount: number;
  readonly autoFlow: 'row' | 'column';
  readonly dense: boolean;
  readonly justifyItems: GridSelfAlign;
};
/** A grid item's placement and justify-self (auto takes the container's justify-items); align-self is LayoutStyle.alignSelf. */
export type GridItemStyle = {
  readonly column: GridSpan;
  readonly row: GridSpan;
  readonly justifySelf: 'auto' | GridSelfAlign;
};

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
  /** Written for display: grid only; null otherwise. */
  readonly grid: GridContainerStyle | null;
  /** Written for the in-flow children of a grid container only; null otherwise. */
  readonly gridItem: GridItemStyle | null;
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
