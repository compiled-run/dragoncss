// Refusals on computed values and laid-out text that no profile row can express: they depend on a value the author did not write
// (the css-overflow-3 §3.1 pair rule, Chrome's user-agent defaults), on where a declaration applies (html and body), or on the
// text and its direction (UAX #9).
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { radiusLengths, roundsAnyCorner } from '../lower/paint/radius.ts';
import { ProgramError } from '../lower/paint/types.ts';
import { RADIUS_LONGHANDS } from '../css/properties/radius.ts';
import type { Longhand } from '../css/properties.ts';
import { LONGHANDS } from '../css/properties.ts';
import { exactLayoutRatio, featureOf, isMathValue } from '../css/values.ts';
import { isPercentMath, mathContextFor, parseMath } from '../css/math.ts';
import type { CssValue, FamilyKeyContext } from '../css/values.ts';
import type { SupportProfile } from '../profiles/types.ts';
import { provenContexts } from '../profiles/types.ts';
import type { FxFaults } from '../faults/fx.ts';
import { FX_FAULTS } from '../faults/fx.ts';
import type { GenBFaults } from '../faults/gen-b.ts';
import { GEN_B_FAULTS } from '../faults/gen-b.ts';
import type { TxtFvFaults } from '../faults/txt-fv.ts';
import { TXT_FV_FAULTS } from '../faults/txt-fv.ts';
import { checkFontVariant } from './font-variant.ts';
import { checkSmallCaps } from './small-caps.ts';
import type { TxtFtFaults } from '../faults/txt-ft.ts';
import { TXT_FT_FAULTS } from '../faults/txt-ft.ts';
import { checkFontTuning } from './font-tuning.ts';
import type { TxtFstretchFaults } from '../faults/txt-fstretch.ts';
import { TXT_FSTRETCH_FAULTS } from '../faults/txt-fstretch.ts';
import { stretchPercent } from '../css/properties/font-stretch.ts';
import type { TxtFfFaults } from '../faults/txt-ff.ts';
import { TXT_FF_FAULTS } from '../faults/txt-ff.ts';
import type { TxtFsFaults } from '../faults/txt-fs.ts';
import { TXT_FS_FAULTS } from '../faults/txt-fs.ts';
import type { TxtFillFaults } from '../faults/txt-fill.ts';
import { TXT_FILL_FAULTS } from '../faults/txt-fill.ts';
import type { TxtFxFaults } from '../faults/txt-fx.ts';
import { TXT_FX_FAULTS } from '../faults/txt-fx.ts';
import type { TxtWFaults } from '../faults/txt-w.ts';
import { TXT_W_FAULTS } from '../faults/txt-w.ts';
import type { TransformExtraFaults } from '../faults/transform-extra.ts';
import { TRANSFORM_EXTRA_FAULTS } from '../faults/transform-extra.ts';
import { checkTransformExtra } from './transform-extra.ts';
import { checkZoom } from './zoom.ts';
import type { ScrollContainmentFaults } from '../faults/scroll-containment.ts';
import { SCROLL_CONTAINMENT_FAULTS } from '../faults/scroll-containment.ts';
import { checkScrollContainment } from './scroll-containment.ts';
import type { MaskFaults } from '../faults/mask.ts';
import { MASK_FAULTS } from '../faults/mask.ts';
import { isInitialMask, MASK_LONGHANDS } from '../css/properties/mask.ts';
import type { BorderImageFaults } from '../faults/border-image.ts';
import { BORDER_IMAGE_FAULTS } from '../faults/border-image.ts';
import { checkBorderImage } from './border-image.ts';
import type { Diagnostic } from '../types.ts';
import type { UaDataset } from '../ua/datasets.ts';
import { uaRows } from '../ua/datasets.ts';
import { checkInlineLevel } from './blockify.ts';
import { uaTagOf } from './elements.ts';
import { isReplacedTag } from './elements/replaced.ts';
import { isSvgShapeTag, shapeOf, svgGeometryOf, type SvgGeometryProperty, svgPaintRefusal, svgPercentageRefusal, svgShapePainted, svgZeroLengthSubpath } from './elements/svg.ts';
import { dashArrayOf } from '../css/properties/svg-dash.ts';
import { analyzeDecorations } from './text-decoration.ts';
import { checkTextShadows } from './text-shadow.ts';
import { isRefusedMath, synthesisAllowedOf, synthesizesBold, textFontOfProps } from './computed.ts';
import { serializeFontStyle, serializeFontWeight } from '../fonts/weight.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';
import { PAINT_VALUES } from './paint-values/index.ts';
import { environmentOf, generatedPseudoOf, refusedGenerationOf, valueToString } from './resolve.ts';
import { usedColors } from '../lower/paint/colors.ts';
import { checkOutlinePlacement } from './paint-values/outline.ts';
import { checkTransformContexts, elementWillChange } from './paint-values/transform.ts';
import { opacityOf } from '../css/properties/effects.ts';
import { checkTextTransform } from './text-transform.ts';
import { checkLineClamp, lineClampOf } from './line-clamp.ts';
import { checkResize } from './resize.ts';
import { checkTouchAction, nativePanner, type NativePanner } from './touch-action.ts';

const keywordOf = (v: ResolvedValue): string => (v.value.kind === 'keyword' ? v.value.value : '');
/** css-text-3 §8.1: whether a computed word-spacing adds space, anything but normal and 0px. */
const wordSpaced = (v: ResolvedValue): boolean => keywordOf(v) !== 'normal' && !(v.value.kind === 'length' && v.value.value === 0);
/** A computed length or percentage of zero, as it serializes. */
const isZeroLength = (v: ResolvedValue['value']): boolean => ['0', '0px', '0%'].includes(valueToString(v));

/** UAX #9: in an rtl paragraph only these keep logical order (strong L letters, space, U+200B not at the end). */
const RTL_SAFE = /^[A-Za-z \u200b]*$/u;

// css-overflow-3 §3.1: clip beside visible on the other axis keeps both, and clips one axis only, which native views do not draw
// yet (OVFL-c). Every other computed pair is supported, html and body included: the lowering resolves viewport propagation (§3.3).
function checkOverflow(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const axes: Longhand[] = ['overflow-x', 'overflow-y'];
  const values = axes.map((p) => el.props.get(p) as ResolvedValue);
  const keys = values.map(keywordOf);
  const oneAxisClip = (keys[0] === 'clip') !== (keys[1] === 'clip') && (keys[0] === 'visible' || keys[1] === 'visible');
  if (!oneAxisClip) return;
  const i = keys[0] === 'clip' ? 0 : 1;
  const v = values[i] as ResolvedValue;
  const source = v.declaration !== null ? v : values.find((x) => x.declaration !== null);
  if (source === undefined || source.declaration === null) return;
  const span = source.declaration.valueSpan;
  const property = axes[i] as Longhand;
  const message = `${property}: clip beside ${axes[1 - i] as Longhand}: visible on ${el.element.address} clips one axis only, which needs OVFL-c (css-overflow-3 §3.1)`;
  for (const t of targets) {
    const id = `${t}|${span.source.uri}|${span.start}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(span), target: t, message, manual: 'Use overflow: clip on both axes, or hidden.', basis: 'computed-value' }));
  }
}

const isScrollKeyword = (k: string): boolean => k === 'hidden' || k === 'auto' || k === 'scroll';

/**
 * OVFL-B: Chrome 145 paints a user-scrollable box's solid background in its scrolling contents (LayoutBox::
 * ComputeBackgroundPaintLocation), over the scrollable overflow rect plus borders at the contents paint offset
 * (BoxFragmentPainter::PaintBoxDecorationBackground), which places it by the scroll origin's whole device px. A scroll container
 * whose overflow may extend past its start (any rtl one, and a reversed flex container: row-reverse, column-reverse or
 * wrap-reverse) has a scroll origin, and where that is a fraction of a device px its background stops up to one device px short
 * of the padding box's end edge (measured: overflow-flex-reverse a2 at DPR 2.625, x 180). The native scroll views paint the
 * background over the whole padding box, so a painted background there is refused on ios and android until it is drawn so.
 */
function checkStartOverflowBackground(el: ResolvedElement, propagated: ResolvedElement | null, nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  if (nativeTargets.length === 0 || el === propagated) return;
  const kw = (p: Longhand): string => keywordOf(el.props.get(p) as ResolvedValue);
  const reversed = kw('display') === 'flex' && (kw('flex-direction').endsWith('-reverse') || kw('flex-wrap') === 'wrap-reverse');
  const rtl = kw('direction') === 'rtl';
  const scrolls = (['overflow-x', 'overflow-y'] as const).some((p) => kw(p) === 'auto' || kw(p) === 'scroll');
  const bg = el.props.get('background-color') as ResolvedValue;
  const painted = bg.value.kind === 'color' ? bg.value.value.alpha > 0 : !(bg.value.kind === 'keyword' && bg.value.value === 'transparent');
  if (!(reversed || rtl) || !scrolls || !painted) return;
  const origin = bg.declaration === null ? el.element.node.origin : authored(bg.declaration.valueSpan);
  const shape = reversed ? `a reversed flex scroll container (${kw('flex-direction')}, ${kw('flex-wrap')}${rtl ? ', rtl' : ''})` : 'an rtl scroll container';
  const message = `background-color on ${el.element.address}, ${shape} whose overflow may extend past its start: Chrome paints it in the scrolling contents, offset by the scroll origin's whole device px, which the native scroll view does not draw yet (OVFL-B)`;
  for (const t of nativeTargets) {
    const id = `${t}|ovfl-b-bg|${JSON.stringify(origin)}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNPROVEN_CONTEXT', { origin, target: t, message, manual: 'Move the background to a wrapper outside the scroll container, or use overflow: hidden.' }));
  }
}

/**
 * OVFL-B with PNT1 (#198): a rounded overflow clip masks the clip view (iOS layer mask, Android outline or overlay mask) in its own
 * coordinates, which a scroll view moves with its scroll offset, and no fixture compares a rounded scroll container with Chrome.
 * So border-radius on an auto or scroll container is refused on ios and android until it is drawn and proven.
 */
function checkRoundedScrollContainer(el: ResolvedElement, propagated: ResolvedElement | null, nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  if (nativeTargets.length === 0 || el === propagated) return;
  const kw = (p: Longhand): string => keywordOf(el.props.get(p) as ResolvedValue);
  if (!(['overflow-x', 'overflow-y'] as const).some((p) => kw(p) === 'auto' || kw(p) === 'scroll')) return;
  let rounded: boolean;
  try {
    rounded = roundsAnyCorner(radiusLengths(el.props, el.element.address));
  } catch (e) {
    // A radius that does not compute to px or a percentage is refused by the radius lowering itself.
    if (e instanceof ProgramError) return;
    throw e;
  }
  if (!rounded) return;
  const decl = RADIUS_LONGHANDS.map((p) => el.props.get(p) as ResolvedValue).find((v) => v.declaration !== null);
  const origin = decl === undefined || decl.declaration === null ? el.element.node.origin : authored(decl.declaration.valueSpan);
  const message = `border-radius on ${el.element.address}, a scroll container: the rounded clip of a native scroll view is not drawn or proven yet (OVFL-B with PNT1)`;
  for (const t of nativeTargets) {
    const id = `${t}|ovfl-b-radius|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNPROVEN_CONTEXT', { origin, target: t, message, manual: 'Round a wrapper outside the scroll container, or use overflow: hidden.' }));
  }
}

const hasPercentage = (v: ResolvedValue): boolean => v.value.kind === 'percentage' || (v.value.kind === 'other' && v.value.text.includes('%'));

/** css-overflow-3 §3.3: the element whose overflow the viewport takes (html when not visible, else body), which uses visible. */
export function propagatedFrom(root: ResolvedElement): ResolvedElement | null {
  const visible = (el: ResolvedElement): boolean => keywordOf(el.props.get('overflow-x') as ResolvedValue) === 'visible' && keywordOf(el.props.get('overflow-y') as ResolvedValue) === 'visible';
  if (!visible(root)) return root;
  const body = root.children.find((c): c is ResolvedElement => c.kind === 'element' && c.element.tag === 'body');
  return body !== undefined && !visible(body) ? body : null;
}

// OVFL-p: the engine's scrollable overflow (packages/layout/src/overflow.ts) does not decide a relative offset with a percentage
// top or bottom inside a scroll container or on the root, so it is refused here, on every target as the other overflow refusals are.
function checkPercentRelative(el: ResolvedElement, where: string | null, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  if (where === null || keywordOf(el.props.get('position') as ResolvedValue) !== 'relative') return;
  for (const p of ['top', 'bottom'] as const) {
    const v = el.props.get(p) as ResolvedValue;
    if (!hasPercentage(v)) continue;
    const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
    const message = `position: relative with a percentage ${p} on ${el.element.address} ${where}: the scrollable overflow does not decide its basis yet (OVFL-p)`;
    for (const t of targets) {
      const id = `${t}|ovfl-p|${JSON.stringify(origin)}|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNPROVEN_CONTEXT', { origin, target: t, message, manual: `Use a length for ${p} here, or move the offset outside the scroll container.` }));
    }
  }
}

const displayKeyword = (el: ResolvedElement): string => keywordOf(el.props.get('display') as ResolvedValue);
const isInlineBox = (el: ResolvedElement): boolean => displayKeyword(el) === 'inline';
/** CSS2 §9.2.4: an atomic inline, an inline-block, inline-flex or inline-grid box (INL2a, G-INL). */
const isAtomic = (el: ResolvedElement): boolean => displayKeyword(el) === 'inline-block' || displayKeyword(el) === 'inline-flex' || displayKeyword(el) === 'inline-grid';

/**
 * One item of an inline formatting context in tree order: a text, the open or close of an inline box, a <br> (CSS2 §9.2.2), or an
 * atomic inline (§9.2.4).
 */
type IfcItem = { readonly kind: 'text'; readonly text: ResolvedText } | { readonly kind: 'open' | 'close' | 'br' | 'atomic'; readonly el: ResolvedElement };

/**
 * The inline formatting contexts whose block container is el (el is not itself an inline box): its maximal runs of inline-level
 * children, flattened through inline boxes. A block-level child ends a run (CSS2 §9.2.1.1); display: none children generate no box.
 * blockInInline receives each block-level box inside an inline box, which Dragon does not lay out, and each atomic inline there
 * (INL2c), which is also an atomic item of the run.
 */
function inlineContexts(el: ResolvedElement, blockInInline: (child: ResolvedElement, box: ResolvedElement) => void): IfcItem[][] {
  const runs: IfcItem[][] = [[]];
  const flatten = (box: ResolvedElement, out: IfcItem[]): void => {
    for (const c of box.children) {
      if (c.kind === 'text') out.push({ kind: 'text', text: c });
      else if (displayKeyword(c) === 'none') continue;
      else if (isAtomic(c)) {
        out.push({ kind: 'atomic', el: c });
        blockInInline(c, box);
      } else if (!isInlineBox(c)) blockInInline(c, box);
      else if (c.element.tag === 'br') out.push({ kind: 'br', el: c });
      else {
        out.push({ kind: 'open', el: c });
        flatten(c, out);
        out.push({ kind: 'close', el: c });
      }
    }
  };
  for (const c of el.children) {
    const run = runs[runs.length - 1] as IfcItem[];
    if (c.kind === 'text') run.push({ kind: 'text', text: c });
    else if (displayKeyword(c) === 'none') continue;
    else if (isAtomic(c)) run.push({ kind: 'atomic', el: c });
    else if (!isInlineBox(c)) runs.push([]);
    else if (c.element.tag === 'br') run.push({ kind: 'br', el: c });
    else {
      run.push({ kind: 'open', el: c });
      flatten(c, run);
      run.push({ kind: 'close', el: c });
    }
  }
  return runs.filter((r) => r.length > 0);
}

// UAX #9 and css-writing-modes-4 §2.4: the text of an rtl inline formatting context may hold only strong-L letters, spaces and
// U+200B, and U+200B may not be in the white space that ends a paragraph (at a <br>, bidi class B, or at the end, L1); anything else
// would be reordered, and it is refused for every target. The text of an inline box belongs to its block container's context.
function checkBidi(el: ResolvedElement, diagnostics: Diagnostic[], reported: Set<string>): void {
  if (isInlineBox(el) || keywordOf(el.props.get('direction') as ResolvedValue) !== 'rtl') return;
  const report = (t: ResolvedText, message: string): void => {
    const origin = t.node.node.origin;
    const id = `${t.node.address}|${JSON.stringify(origin)}`;
    if (reported.has(id)) return;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_BIDI', { origin, message }));
  };
  for (const run of inlineContexts(el, () => {})) {
    // The texts of each paragraph: the context split at its <br>s.
    const paragraphs: ResolvedText[][] = [[]];
    for (const it of run) {
      if (it.kind === 'br') paragraphs.push([]);
      else if (it.kind === 'text') (paragraphs[paragraphs.length - 1] as ResolvedText[]).push(it.text);
    }
    for (const texts of paragraphs) {
      // TXT2-c: Chrome splits preserved spaces and line feeds into fragments of their own at the paragraph level (UAX #9 L1).
      for (const t of texts) {
        const mode = keywordOf(t.props.get('white-space-collapse') as ResolvedValue);
        if (mode !== 'collapse') report(t, `${t.node.address} keeps its white space (white-space-collapse: ${mode}) in the rtl block ${el.element.address}, whose preserved spaces and line feeds take the paragraph direction (UAX #9 L1)`);
      }
      for (const t of texts) if (!RTL_SAFE.test(t.text)) report(t, `text ${JSON.stringify(t.text)} of ${t.node.address} holds a character other than A-Z, a-z, space and U+200B in the rtl block ${el.element.address}`);
      // The white space (spaces and U+200B) that ends the paragraph, walked back across its texts.
      let zwsp: ResolvedText | null = null;
      end: for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i] as ResolvedText;
        for (let k = t.text.length - 1; k >= 0; k--) {
          const ch = t.text[k] as string;
          if (ch === '\u200b') zwsp = t;
          else if (ch !== ' ') break end;
        }
      }
      if (zwsp !== null) report(zwsp, `U+200B ends the rtl inline content of ${el.element.address} (${zwsp.node.address}) and would take the paragraph direction (UAX #9 L1)`);
    }
    checkRtlAtomics(el, run, diagnostics, reported);
  }
}

