# T020: re-review of docs/api.md (T019 revision) against T013 F1-F25

Verdict: **rejected**, with a bounded fix list of six doc-only edits. The architecture now answers the critique; the remaining defects are an owner-decision section that re-asks three things the owner already decided, a "self-contained" example that fails the repo's own type settings, and a milestone-1 slice that does not say which tree features and conformance cases are in scope.

## Per-finding verdicts

| ID | Verdict | Location | Note |
|---|---|---|---|
| F1 | resolved | §2.1 (L47-81) | Immutable snapshot with text, hashes, virtual CSS mappings, resolution table, dependency report, digest scope. |
| F2 | partially | §3.1-3.2 (L124-169), example L173-260 | Condition algebra, qualified refs, aliases, initial values, branch predicates and exhaustive choices are defined. But the example uses its own `Expr`/string `Ref` model, not the `dragon/tree@0` shapes it illustrates (`DocumentEntry`, `State`, `StateAlias`, `Condition`, `Choice`), and it fails `tsc` under the repo's `tsconfig.base.json` (`noUncheckedIndexedAccess`): L205 `ref = aliases[ref]` and L208 `return values[ref]` are `T or undefined`. |
| F3 | resolved | §4.1 (L286-308) | Resolved CSS, backend lowering, projections; code and expected dump come from one lowered program; each lane's proof scope is named. |
| F4 | resolved | §7 (L469-477) | No deduplication in milestone 1; numeric computed-value/paint evidence; faulty-resolver and color-only fixtures required. |
| F5 | resolved | §3.4 (L272-282) | Structural validation separated from producer completeness; conformance suite, runtime domain guards, typed setters. |
| F6 | resolved | §2.1 L90, §3.4 L275 | Compile consumes the whole `FrontEndResult`; `validateInput` returns a success/failure union. |
| F7 | resolved (deferred) | §4.2 (L310-335) | Manifest and lifecycle specified as experimental, two instances plus ancestor-driven update; no support promised. |
| F8 | resolved | §3.1 (L124-163) | Document entries, ordered owned sheet uses, logical ancestry, symbol provenance, same-module owners. |
| F9 | resolved (deferred) | §3.3 (L264-270) | requires-link artifact, consumer specialization, membership analysis, publish/consume gate. |
| F10 | resolved (deferred) | §4.3 (L337-358), D4 | Structured values, residual algebra, proven lowering or build failure; progress claim withdrawn. |
| F11 | resolved | §2.2 (L92-120) | ready / analysis-only / blocked; preview is a separate value with validity labels. |
| F12 | partially | §2.2 L104-118; §6.3 L452 | Probe (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes): `outputs.android`, `outputs.email`, web-only `outputs.ios` and unknown target keys are all errors. But §6.3 `querySupport` takes `Compiled<string>`, which accepts any `Compiled<K>` and then allows `outputs.android`, contradicting "no unrestricted index signature" (L118). A config typed as the wide `Targets` also claims every key; the doc should say that case relies on runtime validation. |
| F13 | resolved | §7 (L461-479) | Internal fixture renderer, future driver contract, DPR/pointer/hover/reduced-motion, target/floor/lane binding, honest coverage reports. |
| F14 | resolved | §7.1 (L481-487) | Strict authored equality in milestone 1; each normalization gets its own reference policy. |
| F15 | resolved | §8 (L507-509) | Whole-snapshot replacement now; incremental APIs internal until equivalence tests exist. |
| F16 | resolved | §6.1-6.2 (L399-445) | Revisioned source registry, five origin kinds, stale-fix preconditions, per-target/condition explain, position-to-instance lookup. |
| F17 | resolved | §6.3 (L447-459) | possibilities vs resolved; needs-context; proof tied to value subset, context, environment. `NormalizedTarget` is undefined but this is labelled pseudocode. |
| F18 | resolved | §5 (L393-395) | No `interactive` flag; static backends take explicit assignments; web output vs named target previews. |
| F19 | resolved | §5 (L389-391) | Subtree plans, fidelity before cost, stable tie-break, joint-feature proof. |
| F20 | resolved | §9 (L511-517) | Exact draft revisions, precise compatible additions, union policy, compatibility window, codes never renamed. |
| F21 | resolved | §9 table (L519-529) | Matches docs/decisions.md pitfall 4 exactly. |
| F22 | resolved | §4.4 (L366-368) | Lightning CSS and yuku out of the core path; Node and browser-worker smoke checks required. |
| F23 | resolved | §4.4 (L360-364) | Helpers emitted as source; Taffy the only external on-device library. Consistent with docs/decisions.md (picks the "generated output" option it allows). |
| F24 | partially | §8 (L489-505), §10 (L531-539) | Adapter and whole-graph path filtering defined. But §10 lists multi-file, correlated-state, projection, invalid-input and inherited-text cases as "needed before promoting", not as milestone-1 requirements, which is what F24's fix asked for. The milestone-1 subset of the tree schema (which node kinds; whether component calls, aliases and branches are in) is not stated. |
| F25 | partially | Owner decisions (L541-552) | Decisions are separated, but D5 (text size) and D8 (expensive techniques) are already decided in docs/decisions.md items 5 and 8, and D7 (floors) overlaps item 6 (iOS 15, Android 10, macOS 13). Re-asking them as pending contradicts the record. |

