// css-text-decor-4 §2.6: text-decoration is <'text-decoration-line'> || <'text-decoration-thickness'> || <'text-decoration-style'> ||
// <'text-decoration-color'>, as Chrome 145 expands it (css_properties.json5:9076); an omitted longhand takes its initial value. The
// values TDEC-a does not draw are refused as their longhands refuse them (css/values.ts textDecorationValue).
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { CssValue } from '../values.ts';
import { kw, textDecorationValue } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit, implicit } from './shared.ts';

const LINES: ReadonlySet<string> = new Set(['none', 'underline', 'overline', 'line-through', 'blink', 'spelling-error', 'grammar-error']);
const STYLES: ReadonlySet<string> = new Set(['solid', 'double', 'dotted', 'dashed', 'wavy']);
const THICKNESS: ReadonlySet<string> = new Set(['auto', 'from-font', 'thin', 'medium', 'thick']);

type Role = 'line' | 'style' | 'thickness' | 'color';

const ident = (n: CssNode): string | null => (n.type === 'Identifier' ? asciiLower(String(n['name'])) : null);

/** The role of one token of a grammar-valid value. */
function roleOf(t: CssNode): Role {
  const k = ident(t);
  if (k !== null && LINES.has(k)) return 'line';
  if (k !== null && STYLES.has(k)) return 'style';
  if (k !== null && THICKNESS.has(k)) return 'thickness';
  if (t.type === 'Dimension' || t.type === 'Percentage' || t.type === 'Number' || (t.type === 'Function' && ['calc', 'min', 'max', 'clamp'].includes(asciiLower(String(t['name']))))) return 'thickness';
  return 'color';
}

const textDecoration: ShorthandHandler = {
  longhands: ['text-decoration-line', 'text-decoration-thickness', 'text-decoration-style', 'text-decoration-color'],
  refuse: (tokens, base) => {
    const by = (r: Role): CssNode[] => tokens.filter((t) => roleOf(t) === r);
    for (const [property, group] of [['text-decoration-line', by('line')], ['text-decoration-style', by('style')], ['text-decoration-thickness', by('thickness')]] as const) {
      if (group.length === 0) continue;
      const ruled = textDecorationValue(property, group);
      if (ruled === undefined || ruled === null || 'kind' in ruled) continue;
      const at = group[group.length - 1] as CssNode;
      return 'invalid' in ruled
        ? diagnostic('DRAGON_CSS_INVALID_VALUE', { origin: authored(spanOf(at, base)), message: `text-decoration: ${ruled.invalid}`, manual: 'Write a length, a percentage or auto for the thickness.' })
        : diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(at, base)), message: `text-decoration: ${ruled.refused}`, manual: 'Use solid underline, overline or line-through lines with a length, percentage or auto thickness.' });
    }
    return null;
  },
  expand: (values, tokens) => {
    const roles = tokens.map(roleOf);
    const of = (r: Role): CssValue[] => values.filter((_, i) => roles[i] === r);
    const lines = tokens.filter((_, i) => roles[i] === 'line');
    const line = lines.length === 0 ? null : lines.length === 1 ? (of('line')[0] as CssValue) : (textDecorationValue('text-decoration-line', lines) as CssValue);
    const [thickness] = of('thickness');
    const [style] = of('style');
    const [color] = of('color');
    return [
      line === null ? implicit('text-decoration-line', kw('none')) : explicit('text-decoration-line', line),
      thickness === undefined ? implicit('text-decoration-thickness', kw('auto')) : explicit('text-decoration-thickness', thickness),
      style === undefined ? implicit('text-decoration-style', kw('solid')) : explicit('text-decoration-style', style),
      color === undefined ? implicit('text-decoration-color', kw('currentcolor')) : explicit('text-decoration-color', color),
    ];
  },
};

export const TEXT_DECORATION_SHORTHANDS = {
  'text-decoration': textDecoration,
} as const satisfies { readonly [s: string]: ShorthandHandler };
