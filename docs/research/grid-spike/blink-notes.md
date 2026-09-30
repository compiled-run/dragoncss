# Blink grid notes (Chrome 145.0.7632.6)

Source: the chromium/chromium GitHub mirror at tag 145.0.7632.6, `third_party/blink/renderer/core/layout/grid/` unless a path is
given. Abbreviations: TSA = grid_track_sizing_algorithm.cc, GLA = grid_layout_algorithm.cc, GTC = grid_track_collection.cc,
GLU = grid_layout_utils.cc. Every "Evidence" names a case in probe/ ([README](README.md)). Values are raw units at DPR 1 (1/64
px) unless they are in px.

## LayoutUnit arithmetic that matters

- `LayoutUnit(float)` multiplies by 64 and truncates toward zero (platform/geometry/layout_unit.h:128, `saturated_cast`).
  Fixed and percentage lengths go through it, so 40.3px is 2579 units (40.296875px) and 100.7px is 6444.
- `LayoutUnit / integer` divides the raw value in C++ integer division, which truncates toward zero (layout_unit.h:622).
  -3821 / 2 is -1910, not -1911. Dragon's integer division helper must truncate toward zero, not floor.
- `LayoutUnit / LayoutUnit` is `64 * a / b` in int64 (layout_unit.h:594).
- `LayoutUnit::FromRawValue(float)` takes an int, so a float argument is truncated toward zero.
- Blink does all fr arithmetic in float32 (`float`, `base::ClampedNumeric<float>`), not double. Dragon has to reproduce it with
  `Math.fround` at every step (GR12).

## Rounding points GR1-GR18

