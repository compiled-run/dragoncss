# Vendored fonts

## Ahem.ttf

- Source: web-platform-tests `fonts/Ahem.ttf` (https://github.com/web-platform-tests/wpt/raw/master/fonts/Ahem.ttf), name table "Version 1.50".
- SHA-256: `b719ecb31c5b21fc573c03f6421c74ac63c271a5a3ff841e34f9705fb94b8448` (21,768 bytes).
- Metrics: 1000 units per em; hhea and OS/2 ascent 800, descent 200, line gap 0. Most printable ASCII code points advance 1em; U+200B advances 0.
- Used by the Dragon layout parity lane: Chrome loads it as a data URI, and `@dragon/layout`'s Ahem measurer models the same metrics without reading the file.

Licence notice, quoted from the font's own name table (record 0; licence URL record 14 is http://dev.w3.org/CSS/fonts/ahem/COPYING):

> The Ahem font belongs to the public domain. In jurisdictions that do not recognize public domain ownership of these files, the following Creative Commons Zero declaration applies: http://labs.creativecommons.org/licenses/zero-waive/1.0/us/legalcode

## Inter (Inter/)

- Source: Inter 4.1 release, https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip, files `extras/ttf/Inter-*.ttf` (static TrueType); name table "Version 4.001;git-9221beed3".
- Licence: SIL Open Font License 1.1, `Inter/OFL.txt` (the release's `LICENSE.txt`, unmodified).
- Used by the fonts module's Chrome captures (packages/dragon/test/fonts): distinct postScriptNames for matching, and metrics.

| File | SHA-256 | Bytes |
|---|---|---|
| Inter/Inter-Light.ttf | `164414f0aacbe98a7e64addc43f7b3bfd2e32f7b90e101feeab227f14c371bda` | 412,844 |
| Inter/Inter-Regular.ttf | `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82` | 411,640 |
| Inter/Inter-Italic.ttf | `bbc051dd204b5019a1aa0bc0ae2aa8a05ab13e7a3f979fa357631dc7feb6833a` | 417,388 |
| Inter/Inter-Bold.ttf | `288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f` | 420,428 |
| Inter/Inter-BoldItalic.ttf | `948405a16cdc62701da5f4005ed068ca5f4d27061d98f7974ccfc37831d9581d` | 425,296 |

## Roboto (Roboto/)

- Source: Roboto 3 classic v3.016, https://github.com/googlefonts/roboto-3-classic/releases/download/v3.016/Roboto_v3.016.zip, file `unhinted/static/Roboto-Regular.ttf`; name table "Version 3.016".
- Licence: SIL Open Font License 1.1, `Roboto/OFL.txt` (the repository's `LICENSE` at tag v3.016, unmodified; the release zip carries no licence file).

| File | SHA-256 | Bytes |
|---|---|---|
| Roboto/Roboto-Regular.ttf | `39548fd9d6250717a5fcfe00b1b0ade234c1f5be8a40818c37e995c13c844df1` | 396,752 |

## Noto Sans (NotoSans/)

- Source: notofonts/latin-greek-cyrillic release NotoSans-v2.015, https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSans-v2.015/NotoSans-v2.015.zip, file `NotoSans/unhinted/ttf/NotoSans-Regular.ttf`; name table "Version 2.015".
- Licence: SIL Open Font License 1.1, `NotoSans/OFL.txt` (the release's `OFL.txt`, unmodified).

| File | SHA-256 | Bytes |
|---|---|---|
| NotoSans/NotoSans-Regular.ttf | `f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8` | 431,364 |

## Noto Sans Mono (NotoSansMono/)

- Source: notofonts/latin-greek-cyrillic release NotoSansMono-v2.014, https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSansMono-v2.014/NotoSansMono-v2.014.zip, file `NotoSansMono/unhinted/ttf/NotoSansMono-Regular.ttf`; name table "Version 2.014". The pinned monospace of the captures.
- Licence: SIL Open Font License 1.1, `NotoSansMono/OFL.txt` (the release's `OFL.txt`, unmodified).

| File | SHA-256 | Bytes |
|---|---|---|
| NotoSansMono/NotoSansMono-Regular.ttf | `87f8ce0522a6c99b743ee5fc75b4073cfdd575639119672828b7b9944b65b4f4` | 388,660 |

The OFL fonts total 3,304,372 bytes.

## Shared with the text spike

`Inter/Inter-Regular.ttf` is also the Inter file of the TXT1-0 gate (docs/research/text-spike, same SHA-256), which reads
it from here. The spike's Roboto and Noto Sans are different files (Roboto 2.138; a different build of Noto Sans 2.015)
and stay under docs/research/text-spike/fonts: see its README.
