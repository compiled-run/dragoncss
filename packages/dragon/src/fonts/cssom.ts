// Chrome 145's CSSOM text for @font-face descriptors (CSSFontFaceRule.style.getPropertyValue), used to prove the descriptor parser
// against Chrome: css_font_face_src_value.cc, css_unicode_range_value.cc, css_font_style_range_value.cc and number formatting.
import type { FontFaceDescriptors, DescriptorName, SrcEntry } from './font-face.ts';
import { serializeFamilyName, serializeString } from './family-list.ts';

/** String::Number(double): six significant digits, trailing zeros removed. */
export function formatNumber(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e6) return String(v);
  const p = v.toPrecision(6);
  if (p.includes('e')) {
    const [m, e] = p.split('e') as [string, string];
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    const exp = Number(e);
    return `${mant}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return p.includes('.') ? p.replace(/0+$/, '').replace(/\.$/, '') : p;
}

const hex = (n: number): string => n.toString(16).toUpperCase();

function src(e: SrcEntry): string {
  if (e.kind === 'local') return `local(${serializeString(e.name)})`;
  let out = `url(${serializeString(e.url)})`;
  if (e.format !== null) out += ` format(${serializeString(e.format)})`;
  if (e.tech.length > 0) out += ` tech(${e.tech.join(', ')})`;
  return out;
}

/** The CSSOM text of one declared descriptor, or '' when the rule has no valid value for it. */
export function descriptorText(d: FontFaceDescriptors, name: DescriptorName): string {
  switch (name) {
    case 'font-family': return d.family === undefined ? '' : serializeFamilyName(d.family);
    case 'src': return d.src === undefined ? '' : d.src.map(src).join(', ');
    case 'font-weight': {
      const w = d.weight;
      if (w === undefined) return '';
      return w.kind === 'numbers' ? w.values.map(formatNumber).join(' ') : w.kind;
    }
    case 'font-style': {
      const s = d.style;
      if (s === undefined) return '';
      return s.kind === 'oblique-angles' ? `oblique ${s.angles.map((a) => `${formatNumber(a.value)}${a.unit}`).join(' ')}` : s.kind;
    }
    case 'font-stretch': {
      const s = d.stretch;
      if (s === undefined) return '';
      return s.kind === 'keyword' ? s.value : s.values.map((v) => `${formatNumber(v)}%`).join(' ');
    }
    case 'unicode-range': return d.unicodeRange === undefined ? '' : d.unicodeRange.map((r) => (r.start === r.end ? `U+${hex(r.start)}` : `U+${hex(r.start)}-${hex(r.end)}`)).join(', ');
    case 'font-display': return d.display ?? '';
    case 'size-adjust': return d.sizeAdjust === undefined ? '' : `${formatNumber(d.sizeAdjust)}%`;
    case 'ascent-override': return override(d.ascentOverride);
    case 'descent-override': return override(d.descentOverride);
    case 'line-gap-override': return override(d.lineGapOverride);
    case 'font-feature-settings': return d.featureSettings ?? '';
    case 'font-variation-settings': return d.variationSettings ?? '';
  }
}

const override = (v: 'normal' | number | undefined): string => (v === undefined ? '' : v === 'normal' ? 'normal' : `${formatNumber(v)}%`);
