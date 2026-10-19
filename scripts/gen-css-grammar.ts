// Generates packages/dragon/src/css/grammar.generated.ts from @webref/css (pinned), for the milestone property subset.
// Run with: pnpm run grammar:gen
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_BOX_PROPERTIES } from '../packages/dragon/src/css/properties/flex.ts';
import { GRID_LONGHANDS, GRID_SHORTHANDS } from '../packages/dragon/src/css/properties/grid.ts';
import { LOGICAL_SHORTHANDS } from '../packages/dragon/src/css/properties/logical.ts';
import { WRITING_MODE_SHORTHANDS } from '../packages/dragon/src/css/properties/writing-mode.ts';
import { EFFECTS_LONGHANDS } from '../packages/dragon/src/css/properties/effects.ts';
import { LOGICAL_CORNER_PROPERTIES, RADIUS_LONGHANDS } from '../packages/dragon/src/css/properties/radius.ts';
import { TRANSFORM_LONGHANDS } from '../packages/dragon/src/css/properties/transform.ts';
import { SVG_LONGHANDS } from '../packages/dragon/src/css/properties/svg.ts';
import { MASK_LONGHANDS, MASK_SHORTHANDS } from '../packages/dragon/src/css/properties/mask.ts';

type WebrefEntry = {
  name: string;
  syntax?: string;
  initial?: string;
  inherited?: string;
};
type WebrefCss = { properties: WebrefEntry[]; types: WebrefEntry[]; functions: WebrefEntry[] };

const require = createRequire(import.meta.url);
const webrefDir = dirname(require.resolve('@webref/css/package.json'));
const webrefVersion = (JSON.parse(readFileSync(join(webrefDir, 'package.json'), 'utf8')) as { version: string }).version;
if (webrefVersion !== '8.7.5') throw new Error(`@webref/css must be 8.7.5, found ${webrefVersion}`);
const css = JSON.parse(readFileSync(join(webrefDir, 'css.json'), 'utf8')) as WebrefCss;

