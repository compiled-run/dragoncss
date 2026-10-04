// Refusals on computed values and laid-out text that no profile row can express: they depend on a value the author did not write
// (the css-overflow-3 §3.1 pair rule, Chrome's user-agent defaults), on where a declaration applies (html and body), or on the
// text and its direction (UAX #9).
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Longhand } from '../css/properties.ts';
import { LONGHANDS } from '../css/properties.ts';
import { exactLayoutRatio, featureOf } from '../css/values.ts';
import type { FamilyKeyContext } from '../css/values.ts';
import type { SupportProfile } from '../profiles/types.ts';
import { provenContexts } from '../profiles/types.ts';
import type { Diagnostic } from '../types.ts';
import type { UaDataset } from '../ua/datasets.ts';
import { uaRows } from '../ua/datasets.ts';
import { checkInlineLevel } from './blockify.ts';
import { uaTagOf } from './elements.ts';
import { buttonAppearance, isControlTag, isRangeType } from './elements/controls.ts';
import { isReplacedTag } from './elements/replaced.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';
import { environmentOf, isInitialByProvenance, rangePartOf, valueToString } from './resolve.ts';
import { checkTransformContexts } from './paint-values/transform.ts';

const keywordOf = (v: ResolvedValue): string => (v.value.kind === 'keyword' ? v.value.value : '');

/** UAX #9: in an rtl paragraph only these keep logical order (strong L letters, space, U+200B not at the end). */
const RTL_SAFE = /^[A-Za-z \u200b]*$/u;