## Owner structural questions

- Remove pitfalls by design: yes. Fail-closed outputs (§2.2), no partial artifacts, all targets checked on every compile (§1).
- Semantic analysis of CSS plus element tree decides platform choices: yes (§5, subtree plans from CSS-level facts).
- Focus on one platform and it just works on the other: mostly. Every compile checks every target. Missing: a sentence that, when a native target is configured, the development preview defaults to that target's projection (docs/decisions.md pitfall 1, goal.md principle 4). §2.2 and §5 describe the preview only as a separate, future value.
- Agent-friendly like StyleX: yes (§5 specificity-conflict diagnostics with fixes; locality; typed diagnostics §6.1).
- Framework-neutral: yes (`FrontEndResult`, host adapter, no framework discovery).
- Compile straight to native properties: yes (§4.1, §4.4).
- One compiler result for web CSS, native code and test data: yes (§4.1).
- Any target as a backend, CSS-only core: yes (§5 L387; backend names only in the facade).

## Contradictions with docs/decisions.md

- D5, D8 re-ask decided items 5 and 8. D7 must be reconciled with item 6.
- No other contradiction found. Selector scope (§3.1 L163) matches "own element, same-component parents, app-wide conditions". Runtime boundary (§4.4) and withdrawal rules (§9) match.

## Owner decisions readability

They do not read in seconds. Problems: internal codes (D1-D8) lead each item; jargon without plain meaning ("tree emitters", "source adapters", "stable read-only symbol/reference queries", "conformance certification", "continuous application style inputs", "platform floors", "materialized in normalized config from profiles"); no opening sentence stating what is asked and what is recommended; low-stakes items (D2, D3) are not batched as researched defaults.

## Milestone-1 slice

Mostly concrete: public `compile`/`check`, web plus iOS layout preparation as analysis-only, at least 100 box/flex fixtures through compile, Taffy and Chrome at one device pixel, report and profile links, fixture renderer internal. Gaps are the two in F24 above.

## Type spot-check (run, not read)

Probe in /tmp with strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes:
- Mapped `outputs` blocks absent target keys: confirmed.
- `Compiled<string>` accepts a web/iOS result and then allows `outputs.android`: confirmed (the §6.3 hole).
- Switch example (L174-259): 2 errors, L205 and L208, under the repo's tsconfig settings; passes under plain `--strict`.

## Bounded fix list (docs/api.md only)

1. Owner decisions: drop D5 and D8 as pending and cite docs/decisions.md items 5 and 8 as recorded. Reframe D7 against item 6: floors are chosen; the only question is whether config must restate them or default to them. Open with one sentence saying what is asked and what is recommended. Write each remaining item in everyday words as choice, recommendation, "because ...". Move low-stakes items to a "researched defaults" line.
2. Switch example: fix L205/L208 so it compiles under `tsconfig.base.json`. Either build it from the §3.1 types or add the same switch as a `dragon/tree@0` payload using `DocumentEntry`, `State`, `StateAlias`, `Condition`, `Choice`.
3. §6.3: make `querySupport` generic over `K` (`result: Compiled<K>; target: K`) and state that a config typed as the wide `Targets` relies on runtime validation.
4. §10: list which conformance cases milestone 1 must pass (at least multi-file, correlated state, projected/inherited text, invalid input and front-end diagnostic propagation) and name the milestone-1 tree subset (node kinds; component calls, aliases and branches in or out).
5. §2.2 or §5: one sentence saying that when a native target is configured, the development preview defaults to that target's projection (decisions pitfall 1), delivered after milestone 1.
6. Update the Critique resolution lines for F2, F12, F24 and F25 to match.

## Board note

§4.4 takes Lightning CSS off the required path and adopts T018's css-tree plus webref. T001's objective and goal.md "Current Tranche" step 1 still name lightningcss as a building block to validate. The PM should update T001 so the scout checks css-tree/webref. After approval, fill the "API" section of docs/decisions.md.
