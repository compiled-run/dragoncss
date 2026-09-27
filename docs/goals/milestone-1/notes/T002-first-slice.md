# T002 First Worker package and package sequence

> **Superseded 2026-09-26 for the engine parts:** the owner removed Taffy and Rust. See T022 (notes/T022-own-layout-plan.md). Everything engine-independent below still holds.

Judge, 2026-09-26, claude-code. Decision: approved.

## Tolerance ruling (no owner decision needed)

The gate is owner decision 13: at most 1 device pixel (1.0 px at DPR 1) on each absolute box edge (left, top, right, bottom). It compares Chrome's `getBoundingClientRect` with Taffy's unrounded cumulative layout. Unrounded deltas and rounded-mode equality are reported but do not gate. testing-plan.md's "0.01 px unrounded" was a research default that decision 13 supersedes. It is also unmeetable: Chrome's LayoutUnit is 1/64 px. The constant is defined once, cites decision 13, and fixtures cannot override it. testing-plan.md line 60 should be corrected in a PM doc task.

## Dual check (principle 4)

Slice 2. Slice 1 has no web emitter. Authored Chrome vs Taffy fed by Dragon's resolution already catches layout-resolution bugs.

## Package sequence

- **S1 (T003):** walking skeleton, about 12 fixtures. Details below.
- **S2:** web CSS emitter from the resolved result (`outputs.web` ready). Chrome renders authored and compiled web, and both must match on boxes plus numeric computed values. Colours (background-color, color) are resolved and checked by channel. Seeded faults (a state-collapsing resolver, a colour-only fault) must fail.
- **S3:** tree@0 finite states and the api.md section 10 conformance cases: multi-file ordered sheets, two components in one module, colliding classes, conditional classes and attributes, aliases, calls, both arms of branches, projections. One generated parity case per state, with no deduplication. Also the typed diagnostics catalogue, invalid and malformed inputs, and negative type tests for absent target keys.
- **S4:** corpus to 100 or more. Includes a filtered Taffy gentest flex/block import (base CSS as an explicit stylesheet, MIT notice), fixtures per profile row, RTL variants, and basic Ahem text (inherited text styles written onto text nodes, loose text wrapped, TS twin of the Ahem measure).
- **S5:** full side-by-side report (screenshots labelled as evidence, per-node diff, likelyCause, summary.md), plus:
  - a profile checker: exact rows name passing fixtures, unsupported rows have rejection fixtures;
  - a Linux CI workflow file (not pushed);
  - repeated-compile determinism;
  - a browser-worker import check for the core (risk: css-tree's Node entry may use createRequire).
- Then T999. T005 (agent eval) can start after S2.

## S1 Worker package

**Objective:** build the first end-to-end layout parity lane for about 12 box and flex fixtures (Ahem, DPR 1). It has three parts.

**(1) packages/dragon**
- Public `createProject({projectId, targets})` with `compile(FrontEndResult)` and `check(FrontEndResult)`, per api.md 2.1–2.2.
- The narrow tree@0 subset: one document entry, one component, element nodes with static classes, and literal text.
- css-tree parsing, with a fork over a committed webref grammar generated as a .ts module.
- Cascade by specificity and order, and inheritance.
- Chrome UA defaults loaded from a committed .ts module captured from Chrome.
- For the ios target: an analysis-only result, with an internal layout projection that sets every Taffy Style field explicitly.
- An internal support profile (web, ios). Entries default to unsupported. Exact entries carry aspect `layout`, lane `linux-taffy` and fixture ids.
- Typed diagnostics with a code and a UTF-16 span for unsupported properties and values.

**(2) tools/taffy-runner**
- A Rust CLI on `taffy =0.14.0` that reads a batch of Dragon-schema JSON on stdin.
- Serde rejects unknown or missing style fields (no `#[serde(default)]`).
- It uses the Ahem measure and prints id, x, y, w, h (rounded and unrounded) in preorder.
- A committed `zig-linker.sh`. The Node build helper uses it only when on darwin AND (`DRAGON_ZIG_LINKER=1` OR a probe of the system cc fails). It never touches Linux and never writes `.cargo/config.toml`.

**(3) packages/parity (private)**
- An HTML fixture reader that produces a FrontEndResult.
- A Playwright capture of the authored fixture, using the T001 section 5 flags.
- The Taffy spawn, and an edge compare at the 1 device pixel gate.
- `report.json` and `index.html`, written to a gitignored directory.
- Committed `expected/*.web.json`, checked for exact equality against the live capture and regenerated only by an explicit script.
- A planted fault: a projection that falls back to a Taffy default (such as box_sizing) must make a content-box fixture fail.
- A test that every exact profile entry names fixture ids that passed in this run.

The allowed_files, verify, stop_if and constraints are on the T003 card in state.yaml.
