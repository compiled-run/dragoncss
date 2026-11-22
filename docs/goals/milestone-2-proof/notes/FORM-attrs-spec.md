# FORM-attrs: `<form>`, the form attributes, and buttons in a form under a host that runs forms

Carries #572 (the owner's FORM-attrs lane, 2026-10-26) onto master, for the Markless notes app's `/new` and `/notes/[id]/edit` form.

## From #572 (unchanged)
- `<form>` is a block element with Chrome 145's captured UA values (`display: block`, `unicode-bidi: isolate`); fixture `block-elements-form`.
- `name`, `autocomplete`, `required` and `minlength` are rendering-neutral, each proved by an `attr-neutral-*` pair (ltr and rtl).
- A `<button>` whose form owner is an ancestor `<form>` and whose type is submit (missing or invalid) or reset is refused (`project.ts` checkFormButtons): activating it submits or resets the form, which the native outputs do not do. `rel` and `target` on a form are refused (they govern submission).

## Added here
- **`maxlength`** is rendering-neutral: a constraint on editing and validation (HTML §4.10.19.3), with no HTML §15 rule or presentational hint. Proof: `attr-neutral-maxlength` against `attr-neutral-none`, the same pair shape as `minlength`.
- **A host that runs forms.** `compileNativeStyles` takes `forms: 'host'` (internal option `hostForms`), as it takes `topLayer: 'host'` and `canvas: 'host'`. It means the host app implements submission and reset itself: the Markless runtime runs a form's submit and reset on the phone as on the web (its `onSubmit` handlers, FormData, `preventDefault`). Under it, checkFormButtons does not refuse a submit or reset button inside a form. Nothing about the button's layout or paint changes: its type is already a handled attribute that Chrome's UA rules do not read (`controls-button-type`). The Markless style export (`parity/src/markless-style-input.ts`) sets it beside `topLayer` and `canvas`.
  - Without `forms: 'host'`, the refusal stays as #572 wrote it.
  - Any other value of `forms` throws, as `topLayer` and `canvas` do.
  - Proof (`packages/parity/test/form-buttons-host.test.ts`; Judge ruling 2026-11-22, approved with amendments): a form holding buttons with no type, submit, reset, an invalid type and button, once with `appearance: none` and once devolved by an author background (a themed button is refused on its own on native, R11).
    - Without hostForms, every submitting and resetting button is refused by name. With hostForms, none is.
    - The program equals the all-`type="button"` page's.
    - In Chrome at DPR 1 and 3, the typed page lays out exactly as the all-`type="button"` page, and Dragon's engine boxes match Chrome's within the gate.
    - `rel` and `target` on a form stay refused under hostForms, and a `forms` value other than `'host'` throws.

## Not here
- `<textarea>` and its `rows` (#575, and native editing, FORM-b2).
- `:focus` on a `<select>`, and a select's natural width from its widest option (FORM-b select follow-ups).