// UAX #9 N1-N2 (the engine's checkRtlAtomics): an atomic inline is U+FFFC, a neutral; it keeps logical order between letters of its
// paragraph, or alone in a paragraph without letters. Anywhere else in an rtl context it would be reordered, which is refused.
function checkRtlAtomics(el: ResolvedElement, run: readonly IfcItem[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const paragraphs: IfcItem[][] = [[]];
  for (const it of run) {
    if (it.kind === 'br') paragraphs.push([]);
    else (paragraphs[paragraphs.length - 1] as IfcItem[]).push(it);
  }
  const letter = /[A-Za-z]/u;
  for (const items of paragraphs) {
    const atomics = items.filter((it) => it.kind === 'atomic');
    const letters = items.some((it) => it.kind === 'text' && letter.test(it.text.text));
    if (atomics.length === 0 || (!letters && atomics.length === 1)) continue;
    items.forEach((it, i) => {
      if (it.kind !== 'atomic') return;
      const before = items.slice(0, i).some((x) => x.kind === 'text' && letter.test(x.text.text));
      const after = items.slice(i + 1).some((x) => x.kind === 'text' && letter.test(x.text.text));
      if (before && after) return;
      const origin = it.el.element.node.origin;
      const id = `${it.el.element.address}|rtl-atomic`;
      if (reported.has(id)) return;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_BIDI', { origin, message: `atomic inline ${it.el.element.address} in the rtl block ${el.element.address} has no letter on ${before ? 'its end' : 'its start'} side in its paragraph, so it would take the paragraph direction and be reordered (UAX #9 N1-N2)` }));
    });
  }
}

// CSS2 §9.2.1.1, §9.4.2 and css-text-4 §5.1: what the inline formatting core does not lay out, refused for every target at the
// element: a block-level box inside an inline box (block-in-inline), an inline box on the empty line after a context's last <br>,
// and runs with different text-wrap-mode in one formatting context.
function checkInline(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, realFaceAt: (address: string) => boolean): void {
  if (isInlineBox(el)) return;
  const refuse = (at: ResolvedElement, what: string, message: string, manual: string): void => refuseFor(targets, at, what, message, manual);
  const refuseFor = (on: readonly string[], at: ResolvedElement, what: string, message: string, manual: string): void => {
    for (const t of on) {
      const id = `${t}|inline-${what}|${at.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: at.element.node.origin, target: t, message, manual, basis: 'computed-value' }));
    }
  };
  const refuseNative = (at: ResolvedElement, what: string, message: string, manual: string): void => refuseFor(targets.filter((t) => t === 'ios' || t === 'android'), at, what, message, manual);
  // INL2c: an atomic inline inside an inline box, or beside text in a real face (Blink's LineBreaker for it is not ported).
  const unproven = (at: ResolvedElement, what: string, message: string, manual: string): void => {
    for (const t of targets) {
      const id = `${t}|atomic-${what}|${at.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNPROVEN_CONTEXT', { origin: at.element.node.origin, target: t, message, manual }));
    }
  };
  const runs = inlineContexts(el, (child, box) => {
    if (isAtomic(child)) {
      unproven(child, 'in-inline-box', `${displayKeyword(child)} <${child.element.tag}> ${child.element.address} is an atomic inline inside the inline box <${box.element.tag}> ${box.element.address}; atomic inlines are proven only directly in their block container (INL2c)`, `Move <${child.element.tag}> ${child.element.address} out of <${box.element.tag}> ${box.element.address}.`);
      return;
    }
    refuse(child, 'block-in-inline', `<${child.element.tag}> ${child.element.address} is block-level inside the inline box <${box.element.tag}> ${box.element.address} (CSS2 §9.2.1.1 block-in-inline), which Dragon does not lay out`, `Move <${child.element.tag}> ${child.element.address} out of <${box.element.tag}> ${box.element.address}, or make ${box.element.address} a block.`);
  });
  for (const run of runs) {
    const realText = run.find((it) => it.kind === 'text' && realFaceAt(it.text.node.address));
    if (realText !== undefined && realText.kind === 'text') {
      for (const it of run) {
        if (it.kind !== 'atomic') continue;
        unproven(it.el, 'beside-shaped-text', `${displayKeyword(it.el)} <${it.el.element.tag}> ${it.el.element.address} shares an inline formatting context of ${el.element.address} with text ${realText.text.node.address} in a real face; atomic inlines are proven only beside Ahem text (INL2c)`, `Put the text beside ${it.el.element.address} in its own block, or make ${it.el.element.address} a block.`);
      }
    }
    const lastBr = run.map((it) => it.kind).lastIndexOf('br');
    if (lastBr >= 0) {
      const after = run.slice(lastBr + 1);
      const open = after.find((it) => it.kind === 'open');
      if (open !== undefined && open.kind === 'open' && !after.some((it) => it.kind === 'text' && it.text.text.trim() !== '')) {
        refuse(open.el, 'empty-line', `inline box <${open.el.element.tag}> ${open.el.element.address} starts the empty line after the last <br> of ${el.element.address} (CSS2 §9.4.2), which Dragon does not lay out`, `Remove the empty <${open.el.element.tag}> ${open.el.element.address} after the last <br>, or give it text.`);
      }
    }
    // resolve.ts collapses the white space of a context with inline boxes or <br>s across them (collapseInlineContext), which is
    // right only for white-space-collapse: collapse (css-text-4 §4.1.1).
    for (const it of run) {
      if (it.kind !== 'open' && it.kind !== 'br') continue;
      // The native runtime places inline box views unpainted (their decorations are INL1b), so a paint an inline box would draw
      // is refused on native rather than dropped. Of the paint longhands, only background-color paints an inline box without a
      // border width (which the inline/ltr context refuses); transform, overflow and will-change do not apply to inline boxes.
      if (it.kind === 'open' && usedColors(it.el)['background-color'].alpha !== 0) {
        const bg = valueToString((it.el.props.get('background-color') as ResolvedValue).value);
        refuseNative(it.el, 'background', `background-color: ${bg} on the inline box <${it.el.element.tag}> ${it.el.element.address}: the native runtime does not paint inline boxes until INL1b (inline box decorations), so the background would be dropped`, `Move the background to a block, or remove it from <${it.el.element.tag}> ${it.el.element.address}, until INL1b.`);
      }
      // PNT1: opacity below 1 (or will-change: opacity) makes an inline box a stacking context whose group would hold its content,
      // which the native runtime places as flat siblings of the inline box view, so the group would be dropped.
      const opacity = it.kind === 'open' ? opacityOf((it.el.props.get('opacity') as ResolvedValue).value) : 1;
      if (opacity === null && it.kind === 'open') throw new Error(`${it.el.element.address}: opacity did not compute to a number`);
      if (it.kind === 'open' && ((opacity as number) < 1 || elementWillChange(it.el).includes('opacity'))) {
        const what = (opacity as number) < 1 ? ['opacity', `opacity: ${opacity}`] : ['will-change', 'will-change: opacity'];
        refuseNative(it.el, 'stacking-context', `${what[1]} on the inline box <${it.el.element.tag}> ${it.el.element.address} makes it a stacking context: the native runtime places an inline box's content beside its view, not in it, until INL1b, so the group would be dropped`, `Move the ${what[0]} to a block, or remove it from <${it.el.element.tag}> ${it.el.element.address}, until INL1b.`);
      }
      const collapse = keywordOf(it.el.props.get('white-space-collapse') as ResolvedValue);
      if (collapse !== 'collapse') refuse(it.el, 'white-space', `white-space-collapse: ${collapse} on the inline box <${it.el.element.tag}> ${it.el.element.address} (css-text-4 §4.1.1), which Dragon does not lay out`, `Remove the white-space declaration of ${it.el.element.address}, or make ${it.el.element.address} a block.`);
    }
    const preserved = run.some((it) => it.kind !== 'text') ? run.find((it) => it.kind === 'text' && keywordOf(it.text.props.get('white-space-collapse') as ResolvedValue) !== 'collapse') : undefined;
    if (preserved !== undefined && preserved.kind === 'text') {
      refuse(el, 'white-space', `white-space-collapse: ${keywordOf(preserved.text.props.get('white-space-collapse') as ResolvedValue)} on ${preserved.text.node.address} in an inline formatting context of ${el.element.address} with inline boxes or <br>s (css-text-4 §4.1.1), which Dragon does not lay out`, `Remove the white-space declaration of ${el.element.address}.`);
    }
    const texts = run.flatMap((it) => (it.kind === 'text' ? [it.text] : []));
    for (const t of texts) checkPreservedText(el, t, refuse);
    // TXT2 with TXT2-b and TXT2-c: Blink justifies with letter and word spacing in one ShapeResultSpacing pass, and justifies a wrapped preserved
    // line around its preserved spaces; no Chrome case covers either yet.
    if (keywordOf(el.props.get('text-align') as ResolvedValue) === 'justify') {
      const spaced = texts.find((t) => keywordOf(t.props.get('letter-spacing') as ResolvedValue) !== 'normal');
      if (spaced !== undefined) refuse(el, 'justify-letter-spacing', `text-align: justify on ${el.element.address} with letter-spacing on ${spaced.node.address} is not laid out yet`, `Remove the letter-spacing that reaches ${spaced.node.address}, or use another text-align on ${el.element.address}.`);
      const wordSpacedText = texts.find((t) => wordSpaced(t.props.get('word-spacing') as ResolvedValue));
      if (wordSpacedText !== undefined) refuse(el, 'justify-word-spacing', `text-align: justify on ${el.element.address} with word-spacing on ${wordSpacedText.node.address} is not laid out yet`, `Remove the word-spacing that reaches ${wordSpacedText.node.address}, or use another text-align on ${el.element.address}.`);
      const preserved = texts.find((t) => keywordOf(t.props.get('white-space-collapse') as ResolvedValue) !== 'collapse' && keywordOf(t.props.get('text-wrap-mode') as ResolvedValue) === 'wrap');
      if (preserved !== undefined) refuse(el, 'justify-white-space', `text-align: justify on ${el.element.address} with wrapping preserved white space in ${preserved.node.address} is not laid out yet`, `Remove the white-space declaration that reaches ${preserved.node.address}, or use another text-align on ${el.element.address}.`);
      // INL2a with TXT2: how Blink justifies a line around an atomic inline has no Chrome comparison yet (inline.ts checkAtomicContext).
      const atom = run.find((it) => it.kind === 'atomic');
      if (atom !== undefined && atom.kind === 'atomic') refuse(el, 'justify-atomic', `text-align: justify on ${el.element.address} with the atomic inline ${atom.el.element.address} is not laid out yet`, `Use another text-align on ${el.element.address}, or make ${atom.el.element.address} a block.`);
    }
    const wrapOf = (t: ResolvedText): string => keywordOf(t.props.get('text-wrap-mode') as ResolvedValue);
    const first = texts[0];
    const other = first === undefined ? undefined : texts.find((t) => wrapOf(t) !== wrapOf(first));
    if (first !== undefined && other !== undefined) {
      refuse(el, 'mixed-wrap', `text-wrap-mode ${wrapOf(first)} (${first.node.address}) and ${wrapOf(other)} (${other.node.address}) in one inline formatting context of ${el.element.address} (css-text-4 §5.1), which Dragon does not lay out`, `Give all the text of ${el.element.address} the same white-space.`);
    }
    // TXT2-a: the engine applies one overflow-wrap and word-break per inline formatting context (inline.ts buildIfc).
    const breakOf = (t: ResolvedText): string => `overflow-wrap: ${keywordOf(t.props.get('overflow-wrap') as ResolvedValue)}; word-break: ${keywordOf(t.props.get('word-break') as ResolvedValue)}`;
    const otherBreak = first === undefined ? undefined : texts.find((t) => breakOf(t) !== breakOf(first));
    if (first !== undefined && otherBreak !== undefined) {
      refuse(el, 'mixed-break', `${breakOf(first)} (${first.node.address}) and ${breakOf(otherBreak)} (${otherBreak.node.address}) in one inline formatting context of ${el.element.address} (css-text-3 §5.2, §5.5), which Dragon does not lay out`, `Give all the text of ${el.element.address} the same overflow-wrap and word-break.`);
    }
  }
}

// TXT2-h (css-text-3 §8.1): a nonzero text-indent indents the first formatted line of each block container, which the engine
// does in the container's own inline formatting context. Refused for every target where no Chrome case proves it yet: text in
// anonymous boxes (beside a block child, or directly in a flex or grid container), preserved white space, text-align: justify,
// text-overflow: ellipsis, and atomic inlines.
function checkTextIndent(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const value = el.props.get('text-indent') as ResolvedValue;
  if (isInlineBox(el) || isZeroLength(value.value)) return;
  const runs = inlineContexts(el, () => {});
  if (runs.length === 0) return;
  const at = `text-indent: ${valueToString(value.value)} on ${el.element.address}`;
  const blockChild = el.children.find((c): c is ResolvedElement => c.kind === 'element' && displayKeyword(c) !== 'none' && !isInlineBox(c) && !isAtomic(c));
  const display = displayKeyword(el);
  const texts = runs.flat().filter((it): it is { readonly kind: 'text'; readonly text: ResolvedText } => it.kind === 'text');
  let beside = '';
  if (['flex', 'grid', 'inline-flex', 'inline-grid'].includes(display)) beside = `with text directly in the ${display} container, which Chrome wraps in an anonymous item`;
  else if (blockChild !== undefined) beside = `with text beside the block <${blockChild.element.tag}> ${blockChild.element.address}, which Chrome wraps in anonymous blocks`;
  else if (texts.some((it) => keywordOf(it.text.props.get('white-space-collapse') as ResolvedValue) !== 'collapse')) beside = 'with preserved white space';
  else if (keywordOf(el.props.get('text-align') as ResolvedValue) === 'justify') beside = 'with text-align: justify';
  else if (keywordOf(el.props.get('text-overflow') as ResolvedValue) === 'ellipsis' && !['overflow-x', 'overflow-y'].every((p) => keywordOf(el.props.get(p as Longhand) as ResolvedValue) === 'visible')) beside = 'with text-overflow: ellipsis';
  else if (runs.some((r) => r.some((it) => it.kind === 'atomic'))) beside = 'beside an atomic inline';
  if (beside === '') return;
  const id = `text-indent|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const origin = value.declaration !== null ? authored(value.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message: `${at} ${beside} is not proven against Chrome yet`, manual: `Remove the text-indent from ${el.element.address}, or put its text in a block of its own with text-indent.`, basis: 'computed-value' }));
  }
}

// FX (filter-effects-1 §5): no target draws a filter yet, and a filter such as opacity(0) or brightness(0) can hide text, so a filter
// other than none is refused for every target where it applies (filter is not inherited). Planted fault filterListAccepted accepts it.
function checkFilter(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: FxFaults): void {
  const v = el.props.get('filter') as ResolvedValue;
  if (faults.filterListAccepted || (v.value.kind === 'keyword' && v.value.value === 'none')) return;
  const id = `filter|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `filter: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: Dragon draws no filter yet (FX); only none is accepted`,
      manual: `Remove the filter from ${el.element.address}, or set filter: none.`,
      basis: 'computed-value',
    }));
  }
}

