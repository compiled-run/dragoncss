// @keyframes (css-animations-1 §3, T065 R10): accepted at the top level of a stylesheet and refused inside a conditional group
// (MQ-R). Each block's selectors become offsets and its declarations milestone longhands, parsed as in a style rule; Chrome's
// rules inside keyframes apply: !important is ignored, a property that is not valid for keyframes has no effect, and
// animation-timing-function is the keyframe's easing. Only types come from at-rules.ts, so the two modules can import each other.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../../types.ts';
import type { AtRuleContext, AtRuleHandler } from '../at-rules.ts';
import { resolveAlias } from '../aliases.ts';
import { list, spanOf } from '../ast.ts';
import { asciiLower, decodeName } from '../escapes.ts';
import type { Longhand } from '../properties.ts';
import { isLonghand, isShorthand } from '../properties.ts';
import type { EasingValue } from '../properties/animation.ts';
import { isAnimationProperty, parseAnimationValue } from '../properties/animation.ts';
import type { CssValue, SheetUse } from '../stylesheet.ts';
import { parseValue } from '../stylesheet.ts';
import { CSS_WIDE } from '../values.ts';

/** An accepted @keyframes as the parse driver collects it, with what its declarations need to be located. */
export type KeyframesSource = { readonly context: AtRuleContext; readonly base: Span; readonly text: string; readonly use: SheetUse };

/** One property value of a keyframe block, with the declaration that set it. */
export type KeyframeDeclaration = { readonly property: Longhand; readonly value: CssValue; readonly span: Span; readonly valueSpan: Span; readonly text: string };

/** One keyframe block: its offsets (a selector list gives several), its own easing, and its values in declaration order. */
/** labels: each selector as written (from, to or a percentage), for the web output. */
export type KeyframeBlock = { readonly offsets: readonly number[]; readonly labels: readonly string[]; readonly easing: EasingValue | null; readonly values: readonly KeyframeDeclaration[]; readonly span: Span };

/** span: the whole at-rule; preludeSpan: "@keyframes <name>", where the rule's own features are reported. */
export type KeyframesRule = { readonly name: string; readonly span: Span; readonly preludeSpan: Span; readonly blocks: readonly KeyframeBlock[] };

/** Chrome 145's properties with valid_for_keyframe: false (css_properties.json5; animation-kinds.test.ts checks the list). */
export const NOT_VALID_FOR_KEYFRAME: readonly string[] = [
  'animation', 'animation-delay', 'animation-direction', 'animation-duration', 'animation-fill-mode', 'animation-iteration-count', 'animation-name',
  'animation-play-state', 'animation-range', 'animation-range-end', 'animation-range-start', 'timeline-trigger', 'timeline-trigger-active-range',
  'timeline-trigger-entry-range',
];

const TIMELINE_RANGE_NAMES = ['cover', 'contain', 'entry', 'exit', 'entry-crossing', 'exit-crossing', 'scroll', 'view'];

/** <keyframes-name>: a <custom-ident> other than none, or a string (css-animations-1 §3). */
function nameOf(prelude: CssNode | null | undefined): string | null {
  const ts = prelude === null || prelude === undefined ? [] : list(prelude, 'children').filter((c) => c.type !== 'WhiteSpace');
  const t = ts[0];
  if (ts.length !== 1 || t === undefined) return null;
  if (t.type === 'String') return String(t['value']);
  if (t.type !== 'Identifier') return null;
  const name = decodeName(String(t['name']));
  const k = asciiLower(name);
  return CSS_WIDE.has(k) || k === 'default' || k === 'none' ? null : name;
}

