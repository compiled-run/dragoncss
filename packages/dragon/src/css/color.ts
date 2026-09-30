// Colour resolution for the milestone subset (css-color-4). This is the only file in the core that converts or rounds colours.
// Chrome 145 keeps legacy sRGB colours (named, hex, rgb(), hsl()) as 8-bit channels; each rule below was measured against it.
import type { CssNode, List } from 'css-tree';
import { asciiLower } from './escapes.ts';

/** 8-bit sRGB channels and alpha, each an integer in [0, 255], as Chrome stores legacy colours. */
export type Rgba8 = { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number };

/** The authored notation, which names the support-profile feature. */
export type ColorSyntax = 'hex-color' | 'named-color' | 'rgb()' | 'rgba()' | 'hsl()' | 'hsla()';

export type ColorParse =
  | { readonly ok: true; readonly kind: 'rgba'; readonly value: Rgba8; readonly syntax: ColorSyntax }
  | { readonly ok: true; readonly kind: 'keyword'; readonly keyword: 'transparent' | 'currentcolor' }
  | { readonly ok: false; readonly reason: string };

// css-color-4 §6.1 named colours.
const NAMED: { readonly [name: string]: number } = {
  aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff, aquamarine: 0x7fffd4, azure: 0xf0ffff, beige: 0xf5f5dc,
  bisque: 0xffe4c4, black: 0x000000, blanchedalmond: 0xffebcd, blue: 0x0000ff, blueviolet: 0x8a2be2, brown: 0xa52a2a,
  burlywood: 0xdeb887, cadetblue: 0x5f9ea0, chartreuse: 0x7fff00, chocolate: 0xd2691e, coral: 0xff7f50,
  cornflowerblue: 0x6495ed, cornsilk: 0xfff8dc, crimson: 0xdc143c, cyan: 0x00ffff, darkblue: 0x00008b, darkcyan: 0x008b8b,
  darkgoldenrod: 0xb8860b, darkgray: 0xa9a9a9, darkgreen: 0x006400, darkgrey: 0xa9a9a9, darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b, darkolivegreen: 0x556b2f, darkorange: 0xff8c00, darkorchid: 0x9932cc, darkred: 0x8b0000,
  darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f, darkslateblue: 0x483d8b, darkslategray: 0x2f4f4f, darkslategrey: 0x2f4f4f,
  darkturquoise: 0x00ced1, darkviolet: 0x9400d3, deeppink: 0xff1493, deepskyblue: 0x00bfff, dimgray: 0x696969,
  dimgrey: 0x696969, dodgerblue: 0x1e90ff, firebrick: 0xb22222, floralwhite: 0xfffaf0, forestgreen: 0x228b22,
  fuchsia: 0xff00ff, gainsboro: 0xdcdcdc, ghostwhite: 0xf8f8ff, gold: 0xffd700, goldenrod: 0xdaa520, gray: 0x808080,
  green: 0x008000, greenyellow: 0xadff2f, grey: 0x808080, honeydew: 0xf0fff0, hotpink: 0xff69b4, indianred: 0xcd5c5c,
  indigo: 0x4b0082, ivory: 0xfffff0, khaki: 0xf0e68c, lavender: 0xe6e6fa, lavenderblush: 0xfff0f5, lawngreen: 0x7cfc00,
  lemonchiffon: 0xfffacd, lightblue: 0xadd8e6, lightcoral: 0xf08080, lightcyan: 0xe0ffff, lightgoldenrodyellow: 0xfafad2,
  lightgray: 0xd3d3d3, lightgreen: 0x90ee90, lightgrey: 0xd3d3d3, lightpink: 0xffb6c1, lightsalmon: 0xffa07a,
  lightseagreen: 0x20b2aa, lightskyblue: 0x87cefa, lightslategray: 0x778899, lightslategrey: 0x778899,
  lightsteelblue: 0xb0c4de, lightyellow: 0xffffe0, lime: 0x00ff00, limegreen: 0x32cd32, linen: 0xfaf0e6, magenta: 0xff00ff,
  maroon: 0x800000, mediumaquamarine: 0x66cdaa, mediumblue: 0x0000cd, mediumorchid: 0xba55d3, mediumpurple: 0x9370db,
  mediumseagreen: 0x3cb371, mediumslateblue: 0x7b68ee, mediumspringgreen: 0x00fa9a, mediumturquoise: 0x48d1cc,
  mediumvioletred: 0xc71585, midnightblue: 0x191970, mintcream: 0xf5fffa, mistyrose: 0xffe4e1, moccasin: 0xffe4b5,
  navajowhite: 0xffdead, navy: 0x000080, oldlace: 0xfdf5e6, olive: 0x808000, olivedrab: 0x6b8e23, orange: 0xffa500,
  orangered: 0xff4500, orchid: 0xda70d6, palegoldenrod: 0xeee8aa, palegreen: 0x98fb98, paleturquoise: 0xafeeee,
  palevioletred: 0xdb7093, papayawhip: 0xffefd5, peachpuff: 0xffdab9, peru: 0xcd853f, pink: 0xffc0cb, plum: 0xdda0dd,
  powderblue: 0xb0e0e6, purple: 0x800080, rebeccapurple: 0x663399, red: 0xff0000, rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1, saddlebrown: 0x8b4513, salmon: 0xfa8072, sandybrown: 0xf4a460, seagreen: 0x2e8b57,
  seashell: 0xfff5ee, sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb, slateblue: 0x6a5acd, slategray: 0x708090,
  slategrey: 0x708090, snow: 0xfffafa, springgreen: 0x00ff7f, steelblue: 0x4682b4, tan: 0xd2b48c, teal: 0x008080,
  thistle: 0xd8bfd8, tomato: 0xff6347, turquoise: 0x40e0d0, violet: 0xee82ee, wheat: 0xf5deb3, white: 0xffffff,
  whitesmoke: 0xf5f5f5, yellow: 0xffff00, yellowgreen: 0x9acd32,
};