/** Longhands and shorthands the milestone-1 compiler reads. Support status lives in the profiles, not here. */
const SUBSET = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'overflow', 'overflow-x', 'overflow-y', 'direction', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio', 'object-fit', 'object-position',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'flex', 'flex-flow', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'justify-content', 'align-items', 'align-self', 'align-content', 'gap', 'row-gap', 'column-gap', ...LEGACY_BOX_PROPERTIES,
  'font', 'font-size', 'font-family', 'font-weight', 'font-style', 'font-synthesis', 'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', 'text-decoration', 'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset', 'text-underline-position', 'text-decoration-skip-ink', 'line-height', 'text-align', 'white-space', 'white-space-collapse', 'text-wrap-mode', 'color', 'background', 'background-color',
  ...LOGICAL_SHORTHANDS,
  ...WRITING_MODE_SHORTHANDS,

  // Grid (css-grid-2), after the writing-mode family.
  ...GRID_LONGHANDS, ...GRID_SHORTHANDS,

  // SELD-R1b: pointer-events, after grid.
  'pointer-events',
  // Border radii (PNT1), after pointer-events, as LONGHANDS registers them, then their shorthands.
  ...RADIUS_LONGHANDS,
  'border-radius', '-webkit-border-radius', ...LOGICAL_CORNER_PROPERTIES,
  // Box shadows (PNT1), after the radii.
  'box-shadow',
  // Outlines (PNT1), after the radius family, as LONGHANDS registers them, then their shorthand.
  'outline-color', 'outline-style', 'outline-width', 'outline-offset', 'outline',
  // Transforms (PNT2), after grid, as LONGHANDS registers them.
  ...TRANSFORM_LONGHANDS,
  // opacity and z-index (PNT1), after transforms.
  ...EFFECTS_LONGHANDS,
  // GEN-b: content and list-style (css-content-3, css-lists-3), as LONGHANDS registers them.
  'content', 'list-style', 'list-style-type', 'list-style-position', 'list-style-image',
  // Background layers (BG2), as LONGHANDS registers them, then background-position.
  'background-image', 'background-position-x', 'background-position-y', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip', 'background-position',
  // OVFL-S0: scrollbar-width and scrollbar-gutter (css-scrollbars-1 §3, css-overflow-4 §3.2), after the background layers, as LONGHANDS registers them.
  'scrollbar-width', 'scrollbar-gutter',
  // T150a: visibility (css-display-3 §4), after lists, as LONGHANDS registers it.
  'visibility',
  // vertical-align (CSS2 §10.8.1), then float and clear (CSS2 §9.5), as LONGHANDS registers them.
  'vertical-align', 'float', 'clear',
  // T154: user-select (css-ui-4 §6.1), after visibility, as LONGHANDS registers it.
  'user-select',
  // SVG paint (SVG-a1), after GEN-b, last, as LONGHANDS registers them.
  ...SVG_LONGHANDS,
  // TXT2-b: letter-spacing (css-text-3 §8.2), after visibility, as LONGHANDS registers it.
  'letter-spacing',
  // TXT2-b: word-spacing (css-text-3 §8.1), after letter-spacing, as LONGHANDS registers it.
  'word-spacing',
  // TXT2-f: text-overflow (css-overflow-4 §3.1), after visibility.
  'text-overflow',
  // TXT2-e: text-transform (css-text-3 §2.1), after visibility, as LONGHANDS registers it.
  'text-transform',
  // resize (css-ui-4 §5.1), after text-transform, as LONGHANDS registers it.
  'resize',
  // TXT2-h: text-indent (css-text-3 §8.1), after resize, as LONGHANDS registers it.
  'text-indent',
  // TXT2-a: overflow-wrap and word-break (css-text-3 §5.2, §5.5), then the word-wrap alias, as LONGHANDS registers them.
  'overflow-wrap', 'word-break', 'word-wrap',
  // css-fonts-4 §6.4-§6.11: the font-variant longhands, then the font-variant shorthand, after word-wrap, as LONGHANDS registers them.
  'font-variant-ligatures', 'font-variant-caps', 'font-variant-alternates', 'font-variant-numeric', 'font-variant-east-asian', 'font-variant-position', 'font-variant-emoji', 'font-variant',
  // css-fonts-4 §6.3, §7.1, §6.13: font-kerning, font-optical-sizing and font-language-override, after word-wrap, as LONGHANDS registers them.
  'font-kerning', 'font-optical-sizing', 'font-language-override',
  // TXT-FONTFEAT: font-stretch (css-fonts-4 §2.4), before the line clamp, as LONGHANDS registers it.
  'font-stretch',
  // TXT-FONTFEAT: font-feature-settings and font-variation-settings (css-fonts-4 §6.12, §7.2), before the line clamp, as LONGHANDS registers them.
  'font-feature-settings', 'font-variation-settings',
  // TXT-FX: the text fill colour and stroke (compat §5), then the -webkit-text-stroke shorthand, after the font families, as LONGHANDS registers them.
  '-webkit-text-fill-color', '-webkit-text-stroke-color', '-webkit-text-stroke-width', '-webkit-text-stroke',
  // TXT-FX: text-shadow (css-text-decor-4 §4), after the text fill and stroke, as LONGHANDS registers it.
  'text-shadow',
  // FX: filter (filter-effects-1 §5), after text-shadow, as LONGHANDS registers it.
  'filter',
  // PNT2: the 3D transform longhands (css-transforms-2 §6, §7), after filter, as LONGHANDS registers them. webref's keywords are
  // Chrome 145's (css_properties.json5 keywords).
  'backface-visibility', 'transform-style', 'transform-box',
  // TXT2-g: the legacy line clamp (css-overflow-4 §4.2), after word-wrap, as LONGHANDS registers them.
  '-webkit-box-orient', '-webkit-line-clamp',
  // touch-action (pointerevents-3 §10.2), after line-clamp, as LONGHANDS registers it.
  'touch-action',
  // MASK-CLIP: clip (css-masking-1 §5.1), after touch-action, as LONGHANDS registers it.
  'clip',
  // MASK-CLIP: clip-path (css-masking-1 §6.1), after clip, as LONGHANDS registers it.
  'clip-path',
  // MASK-CLIP: the mask layer longhands (css-masking-1 §7), then mask and mask-position, after clip-path, as LONGHANDS registers them.
  ...MASK_LONGHANDS, ...MASK_SHORTHANDS,
] as const;

