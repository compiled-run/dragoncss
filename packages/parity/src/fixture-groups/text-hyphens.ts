// Fixture group text-hyphens (TXT2-i, notes/T149-txt2-spec.md R14): hyphens in Ahem, both directions. English words
// under auto stay whole, overflowing their 60px boxes, since Chrome hyphenates nothing without a
// content language; manual and none on text without a soft hyphen; a flex row under auto. The Ahem line breaker refuses U+00AD
// itself, so no case here holds one. The reject: none on text that holds a soft hyphen, which the engine does not honour yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_HYPHENS: readonly FixtureSpec[] = [
  layout('text-hyphens-ahem', ['ltr', 'rtl']),
  reject('reject-text-hyphens-none-shy', 'DRAGON_UNSUPPORTED_VALUE', 'none', 'hyphens: none on text h:text0, which holds a soft hyphen'),
];
