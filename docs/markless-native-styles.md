# Native styles for Markless components

Markless compiles a `.tsrx` component for the web and, through Dragon, for iOS (UIKit) and Android (Android Views). The CSS in the component's `<style>` block never reaches the device as CSS. At build time Dragon resolves every style of every element, for every state the component can be in, and writes the result as Swift or Kotlin that sets view properties directly. The device runs no CSS parser, no selector matching and no JavaScript; the only Dragon library on the device is the layout engine.

This page describes the one call a Markless build makes, what it must pass in, what comes back, and what happens when the CSS uses something native cannot do yet.

## The entry point

```ts
import { compileNativeStyles } from 'dragon';

function compileNativeStyles(config: NativeStylesConfig, input: FrontEndResult): NativeStyles;

type NativeStylesConfig = {
  projectId: string;                       // must equal input.snapshot.projectId
  name: string;                            // the component's name, e.g. 'Chip'; the generated class is DragonChipStates
  targets: { ios?: { minimum: string }; android?: { minSdk: number } };   // at least one
  fonts?: FontMap;                         // the font map (docs/api.md §2.3)
  viewport: { width: number; height: number };   // the CSS size the root starts at, before its view reports its own size
};

type NativeStyles = {
  ok: boolean;                             // true only when every configured target emitted
  diagnostics: readonly Diagnostic[];      // every diagnostic of the compile, each with its source span and target
  targets: { ios?: NativeStyleOutput | NativeStyleBlocked; android?: NativeStyleOutput | NativeStyleBlocked };
};
```

It lives in `packages/dragon/src/native-styles.ts`. It compiles with the same settings as `createProject`: the committed support profiles are enforced, and readiness is judged by the committed device lanes record. A bad config (no target, a name that is not an identifier starting with an ASCII capital, a viewport that is not a positive size) throws. Everything about the CSS comes back as data instead.

## What the Markless compiler hands over