/**
 * TXT2-f: whether text-overflow on el applies to its own lines: el is a block container (not an inline box, where text-overflow does
 * nothing, and not a flex or grid container, whose text is an anonymous item Chrome does not truncate, its parent being no block
 * container) that clips its overflow and is not the element whose overflow the viewport takes.
 */
function truncatesOwnLines(el: ResolvedElement, propagated: ResolvedElement | null): boolean {
  if (el === propagated || isInlineBox(el) || ['flex', 'grid', 'inline-grid'].includes(displayKeyword(el))) return false;
  return !['overflow-x', 'overflow-y'].every((p) => keywordOf(el.props.get(p as Longhand) as ResolvedValue) === 'visible');
}

// TXT2-f (css-overflow-4 §3.1): an ellipsis truncates the lines of a block container whose overflow is not visible
// (LayoutBlockFlow::ShouldTruncateOverflowingText), which the engine does left to right in the block's own inline formatting
// context. Refused for every target: rtl, and inline content beside block children (Chrome truncates the anonymous blocks'
// lines, which the engine lays out with initial styles). Refused on native: an inline box whose colour, visibility or face differs
// from the block's, since the native view draws the ellipsis with the text it follows while Chrome paints it in the block's style.
function checkTextOverflow(el: ResolvedElement, propagated: ResolvedElement | null, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const value = el.props.get('text-overflow') as ResolvedValue;
  if (keywordOf(value) !== 'ellipsis' || !truncatesOwnLines(el, propagated)) return;
  const runs = inlineContexts(el, () => {});
  if (runs.length === 0) return;
  const origin = value.declaration !== null ? authored(value.declaration.valueSpan) : el.element.node.origin;
  const refuse = (on: readonly string[], what: string, message: string, manual: string): void => {
    for (const t of on) {
      const id = `${t}|text-overflow-${what}|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
    }
  };
  const at = `text-overflow: ellipsis on ${el.element.address}`;
  if (keywordOf(el.props.get('direction') as ResolvedValue) === 'rtl') {
    refuse(targets, 'rtl', `${at} truncates rtl lines, which Dragon lays out left to right only`, `Remove text-overflow: ellipsis from ${el.element.address}, or make it ltr.`);
  }
  // TXT2-b with TXT2-f: how Chrome spaces the ellipsis and cuts spaced text (OffsetToFit) has no Chrome comparison yet.
  const spaced = keywordOf(el.props.get('letter-spacing') as ResolvedValue) !== 'normal' || runs.some((run) => run.some((it) => it.kind === 'text' && keywordOf(it.text.props.get('letter-spacing') as ResolvedValue) !== 'normal'));
  if (spaced) {
    refuse(targets, 'letter-spacing', `${at} truncates text with letter-spacing, which Dragon does not lay out yet`, `Remove letter-spacing from ${el.element.address} and its text, or remove text-overflow: ellipsis.`);
  }
  const wordSpacedRun = wordSpaced(el.props.get('word-spacing') as ResolvedValue) || runs.some((run) => run.some((it) => it.kind === 'text' && wordSpaced(it.text.props.get('word-spacing') as ResolvedValue)));
  if (wordSpacedRun) {
    refuse(targets, 'word-spacing', `${at} truncates text with word-spacing, which Dragon does not lay out yet`, `Remove word-spacing from ${el.element.address} and its text, or remove text-overflow: ellipsis.`);
  }
  // TXT2-c with TXT2-f: Blink truncates preserved text by its own items (control items, hanging spaces), which no Chrome case covers yet.
  if (runs.some((run) => run.some((it) => it.kind === 'text' && keywordOf(it.text.props.get('white-space-collapse') as ResolvedValue) !== 'collapse'))) {
    refuse(targets, 'white-space', `${at} truncates text whose white space is preserved, which Dragon does not lay out yet`, `Remove the white-space declaration (keep nowrap) from ${el.element.address} and its text, or remove text-overflow: ellipsis.`);
  }
  const blockChild = el.children.find((c): c is ResolvedElement => c.kind === 'element' && displayKeyword(c) !== 'none' && !isInlineBox(c));
  if (blockChild !== undefined) {
    refuse(targets, 'anonymous-block', `${at} holds text beside the block <${blockChild.element.tag}> ${blockChild.element.address}, whose anonymous block lines Chrome truncates and Dragon does not`, `Wrap the text of ${el.element.address} in its own block, and give that block the text-overflow.`);
  }
  // The style the ellipsis takes from its block and the native view from its text: font size is drawn per run, the rest is not.
  const styleOf = (e: ResolvedElement): string => JSON.stringify([usedColors(e).color, ...(['visibility', 'font-family', 'font-weight', 'font-style'] as const).map((p) => valueToString((e.props.get(p) as ResolvedValue).value))]);
  const own = styleOf(el);
  const native = targets.filter((t) => t === 'ios' || t === 'android');
  for (const run of runs) {
    for (const it of run) {
      if (it.kind !== 'open') continue;
      // The engine reports an inline box on a truncated line as Chrome reports a culled one (inline.ts boxLineRects); padding or an
      // inline margin gives the box a fragment of its own, whose rects that model does not cover.
      const edges = (['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-left', 'margin-right'] as const).filter((p) => !isZeroLength((it.el.props.get(p) as ResolvedValue).value));
      if (edges.length > 0) {
        refuse(native, 'box-fragment', `${at}: the inline box <${it.el.element.tag}> ${it.el.element.address} has ${edges.join(', ')}, so Chrome gives it a box fragment of its own on a truncated line, which Dragon does not lay out`, `Remove ${edges.join(', ')} from <${it.el.element.tag}> ${it.el.element.address}.`);
      }
      if (styleOf(it.el) === own) continue;
      refuse(native, 'paint', `${at}: the inline box <${it.el.element.tag}> ${it.el.element.address} has a colour, visibility or font face other than the block's, and the native runtime draws the ellipsis with the text it follows, not in the block's style`, `Give <${it.el.element.tag}> ${it.el.element.address} the colour, visibility and font face of ${el.element.address}.`);
    }
  }
}

// TXT2-c (notes/T149-txt2-spec.md R3, R16): text whose white-space-collapse is not collapse keeps its white space, and the engine
// lays out spaces and U+000A only. A tab needs tab stops (tab-size, TXT2-c3), and CR, FF and the other C0 controls become control
// items Dragon does not model. Preserved text that is only white space beside block boxes would make an anonymous line box Chrome
// keeps and Dragon's capture labels apart, so all-white-space preserved text is refused until Chrome cases cover it.
function checkPreservedText(el: ResolvedElement, t: ResolvedText, refuse: (at: ResolvedElement, what: string, message: string, manual: string) => void): void {
  const mode = keywordOf(t.props.get('white-space-collapse') as ResolvedValue);
  if (mode === 'collapse') return;
  const manual = `Remove the white-space declaration that reaches ${t.node.address}, or remove the character.`;
  // preserve-breaks collapses a tab like a space (phase I), so only the modes that keep it need tab stops.
  if (mode !== 'preserve-breaks' && t.text.includes('\t')) refuse(el, 'tab-stop', `a tab in ${t.node.address}, whose white-space-collapse is ${mode}: tab stops (tab-size, css-text-3 §4.2) are not laid out yet`, manual);
  for (const ch of t.text) {
    const cp = ch.codePointAt(0) as number;
    if (cp === 0x0a || cp === 0x09 || !((cp < 0x20) || cp === 0x7f)) continue;
    refuse(el, 'preserved-control', `U+${cp.toString(16).toUpperCase().padStart(4, '0')} in ${t.node.address}, whose white-space-collapse is ${mode}: preserved control characters (css-text-3 §4.1.2) are not laid out`, manual);
    break;
  }
  // TXT2-b with TXT2-c: spacing after preserved spaces, hanging spaces and segment breaks has no Chrome comparison yet.
  if (keywordOf(t.props.get('letter-spacing') as ResolvedValue) !== 'normal') refuse(el, 'letter-spacing', `letter-spacing on ${t.node.address}, whose white-space-collapse is ${mode}: spaced preserved white space is not laid out yet`, `Remove the letter-spacing or the white-space declaration that reaches ${t.node.address}.`);
  // Blink adds word spacing to every preserved space, the first included (WordSpacingWhiteSpacePre), which no Chrome case covers yet.
  if (wordSpaced(t.props.get('word-spacing') as ResolvedValue)) refuse(el, 'word-spacing', `word-spacing on ${t.node.address}, whose white-space-collapse is ${mode}: spaced preserved white space is not laid out yet`, `Remove the word-spacing or the white-space declaration that reaches ${t.node.address}.`);
  // TXT2-a with TXT2-c: how Blink breaks preserved spaces at grapheme boundaries has no Chrome comparison yet (inline.ts buildIfc).
  const breaks = (['overflow-wrap', 'word-break'] as const).filter((p) => keywordOf(t.props.get(p) as ResolvedValue) !== 'normal');
  if (breaks.length > 0) refuse(el, 'preserved-break', `${breaks.map((p) => `${p}: ${keywordOf(t.props.get(p) as ResolvedValue)}`).join(' and ')} on ${t.node.address}, whose white-space-collapse is ${mode}: breaking preserved white space inside words is not laid out yet`, `Remove the ${breaks.join(' and ')} or the white-space declaration that reaches ${t.node.address}.`);
  if (/^[ \t\n]*$/.test(t.text)) refuse(el, 'preserved-blank', `${t.node.address} is only white space kept by white-space-collapse: ${mode} (css-text-4 §4.1.1), which Dragon does not lay out yet`, `Remove the white space of ${t.node.address}, or the white-space declaration that reaches it.`);
}

// CSS2 §9.2.1.1 and §10.3.7: an absolutely positioned box beside text in a block container would take its static position inside
// the text's inline formatting context, which milestone 1 does not lay out (the engine's abspos-in-inline). In a flex container the
// text is an anonymous flex item (css-flexbox-1 §4) and the box is not a flex item (§4.1); that combination has no fixture, so it is
// refused too. An absolutely positioned root has no in-flow box for the initial containing block. All are refused on every target
// at the position declaration.
function checkPosition(el: ResolvedElement, isRoot: boolean, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const refuse = (target: ResolvedElement, message: string): void => {
    const v = target.props.get('position') as ResolvedValue;
    const origin = v.declaration === null ? target.element.node.origin : authored(v.declaration.valueSpan);
    for (const t of targets) {
      const id = `${t}|position|${JSON.stringify(origin)}|${target.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual: 'Wrap the text beside the absolutely positioned element in its own element, or position a descendant of the root instead.', basis: 'computed-value' }));
    }
  };
  if (isRoot && keywordOf(el.props.get('position') as ResolvedValue) === 'absolute') refuse(el, `position: absolute on the root element ${el.element.address} is not supported in milestone 1`);
  // Inline content: text, or an inline box (INL1a), beside which the box would take a static position in the formatting context.
  if (!el.children.some((c) => c.kind === 'text' || displayKeyword(c) === 'inline' || isAtomic(c))) return;
  for (const c of el.children) {
    if (c.kind !== 'element' || keywordOf(c.props.get('display') as ResolvedValue) === 'none') continue;
    if (keywordOf(c.props.get('position') as ResolvedValue) !== 'absolute') continue;
    refuse(c, keywordOf(el.props.get('display') as ResolvedValue) === 'flex'
      ? `position: absolute on ${c.element.address} beside text in the flex container ${el.element.address}: the text becomes an anonymous flex item (css-flexbox-1 §4) and the absolutely positioned child is not a flex item (§4.1); milestone 1 does not lay out this combination (POSX-IFC)`
      : `position: absolute on ${c.element.address} beside text in ${el.element.address} would place it in the text's inline formatting context (CSS2 §9.2.1.1), which milestone 1 does not lay out (POSX-IFC)`);
  }
}

