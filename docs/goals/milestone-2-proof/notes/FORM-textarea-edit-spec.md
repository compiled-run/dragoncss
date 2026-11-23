# FORM-textarea-edit: an editable `<textarea>` when the host edits it

Status: spec, for the Judge. Branch `cw/form-textarea-edit`, built on batch 6 (`cw/notes-batch-6` 3bd1c18a2b).

## Why

The Markless notes form (`packages/mobile/apps/notes/lib/NoteForm.tsrx` in Markless) has an editable body field,
`<textarea name="body" rows="8">`. #645 lets a Markless export lay out an editable single-line text field when the host
edits it (`compileNativeStyles({ textEditing: 'host' })`, `InternalOptions.hostTextEditing`). Today `checkTextField`
(`packages/dragon/src/analysis/computed-checks.ts`) still refuses an editable textarea on iOS and Android, because the
host-editing exemption is for `tag === 'input'` only:

> `<textarea> … is an editable text control: Dragon draws its value but has no caret, selection or keyboard input on iOS and Android yet (the FORM-b editing slice)`

This slice extends #645's split to the textarea. It changes nothing else about the textarea (#631/#640's layout).

## Chrome 145 facts

All of these come from the pinned Chrome 145 headless shell (`launchChrome`) at DPR 1, 2, 2.625 and 3. The page is an
Ahem 10px textarea, 120px wide, 46px high, `padding: 4px`, a 1px border, `line-height: 12px`, `resize: none` and
`scrollbar-width: none`. Each case was loaded twice, once with `readonly` and once without:

| # | Fact | Evidence |
|---|------|----------|
| E1 | Readonly and editable textareas lay out the same. The border box and the scroll extent are equal for an empty value, a one-line value, a value that fits, and a value that overflows (95 characters with hard line breaks; scroll height 104 against a client height of 54). | Every case at every DPR has the same box; at DPR 2.625 the box is 129.52×55.52 for both. |
| E2 | When not focused, the two draw the same pixels. That holds with the placeholder showing and with an overflowing value. | Screenshots are byte-identical at every DPR. |
| E3 | Typing never moves the textarea's box. Typing the overflowing value gives the same scroll height as the same value set readonly (104), so the value wraps the same way whether typed or set. | `boxStill` is true and the scroll heights are equal at every DPR. |
| E4 | While typing, the editor scrolls to keep the caret in view. After typing, scrollTop is 46 (45.5 at DPR 2, 45.71 at DPR 2.625). | `afterType.scroll[2]`. |
| E5 | When the field loses focus, its scroll offset stays where editing left it, so it no longer returns to 0. Typing 87 characters and then blurring leaves scrollTop at 10 (9.5 at DPR 2, 9.90 at DPR 2.625). | `blurred.scroll[2]`. |
| E6 | The placeholder hides as soon as the value is non-empty, whether typed or set. | `:placeholder-shown` |
| E7 | A tap or click gives a textarea both `:focus` and `:focus-visible`, as on a keyboard-input `<input>`. After blur, it has neither. | `tap fv true`; `blurred fv false`. Dragon's pointer focus (`pointerFocusVisible`) already lists `textarea`. |

The facts follow from html.css and HTML §4.10.11. A textarea's `readonly` attribute changes neither its style nor its
UA shadow tree: Chrome's `html_text_area_element.cc` builds the same inner editor either way. That file is LGPL, so it
is cited as a reference only and nothing is ported from it. Editing changes only the value and the inner editor's
scroll offset.

## The split, as in #645

