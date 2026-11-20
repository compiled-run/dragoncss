# Markless styles ladder: exports and Chrome comparison

`pnpm run native:style-export` compiles each ladder fixture (`packages/parity/fixtures/ms-*`, real `.tsrx` components) through
`compileNativeStyles`, and writes two files to `out/`:

- `<fixture>.native-style.json` in the `dragon.native-style-export/1` format: per target, per state assignment, every node's writes and frame.
- `<fixture>.chrome-compare.json`: every frame compared with Chrome's box at the proof device's viewport and ratio, under the 1 device px gate.

The format and what changed from `/0` are described in [docs/markless-native-styles.md](../../docs/markless-native-styles.md#the-export-dragonnative-style-export1-format-change-from-0).
