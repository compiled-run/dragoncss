# T070 SC-SCROLL findings (Scout, recorded by PM)

Scratch: /tmp/sc-scroll (m.mts; Blink 145.0.7632.6 sources in src/).

- **`--hide-scrollbars` creates no scrollbars at all.** It does not create overlay ones. Evidence: paint_layer_scrollable_area.cc:1773-1781, so there is no gutter and no thumb in any case, even for an honoured 5px ::-webkit-scrollbar or scrollbar-gutter: stable. Headless without the flag showed the same; the cause was not found.
- **Ignore rule.** computed_style.h:758-760 and computed_style.cc:2494-2512: `::-webkit-scrollbar` is ignored when scrollbar-width is not auto or scrollbar-color is set. getComputedStyle on the pseudo still reports 5px, so it is not a usable signal.
- **Thumb colour** comes from scrollbar-color (scrollbar.cc:951-953; scrollbar_theme_overlay.cc:185-187; scrollbar_theme_overlay_mobile.cc:61,69). `thin` picks the theme's thin thickness (scrollbar_theme_overlay.cc:85-90,111-119); the px value was not fetched.
- **Scroll metrics** (100x100 auto box, 300x300 child):

  | Case | Result |
  |---|---|
  | padding 10 | 320x320 (end padding counts for in-flow block, flex, grid and inline content) |
  | margin 20 | 340x340 |
  | abspos child | 300x300 (no end padding) |
  | relative or transform +20 | 330x330 |
  | content fits | 120x120 |

- **Demo.**
  - html, body and .App compute overflow-x hidden and overflow-y auto; .library is overflow auto.
  - The standard scrollbar properties are set on `*` (styles.css:469-472), so every ::-webkit-scrollbar rule (474-486) is ignored.
  - Gutter 0; no thumb.
  - The html and body figures were measured in quirks mode; rerun them with a doctype.