| GR | Anchor | Rule | Evidence |
|---|---|---|---|
| GR1 | TSA:133 (`CalculateGutterSize`), :150-152 | A gap is `MinimumValueForLength(gap, available)`. An indefinite available size counts as 0, so a % gap is 0 while sizing. A subgrid with `normal` gap takes the parent's gutter. | g-pct-columns-frac (7.3% of 6483 units is 473), g-pct-rows-indefinite |
| GR2 | platform/geometry/length_functions.cc:74; layout_unit.h:128 | Percentages resolve as `LayoutUnit(float(max * pct / 100))`, truncated. calc() goes through `LayoutUnit(float)` as well. | pc-tracks (33.3% of 6444 units is 2145, not 2146) |
| GR3 | GTC:1175-1216 (`InitializeSets`) | A set's base size, growth limit and fit-content limit are the one-track resolved breadth times `track_count` (:1186, :1198, :1213). A % is resolved once per track, then multiplied. | s-large-count, pc-minmax |
| GR4 | TSA:282 (`ComputeUsedTrackSizes`) | The steps run in order: intrinsic sizes (only if a track is intrinsic), infinite growth limits set to the base size, maximize, expand flexible tracks (only if one is flexible), stretch auto tracks. | all of sets.json |
| GR5 | TSA:514 (`DistributeExtraSpaceToSets`), :647 | Each set's share is `(extra.raw * set_track_count) / growable_track_count` in unsigned 32-bit integer division. The count and remaining space shrink as sets are served, so the remainder moves to later sets. When a set's ratio equals the remaining sum, it takes all that is left (:633). The share is capped at the set's growth potential. | s-stretch-remainder (2133, 2133, 2134), s-share-seven (914 x5, 915 x2), s-stretch-remainder-7 |
| GR6 | TSA:604 | Before an equal distribution, sets are sorted by growth potential (infinite last) with `std::sort`, which gives no order for ties. With 30 sets or fewer, libc++ uses insertion sort, which keeps tied sets in input order. Dragon should use a stable sort with this key, and record any case above 30 sets as a risk. | s-stretch-remainder-7 (7 tied sets; the remainder lands at the end) |
| GR7 | TSA:753, :763, :769 | The same routine with float ratios for items that span flexible tracks: `share = FromRawValue(extra.raw * flex / flex_sum)`, in float and then truncated. Space beyond limits is never given to flexible sets. | s-weighted-flex-span (20px / 60px) |
| GR8 | TSA:775 (`IncreaseTrackSizesToAccommodateGridItems`), :801, :843-846 | The spanned size is `gutter * (span - 1)` plus each spanned set's affected size (base size, or growth limit with infinity read as the base size). Extra space is `contribution - spanned`, floored at 0. The planned increase is the maximum over the group's items (:876-877). | s-gutter-in-span (45px / 45px) |
| GR9 | TSA:888 (`ResolveIntrinsicTrackSizes`), :922 | Items are grouped by span size, and items spanning a flexible track all go last in one group. Each group runs five passes: intrinsic minimums, content-based minimums, max-content minimums, intrinsic maximums, max-content maximums. The flex group runs only the three minimum passes, weighted by flex factor. | s-span-grouping (50px / 70px), s-infinitely-growable |
| GR10 | TSA:1001 (`MaximizeTracks`) | Free space is shared equally (GR5) up to growth limits. Indefinite free space fills every set to its growth limit. There is no redo against max-width/height (TODO at :1024). | s-maximize-limits, i-maximize-max-block |
| GR11 | TSA:1031 (`StretchAutoTracks`) | This runs only when content distribution is `stretch`, or the default with position `normal`. It grows sets whose max is `auto` and that are not fit-content. When free space is indefinite it uses `min_available_size_` minus the total track size (:1067). | i-stretch-min-indefinite (50px / 50px), a-jc-start (no stretch) |
| GR12 | TSA:1087 (`ExpandFlexibleTracks`), :1168, :1181, :1239, :1261, :1267 | The flex sum is clamped to at least 1. The fr size is `leftover.raw / flex_sum` in float32. Sets whose base size exceeds their fr share become inflexible, visited in base/flex order. Each flexible set gets `FromRawValue(fr * flex + leftover + FLT_EPSILON)`. The float remainder carries forward, but float32 precision can lose it: 1fr 1fr 1fr over 6400 units gives 2133 x3, and a double implementation would give 2134 for the last. | s-fr-three-sets, s-fr-seven (914 x3, 915, 914 x3), fr-restart |
| GR13 | TSA:1280 (`DetermineFreeSpace`) | Under layout: `available - total track size`, floored at 0, or indefinite. Under min-content (columns only): 0. Under max-content (columns only): indefinite. Rows always use layout. | m-max-content-auto-min, i-inline-grid |
| GR14 | TSA:157 (`ComputeFirstSetGeometry`), :207, :222-224, :235, :265 | Truncating divisions: `space-between` adds free/(n-1) to the gutter; `space-around` computes free/n, puts half at the start and all of it in the gutter; `space-evenly` adds free/(n+1) to both; `center` offsets by free/2. Free space is clamped to 0 only for `safe`. The distributions fall back to start or center when the free space is negative. | a-jc-space-between-4 (1962), a-jc-*-overflow |
| GR15 | GLA:587 (`ComputeGridGeometry`), :681-705, :728-736 | Columns are sized, then rows. If the block size was indefinite, it is resolved from the intrinsic size (clamped by min/max). The algorithm re-runs both axes when a row gap has a %, when a row track depends on the available size (% or fr), or when the initial block size was forced indefinite. Otherwise only `align-content` is re-applied (:711-723). The intrinsic block size keeps its first-pass value. | g-pct-rows-indefinite (the second row moves to 24px, the container stays 40px), pc-rows-indefinite (25px / 20px), fr-min-block-redo |
| GR16 | GLA:871 (`ContributionSizeForGridItem`), :1083, :1100 | Contribution = content size + baseline shim + margins + the subgrid extra margins at the edges (GTC:559, :566, which is `accumulated_gutter_size_delta / 2`, truncated, and negative when the subgrid gap is smaller). The automatic minimum is clamped to the spanned definite max size, but never below margins + border + padding + shim. The result is floored at 0. | m-auto-min-clamp (30px), m-auto-min-clamp-border, sg-gap-delta (16.5px / 13px / 16.5px) |
| GR17 | GLA:3102 (`ComputeOutOfFlowItemContainingRect`); GLU:215, :251, :348 | An abspos item's line inside a multi-track set is placed by `std::div(set.raw, count)`: each track before it adds the quotient, and the first `rem` tracks add 1 more unit. An `auto` line, or one beyond the implicit grid, uses the padding edge. An end line drops the trailing gutter. | ab-mid-range (2134, not 2133), ab-mid-range-7, ab-auto-lines, ab-beyond-grid |
| GR18 | layout_grid.cc:296; GLA:270 and :328 | The computed track size is the set size / track count, truncated, and the remainder is discarded. Item geometry uses set offsets, so the computed list can sum to less than the item span (s-span3-one-set: 33.3281px x3, while the item is 100px). The container's min/max-content widths are two full column passes (GLA:270-326); :328 is the subgrid version. | s-span3-one-set, s-fr-one-set |

