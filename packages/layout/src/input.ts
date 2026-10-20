// The engine input. Every field is required and set by the compiler; the engine has no defaults.

export type Px = { readonly kind: 'px'; readonly value: number };
/** A CSS percentage where 100 means the whole basis. */
export type Percent = { readonly kind: 'percent'; readonly value: number };
export type Auto = { readonly kind: 'auto' };
export type NoneValue = { readonly kind: 'none' };
export type ContentValue = { readonly kind: 'content' };
export type NormalValue = { readonly kind: 'normal' };
export type NumberValue = { readonly kind: 'number'; readonly value: number };

/** Which viewport a viewport unit reads (css-values-4 §6.1.2.1): plain vw, vh, vi, vb, vmin and vmax read the large one in Blink. */
export type ViewportSize = 'small' | 'large' | 'dynamic';
/** A viewport-percentage length (css-values-4 §6.1.2); the compiler maps vi and vb to width and height (horizontal writing mode). */
export type ViewportLength = { readonly kind: 'viewport'; readonly value: number; readonly axis: 'width' | 'height' | 'min' | 'max'; readonly size: ViewportSize };
/**
 * A font-relative length: value * float(fontSize * zoom) (Blink css_length_resolver.cc kEms). fontSize is the specified font size
 * expression of the element whose em it reads: its own, or its parent's inside font-size (css-values-4 §6.1.1).
 */
export type EmLength = { readonly kind: 'em'; readonly value: number; readonly fontSize: CalcExpr };
/** rem: value * float(rootFontSize * zoom), the root's specified font size from the input (css-values-4 §6.1.1). */
export type RootFontLength = { readonly kind: 'rem'; readonly value: number };
/**
 * ex, ch or cap of a font (css-values-4 §6.1.1): value * metric / fontZoom * zoom in float, the metric read from the font instance
 * at the font's computed size (Blink CSSToLengthConversionData::FontSizes). font is the element's, or its parent's inside font-size.
 */
export type FontMetricLength = { readonly kind: 'font-metric'; readonly value: number; readonly metric: 'ex' | 'ch' | 'cap'; readonly font: FontSpec };
/**
 * lh or rlh (css-values-4 §6.1.1): value * the computed line height of font and lineHeight / fontZoom * zoom in float (Blink
 * LineHeightSize::Lh). The element's own line height, its parent's inside font-size and line-height, or the root's for rlh.
 */
export type LineHeightLength = { readonly kind: 'lh'; readonly value: number; readonly font: FontSpec; readonly lineHeight: LineHeightValue };
export type SafeAreaSide = 'top' | 'right' | 'bottom' | 'left';
/**
 * env(safe-area-inset-<side>) (css-env-1 §3): value * the inset in CSS px from the input. Blink substitutes the inset as a px token
 * before parsing, so the leaf is a px literal at resolution; value is 1, or the number the compiler folded into it.
 */
export type EnvLength = { readonly kind: 'env'; readonly value: number; readonly side: SafeAreaSide };
/** font-size: <percentage> (Blink StyleBuilderConverterBase::ConvertFontSize): float(value * parent / 100) of the parent's specified size. */
export type FontPercent = { readonly kind: 'font-percent'; readonly value: number; readonly parent: CalcExpr };
/**
 * font-size: a math function with a percentage: its percentages are of the parent's specified size (Blink ComputeFontSize,
 * ToCalcValue(...)->Evaluate(parent)). A math function without one is the plain expression.
 */
