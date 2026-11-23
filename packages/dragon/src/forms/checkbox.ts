// FORM-checkbox: the colours of a themed checkbox in the light scheme, as Chrome 145 paints them (NativeThemeBase::PaintCheckbox in
// ui/native_theme/native_theme_base.cc, with the colour ids it reads measured, docs/goals/milestone-2-proof/notes/FORM-checkbox-spec.md).
import type { Rgba8 } from '../css/color.ts';
import { contrastRatio } from '../css/color.ts';

/** The theme's checkbox part size in CSS px, which an auto width or height takes (native_theme_base.cc kCheckboxSize). */
export const CHECKBOX_PART_SIZE = 13;

const rgb = (r: number, g: number, b: number): Rgba8 => ({ r, g, b, alpha: 255 });

/** kColorWebNativeControlCheckboxBackground, Border and Accent in the light scheme. */
export const CHECKBOX_LIGHT = { background: rgb(255, 255, 255), border: rgb(118, 118, 118), accent: rgb(0, 117, 255) } as const;
/** The dark scheme's checkbox background, which Chrome uses for a checked box's background and check under a light accent. */
export const CHECKBOX_DARK_BACKGROUND = rgb(59, 59, 59);
/** The contrast ratio against white below which a checked box takes the dark colours (Chrome observation, spec item 10). */
export const CHECKBOX_LIGHT_ACCENT_CONTRAST = 3;

/** The colours of one checkbox's two drawings. */
export type CheckboxColors = {
  readonly unchecked: { readonly background: Rgba8; readonly border: Rgba8 };
  readonly checked: { readonly background: Rgba8; readonly fill: Rgba8; readonly check: Rgba8 };
};

/** A themed checkbox's colours for an opaque accent-color, or null for accent-color: auto. */
export function checkboxColors(accent: Rgba8 | null, faults: { readonly checkboxLightCheckOnLightAccent: boolean }): CheckboxColors {
  const fill = accent ?? CHECKBOX_LIGHT.accent;
  const dark = !faults.checkboxLightCheckOnLightAccent && contrastRatio(fill, CHECKBOX_LIGHT.background) < CHECKBOX_LIGHT_ACCENT_CONTRAST;
  const under = dark ? CHECKBOX_DARK_BACKGROUND : CHECKBOX_LIGHT.background;
  return { unchecked: { background: CHECKBOX_LIGHT.background, border: CHECKBOX_LIGHT.border }, checked: { background: under, fill, check: under } };
}