Other anchors:
- Self alignment: layout_utils.cc:631-657 (`AlignmentOffset`). center is `margin_start + free/2`, truncated toward zero (a-center-odd: -1910). Overflow is safe only for `safe` or auto margins (grid_item.cc:49, :76-78). `normal` stretches non-replaced items (grid_item.cc:137).
- Auto repetitions: GLU:68-185. Each auto track counts at least 1px (:136). With a definite size or max, the count is `floor((max - fixed + gap) / repeat)` (:173); with only a min it is the ceiling (:181); the count is always at least 1. Evidence: r-fill-frac (33.3px is 2131 units, so 3 tracks), r-fill-min-inline (4), r-fill-max-inline (3), r-fill-zero (10).
- Implicit tracks before the explicit grid cycle `grid-auto-columns` backwards from the explicit start (GTC:265-276). Evidence: p-implicit-before, `20px 30px 5px 6px`.
- Dense packing resets the cursor to the grid start for every auto item (grid_placement.cc:109-111). Sparse packing only moves forward.
- `kGridMaxTracks` is 10,000,000 (core/style/grid_area.h:48); lines are clamped at :190-193.
- The share at TSA:647 multiplies an `int` raw value by a `wtf_size_t`, which is unsigned 32-bit. It wraps when extra.raw x set_track_count reaches 2^32 (about 67,000,000 px-tracks at DPR 1). This never happens in real layouts, but Dragon must not use a 64-bit product where Blink wraps.

## Planted faults (28)

Each plant is a fault a grid engine could plausibly have. Its catching case shows a Chrome value the fault cannot produce.
`--plants` checks that the corpus (dpr1-ltr-horizontal-tb) holds the Chrome value and that it differs from the plant's value.

| Plant | Catching case | Field | Chrome | Plant |
|---|---|---|---|---|
| frLeftoverDropped | s-fr-seven | i3 inline-size | 915 | 914 |
| frLeftoverFloat64 | s-fr-three-sets | i2 inline-size | 2133 | 2134 |
| frRestartMissing | fr-restart | cols | 80px 20px | 80px 50px |
| flexSumBelowOneNotClamped | fr-sum-below-one | i0 inline-size | 1280 | 2560 |
| flexSpanWeightedAsEqual | s-weighted-flex-span | cols | 20px 60px | 40px 40px |
| sharePerTrackNotPerSet | s-span3-one-set | cols | 33.3281px x3 | last 33.3438px |
| remainderNotToLastSet | s-stretch-remainder | i0 inline-size | 2133 | 2134 |
| shareRounded | s-share-seven | i5 inline-start | 3656 | 3657 |
| maximizeIgnoresGrowthLimit | s-maximize-limits | i0 inline-size | 1280 | 3200 |
| spanGroupingFlat | s-span-grouping | cols | 50px 70px | 60px 60px |
| gutterNotInSpannedSize | s-gutter-in-span | cols | 45px 45px | 50px 50px |
| autoMinNotClamped | m-auto-min-clamp | cols | 30px | 80px |
| fitContentAsAuto | m-fit-content | i0 inline-size | 3200 | 16320 |
| stretchIgnoresContentAlignment | a-jc-start | i2 inline-start | 1344 | 4258 |
| stretchIndefiniteIgnoresMinSize | i-stretch-min-indefinite | rows | 50px 50px | 10px 10px |
| percentGapNotReresolved | g-pct-rows-indefinite | i1 block-start | 1536 | 1280 |
| percentTrackNotReresolved | pc-rows-indefinite | rows | 25px 20px | 30px 20px |
| percentRounded | pc-tracks | i0 inline-size | 2145 | 2146 |
| contentDistributionRounded | a-jc-space-between-4 | i1 inline-start | 1962 | 1963 |
| centerNegativeFloors | a-center-odd | i1 inline-start | -1910 | -1911 |
| autoPlacementNotDense | p-dense | i2 block-start | 0 | 640 |
| sparseCursorRewinds | p-sparse-cursor | i2 block-start | 640 | 0 |
| orderIgnored | p-order | i0 block-start | 320 | 0 |
| implicitBeforeCyclesForward | p-implicit-before | cols | 20px 30px 5px 6px | 10px 20px 5px 6px |
| autoFillCountCeil | r-fill-frac | cols | 3 tracks | 4 tracks |
| autoFitNotCollapsed | r-fit-center | i0 inline-start | 4352 | 0 |
| baselineShimMissing | b-row-shim | i0 block-start | 448 | 0 |
| oofMidRangeTruncated | ab-mid-range | i0 inline-start | 2134 | 2133 |

