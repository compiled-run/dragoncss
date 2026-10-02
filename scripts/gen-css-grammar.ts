// Generates packages/dragon/src/css/grammar.generated.ts from @webref/css (pinned), for the milestone property subset.
// Run with: pnpm run grammar:gen
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRID_LONGHANDS, GRID_SHORTHANDS } from '../packages/dragon/src/css/properties/grid.ts';
import { LOGICAL_SHORTHANDS } from '../packages/dragon/src/css/properties/logical.ts';
import { WRITING_MODE_SHORTHANDS } from '../packages/dragon/src/css/properties/writing-mode.ts';

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
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'flex', 'flex-flow', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'justify-content', 'align-items', 'align-self', 'align-content', 'gap', 'row-gap', 'column-gap',
  'font', 'font-size', 'font-family', 'font-weight', 'font-style', 'font-synthesis', 'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', 'text-decoration', 'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset', 'text-underline-position', 'text-decoration-skip-ink', 'line-height', 'text-align', 'white-space', 'white-space-collapse', 'text-wrap-mode', 'color', 'background', 'background-color',
  ...LOGICAL_SHORTHANDS,
  ...WRITING_MODE_SHORTHANDS,

  // Grid (css-grid-2), after the writing-mode family.
  ...GRID_LONGHANDS, ...GRID_SHORTHANDS,

  // TXT2-a (css-text-3 §5.2, §5.5, §8.2), after the grid family.
  'overflow-wrap', 'word-break', 'letter-spacing',

  // INL2b (CSS2 §10.8.1), after the TXT2-a family.
  'vertical-align',
] as const;

/**
 * Values a browser that supports SVG must also accept, which webref's syntax omits: css-writing-modes-4 Appendix B, the SVG 1.1
 * writing-mode values (lr, lr-tb, rl and rl-tb compute to horizontal-tb; tb and tb-rl to vertical-rl). Chrome 145 parses all six.
 */
const SYNTAX_EXTENSIONS: { readonly [property: string]: string } = {
  'writing-mode': 'lr | lr-tb | rl | rl-tb | tb | tb-rl',
};

/**
 * Syntaxes that replace webref's, where Chrome 145 parses a property by an older grammar than the one webref publishes. Unlike
 * SYNTAX_EXTENSIONS, which add alternatives, an override is the whole syntax; the initial and inherited fields stay webref's.
 * - vertical-align: webref gives css-inline-3's shorthand ([ first | last ] || <'alignment-baseline'> || <'baseline-shift'>), which
 *   Chrome 145 does not parse. Blink 145.0.7632.6 VerticalAlign::ParseSingleValue (core/css/properties/longhands/
 *   longhands_custom.cc:10742-10753) consumes one keyword of the range kBaseline to kWebkitBaselineMiddle (core/css/
 *   css_value_keywords.json5:468-477: baseline, middle, sub, super, text-top, text-bottom, top, bottom, -webkit-baseline-middle)
 *   or one <length-percentage> (the unitless quirk applies in quirks mode only). It is a longhand, initial baseline, not inherited.
 */
const SYNTAX_OVERRIDES: { readonly [property: string]: string } = {
  'vertical-align': 'baseline | sub | super | text-top | text-bottom | middle | top | bottom | -webkit-baseline-middle | <length-percentage>',
};

const propsByName = new Map(css.properties.map((p) => [p.name, p]));
const typesByName = new Map(css.types.map((t) => [t.name, t]));
// Functional notations such as <rgb()> are listed under webref's functions, keyed with their parentheses.
const functionsByName = new Map(css.functions.map((f) => [f.name, f]));
// css-tree matches url tokens with its own <url> generic; webref's token-level definition cannot match css-tree's Url node.
const CSS_TREE_GENERICS = new Set(['url']);
const refPattern = /<'([^']+)'>|<([a-zA-Z0-9-]+(?:\(\))?)(?:\s*\[[^\]]*\])?>/g;

const properties = new Map<string, WebrefEntry>();
const types = new Map<string, string>();
const queue: { kind: 'property' | 'type'; name: string }[] = SUBSET.map((name) => ({ kind: 'property', name }));
while (queue.length > 0) {
  const next = queue.shift() as { kind: 'property' | 'type'; name: string };
  let syntax: string | undefined;
  if (next.kind === 'property') {
    if (properties.has(next.name)) continue;
    const p = propsByName.get(next.name);
    if (p === undefined || p.syntax === undefined) throw new Error(`webref has no syntax for property ${next.name}`);
    const extension = SYNTAX_EXTENSIONS[next.name];
    const override = SYNTAX_OVERRIDES[next.name];
    if (override !== undefined && extension !== undefined) throw new Error(`${next.name} has both a syntax override and an extension`);
    syntax = override !== undefined ? override : extension === undefined ? p.syntax : `${p.syntax} | ${extension}`;
    properties.set(next.name, { ...p, syntax });
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
lines.push('/** The properties whose syntax replaces webref\'s (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES, each with its Blink citation). */');
lines.push(`export const syntaxOverrides: readonly string[] = ${JSON.stringify(Object.keys(SYNTAX_OVERRIDES).sort())};`);
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