const RATIO_BLOCK_SIZES: readonly Longhand[] = ['height', 'min-height', 'max-height'];

// css-sizing-4 §5.1: the engine takes aspect-ratio as Blink's raw layout ratio. A ratio whose parts are not whole 64ths needs
// Blink's float continued fraction, which the compiler does not run, and a percentage block size beside a ratio has no
// percentage basis in the engine (packages/layout/src/validate.ts); both are refused on every target at the declaration.
function checkAspectRatio(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const ratio = el.props.get('aspect-ratio') as ResolvedValue;
  if (ratio.value.kind !== 'ratio') return;
  const refuse = (source: ResolvedValue, what: string, message: string, manual: string): void => {
    const origin = source.declaration === null ? el.element.node.origin : authored(source.declaration.valueSpan);
    for (const t of targets) {
      const id = `${t}|aspect-ratio-${what}|${JSON.stringify(origin)}|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
    }
  };
  const shown = valueToString(ratio.value);
  const raw = exactLayoutRatio(ratio.value.width, ratio.value.height);
  if (raw === null) {
    refuse(ratio, 'inexact', `aspect-ratio: ${shown} on ${el.element.address} is unsupported: Chrome converts a ratio whose parts are not whole multiples of 1/64 with a float continued fraction that Dragon does not compute at build time`, 'Write the ratio with whole numbers, for example 16 / 9, or parts that are multiples of 1/64.');
    return;
  }
  // A replaced box resolves a percentage block size against its basis itself (packages/layout/src/replaced.ts).
  if (raw === 'degenerate' || isReplacedTag(el.element.tag)) return;
  for (const p of RATIO_BLOCK_SIZES) {
    const v = el.props.get(p) as ResolvedValue;
    const percent = v.value.kind === 'percentage' || (v.value.kind === 'other' && v.value.text.includes('%'));
    if (!percent) continue;
    refuse(v, p, `${p}: ${valueToString(v.value)} beside aspect-ratio: ${shown} on ${el.element.address} is unsupported: the layout engine has no percentage basis for a block size it transfers through a ratio`, `Use a px ${p} beside aspect-ratio, or remove ${p}.`);
  }
}

const BORDER_STYLES: readonly Longhand[] = ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'];

/**
 * css-lists-3 §3: the marker a list item generates, named by its list-style-type (or its image), or null when list-style-type and
 * list-style-image are both none, so no ::marker box exists (Blink ListStyleCategory kNone, list_marker.cc; probe family5
 * none-and-empty). Such an item is a block (layout_list_item.h: LayoutListItem is a LayoutBlockFlow).
 */
function listMarkerOf(el: ResolvedElement): string | null {
  const type = (el.props.get('list-style-type') as ResolvedValue).value;
  const image = (el.props.get('list-style-image') as ResolvedValue).value;
  if (image.kind !== 'keyword' || image.value !== 'none') return valueToString(image);
  return type.kind === 'keyword' && type.value === 'none' ? null : valueToString(type);
}

/** A font-size calculation whose type reduces to a percentage, which Chrome's ConvertFontSize treats as a percentage. */
function isPercentFontSizeMath(v: CssValue): boolean {
  if (!isMathValue(v) || v.kind !== 'other') return false;
  const context = mathContextFor('font-size');
  if ('refused' in context) return false;
  const parsed = parseMath(v.text, context);
  return parsed.ok && isPercentMath(parsed.node);
}

/** Chrome's font-relative length units but rem (CSSPrimitiveValue::IsFontRelativeLength): a font-size in them keeps the parent's absoluteness. */
const PARENT_RELATIVE_FONT_UNITS: ReadonlySet<string> = new Set(['em', 'ex', 'rex', 'ch', 'rch', 'ic', 'ric', 'lh', 'rlh', 'cap', 'rcap']);

// css-cascade-5 §6.3: Chrome's UA defaults that the captured tables do not model. A tag inside an ancestor a UA rule keys on
// (nested lists), display: list-item (its ::marker box), UA border styles without a proof (hr's inset), a UA font size Chrome's
// minimum logical font size clamps, and text without a real bundled face that Chrome draws in synthetic bold and oblique together
// (Ahem under b in em, or an author weight of 600 and up with italic), or whose synthetic bold sits in a line that may end in an ellipsis.
function checkUserAgentDefaults(root: ResolvedElement, targets: readonly string[], ua: UaDataset, diagnostics: Diagnostic[], reported: Set<string>, realFaceAt: (address: string) => boolean, faults: GenBFaults & TxtWFaults & TxtFsFaults): void {
  const propagated = propagatedFrom(root);
  const once = (id: string, push: () => void): void => {
    if (reported.has(id)) return;
    reported.add(id);
    push();
  };
  const perTarget = (el: ResolvedElement, what: string, message: string, manual: string): void => {
    const origin = el.element.node.origin;
    for (const t of targets) once(`${t}|ua-${what}|${el.element.address}`, () => diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' })));
  };
  // Chrome's FontSize::GetComputedSizeFromSpecifiedSize: the clamp applies unless an authored px size is in the chain.
  const walk = (el: ResolvedElement, ancestors: readonly ResolvedElement[], parentAbsolute: boolean, hidden: boolean): void => {
    const tag = el.element.tag;
    const here = hidden || keywordOf(el.props.get('display') as ResolvedValue) === 'none';
    const size = el.props.get('font-size') as ResolvedValue;
    // A percentage (a calculation whose type is a percentage alone among them), smaller, larger and a font-relative length other
    // than rem (em, ex, ch, ic, lh, cap and their root forms) keep the parent's absoluteness; any other length and math function are absolute (style_builder_converter.cc ConvertFontSize,
    // 928-974); an <absolute-size> keyword is never absolute.
    const declared = size.origin === 'author' ? size.declared : null;
    const relative = declared !== null && (declared.kind === 'percentage' || isPercentFontSizeMath(declared) || (declared.kind === 'keyword' && (declared.value === 'smaller' || declared.value === 'larger')) || (declared.kind === 'length' && PARENT_RELATIVE_FONT_UNITS.has(declared.unit.toLowerCase())));
    const absolute = relative || size.origin === 'inherited' || size.origin === 'user-agent' ? parentAbsolute : declared !== null && (declared.kind === 'length' || isMathValue(declared));
    const keyed = uaRows(ua, uaTagOf(tag)).contexts;
    const ancestor = [...ancestors].reverse().find((a) => keyed.includes(a.element.tag));
    if (ancestor !== undefined) {
      once(`ua-context|${el.element.address}`, () => diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ELEMENT', {
        origin: el.element.node.origin,
        message: `<${tag}> ${el.element.address} inside <${ancestor.element.tag}> ${ancestor.element.address}: Chrome's user-agent stylesheet has a rule for <${tag}> inside <${keyed.join('>, <')}> (for example nested lists lose their block margins) that Dragon's captured defaults do not model`,
        manual: `Use a div in place of <${tag}> ${el.element.address}, or move it out of <${ancestor.element.tag}> ${ancestor.element.address}.`,
      })));
    }
    if (!here) {
      const display = keywordOf(el.props.get('display') as ResolvedValue);
      if (display === 'list-item') {
        const marker = listMarkerOf(el);
        if ((marker !== null && !faults.listItemDiscAccepted) || (marker === null && faults.listItemNoneMarkerRefused)) {
          perTarget(el, 'list-item', `display: list-item on <${tag}> ${el.element.address} generates a ${marker ?? 'none'} marker (::marker, css-lists-3 §3), which Dragon draws from the GEN-c package`, `Set list-style: none on ${el.element.address} or its list, or set display: block.`);
        }
      }
      const inset = BORDER_STYLES.filter((p) => {
        const v = el.props.get(p) as ResolvedValue;
        return v.origin === 'user-agent' && !['none', 'hidden', 'solid'].includes(keywordOf(v));
      });
      if (inset.length > 0) {
        const style = keywordOf(el.props.get(inset[0] as Longhand) as ResolvedValue);
        perTarget(el, 'border-style', `${inset.join(', ')}: ${style} on <${tag}> ${el.element.address} comes from Chrome's user-agent stylesheet, and no fixture proves how a target draws border-style: ${style}`, `Set border-style: solid (or none) on <${tag}> ${el.element.address}.`);
      }
      if (size.origin === 'user-agent' && size.value.kind === 'length' && size.value.unit === 'px' && size.value.value < ua.minimumLogicalFontSize && !parentAbsolute) {
        perTarget(el, 'font-size', `font-size: ${valueToString(size.value)} on <${tag}> ${el.element.address} comes from Chrome's user-agent stylesheet and is below Chrome's minimum logical font size (${ua.minimumLogicalFontSize}px), which Chrome clamps depending on the device pixel ratio`, `Set a px font-size on <${tag}> ${el.element.address} or one of its ancestors.`);
      }
      if (relative && !faults.keywordMinimumUnchecked && size.value.kind === 'length' && size.value.unit === 'px' && size.value.value < ua.minimumLogicalFontSize && !parentAbsolute) {
        perTarget(el, 'font-size', `font-size: ${valueToString(size.value)} on <${tag}> ${el.element.address} is below Chrome's minimum logical font size (${ua.minimumLogicalFontSize}px) and has no px size above it, which Chrome clamps depending on the device pixel ratio`, `Set a px font-size on <${tag}> ${el.element.address} or one of its ancestors.`);
      }
    }
    if (!here) {
      for (const property of ['font-weight', 'font-style'] as const) {
        const v = el.props.get(property) as ResolvedValue;
        if (v.origin === 'inherited' || !isRefusedMath(v.value)) continue;
        // Web hands the calculation to Chrome; native targets need its computed value to pick and measure the face.
        for (const t of targets.filter((x) => x === 'ios' || x === 'android')) {
          once(`${t}|font-math|${property}|${el.element.address}`, () => diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin: el.element.node.origin,
            target: t,
            message: `${property}: ${valueToString(v.value)} on <${tag}> ${el.element.address} is a calculation Dragon does not compute, and ${t} needs the computed ${property} to choose and measure the face`,
            manual: `Write ${property} on <${tag}> ${el.element.address} as a keyword or a number.`,
            basis: 'computed-value',
          })));
        }
      }
    }
    const synthetic = here ? [] : syntheticTextFont(el);
    // TXT-W: native draws Ahem's synthetic bold (native-program.ts synthetic-bold) but for a line-ending ellipsis, which Chrome draws in
    // the block container's font while native draws it in the text's own paint.
    const ellipsisBlock = here || synthetic.length > 0 ? undefined : ellipsisBlockOf([...ancestors, el], propagated);
    if (ellipsisBlock !== undefined && (synthesizesBold(el.props) || synthesizesBold(ellipsisBlock.props))) {
      for (const c of el.children) {
        if (c.kind !== 'text' || realFaceAt(c.node.address)) continue;
        for (const t of targets.filter((x) => x === 'ios' || x === 'android')) {
          once(`${t}|ua-font|${c.node.address}`, () => diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_FONT', {
            origin: c.node.node.origin,
            target: t,
            message: `text ${c.node.address} (font-weight ${serializeFontWeight(textFontOfProps(el.props).weight)}) is inside <${ellipsisBlock.element.tag}> ${ellipsisBlock.element.address} (font-weight ${serializeFontWeight(textFontOfProps(ellipsisBlock.props).weight)}), whose lines may end in an ellipsis, and Chrome draws one of them in synthetic bold; Chrome draws the ellipsis in the block's own font, ${t} in the text's paint, and no fixture proves a synthetic-bold ellipsis`,
            manual: `Give ${c.node.address} and ${ellipsisBlock.element.address} a font-weight below 600, or remove text-overflow: ellipsis and -webkit-line-clamp from ${ellipsisBlock.element.address}.`,
          })));
        }
      }
    }
    // TXT-W: Chrome composites each fake-bold glyph on its own (Skia draws a glyph mask per glyph), so where a translucent colour's
    // emboldened glyphs overlap the overlap is darker; the iOS view composites the whole run in one transparency layer, and no fixture
    // proves a translucent synthetic bold on either target.
    if (!here && synthetic.length === 0 && synthesizesBold(el.props)) {
      for (const c of el.children) {
        if (c.kind !== 'text' || realFaceAt(c.node.address)) continue;
        const color = c.props.get('color') as ResolvedValue;
        const alpha = color.value.kind === 'color' ? color.value.value.alpha : 255;
        if (alpha === 0 || alpha === 255) continue;
        for (const t of targets.filter((x) => x === 'ios' || x === 'android')) {
          once(`${t}|ua-font|${c.node.address}`, () => diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_FONT', {
            origin: c.node.node.origin,
            target: t,
            message: `text ${c.node.address} (font-weight ${serializeFontWeight(textFontOfProps(el.props).weight)}) is drawn in synthetic bold in the translucent colour ${valueToString(color.value)}; Chrome composites each emboldened glyph on its own, so overlapping glyphs blend darker, and no fixture proves a translucent synthetic bold on ${t}`,
            manual: `Give ${c.node.address} an opaque colour, or a font-weight below 600.`,
          })));
        }
      }
    }
    if (synthetic.length > 0) {
      const chain = [...ancestors, el];
      const sources = synthetic.map(({ property, text }) => {
        const setter = [...chain].reverse().find((a) => (a.props.get(property) as ResolvedValue).origin !== 'inherited') ?? (chain[0] as ResolvedElement);
        const origin = (setter.props.get(property) as ResolvedValue).origin;
        const where = origin === 'user-agent' ? "Chrome's user-agent stylesheet" : origin === 'author' ? 'the author\'s style' : `its ${origin} value`;
        return `${property}: ${text} from ${where} on <${setter.element.tag}> ${setter.element.address}`;
      });
      for (const c of el.children) {
        // TXT1a-2: a real bundled face at the computed weight and style draws it (synthesis is refused as DRAGON_SYNTHETIC_FONT_STYLE).
        if (c.kind !== 'text' || realFaceAt(c.node.address)) continue;
        // Web synthesizes both itself; native draws each alone, and Skia strokes the sheared outline when both apply.
        for (const t of targets.filter((x) => x === 'ios' || x === 'android')) {
          once(`${t}|ua-font|${c.node.address}`, () => diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_FONT', {
            origin: c.node.node.origin,
            target: t,
            message: `text ${c.node.address} inherits ${sources.join(', and ')}; ${t} cannot draw this text, where Chrome synthesizes the bold and the oblique together, stroking the sheared outline, which no fixture proves on ${t}`,
            manual: `Give ${c.node.address} a font-weight below 600 or a font-style below oblique 14deg, or a font family with a bundled face of that weight and style.`,
          })));
        }
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, [...ancestors, el], absolute, here);
  };
  walk(root, [], false, false);
}