The plant values are derived by hand from the fault. Examples:
- frLeftoverDropped: seven 914s.
- shareRounded: rounding 914.5 up at the fourth set.
- fitContentAsAuto: two auto tracks: maximize takes the first to 110px, then stretch shares the remaining 290px, giving 255px.
- stretchIgnoresContentAlignment: stretching 10, 11 and 12px tracks over 101.296875px gives shares of 1457.

The summary named 27 plants. This list adds frLeftoverFloat64, because the float32 rule in GR12 is the easiest one to get
wrong.

## Suspected deviations (4)

| Deviation | Verdict | Evidence (DPR 1) |
|---|---|---|
| grid-maximize-no-max-redo | **Confirmed, block axis only.** Rows `minmax(10px,100px)` x2 with `max-block-size:50px` come out 100px / 100px. The spec redoes maximize at 50px (25px / 25px). There is no redo (TSA:1024 TODO), and GR15's extra pass does not fire because the rows do not depend on the available size. In the inline axis, layout always has a definite width, so the columns match the spec. | i-maximize-max-block (confirmed); i-maximize-max-inline 25px / 25px (inline axis matches the spec) |
| grid-flex-no-minmax-redo | **Refuted.** The TODO at TSA:1271 is real, but GR15's extra pass re-runs sizing with the clamped block size whenever a row is flexible (fr marks the range as dependent on the available size, GTC:1076-1080). Inline-axis sizing always lays out at the clamped width. All four cases match the spec. | fr-min-block-redo 50px / 50px; fr-max-block-redo-text 50px; fr-min-inline-redo and fr-max-inline-redo 50px / 50px |
| grid-max-content-auto-min | **Confirmed.** Under a max-content constraint, the spec treats `auto` minimums as max-content (css-grid-2 "max-content minimums"). Blink applies that pass only to real max-content minimums (TSA:396-400, TODO). An inline-grid with `minmax(auto,20px)` holding an item of min-content 20 and max-content 110 is 20px wide; the spec gives 110px. The same holds for a floated grid. | m-max-content-auto-min, m-max-content-auto-min-float |
| grid-default-self-overflow-unsafe | **Confirmed.** Default overflow alignment is plain unsafe, not css-align-3's "smart" default: `is_overflow_safe` is true only for `safe` (grid_item.cc:49), and content distribution clamps only for `safe` (TSA:189-192). A 100px item centered in a 40px column of a scroll container sits at -30px, unreachable. `justify-content:center` with 100px of tracks does the same. | a-self-overflow-scroller (-1920), a-self-overflow-scroller-safe (0), a-content-overflow-scroller (-1920) |

Register grid-maximize-no-max-redo (block axis), grid-max-content-auto-min and grid-default-self-overflow-unsafe as Chrome
deviations. Drop grid-flex-no-minmax-redo.
