// FORM-a: the form controls the compiler resolves. A3 adds button, which Chrome 145 lays out as a block container that centres
// its contents (or the flex container its display says) and Dragon paints as CSS boxes once its used appearance is none
// (Blink layout_theme.cc AdjustAppearanceWithAuthorStyle and IsControlStyled; FORM-0 ruling F1 and the R11 probe). A4 adds
// input[type=range], laid out as Chrome's UA shadow tree (container, track, thumb; analysis/resolve.ts resolves the parts).
// FORM-c adds the single-line text fields (text, email, url, tel, password and an unknown type), laid out as Chrome's inner editor
// and placeholder (resolve.ts) and painted as CSS boxes once devolved, as a button is (layout_theme.cc IsControlStyled).
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

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** HTML §4.10.5: the type attribute's keyword, ASCII case-insensitively. */
export function isRangeType(type: string | undefined): boolean {
  return type !== undefined && asciiLower(type) === 'range';
}

/** Every input type keyword HTML §4.10.5 defines; any other value, or none, is the Text state. */
const INPUT_TYPES: ReadonlySet<string> = new Set(['hidden', 'text', 'search', 'tel', 'url', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number', 'range', 'color', 'checkbox', 'radio', 'file', 'submit', 'image', 'reset', 'button']);

/** The single-line text field states FORM-c lays out: their UA shadow tree is the inner editor alone (no decoration container). */
const TEXT_FIELD_TYPES: ReadonlySet<string> = new Set(['text', 'tel', 'url', 'email', 'password']);

/** HTML §4.10.5: an input's type state, the keyword ASCII-lowercased; a missing or unknown type is text. */
export function inputTypeState(type: string | undefined): string {
  const t = type === undefined ? 'text' : asciiLower(type);
  return INPUT_TYPES.has(t) ? t : 'text';
}

/** Whether an input of this type attribute is a single-line text field FORM-c lays out. */
export function isTextFieldType(type: string | undefined): boolean {
  return TEXT_FIELD_TYPES.has(inputTypeState(type));
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
  return devolvableAppearance('button', props);
}

/** A text field's used appearance, by the same author-style rule as a button's (FORM-c devolve probe, appearance.generated.ts). */
export function textFieldAppearance(props: ReadonlyMap<Longhand, ResolvedValue>): UsedAppearance {
  return devolvableAppearance('textfield', props);
}

function devolvableAppearance(control: 'button' | 'textfield', props: ReadonlyMap<Longhand, ResolvedValue>): UsedAppearance {
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
  return usedAppearance(control, { appearance, background, border, thumbAppearance: 'auto' });
}
