// Form controls (FORM-a), ported from Blink's BSD files at 145.0.7632.6. The compiler writes a control as Chrome's own UA shadow
// structure, with a ControlBox (input.ts) where Blink's layout treats the box specially:
// - input[type=range] (range): a flex container (range_input_type.cc:285-288 CreateLayoutObject returns LayoutFlexibleBox) holding
//   the slider container (flex), the track (a block flex item, align-self center) and the thumb (slider-thumb, the track's block
//   child), whose inline offset is moved by the value (block_layout_algorithm.cc:2652-2654 and 3936-3945
//   AdjustSliderThumbInlineOffset); its default content inline size is 129 CSS px times the zoom, a Chrome observation pinned by
//   FORM-0's boxes (Blink computes it in layout_box.cc, which is LGPL: a reference only, nothing here follows its code).
// - a single-line text field (text-field, FORM-b): a block container of its placeholder and inner editor. Its default content inline
//   size is size x the average character width (textFieldInlineSize), rounded up to a whole px (Chrome 145 under Ahem: size 3 at
//   10px is 30px, at 13.3333px on Linux, whose hinted advance of 0 is 13.1px, 40px), a Chrome observation. Its auto content
//   height is the editor's; the editor is centred in the content box unsafely (a 41px field puts a 10px editor 15.5px down, a 4px
//   one 3px up), and the placeholder is placed with its baseline on the editor's, or at the editor's top when either has no
//   baseline (Chrome 145 probes).
// - a block button (button-block): its in-flow contents are centred in the block axis, safely (html.css
//   `-internal-align-content-block: center`, block_layout_algorithm_utils.cc:185-203 AlignBlockContent). A flex or grid button is
//   the plain container its display says (html_button_element.cc:59-74 CreateLayoutObject). There is no anonymous inner box.
import type { ControlBox, ControlKind, Direction, LayoutBox } from './input.ts';
import type { SvgPathShape, SvgSegment } from './svg-path-types.ts';
import type { TextMeasurer } from './text.ts';
import type { LU } from './units.ts';
import { ceilFloatToWholePx, clampNegativeToZero, divInt, doubleMul, float32, floatAdd, floatDiv, floatMul, fromCssPx, fromDouble, intDiv, roundfPx, sub, toPx, truncPxToInt, ZERO } from './units.ts';

/** A range's default track length in CSS px: Chrome 145 lays out an auto-width range with a 129 px content box (FORM-0 boxes). */
export const SLIDER_DEFAULT_TRACK_LENGTH = 129;

/** The track length at a zoom, multiplied in float like every px length environment.ts zooms; environment.ts zooms a range with it. */
export function zoomTrackLength(px: number, zoom: number): number {
  return floatMul(px, float32(zoom));
}

/** The default track length at a zoom, in LU (fromCssPx), as FORM-0's boxes give it at zoom 1, 2, 3 and 2.625. */
export function sliderIntrinsicInlineSize(zoom: number): LU {
  return fromCssPx(zoomTrackLength(SLIDER_DEFAULT_TRACK_LENGTH, zoom));
}

/** A control box laid out as the plain box it is, without its control facts. */
export function controlAsBox(c: ControlBox): LayoutBox {
  return { kind: 'box', id: c.id, boxType: c.boxType, style: c.style, strut: c.strut, marker: null, children: c.children };
}

/** The control facts of a box, or null for a plain box. */
export function controlOf(box: LayoutBox | ControlBox): ControlKind | null {
  return box.kind === 'control' ? box.control : null;
}

/**
 * css-sizing-3 §5.2.2: a select or text field is compressible, so a percentage width resolves against zero in its min-content
 * contribution; Chrome 145 compresses neither a button's width nor any control's percentage max-width (grid-controls, select-compress).
 */
export function compressesPercentWidth(box: LayoutBox | ControlBox): boolean {
  return box.kind === 'control' && (box.control.kind === 'text-field' || box.control.kind === 'select-menulist');
}

/** The plain box of a box or control box. */
export function plainBox(box: LayoutBox | ControlBox): LayoutBox {
  return box.kind === 'control' ? controlAsBox(box) : box;
}

/**
 * block_layout_algorithm.cc:3936-3945: the thumb moves along the track's inline axis by
 * LayoutUnit(RatioValue().ToDouble() * (ChildAvailableSize().inline_size - fragment.InlineSize())); LayoutUnit(double) truncates.
 * The ratio is the input's (value - min) / (max - min), 0 when max equals min, which the compiler derives in Blink's Decimal.
 */
export function sliderThumbInlineOffset(ratio: number, trackContentInline: LU, thumbInline: LU): LU {
  return fromDouble(doubleMul(ratio, toPx(sub(trackContentInline, thumbInline))));
}

/**
 * block_layout_algorithm.cc:2652-2654: the physical move of a thumb placed in a block container of the given direction; the
 * logical offset runs leftward in rtl.
 */
export function sliderThumbShift(ratio: number, trackContentWidth: LU, thumbWidth: LU, direction: Direction): LU {
  const offset = sliderThumbInlineOffset(ratio, trackContentWidth, thumbWidth);
  return direction === 'rtl' ? sub(ZERO, offset) : offset;
}

