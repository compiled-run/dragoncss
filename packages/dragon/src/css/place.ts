// css-align-3 §5.3 (place-content), §6.3 (place-items), §6.4 (place-self) as Chrome 145 parses them (shorthands_custom.cc
// PlaceContent, PlaceItems and PlaceSelf::ParseShorthand): the align longhand parses first, then the justify longhand from the
// rest; with no rest, the justify longhand takes the align value again, except that place-content's baseline gives start.

export const PLACE_SHORTHANDS = {
  'place-content': ['align-content', 'justify-content'],
  'place-items': ['align-items', 'justify-items'],
  'place-self': ['align-self', 'justify-self'],
} as const;

export type PlaceShorthand = keyof typeof PLACE_SHORTHANDS;

export const isPlaceShorthand = (p: string): p is PlaceShorthand => Object.prototype.hasOwnProperty.call(PLACE_SHORTHANDS, p);

/** The words each longhand is given: the align part, then the justify part. */
export type PlaceSplit = { readonly align: readonly string[]; readonly justify: readonly string[] };

// Every alignment value is one keyword or two (css-align-3 §4): a leading first, last, safe, unsafe or legacy takes the next word.
const LEADING = new Set(['first', 'last', 'safe', 'unsafe', 'legacy']);

/**
 * Splits lowercased keywords into the align and justify parts, or null when they cannot be two alignment values. Blink parses
 * each part greedily, so the align part is one word, or two when it starts with a leading word; each part's own grammar is
 * checked by parsing it as its longhand. legacy never starts an align value, but is taken here so the align longhand rejects it.
 */
export function splitPlace(property: PlaceShorthand, names: readonly string[]): PlaceSplit | null {
  if (names.length === 0 || names.length > 4) return null;
  const alignLength = LEADING.has(names[0] as string) && names.length >= 2 ? 2 : 1;
  const align = names.slice(0, alignLength);
  const rest = names.slice(alignLength);
  if (rest.length > 0) return { align, justify: rest };
  // PlaceContent::ParseShorthand: a <baseline-position> align-content gives justify-content start, since justify-content has no
  // baseline value.
  if (property === 'place-content' && (align[align.length - 1] === 'baseline')) return { align, justify: ['start'] };
  return { align, justify: align };
}
