// SEL-dir: the dir attribute (HTML §3.2.6.4) and the directionality :dir() matches (Selectors-4 §9.1). Chrome 145's behaviour is
// captured in css/selector-validity.generated.ts (DIR_ATTRIBUTE_DIRECTIONALITY, DIR_ATTRIBUTE_UNICODE_BIDI).
import type { Directionality } from '../../css/selector-validity.generated.ts';

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * The directionality a dir value sets, or null when it sets none: ltr and rtl compare ASCII case-insensitively and are not
 * trimmed, as an enumerated attribute's keywords (HTML §2.3.3). caseSensitive is the planted fault dirCaseSensitive.
 */
export function dirKeyword(value: string, caseSensitive = false): Directionality | null {
  const v = caseSensitive ? value : asciiLower(value);
  return v === 'ltr' || v === 'rtl' ? v : null;
}

/** The directionality of path's last element: that of its nearest ancestor-or-self with a dir of ltr or rtl, else ltr. */
export function directionality(path: readonly { readonly attributes: ReadonlyMap<string, string> }[], faults: { readonly dirNotInherited: boolean; readonly dirCaseSensitive: boolean }): Directionality {
  const from = faults.dirNotInherited ? path.length - 1 : 0;
  for (let i = path.length - 1; i >= from; i--) {
    const value = path[i]?.attributes.get('dir');
    const d = value === undefined ? null : dirKeyword(value, faults.dirCaseSensitive);
    if (d !== null) return d;
  }
  return 'ltr';
}