/**
 * The computed font-weight and font-style when Chrome synthesizes both the bold (600 and up) and the oblique (slope 14 and up) over a
 * single regular face, where font-synthesis allows them. Each alone is drawn natively (native-program.ts synthetic-bold and
 * synthetic-oblique); Skia strokes the sheared outline, which no fixture proves yet.
 */
function syntheticTextFont(el: ResolvedElement): { readonly property: 'font-weight' | 'font-style'; readonly text: string }[] {
  const font = textFontOfProps(el.props);
  const allowed = synthesisAllowedOf(el.props);
  const slope = font.style.kind === 'italic' ? 14 : font.style.kind === 'oblique' ? font.style.degrees : 0;
  if (!allowed.style || slope < 14 || !synthesizesBold(el.props)) return [];
  return [{ property: 'font-weight', text: serializeFontWeight(font.weight) }, { property: 'font-style', text: serializeFontStyle(font.style) }];
}

/**
 * The block whose ellipsis may end a line of el's own text, given [...ancestors, el]: the block container whose inline formatting
 * context lays the text out (el, or its nearest ancestor that is no inline box or display: contents) when its text-overflow is not
 * clip and it truncates its own lines (truncatesOwnLines, checkTextOverflow's rule), or under a -webkit-line-clamp container, which
 * may clamp a line of that block. Chrome draws the ellipsis in that block's font.
 */
function ellipsisBlockOf(chain: readonly ResolvedElement[], propagated: ResolvedElement | null): ResolvedElement | undefined {
  const outward = [...chain].reverse();
  const container = outward.find((e) => !isInlineBox(e) && displayKeyword(e) !== 'contents');
  if (container !== undefined && valueToString((container.props.get('text-overflow') as ResolvedValue).value) !== 'clip' && truncatesOwnLines(container, propagated)) return container;
  // A line-clamp ellipsis ends a line of whichever block holds it, in that block's font.
  return outward.some((e) => lineClampOf(e) > 0) ? container : undefined;
}

/** The support profile each target is checked against, or null when the profiles are not enforced. */
export type ProfileOf = ((target: string) => SupportProfile) | null;

