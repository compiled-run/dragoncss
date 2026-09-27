# T033: Linux lane scope (Scout, read-only)

Owner question: "Do research and figure out what the decision is there."

In the lists below, **Ran/Read** means it was checked this session. **Prior knowledge** means it was not re-read this session and needs checking before anyone cites it.

## 1. Do macOS and Linux Chrome differ for this corpus?

**Short answer: the geometry does not differ. One computed string, the default `font-family`, does. It is baked into both the expected captures and the emitted output.**

Evidence (Ran/Read):
- Pinned flags in `packages/parity/src/chrome.ts`: `--force-device-scale-factor=1 --force-color-profile=srgb --font-render-hinting=none --disable-lcd-text --hide-scrollbars`. Playwright 1.58.2 `chromium.js:324` picks `chromium-headless-shell` when headless. `chromium.js:286` already adds `--hide-scrollbars`.
- `packages/parity/expected` holds 88 files. All 88 contain `"font-family": "Times"`: 1231 element records say Times and 45 say Ahem. Every captured `overflow-x` and `overflow-y` is `visible` (1276/1276), so no scrollbar gutter can appear on either OS.
- The capture has 42 text nodes. **None of the text nodes that have a box use a non-Ahem font.** No fixture uses font-relative units (`ex`, `ch`, `lh`, `cap`) outside Ahem. So the default font never reaches the geometry.
- `packages/parity/emitted`: **47 of 47 files contain `Times`**, so the compiled output carries the macOS UA family. `ua/chrome-145.generated.ts` has `font-family: Times` and `font-size: 16px` for html, body, div and dragon-unstyled. It is used by `dragon/src/project.ts`, `analysis/resolve.ts`, `lower/ios-layout.ts` and `internal.ts`.
- Chromium source at tag 145.0.7632.6 (fetched with curl from googlesource):
  - `third_party/blink/common/web_preferences/web_preferences.cc` sets the default `standard_font_family_map[Zyyy] = "Times New Roman"` on every platform. The only macOS difference in that file is the fixed family: Menlo versus Courier New.
  - `chrome/app/resources/locale_settings_mac.grd` sets `IDS_STANDARD_FONT_FAMILY` to Times. `locale_settings_linux.grd` sets it to Times New Roman.
  - `headless/lib/browser/headless_content_browser_client.cc` `OverrideWebPreferences` does not touch fonts. It sets only lazy-load and forced-colors.
  - `core/css/resolver/font_builder.cc`: the standard family comes from `Settings::GetGenericFontFamilySettings().Standard()`, so the computed value is the pref's family name.
- **Expected Linux value: `"Times New Roman"`** (quoted when serialised). **Not measured.** I did not trace why the macOS headless shell reports `Times` rather than the Blink default. A Linux run must confirm the value.
- Consequence: on Linux, the authored `font-family` would differ from `expected/`, which breaks the byte-equality workflow in S5(b). The authored-versus-compiled dual check would also fail if the emitted CSS pins `Times` explicitly.
- `font-size: 16px`: Blink's default font size is 16 on all desktop platforms (prior knowledge; `web_preferences.h` not read). It is low risk.
- UA stylesheet: Blink's `html.css` is shared across platforms. Platform differences live in LayoutTheme and form controls, which are not in this corpus (prior knowledge). Body margin 8px and `display` values are platform-neutral.
- Ahem with `line-height: normal` gives 1em on every platform because Ahem's hhea, typo and win metrics agree (T001 §6, measured).
- Remaining small risks: Linux arm64 and x64 Chromium are separate builds. Skia and LayoutUnit behave the same, and the 1/64 px quantisation does not depend on the platform (prior knowledge).

## 2. Can we get a real Linux Chrome run without an owner install?

**No.** Every route needs either an install or publishing code.

Inventory (Ran): macOS 26.6.2 on arm64, Homebrew 6.0.16, `gh` present. None of these is present: container, limactl, qemu, utm, prlctl, VBoxManage, vagrant, multipass, docker, podman, colima, orb, nerdctl or tart. Nothing relevant in /Applications, and no `~/.lima`.

