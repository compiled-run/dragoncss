# Spike fonts

The exact font files Chrome measured in the text spike (docs/research/text-spike, 2026-09-28). The TXT1-0 gate
(packages/text-shaper) shapes with these files and checks their SHA-256 against `gate/chrome-145.json`, whose hashes
come from `../chrome/loaded-fonts.sha256`: `shasum -a 256` of the files Chrome loaded (`/tmp/text-spike/fonts`, which
`chrome/page.html` references as `../fonts/`), taken on 2026-09-28. Every file there predates the 11:42–11:45 capture.

| File | Family, version (name table) | SHA-256 | Licence |
|---|---|---|---|
| Inter-Regular.ttf | Inter, Version 4.001;git-9221beed3 | `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82` | SIL OFL 1.1, © 2016 The Inter Project Authors |
| Inter-VF.ttf | Inter (variable: opsz 14–32, wght 100–900), Version 4.001;git-66647c0bb | `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031` | SIL OFL 1.1, © 2016 The Inter Project Authors |
| NotoSans-Regular.ttf | Noto Sans, Version 2.015 | `478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823` | SIL OFL 1.1, © 2022 The Noto Project Authors |
| NotoSansJP-Regular.otf | Noto Sans JP, Version 2.004 | `dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073` | SIL OFL 1.1, © 2014-2021 Adobe |
| Roboto-Regular.ttf | Roboto, Version 2.138 | `f3edb8058e523f5612bfd99d0745e661568ad85e1b6217bc62f786fabae624c6` | Apache License 2.0, © 2011 Google Inc. |

Licence texts: `OFL-1.1.txt` (SIL Open Font License 1.1) and `LICENSE-Apache-2.0.txt`.
