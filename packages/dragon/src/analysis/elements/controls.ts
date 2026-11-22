// FORM-a: the form controls the compiler resolves. A3 adds button, which Chrome 145 lays out as a block container that centres
// its contents (or the flex container its display says) and Dragon paints as CSS boxes once its used appearance is none
// (Blink layout_theme.cc AdjustAppearanceWithAuthorStyle and IsControlStyled; FORM-0 ruling F1 and the R11 probe). A4 adds
// input[type=range], laid out as Chrome's UA shadow tree (container, track, thumb; analysis/resolve.ts resolves the parts).
// FORM-c adds the single-line text fields (text, email, url, tel, password and an unknown type), laid out as Chrome's inner editor
// and placeholder (resolve.ts) and painted as CSS boxes once devolved, as a button is (layout_theme.cc IsControlStyled). FORM-b
// adds textarea, the same shadow tree laid out as a multi-line field, and the single select, laid out as Chrome's menulist (a
// flex row container of the inner element, resolve.ts).
import type { Longhand } from '../../css/properties.ts';
import { usedAppearance } from '../../forms/appearance.ts';
import type { UsedAppearance } from '../../forms/appearance.ts';
import type { ControlKey } from '../../ua/datasets.ts';
import type { ResolvedValue } from '../computed.ts';

export const CONTROL_TAGS: readonly string[] = ['button', 'input', 'select', 'textarea'];

/**
 * The UA dataset key of a control: a button's UA rules do not depend on its type (controls-button-type proves it), but do on
 * :disabled (html.css's disabled colours, captured as button[disabled]); an input's do, and only type=range and type=search (ASCII
 * case-insensitive, HTML §4.10.5) and type=checkbox (FORM-checkbox) read keys of their own; any other input reads the plain input key.
 */
export function controlUaKey(tag: string, type: string | undefined, disabled = false): ControlKey | null {
  if (tag === 'button') return disabled ? 'button[disabled]' : 'button';
  // html.css select:disabled gives opacity, border colour and colour, captured on a disabled select.
  if (tag === 'select') return disabled ? 'select[disabled]' : 'select';
  if (tag === 'input') return isRangeType(type) ? 'input[type=range]' : isCheckboxType(type) ? 'input[type=checkbox]' : inputTypeState(type) === 'search' ? 'input[type=search]' : 'input';
  if (tag === 'textarea') return 'textarea';
  return null;
}

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** HTML §4.10.5: the type attribute's keyword, ASCII case-insensitively. */
export function isRangeType(type: string | undefined): boolean {
  return type !== undefined && asciiLower(type) === 'range';
}

/** HTML §4.10.5: whether the type attribute's keyword is checkbox, ASCII case-insensitively. */
export function isCheckboxType(type: string | undefined): boolean {
  return type !== undefined && asciiLower(type) === 'checkbox';
}

/** Every input type keyword HTML §4.10.5 defines; any other value, or none, is the Text state. */
const INPUT_TYPES: ReadonlySet<string> = new Set(['hidden', 'text', 'search', 'tel', 'url', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number', 'range', 'color', 'checkbox', 'radio', 'file', 'submit', 'image', 'reset', 'button']);

/**
 * The single-line text field states FORM-c lays out: their UA shadow tree is the inner editor alone, except search's, whose
 * decoration container also holds the cancel button (the engine's controls.ts searchCancelButtonSize).
 */
const TEXT_FIELD_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'tel', 'url', 'email', 'password']);

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

/** A textarea's used appearance, devolving as a text field does (the devolve probe's textarea rows). */
export function textAreaAppearance(props: ReadonlyMap<Longhand, ResolvedValue>): UsedAppearance {
  return devolvableAppearance('textarea', props);
}

function devolvableAppearance(control: 'button' | 'textfield' | 'textarea', props: ReadonlyMap<Longhand, ResolvedValue>): UsedAppearance {
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

/** FORM-b: a single select's used appearance: none, menulist-button (devolved), or theme (a themed menulist or another keyword). */
export type SelectAppearance = 'none' | 'menulist-button' | 'theme';

/**
 * A select's used appearance: auto devolves to menulist-button when the author declares a background or border longhand or the
 * box-shadow is not none (layout_theme.cc IsControlStyled for kMenulist and AdjustAppearanceWithAuthorStyle, a reference); with
 * none of them Chrome draws its themed menulist. Every keyword but none and auto counts as theme, so Dragon never claims one.
 */
export function selectAppearance(props: ReadonlyMap<Longhand, ResolvedValue>): SelectAppearance {
  const appearance = keyword(props.get('appearance') as ResolvedValue);
  if (appearance === 'none') return 'none';
  if (appearance !== 'auto') return 'theme';
  if (keyword(props.get('box-shadow') as ResolvedValue) !== 'none') return 'menulist-button';
  for (const [p, v] of props) {
    if (v.declaration !== null && (DEVOLVING_BACKGROUND.test(p) || DEVOLVING_BORDER.test(p))) return 'menulist-button';
  }
  return 'theme';
}