| Option | Cost | Blockers |
|---|---|---|
| Apple `container` (macOS 26, Apple silicon) | Owner installs the signed .pkg from github.com/apple/container releases (admin prompt). Then `container system start`, and pull `mcr.microsoft.com/playwright:v1.58.2-noble` (arm64, about 1-2 GB). About 15-30 min. | It is an owner install. It does not need Xcode. It gives linux-arm64 Chromium, not the x64 that ubuntu-latest CI uses. |
| Lima from a Homebrew bottle (`brew install lima`, vz backend) | A prebuilt bottle, so no Xcode or cc. It downloads an Ubuntu image of about 600 MB, then needs `npx playwright@1.58.2 install --with-deps chromium` inside the VM. About 20-40 min. | Still an install (Scout is forbidden and the owner must approve). Homebrew may call git: use /opt/homebrew/bin/git, not /usr/bin/git. It is also arm64 Linux. |
| Existing VM | None | No VM product is installed. |
| GitHub Actions `ubuntu-latest` (x64, matches S5(b)) | Free minutes and the workflow file S5 already plans. Gives the canonical x64 capture. | Needs a push to a GitHub remote. That publishes code, so the owner must approve, even for a private repo. |
| Codespaces, Gitpod, e2b, Modal, remote Playwright browser servers | Free tiers exist. | Each needs the repo, or at least the fixtures and harness, uploaded to a third party plus an account or API key. That counts as publishing, so the owner must approve. StackBlitz WebContainers cannot run Chrome. |

The Xcode licence does not block Apple `container` or a Lima bottle. Accepting it helps only with local `/usr/bin/git`, cc and ld. It gives no Linux capability.

## 3. Precedent

**Prior knowledge; not re-read this session.**
- **Taffy gentest:** `cargo gentest` drives a local Chrome through chromedriver (fantoccini) on whatever machine the developer uses, and the generated tests are committed. CI does not recapture. Fixtures use a shared base CSS and Ahem. They avoid platform dependence by comparing only geometry.
- **Yoga gentest:** Chrome is driven locally and the output committed. It compares geometry only. Text goes through measure functions, not browser fonts. There is no OS pinning.
- **WPT:** tests are made platform-neutral by design (Ahem, no default-font assertions, reftests). wpt.fyi runs Chrome and Firefox mainly on Linux and Safari on macOS. They care about platform only through expectations metadata, never through OS-keyed expected values.
- Common pattern: **commit geometry captured on any OS, and make fixtures independent of platform defaults.** None of them keys expectations by OS.

## 4. Recommendation for milestone 1

1. **Decision (owner to record in decisions.md before T999):** Milestone 1's lane is "macOS-captured Chrome 145.0.7632.6 (Playwright 1.58.2 headless shell, darwin-arm64), plus the platform-free Dragon layout lane run in Node". The Linux recapture is written (S5(b), not pushed) but has not been run. The goal title's "on a Linux lane" is therefore reported as not met, and T999 must not upgrade it. Any of three owner actions upgrades it later: install Apple `container` (cheapest local route), `brew install lima`, or approve a push so the Actions workflow can run.
2. **Suggested wording for api.md §7** (replace "Linux layout verification names its actual scope"): "Milestone 1 Chrome references are captured on macOS (darwin-arm64) with Chrome 145.0.7632.6 through Playwright 1.58.2. Dragon's layout lane is platform-free TypeScript and runs in Node. A Linux recapture workflow exists, but no Linux run has passed, so reports list the Linux lane as unavailable rather than passed. Geometry fixtures are authored to be independent of platform defaults. Platform-dependent UA data is keyed by capture platform."
3. **T999 audit wording:** "Oracle lane: macOS Chrome capture plus platform-free layout. Linux lane: unavailable (not run) as the owner decided on <date>. The platform-neutrality check passed: no committed expected or emitted file depends on the capture OS other than keyed UA data."
4. **What S5 must do** (before writing the workflow in S5(b)):
   - a. Record `platform` and `arch` (process.platform and arch, plus the Playwright browser flavour) in the capture's run metadata. `capture.ts` currently records only `chrome`.
   - b. **Key the UA dataset by platform**: for example `chrome-145.darwin.generated.ts` and `chrome-145.linux.generated.ts`, or a `platform` field. The compiler picks the dataset from the reference environment, which api.md §7 already says includes fonts. The Linux entry stays "not captured" until a real run exists. Do not hand-write "Times New Roman".
   - c. **Make the corpus independent of default fonts**: the harness style block (`data-dragon-harness`, already injected on both sides) also sets `html{font-family:Ahem}`. Record it as an environment input. Alternatively, fixtures can author the root font-family. Either way, the 1231 `Times` records become `Ahem`, and emitted CSS stops pinning an OS font. Keep one explicit UA-defaults fixture (block-ua-divs) that compares font-family against the keyed dataset rather than a literal.
   - d. Add a guard test: no file in `expected/` or `emitted/` contains a platform standard-family name (Times or Times New Roman) unless it comes from the keyed dataset.
   - e. The S5(b) workflow does a byte-equality recapture on Linux only after a to d. Otherwise it fails on font-family alone.
   - f. Parallel to T030: re-running `parity:capture` and `ua:capture` for c is a committed-file change, so it belongs to the S5 Worker, not a Scout.

## Open items
- Why the macOS headless shell reports `Times` when Blink defaults to "Times New Roman" (possibly a macOS font-family resolution path). This needs a measurement, not a guess.
- Do Linux arm64 and x64 differ in any geometry? Expected no, but not measured.
