// Stage 3 of docs/api.md §4.1 for web: CSS emitted from the resolved result (stage 1), never from a backend lowering.
// One rule per element with every milestone longhand written, so the output does not depend on the UA stylesheet. The inset
// longhands are the one exception: they are written when any of them is not auto. Auto is their initial value and no Chrome UA
// rule sets them on a supported tag (ua.test.ts), so leaving them out gives the same computed values.
import type { ResolvedElement, ResolvedValue } from '../analysis/resolve.ts';
import { serializeColor } from '../css/color.ts';
import { LONGHANDS } from '../css/properties.ts';
import type { CssValue } from '../css/stylesheet.ts';
import type { GeneratedFile } from '../types.ts';

export type WebEmit = {
  readonly files: readonly GeneratedFile[];
  /** Per case key: element address to the class of its resolved variant; internal to the harness, never public. */
  readonly classOf: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

export const WEB_CSS_PATH = 'dragon.css';

/** CSS2 §9.3.2 box offsets, written only when one of them is not auto. */
export const INSET_LONGHANDS: readonly (typeof LONGHANDS)[number][] = ['top', 'right', 'bottom', 'left'];

function writesInsets(el: ResolvedElement): boolean {
  return INSET_LONGHANDS.some((p) => {
    const v = (el.props.get(p) as ResolvedValue).value;
    return !(v.kind === 'keyword' && v.value === 'auto');
  });
}

/** A CSS <number> without exponent notation, so every emitted value is valid CSS text. */
function cssNumber(n: number): string {
  const s = String(n === 0 ? 0 : n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (m === null) return s;
  const sign = m[1] as string;
  const frac = m[3] === undefined ? '' : m[3];
  const digits = `${m[2] as string}${frac}`;
  const exp = Number(m[4]);
  return exp < 0 ? `${sign}0.${'0'.repeat(-exp - 1)}${digits}` : `${sign}${digits}${'0'.repeat(exp - frac.length)}`;
}

// css-fonts-4 §2.1: a family name that is a valid identifier sequence and not a generic keyword can be written bare.
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'cursive', 'fantasy', 'monospace', 'system-ui', 'math', 'emoji', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default']);

function familyName(name: string): string {
  if (/^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(name) && !GENERIC_FAMILIES.has(name.toLowerCase())) return name;
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function valueText(v: CssValue): string {
  switch (v.kind) {
    case 'keyword':
      return v.value;
    case 'family':
      return familyName(v.value);
    case 'length':
      return `${cssNumber(v.value)}${v.unit}`;
    case 'percentage':
      return `${cssNumber(v.value)}%`;
    case 'number':
      return cssNumber(v.value);
    case 'color':
      return serializeColor(v.value);
    case 'other':
      return v.text;
  }
}

type WebCase = { readonly key: string; readonly root: ResolvedElement };

/** One band after the first (MQ-a): its condition text and every case resolved in it. */
export type WebBand = { readonly condition: string; readonly cases: readonly WebCase[] };

const declLine = (el: ResolvedElement, p: (typeof LONGHANDS)[number]): string => `  ${p}: ${valueText((el.props.get(p) as ResolvedValue).value)};`;

function byAddress(root: ResolvedElement): Map<string, ResolvedElement> {
  const out = new Map<string, ResolvedElement>();
  const visit = (el: ResolvedElement): void => {
    out.set(el.element.address, el);
    for (const ch of el.children) if (ch.kind === 'element') visit(ch);
  };
  visit(root);
  return out;
}

/**
 * One class per resolved variant: an element address gets a new class for each distinct resolved style across the cases.
 * Deterministic: classes are numbered in case order, then element preorder; declarations follow LONGHANDS order. cases are
 * resolved in the first band; each later band gets one @media block with the declarations that differ from it, per class.
 */
export function emitWebCss(cases: readonly WebCase[], digest: string, bands: readonly WebBand[] = []): WebEmit {
  const classOf = new Map<string, Map<string, string>>();
  const variants = new Map<string, string>();
  const rules: string[] = [];
  const bandRules: string[][] = bands.map(() => []);
  for (const c of cases) {
    const map = new Map<string, string>();
    classOf.set(c.key, map);
    const inBands = bands.map((b) => {
      const other = b.cases.find((x) => x.key === c.key);
      if (other === undefined) throw new Error(`case ${c.key} is not resolved in the band ${b.condition}`);
      return byAddress(other.root);
    });
    const visit = (el: ResolvedElement): void => {
      const insets = writesInsets(el);
      const decls = LONGHANDS.filter((p) => insets || !INSET_LONGHANDS.includes(p)).map((p) => declLine(el, p));
      // Every longhand whose value in the band differs from the first band's (an inset left out there is auto, its value).
      const diffs = inBands.map((m) => {
        const other = m.get(el.element.address);
        if (other === undefined) throw new Error(`${el.element.address} is not resolved in every band`);
        return LONGHANDS.map((p) => declLine(other, p)).filter((line, k) => line !== declLine(el, LONGHANDS[k] as (typeof LONGHANDS)[number]));
      });
      const variant = `${el.element.address}\u0000${decls.join('\n')}${diffs.some((d) => d.length > 0) ? `\u0000${JSON.stringify(diffs)}` : ''}`;
      let cls = variants.get(variant);
      if (cls === undefined) {
        cls = `dg${variants.size}`;
        variants.set(variant, cls);
        rules.push(`.${cls} {\n${decls.join('\n')}\n}`);
        diffs.forEach((d, k) => {
          if (d.length > 0) (bandRules[k] as string[]).push(`.${cls} {\n${d.join('\n')}\n}`);
        });
      }
      map.set(el.element.address, cls);
      for (const ch of el.children) if (ch.kind === 'element') visit(ch);
    };
    visit(c.root);
  }
  const blocks = bands.flatMap((b, k) => ((bandRules[k] as string[]).length === 0 ? [] : [`@media ${b.condition} {\n${(bandRules[k] as string[]).join('\n')}\n}`]));
  const text = `/* Generated by Dragon from compilation ${digest}. Do not edit. */\n${[...rules, ...blocks].join('\n')}\n`;
  return { files: [{ path: WEB_CSS_PATH, text }], classOf };
}