// css-variables-1 §3.1: a value that only exists after var() substitution was never seen by the declared-value check. A grammar-valid
// result Dragon cannot express is refused for every target, and a result whose feature no row of the target's profile proves in any
// context is refused for that target (the contextual check reports the proven-elsewhere case).
function checkSubstitution(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, profileOf: ProfileOf, fonts: FamilyKeyContext): void {
  for (const p of LONGHANDS) {
    const v = el.props.get(p) as ResolvedValue;
    const sub = v.substitution;
    if (sub === undefined) continue;
    const span = sub.source.valueSpan;
    if (sub.refusal !== null) {
      const id = `substitution|${span.source.uri}|${span.start}|${sub.refusal}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(span), message: sub.refusal, manual: 'Give the custom properties it reads values Dragon supports for this property.', basis: 'computed-value' }));
      continue;
    }
    if (v.declared === null || profileOf === null) continue;
    const feature = featureOf(p, v.declared, fonts);
    // project.ts checkCaseFonts reports an unmapped family once, as DRAGON_FONT_UNMAPPED_FAMILY (as checkValues leaves it to checkFamilies).
    if (feature === 'font-family:<unmapped>') continue;
    for (const t of targets) {
      const profile = profileOf(t);
      if (provenContexts(profile, feature).length > 0) continue;
      const id = `${t}|substitution|${span.source.uri}|${span.start}|${feature}`;
      if (reported.has(id)) continue;
      reported.add(id);
      const shown = sub.invalid ? 'is invalid at computed-value time, so it behaves as unset' : `substitutes to ${valueToString(v.declared)}`;
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: authored(span),
        target: t,
        message: `${p}: ${sub.source.text} ${shown} on ${el.element.address}; ${feature} is unsupported (support profile ${profile.revision})`,
        manual: `Give the custom properties it reads values ${t} supports for ${p}.`,
        basis: 'computed-value',
      }));
    }
  }
}

/** Walks one resolved case and records the refusals above; reported deduplicates them across cases. Text in a display: none
 * subtree is never laid out (CSS2 §9.2.4), so only the overflow check reaches it. fonts keys a substituted font-family as usedKeys does. */
/**
 * REPL-a: a replaced element is laid out as a block-level box in normal flow or as a flex item. An inline-level one waits for
 * RF-INL (atomic inlines), and an absolutely positioned one for the CSS 2.2 §10.3.8 / §10.6.5 sizing the engine does not run yet.
 */
function checkReplaced(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const display = el.props.get('display') as ResolvedValue;
  const position = el.props.get('position') as ResolvedValue;
  const tag = el.element.tag;
  const refuse = (v: ResolvedValue, what: string, message: string, manual: string): void => {
    const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
    for (const t of targets) {
      const id = `${t}|replaced-${what}|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
    }
  };
  const d = keywordOf(display);
  if (d === 'inline' || d === 'inline-block') {
    refuse(display, 'inline', `display: ${d} on <${tag}> ${el.element.address} makes it an inline-level replaced box, which waits for the RF-INL package (atomic inlines)`, `Set display: block on <${tag}> ${el.element.address}, or make it a flex item.`);
  } else if (d !== 'block') {
    refuse(display, 'display', `display: ${valueToString(display.value)} on <${tag}> ${el.element.address} is not supported on a replaced element; only block-level replaced boxes and flex items are laid out`, `Set display: block on <${tag}> ${el.element.address}.`);
  }
  const pos = keywordOf(position);
  if (pos !== 'static' && pos !== 'relative') {
    refuse(position, 'position', `position: ${pos} on <${tag}> ${el.element.address} is not supported on a replaced element yet (CSS 2.2 §10.3.8, §10.6.5)`, `Position a wrapper element and keep <${tag}> ${el.element.address} in its flow.`);
  }
}

/**
 * SVG-a1: an <svg> with a viewBox and an auto width or height is sized from the viewBox ratio and the available width, which the
 * engine does not do for a replaced box without a natural size yet (package SVG-ratio). A shape's geometry comes from its
 * attributes only: a CSS width, height or transform on it, which Chrome would apply as a geometry property, is refused, and so is
 * a percentage stroke-width, stroke-dasharray or stroke-dashoffset (relative to the viewport diagonal).
 */
function checkSvg(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const refuse = (what: string, origin: Diagnostic['origin'], message: string, manual: string, on: readonly string[] = targets): void => {
    for (const t of on) {
      const id = `${t}|svg-${what}|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
    }
  };
  const tag = el.element.tag;
  const native = targets.filter((t) => t !== 'web');
  for (const p of ['fill', 'stroke'] as const) {
    const v = el.props.get(p) as ResolvedValue;
    const why = svgPaintRefusal(p, v.value);
    if (why !== null) refuse(p, v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan), `${p}: ${valueToString(v.value)} on <${tag}> ${el.element.address} is unsupported: ${why}`, `Give ${p} a colour or none.`);
  }
  // SVG-inert: a shape draws no marker, so only marker none compiles; markers are inherited, so the shape's own value is checked.
  for (const p of ['marker-start', 'marker-mid', 'marker-end'] as const) {
    const v = el.props.get(p) as ResolvedValue;
    const why = svgPaintRefusal(p, v.value);
    if (why !== null) refuse(p, v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan), `${p}: ${valueToString(v.value)} on <${tag}> ${el.element.address} is unsupported: ${why}`, `Give ${p} none.`);
  }
  const sw = el.props.get('stroke-width') as ResolvedValue;
  for (const p of ['stroke-width', 'stroke-dasharray', 'stroke-dashoffset'] as const) {
    const v = el.props.get(p) as ResolvedValue;
    const why = svgPercentageRefusal(p, v.value);
    if (why !== null) refuse(p, v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan), `${p}: ${valueToString(v.value)} on <${tag}> ${el.element.address} is unsupported: ${why}`, `Give ${p} in px or as numbers.`);
  }
  if (tag === 'svg') {
    const auto = (['width', 'height'] as const).filter((p) => keywordOf(el.props.get(p) as ResolvedValue) === 'auto');
    if (el.element.attributes.has('viewBox') && auto.length > 0) {
      refuse('ratio', el.element.node.origin, `<svg> ${el.element.address} has a viewBox and ${auto.join(' and ')} auto: sizing from the viewBox ratio is not built yet (package SVG-ratio)`, `Give <svg> ${el.element.address} a width and a height, as attributes or in CSS.`);
    }
    // SVG-a2: native clips the shapes to the svg's box (emit/paint/image.ts), as Chrome does at the UA's overflow: hidden only.
    for (const p of ['overflow-x', 'overflow-y'] as const) {
      const v = el.props.get(p) as ResolvedValue;
      if (keywordOf(v) === 'hidden') continue;
      refuse('overflow', v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan), `${p}: ${valueToString(v.value)} on <svg> ${el.element.address} is not supported on native: Chrome paints its shapes past the box, and native clips them to it until the SVG structure package SVG-b`, `Leave overflow on <svg> ${el.element.address} at hidden.`, native);
    }
    // Native paints the shapes as the <svg>'s own paint, which its visibility gates (lower/paint/visibility.ts), so a shape Chrome
    // paints inside a hidden <svg> is refused there.
    const visibility = el.props.get('visibility') as ResolvedValue;
    if (keywordOf(visibility) !== 'visible') {
      for (const c of el.children) {
        if (c.kind !== 'element' || !isSvgShapeTag(c.element.tag) || keywordOf(c.props.get('display') as ResolvedValue) === 'none' || !svgShapePainted(c)) continue;
        const v = c.props.get('visibility') as ResolvedValue;
        refuse(`visible-${c.element.address}`, v.declaration === null ? c.element.node.origin : authored(v.declaration.valueSpan), `<${c.element.tag}> ${c.element.address} is visible inside <svg> ${el.element.address}, whose visibility is ${valueToString(visibility.value)}: Chrome paints the shape, and native hides it with the <svg> until the SVG structure package SVG-b`, `Give <svg> ${el.element.address} visibility: visible, and hide the shapes that should not show.`, native);
      }
    }
    return;
  }
  // SVG-a2: native draws a shape opaque (lower/paint/image.ts carries geometry and paints only), or not at all where Chrome paints
  // nothing (svgShapePainted: hidden, or opacity 0), so a shape Chrome fades is refused there.
  const opacity = el.props.get('opacity') as ResolvedValue;
  const alpha = opacityOf(opacity.value);
  if (alpha !== 0 && alpha !== 1 && keywordOf(el.props.get('visibility') as ResolvedValue) === 'visible') {
    refuse('opacity', opacity.declaration === null ? el.element.node.origin : authored(opacity.declaration.valueSpan), `opacity: ${valueToString(opacity.value)} on <${tag}> ${el.element.address} is not supported on native: a shape is drawn opaque or not at all there until the SVG structure package SVG-b`, `Set opacity on the <svg>, or give <${tag}> ${el.element.address} opacity 0 or 1.`, native);
  }
  // SVG-stroke: a calculation Dragon cannot fold to a number (typed division) keeps its refused text, which the shape cannot draw.
  const miter = el.props.get('stroke-miterlimit') as ResolvedValue;
  if (isRefusedMath(miter.value)) {
    refuse('stroke-miterlimit', miter.declaration === null ? el.element.node.origin : authored(miter.declaration.valueSpan), `stroke-miterlimit: ${valueToString(miter.value)} on <${tag}> ${el.element.address} is unsupported`, 'Write stroke-miterlimit as a number, or a calculation of numbers.');
  }
  // SVG-stroke: a round or square cap on a zero-length subpath (svgZeroLengthSubpath) is a dot or square in Chrome, oriented as
  // SVG 2 §13.6.6 says; native orients it by its own rules, so a stroked shape with one is refused there.
  const cap = el.props.get('stroke-linecap') as ResolvedValue;
  const stroked = keywordOf(el.props.get('stroke') as ResolvedValue) !== 'none' && !((sw.value.kind === 'length' || sw.value.kind === 'number') && sw.value.value === 0);
  const shape = shapeOf(el);
  if (keywordOf(cap) !== 'butt' && stroked && shape !== null && svgZeroLengthSubpath(shape)) {
    refuse('zero-length-cap', cap.declaration === null ? el.element.node.origin : authored(cap.declaration.valueSpan), `stroke-linecap: ${valueToString(cap.value)} on <${tag}> ${el.element.address}, whose path has a zero-length subpath, is not supported on native: Chrome draws its cap as a dot or square that native does not orient the same way yet`, `Give <${tag}> ${el.element.address} stroke-linecap: butt, or draw the dot as a <circle>.`, native);
  }
  // SVG-dash: a calculated stroke-dashoffset keeps its text (values.ts), which the shape's dash phase cannot use yet.
  const dashOffset = el.props.get('stroke-dashoffset') as ResolvedValue;
  if (dashOffset.value.kind === 'other') {
    refuse('dashoffset-calc', dashOffset.declaration === null ? el.element.node.origin : authored(dashOffset.declaration.valueSpan), `stroke-dashoffset: ${valueToString(dashOffset.value)} on <${tag}> ${el.element.address} is unsupported: a calculated stroke-dashoffset is not resolved yet (package SVG-units)`, 'Give stroke-dashoffset in px or as a number.');
  }
  // SVG-dash: a dashed stroke starts at the shape's first point and runs in its direction. A circle's is Skia's oval start in
  // Chrome and the platform's ellipse start on native, which nothing proves the same yet; and a zero-length dash with a round or
  // square cap is a dot or square, which native orients by its own rules (as a zero-length subpath's, above).
  const dashValue = el.props.get('stroke-dasharray') as ResolvedValue;
  const dashes = dashArrayOf(dashValue.value);
  const dashed = stroked && dashes !== 'percentage' && dashes.reduce((a, b) => a + b, 0) > 0;
  const dashOrigin = dashValue.declaration === null ? el.element.node.origin : authored(dashValue.declaration.valueSpan);
  if (dashed && tag === 'circle') {
    refuse('dash-circle', dashOrigin, `stroke-dasharray: ${valueToString(dashValue.value)} on <circle> ${el.element.address} is not supported on native: where the dashes of a circle start is not proven against Chrome yet`, `Draw the circle as a <path> to dash it, or remove stroke-dasharray from <circle> ${el.element.address}.`, native);
  }
  if (dashed && keywordOf(cap) !== 'butt' && (dashes as readonly number[]).includes(0)) {
    refuse('dash-zero-cap', dashOrigin, `stroke-dasharray: ${valueToString(dashValue.value)} with stroke-linecap: ${valueToString(cap.value)} on <${tag}> ${el.element.address} is not supported on native: a zero-length dash is a dot or square that native does not orient the same way yet`, `Give every dash a length, or give <${tag}> ${el.element.address} stroke-linecap: butt.`, native);
  }
  // SVG-geometry: a rect's x and y and a circle's cx, cy and r draw the shape (elements/svg.ts shapeOf) when they are user units; a
  // percentage of the viewport and a calculation (whose text values.ts keeps) are not resolved yet; nor are they for SVG-rrect's rx and ry.
  const geometry: readonly SvgGeometryProperty[] = tag === 'rect' ? ['x', 'y', 'rx', 'ry'] : tag === 'circle' ? ['cx', 'cy', 'r'] : [];
  for (const p of geometry) {
    const v = el.props.get(p) as ResolvedValue;
    if (svgGeometryOf(el, p) !== null) continue;
    const of = p === 'cx' || p === 'x' || p === 'rx' ? 'the viewport width' : p === 'cy' || p === 'y' || p === 'ry' ? 'the viewport height' : 'the normalized viewport diagonal';
    const why = v.value.kind === 'percentage' ? `a percentage ${p} is relative to ${of}, which is not built yet (package SVG-units)` : `a calculated ${p} is not resolved yet (package SVG-units)`;
    refuse(p, v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan), `${p}: ${valueToString(v.value)} on <${tag}> ${el.element.address} is unsupported: ${why}`, `Give ${p} in px or as a number.`);
  }
  for (const p of ['width', 'height', 'transform'] as const) {
    const v = el.props.get(p) as ResolvedValue;
    if (v.declaration === null) continue;
    refuse(p, authored(v.declaration.valueSpan), `${p}: ${v.declaration.text} on <${tag}> ${el.element.address} is not supported: a shape's geometry comes from its attributes until the SVG structure package SVG-b`, `Remove the declaration, or set the ${p === 'transform' ? 'geometry' : p} attribute.`);
  }
}

// MASK-CLIP (css-masking-1 §7): no target draws a mask yet, and a mask image can hide text, so a mask longhand other than its initial
// value is refused for every target where it applies (none is inherited), once per element. With every longhand initial, mask-image
// is none and Chrome applies no mask. Planted fault maskLayerAccepted accepts every value.
function checkMask(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: MaskFaults): void {
  if (faults.maskLayerAccepted) return;
  const p = MASK_LONGHANDS.find((q) => !isInitialMask(q, (el.props.get(q) as ResolvedValue).value));
  if (p === undefined) return;
  const id = `mask|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const v = el.props.get(p) as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${p}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: Dragon draws no mask yet (MASK-CLIP); only the initial value is accepted`,
      manual: `Remove the mask from ${el.element.address}, or set mask: none.`,
      basis: 'computed-value',
    }));
  }
}

