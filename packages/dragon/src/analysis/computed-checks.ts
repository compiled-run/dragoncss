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
import { checkInlineLevel } from './blockify.ts';
import { uaTagOf } from './elements.ts';
import { analyzeDecorations } from './text-decoration.ts';
import { synthesisAllowedOf, textFontOfProps } from './computed.ts';
import { serializeFontStyle, serializeFontWeight } from '../fonts/weight.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';
import { environmentOf, valueToString } from './resolve.ts';

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

const displayKeyword = (el: ResolvedElement): string => keywordOf(el.props.get('display') as ResolvedValue);
const isInlineBox = (el: ResolvedElement): boolean => displayKeyword(el) === 'inline';

/** One item of an inline formatting context in tree order: a text, the open or close of an inline box, or a <br> (CSS2 §9.2.2). */
type IfcItem = { readonly kind: 'text'; readonly text: ResolvedText } | { readonly kind: 'open' | 'close' | 'br'; readonly el: ResolvedElement };

/**
 * The inline formatting contexts whose block container is el (el is not itself an inline box): its maximal runs of inline-level
 * children, flattened through inline boxes. A block-level child ends a run (CSS2 §9.2.1.1); display: none children generate no box.
 * blockInInline receives each block-level box inside an inline box, which Dragon does not lay out.
 */
function inlineContexts(el: ResolvedElement, blockInInline: (child: ResolvedElement, box: ResolvedElement) => void): IfcItem[][] {
  const runs: IfcItem[][] = [[]];
  const flatten = (box: ResolvedElement, out: IfcItem[]): void => {
    for (const c of box.children) {
      if (c.kind === 'text') out.push({ kind: 'text', text: c });
      else if (displayKeyword(c) === 'none') continue;
      else if (!isInlineBox(c)) blockInInline(c, box);
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
  }
}

// CSS2 §9.2.1.1, §9.4.2 and css-text-4 §5.1: what the inline formatting core does not lay out, refused for every target at the
// element: a block-level box inside an inline box (block-in-inline), an inline box on the empty line after a context's last <br>,
// and runs with different text-wrap-mode in one formatting context.
function checkInline(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  if (isInlineBox(el)) return;
  const refuse = (at: ResolvedElement, what: string, message: string, manual: string): void => {
    for (const t of targets) {
      const id = `${t}|inline-${what}|${at.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: at.element.node.origin, target: t, message, manual, basis: 'computed-value' }));
    }
  };
  const runs = inlineContexts(el, (child, box) =>
    refuse(child, 'block-in-inline', `<${child.element.tag}> ${child.element.address} is block-level inside the inline box <${box.element.tag}> ${box.element.address} (CSS2 §9.2.1.1 block-in-inline), which Dragon does not lay out`, `Move <${child.element.tag}> ${child.element.address} out of <${box.element.tag}> ${box.element.address}, or make ${box.element.address} a block.`),
  );
  for (const run of runs) {
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
      const collapse = keywordOf(it.el.props.get('white-space-collapse') as ResolvedValue);
      if (collapse !== 'collapse') refuse(it.el, 'white-space', `white-space-collapse: ${collapse} on the inline box <${it.el.element.tag}> ${it.el.element.address} (css-text-4 §4.1.1), which Dragon does not lay out`, `Remove the white-space declaration of ${it.el.element.address}, or make ${it.el.element.address} a block.`);
    }
    const preserved = run.some((it) => it.kind !== 'text') ? run.find((it) => it.kind === 'text' && keywordOf(it.text.props.get('white-space-collapse') as ResolvedValue) !== 'collapse') : undefined;
    if (preserved !== undefined && preserved.kind === 'text') {
      refuse(el, 'white-space', `white-space-collapse: ${keywordOf(preserved.text.props.get('white-space-collapse') as ResolvedValue)} on ${preserved.text.node.address} in an inline formatting context of ${el.element.address} with inline boxes or <br>s (css-text-4 §4.1.1), which Dragon does not lay out`, `Remove the white-space declaration of ${el.element.address}.`);
    }
    const texts = run.flatMap((it) => (it.kind === 'text' ? [it.text] : []));
    const wrapOf = (t: ResolvedText): string => keywordOf(t.props.get('text-wrap-mode') as ResolvedValue);
    const first = texts[0];
    const other = first === undefined ? undefined : texts.find((t) => wrapOf(t) !== wrapOf(first));
    if (first !== undefined && other !== undefined) {
      refuse(el, 'mixed-wrap', `text-wrap-mode ${wrapOf(first)} (${first.node.address}) and ${wrapOf(other)} (${other.node.address}) in one inline formatting context of ${el.element.address} (css-text-4 §5.1), which Dragon does not lay out`, `Give all the text of ${el.element.address} the same white-space.`);
    }
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
  // Inline content: text, or an inline box (INL1a), beside which the box would take a static position in the formatting context.
  if (!el.children.some((c) => c.kind === 'text' || (displayKeyword(c) === 'inline'))) return;
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
  if (raw === 'degenerate') return;
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
// minimum logical font size clamps, and text without a real bundled face whose computed font-weight or font-style Chrome draws
// synthesized (Ahem under a heading, b, strong, em, i or address, or an author weight of 600 and up).
function checkUserAgentDefaults(root: ResolvedElement, targets: readonly string[], ua: UaDataset, diagnostics: Diagnostic[], reported: Set<string>, realFaceAt: (address: string) => boolean): void {
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
    const absolute = size.origin === 'author' && size.declared !== null && size.declared.kind === 'length' ? true : size.origin === 'inherited' || size.origin === 'user-agent' ? parentAbsolute : false;
    const keyed = ua.userAgentContexts[uaTagOf(tag)];
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
    const synthetic = here ? [] : syntheticTextFont(el);
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
        // Web synthesizes the bold or oblique itself; every configured native target draws the regular face.
        for (const t of targets.filter((x) => x === 'ios' || x === 'android')) {
          once(`${t}|ua-font|${c.node.address}`, () => diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_FONT', {
            origin: c.node.node.origin,
            target: t,
            message: `text ${c.node.address} inherits ${sources.join(', and ')}; ${t} draws this text in its one regular face, where Chrome synthesizes the bold or oblique (Ahem's synthetic bold and oblique keep every glyph advance, so only the glyphs differ)`,
            manual: `Give ${c.node.address} a font-weight below 600 and a font-style below oblique 14deg, or a font family with a bundled face of that weight and style.`,
          })));
        }
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, [...ancestors, el], absolute, here);
  };
  walk(root, [], false, false);
}

