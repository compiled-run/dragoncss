| Engine / path | All 620 | Latin static fonts (480) | Inter variable (60) | CJK, Chrome default (60) | CJK vs Chrome `text-spacing-trim: space-all` (60) | Line-width delta on identical lines, Latin static: p50 / p95 / max (px) |
|---|---|---|---|---|---|---|
| Core Text `CTTypesetterSuggestLineBreak` (as-is) | 437/620 (70.5%) | 347/480 (72.3%) | 56/60 (93.3%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.008 / 0.014 / 0.016 |
| TextKit 1 `NSLayoutManager` (as-is) | 430/620 (69.4%) | 340/480 (70.8%) | 56/60 (93.3%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.008 / 0.014 / 0.383 |
| TextKit 1 + `lineBreakStrategy = .standard` | 430/620 (69.4%) | 340/480 (70.8%) | 56/60 (93.3%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.008 / 0.014 / 0.383 |
| StaticLayout SIMPLE, default Paint (hinted), 1x | 239/620 (38.5%) | 190/480 (39.6%) | 23/60 (38.3%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.984 / 4.449 / 14.117 |
| StaticLayout SIMPLE, default Paint (hinted), 2.625x | 266/620 (42.9%) | 200/480 (41.7%) | 33/60 (55.0%) | 17/60 (28.3%) | 49/60 (81.7%) | 0.612 / 4.899 / 12.374 |
| StaticLayout SIMPLE, default Paint (hinted), 3x | 301/620 (48.5%) | 234/480 (48.8%) | 36/60 (60.0%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.359 / 1.626 / 5.438 |
| StaticLayout SIMPLE + LINEAR_TEXT_FLAG, 2.625x | 326/620 (52.6%) | 254/480 (52.9%) | 39/60 (65.0%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.018 / 0.050 / 0.929 |
| StaticLayout SIMPLE + LINEAR + opsz, 2.625x | 344/620 (55.5%) | 254/480 (52.9%) | 57/60 (95.0%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.018 / 0.050 / 0.929 |
| StaticLayout HIGH_QUALITY + hyphenation NORMAL (TextView-like), 2.625x | 221/620 (35.6%) | 177/480 (36.9%) | 24/60 (40.0%) | 15/60 (25.0%) | 43/60 (71.7%) | 0.019 / 0.049 / 0.929 |
| (b-ICU) CT widths + raw ICU opportunities + Blink greedy | 496/620 (80.0%) | 403/480 (84.0%) | 58/60 (96.7%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.008 / 0.014 / 0.016 |
| (b-ICU) Android widths (LINEAR) + android.icu opportunities + Blink greedy, 2.625x | 475/620 (76.6%) | 401/480 (83.5%) | 39/60 (65.0%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.019 / 0.048 / 0.929 |
| (b) CT widths + Blink opportunities + Blink greedy | 575/620 (92.7%) | 480/480 (100.0%) | 60/60 (100.0%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.008 / 0.014 / 0.016 |
| (b) Android widths (hinted default Paint) + Blink opps + greedy, 2.625x | 452/620 (72.9%) | 384/480 (80.0%) | 35/60 (58.3%) | 16/60 (26.7%) | 49/60 (81.7%) | 0.597 / 5.112 / 12.374 |
| (b) Android widths (LINEAR) + Blink opps + greedy, 2.625x | 553/620 (89.2%) | 478/480 (99.6%) | 40/60 (66.7%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.019 / 0.047 / 0.929 |
| (b) Android widths (LINEAR + explicit opsz) + Blink opps + greedy, 2.625x | 573/620 (92.4%) | 478/480 (99.6%) | 60/60 (100.0%) | 15/60 (25.0%) | 60/60 (100.0%) | 0.019 / 0.047 / 0.929 |


| Font | CT nowrap max abs delta (px) | Android default Paint 1x / 2.625x / 3x | Android LINEAR 1x / 2.625x / 3x |
|---|---|---|---|
| Inter | 0.015 | 24.402 / 33.514 / 9.432 | 0.430 / 0.240 / 0.121 |
| Roboto | 0.015 | 29.223 / 31.290 / 12.661 | 1.871 / 1.767 / 1.871 |
| NotoSans | 0.014 | 34.688 / 46.549 / 19.708 | 0.691 / 0.231 / 0.254 |
| InterVF | 0.011 | 198.637 / 193.884 / 176.637 | 185.449 / 185.292 / 185.449 |
| InterVF, Android explicit opsz | - | - | 0.699 / 0.408 / 0.307 |
| NotoSansJP | 71.989 | 71.906 / 71.335 / 72.574 | 71.582 / 71.836 / 71.975 |
| NotoSansJP vs Chrome space-all | 0.015 | 0.961 / 30.202 / 0.574 | 0.520 / 0.193 / 0.025 |
