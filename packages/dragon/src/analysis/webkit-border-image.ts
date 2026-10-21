// MISC-PAINT part 2: -webkit-border-image as Chrome 145 applies it. It is no shorthand there but a legacy overlapping longhand
// (css_properties.json5 legacy_overlapping) that sets the whole border image at once (longhands_custom.cc
// WebkitBorderImage::ApplyValue), parsed as border-image is with a slice filled by default (css/properties/border-image.ts).
// style_cascade.cc StyleCascade::ApplyWideOverlapping applies the highest-priority one first and then each border-image-* longhand
// that outranks it, which is the shorthand reading Dragon's cascade gives it. Its side effect is the border widths:
// css_to_style_map.cc CSSToStyleMap::MapNinePieceImage sets border-<side>-width from each width part that is a fixed length, and
// since the border widths are not among the properties ApplyWideOverlapping skips, any border-<side>-width declaration (author,
// user agent or presentational hint, whatever its priority) is applied after it and wins. Probed against Chrome 145 (the
// border-image-webkit fixture): `border: 2px solid; -webkit-border-image: ... / 8px` keeps 2px in either order of priority, and a
// width under one device px is floored to 0 where a declared border width is at least one device px.
import type { ExtentSide } from '../css/properties/border-image.ts';
import { widthSidesOf } from '../css/properties/border-image.ts';
import type { Longhand } from '../css/properties.ts';
import type { Declaration } from '../css/stylesheet.ts';
import type { CssValue } from '../css/values.ts';
import type { ResolvedValue } from './computed.ts';

const WIDTHS = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'] as const;

/** Every -webkit-border-image declaration that matched the element, winning or losing (each sets border-image-source). */
export function webkitBorderImageDeclarations(props: ReadonlyMap<Longhand, ResolvedValue>): readonly Declaration[] {
  const v = props.get('border-image-source');
  if (v === undefined) return [];
  return [...(v.declaration === null ? [] : [v.declaration]), ...v.losing].filter((d) => d.property === '-webkit-border-image');
}

/**
 * The border widths one -webkit-border-image declaration sets, top, right, bottom, left: a px length per side that sets it, null
 * per side that does not (a number, percentage or auto width, a value with no width, none or a CSS-wide keyword); a string where
 * Dragon cannot read it (a var() value, a length in another unit, a width outside the grammar).
 */
export function webkitWidths(d: Declaration): readonly (number | null)[] | string {
  if (d.pending !== undefined) return 'its value holds var(), so Dragon cannot read the border widths it sets';
  const w = d.longhands.find((l) => l.property === 'border-image-width');
  const source = d.longhands.find((l) => l.property === 'border-image-source');
  // none and the CSS-wide keywords set the initial or inherited border image and no border width (MapNinePieceImage reads a list).
  if (source !== undefined && source.value.kind === 'keyword') return [null, null, null, null];
  if (w === undefined) return [null, null, null, null];
  const sides = widthSidesOf(w.value as CssValue);
  if (sides === null) return 'its border image width is outside the grammar Dragon reads';
  const out: (number | null)[] = [];
  for (const s of sides as readonly ExtentSide[]) {
    if (s.unit !== 'length') out.push(null);
    else if (s.lengthUnit !== 'px') return `its border image width in ${s.lengthUnit} sets a border width Dragon does not compute`;
    else out.push(s.value);
  }
  return out;
}

/**
 * The border widths the element's -webkit-border-image declarations set, before any declared border width wins: per side the px
 * width or null; a string where Dragon cannot tell which declaration Chrome applies (two that set different widths) or cannot read one.
 */
export function webkitDeclaredWidths(props: ReadonlyMap<Longhand, ResolvedValue>): readonly (number | null)[] | string {
  const decls = webkitBorderImageDeclarations(props);
  if (decls.length === 0) return [null, null, null, null];
  const read = decls.map(webkitWidths);
  const bad = read.find((r) => typeof r === 'string');
  if (typeof bad === 'string') return bad;
  const first = read[0] as readonly (number | null)[];
  // Chrome applies the highest-priority one; Dragon accepts several only where they all set the same widths.
  if (read.some((r) => (r as readonly (number | null)[]).some((v, i) => v !== first[i]))) return 'two -webkit-border-image declarations set different border widths, and Dragon does not rank them';
  return first;
}

/** Whether a resolved border width is one -webkit-border-image set (applyWebkitBorderImageWidths): an author value with no declaration of its own. */
export function setByWebkit(v: ResolvedValue | undefined): boolean {
  return v !== undefined && v.origin === 'author' && v.declaration === null;
}

/**
 * The border widths Chrome sets on the element from its -webkit-border-image declarations: per side the px width, or null where
 * none is set (a declared border width wins, or no declaration sets one); a string as webkitDeclaredWidths gives one.
 */
export function webkitBorderWidths(props: ReadonlyMap<Longhand, ResolvedValue>): readonly (number | null)[] | string {
  const first = webkitDeclaredWidths(props);
  if (typeof first === 'string') return first;
  return WIDTHS.map((p, i) => {
    const v = props.get(p);
    // Any declaration of the border width, from any origin, is applied after -webkit-border-image and wins.
    return v !== undefined && v.declaration === null && v.origin === 'initial' ? (first[i] as number | null) : null;
  });
}

/** The border widths -webkit-border-image set on a resolved element, per side, or a string as webkitDeclaredWidths gives one. */
export function appliedWebkitWidths(props: ReadonlyMap<Longhand, ResolvedValue>): readonly (number | null)[] | string {
  const first = webkitDeclaredWidths(props);
  if (typeof first === 'string') return first;
  return WIDTHS.map((p, i) => (setByWebkit(props.get(p)) ? (first[i] as number | null) : null));
}

/** Sets the border widths a -webkit-border-image declaration sets (resolve.ts, before lengths are computed); a value Dragon cannot read sets none and is refused (analysis/border-image.ts). */
export function applyWebkitBorderImageWidths(props: Map<Longhand, ResolvedValue>): void {
  const widths = webkitBorderWidths(props);
  if (typeof widths === 'string') return;
  const by = webkitBorderImageDeclarations(props)[0];
  if (by === undefined) return;
  WIDTHS.forEach((p, i) => {
    const px = widths[i];
    if (px === null || px === undefined) return;
    const was = props.get(p) as ResolvedValue;
    props.set(p, { ...was, value: { kind: 'length', value: px, unit: 'px' }, origin: 'author', span: by.span });
  });
}