/**
 * Values a browser that supports SVG must also accept, which webref's syntax omits: css-writing-modes-4 Appendix B, the SVG 1.1
 * writing-mode values (lr, lr-tb, rl and rl-tb compute to horizontal-tb; tb and tb-rl to vertical-rl). Chrome 145 parses all six.
 */
const SYNTAX_EXTENSIONS: { readonly [property: string]: string } = {
  'writing-mode': 'lr | lr-tb | rl | rl-tb | tb | tb-rl',
  // Blink's image parser (css_parsing_utils.cc ConsumeImage) also takes the prefixed -webkit-image-set() and -webkit-cross-fade(),
  // which webref's <image> omits; Chrome 145 parses both in content and list-style-image (packages/parity/test/list-style-parse.test.ts).
  content: '-webkit-image-set( <image-set-option># ) | -webkit-cross-fade( <image> , <image> , [ <percentage> | <number> ] )',
  'list-style-image': '-webkit-image-set( <image-set-option># ) | -webkit-cross-fade( <image> , <image> , [ <percentage> | <number> ] )',
  // css-ui-4 §5.1 lists no auto, but Chrome 145 parses it under CSSResizeAuto, a stable feature (css_parser_fast_paths.cc kResize).
  resize: 'auto',
};

/**
 * Properties whose whole grammar is Chrome 145's instead of webref's. display: Blink Display::ParseSingleValue and
 * ParseDisplayMultipleKeywords. Outside is block or inline (no run-in), inside never grid-lanes (CSSGridLanesLayout is off),
 * ruby-text is the only ruby internal value, and the legacy keywords run from inline-block to -webkit-inline-flex in Blink's
 * keyword order, so they take -webkit-box, -webkit-inline-box, -webkit-flex and -webkit-inline-flex. Pinned against Chrome by
 * packages/parity/test/display-parse.test.ts.
 */
