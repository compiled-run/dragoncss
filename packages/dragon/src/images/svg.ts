// An SVG file's natural size, as Chrome takes it for an <img>: the root <svg>'s width and height, one of them with the viewBox
// ratio giving the other. Dragon's layout takes a natural size with both dimensions, so a file with only a ratio, or one size and
// no ratio, is refused rather than laid out as a different box.
import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import type { NaturalSize } from './natural-size.ts';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const UTF8 = new (globalThis as unknown as { TextDecoder: new () => { decode(bytes: Uint8Array): string } }).TextDecoder();

export type SvgSizing = { readonly ok: true; readonly size: NaturalSize } | { readonly ok: false; readonly reason: string };

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

/** The viewBox ratio (width over height); null for a missing or invalid viewBox, or one with a non-positive size. */
function viewBoxRatio(raw: string | null): number | null {
  if (raw === null) return null;
  const parts = raw.trim().split(/[\s,]+/u).map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return null;
  const [, , w, h] = parts as [number, number, number, number];
  return w > 0 && h > 0 ? w / h : null;
}

/** The natural size of an SVG file's bytes. */
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
  const ratio = viewBoxRatio(root.getAttribute('viewBox'));
  if (width.kind === 'px' && height.kind === 'px') return { ok: true, size: { width: width.value, height: height.value } };
  if (width.kind === 'px' && ratio !== null) return { ok: true, size: { width: width.value, height: width.value / ratio } };
  if (height.kind === 'px' && ratio !== null) return { ok: true, size: { width: height.value * ratio, height: height.value } };
  if (width.kind === 'px' || height.kind === 'px') return { ok: false, reason: 'the root <svg> gives one size and no viewBox, so the other dimension is the default object size with no ratio, which Dragon does not lay out' };
  return { ok: false, reason: ratio === null ? 'the root <svg> gives no width, height or viewBox, so the image has no natural size, which Dragon does not lay out' : 'the root <svg> gives a viewBox but no width or height, so the image has only a natural ratio, which Dragon does not lay out' };
}
