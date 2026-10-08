// FORM-a: the form controls the compiler resolves. A3 adds button, which Chrome 145 lays out as a block container that centres
// its contents (or the flex container its display says) and Dragon paints as CSS boxes once its used appearance is none
// (Blink layout_theme.cc AdjustAppearanceWithAuthorStyle and IsControlStyled; FORM-0 ruling F1 and the R11 probe). A4 adds
// input[type=range], laid out as Chrome's UA shadow tree (container, track, thumb; analysis/resolve.ts resolves the parts).
import type { Longhand } from '../../css/properties.ts';
import { usedAppearance } from '../../forms/appearance.ts';
import type { UsedAppearance } from '../../forms/appearance.ts';
import type { ControlKey } from '../../ua/datasets.ts';
import type { ResolvedValue } from '../computed.ts';

export const CONTROL_TAGS: readonly string[] = ['button', 'input'];

/**
 * The UA dataset key of a control: a button's UA rules do not depend on its type (controls-button-type proves it); an input's
 * do, and only type=range (ASCII case-insensitive, HTML §4.10.5) is laid out; any other input reads the plain input key and is
 * refused (computed-checks.ts).
 */
export function controlUaKey(tag: string, type: string | undefined): ControlKey | null {
  if (tag === 'button') return 'button';
  if (tag === 'input') return isRangeType(type) ? 'input[type=range]' : 'input';
  return null;
}

/** HTML §4.10.5: the type attribute's keyword, ASCII case-insensitively. */
export function isRangeType(type: string | undefined): boolean {
  return type !== undefined && type.replace(/[A-Z]/g, (c) => c.toLowerCase()) === 'range';
}

/** Whether a tag is a form control. */
export function isControlTag(tag: string): boolean {
  return CONTROL_TAGS.includes(tag);
}

/** The background and border longhands whose author value devolves a push button to CSS painting (Blink HasAuthorBackground, HasAuthorBorder). */
const DEVOLVING: readonly string[] = ['background-color', 'background-image'];
const DEVOLVING_BORDER = /^border-(top|right|bottom|left)-(width|style|color)$/;

const keyword = (v: ResolvedValue): string | null => (v.value.kind === 'keyword' ? v.value.value : null);

/**
 * A button's used appearance: 'css' when Chrome paints it as CSS boxes (appearance: none, or auto with an author background or
 * border), 'theme' when the platform theme paints it, which Dragon does not draw (FORM-b). Any appearance keyword other than none
 * and auto, and an author value that is not plainly author-origin, count as theme, so Dragon never claims a themed button.
 */
export function buttonAppearance(props: ReadonlyMap<Longhand, ResolvedValue>): UsedAppearance {
  const appearance = keyword(props.get('appearance') as ResolvedValue);
  if (appearance !== 'none' && appearance !== 'auto') return 'theme';
  let background = false;
  let border = false;
  for (const [p, v] of props) {
    if (v.origin !== 'author') continue;
    if (DEVOLVING.includes(p)) background = true;
    if (DEVOLVING_BORDER.test(p)) border = true;
  }
  return usedAppearance('button', { appearance, background, border, thumbAppearance: 'auto' });
}