export type FontCalc = { readonly kind: 'font-calc'; readonly expr: CalcExpr; readonly parent: CalcExpr };
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
  | RootFontLength
  | FontMetricLength
  | LineHeightLength
  | EnvLength
  | FontPercent
  | FontCalc
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
/** css-sizing-3 §3.2 fit-content: min(max-content, max(min-content, the stretch size)). */
export type FitContent = { readonly kind: 'fit-content' };
/** css-sizing-4 §3.1 stretch (Chrome's -webkit-fill-available computes to it): the size that fills the available space. */
export type Stretch = { readonly kind: 'stretch' };
/** css-sizing-3 §3.2 and css-sizing-4 §3.1: the keywords of an inline size, read only on a block-level box in block flow. */
export type SizeKeyword = MinContent | MaxContent | FitContent | Stretch;
export type InlineSizeValue = SizeValue | SizeKeyword;
export type MaxInlineSizeValue = MaxSizeValue | SizeKeyword;
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
/** A calculated line height: line-height is non-negative (CSS2 §10.8.1), so its calculation is clamped to 0. */
export type LineHeightCalc = { readonly kind: 'calc'; readonly expr: CalcExpr; readonly range: 'non-negative' };
/** line-height (CSS2 §10.8.1): a percentage is of the element's computed font size, truncated to a whole percent (Blink ConvertLineHeight). */
export type LineHeightValue = NormalValue | NumberValue | Px | Percent | LineHeightCalc;
/**
 * css-sizing-4 §5.1 aspect-ratio as Blink's layout ratio (StyleAspectRatio::GetLayoutRatio): width and height are raw LayoutUnit
 * values, positive integers, which the compiler derives from the <ratio> as Blink's LayoutRatioFromSizeF does. ratio is
 * `<ratio>`; auto-ratio is `auto && <ratio>`, which sizes the content box whatever box-sizing says. A degenerate ratio is auto.
 */
export type AspectRatioValue =
  | Auto
  | { readonly kind: 'ratio'; readonly width: number; readonly height: number }
  | { readonly kind: 'auto-ratio'; readonly width: number; readonly height: number };

/**
 * display: none subtrees generate no boxes (CSS2 §9.2.4); the compiler omits them from the layout input. inline is the display of an
 * InlineBox only (CSS2 §9.2.2); a LayoutBox is block, flex or grid, or inline-block, inline-flex or inline-grid for an atomic inline
 * among a block container's inline-level children (CSS2 §9.2.4, css-display-3 §2.4).
 */
export type Display = 'block' | 'flex' | 'grid' | 'inline' | 'inline-block' | 'inline-flex' | 'inline-grid';
/**
 * CSS2 §9.3.1: relative offsets a box after layout; absolute takes it out of flow (§10.3.7, §10.6.4), and so does fixed, whose
 * containing block is the viewport (§10.1 item 3, POSX-f). sticky offsets an in-flow box to keep it inside the viewport less its
 * insets, at scroll offset 0, without leaving its containing block (css-position-3 §3.4, POSX-s; layout.ts stickyOffset).
 */
export type Position = 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
/**
 * CSS2 §9.5: a float leaves the flow and is shifted to the left or right of its containing block (FLT). The compiler computes none
 * for an absolutely positioned box (§9.7) and on the root; a flex or grid item ignores it. inline-start and inline-end are refused.
 */
export type Float = 'none' | 'left' | 'right';
/**
 * css-overflow-3 §3: hidden, auto and scroll make a scroll container; clip clips without one. The validator requires a §3.1
 * computed pair: both axes in visible and clip, or both in hidden, auto and scroll.
 */
export type Overflow = 'visible' | 'hidden' | 'clip' | 'auto' | 'scroll';
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
/** css-align-3 §4.2: baseline is first baseline; last baseline aligns grid items only (the compiler refuses it on a flex item). */
export type AlignItems =
  | 'normal'
  | 'stretch'
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'baseline'
  | 'last baseline'
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
/** css-overflow-4 §3.1 text-overflow: an ellipsis on each overflowing line of a block container whose overflow is not visible. */
export type TextOverflow = 'clip' | 'ellipsis';
/**
 * css-text-3 §8.1 text-indent: <length-percentage>, negative allowed, on the first formatted line of a block container. A percentage
 * is of the line's available inline size, and of nothing (0) at min-content and max-content (Blink LineBreaker::ComputeTextIndent).
 */