/**
 * block_layout_algorithm_utils.cc:194-201: a block button's in-flow contents move down by free space / 2, where free space is the
 * content box block size less the contents' block size, clamped at 0 because buttons align safely.
 */
export function buttonContentShift(contentBoxBlockSize: LU, contentsBlockSize: LU): LU {
  return divInt(clampNegativeToZero(sub(contentBoxBlockSize, contentsBlockSize)), 2);
}

/**
 * FORM-b: a text field's default content inline size, size x its average character width, rounded up to a whole px. Blink's
 * GetAvgCharWidth takes max(avg, roundf(avg)) of the face's average character width, which is Ahem's advance of 0 (both 1em;
 * the compiler refuses a field in another face natively), so 10.5px Ahem is 11px a character.
 */
export function textFieldInlineSize(measurer: TextMeasurer, c: Extract<ControlKind, { kind: 'text-field' }>): LU {
  const avg = float32(measurer.lengths({ family: c.font.family, size: c.font.size, letterSpacing: 0, wordSpacing: 0, smallCaps: false }).zeroWidth);
  const rounded = roundfPx(avg);
  return ceilFloatToWholePx(floatMul(rounded > avg ? rounded : avg, float32(c.size)));
}

/** FORM-b: the offset of a field's editor from its content box top: (content box block size - editor block size) / 2, unclamped. */
export function textEditorShift(contentBoxBlockSize: LU, editorBlockSize: LU): LU {
  return divInt(sub(contentBoxBlockSize, editorBlockSize), 2);
}

/**
 * FORM-b: the width of a menulist-button select's arrow box in zoomed px, as Chrome 145 sizes it (layout_theme_default.cc
 * ClampedMenuListArrowPaddingSize, a reference: the captured inner element margins and arrow pixels pin it). arrowWidth is the
 * platform's arrow width in DIP; the box is the scaled width at a zoom below the device scale, else the width times the zoom.
 */
export function menuListArrowBox(arrowWidth: number, zoom: number, device: number): number {
  const scaled = truncPxToInt(floatMul(arrowWidth, float32(device)));
  const deviceScale = floatDiv(scaled, arrowWidth);
  return float32(zoom) < deviceScale ? scaled : floatMul(arrowWidth, float32(zoom));
}

/** FORM-b: a menulist-button select's inner element margins (inline start, end) and paddings (block start, end) in zoomed px, whole. */
export type MenuListInsets = { readonly start: number; readonly end: number; readonly top: number; readonly bottom: number };

export function menuListInnerInsets(arrowWidth: number, zoom: number, device: number): MenuListInsets {
  const z = float32(zoom);
  const block = truncPxToInt(z);
  return { start: truncPxToInt(floatMul(4, z)), end: truncPxToInt(floatAdd(z, menuListArrowBox(arrowWidth, zoom, device))), top: block, bottom: block };
}

/** FORM-b: a menulist-button select's drop-down arrow, an open "v" stroked 2 device px wide in the select's colour, in device px. */
export type MenuListArrow = { readonly shape: SvgPathShape; readonly strokeWidth: number };

function minInt(a: number, b: number): number {
  return a < b ? a : b;
}

function maxInt(a: number, b: number): number {
  return a > b ? a : b;
}

/**
 * FORM-b: the arrow of a menulist-button select whose snapped border box is left, top, width, height in device px with whole
 * border widths borderLeft and borderRight, in horizontal-tb: centred in the arrow box at the inline end (theme_painter_default.cc
 * SetupMenuListArrow, a reference pinned by the captured arrow pixels), as an 8:4 "v" scaled with the box and fitted to the
 * border box (native_theme_base.cc:691-800 NativeThemeBase::PaintMenuList), in Chrome's int and float steps.
 */
export function menuListArrow(left: number, top: number, width: number, height: number, borderLeft: number, borderRight: number, arrowBox: number, arrowWidth: number, inlineEndLeft: boolean): MenuListArrow {
  const innerLeft = left + truncPxToInt(borderLeft);
  const innerRight = left + width - truncPxToInt(borderRight);
  const middle = top + intDiv(height, 2);
  const size = floatMul(8, floatDiv(arrowBox, arrowWidth));
  const arrowX = truncPxToInt(inlineEndLeft ? innerLeft + (arrowBox - size) / 2 : innerRight - (arrowBox + size) / 2);
  const wantW = truncPxToInt(size);
  const wantH = intDiv(wantW, 2);
  const wantY = middle - intDiv(wantH, 2);
  let x = maxInt(arrowX, left);
  let y = maxInt(wantY, top);
  let w = minInt(arrowX + wantW, left + width) - x;
  let h = minInt(wantY + wantH, top + height) - y;
  if (w <= 0 || h <= 0) {
    x = 0;
    y = 0;
    w = 0;
    h = 0;
  }
  if (w !== wantW || h !== wantH) {
    if ((wantH - h) * 2 > wantW - w) w = h * 2;
    else h = intDiv(w, 2);
    x = arrowX + intDiv(wantW - w, 2);
    y = middle - intDiv(h, 2);
  }
  const segments: SvgSegment[] = [
    { kind: 'move', x: x, y: y },
    { kind: 'line', x: x + intDiv(w, 2), y: y + h },
    { kind: 'line', x: x + w, y: y },
  ];
  return { shape: { kind: 'path', segments: segments }, strokeWidth: 2 };
}
