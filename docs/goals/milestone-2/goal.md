# Dragon CSS milestone 2: native targets at parity (iOS and Android, same proof on every platform)

## Objective

Choose the native engine strategy by evidence, then prove Dragon CSS on real native platforms with equal rigour on iOS and Android. The model must also extend to macOS and later targets. Every native target gets the same proof pipeline:

- a layout engine that reproduces the shared vectors;
- generated native code from the one compiled result;
- a device lane comparing native frames and applied values with Chrome;
- profile rows promoted only by passing native cases.

## Original Request

"Prep it" (milestone 2), then: "Deep research pass and figure it out. But scope wise I want to support iOS, android, etc. Like of course we're on mac so using iOS simulator is fine sure, but I don't want it to be like, oh web and iOS works but android sucks. See what I mean? Is there a reason we don't use rust or zig to be able to simulate? or is that not worth it? Just trying to figure out what all we can do in typescript vs not etc."

## Intake Summary

- **Input shape:** `existing_plan`. Milestone 1 is done, and the owner's decisions and platform research exist.
- **Audience:** the owner, then framework authors (Markless first).
- **Authority:** `requested`.
- **Proof type:** `test`.
- **Completion proof:** the oracle below, met for iOS and Android and audited.
- **Likely misfires:**
  - An iOS lane ships and Android becomes "later".
  - The engine is hand-ported per platform, so the ports drift.
  - TypeScript vs Rust vs Zig is decided by preference instead of evidence.
  - Native support is claimed from Chrome-only proof.
  - One platform gets more fixtures or looser checks.
- **Blind spots:**
  - There is no Android or JVM tooling on this Mac, so it needs an owner install.
  - Text parity is the hardest part on both platforms, because Dragon owns the line box.
  - Engine language trades drift risk, toolchain weight, binary size and speed.
  - The compiler must stay synchronous, pure TypeScript.
  - Ahem must be bundled on device.
- **Existing plan facts:** recorded in `state.yaml` under `goal.intake.existing_plan_facts`.

## Goal Oracle

`pnpm test` is green, plus:

1. Every native layout engine (iOS, Android) reproduces 100% of the shared layout vectors bit for bit.
2. The iOS simulator lane and the Android emulator lane each run the full milestone-1 corpus through generated native code. Each matches Chrome at 1 device px, with applied-value dumps equal to the expected dumps.
3. A lane-parity check proves every configured native target has the same lanes, cases and tolerances.
4. iOS and Android profile rows become `exact` only through passing native cases.

A platform lane blocked on owner tooling is reported as not met, never counted as passing.

## Goal Kind

`existing_plan`

## Current Tranche

1. **Research, running in parallel** (both tasks are read-only):
   - T001: engine strategy, including a direct answer on TypeScript vs Rust vs Zig.
   - T002: device lanes at parity for iOS and Android.
2. **Decide (T003, Judge):** the strategy, owner decisions and the first vertical Worker package.
3. **Owner decisions (T004, PM):** record the owner's answers, including the Android toolchain install.
4. **Build:** Worker packages until the oracle is met on both platforms.

## Non-Negotiable Constraints

- **Parity.** No platform gets a later or weaker proof pipeline by design. A tooling gap becomes an owner-blocked task, not a scope cut.
- **Follow AGENTS.md and docs/decisions.md:**
  - No claim without a test.
  - Numbers decide pass or fail; screenshots and AI judgement are evidence only.
  - Never loosen tolerances or skip tests.
  - Dragon owns its engines; no third-party layout engine.
  - The TypeScript engine is the reference that native engines reproduce exactly.
  - Compile straight to native properties.
- **The compiler and web path stay synchronous, pure TypeScript** (api.md 4.4). Any native-language core must not change that.
- **Stay inside this repo.** No publishing, no pushes, no remotes without an owner directive.
- **Deferred to later milestones unless the owner says otherwise:**
  - custom properties, `var()` and `@layer` (the Tailwind path);
  - the first real Linux run.

## Stop Rule

Stop only when a final audit proves the oracle for every native target.

## Canonical Board

`docs/goals/milestone-2/state.yaml`

## Run Command

```text
/goal Follow docs/goals/milestone-2/goal.md.
```
