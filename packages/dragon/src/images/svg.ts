// An SVG file's natural dimensions, as Chrome takes them for an <img>: the root <svg>'s width and height, one of them with the
// viewBox ratio giving the other, only the ratio, only one size, or none.
import type { NaturalSizeValue } from '@dragon/layout';
import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import type { NaturalSize } from './natural-size.ts';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const UTF8 = new (globalThis as unknown as { TextDecoder: new () => { decode(bytes: Uint8Array): string } }).TextDecoder();

export type SvgSizing = { readonly ok: true; readonly natural: NaturalSizeValue } | { readonly ok: false; readonly reason: string };

/** The natural size when the file gives both dimensions; null when it gives less. */
export const svgSize = (sizing: SvgSizing): NaturalSize | null => (sizing.ok && sizing.natural.kind === 'image' ? { width: sizing.natural.width, height: sizing.natural.height } : null);

type Length = { readonly kind: 'px'; readonly value: number } | { readonly kind: 'auto' } | { readonly kind: 'refused'; readonly reason: string };

/** A root width or height: a px or unitless number; a percentage, auto, a missing or invalid value gives no natural size. */
function lengthOf(name: string, raw: string | null): Length {
  if (raw === null) return { kind: 'auto' };
  const text = raw.trim();
  if (text === '' || text === 'auto' || text.endsWith('%')) return { kind: 'auto' };
  const number = text.endsWith('px') ? text.slice(0, -2) : text;
  const value = Number(number);
  if (number === '' || !Number.isFinite(value)) return { kind: 'refused', reason: `the root <svg> ${name}="${raw}" is not a px length` };
  if (value < 0) return { kind: 'auto' };
  if (value === 0) return { kind: 'refused', reason: `the root <svg> ${name} is 0, an empty natural size` };
  return { kind: 'px', value };
}

/** The viewBox size; null for a missing or invalid viewBox, or one with a non-positive size. */
function viewBoxSize(raw: string | null): NaturalSize | null {
  if (raw === null) return null;
  const parts = raw.trim().split(/[\s,]+/u).map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return null;
  const [, , width, height] = parts as [number, number, number, number];
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The natural dimensions of an SVG file's bytes. */
export function svgSizing(bytes: Uint8Array): SvgSizing {
  let root: Element | null;
  try {
    const parser = new DOMParser({
      onError: (level) => {
        if (level !== 'warning') throw new Error('not well-formed');
      },
    });
    root = parser.parseFromString(UTF8.decode(bytes), 'application/xml').documentElement as Element | null;
  } catch {
    return { ok: false, reason: 'the SVG file is not well-formed XML' };
  }
  if (root === null || root.namespaceURI !== SVG_NAMESPACE || root.localName !== 'svg') return { ok: false, reason: 'the SVG file has no root <svg> element in the SVG namespace' };
  const width = lengthOf('width', root.getAttribute('width'));
  const height = lengthOf('height', root.getAttribute('height'));
  if (width.kind === 'refused') return { ok: false, reason: width.reason };
  if (height.kind === 'refused') return { ok: false, reason: height.reason };
  const box = viewBoxSize(root.getAttribute('viewBox'));
  const natural = (n: NaturalSizeValue): SvgSizing => ({ ok: true, natural: n });
  if (width.kind === 'px' && height.kind === 'px') return natural({ kind: 'image', width: width.value, height: height.value });
  if (width.kind === 'px') return natural(box === null ? { kind: 'width', width: width.value } : { kind: 'image', width: width.value, height: (width.value * box.height) / box.width });
  if (height.kind === 'px') return natural(box === null ? { kind: 'height', height: height.value } : { kind: 'image', width: (height.value * box.width) / box.height, height: height.value });
  return natural(box === null ? { kind: 'none' } : { kind: 'ratio', ratioWidth: box.width, ratioHeight: box.height });
}