/** The computed font-weight and font-style Chrome synthesizes over a single regular face (600 and up, slope 14 and up), where font-synthesis allows it. */
function syntheticTextFont(el: ResolvedElement): { readonly property: 'font-weight' | 'font-style'; readonly text: string }[] {
  const out: { property: 'font-weight' | 'font-style'; text: string }[] = [];
  const font = textFontOfProps(el.props);
  const allowed = synthesisAllowedOf(el.props);
  if (allowed.weight && font.weight >= 600) out.push({ property: 'font-weight', text: serializeFontWeight(font.weight) });
  const slope = font.style.kind === 'italic' ? 14 : font.style.kind === 'oblique' ? font.style.degrees : 0;
  if (allowed.style && slope >= 14) out.push({ property: 'font-style', text: serializeFontStyle(font.style) });
  return out;
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
export function checkComputed(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, profileOf: ProfileOf, fonts: FamilyKeyContext, realFaceAt: (address: string) => boolean): void {
  const walk = (el: ResolvedElement, hidden: boolean): void => {
    const here = hidden || keywordOf(el.props.get('display') as ResolvedValue) === 'none';
    checkOverflow(el, targets, diagnostics, reported);
    checkSubstitution(el, targets, diagnostics, reported, profileOf, fonts);
    if (!here) checkBidi(el, diagnostics, reported);
    if (!here) checkPosition(el, el === root, targets, diagnostics, reported);
    if (!here) checkAspectRatio(el, targets, diagnostics, reported);
    if (!here) checkInlineLevel(el, targets, diagnostics, reported);
    if (!here) checkInline(el, targets, diagnostics, reported);
    for (const c of el.children) if (c.kind === 'element') walk(c, here);
  };
  walk(root, false);
  checkUserAgentDefaults(root, targets, environmentOf(root).ua, diagnostics, reported, realFaceAt);
  checkDecorations(root, targets, diagnostics, reported);
}

/**
 * TDEC-a: web draws every accepted decoration; ios and android refuse decorated text until TDEC-b draws it. A child of a decorated
 * element in a formatting context no Chrome case proves propagation for is refused on every target.
 */
function checkDecorations(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const { applied, unproven } = analyzeDecorations(root);
  const byAddress = new Map<string, ResolvedText>();
  const index = (el: ResolvedElement): void => {
    for (const c of el.children) {
      if (c.kind === 'text') byAddress.set(c.node.address, c);
      else index(c);
    }
  };
  index(root);
  for (const [address, list] of applied) {
    const text = byAddress.get(address);
    if (text === undefined) throw new Error(`${address}: a decorated text leaf that is not in the tree`);
    const what = list.map((d) => `${d.lines.join(' ')} from ${d.box}`).join(', ');
    for (const t of targets.filter((x) => x === 'ios' || x === 'android')) {
      const id = `${t}|decoration|${address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: text.node.node.origin,
        target: t,
        message: `text ${address} draws text-decoration (${what}); ${t} draws decorations from TDEC-b`,
        manual: `Set text-decoration: none on the decorating box, or build for web; native decorations come with TDEC-b.`,
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