export function checkComputed(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, profileOf: ProfileOf, fonts: FamilyKeyContext, realFaceAt: (address: string) => boolean, shapedAt: (address: string) => boolean, faults: GenBFaults & TxtWFaults & TxtFvFaults & TxtFtFaults & TxtFstretchFaults & TxtFfFaults & TxtFsFaults & TxtFillFaults & TxtFxFaults & FxFaults & MaskFaults & TransformExtraFaults & BorderImageFaults & ScrollContainmentFaults = { ...GEN_B_FAULTS, ...TXT_W_FAULTS, ...TXT_FV_FAULTS, ...TXT_FT_FAULTS, ...TXT_FSTRETCH_FAULTS, ...TXT_FF_FAULTS, ...TXT_FS_FAULTS, ...TXT_FILL_FAULTS, ...TXT_FX_FAULTS, ...FX_FAULTS, ...MASK_FAULTS, ...TRANSFORM_EXTRA_FAULTS, ...BORDER_IMAGE_FAULTS, ...SCROLL_CONTAINMENT_FAULTS }): void {
  const propagated = propagatedFrom(root);
  // scroller: the nearest ancestor scroll container's address (the viewport's, "the viewport", for the root), or null.
  // around: the native scroll views around el, outermost first (analysis/touch-action.ts).
  const walk = (el: ResolvedElement, hidden: boolean, scroller: string | null, around: readonly NativePanner[]): void => {
    // SVG-a1: a shape is the content of its <svg>, never a box (elements/svg.ts), so it takes the SVG checks and the effect
    // refusals that hold on any element Chrome paints (no target draws a shape's filter or mask either, nor a non-initial 3D transform property).
    if (isSvgShapeTag(el.element.tag)) {
      checkSvg(el, targets, diagnostics, reported);
      checkFilter(el, targets, diagnostics, reported, faults);
      checkMask(el, targets, diagnostics, reported, faults);
      checkTransformExtra(el, targets, diagnostics, reported, faults);
      checkZoom(el, targets, diagnostics, reported);
      checkScrollContainment(el, targets, diagnostics, reported, faults);
      return;
    }
    if (el.element.tag === 'svg') checkSvg(el, targets, diagnostics, reported);
    const here = hidden || keywordOf(el.props.get('display') as ResolvedValue) === 'none';
    checkOverflow(el, targets, diagnostics, reported);
    checkLineClamp(el, here, targets, diagnostics, reported);
    if (!here) checkStartOverflowBackground(el, propagated, targets.filter((t) => t === 'ios' || t === 'android'), diagnostics, reported);
    if (!here) checkRoundedScrollContainer(el, propagated, targets.filter((t) => t === 'ios' || t === 'android'), diagnostics, reported);
    if (!here) checkResize(el, propagated, targets.filter((t) => t === 'ios' || t === 'android'), diagnostics, reported);
    const self = nativePanner(el, propagated);
    const panners = self === null ? around : [...around, self];
    if (!here) checkTouchAction(el, panners, targets.filter((t) => t === 'ios' || t === 'android'), diagnostics, reported);
    if (!here) checkAppearance(el, targets, diagnostics, reported);
    if (!here) checkPercentRelative(el, scroller === null ? null : el === root ? 'on the root (the viewport is its scroll container)' : `inside the scroll container ${scroller}`, targets, diagnostics, reported);
    checkSubstitution(el, targets, diagnostics, reported, profileOf, fonts);
    checkFilter(el, targets, diagnostics, reported, faults);
    checkTransformExtra(el, targets, diagnostics, reported, faults);
    checkZoom(el, targets, diagnostics, reported);
    // The overscroll, scroll-snap, containment and container-query families, initial values only (analysis/scroll-containment.ts).
    checkScrollContainment(el, targets, diagnostics, reported, faults);
    if (!here) checkBidi(el, diagnostics, reported);
    if (!here) checkPosition(el, el === root, targets, diagnostics, reported);
    if (!here) checkAspectRatio(el, targets, diagnostics, reported);
    if (!here && isReplacedTag(el.element.tag)) checkReplaced(el, targets, diagnostics, reported);
    else if (!here) {
      checkInlineLevel(el, targets, diagnostics, reported);
      checkInline(el, targets, diagnostics, reported, shapedAt);
      checkTextOverflow(el, propagated, targets, diagnostics, reported);
      checkTextIndent(el, targets, diagnostics, reported);
      // TXT-FONTFEAT: font-variant features over real faces (analysis/font-variant.ts).
      checkFontVariant(el, targets, diagnostics, reported, shapedAt, faults);
      // TXT-FONTFEAT: kerning, optical sizing and language override over real faces (analysis/font-tuning.ts).
      checkFontTuning(el, targets, diagnostics, reported, shapedAt, faults);
      checkFontStretch(el, targets, diagnostics, reported, shapedAt, faults);
      checkFontFeatures(el, targets, diagnostics, reported, shapedAt, faults);
      checkTextFillStroke(el, targets, diagnostics, reported, faults);
    }
    checkMask(el, targets, diagnostics, reported, faults);
    checkBorderImage(el, targets, diagnostics, reported, faults);
    // Paint modules' computed-value refusals (analysis/paint-values), in registry order.
    if (!here) for (const m of PAINT_VALUES) m.check?.(el, targets, diagnostics, reported, propagated);
    checkGeneratedContent(el, targets, diagnostics, reported);
    const own = el !== propagated && isScrollKeyword(keywordOf(el.props.get('overflow-x') as ResolvedValue)) ? el.element.address : null;
    const inner = el === root ? own : (own ?? scroller);
    for (const c of el.children) if (c.kind === 'element') walk(c, here, inner, panners);
  };
  walk(root, false, 'viewport', []);
  checkUserAgentDefaults(root, targets, environmentOf(root).ua, diagnostics, reported, realFaceAt, faults);
  // PNT2: transforms where they would change layout or paint beyond the box (analysis/paint-values/transform.ts).
  checkTransformContexts(root, targets, diagnostics, reported);
  // PNT1: outlines the native root view would paint out of Chrome's order (analysis/paint-values/outline.ts).
  checkOutlinePlacement(root, propagated, targets, diagnostics, reported);
  checkDecorations(root, targets, diagnostics, reported, realFaceAt);
  // TXT-FONTFEAT: synthesized small caps beside what no Chrome case proves (analysis/small-caps.ts).
  checkSmallCaps(root, targets, diagnostics, reported, shapedAt);
  // TXT-FX: text shadows a target does not draw as Chrome does (analysis/text-shadow.ts).
  checkTextShadows(root, targets, diagnostics, reported, realFaceAt, faults);
  // TXT2-e: transformed text native targets refuse (analysis/text-transform.ts).
  checkTextTransform(root, targets, diagnostics, reported);
}

const GENERATED_DISPLAY_OWNER: readonly (readonly [RegExp, string])[] = [
  [/list-item/, 'the ::marker package GEN-d6'],
  [/^table|^inline-table$/, 'the table package TBL'],
  [/^contents$/, 'the generated-content package GEN-d'],
  [/^ruby/, 'the generated-content package GEN-d'],
];

// GEN-a (notes/T151-gen-spec.md R4, R6, R8): the ::before and ::after boxes resolve.ts refused on their host (a replaced element, a
// form control or the root), a generated box whose display is a list item, a table part, contents or ruby, and a direction declared
// on a generated box, which takes its host's direction. Each is refused on every target at the declaration.
function checkGeneratedContent(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const refuse = (v: ResolvedValue, at: string, what: string, message: string, manual: string): void => {
    const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
    for (const t of targets) {
      const id = `${t}|gen-${what}|${JSON.stringify(origin)}|${at}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
    }
  };
  for (const r of refusedGenerationOf(el)) {
    const at = `${el.element.address}::${r.pseudo}`;
    refuse(r.content, at, 'host', `content: ${valueToString(r.content.value)} on ${at} is not supported yet: ${r.reason}`, `Remove the ::${r.pseudo} rule's content for <${el.element.tag}> ${el.element.address}, or put the content in a real element beside it.`);
  }
  const info = generatedPseudoOf(el);
  if (info === undefined) return;
  const at = el.element.address;
  const display = el.props.get('display') as ResolvedValue;
  const shown = valueToString(display.value);
  const owner = GENERATED_DISPLAY_OWNER.find(([re]) => re.test(shown));
  if (owner !== undefined) refuse(display, at, 'display', `display: ${shown} on ${at} is not supported yet on a generated box (${owner[1]})`, `Give ${at} display: inline or block.`);
  const direction = el.props.get('direction') as ResolvedValue;
  if (direction.origin === 'author') refuse(direction, at, 'direction', `direction on ${at} is not supported: a generated box takes its host ${info.host.element.address}'s direction (notes/T151-gen-spec.md R6)`, `Set direction on ${info.host.element.address} instead.`);
}

// TXT-FONTFEAT (css-fonts-4 §2.4): font-stretch selects a face by width and is never synthesized, so it leaves Chrome's glyphs alone
// in a one-face family at 100% (Ahem). Dragon matches no face by width, so a width other than 100% over text in a real face is
// refused for every target, once per text. Planted fault fontStretchOnRealFaceAccepted accepts it.
function checkFontStretch(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, shapedAt: (address: string) => boolean, faults: TxtFstretchFaults): void {
  if (faults.fontStretchOnRealFaceAccepted) return;
  const v = el.props.get('font-stretch') as ResolvedValue;
  if (stretchPercent(v.value) === 100) return;
  for (const c of el.children) {
    if (c.kind !== 'text' || !shapedAt(c.node.address)) continue;
    const id = `font-stretch|${c.node.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    for (const t of targets) {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: c.node.node.origin,
        target: t,
        message: `font-stretch: ${valueToString(v.value)} reaches text ${c.node.address}, which is drawn in a real face: Dragon matches no face by width yet (TXT-FONTFEAT)`,
        manual: `Set font-stretch to normal on the text of ${el.element.address}, or draw it in a one-face family such as Ahem.`,
        basis: 'computed-value',
      }));
    }
  }
}

// FORM-a (css-ui-4 §7.1): Chrome 145 adjusts the display of a box whose appearance is not none before it looks at the element's type
// (StyleAdjuster::AdjustStyleForHTMLElement): inline and inline-table become inline-block, list-item and table become block, and
// every other display is kept. Dragon does not model the adjustment, so a non-none appearance on a box of those four displays is
// refused for every target; on any other display appearance changes nothing Dragon lays out or paints.
const APPEARANCE_ADJUSTED: { readonly [display: string]: string } = { inline: 'inline-block', 'inline-table': 'inline-block', 'list-item': 'block', table: 'block' };
function checkAppearance(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = el.props.get('appearance') as ResolvedValue;
  const k = keywordOf(v);
  if (k === '' || k === 'none') return;
  const display = keywordOf(el.props.get('display') as ResolvedValue);
  const adjusted = APPEARANCE_ADJUSTED[display];
  if (adjusted === undefined) return;
  const id = `appearance|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan),
      target: t,
      message: `${el.element.address} has appearance ${k} on display ${display}, which Chrome turns into display ${adjusted}; Dragon does not model that adjustment (FORM-a)`,
      manual: `Set appearance: none on ${el.element.address}, or give it display: ${adjusted}.`,
      basis: 'computed-value',
    }));
  }
}

