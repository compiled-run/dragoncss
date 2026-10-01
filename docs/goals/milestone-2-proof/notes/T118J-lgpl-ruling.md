# T118J: ruling on the LGPL-headered citations PORT-0 found (2026-09-30)

Judge T118J compared all 18 LGPL files at 145.0.7632.6 with Dragon (upstream copies fetched to /tmp/t118j/). PM ruling: accepted as below.

| Upstream (LGPL) | Class | Action and proof |
|---|---|---|
| css_markup.cc | A (CSS ident grammar, CSSOM serialize-a-string; IsInvalidFontFamily is in BSD css_parsing_utils.cc) | reference; escapes.test.ts, fonts/wire.test.ts |
| css_primitive_value.h PX_PER_IN | A, wrong cite (constants live in LGPL css_resolution_units.h / resolution_units.h) | cite css-values-4 §6.2; units.test.ts:33-36 |
| css_primitive_value.cc CSS_LENGTH_MAX | A (constant INT_MAX/64-2) | reference; no Chrome golden yet, added to T120 CALC-2 |
| selector_checker.cc | A (probed behaviour) | selectors.test.ts |
| html_document.cc | A (HTML §4.16.2 list) | selectors.test.ts, capture-selector-validity.ts |
| local_frame_view.cc, layout_view.cc | A (measured rule record) | layout calc.test.ts |
| html_button_element.cc | A (HTML button layout) | forms.test.ts |
| layout_text.cc | A (report string only) | reference |
| layout_theme.cc | A (css-ui-4 devolvable widgets + captured probe) | forms.test.ts |
| computed_style.cc/.h | A (one rounding formula) | dpr-rules.test.ts |
| length_functions.cc | A (one-line float order) | units/dpr-rules/calc tests |
| image_decoder.cc | A (HTML §4.8.4.3.6; Dragon uses exact rationals) | images.test.ts:64 |
| wtf/hash_table.h | A (Dragon's own simulator of iteration order) | fonts/units.test.ts "selection ties" |
| **step_range.cc/.h** | **B**: range-value.ts clampValue/parseStep follow ClampValue/ParseStep branch by branch | clean-room rewrite (T123) |
| **text_break_iterator.cc** | **B**: linebreak.ts fastBreak and the space-run loop follow ShouldBreakFast | clean-room rewrite (T123); the ASCII pair table is **C** (BSD character_property_data_generator.cc FillAscii 433-470), re-cite |

rapidhash.h (BSD-2, Nicolas De Carli): acceptable; its notice must be kept. Dragon's LICENSE is MIT only, with no third-party notices: PORT-0 adds THIRD_PARTY_NOTICES.md generated from docs/ports.json (Chromium BSD, Skia, HarfBuzz MIT, rapidhash BSD-2).

Order: the PORT-0 amendment lands first (per-entry rulings replace KNOWN_LGPL_PENDING_RULING; KNOWN_LGPL_CLEAN_ROOM names only the 3 B files, tied to T123; any other lgpl entry with a port use fails). Then the PM makes the stub start commit and a worker that has never read the LGPL files or the old bodies does T123.