`input` is the `FrontEndResult` of [docs/api.md §2.1 and §3](api.md#2-project-input-and-checked-results), built from facts the Markless analyzer already has. Nothing is re-read from disk, and Dragon finds nothing by searching the text.

- **The source snapshot.** Each source's exact text, a stable URI (`dragon-source://<project>/<path>`), a revision and the `sha256:` hash of the UTF-8 text.
- **The style use.** For a `<style>` block, one entry in `tree.styles` whose `css` span covers exactly the block's content: from just after `<style>` to just before `</style>`. Its scope is `{ kind: 'component', owner: '<component id>' }`, so its class names belong to that component only. A global stylesheet uses `{ kind: 'document' }`.
- **The element tree.** Each component's nodes with their origins (source spans): element nodes with their tag, their classes and attributes, and their children in order; text nodes; calls of other components with their arguments; branches for `{cond ? a : b}` markup. A class or attribute that depends on state is a `Choice` over conditions, for example `class={selected ? 'chip selected' : 'chip'}` becomes the class `chip` always and `selected` when `selected == true`.
- **The states.** Each `state()` of the component with its domain (`[false, true]` for a boolean) and its initial value. Dragon compiles every reachable combination, at most 64 per component.
- **A document.** A detached component is compiled inside a small document (`html` > `body` > the component), the same document the Chrome reference renders. The document's global sheet (for example `body { margin: 0; }`) is a document-scoped style use.
- **Completeness.** `'closed-application'`, with the analyzer's own recovered errors in `diagnostics`. A producer error blocks every output.

The ladder fixtures under `packages/parity/fixtures/ms-*/` show the whole shape: each is a real `.tsrx` component (`App.tsrx`) and a `fixture.json` that plays the Markless analyzer. The fixture reader (`packages/parity/src/tree-fixture.ts`) takes a sheet from the n-th `<style>` block of a source (`"block": 0`).

## What comes back for each platform

```ts
type NativeStyleOutput = {
  kind: 'emitted';
  backend: 'uikit' | 'android-views';
  program: StateProgram;                   // the data
  files: readonly GeneratedFile[];         // the code written from that data
  readiness: ArtifactState;                // 'ready' only when every device lane of the target passes
};
type NativeStyleBlocked = { kind: 'blocked'; reason: string };
```

**`program`** is plain data: one node record per element and text run, holding every property write in the platform's own vocabulary (background colour, border styles and colours, corner radii, clipping, paint order, text runs with font and colour, synthetic bold). It also holds the engine input the layout engine lays out. The initial state is stored in full; every other reachable state is a delta of the records it changes. The device lanes judge exactly this program. The test `packages/parity/test/markless-native-styles.test.ts` checks that the entry point's program equals the lanes' program for the same fixture.

**`files`** is one generated source per platform, written from `program` and nothing else:

| Platform | File | Public API |
|---|---|---|
| iOS | `Cases/Dragon<Name>States.swift` | `public final class Dragon<Name>States`, holding a `machine` (a `DragonStateMachine`) and one setter per state |
| Android | `kotlin/dev/dragon/cases/Dragon<Name>States.kt` (package `dev.dragon.cases`) | `class Dragon<Name>States`, holding the same `machine` and setters |

A boolean state gets a `Bool` setter, for example `set_doc_app_chip_selected(_ v: Bool)` in Swift and `set_doc_app_chip_selected(v: Boolean)` in Kotlin. Any other domain gets an enum. Calling a setter swaps in the new state's records and lays out again only when the layout changes. The compiler never runs again, and nothing is matched on the device. The generated file needs Dragon's support files and the translated layout engine in the app. They are the same for every component: `emitNativeSupport(backend)`, and `packages/layout/generated/`.

**`readiness`** is the target's output state from the compile. It is `ready` only when the committed device lanes record (`packages/parity/out/lanes.json`) shows every lane of that target passing and none stale. Until then it is `analysis-only`, and its `reason` names the lanes that do not pass. The code is emitted either way so the lanes and integrations can run it, but only `ready` is a shipping output ([docs/api.md §2.2](api.md#22-no-publishable-partial-output)).

## The export: `dragon.native-style-export/1` (format change from `/0`)

The Markless hosts (`packages/mobile` in Markless) apply styles from a JSON export, not from the generated Swift or Kotlin above. `/0` came from the counter (`examples/markless-counter/tools/export.ts` on the dragon branch `cw/native-targets`). `/1` is the general form, built from `compileNativeStyles`'s output by `nativeStyleExport` (`packages/parity/src/native-style-export.ts`). `pnpm run native:style-export [-- <fixture>...]` writes it for the ladder to `examples/markless-styles/out/<fixture>.native-style.json`.

**What changed from `/0`, for the iOS and Android host workers:**

- `targets.<t>.nodes` is gone. Each target now has `assignments`, one per reachable state combination, and each holds its own `nodes`. Every assignment is complete: no host needs to merge deltas. A component without state has exactly one assignment, whose `nodes` are what `/0` had.
- Each target gains `states` (`[{ key: "<instance>#<state>", domain }]`, in setter order), `initial` (the index of the starting assignment) and `next` (`next[a][s][v]`, the assignment reached from `a` by setting state `s` to its `v`-th domain value, or `-1` when that is unreachable). An assignment's `values` maps each state key to its value.
- New top-level field `component`. `compiler` (the compile digest), `units`, `source`, `warnings` and `fonts` are as in `/0`. Ahem is listed as `{ "id": "Ahem", "file": "vendor/fonts/Ahem.ttf" }`; other faces by their `sha256:` id, as before.
- The node shape is unchanged: `id`, `parent`, `kind`, `native`, `text`, `frame` (device px, relative to the parent box), `borderWidths` (device px) and `writes` (each with its `kind` and `key`, as in `/0`). The writes are exactly the state program's, so the hosts and the device lanes see the same data.

**How a host switches state:** look up `next[current][s][v]`, then apply the new assignment's frames and writes to the retained views. Nothing is recompiled or matched on the device.

**Chrome comparison of the export:** `native:style-export` also compares every frame of every assignment with Chrome's boxes. It does this at each proof device's viewport and ratio (`EXPORT_DEVICES`: iPhone 17, 402 by 778 points at 3x; Pixel 7, 411 by 818 dp at 2.625), under the device lanes' 1 device px gate. It writes `<fixture>.chrome-compare.json` and fails on any box outside the gate.

The frames are computed at build time for one proof device size. A host on another screen size needs the on-device layout engine, which the generated Swift and Kotlin carry and the export does not. That is the reason both outputs exist.

## What CSS is supported

Support is not restated here. It lives in the support profiles (`packages/dragon/src/profiles/ios.ts`, `android.ts`, generated from the lanes), and `querySupport` answers it per property, value and context. A row is `exact` or `caveat` only when it names a passing comparison against Chrome. The ladder below is the Markless-shaped evidence: each step is a `.tsrx` component in the parity corpus, compared against Chrome 145 by Dragon's own numbers and run on the iOS simulator and Android emulator device lanes.

| Step | Fixture | What it covers |
|---|---|---|
| Box | `ms-box` | padding, margin, border widths, styles and colours per side, corner radii, background colour |
| Text | `ms-text` | font size, weight and colour in Ahem |
| Flex | `ms-flex` | flex row and column, `gap`, `align-items`, `justify-content` |
| Toggle | `ms-toggle` | a class switched by a component state at run time, with rounded corners in both states |
| Press | `ms-press` | `:active` on a pressable element and on its descendant |
| Disabled | `reject-ms-button-disabled` | `:disabled`, refused on every target |

The checks that prove each step are the parity comparison (`packages/parity/test/parity.test.ts` over the committed Chrome captures) and the device lanes: `device-frames`, `device-applied`, `device-lines` and `device-pixels` for each case, and `device-states` for the toggle's run-time switch. Per-case failures are listed in `packages/parity/out/device-failures-<target>.json`.

## What happens when native cannot do something

Nothing is dropped silently. There are two outcomes, and both name what they refuse.

**A build error.** The compile reports a `Diagnostic` with a code from the catalogue, the target, the source span of the declaration or selector, and a fix. That target is blocked: `targets.ios` is `{ kind: 'blocked', reason: 'the ios compile has errors; see the diagnostics' }` and has no code. Examples the tests pin:

- `:active` before its device proof passes: `DRAGON_UNSUPPORTED_SELECTOR [ios] :active is not supported on ios: no passing device proof of selector:pseudo-class(:active) in interaction/mouse, selector:pseudo-class(:active) in interaction/touch`.
- `:active` on a `<button>`: native hit testing does not go through form controls yet (FORM-a).
- `:active` on a box with `border-radius`: hit testing through rounded corners is not built yet (SELD-R2b).
- `:disabled` on any target: `DRAGON_UNSUPPORTED_SELECTOR`. Its fix tells you to model the state as a component state and select it with a class or a `ui-*` attribute, for example `.button[ui-disabled]`.
- A font family list on native, such as `font-family: Helvetica, sans-serif` with both mapped: `DRAGON_UNSUPPORTED_VALUE [ios] font-family: Helvetica , sans-serif is unsupported`. Native text is laid out in Ahem only until the real-font rows are device-proven. An unmapped family is `DRAGON_FONT_UNMAPPED_FAMILY` on every target, because Dragon never uses a font that happens to be installed.
- The attribute `disabled` on a `<button>`: `DRAGON_UNSUPPORTED_ATTRIBUTE`, because Chrome's user-agent styles for it are not modelled.

**A blocked target with a reason.** The CSS is supported, but the generated state runtime has no writer for it yet, so emitting would lose it. For example, a `box-shadow` inside a state program gives `{ kind: 'blocked', reason: 'app/chip/chip: the state runtime cannot write box-shadow yet' }`. Transitions, animations and `@media` bands are also blocked by this entry point for now, each with its reason. Markless should report a blocked reason as a build error for that platform.

## Limits today

- Interaction states (`:hover`, `:active`, `:focus`) compile on native only inside the parity lanes. A production compile refuses them until the device lanes prove them, and this entry point emits no interaction tables yet.
- Native text is Ahem-only in production (see above).
- One call compiles one component in its own document. Generated names are per component (`Dragon<Name>States`), so two components need two different names.
- The generated Kotlin is in the package `dev.dragon.cases`, which the support files share.