// css-overflow-3 §3.1 and §3.3: only overflow hidden on both axes is supported. A computed auto, scroll or clip (including auto
// computed from visible beside hidden) and any overflow on html or body (which propagates to the viewport) are refused.
function checkOverflow(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const axes: Longhand[] = ['overflow-x', 'overflow-y'];
  const values = axes.map((p) => el.props.get(p) as ResolvedValue);
  const declared = values.find((v) => v.declaration !== null);
  const tag = el.element.tag;
  for (const [i, v] of values.entries()) {
    const k = keywordOf(v);
    const onRoot = (tag === 'html' || tag === 'body') && k !== 'visible';
    const unsupportedValue = k === 'auto' || k === 'scroll' || k === 'clip';
    if (!onRoot && !unsupportedValue) continue;
    // A value the author wrote and no profile row supports is already DRAGON_UNSUPPORTED_VALUE from the profile check.
    if (!onRoot && v.declared !== null && v.declared.kind === 'keyword' && v.declared.value === k) continue;
    const source = v.declaration !== null ? v : declared;
    if (source === undefined || source.declaration === null) continue;
    const span = source.declaration.valueSpan;
    const property = axes[i] as Longhand;
    const message = onRoot
      ? `${property}: ${k} on <${tag}> ${el.element.address} propagates to the viewport (css-overflow-3 §3.3), which milestone 1 does not lay out`
      : `${property} computes to ${k} on ${el.element.address} (css-overflow-3 §3.1: visible beside a non-visible axis computes to auto); only overflow: hidden on both axes is supported`;
    for (const t of targets) {
      const id = `${t}|${span.source.uri}|${span.start}|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(span), target: t, message, manual: 'Use overflow: hidden on both axes, on an element other than html and body.', basis: 'computed-value' }));
    }
  }
}

// UAX #9 and css-writing-modes-4 §2.4: the text of an rtl block container may hold only strong-L letters, spaces and U+200B, and
// U+200B may not end its inline formatting context; anything else would be reordered, and it is refused for every target.
function checkBidi(el: ResolvedElement, diagnostics: Diagnostic[], reported: Set<string>): void {
  if (keywordOf(el.props.get('direction') as ResolvedValue) !== 'rtl') return;
  const runs: ResolvedText[][] = [[]];
  for (const c of el.children) {
    if (c.kind === 'text') (runs[runs.length - 1] as ResolvedText[]).push(c);
    else if (keywordOf(c.props.get('display') as ResolvedValue) !== 'none') runs.push([]);
  }
  const report = (t: ResolvedText, message: string): void => {
    const origin = t.node.node.origin;
    const id = `${t.node.address}|${JSON.stringify(origin)}`;
    if (reported.has(id)) return;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_BIDI', { origin, message }));
  };
  for (const run of runs) {
    for (const t of run) if (!RTL_SAFE.test(t.text)) report(t, `text ${JSON.stringify(t.text)} of ${t.node.address} holds a character other than A-Z, a-z, space and U+200B in the rtl block ${el.element.address}`);
    const last = run[run.length - 1];
    if (last !== undefined && last.text.endsWith('\u200b')) report(last, `U+200B ends the rtl inline content of ${el.element.address} (${last.node.address}) and would take the paragraph direction (UAX #9 L1)`);
  }
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
  if (!el.children.some((c) => c.kind === 'text')) return;
  for (const c of el.children) {
    if (c.kind !== 'element' || keywordOf(c.props.get('display') as ResolvedValue) === 'none') continue;
    if (keywordOf(c.props.get('position') as ResolvedValue) !== 'absolute') continue;
    refuse(c, keywordOf(el.props.get('display') as ResolvedValue) === 'flex'
      ? `position: absolute on ${c.element.address} beside text in the flex container ${el.element.address}: the text becomes an anonymous flex item (css-flexbox-1 §4) and the absolutely positioned child is not a flex item (§4.1); milestone 1 does not lay out this combination`
      : `position: absolute on ${c.element.address} beside text in ${el.element.address} would place it in the text's inline formatting context (CSS2 §9.2.1.1), which milestone 1 does not lay out`);
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

// css-cascade-5 §6.3: Chrome's UA defaults that the captured tables do not model. A tag inside an ancestor a UA rule keys on
// (nested lists), display: list-item (its ::marker box), UA border styles without a proof (hr's inset), a UA font size Chrome's
// minimum logical font size clamps, and text that inherits a UA font-weight or font-style no longhand models (headings, address).
function checkUserAgentDefaults(root: ResolvedElement, targets: readonly string[], ua: UaDataset, diagnostics: Diagnostic[], reported: Set<string>): void {
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
  const walk = (el: ResolvedElement, ancestors: readonly ResolvedElement[], parentAbsolute: boolean, fontTag: ResolvedElement | null, hidden: boolean): void => {
    const tag = el.element.tag;
    const here = hidden || keywordOf(el.props.get('display') as ResolvedValue) === 'none';
    const size = el.props.get('font-size') as ResolvedValue;
    const absolute = size.origin === 'author' && size.declared !== null && size.declared.kind === 'length' ? true : size.origin === 'inherited' || size.origin === 'user-agent' ? parentAbsolute : false;
    const keyed = uaRows(ua, uaTagOf(tag, el.element.attributes.get('type'))).contexts;
    const ancestor = [...ancestors].reverse().find((a) => keyed.includes(a.element.tag));
    if (ancestor !== undefined) {
      once(`ua-context|${el.element.address}`, () => diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ELEMENT', {
        origin: el.element.node.origin,
        message: `<${tag}> ${el.element.address} inside <${ancestor.element.tag}> ${ancestor.element.address}: Chrome's user-agent stylesheet has a rule for <${tag}> inside <${keyed.join('>, <')}> (for example nested lists lose their block margins) that Dragon's captured defaults do not model`,
        manual: `Use a div in place of <${tag}> ${el.element.address}, or move it out of <${ancestor.element.tag}> ${ancestor.element.address}.`,
      })));
    }
    if (!here) {
      if (keywordOf(el.props.get('display') as ResolvedValue) === 'list-item') {
        perTarget(el, 'list-item', `display: list-item on <${tag}> ${el.element.address} generates a ::marker box (css-lists-3 §3), which Dragon does not lay out or draw yet`, `Set display: block (or flex) on <${tag}> ${el.element.address}; list markers need ::marker support.`);
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
    }
    const fonts = Object.keys(uaRows(ua, uaTagOf(tag, el.element.attributes.get('type'))).textFonts).length > 0 ? el : fontTag;
    if (!here && fonts !== null) {
      const row = uaRows(ua, uaTagOf(fonts.element.tag, fonts.element.attributes.get('type'))).textFonts;
      const set = Object.entries(row).map(([p, v]) => `${p}: ${v}`).join('; ');
      for (const c of el.children) {
        if (c.kind !== 'text') continue;
        // Web draws the UA weight and style itself; every configured native target draws the regular face.
        for (const t of targets.filter((x) => x === 'ios' || x === 'android')) {
          once(`${t}|ua-font|${c.node.address}`, () => diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_FONT', {
            origin: c.node.node.origin,
            target: t,
            message: `text ${c.node.address} inherits ${set} from Chrome's user-agent stylesheet on <${fonts.element.tag}> ${fonts.element.address}; Dragon has no font-weight or font-style, so ${t} would draw it in the regular face (Ahem's synthetic bold and oblique keep every glyph advance, so only the glyphs differ)`,
            manual: `Put the text in a div outside <${fonts.element.tag}> ${fonts.element.address}; font-weight and font-style need the real-font text support.`,
          })));
        }
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, [...ancestors, el], absolute, fonts, here);
  };
  walk(root, [], false, null, false);
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

/** One refusal per target, keyed so a cascade of cases reports it once. */
function refuseOn(el: ResolvedElement, v: ResolvedValue | null, what: string, code: 'DRAGON_UNSUPPORTED_VALUE' | 'DRAGON_UNSUPPORTED_FONT', targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, message: string, manual: string): void {
  const origin = v === null || v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  for (const t of targets) {
    const id = `${t}|button-${what}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(code === 'DRAGON_UNSUPPORTED_FONT' ? diagnostic(code, { origin, target: t, message, manual }) : diagnostic(code, { origin, target: t, message, manual, basis: 'computed-value' }));
  }
}

/**
 * FORM-a A3: a button is laid out as a block container that centres its contents, or as the flex container its display says,
 * and painted as CSS boxes. Refused: a button the platform theme paints (R11, FORM-b); an inline-level one (RF-INL); any other
 * display; an absolutely positioned one (the engine's control-out-of-flow); and one whose font is Chrome's UA control font (R13).
 */
function checkButton(el: ResolvedElement, parentDisplay: string | null, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const tag = el.element.tag;
  const address = el.element.address;
  const refuse = (v: ResolvedValue | null, what: string, message: string, manual: string, code: 'DRAGON_UNSUPPORTED_VALUE' | 'DRAGON_UNSUPPORTED_FONT' = 'DRAGON_UNSUPPORTED_VALUE'): void =>
    refuseOn(el, v, what, code, targets, diagnostics, reported, message, manual);
  const appearance = el.props.get('appearance') as ResolvedValue;
  if (buttonAppearance(el.props) === 'theme') {
    refuse(appearance, 'theme', `<${tag}> ${address} with appearance: ${valueToString(appearance.value)} and no author background or border is painted by the platform theme (Blink LayoutTheme::IsControlStyled), which waits for the FORM-b package`, `Set appearance: none, or a background or border, on <${tag}> ${address}.`);
  }
  const display = el.props.get('display') as ResolvedValue;
  const d = valueToString(display.value);
  if (d === 'inline-block' || d === 'inline-flex' || d === 'inline-grid' || d === 'inline') {
    refuse(display, 'inline', `display: ${d} on <${tag}> ${address} makes it an inline-level control, which waits for the RF-INL package (atomic inlines)`, `Set display: block (or flex) on <${tag}> ${address}, or make it a flex item.`);
  } else if (d !== 'block' && d !== 'flex') {
    refuse(display, 'display', `display: ${d} on <${tag}> ${address} is not supported on a button; only block and flex buttons are laid out`, `Set display: block (or flex) on <${tag}> ${address}.`);
  }
  const position = el.props.get('position') as ResolvedValue;
  const pos = keywordOf(position);
  // Chrome sizes a block-level flex button in block flow to its content, as it does a block one (Dragon's button-block), but
  // the engine lays out a flex button as a plain flex container, which would stretch.
  const width = el.props.get('width') as ResolvedValue;
  const inBlockFlow = parentDisplay !== null && parentDisplay !== 'flex' && parentDisplay !== 'inline-flex' && parentDisplay !== 'grid' && parentDisplay !== 'inline-grid';
  if (d === 'flex' && inBlockFlow && keywordOf(width) === 'auto') {
    refuse(width, 'flex-width', `<${tag}> ${address} is a flex button with an auto width in block flow, which Chrome sizes to its content; Dragon lays out a flex button as a plain flex container, which would stretch`, `Set a width on <${tag}> ${address}, use display: block, or make it a flex item.`);
  }
  if (pos === 'absolute' || pos === 'fixed') {
    refuse(position, 'position', `position: ${pos} on <${tag}> ${address} is not supported on a form control yet`, `Position a wrapper element and keep <${tag}> ${address} in its flow.`);
  }
  const family = el.props.get('font-family') as ResolvedValue;
  if (family.origin === 'user-agent') {
    refuse(family, 'font', `<${tag}> ${address} uses Chrome's user-agent control font (${valueToString(family.value)}), which the font map does not pin`, `Set font: inherit (or a font-family) on <${tag}> ${address}.`, 'DRAGON_UNSUPPORTED_FONT');
  }
}

/** The container-role longhands of a range input, which Chrome's range layout (a flex container) would read. */
const RANGE_FLEX_LONGHANDS: readonly Longhand[] = ['flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'row-gap', 'column-gap'];

/**
 * FORM-a A4: an input[type=range] is laid out as its UA shadow tree and painted as CSS boxes when the input and its thumb are both
 * appearance: none (R11, FORM-0 ruling F3). Refused: any other input type (FORM-b), a themed range or thumb (FORM-b), an
 * inline-level range (RF-INL), any display but block or flex, an absolutely positioned range, and a flex container longhand
 * on the input other than its initial value (the shadow tree's flex layout would read it).
 */
function checkRange(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const address = el.element.address;
  const refuse = (v: ResolvedValue | null, what: string, message: string, manual: string): void => refuseOn(el, v, what, 'DRAGON_UNSUPPORTED_VALUE', targets, diagnostics, reported, message, manual);
  const type = el.element.attributes.get('type');
  if (!isRangeType(type)) {
    const id = `input-type|${address}`;
    if (!reported.has(id)) {
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ELEMENT', { origin: el.element.node.origin, message: `<input> ${address} of type ${type === undefined ? 'text (no type)' : type} is not supported: only type=range is laid out; other inputs wait for the FORM-b package`, manual: `Use type="range", or a div in place of <input> ${address}.` }));
    }
    return;
  }
  const appearance = el.props.get('appearance') as ResolvedValue;
  const thumb = rangePart(el, 'thumb');
  const thumbAppearance = thumb === null ? null : (thumb.props.get('appearance') as ResolvedValue);
  if (keywordOf(appearance) !== 'none' || thumbAppearance === null || keywordOf(thumbAppearance) !== 'none') {
    const v = keywordOf(appearance) !== 'none' ? appearance : thumbAppearance;
    refuse(v, 'theme', `<input type=range> ${address} is painted by the platform theme unless it and its ::-webkit-slider-thumb are both appearance: none (Blink LayoutTheme; FORM-0 ruling F3), which waits for the FORM-b package`, `Set appearance: none on <input> ${address} and on its ::-webkit-slider-thumb.`);
  }
  const display = el.props.get('display') as ResolvedValue;
  const d = valueToString(display.value);
  if (d === 'inline-block' || d === 'inline-flex' || d === 'inline-grid' || d === 'inline') {
    refuse(display, 'inline', `display: ${d} on <input> ${address} makes it an inline-level control, which waits for the RF-INL package (atomic inlines)`, `Set display: block on <input> ${address}, or make it a flex item.`);
  } else if (d !== 'block' && d !== 'flex') {
    refuse(display, 'display', `display: ${d} on <input> ${address} is not supported on a range; only block-level ranges are laid out`, `Set display: block on <input> ${address}.`);
  }
  const position = el.props.get('position') as ResolvedValue;
  const pos = keywordOf(position);
  if (pos === 'absolute' || pos === 'fixed') {
    refuse(position, 'position', `position: ${pos} on <input> ${address} is not supported on a form control yet`, `Position a wrapper element and keep <input> ${address} in its flow.`);
  }
  for (const p of RANGE_FLEX_LONGHANDS) {
    const v = el.props.get(p) as ResolvedValue;
    if (v.declaration === null || isInitialByProvenance(v, p)) continue;
    refuse(v, `flex-${p}`, `${p}: ${valueToString(v.value)} on <input type=range> ${address} is not supported: the range's shadow tree is laid out as a flex container, which no fixture proves under it`, `Remove ${p} from <input> ${address}.`);
  }
}

/** A range shadow part of input el (resolve.ts), or null. */
function rangePart(el: ResolvedElement, part: 'container' | 'track' | 'thumb'): ResolvedElement | null {
  let at: ResolvedElement | undefined = el;
  while (at !== undefined) {
    const next: ResolvedElement | undefined = at.children.find((c): c is ResolvedElement => c.kind === 'element' && rangePartOf(c)?.part !== undefined && rangePartOf(c)?.part !== null);
    if (next === undefined) return null;
    if (rangePartOf(next)?.part === part) return next;
    at = next;
  }
  return null;
}

/** A range part inherits its direction from the input: a direction set in a part rule is refused (cascade.ts maps flow-relative sides by the input's). */
function checkRangePart(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const info = rangePartOf(el);
  if (info === undefined || info.part === null) return;
  const direction = el.props.get('direction') as ResolvedValue;
  if (direction.declaration === null) return;
  refuseOn(el, direction, 'part-direction', 'DRAGON_UNSUPPORTED_VALUE', targets, diagnostics, reported, `direction on the ${info.part} of <input> ${info.host.address} is not supported: a range part takes its input's direction`, `Set direction on <input> ${info.host.address} instead.`);
}

/** An absolutely positioned box inside a form control: the engine does not look up its containing block there (control-out-of-flow). */
function checkInsideButton(el: ResolvedElement, button: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const position = el.props.get('position') as ResolvedValue;
  const pos = keywordOf(position);
  if (pos !== 'absolute' && pos !== 'fixed') return;
  refuseOn(el, position, 'inside', 'DRAGON_UNSUPPORTED_VALUE', targets, diagnostics, reported, `position: ${pos} on <${el.element.tag}> ${el.element.address} inside <${button.element.tag}> ${button.element.address} is not supported yet: an absolutely positioned box inside a form control`, `Position the box outside <${button.element.tag}> ${button.element.address}.`);
}

export function checkComputed(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, profileOf: ProfileOf, fonts: FamilyKeyContext): void {
  const walk = (el: ResolvedElement, hidden: boolean, button: ResolvedElement | null, parentDisplay: string | null): void => {
    const here = hidden || keywordOf(el.props.get('display') as ResolvedValue) === 'none';
    checkOverflow(el, targets, diagnostics, reported);
    checkSubstitution(el, targets, diagnostics, reported, profileOf, fonts);
    if (!here) checkBidi(el, diagnostics, reported);
    if (!here) checkPosition(el, el === root, targets, diagnostics, reported);
    if (!here) checkAspectRatio(el, targets, diagnostics, reported);
    if (!here && isReplacedTag(el.element.tag)) checkReplaced(el, targets, diagnostics, reported);
    else if (!here && el.element.tag === 'button') checkButton(el, parentDisplay, targets, diagnostics, reported);
    else if (!here && el.element.tag === 'input') checkRange(el, targets, diagnostics, reported);
    else if (!here && rangePartOf(el) !== undefined) checkRangePart(el, targets, diagnostics, reported);
    else if (!here) checkInlineLevel(el, targets, diagnostics, reported);
    if (!here && button !== null) checkInsideButton(el, button, targets, diagnostics, reported);
    const inside = button ?? (isControlTag(el.element.tag) ? el : null);
    const own = keywordOf(el.props.get('display') as ResolvedValue);
    for (const c of el.children) if (c.kind === 'element') walk(c, here, inside, own === 'contents' ? parentDisplay : own);
  };
  walk(root, false, null, null);
  checkUserAgentDefaults(root, targets, environmentOf(root).ua, diagnostics, reported);
  // PNT2: transforms where they would change layout or paint beyond the box (analysis/paint-values/transform.ts).
  checkTransformContexts(root, targets, diagnostics, reported);
}