export const NAMED_COLORS: readonly string[] = Object.keys(NAMED);

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Blink lround over a clamped channel: halves away from zero (measured: rgb(10.5 0 0) is 11). */
function round8(v: number): number {
  return clamp(Math.round(clamp(v, 0, 255)), 0, 255);
}

function list(node: CssNode, key: string): CssNode[] {
  const v = node[key] as List<CssNode> | null | undefined;
  return v === null || v === undefined ? [] : v.toArray();
}

type Arg =
  | { readonly t: 'number'; readonly v: number }
  | { readonly t: 'percent'; readonly v: number }
  | { readonly t: 'angle'; readonly v: number; readonly unit: string }
  | { readonly t: 'none' }
  | { readonly t: 'comma' }
  | { readonly t: 'slash' };

function args(fn: CssNode): Arg[] | string {
  const out: Arg[] = [];
  for (const c of list(fn, 'children')) {
    if (c.type === 'WhiteSpace') continue;
    if (c.type === 'Number') out.push({ t: 'number', v: Number(c['value']) });
    else if (c.type === 'Percentage') out.push({ t: 'percent', v: Number(c['value']) });
    else if (c.type === 'Dimension') out.push({ t: 'angle', v: Number(c['value']), unit: asciiLower(String(c['unit'])) });
    else if (c.type === 'Identifier' && asciiLower(String(c['name'])) === 'none') out.push({ t: 'none' });
    else if (c.type === 'Operator' && c['value'] === ',') out.push({ t: 'comma' });
    else if (c.type === 'Operator' && c['value'] === '/') out.push({ t: 'slash' });
    else return `unsupported token ${c.type} in a colour function`;
  }
  return out;
}