const SYNTAX_OVERRIDES: { readonly [property: string]: string } = {
  // Blink ClipPath::ParseSingleValue (longhands_custom.cc), ConsumeBasicShapeCircle and ConsumeBasicShapeEllipse (css_parsing_utils.cc):
  // a circle or ellipse radius is a non-negative <length-percentage>, closest-side or farthest-side (webref's <radial-size> drops a
  // lone percentage), rect() is ConsumeBasicShapeRect's (webref's <rect()> resolves to clip's comma form), and the reference box is
  // ConsumeGeometryBox's (no half-border-box).
  'clip-path': "none | <url> | [ [ inset( <length-percentage>{1,4} [ round <'border-radius'> ]? ) | circle( [ <length-percentage [0,∞]> | closest-side | farthest-side ]? [ at <position> ]? ) | ellipse( [ [ <length-percentage [0,∞]> | closest-side | farthest-side ]{2} ]? [ at <position> ]? ) | <polygon()> | <path()> | <shape()> | rect( [ <length-percentage> | auto ]{4} [ round <'border-radius'> ]? ) | <xywh()> ] || [ border-box | padding-box | content-box | margin-box | fill-box | stroke-box | view-box ] ]",
  // Blink Clip::ParseSingleValue (longhands_custom.cc): auto, or rect() with four <length> or auto edges separated all by commas
  // or all by whitespace; webref's <rect()> resolves to css-shapes' basic shape as well as css-masking's comma form.
  clip: 'auto | rect( [ <length> | auto ]{4} ) | rect( [ <length> | auto ]#{4} )',
  // Blink's mask parsers (longhands_custom.cc MaskImage through MaskSize, shorthands_custom.cc Mask and MaskPosition). Dragon accepts
  // each mask longhand only at its initial value and refuses every other value where it applies (computed-checks.ts checkMask), so
  // the grammar takes any value: a mask webref's grammar misses is refused, never dropped where Chrome would apply it. Pinned against
  // Chrome by packages/parity/test/mask-parse.test.ts.
  ...Object.fromEntries([...MASK_LONGHANDS, ...MASK_SHORTHANDS].map((p) => [p, '<any-value>'])),
  // webref has no syntax for the legacy -webkit-box properties: Blink CSSParserFastPaths::IsValidKeywordPropertyAndValue for the
  // keyword ones, and WebkitBoxFlex (ConsumeNumber, any sign) and WebkitBoxOrdinalGroup (ConsumePositiveInteger) ParseSingleValue.
  '-webkit-box-align': 'stretch | start | center | end | baseline',
  '-webkit-box-direction': 'normal | reverse',
  '-webkit-box-flex': '<number>',
  '-webkit-box-ordinal-group': '<integer [1,∞]>',
  '-webkit-box-orient': 'horizontal | vertical | inline-axis | block-axis',
  '-webkit-box-pack': 'start | center | end | justify',
  // Blink ListStyleType::ParseSingleValue (css/properties/longhands/longhands_custom.cc): none, a string or a counter-style name;
  // symbols() is parsed only in @counter-style, so webref's <symbols()> is dropped (pinned by packages/parity/test/list-style-parse.test.ts).
  'list-style-type': '<counter-style-name> | <string> | none',
  // Blink VerticalAlign::ParseSingleValue (css/properties/longhands/longhands_custom.cc): one keyword or one <length-percentage>
  // (the unitless quirk applies only in quirks mode). Blink keeps vertical-align a longhand, not css-inline-3's shorthand of
  // alignment-baseline and baseline-shift. Pinned against Chrome by packages/parity/test/inert-layout-parse.test.ts.
  // Blink's float and clear keywords (css_properties.json5): CSS2's, plus css-logical-1's inline-start and inline-end; none of
  // css-page-floats-3's. Pinned against Chrome by packages/parity/test/inert-layout-parse.test.ts.
  float: 'none | left | right | inline-start | inline-end',
  clear: 'none | left | right | both | inline-start | inline-end',
  'vertical-align': 'baseline | sub | super | text-top | text-bottom | middle | top | bottom | -webkit-baseline-middle | <length-percentage>',
  // Blink parses one keyword, clip or ellipsis: the <string> value (TextOverflowString) and the two-value form are test features
  // in Chrome 145 (notes/T149-txt2-spec.md R2), and webref's fade and fade() are not parsed.
  'text-overflow': 'clip | ellipsis',
  // Blink parses one <length-percentage>: hanging and each-line are behind CssTextIndent, a test feature in Chrome 145
  // (notes/T149-txt2-spec.md R2).
  'text-indent': '<length-percentage>',
  // Blink WordBreak (css_properties.json5 keywords): css-text-4's manual is not parsed in Chrome 145 (notes/T149-txt2-spec.md R2).
  'word-break': 'normal | break-all | keep-all | break-word | auto-phrase',
  // Blink's text-transform parser with CSSTextTransformFullWidth off (Chrome 145): one keyword; full-width and full-size-kana are invalid.
  'text-transform': 'none | capitalize | uppercase | lowercase | math-auto',
  // Blink TextShadow::ParseSingleValue: ConsumeShadow with AllowInsetAndSpread::kForbid, so a text shadow takes no spread and no
  // inset, unlike webref's <shadow>. Pinned against Chrome by packages/parity/test/text-shadow-parse.test.ts.
  'text-shadow': 'none | [ <color>? && [ <length>{2} <length [0,∞]>? ] ]#',
  // Blink Filter::ParseSingleValue (longhands_custom.cc) takes none or a list of filter functions and url()s. Dragon accepts only none
  // and refuses every other value where it applies (computed-checks.ts checkFilter), so the grammar takes any value: a filter webref's
  // <filter-value-list> misses is refused, never dropped where Chrome would apply it. Pinned against Chrome by
  // packages/parity/test/filter-parse.test.ts.
  filter: 'none | <any-value>',
  display: [
    '[ block | inline ] || [ flow | flow-root | table | flex | grid | ruby | math ]',
    '[ block | inline ]? && [ flow | flow-root ]? && list-item',
    'table-row-group | table-header-group | table-footer-group | table-row | table-cell | table-column-group | table-column | table-caption | ruby-text',
    'contents | none',
    'inline-block | inline-table | inline-flex | inline-grid | -webkit-box | -webkit-inline-box | -webkit-flex | -webkit-inline-flex',
  ].join(' | '),
  // Blink StrokeWidth::ParseSingleValue: one non-negative length, percentage or (SVG quirk) number; webref's list and
  // <line-width> keywords do not parse in Chrome 145 (probed: "thin" and "2px, 3px" are invalid).
  'stroke-width': '<length-percentage [0,∞]> | <number [0,∞]>',
  // Blink ParsePaintStroke (fill and stroke): webref's <paint> has no <color>; Chrome 145 parses SVG 1.1's <paint>.
  fill: 'none | <color> | <url> [ none | <color> ]? | context-fill | context-stroke',
  stroke: 'none | <color> | <url> [ none | <color> ]? | context-fill | context-stroke',
  // Blink StrokeLinejoin (css_properties.json5 keywords): miter, bevel and round; webref's crop, arcs and fallback do not parse in
  // Chrome 145.
  'stroke-linejoin': 'miter | bevel | round',
  // Blink StrokeMiterlimit::ParseSingleValue: ConsumeNumber with ValueRange::kNonNegative.
  'stroke-miterlimit': '<number [0,∞]>',
  // Blink StrokeDasharray::ParseSingleValue: none, or non-negative lengths, percentages or (SVG attribute mode) numbers, each
  // followed by an optional comma; webref's <dasharray> takes the same, written here as comma-separated runs.
  'stroke-dasharray': 'none | [ [ <length-percentage [0,∞]> | <number [0,∞]> ]+ ]#',
  // Blink StrokeDashoffset::ParseSingleValue: any length or percentage, or (SVG attribute mode) a number.
  'stroke-dashoffset': '<length-percentage> | <number>',
  // Blink Cx, Cy, R, X and Y ::ParseSingleValue: ConsumeSVGGeometryPropertyLength, a length or percentage in SVG attribute mode
  // (so a number is a length in px too); r takes ValueRange::kNonNegative. webref has <length-percentage> only.
  cx: '<length-percentage> | <number>',
  cy: '<length-percentage> | <number>',
  r: '<length-percentage [0,∞]> | <number [0,∞]>',
  x: '<length-percentage> | <number>',
  y: '<length-percentage> | <number>',
  // Blink PaintOrder::ParseSingleValue: normal, or fill, stroke and markers each at most once (svg-paint-order.ts canonicalizes).
  'paint-order': 'normal | [ fill || stroke || markers ]',
  // Blink Rx and Ry ::ParseSingleValue: auto, or ConsumeSVGGeometryPropertyLength with ValueRange::kNonNegative.
  rx: 'auto | <length-percentage [0,∞]> | <number [0,∞]>',
  ry: 'auto | <length-percentage [0,∞]> | <number [0,∞]>',
};

