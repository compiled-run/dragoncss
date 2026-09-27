# Vendored fonts

## Ahem.ttf

- Source: web-platform-tests `fonts/Ahem.ttf` (https://github.com/web-platform-tests/wpt/raw/master/fonts/Ahem.ttf), name table "Version 1.50".
- SHA-256: `b719ecb31c5b21fc573c03f6421c74ac63c271a5a3ff841e34f9705fb94b8448` (21,768 bytes).
- Metrics: 1000 units per em; hhea and OS/2 ascent 800, descent 200, line gap 0. Most printable ASCII code points advance 1em; U+200B advances 0.
- Used by the Dragon layout parity lane: Chrome loads it as a data URI, and `@dragon/layout`'s Ahem measurer models the same metrics without reading the file.

Licence notice, quoted from the font's own name table (record 0; licence URL record 14 is http://dev.w3.org/CSS/fonts/ahem/COPYING):

> The Ahem font belongs to the public domain. In jurisdictions that do not recognize public domain ownership of these files, the following Creative Commons Zero declaration applies: http://labs.creativecommons.org/licenses/zero-waive/1.0/us/legalcode