/** At the top level a @keyframes with a valid name and a block is accepted; inside a conditional group it waits for MQ-R. */
// A function declaration, so at-rules.ts can register it while the two modules import each other.
export function keyframesAtRule(at: AtRuleContext): ReturnType<AtRuleHandler> {
  const block = at.node['block'] as CssNode | null | undefined;
  if (at.where === 'the stylesheet' && block !== null && block !== undefined && nameOf(at.node['prelude'] as CssNode | null | undefined) !== null) return { kind: 'keyframes', context: at };
  const message = at.where.startsWith('@')
    ? `@keyframes inside ${at.where} is not supported (package MQ-R)`
    : at.where === 'the stylesheet'
      ? `@keyframes ${at.prelude ?? ''} is not a valid @keyframes rule: the name must be an identifier other than none, or a string, and the rule needs a block`
      : `@${at.name} in ${at.where} is not supported in milestone 1`;
  return { kind: 'refuse', diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', { origin: authored(at.span), message }) };
}

/** A keyframe selector's offset (from, to or a percentage in [0, 100]), 'range' for a timeline range selector, or null. */
function offsetOf(sel: CssNode): number | 'range' | null {
  const parts = list(sel, 'children').filter((c) => c.type !== 'WhiteSpace' && c.type !== 'Combinator');
  const first = parts[0];
  if (first === undefined) return null;
  if (parts.length === 1 && first.type === 'TypeSelector') {
    const k = asciiLower(String(first['name']));
    return k === 'from' ? 0 : k === 'to' ? 1 : null;
  }
  if (parts.length === 1 && first.type === 'Percentage') {
    const v = Number(first['value']);
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v / 100 : null;
  }
  if (parts.length === 2 && first.type === 'TypeSelector' && TIMELINE_RANGE_NAMES.includes(asciiLower(String(first['name']))) && parts[1]?.type === 'Percentage') return 'range';
  return null;
}

/** Parses each collected @keyframes into blocks, reporting what Chrome ignores inside keyframes and what Dragon refuses. */
export function parseKeyframesRules(sources: readonly KeyframesSource[], diagnostics: Diagnostic[]): KeyframesRule[] {
  const out: KeyframesRule[] = [];
  for (const src of sources) {
    const block = src.context.node['block'] as CssNode;
    const name = nameOf(src.context.node['prelude'] as CssNode | null | undefined) as string;
    const blocks: KeyframeBlock[] = [];
    for (const r of list(block, 'children')) {
      const span = spanOf(r, src.base);
      if (r.type === 'Raw' && /^[\s;]*$/.test(String(r['value']))) continue;
      if (r.type !== 'Rule') {
        diagnostics.push(diagnostic('DRAGON_CSS_PARSE', { origin: authored(span), message: `CSS ${r.type} in @keyframes ${name} is not a keyframe block` }));
        continue;
      }
      const offsets: number[] = [];
      const labels: string[] = [];
      let dropped = false;
      for (const sel of list(r['prelude'] as CssNode, 'children')) {
        const o = offsetOf(sel);
        if (o === 'range') {
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(sel, src.base)), message: `the keyframe selector ${generate(sel)} in @keyframes ${name} is unsupported: scroll and view timelines are not built yet (package ANIM-S)` }));
          dropped = true;
        } else if (o === null) {
          diagnostics.push(diagnostic('DRAGON_CSS_PARSE', { origin: authored(spanOf(sel, src.base)), message: `${generate(sel)} is not a keyframe selector (from, to or a percentage from 0% to 100%), so Chrome drops this keyframe block of @keyframes ${name}` }));
          dropped = true;
        } else {
          offsets.push(o);
          labels.push(generate(sel));
        }
      }
      const parsed = parseBlock(r, src, name, diagnostics);
      if (!dropped) blocks.push({ offsets, labels, easing: parsed.easing, values: parsed.values, span });
    }
    const prelude = src.context.node['prelude'] as CssNode;
    const preludeSpan = { source: src.context.span.source, start: src.context.span.start, end: spanOf(prelude, src.base).end };
    out.push({ name, span: src.context.span, preludeSpan, blocks });
  }
  return out;
}