/** Splits legacy (comma) or modern (space, optional "/ alpha") arguments into channels and an optional alpha. */
function channelsOf(all: Arg[]): { readonly channels: readonly Arg[]; readonly alpha: Arg | null } | string {
  if (all.some((a) => a.t === 'comma')) {
    const values = all.filter((a) => a.t !== 'comma');
    if (all.some((a) => a.t === 'slash' || a.t === 'none')) return 'mixed legacy and modern colour syntax';
    return { channels: values.slice(0, 3), alpha: values[3] === undefined ? null : values[3] };
  }
  const slash = all.findIndex((a) => a.t === 'slash');
  if (slash < 0) return { channels: all, alpha: null };
  const alpha = all[slash + 1];
  return { channels: all.slice(0, slash), alpha: alpha === undefined ? null : alpha };
}

// css-color-4 §5.2: <alpha-value> clamps to [0, 1]; Blink stores round(alpha * 255) (measured on 1001 steps each of number and %).
function alpha8(a: Arg | null): number | string {
  if (a === null) return 255;
  if (a.t === 'none') return 0;
  if (a.t === 'number') return round8(clamp(a.v, 0, 1) * 255);
  if (a.t === 'percent') return round8(clamp(a.v / 100, 0, 1) * 255);
  return 'alpha must be a number or percentage';
}

// css-color-4 §5.1 rgb(): numbers are 0-255 channels, percentages scale 255; none is 0. Measured on 1001 % steps and 511 numbers.
function rgbChannel(a: Arg): number | string {
  if (a.t === 'none') return 0;
  if (a.t === 'number') return round8(a.v);
  if (a.t === 'percent') return round8((a.v / 100) * 255);
  return 'rgb() channels are numbers or percentages';
}

// css-values-4 §7.1 <angle> to degrees.
function hueDegrees(a: Arg): number | string {
  if (a.t === 'none') return 0;
  if (a.t === 'number') return a.v;
  if (a.t !== 'angle') return 'hue must be a number or angle';
  if (a.unit === 'deg') return a.v;
  if (a.unit === 'turn') return a.v * 360;
  if (a.unit === 'grad') return (a.v * 360) / 400;
  if (a.unit === 'rad') return (a.v * 180) / Math.PI;
  return `unknown angle unit ${a.unit}`;
}

/**
 * css-color-4 §7.1 hslToRgb as Chromium gfx::HSLToSRGB computes it in float, then Blink's legacy serialization
 * (Color::SerializeLegacyColorAsCSSColor) adds 1e-7f before lround(x * 255). Matched Chrome 145 on 4080 sampled hsl() values.
 */
function hslTo8(hDeg: number, sPct: number, lPct: number): [number, number, number] {
  const f = Math.fround;
  const h = f(((f(hDeg) % 360) + 360) % 360);
  const s = f(clamp(sPct, 0, 100) / 100);
  const l = f(clamp(lPct, 0, 100) / 100);
  const channel = (n: number): number => {
    if (s === 0) return l;
    const k = f(f(n + f(h / 30)) % 12);
    const a = f(s * Math.min(l, f(1 - l)));
    return f(l - f(a * Math.max(-1, Math.min(f(k - 3), f(9 - k), 1))));
  };
  const to8 = (x: number): number => round8(f(f(x + f(1e-7)) * 255));
  return [to8(channel(0)), to8(channel(8)), to8(channel(4))];
}

function pctOrNumber(a: Arg): number | string {
  if (a.t === 'none') return 0;
  if (a.t === 'percent' || a.t === 'number') return a.v;
  return 'hsl() saturation and lightness are percentages or numbers';
}

