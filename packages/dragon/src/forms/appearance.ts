// The used appearance of a button or range: Blink layout_theme.cc AdjustAppearanceWithAuthorStyle and IsControlStyled.
// A push button with an author background or border devolves to CSS painting; a slider never does. A range's thumb has its own
// appearance (html.css gives ::-webkit-slider-thumb appearance:auto), so the whole range is CSS-painted only when the input and the
// thumb are both appearance:none.
import { NO_FORM_FAULTS } from './faults.ts';
import type { FormFaults } from './faults.ts';

export type Control = 'button' | 'range';

export type AuthorControlStyle = {
  readonly appearance: 'auto' | 'none';
  /** Any author-level background-* declaration. */
  readonly background: boolean;
  /** Any author-level border-* declaration. */
  readonly border: boolean;
  /** The appearance of a range's ::-webkit-slider-thumb; ignored for buttons. */
  readonly thumbAppearance: 'auto' | 'none';
};

/** 'theme' when the platform theme paints the control; 'css' when it is painted as CSS boxes. */
export type UsedAppearance = 'theme' | 'css';

export function usedAppearance(control: Control, author: AuthorControlStyle, faults: FormFaults = NO_FORM_FAULTS): UsedAppearance {
  if (control === 'range') return author.appearance === 'none' && author.thumbAppearance === 'none' ? 'css' : 'theme';
  if (author.appearance === 'none') return 'css';
  if (!faults.devolveIgnored && (author.background || author.border)) return 'css';
  return 'theme';
}