**Dragon lays out**, as it does for a readonly textarea today (#631/#640):
- the textarea box, with its padding and border;
- its UA shadow parts at rest: `<id>::editor`, holding the value wrapped as `white-space: pre-wrap` at the editor's width;
- `<id>::placeholder`, while the value is empty.

The value is the element's text, either fixed or set by state. This is the only text Dragon wraps.

**The host draws and edits**, while the page is shown. The host places its own native multi-line text view over the
`<id>::editor` box: `UITextView` on iOS, `EditText` on Android. That view draws:
- the value, in the `font`, `text-color`, `line-height` and `text-align` that the `<id>::editor` box carries;
- the caret, the selection and keyboard input;
- the view's own vertical scrolling (E4, E5).

**What follows from E1 to E5:**
- **Nothing moves:** no box moves when the user types. The textarea's size never follows its value (E3), and Dragon
  re-runs no layout on input.
- **Dragon's at-rest frame holds only before the first edit:** that frame is scrollTop 0 with the value as written.
  After an edit, the scroll offset is the host's (E5), as in Chrome.
- **Placeholder:** the host hides it while its own value is non-empty (E6), as #645's hosts do.
- **Focus styles:** they come from Dragon's interaction states (E7). The host reports the textarea focused or blurred,
  so `:focus`, `:focus-visible` and any outline resolve as they do for #645's field.
- **Wrapping must agree:** the host's line breaking has to match Dragon's wrapped lines at rest, the same fact #645
  relies on for one line. For more than one line this is a new claim, so the proof below covers it on the phones.

## The slice

In `checkTextField`, lift the editing refusal for `<textarea>` when `hostEdits` is true, under exactly the conditions
#645 lifts it for `<input>`. Every other textarea refusal stays:

- `resize` other than `none`, which `checkResize` refuses. Chrome draws a grip, and that needs the owner's ruling.
- A scrollbar gutter (`checkTextAreaChrome`), which needs the owner's ruling on which Chrome to match.
- Rounded corners on a scrolling box (`checkRoundedScrollContainer`), which needs the owner's ruling.
- `overflow: visible`, an element child, `field-sizing: content`, and position or float.
- A non-Ahem face (FORM-text-font, #681, decides that one).

**Text attributes the host must honour, refused unless the host can:**
- `spellcheck`: Chrome underlines misspelt words in an editable textarea while it is focused. Chrome's spellcheck
  squiggles are platform UI and Dragon draws none. The host uses its platform spellcheck when `spellcheck` is not
  `false`, and none when it is. This is a host contract, not a pixel claim. The squiggles stay outside the parity
  claim, as the caret does.
- `autocapitalize`, `autocorrect`, `inputmode` and `enterkeyhint`: keyboard behaviour, which the host maps. No layout
  or paint effect.
- `wrap="off"` changes the editor's wrapping. Refuse it, since nothing measures it.
- `maxlength` and `minlength`: rendering-neutral (FORM-attrs). The host enforces `maxlength` on input.

With batch 6 alone, the notes body field still has `resize: vertical` and `border-radius: 10px` on a scrolling box. It
compiles only after the owner's rulings, or with app changes that set `resize: none` and either remove the radius or
land the rounded scroll clip. This slice removes the editing refusal only.

## Proof

1. **Chrome parity of readonly and editable** (`form-textarea-edit.test.ts`): for each of the four values above, at DPR
   1, 2, 2.625 and 3, Chrome's box, scroll extent and unfocused pixels must equal between readonly and editable (E1, E2).
   The test also checks that typing equals setting the value (E3), and that a tap gives `:focus-visible` (E7). These
   pin Dragon's claim that an editable textarea lays out as a readonly one.
2. **Compile**: with `textEditing: 'host'`, an editable textarea in the shapes Dragon already lays out
   (`controls-textarea`) compiles with no `editing` diagnostic, and the export carries `<id>::editor` and
   `<id>::placeholder` as for a readonly one. Without `textEditing: 'host'`, it stays refused. Rejects: `wrap="off"`,
   and every other textarea refusal unchanged.
3. **Markless export fixture**: `examples/markless-styles/input/textarea.native-style-input.json`, with an editable
   textarea that is empty, has a fixed value, has an overflowing value, and has a value set by state. It is compared
   with Chrome frame by frame, as #645's `markless-text-field.test.ts` is.
4. **Phones**: a Markless rung with an editable textarea, through the shared runner on iOS and Android, run once the
   Markless host side exists. The screenshot at rest must match Chrome's wrapped lines, and the step that types must
   keep every other box still. The host side is Markless work, so its PR and that rung are listed as outstanding here
   and are not claimed by this slice.

## Out of scope

- Drawing a caret, selection or spellcheck UI in Dragon.
- Scrolling an overflowing textarea before the first edit. This stays FORM-b2, as it is today.
- `resize`, the scrollbar gutter and the rounded scroll clip, which wait for the owner's rulings.
- Right-to-left editing. Not measured here; a right-to-left editable textarea stays refused until measured.