// TXT-FX (compat §5): glyphs are painted in color and no stroke is drawn, which is what Chrome draws for a fill colour of currentcolor
// and a stroke of width 0 in any colour. Any other fill colour or a wider stroke over the element's text is refused for every
// target, once per text. Planted faults textFillColorAccepted and textStrokeAccepted accept them.
function checkTextFillStroke(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: TxtFillFaults): void {
  const fill = el.props.get('-webkit-text-fill-color') as ResolvedValue;
  const width = el.props.get('-webkit-text-stroke-width') as ResolvedValue;
  const problems: string[] = [];
  if (!faults.textFillColorAccepted && keywordOf(fill) !== 'currentcolor') problems.push(`-webkit-text-fill-color: ${valueToString(fill.value)}, a fill other than currentcolor (Dragon paints glyphs in color)`);
  const zero = (width.value.kind === 'length' || width.value.kind === 'number') && width.value.value === 0;
  if (!faults.textStrokeAccepted && !zero) problems.push(`-webkit-text-stroke-width: ${valueToString(width.value)}, a stroke Dragon does not draw`);
  if (problems.length === 0) return;
  // Located at the element's own declaration when it has one, else at the text.
  const declared = [fill, width].find((v) => v.origin !== 'inherited' && v.declaration !== null);
  for (const c of el.children) {
    if (c.kind !== 'text') continue;
    const id = `text-fill-stroke|${c.node.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    for (const t of targets) {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: declared?.declaration ? authored(declared.declaration.valueSpan) : c.node.node.origin,
        target: t,
        message: `text ${c.node.address} takes ${problems.join(', and ')} (TXT-FX)`,
        manual: `Give the text of ${el.element.address} -webkit-text-fill-color: currentcolor and -webkit-text-stroke-width: 0, and set color instead.`,
        basis: 'computed-value',
      }));
    }
  }
}

/** The largest device scale a native proof spans; every device lane's DPR (1, 2, 2.625 and 3) lies below it. */
const NATIVE_DPR_MAX = 4;
/** The largest skip-ink dilation the decoration capture proves: every captured skip-ink auto line is at most this thick. */
const SKIP_INK_PROVEN_THICKNESS = 13;

/**
 * TDEC-d: whether a skip-ink auto line's thickness stays within SKIP_INK_PROVEN_THICKNESS zoomed px at every device scale up to
 * NATIVE_DPR_MAX, so the device's dilation by the thickness (text_painter.cc:555-563, layout text-decoration.ts skipInkClips) is
 * the one the captures prove. auto is size / 10 of the decorating box's font; a px length or a percentage rounds half up after zoom (roundf, +0.5 at
 * most). boxSize is css px. A device above NATIVE_DPR_MAX still dilates as Chrome does: skipInkClips clamps the dilation at
 * kDecorationClipMaxDilation (13 px, text_painter.cc:44), which text-decoration-ahem-skip's 6px line captures at DPR 3.
 */
export function skipInkThicknessProven(thickness: CssValue, boxSize: number): boolean {
  const auto = thickness.kind === 'keyword' && thickness.value === 'auto';
  const perPx = auto ? boxSize / 10 : thickness.kind === 'length' && thickness.unit === 'px' ? thickness.value : thickness.kind === 'percentage' ? (thickness.value * boxSize) / 100 : Number.NaN;
  if (!Number.isFinite(perPx)) return false;
  return perPx * NATIVE_DPR_MAX + (auto ? 0 : 0.5) <= SKIP_INK_PROVEN_THICKNESS;
}

/** Whether the device takes a thickness or underline offset: auto, a px length or a percentage (lower/paint/text-decoration.ts). */
const nativeDecorationLength = (v: CssValue): boolean => (v.kind === 'keyword' && v.value === 'auto') || (v.kind === 'length' && v.unit === 'px' && Number.isFinite(v.value)) || (v.kind === 'percentage' && Number.isFinite(v.value));

/** The text-decoration-style values every target draws (TDEC-c: double as two snapped rects); a drawn dotted, dashed or wavy line is refused. */
export const DRAWN_DECORATION_STYLES: readonly string[] = ['solid', 'double'];

/**
 * TDEC-a: web draws every accepted decoration. A decorated text whose line is dotted, dashed or wavy is refused on every target
 * (TDEC-c draws solid and double only); the style itself is accepted wherever it draws nothing. TDEC-b: ios and android draw solid
 * and double decorations and refuse, per decorated text, what the device does not reproduce: a thickness or offset that is not
 * auto, px or a percentage; a decorated text that is not visible; an overline or a double line with skip-ink auto, or an underline with skip-ink auto
 * on a real face, in synthetic bold, or thicker than skipInkThicknessProven allows (skip-ink-intercepts: TDEC-d clips Ahem glyphs within that bound). A child of a
 * decorated element in a formatting context no Chrome case proves propagation for is refused on every target.
 */
function checkDecorations(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, realFaceAt: (address: string) => boolean): void {
  const { applied, unproven } = analyzeDecorations(root);
  const byAddress = new Map<string, { readonly text: ResolvedText; readonly owner: ResolvedElement; readonly containerSize: number; readonly visibility: string }>();
  const sizeOf = (props: ReadonlyMap<Longhand, ResolvedValue>): number => {
    const v = props.get('font-size')?.value;
    return v !== undefined && v.kind === 'length' && v.unit === 'px' ? v.value : Number.NaN;
  };
  // A block decorating box draws with its text's container strut: the nearest ancestor that is not an inline box.
  const index = (el: ResolvedElement, containerSize: number): void => {
    const inline = el !== root && valueToString((el.props.get('display') as ResolvedValue).value) === 'inline';
    const here = inline ? containerSize : sizeOf(el.props);
    for (const c of el.children) {
      // A text's visibility is its parent element's (an inherited property).
      if (c.kind === 'text') byAddress.set(c.node.address, { text: c, owner: el, containerSize: here, visibility: valueToString((el.props.get('visibility') as ResolvedValue).value) });
      else index(c, here);
    }
  };
  index(root, sizeOf(root.props));
  const inlineAt = new Set<string>();
  const inlines = (el: ResolvedElement): void => {
    if (el !== root && valueToString((el.props.get('display') as ResolvedValue).value) === 'inline') inlineAt.add(el.element.address);
    for (const c of el.children) if (c.kind === 'element') inlines(c);
  };
  inlines(root);
  const elements = new Map<string, ResolvedElement>();
  const collect = (el: ResolvedElement): void => {
    elements.set(el.element.address, el);
    for (const c of el.children) if (c.kind === 'element') collect(c);
  };
  collect(root);
  for (const [address, list] of applied) {
    const hit = byAddress.get(address);
    if (hit === undefined) throw new Error(`${address}: a decorated text leaf that is not in the tree`);
    const { text, owner, containerSize, visibility } = hit;
    // TDEC-c: a line drawn in a style no target draws is refused on every target, at the decorating box's style declaration.
    for (const d of list.filter((x) => !DRAWN_DECORATION_STYLES.includes(x.style))) {
      const style = elements.get(d.box)?.props.get('text-decoration-style');
      if (style === undefined) throw new Error(`${address}: the decorating box ${d.box} is not in the tree`);
      for (const t of targets) {
        const id = `${t}|decoration-style|${address}|${d.box}`;
        if (reported.has(id)) continue;
        reported.add(id);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: style.origin !== 'inherited' && style.declaration !== null ? authored(style.declaration.valueSpan) : text.node.node.origin,
          target: t,
          message: `text-decoration-style: ${d.style} draws the ${d.lines.join(' ')} of ${d.box} over text ${address}, and TDEC-c draws solid and double lines only`,
          manual: `Set text-decoration-style to solid or double on ${d.box}, or text-decoration-line: none.`,
          basis: 'computed-value',
        }));
      }
    }
    const reasons: string[] = [];
    let intercepts = false;
    if (visibility !== 'visible') reasons.push(`it is ${visibility}, and its decoration views do not follow visibility`);
    for (const d of list.filter((x) => DRAWN_DECORATION_STYLES.includes(x.style))) {
      if (!nativeDecorationLength(d.thickness)) reasons.push(`the text-decoration-thickness of ${d.box} is ${valueToString(d.thickness)}, not auto, a px length or a percentage`);
      if (!nativeDecorationLength(d.underlineOffset)) reasons.push(`the text-underline-offset of ${d.box} is ${valueToString(d.underlineOffset)}, not auto, a px length or a percentage`);
      // text-decoration-skip-ink is inherited, and Chrome may read it from the painted text's own style while the native views take
      // the decorating box's; no Chrome case proves which, so a text whose value differs from its box's is refused.
      const ownSkipInk = valueToString((owner.props.get('text-decoration-skip-ink') as ResolvedValue).value);
      if ((d.lines.includes('underline') || d.lines.includes('overline')) && ownSkipInk !== d.skipInk) reasons.push(`its text-decoration-skip-ink is ${ownSkipInk} and that of ${d.box}, which draws its ${d.lines.join(' ')}, is ${d.skipInk}, and no Chrome case proves which of the two clips the line`);
      if (d.skipInk !== 'auto') continue;
      // TDEC-d clips Ahem glyphs only, for a solid underline (the capture's skip-ink probe), as thick as a capture proves. TXT-W: Skia
      // takes the intercepts of a synthetic-bold glyph from its emboldened outline, which the native views' upright Ahem boxes miss.
      if (d.lines.includes('overline') || (d.style === 'double' && d.lines.includes('underline')) || (d.lines.includes('underline') && (realFaceAt(address) || synthesizesBold(owner.props) || !skipInkThicknessProven(d.thickness, inlineAt.has(d.box) ? d.font.size : containerSize)))) intercepts = true;
    }
    if (intercepts) reasons.push('skip-ink-intercepts: glyph ink may cross the skip-ink band of an under or overline from ' + list.filter((d) => d.skipInk === 'auto').map((d) => d.box).join(', ') + ', which the intercepts of TDEC-d clip');
    if (reasons.length === 0) continue;
    const what = list.map((d) => `${d.lines.join(' ')} from ${d.box}`).join(', ');
    for (const t of targets.filter((x) => x === 'ios' || x === 'android')) {
      const id = `${t}|decoration|${address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: text.node.node.origin,
        target: t,
        message: `text ${address} draws text-decoration (${what}) that ${t} does not draw: ${reasons.join('; ')}`,
        manual: intercepts ? 'Set text-decoration-skip-ink: none on the decorating box, or build for web; skip-ink intercepts on overlines, real faces and synthetic bold come with later TDEC-d slices.' : 'Set text-decoration: none on the decorating box, or build for web.',
        basis: 'computed-value',
      }));
    }
  }
  for (const u of unproven) {
    for (const t of targets) {
      const id = `${t}|decoration-context|${u.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNPROVEN_CONTEXT', {
        origin: originOfElement(root, u.address),
        target: t,
        message: `${u.address} sits inside the decorated box ${u.box} in a formatting context for which no Chrome case proves how text-decoration propagates (css-text-decor-3 §2.1)`,
        manual: `Set text-decoration: none on ${u.box}, or move ${u.address} out of it.`,
      }));
    }
  }
}

/** The origin of the element at an address in a resolved tree. */
function originOfElement(root: ResolvedElement, address: string): ResolvedElement['element']['node']['origin'] {
  const find = (el: ResolvedElement): ResolvedElement | null => {
    if (el.element.address === address) return el;
    for (const c of el.children) if (c.kind === 'element') {
      const hit = find(c);
      if (hit !== null) return hit;
    }
    return null;
  };
  const hit = find(root);
  if (hit === null) throw new Error(`no element ${address}`);
  return hit.element.node.origin;
}

// TXT-FONTFEAT (css-fonts-4 §6.12, §7.2): Dragon applies no OpenType feature or variation axis, which leaves Chrome's glyphs alone only
// in a face that has none (Ahem). A non-normal font-feature-settings or font-variation-settings over text in a real face is refused
// for every target, once per text. Planted fault fontFeaturesOnRealFaceAccepted accepts it.
function checkFontFeatures(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, shapedAt: (address: string) => boolean, faults: TxtFfFaults): void {
  if (faults.fontFeaturesOnRealFaceAccepted) return;
  const set = (['font-feature-settings', 'font-variation-settings'] as const).filter((p) => keywordOf(el.props.get(p) as ResolvedValue) !== 'normal');
  if (set.length === 0) return;
  for (const c of el.children) {
    if (c.kind !== 'text' || !shapedAt(c.node.address)) continue;
    const id = `font-features|${c.node.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    const what = set.map((p) => `${p}: ${valueToString((el.props.get(p) as ResolvedValue).value)}`).join(' and ');
    for (const t of targets) {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: c.node.node.origin,
        target: t,
        message: `${what} reaches text ${c.node.address}, which is drawn in a real face: Dragon applies no OpenType feature or variation axis yet (TXT-FONTFEAT)`,
        manual: `Set ${set.join(' and ')} to normal on the text of ${el.element.address}, or draw it in a face without features.`,
        basis: 'computed-value',
      }));
    }
  }
}