function fromFunction(fn: CssNode): ColorParse {
  const name = asciiLower(String(fn['name']));
  if (name !== 'rgb' && name !== 'rgba' && name !== 'hsl' && name !== 'hsla') {
    return { ok: false, reason: `${name}() colours are not supported in milestone 1` };
  }
  const all = args(fn);
  if (typeof all === 'string') return { ok: false, reason: all };
  const split = channelsOf(all);
  if (typeof split === 'string') return { ok: false, reason: split };
  if (split.channels.length !== 3) return { ok: false, reason: `${name}() needs three channels` };
  const a = alpha8(split.alpha);
  if (typeof a === 'string') return { ok: false, reason: a };
  const [c0, c1, c2] = split.channels as [Arg, Arg, Arg];
  if (name === 'rgb' || name === 'rgba') {
    const r = rgbChannel(c0);
    const g = rgbChannel(c1);
    const b = rgbChannel(c2);
    if (typeof r === 'string') return { ok: false, reason: r };
    if (typeof g === 'string') return { ok: false, reason: g };
    if (typeof b === 'string') return { ok: false, reason: b };
    return { ok: true, kind: 'rgba', value: { r, g, b, alpha: a }, syntax: name === 'rgb' ? 'rgb()' : 'rgba()' };
  }
  const h = hueDegrees(c0);
  const s = pctOrNumber(c1);
  const l = pctOrNumber(c2);
  if (typeof h === 'string') return { ok: false, reason: h };
  if (typeof s === 'string') return { ok: false, reason: s };
  if (typeof l === 'string') return { ok: false, reason: l };
  const [r, g, b] = hslTo8(h, s, l);
  return { ok: true, kind: 'rgba', value: { r, g, b, alpha: a }, syntax: name === 'hsl' ? 'hsl()' : 'hsla()' };
}

// css-color-4 §5.2 <hex-color>: 3, 4, 6 or 8 digits; short forms repeat each digit.
function fromHex(hex: string): ColorParse {
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return { ok: false, reason: `#${hex} is not a hex colour` };
  const full = hex.length <= 4 ? Array.from(hex, (c) => c + c).join('') : hex;
  const byte = (i: number): number => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16);
  return { ok: true, kind: 'rgba', value: { r: byte(0), g: byte(1), b: byte(2), alpha: full.length === 8 ? byte(3) : 255 }, syntax: 'hex-color' };
}

/** Resolves one parsed <color> component value; anything outside the milestone subset is refused with a reason. */
export function parseColorNode(node: CssNode): ColorParse {
  if (node.type === 'Hash') return fromHex(String(node['value']));
  if (node.type === 'Function') return fromFunction(node);
  if (node.type === 'Identifier') {
    const name = asciiLower(String(node['name']));
    if (name === 'transparent' || name === 'currentcolor') return { ok: true, kind: 'keyword', keyword: name };
    const hex = NAMED[name];
    if (hex !== undefined) return { ok: true, kind: 'rgba', value: { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255, alpha: 255 }, syntax: 'named-color' };
    return { ok: false, reason: `the colour keyword ${name} is not supported in milestone 1 (system colours depend on the platform)` };
  }
  return { ok: false, reason: `${node.type} is not a supported colour` };
}

export const TRANSPARENT: Rgba8 = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * CSSOM §6.7.2 serialization of an 8-bit alpha, as Blink does it: two decimals when they round-trip to the same byte, else three.
 */
export function serializeAlpha(alpha: number): string {
  if (alpha === 255) return '1';
  const a = alpha / 255;
  const two = Math.round(a * 100) / 100;
  if (Math.round(two * 255) === alpha) return String(two);
  return String(Math.round(a * 1000) / 1000);
}

/** The CSSOM serialization Chrome reports for a legacy sRGB colour: rgb(r, g, b) or rgba(r, g, b, a). */
export function serializeColor(c: Rgba8): string {
  return c.alpha === 255 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${serializeAlpha(c.alpha)})`;
}

/** Parses Chrome's computed colour string back into channels; null for anything else. */
export function parseComputedColor(text: string): Rgba8 | null {
  const m = /^rgba?\((\d{1,3}), (\d{1,3}), (\d{1,3})(?:, (0|1|0?\.\d+))?\)$/.exec(text);
  if (m === null) return null;
  const alphaText = m[4];
  const alpha = alphaText === undefined ? 255 : Math.round(Number(alphaText) * 255);
  if (alphaText !== undefined && serializeAlpha(alpha) !== alphaText) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), alpha };
}

/** The colour-only planted fault: moves every red channel by one step without touching anything else. */
export function perturbColor(c: Rgba8): Rgba8 {
  return { r: c.r === 255 ? 254 : c.r + 1, g: c.g, b: c.b, alpha: c.alpha };
}
