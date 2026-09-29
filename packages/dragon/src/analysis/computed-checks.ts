// Refusals on computed values and laid-out text that no profile row can express: they depend on a value the author did not write
// (the css-overflow-3 §3.1 pair rule, Chrome's user-agent defaults), on where a declaration applies (html and body), or on the
// text and its direction (UAX #9).
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Longhand } from '../css/properties.ts';
import { LONGHANDS } from '../css/properties.ts';
import { featureOf } from '../css/values.ts';
import { iosProfile } from '../profiles/ios.ts';
import type { SupportProfile } from '../profiles/types.ts';
import { provenContexts } from '../profiles/types.ts';
import { webProfile } from '../profiles/web.ts';
import type { Diagnostic } from '../types.ts';
import type { UaDataset } from '../ua/datasets.ts';
import type { CapturedTag } from '../ua/datasets.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';
import { PAINT_VALUES } from './paint-values/index.ts';
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
    const tag = el.element.tag as CapturedTag;
    const here = hidden || keywordOf(el.props.get('display') as ResolvedValue) === 'none';
    const size = el.props.get('font-size') as ResolvedValue;
    const absolute = size.origin === 'author' && size.declared !== null && size.declared.kind === 'length' ? true : size.origin === 'inherited' || size.origin === 'user-agent' ? parentAbsolute : false;
    const keyed = ua.userAgentContexts[tag];
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
    const fonts = Object.keys(ua.userAgentTextFonts[tag]).length > 0 ? el : fontTag;
    if (!here && fonts !== null) {
      const row = ua.userAgentTextFonts[fonts.element.tag as CapturedTag];
      const set = Object.entries(row).map(([p, v]) => `${p}: ${v}`).join('; ');
      for (const c of el.children) {
        if (c.kind !== 'text') continue;
        once(`ios|ua-font|${c.node.address}`, () => diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_FONT', {
          origin: c.node.node.origin,
          target: 'ios',
          message: `text ${c.node.address} inherits ${set} from Chrome's user-agent stylesheet on <${fonts.element.tag}> ${fonts.element.address}; Dragon has no font-weight or font-style, so ios would draw it in the regular face (Ahem's synthetic bold and oblique keep every glyph advance, so only the glyphs differ)`,
          manual: `Put the text in a div outside <${fonts.element.tag}> ${fonts.element.address}; font-weight and font-style need the real-font text support.`,
        })));
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, [...ancestors, el], absolute, fonts, here);
  };
  walk(root, [], false, null, false);
}

const COMMITTED: { readonly [target: string]: SupportProfile } = { ios: iosProfile, web: webProfile };

// css-variables-1 §3.1: a value that only exists after var() substitution was never seen by the declared-value check. A grammar-valid
// result Dragon cannot express is refused for every target, and a result whose feature no committed profile row proves in any
// context is refused for that target (the contextual check reports the proven-elsewhere case).
function checkSubstitution(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
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
    if (v.declared === null) continue;
    const feature = featureOf(p, v.declared);
    for (const t of targets) {
      const profile = COMMITTED[t];
      if (profile === undefined || provenContexts(profile, feature).length > 0) continue;
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
 * subtree is never laid out (CSS2 §9.2.4), so only the overflow check reaches it. */
export function checkComputed(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const walk = (el: ResolvedElement, hidden: boolean): void => {
    const here = hidden || keywordOf(el.props.get('display') as ResolvedValue) === 'none';
    checkOverflow(el, targets, diagnostics, reported);
    checkSubstitution(el, targets, diagnostics, reported);
    if (!here) checkBidi(el, diagnostics, reported);
    if (!here) checkPosition(el, el === root, targets, diagnostics, reported);
    // Paint modules' computed-value refusals (analysis/paint-values), in registry order.
    if (!here) for (const m of PAINT_VALUES) m.check?.(el, targets, diagnostics, reported);
    for (const c of el.children) if (c.kind === 'element') walk(c, here);
  };
  walk(root, false);
  checkUserAgentDefaults(root, targets, environmentOf(root).ua, diagnostics, reported);
}