/**
 * Initial and inherited fields webref leaves out (-webkit-box-orient has no entry of its own) or defers to line-clamp ("see
 * individual properties"): Blink's css_properties.json5 values for the legacy line-clamp longhands (TXT2-g).
 */
const FIELD_OVERRIDES: { readonly [property: string]: { readonly initial: string; readonly inherited: string } } = {
  '-webkit-box-orient': { initial: 'horizontal', inherited: 'no' },
  '-webkit-line-clamp': { initial: 'none', inherited: 'no' },
  // webref lists font-stretch as a legacy alias of css-fonts-4's font-width, without fields; Chrome 145 has no font-width and keeps
  // font-stretch a longhand, initial normal, inherited (css-fonts-4 §2.4).
  'font-stretch': { initial: 'normal', inherited: 'yes' },
  // webref has no -webkit-mask-position-x or -y; Chrome 145 keeps them the longhands of mask-position, initial 0%, not inherited
  // (longhands_custom.cc WebkitMaskPositionX::InitialValue and WebkitMaskPositionY::InitialValue).
  '-webkit-mask-position-x': { initial: '0%', inherited: 'no' },
  '-webkit-mask-position-y': { initial: '0%', inherited: 'no' },
};

const propsByName = new Map(css.properties.map((p) => [p.name, p]));
const typesByName = new Map(css.types.map((t) => [t.name, t]));
// Functional notations such as <rgb()> are listed under webref's functions, keyed with their parentheses.
const functionsByName = new Map(css.functions.map((f) => [f.name, f]));
// css-tree matches url tokens with its own <url> generic; webref's token-level definition cannot match css-tree's Url node.
const CSS_TREE_GENERICS = new Set(['url']);
const refPattern = /<'([a-z-]+)'>|<([a-zA-Z0-9-]+(?:\(\))?)(?:\s*\[[^\]]*\])?>/g;