function parseBlock(rule: CssNode, src: KeyframesSource, name: string, diagnostics: Diagnostic[]): { easing: EasingValue | null; values: KeyframeDeclaration[] } {
  let easing: EasingValue | null = null;
  const values: KeyframeDeclaration[] = [];
  for (const d of list(rule['block'] as CssNode, 'children')) {
    const span = spanOf(d, src.base);
    // css-syntax-3 §5.4: a lone ";" or white space is no declaration.
    if (d.type === 'Raw' && /^[\s;]*$/.test(String(d['value']))) continue;
    if (d.type !== 'Declaration') {
      diagnostics.push(diagnostic('DRAGON_CSS_PARSE', { origin: authored(span), message: `CSS ${d.type} in a keyframe block of @keyframes ${name} is not a declaration` }));
      continue;
    }
    const written = decodeName(String(d['property']));
    const property = written.startsWith('--') ? written : resolveAlias(asciiLower(written));
    const valueNode = d['value'] as CssNode;
    const valueSpan = spanOf(valueNode, src.base);
    const text = generate(valueNode);
    const source = src.text.slice(valueSpan.start - src.base.start, valueSpan.end - src.base.start);
    const refuse = (code: 'DRAGON_UNSUPPORTED_PROPERTY' | 'DRAGON_UNSUPPORTED_VALUE' | 'DRAGON_UNSUPPORTED_IMPORTANT' | 'DRAGON_CSS_INVALID_VALUE', message: string, at: Span = span): void => {
      // A property or !important refusal fixes by deleting the declaration (its catalogue fix is an edit).
      const edits = code === 'DRAGON_UNSUPPORTED_PROPERTY' || code === 'DRAGON_UNSUPPORTED_IMPORTANT' ? { edits: [{ span, replacement: '' }] } : {};
      diagnostics.push(diagnostic(code, { origin: authored(at), message, ...edits }));
    };
    if (d['important'] !== false) {
      refuse('DRAGON_UNSUPPORTED_IMPORTANT', `!important on ${property} in @keyframes ${name}: Chrome ignores it inside @keyframes, so the declaration has no effect`);
      continue;
    }
    if (property === 'animation-timing-function') {
      const r = parseAnimationValue(property, valueNode);
      const v = r.kind === 'ok' ? r.value.longhands.get('animation-timing-function') : undefined;
      const item = v !== undefined && v.kind === 'list' && v.items.length === 1 ? v.items[0] : undefined;
      if (item === undefined || item.kind !== 'easing') refuse('DRAGON_CSS_INVALID_VALUE', `"${text}" is not one timing function, so Chrome ignores this keyframe easing in @keyframes ${name}`, valueSpan);
      else if (item.easing.kind === 'linear()') refuse('DRAGON_UNSUPPORTED_VALUE', `animation-timing-function: ${item.easing.text} in @keyframes ${name} is unsupported: linear() easing is not built yet (package ANIM-L)`, valueSpan);
      else easing = item.easing;
      continue;
    }
    if (NOT_VALID_FOR_KEYFRAME.includes(property)) {
      refuse('DRAGON_UNSUPPORTED_PROPERTY', `${property} has no effect inside @keyframes in Chrome; remove it`);
      continue;
    }
    if (property === 'animation-composition') {
      refuse('DRAGON_UNSUPPORTED_VALUE', `animation-composition in @keyframes ${name} is unsupported: a keyframe composite is not built yet (package ANIM-c)`);
      continue;
    }
    if (isAnimationProperty(property) || property.startsWith('--') || (!isLonghand(property) && !isShorthand(property))) {
      refuse('DRAGON_UNSUPPORTED_PROPERTY', `${property} inside @keyframes ${name} is not supported in milestone 1`);
      continue;
    }
    if (/var\(|\\/i.test(source)) {
      refuse('DRAGON_UNSUPPORTED_VALUE', `${property}: ${source.trim()} in @keyframes ${name} is unsupported: ANIM-b1 does not substitute var() in keyframes (package ANIM-v)`, valueSpan);
      continue;
    }
    const tokens = list(valueNode, 'children').filter((n) => n.type !== 'WhiteSpace');
    const first = tokens[0];
    if (tokens.length === 1 && first !== undefined && first.type === 'Identifier' && CSS_WIDE.has(asciiLower(String(first['name'])))) {
      refuse('DRAGON_UNSUPPORTED_VALUE', `${property}: ${text} in @keyframes ${name} is unsupported: CSS-wide keywords in keyframes are not built yet (package ANIM-k)`, valueSpan);
      continue;
    }
    const parsed = parseValue(property as Parameters<typeof parseValue>[0], valueNode, tokens, src.base, src.text);
    if (parsed.kind === 'ok') {
      for (const lh of parsed.longhands) values.push({ property: lh.property, value: lh.value, span, valueSpan, text });
      continue;
    }
    if (parsed.kind === 'refused') diagnostics.push(parsed.diagnostic);
    else if (parsed.kind === 'token') refuse('DRAGON_UNSUPPORTED_VALUE', `${property}: ${generate(parsed.token)} is unsupported: ${parsed.reason}`, spanOf(parsed.token, src.base));
    else if (parsed.kind === 'multi') refuse('DRAGON_UNSUPPORTED_VALUE', `multi-token value "${text}" for ${property} is not supported in milestone 1`, valueSpan);
    else refuse('DRAGON_CSS_INVALID_VALUE', parsed.reason === undefined ? `"${text}" is not a valid value for ${property}, so Chrome ignores it in @keyframes ${name}` : `"${text}" is not a valid value for ${property}: ${parsed.reason}`, valueSpan);
  }
  return { easing, values };
}