export type TextIndentValue = Px | Percent | LengthCalc;
/** CSS2 §10.8.1 vertical-align keywords. */
export type VerticalAlignKeyword = 'baseline' | 'sub' | 'super' | 'text-top' | 'text-bottom' | 'middle' | 'top' | 'bottom';
/** A vertical-align keyword value. */
export type VerticalAlignKeywordValue = { readonly kind: 'keyword'; readonly value: VerticalAlignKeyword };
/** CSS2 §10.8.1 vertical-align: a keyword, a length, or a percentage of the element's own line-height. The compiler writes baseline. */
export type VerticalAlignValue = VerticalAlignKeywordValue | Px | Percent | LengthCalc;

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
 * The automatic repeater of a track list (css-grid-2 §7.2.3.2, Blink GridTrackRepeater kAutoFill and kAutoFit), at most one per
 * axis. It stands before template[index] (at the end when index is the template's length); the engine computes its repetitions
 * from the container's available size. lineNames are the axis's line names, by the ids its items' GridLine positions carry.
 */
export type GridAutoRepeat = {
  readonly type: 'auto-fill' | 'auto-fit';
  readonly index: number;
  readonly sizes: readonly TrackSize[];
  readonly lineNames: readonly GridLineName[];
};
/**
 * One line name of an axis with an automatic repeater, as Blink's GridNamedLineCollection reads it, each list ascending.
 * explicit: the template's lines with the name, counting the automatic repeater as one track; repeat: the lines with the name
 * inside one repetition (0 to its track count); implicit: the lines grid-template-areas names (css-grid-2 §7.3).
 */
export type GridLineName = { readonly explicit: readonly number[]; readonly repeat: readonly number[]; readonly implicit: readonly number[] };
/**
 * A grid-*-start or grid-*-end value (Blink GridPosition) that the engine resolves, with names as GridLineName ids: auto;
 * <integer>; <integer> <name>; span <integer>; span <integer> <name>; or a lone <name>, which reads the side's implicit
 * <name>-start or <name>-end id first.
 */
export type GridLine =
  | { readonly kind: 'auto' }
  | { readonly kind: 'line'; readonly n: number }
  | { readonly kind: 'named-line'; readonly n: number; readonly name: number }
  | { readonly kind: 'span'; readonly n: number }
  | { readonly kind: 'named-span'; readonly n: number; readonly name: number }
  | { readonly kind: 'area'; readonly implicitName: number; readonly name: number };
/**
 * An item's lines in one axis (Blink GridLineResolver::ResolveGridPositionsFromStyle): resolved by the compiler as definite lines,
 * 0-based from the explicit grid's start line and negative before it, or an automatic position of span lines; or, in an axis with
 * an automatic repeater, whose explicit grid the engine sizes, the start and end positions the engine resolves. An absolutely
 * positioned child also takes start-line or end-line when only that side is not auto (css-grid-2 §9.1: an auto line is the
 * padding edge); its auto span means both lines are auto, and its lines resolve as GridPlacement::ResolveOutOfFlowItemGridLines.
 */
export type GridSpan =
  | { readonly kind: 'definite'; readonly start: number; readonly end: number }
  | { readonly kind: 'auto'; readonly span: number }
  | { readonly kind: 'lines'; readonly start: GridLine; readonly end: GridLine }
  | { readonly kind: 'start-line'; readonly line: number }
  | { readonly kind: 'end-line'; readonly line: number };
/**
 * css-align-3 §6.1 self positions in a grid container, and §4.2 baseline alignment (baseline is first baseline); normal and stretch
 * stretch an auto size.
 */
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
  | 'right'
  | 'baseline'
  | 'last baseline';
/**
 * A grid container's own grid properties (css-grid-2 §7). The explicit track counts are the larger of the template's and the
 * template areas' (css-grid-2 §7.1), not counting an automatic repeater, whose tracks the engine adds; tracks beyond the
 * template are sized by the automatic tracks. autoColumns and autoRows
 * are never empty (the initial value is one auto track). justifyItems is the computed value with legacy already resolved.
 */
export type GridContainerStyle = {
  readonly templateColumns: readonly TrackRepeater[];
  readonly templateRows: readonly TrackRepeater[];
  readonly autoColumns: readonly TrackSize[];
  readonly autoRows: readonly TrackSize[];
  readonly explicitColumnCount: number;
  readonly explicitRowCount: number;
  readonly autoRepeatColumns: GridAutoRepeat | null;
  readonly autoRepeatRows: GridAutoRepeat | null;
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
  readonly float: Float;
  readonly top: InsetValue;
  readonly right: InsetValue;
  readonly bottom: InsetValue;
  readonly left: InsetValue;
  readonly overflowX: Overflow;
  readonly overflowY: Overflow;
  readonly direction: Direction;
  readonly boxSizing: BoxSizing;
  readonly width: InlineSizeValue;
  readonly height: SizeValue;
  readonly minWidth: InlineSizeValue;
  readonly minHeight: MinSizeValue;
  readonly maxWidth: MaxInlineSizeValue;
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
  readonly verticalAlign: VerticalAlignValue;
  readonly textOverflow: TextOverflow;
  readonly textIndent: TextIndentValue;
  /**
   * css-overflow-4 §4.2 -webkit-line-clamp on a block container (the compiler's display: -webkit-box line-clamp pattern, which
   * Chrome computes to flow-root): its content ends after line N and line N ends in an ellipsis when content follows; 0 is none.
   */
  readonly lineClamp: number;
  /** Written for display: grid only; null otherwise. */
  readonly grid: GridContainerStyle | null;
  /** Written for the children of a grid container only (absolutely positioned ones too); null otherwise. */
  readonly gridItem: GridItemStyle | null;
};

/**
 * The font a measurer reads: the face and the computed font size in zoomed px. family names the bundled face (text.ts
 * AHEM_FACE_ID for the bundled Ahem, else sha256:<hex> of its bytes, as the font manifest names a face).
 */
/**
 * A text item's font as the measurer reads it: the face, the computed size and the used letter-spacing in px (css-text-3 §8.2,
 * 0 for normal), which Blink keeps in the FontDescription and adds after every cluster (ShapeResult::ApplySpacing).
 */
export type TextFont = { readonly family: string; readonly size: number; readonly letterSpacing: number; readonly wordSpacing: number; readonly smallCaps: boolean };

/**
 * A text run's font (css-fonts-4 §2). specifiedSize is the specified font size (css-fonts-4 §2.5) as an expression in CSS px at
 * zoom 1: a px leaf, a rem leaf for the root's size, an em leaf over the parent's expression, a font-percent or font-calc of the
 * parent's, or any length calculation. absoluteSize is Blink FontDescription::IsAbsoluteSize: false for a size derived through em
 * or % from a keyword size, which Chrome's minimum logical font size (6px) applies to. size is the computed size in px: the
 * compiler writes it at its reference environment (text scale 1, DPR 1) and the environment pass rewrites it from specifiedSize.
 */
export type FontSpec = { readonly family: string; readonly size: number; readonly specifiedSize: CalcExpr; readonly absoluteSize: boolean };

/**
 * css-text-4 §3.1 white-space-collapse; the compiler has already applied phase I (resolve.ts). collapse text arrives collapsed;
 * preserve and break-spaces text arrives as authored, and preserve-breaks text with its spaces collapsed, each U+000A a forced break.
 */
export type WhiteSpaceCollapse = 'collapse' | 'preserve' | 'preserve-breaks' | 'break-spaces';
/** css-text-4 §5.1 text-wrap-mode. */
export type TextWrapMode = 'wrap' | 'nowrap';
/** css-text-3 §5.5 overflow-wrap (word-wrap is its alias). */
export type OverflowWrap = 'normal' | 'break-word' | 'anywhere';
/** css-text-3 §5.2 word-break; break-all, keep-all and auto-phrase are refused (code word-break, TXT2-d). */
export type WordBreak = 'normal' | 'break-all' | 'keep-all' | 'break-word' | 'auto-phrase';

/** A text run with every inherited text property written on it by the compiler (goal.md principle 3). */
export type TextLeaf = {
  readonly kind: 'text';
  readonly id: string;
  /** Text after white-space phase I (css-text-3 §4.1.1): collapse text holds no tabs, segment breaks or doubled spaces. */
  readonly text: string;
  readonly font: FontSpec;
  readonly lineHeight: LineHeightValue;
  readonly whiteSpaceCollapse: WhiteSpaceCollapse;
  readonly textWrapMode: TextWrapMode;
  /**
   * css-text-3 §8.2 letter-spacing as a length expression in CSS px at zoom 1 (normal is px 0); the environment pass resolves it
   * to zoomed px (Blink StyleBuilderConverter::ConvertSpacing, a Length::Fixed), which layout reads.
   */
  readonly letterSpacing: CalcExpr;
  /** css-text-3 §8.1 word-spacing as letterSpacing is held (normal is px 0); Blink adds it after every space (ShapeResult::ApplySpacing). */
  readonly wordSpacing: CalcExpr;
  readonly overflowWrap: OverflowWrap;
  readonly wordBreak: WordBreak;
  /**
   * css-fonts-4 §6.5 font-variant-caps: small-caps over a face without smcp, with font-synthesis-small-caps auto: Blink draws each
   * run of lowercase letters uppercased at 70% of the font size, rounded (HarfBuzzShaper::ShapeSegment, SmallCapsFontData).
   */
  readonly smallCaps: boolean;
};

/** element: the box of an authored element. anonymous: a box the compiler generated (CSS2 §9.2.1.1, css-flexbox-1 §4). */
export type BoxType = 'element' | 'anonymous';

/** css-images-3 §5.5 object-fit. */
export type ObjectFit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
/** One object-position axis as an offset from the left or top edge of the content box; the compiler refuses calculations. */
export type ObjectPositionValue = Px | Percent;
/** The natural dimensions of a replaced element in CSS px: an image's size (its ratio is the size's), or none (an iframe). */
export type NaturalSizeValue = { readonly kind: 'image'; readonly width: number; readonly height: number } | { readonly kind: 'none' };

/**
 * A block-level replaced element (CSS 2.2 §10.3.4, §10.6.2; css-sizing-4 §5): a leaf box whose content is an image or a
 * foreign view. defaultWidth and defaultHeight are the default object size (CSS 2.2 §10.3.2, 300x150 CSS px), which sizes a box
 * with no natural size and no ratio.
 */
export type ReplacedLeaf = {
  readonly kind: 'replaced';
  readonly id: string;
  readonly style: LayoutStyle;
  readonly natural: NaturalSizeValue;
  readonly defaultWidth: number;
  readonly defaultHeight: number;
  readonly objectFit: ObjectFit;
  readonly objectPositionX: ObjectPositionValue;
  readonly objectPositionY: ObjectPositionValue;
};

/** A box-level child: an element or anonymous box, or a replaced leaf. */
export type LayoutNode = LayoutBox | ReplacedLeaf;

/**
 * An inline box (CSS2 §9.2.2): an element with display inline inside an inline formatting context. Its font and line-height are
 * the element's own, which its box contributes to every line it is on (CSS2 §10.8.1); its style's display is inline.
 */
export type InlineBox = {
  readonly kind: 'inline';
  readonly id: string;
  readonly style: LayoutStyle;
  readonly font: FontSpec;
  readonly lineHeight: LineHeightValue;
  readonly children: readonly InlineChild[];
};

/** A <br> element: a forced line break (UAX #14 class BK). Its font and line-height are its own; Blink ignores them (INL-P). */
export type LineBreak = { readonly kind: 'br'; readonly id: string; readonly font: FontSpec; readonly lineHeight: LineHeightValue };

/** The inline-level content of an inline formatting context. */
export type InlineChild = TextLeaf | InlineBox | LineBreak;

/** The strut of a block container with inline content (CSS2 §10.8.1): the container's own font and line-height. */
export type LineStrut = { readonly font: FontSpec; readonly lineHeight: LineHeightValue };

/**
 * Children are either all boxes and replaced leaves or all inline-level (text leaves, inline boxes and line breaks): the compiler
 * wraps mixed content in anonymous boxes. strut is the box's font and line-height when its children are inline-level, else null.
 */
export type LayoutBox = {
  readonly kind: 'box';
  readonly id: string;
  readonly boxType: BoxType;
  readonly style: LayoutStyle;
  readonly strut: LineStrut | null;
  readonly children: readonly (LayoutBox | ReplacedLeaf | InlineChild)[];
};

/** The initial containing block in CSS px. */
export type Viewport = { readonly width: number; readonly height: number };

/** The small, large and dynamic viewports viewport units read (css-values-4 §6.1.2.1), in CSS px before the device ceil (R6). */
export type ViewportUnitSizes = { readonly small: Viewport; readonly large: Viewport; readonly dynamic: Viewport };

/** The safe-area insets env(safe-area-inset-*) reads (css-env-1 §3), in CSS px. */
export type SafeAreaInsets = { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };

export type LayoutInput = {
  readonly viewport: Viewport;
  /** Device pixels per CSS px in the target environment; border widths snap to whole device px (css-values-4 §6.1). */
  readonly devicePixelRatio: number;
  readonly viewportUnits: ViewportUnitSizes;
  readonly safeArea: SafeAreaInsets;
  /** The root element's specified font size in CSS px, after the host's text scale; rem leaves read it. */
  readonly rootFontSize: number;
  readonly root: LayoutBox;
};
