// FORM-a: the form controls the compiler resolves. A3 adds button, which Chrome 145 lays out as a block container that centres
// its contents (or the flex container its display says) and Dragon paints as CSS boxes once its used appearance is none
// (Blink layout_theme.cc AdjustAppearanceWithAuthorStyle and IsControlStyled; FORM-0 ruling F1 and the R11 probe). A4 adds
// input[type=range], laid out as Chrome's UA shadow tree (container, track, thumb; analysis/resolve.ts resolves the parts).
// FORM-d adds checkbox and radio inputs with appearance: none, which Chrome lays out as empty boxes.
import type { Longhand } from '../../css/properties.ts';
import { usedAppearance } from '../../forms/appearance.ts';
import type { UsedAppearance } from '../../forms/appearance.ts';
import type { ControlKey } from '../../ua/datasets.ts';
import type { ResolvedValue } from '../computed.ts';

export const CONTROL_TAGS: readonly string[] = ['button', 'input'];

/**
 * The UA dataset key of a control: a button's UA rules do not depend on its type (controls-button-type proves it); an input's
 * do: range, checkbox and radio (ASCII case-insensitive, HTML §4.10.5) are laid out; any other input reads the plain input key and is
 * refused (computed-checks.ts). A disabled button or range (match.ts isActuallyDisabled) reads its own key: html.css's
 * :disabled rules give it other colours (FORM-c).
 */
export function controlUaKey(tag: string, type: string | undefined, disabled: boolean = false): ControlKey | null {
  if (tag === 'button') return disabled ? 'button:disabled' : 'button';
  if (tag === 'input' && isRangeType(type)) return disabled ? 'input[type=range]:disabled' : 'input[type=range]';
  const toggle = tag === 'input' ? toggleType(type) : null;
  if (toggle === 'checkbox') return disabled ? 'input[type=checkbox]:disabled' : 'input[type=checkbox]';
  if (toggle === 'radio') return disabled ? 'input[type=radio]:disabled' : 'input[type=radio]';
  if (tag === 'input') return 'input';
  return null;
}

/** HTML §4.10.5: the type attribute's keyword, ASCII case-insensitively. */
export function isRangeType(type: string | undefined): boolean {
  return type !== undefined && type.replace(/[A-Z]/g, (c) => c.toLowerCase()) === 'range';
}

/** FORM-d: checkbox or radio when the type attribute's keyword (ASCII case-insensitive, HTML §4.10.5) is one, else null. */
export function toggleType(type: string | undefined): 'checkbox' | 'radio' | null {
  const t = type?.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return t === 'checkbox' || t === 'radio' ? t : null;
}

/** Whether a tag is a form control. */
export function isControlTag(tag: string): boolean {
  return CONTROL_TAGS.includes(tag);
}

/**
 * The longhands whose author declaration devolves a push button to CSS painting (Blink HasAuthorBackground, HasAuthorBorder,
 * HasAuthorBorderRadius): any background longhand, any border side, border radius or border image longhand, whatever the value.
 */
const DEVOLVING_BACKGROUND = /^background-/;
const DEVOLVING_BORDER = /^border-((top|right|bottom|left)-(width|style|color)|(top|bottom|start|end)-(left|right|start|end)-radius|image-[a-z]+)$/;

const keyword = (v: ResolvedValue): string | null => (v.value.kind === 'keyword' ? v.value.value : null);

/**
 * A button's used appearance: 'css' when Chrome paints it as CSS boxes (appearance: none, or auto with an author background or
 * border), 'theme' when the platform theme paints it, which Dragon does not draw (FORM-b). Any appearance keyword other than none
 * and auto count as theme, so Dragon never claims a themed button.
 */
export function buttonAppearance(props: ReadonlyMap<Longhand, ResolvedValue>): UsedAppearance {
  const appearance = keyword(props.get('appearance') as ResolvedValue);
  if (appearance !== 'none' && appearance !== 'auto') return 'theme';
  let background = false;
  let border = false;
  for (const [p, v] of props) {
    // An author declaration of any value counts, initial and inherit included (Blink sets the flag at cascade time).
    if (v.declaration === null) continue;
    if (DEVOLVING_BACKGROUND.test(p)) background = true;
    if (DEVOLVING_BORDER.test(p)) border = true;
  }
  return usedAppearance('button', { appearance, background, border, thumbAppearance: 'auto' });
}