const properties = new Map<string, WebrefEntry>();
const types = new Map<string, string>();
const queue: { kind: 'property' | 'type'; name: string }[] = SUBSET.map((name) => ({ kind: 'property', name }));
while (queue.length > 0) {
  const next = queue.shift() as { kind: 'property' | 'type'; name: string };
  let syntax: string | undefined;
  if (next.kind === 'property') {
    if (properties.has(next.name)) continue;
    // webref lists some legacy properties without a syntax, and -webkit-box-direction not at all; SYNTAX_OVERRIDES supplies those.
    const p = propsByName.get(next.name) ?? (SYNTAX_OVERRIDES[next.name] === undefined ? undefined : { name: next.name });
    if (p === undefined || (p.syntax === undefined && SYNTAX_OVERRIDES[next.name] === undefined)) throw new Error(`webref has no syntax for property ${next.name}`);
    const extension = SYNTAX_EXTENSIONS[next.name];
    syntax = SYNTAX_OVERRIDES[next.name] ?? (extension === undefined ? (p.syntax as string) : `${p.syntax} | ${extension}`);
    properties.set(next.name, { ...p, syntax, ...FIELD_OVERRIDES[next.name] });
  } else {
    if (types.has(next.name) || CSS_TREE_GENERICS.has(next.name)) continue;
    const t = next.name.endsWith('()') ? functionsByName.get(next.name) : typesByName.get(next.name);
    if (t === undefined || t.syntax === undefined) continue; // css-tree generic (length, percentage, number, ...)
    types.set(next.name, t.syntax);
    syntax = t.syntax;
  }
  for (const m of syntax.matchAll(refPattern)) {
    if (m[1] !== undefined) queue.push({ kind: 'property', name: m[1] });
    else if (m[2] !== undefined) queue.push({ kind: 'type', name: m[2] });
  }
}

const sortedProps = [...properties.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const sortedTypes = [...types.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const lines: string[] = [];
lines.push('// Generated by scripts/gen-css-grammar.ts from @webref/css 8.7.5 (MIT). Do not edit; run pnpm run grammar:gen.');
lines.push('');
lines.push(`export const webrefVersion = ${JSON.stringify(webrefVersion)};`);
lines.push('');
lines.push('/** Longhands and shorthands the compiler reads, with their webref initial and inherited fields. */');
lines.push(`export const subset: readonly string[] = ${JSON.stringify([...SUBSET].sort())};`);
lines.push('');
lines.push('export type PropertyGrammar = { readonly syntax: string; readonly initial: string; readonly inherited: string };');
lines.push('');
lines.push('export const properties: { readonly [name: string]: PropertyGrammar } = {');
for (const [name, p] of sortedProps) {
  lines.push(`  ${JSON.stringify(name)}: { syntax: ${JSON.stringify(p.syntax)}, initial: ${JSON.stringify(p.initial ?? '')}, inherited: ${JSON.stringify(p.inherited ?? '')} },`);
}
lines.push('};');
lines.push('');
lines.push('export const types: { readonly [name: string]: string } = {');
for (const [name, syntax] of sortedTypes) lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(syntax)},`);
lines.push('};');
lines.push('');

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'dragon', 'src', 'css', 'grammar.generated.ts');
writeFileSync(out, lines.join('\n'));
console.log(`wrote ${sortedProps.length} properties and ${sortedTypes.length} types to ${out.slice(out.indexOf('packages/'))}`);
