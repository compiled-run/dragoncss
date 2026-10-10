<!-- Owner directive 2026-10-08: move agent work to the cloud at the same quality. This audit (PM, 2026-10-08) is the plan; items are numbered as below. -->

# Cloud migration audit: dragon lanes and landing driver

**Bottom line:** cloud lanes are close. They need a REST-only `pr:review`, a workflow that runs chosen test files on macOS, a session setup hook, and a rewritten lane contract. The landing driver cannot run in a cloud session at all, and cannot run on any Linux host until its regen has a CI path. Its natural home is a long `workflow_dispatch` job on ubuntu.

Nothing was changed in the repo. I deleted my scratch files in /tmp.

## Environment facts from this audit

- **Run times.** Recent full-test dispatches took 10–12 min. Branch runs of regen-on-ci took 35–42 min and master cache-warming runs about 30 min. `devices` label runs took 22–33 min.
- **CI device path never exercised.** The driver's `LAND_DEVICES=ci` path has never completed a run. The only driver dispatch, at 2026-10-08 05:28 UTC, is still queued. `/tmp/land-run.sh` defaults to `LAND_TEST=local`, and the last queue (q64) ran its devices step locally.
- **Node version.** The cloud has Node 22. `engines` requires Node ≥24, every workflow pins 24.15.0, and the Node version is part of the regen cache key. There is no `.npmrc` with `engine-strict`, so install only warns. The scripts run `.ts` files directly, which needs Node ≥22.18. I found no Node-24-only APIs. Install 24.15.0 anyway.
- **Repo settings.** The repo is public, so Actions minutes are free. `delete_branch_on_merge` is false, which is why the driver deletes branches itself.
- **Mac-only state outside /tmp.**
  - `.git/config` has `rerere.enabled=true`, with 71 recorded resolutions in `.git/rr-cache`.
  - The regen cache is 2.2 GB in `.git/dragon-regen/v2`, keyed by platform, arch and Node version.
  - Each new clone or worktree needs `pnpm setup:git` for the merge drivers. The driver sets them itself (`prepareWorktree`).

## Gap table

The "Linux?" column means the cloud box as the PM described it: Ubuntu 24.04 x86_64, Node 22, 30 GB disk, a REST-only proxy.

### Lane steps

| Step and command | Needs | Linux? | CI coverage and trigger | Gap |
|---|---|---|---|---|
| Fetch, branch, push | git | Yes | – | None. Each session is a fresh clone, so push work in progress early. |
| `pnpm setup:git` | git, node | Yes | Driver sets the same config itself | Must run in every fresh clone. No hook does it. |
| `pnpm install --frozen-lockfile` | Node 24.15.0, pnpm 10.33.2 | Works with a warning on Node 22 | ci.yml on every push | Install Node 24.15.0 in session setup. |
| `pnpm typecheck` | tsc | Yes | ci.yml on every push | None |
| vitest on packages/layout and packages/dragon (108 files) | node | Yes, ci.yml proves it on ubuntu x86_64 | ci.yml; full-test platform-free job | None |
| Cross-cutting registry tests: chrome-ports, both registry-claims, api-floor, floor-merge, macroscope-ignore | node | Yes, ci.yml runs them on ubuntu | ci.yml | None. android-profile.test.ts is in the Chrome group; nothing in its imports reaches a Chrome launch, but it is unproven on Linux. |
| vitest on the native group (30 files) | Swift 6.4.0, kotlinc 2.4.20, JDK 17 | Not proven on x86_64 (see note 1) | full-test native shards on ubuntu-24.04-arm, whole group only (`fulltest` label or dispatch) | No targeted run. Silent-pass risk (note 1). |
| vitest on the Chrome group (105 files) | macOS 26 arm64; Playwright 1.58.2 with chromium-1208 (Chrome 145.0.7632.6); kotlinc 2.4.20; the WPT copy | No (see note 2) | full-test.yml whole suite only. The `fulltest` label also runs the regen check, which takes 6 macOS jobs. | No workflow runs chosen test files on macos-26. |
| Floor and pin writes (`DRAGON_FLOOR_WRITE=1`, `DRAGON_PIN_WRITE=1`) | The writing test's platform | dragon seams and s4b, chrome-ports and the translate floors: Linux. css-escapes floor and glyph-clearance pins (pixel-reference): macOS. | None | No way to write a macOS floor or pin from the cloud. |
| `pnpm regen` | Chrome steps on macOS 26; lanes-host needs Xcode 27.0 / Swift 6.4, JDK 17 and kotlinc matching the toolchains lanes.json records | No (see note 3) | regen-on-ci.yml: `regen` label or `gh workflow run regen-on-ci.yml -f branch=` | Adding the label via `gh pr edit` uses GraphQL, so use REST. The contract's 15-minute local fallback is impossible. A run takes 35–42 min, longer than the 30-minute background limit. |
| `native:swift`, `native:kotlin` | swiftc, kotlinc | Possible, but not proven on x86_64 | full-test native shards | No targeted run |
| `native:build`, `native:smoke`, `native:gallery` for iOS | Xcode | No | Inside device-lanes `device-ci.ts one` | Only matters if a lane needs it; the contract leaves this to the driver. |
| `parity:devices`, device proof for a branch | Xcode 27.0 with the iOS 26.5 (23F77) simulator; Android emulator android-36 x86_64 with KVM | No | device-lanes.yml: `devices` label, or dispatch with `sha` (`judge` defaults to true) | Works today. The label run judges against the head's own committed records, so on a branch whose evidence stamp changed it reports a difference. Lanes should treat its `device-records` artifact as diagnostics only. Device evidence that lands comes from the driver. |
| `gh pr create` | gh | GraphQL, so it fails through the proxy | – | Use REST `POST repos/.../pulls`. |
| `pnpm pr:review <n> --wait` | gh | Fails: `gh repo view --json` and `gh pr view --json` are GraphQL | – | Port to REST. `--wait` can run longer than 30 min, so it needs a single-poll mode. |
| Replying to findings with `gh api .../comments/<id>/replies` | gh REST | Yes | – | None |
| Scope check with `gh pr diff <n> --name-only` | gh | Probably GraphQL | – | Use REST `pulls/<n>/files`. |
| `gh pr view --comments` (lane header recovery) | gh | GraphQL | – | Use REST `issues/<n>/comments` and `pulls/<n>/comments`. |
| `/tmp/job.sh`, `/tmp/heavy-lease.sh`, `/tmp/device-lease.sh` | python3 setsid, zsh, /opt/homebrew paths | No, and none is in the repo | – | The contract requires them. In the cloud, one lane has one VM, so they aren't needed. |
| Waiting via a `/tmp/jobs/*.done` watcher loop | A persistent host | No: the 30-minute cap, idle pause, and a reclaimed VM losing jobs | – | Lanes should end their turn while waiting on CI. The PM resumes them from GitHub state (run conclusion, labels). |
| Stop rule 5: `df -h /System/Volumes/Data` under 40 GB free | macOS path | No | – | The cloud disk is 30 GB in total, so the rule would always fire. |
| Spec files in `/tmp/specs/<task>.md`; resuming with `/tmp/transcript-tail2.py` | Persistent /tmp | No. The transcript script is already gone from /tmp. | – | Specs need a durable home; the resume procedure needs rewriting. |
| Catch-up merges and rerere | git and the merge drivers | Yes | – | The rerere cache isn't in cloud clones. That is not a quality issue. Turn rerere off rather than carry the cache. The driver already merges with `rerere.enabled=false`. |

**Note 1 (native group).** Bit-exact results are proven only on ubuntu-24.04-arm and xcode-27 (run 37257861551). Without the toolchains these tests report "blocked (owner tooling)" and pass. full-test.yml greps for that line; a local run does not.

**Note 2 (Chrome group).** Linux Chrome writes captures under the `linux-x64` key, and `requireReferencePlatform` fails loudly. Of the 105 files, 78 import modules that can reach Chrome or Xcode, though an import alone doesn't prove a launch. registry-claims shows the overcount: it reaches font-reference, yet ci.yml runs it on ubuntu. 27 import nothing Chrome-related and are probably Linux-safe but unproven: api-floor, chrome-pool, chrome-ports, floor-merge, land-devices-ci, land-parallel, land-supervisor, macroscope-ignore, merge-train, native-dump, north-star-accounting, paint-vectors-cli, pr-review, samples, script-conditions, sorted-merge, text-search, tmpdir-guard, text-shaper fence/gate/replay, and translate corpus-dpr, nan-canonical, rt-animator, rt-harness, rt-vectors, translate.

**Note 3 (regen).** The capture steps write `expected/${process.platform}-${arch}`. The steps that import Chrome capture code are ua, capture, dpr-capture, hit-capture, vectors, break-capture, pixel-capture, anim-capture, wpt, tw-sweep, glyph-b3, media-sweep, resize-capture and quads. The pure-node steps (grammar, notices, profile-rows, paint-vectors, native-gen and others) read the Chrome outputs. The cache never hits across platforms.

### Landing driver steps

| Step and command | Needs | Linux? | CI coverage and trigger | Gap |
|---|---|---|---|---|
| Start: `/tmp/land-run.sh`, supervisor, lock in `/tmp/dragon-land.lock`, stop via `/tmp/dragon-land.stop`, `kill -USR1`, `kill -TERM` | One persistent host | Runs on Linux, but the controls are host-local | – | Needs a cross-host lock, stop and interrupt. |
| Resolving the repo with `gh repo view --json` | gh | GraphQL | – | Proxy |
| Stale scratch branch cleanup: `git push origin :land-devices/...` | Branch deletion | Proxy rejects it | – | Proxy |
| Admission: REST check-runs, `gh pr view --json mergeable` (GraphQL), `pr:review --wait --conflicts-ok`, `land-review-lookup` reading `/tmp/land-reviews/precomputed/<pr>.json`, `gh pr diff` | gh; files the PM writes | Partly | – | GraphQL calls; the review file lives in /tmp. |
| Position merge with the floor, sorted and generated merge drivers | git, node | Yes | – | None |
| `pnpm install` in each position worktree (1.5–4 GB each) | Node 24, disk | Yes, but tight on 30 GB | – | Parallel builds want 40 GB free (`LAND_PARALLEL_FREE_GB`), so they switch off on this box. |
| `pnpm regen` (see note 4) | macOS 26 and xcode-27 | **No** | **None.** regen-on-ci.yml only takes a branch and pushes to it. | **Blocking gap.** |
| `pnpm typecheck` | tsc | Yes | – | None |
| `pnpm evidence:stamp --compare <prev>` | node; it only hashes files | Yes | – | None |
| Devices with `LAND_DEVICES=ci` (see note 5) | Dispatching and downloading; the merge and judge are node | Yes | device-lanes.yml, dispatched on master with `sha` and `judge=false` | Unproven end to end. The local fallback and the 15-min start limit are blockers (see "Can the driver run on Linux" below). |
| Regen commit, regen-only check, floors check | git, node | Yes | – | None |
| Test with `LAND_TEST=ci`: full-test.yml with `regen=false` on scratch branch `land-test/c-<sha>` | Dispatching | Yes | full-test.yml | On CI trouble the driver falls back to a local `pnpm test` under the heavy lease. On Linux the Chrome files fail and the PR gets blamed. On CI, failing files are not rerun alone, which is stricter, not looser. |
| Bisecting prefixes and proving master | As above | As above | full-test per probe (9 jobs, 4 of them macOS) | As above |
| Unproved record in `/tmp/dragon-land.unproved.json` | Persists across runs | – | – | It is lost with every fresh environment. |
| Publish: push the position to the PR branch, `waitCi`, `pr:review --wait`, Claude review lookup | git, gh | Partly | ci.yml runs on the branch push | GraphQL. A push made with GITHUB_TOKEN would not start ci.yml. |
| `gh pr merge --merge --match-head-commit`; tree check | gh | merge is GraphQL | – | Proxy |
| `retargetChildrenThenDelete`: `gh pr list --json`, `gh pr edit --base`, `gh api -X DELETE refs/heads/<branch>` | gh | GraphQL plus a branch deletion | – | Proxy |
| Failure path: `gh label create` (REST), `gh pr edit --add-label/--remove-label` and `gh pr comment` (both GraphQL) | gh | Partly | – | Proxy |
| Status and logs: `/tmp/land.status`, `/tmp/land.log`, `/tmp/land-<pr>-<step>.log`, run dir `ci-inflight-*`, `publish.json`, `merges.log` | /tmp | – | – | Must become artifacts and a job summary. |
| Shared-Mac coordination: `/tmp/dragon-train-priority`, `/tmp/dragon-train-quiet`, `/tmp/dragon-heavy.*`, `/tmp/dragon-device.lock` | Shared machine | – | device-lanes.yml creates the lock dir itself | The driver hard-codes `/tmp/heavy-lease.sh` (zsh, not in the repo) for regen and test. |
| Pipelined builder in `/tmp/dragon-land-next` | Disk | Yes | – | Disk only |

**Note 4 (driver regen).** The driver runs regen through `heavy()` and `/tmp/heavy-lease.sh` at four call sites: `regen`, `regen-carried`, `regen-after-devices` and `regen-records`. The parallel `preparePosition` path runs more regens in `/tmp/dragon-land-pos<k>`.

**Note 5 (CI device path).** The driver commits its tree apart, force-pushes it to `land-devices/pr-<n>`, dispatches the workflow, downloads `device-outcomes`, and runs `device-ci.ts merge`, which is node only. `judgeDevices` then runs `pnpm -s run parity:lanes` without run flags, which only reads files, and `gh pr view --json body` (GraphQL).

## Answers to your questions

**Can the driver run entirely on Linux with `LAND_DEVICES=ci` and `LAND_TEST=ci`?** No. Five things stop it:

1. **Regen has no CI path.** Every regen is local, up to four per position plus the parallel preparations. On Linux the captures would write the wrong platform key with different bytes, lanes-host would need the recorded Swift and Kotlin, and the cache never hits. This is the main gap.
2. **The CI paths fall back to local runs.** Both CI paths turn `CiUnavailable` into a local run (`/tmp/device-lease.sh pnpm run parity:devices`, or a local `pnpm test`). Errors from that run are treated as the PR's failure, so on Linux a CI outage gets PRs ejected.
3. **Runner queueing triggers the fallback.** `LAND_CI_START` (900 s) counts jobs that never started as "unavailable". The free plan caps macOS at 5 concurrent jobs: full-test uses 4, devices use 2 xcode-27, and regen uses 1 per run. Normal queueing behind that cap would trigger the fallback.
4. **`/tmp/heavy-lease.sh` is a zsh script outside the repo.**
5. **In a cloud session specifically:** GraphQL calls and branch deletions fail at the proxy, there is no persistence, and background jobs stop after 30 minutes.

**Is there a CI path for the driver's regen?** No; that is the gap. The building blocks exist. regen-on-ci-round already uploads `outputs.patch` per round, and `runOnCi` already handles dispatching, finding the run and downloading the artifact.

**How does a lane run a test file that needs Chrome without a Mac?** It can't today. full-test.yml runs only the whole suite, and the `fulltest` label adds the regen check, which takes 6 macOS jobs.

**How does a lane get a device proof for its branch?** Through the `devices` label (device-lanes.yml). It judges the head's committed records, and it's mainly useful as a diagnostic artifact. The device evidence that lands comes from the driver.

**Which tests in `pnpm test` need macOS?** The 105-file Chrome group in `scripts/test-shards.ts`. 78 of them import code that can reach Chrome or Xcode, though not every one launches it. The other 27 are probably Linux-safe but unproven; the list is in note 2 above. Floor and pin writes for css-escapes and glyph-clearance also need macOS.

**What /tmp state does the process depend on, and where should it move?**

| State | Where it should move |
|---|---|
| `/tmp/land-reviews/precomputed/<pr>.json` | A PR comment with a marker and the clean head sha, from an allowlisted author, read over REST |
| Queue files `/tmp/land-q*.txt` | A workflow_dispatch input (also recorded in the run summary) |
| `/tmp/dragon-land.unproved.json` | A commit status on master (`land/proof`) or a file on a state branch |
| Status, logs, run dir (`ci-inflight`, `publish.json`, `merges.log`) | Artifacts uploaded with `if: always()`, plus the job summary |
| Stop file and USR1 | A `land-stop` label on a tracking issue, set and cleared over REST |
| Lock | A workflow `concurrency: land` group |
| Leases, priority and quiet files | Not needed |
| `/tmp/jobs` and the PM watcher | GitHub run and PR state |
| Specs | The repo (docs/goals, committed by the PM) or a GitHub issue |
| rerere cache | Don't carry it; set `rerere.enabled=false` |
| `.git/dragon-regen` regen cache | Already handled by the Actions cache |

**Does AGENTS.md or the lane contract assume a local Mac?** Yes, in many places:

- **AGENTS.md:**
  - The rule "run `pnpm typecheck` and `pnpm test`" before reporting done. A Linux `pnpm test` fails the Chrome files.
  - Step 2 says to run `pnpm regen`, then `pnpm test`.
  - Step 7 depends on /tmp files, `kill` signals, and the main checkout's `git pull --ff-only`.
- **The lane contract:**
  - The heavy-lease rule and the "through the queue" regen.
  - The 15-minute local regen fallback ("the Mac is mostly idle").
  - The whole Waiting section (`/tmp/job.sh`, `/tmp/jobs`).
  - Stop rule 5.
  - `/tmp/specs` and `transcript-tail2.py`.
  - The environment line about the queue setting `JAVA_HOME`, `ANDROID_HOME` and `DRAGON_WPT_DIR`.
  - The GraphQL `gh` commands.
  - The reference to `notes/PM-2026-10-03.md`, which is not in the repo.
- **The lane header:** its `.done` watcher loops, `device-lease.sh`, `ps`, `/tmp/dragon-land.stop`, and `gh pr view --comments`.

### (a) Every `gh` call, and whether it uses GraphQL

GraphQL, so it fails through the proxy:
- `gh repo view --json`: land.ts:1221 and :439, pr-review.ts:51
- `gh pr view --json`: land.ts:217, :339, :569; pr-review.ts:49, :56, :88, :99; merge-train.ts:69
- `gh pr list --json`: land-lib.ts:413
- `gh pr edit --base`: land.ts:562, land-lib.ts:425
- `gh pr edit --add-label` and `--remove-label`: land.ts:1060, :1072
- `gh pr comment`: land.ts:1074
- `gh pr merge`: land.ts:500, merge-train.ts:210 (which also uses `--delete-branch`)
- `gh pr create` and `gh pr view --comments`, used by lanes
- Probably `gh pr diff` (land.ts:489, and lanes' `--name-only`). It may take a REST fast path when given a number, so check that through the proxy.

REST, so it works through the proxy:
- `gh api` check-runs and comments: land.ts:221, pr-review.ts:62 and :148
- `gh api -X DELETE refs`: land-lib.ts:445 (REST, but it is a branch deletion, which the proxy rejects)
- `gh run list/view/cancel/download` and `gh workflow run`: land-devices-ci.ts:180–239, land.ts:379, :425, :441–443
- `gh label create`: land.ts:1070
- Lanes' comment replies

The `gh` calls inside workflows (regen-on-ci's `gh api`, `gh workflow run`, `gh pr edit --remove-label`) run on GitHub runners and are not affected by the proxy.

### (b) Branch deletions

The driver deletes the merged PR branch (land-lib.ts:445) and its scratch branches (land.ts:374, :446, :1450). Under the proxy all of these fail. So the driver must run somewhere with full GitHub access: a GitHub Actions job or the Mac. Porting the GraphQL calls to REST is still needed either way, so the code doesn't depend on where it runs.

### (c) Review JSON, queues and rerere

These must not live in /tmp. The destinations are in the /tmp state table above.

### (d) Where the driver should run

A GitHub Actions `workflow_dispatch` job on ubuntu-latest is feasible, and it is the right home. The driver already dispatches every macOS job; only regen remains to move. Things to get right:

- **The 6-hour job limit.** A batch takes about 1.5–4 h: regen around 40 min per position (in parallel), devices about 30 min, full test about 12 min, then publish. But the configured waits (`LAND_TEST_WAIT` 6 h 15 min, `LAND_CI_WAIT` 90 min) exceed 6 h. So the driver should run one batch per job, with a time budget, and re-dispatch itself with the rest of the queue. GITHUB_TOKEN is allowed to trigger `workflow_dispatch`.
- **The token.** Use a GitHub App or PAT secret, not GITHUB_TOKEN. Pushes made with GITHUB_TOKEN start no ci.yml run, so the publish step's CI wait would time out. Merges made with it would also not trigger the master push workflows.
- **Interrupts.** Cancelling a run gives only SIGINT, then SIGTERM about 7.5 s later. "A merge in progress finishes first" can't be guaranteed, so the next run must reconcile from GitHub's merged state.
- **Disk.** A runner has about 14 GB free, or about 30 GB after cleanup. Turn parallel position worktrees off, or keep them light now that regen is remote.
- **Fallback.** The Mac running the same `land.yml` as a self-hosted runner (no 6-hour limit) stays available as a fallback.

## Prioritized changes

Each item is one PR. [L] blocks cloud lanes; [D] blocks a cloud landing driver.

1. **[L] Session bootstrap.** Add `.claude/settings.json` (a SessionStart hook) and `scripts/cloud-setup.sh`. The script installs Node 24.15.0 and pnpm 10.33.2, then runs `pnpm install --frozen-lockfile` and `pnpm setup:git`. Also add `git config rerere.enabled false` to the `setup:git` script in package.json.
2. **[L][D] REST-only GitHub access.** Port `scripts/pr-review.ts` from `gh repo view` and `gh pr view` to `gh api repos/{repo}/pulls/{n}` and `/commits`. Take the repo from `GH_REPO` or the origin URL, and map `mergeable_state: dirty` to CONFLICTING. Add `--once`, a single poll with distinct exit codes for clean, open and pending, so a session can poll in pieces under 30 minutes. Add `scripts/gh-rest.ts` helpers, used by land.ts and land-lib.ts:
   - create a PR
   - list a PR's files (this can be `pnpm scope:check`)
   - add and remove labels
   - comment
   - change a PR's base
   - list open PRs on a base branch
   - merge with a `sha` guard
   - fetch a PR's body

   Update the tests in `packages/parity/test/pr-review.test.ts` and `land.test.ts`.
3. **[L] `.github/workflows/test-files.yml`.** `workflow_dispatch` inputs: `ref`, `files`, and an optional `floor_write`. Add a `group-files` mode to `scripts/test-shards.ts` to route each file to its group's runner: macos-26 with the Chrome job's setup, ubuntu-24.04-arm with Swift and Kotlin, or ubuntu. Keep the "No native run was blocked" grep. Fail if any requested file didn't run. Upload the vitest JSON, and with `floor_write`, a patch of the floor and pin files. Set run-name to "test files of <sha>".
4. **[L] Stop silent native passes.** Add an opt-in `DRAGON_REQUIRE_NATIVE=1` that makes "blocked (owner tooling)" a failure (`packages/translate/src/native.ts`), and set it in cloud-setup. This is stricter, not looser.
5. **[L] Rewrite the lane contract for the cloud** (`docs/goals/milestone-2-proof/lane-contract.md`, AGENTS.md steps 2–4, the lane header).
   - Regen only through regen-on-ci, with no local fallback.
   - Targeted macOS tests through test-files.yml.
   - Wait by ending the turn rather than with watchers.
   - Drop job.sh and the leases.
   - Replace stop rule 5.
   - Move specs to the repo or issues.
   - Use REST commands.
   - Fix the AGENTS.md "run `pnpm test`" rule so it means the driver's full-test.
   - Fix the dangling notes/ reference.
6. **[D] Regen on CI for the driver.**
   - `regen-on-ci.yml`: add a `sha` input in a patch mode (no push job; run-name "regen of <sha>"). Its cache must be restore-only, matching full-test.yml's rule against saving at master scope from an unreviewed tree.
   - `scripts/land-devices-ci.ts`: add a `REGEN_WORKFLOW` entry (artifact `sweep`/`outputs.patch`) and let `scratchRef` accept `land-regen/c-<sha>`.
   - `scripts/land.ts`: add `LAND_REGEN=ci` for the four `heavy(...REGEN)` call sites and `preparePosition`, applying the patch with `git apply --binary --index`.
   - Add tests.
7. **[D] CI-only mode with no local fallback.** In `scripts/land.ts`, `land-lib.ts` and `land-devices-ci.ts`, add `LAND_DEVICES`/`LAND_TEST` = `ci-only`. In that mode `CiUnavailable` stops the run and requeues, with no PR blamed. Skip the HEAVY and DEVICE leases and the quiet-machine logic. Don't count jobs queued behind the macOS cap as "never started", or raise `LAND_CI_START`.
8. **[D] Move driver state out of /tmp.**
   - `scripts/land-review-lookup.ts`: read the review from a PR comment with a marker, the clean head sha and an allowlisted author.
   - Unproved record: a `land/proof` commit status.
   - Stop: a `land-stop` issue label.
   - Status and logs: artifacts plus the job summary.
9. **[D] `.github/workflows/land.yml`.** Input: `queue`. ubuntu-latest, `concurrency: land`, `timeout-minutes` around 350. Use an App token. Run one batch per job and re-dispatch the remainder. Upload state with `if: always()`. Reconcile from GitHub on start.
10. **Proof run before switching the driver.** Run `LAND_DEVICES=ci` end to end at least once, from the Mac, before switching to land.yml.
11. **Optional proofs.** Run the native group once on ubuntu-latest x86_64 with swift.org 6.4.0 x86_64, so cloud lanes could run native files locally. Run the Chrome group once on ubuntu, then record a Linux-safe list in `test-shards.ts` with a CI check that keeps it true.

Items 1–5 unblock cloud lanes, and lanes can move once those land. The driver needs items 2 and 6–9, and item 10 is the safety check before relying on land.yml. Until those land, the driver should stay on the Mac with `LAND_DEVICES=ci` and `LAND_TEST=ci`. That still needs items 2 and 8 so the PM can feed it queues and reviews from the cloud.

## Parity proof on master d9386187d0 (2026-10-08)

**full-test 37732571447:** all 13 jobs passed. That includes the regen fixed-point check (regen-chrome on macos-26 and regen-host on xcode-27), so CI regenerates master's committed outputs byte for byte.

**device-lanes 37732567961:** compared with the records the Mac committed when #91 landed.
- iPhone 17, iPad (A16), dragon-320 and dragon-smoke have identical verdicts on every lane. The known pixel failures match exactly, down to the RGB values in the detail text, even though CI Android runs x86_64 and the Mac runs arm64; both use the swiftshader renderer.
- dragon-480 was blocked by a flake: a System UI ANR during settle, with no retry.
- No earlier CI device failure was a difference from the Mac's verdicts. Each was a workflow bug since fixed, or an sdkmanager download flake.

**Gaps found:**
- **(R1) Tooling faults blame the PR.** A tooling-blocked device or a timed-out job counts as a verdict, so LAND_DEVICES=ci would eject the PR being landed. Fix: a separate tooling exit code and step, mapped to CiUnavailable. PR: ci-device-reliability.
- **(R2) Too few retries.** Settle, installs, brew, pnpm and the Xcode platform download need bounded retries. PR: ci-device-reliability.
- **(R3) Android records are tied to the arm64 image.** The first CI landing needs LAND_ARCH_REBASELINE. After that, a fallback to the local arm64 run must never happen under LAND_DEVICES=ci; it should re-dispatch or stop. To be done with item 7.
- **(R4) No proof of raw dump equality.** Upload per-case dump hashes without the device header, and explain why the iOS frame and pixel hashes changed between 5b94e4354f and d9386187d0. PR: ci-device-reliability.

## Security ruling for the Actions landing driver (2026-10-08)

Review of #225 found that a driver job holding the merge token while it ran merged-tree code (pnpm install scripts, typecheck, the tree's own merge drivers) would let any PR or dependency steal the token and push to master. Master has no branch protection today. The local Mac driver has the same exposure with the owner's credentials.

**Ruling:**
- The token job never runs tree code. It works from a trusted master checkout with persist-credentials false, uses the trusted merge drivers by absolute path, and passes the token to each push and gh call only. All tree code runs in dispatched workflows that have no secrets.
- Reviews are trusted only from unedited comments by allowlisted numeric user ids, never from the token's identity.
- One driver at a time across hosts.

**Owner setup before enabling:**
- a `land` Environment restricted to master, holding LAND_TOKEN (a GitHub App preferred)
- a master ruleset requiring PRs
- a reviewer identity separate from the token's

#225 is split: A is the state-out-of-/tmp work, B is land.yml with the split design.

## Trust boundary (security review of #226, 2026-10-08)

- **Tree-produced verdicts are correctness signals, not security controls.** A PR's own code runs inside full-test, regen-on-ci, device-lanes and land-checks, so a malicious tree can forge its own results. That is true on the Mac driver today as well. What the driver checks on that data still holds: the regen commit is regen-only, floors never fall, and the merged tree matches.
- **Security rests on three things:**
  1. review of everything that executes, including package.json, which is now reviewed
  2. a master ruleset requiring PRs (owner setup)
  3. tree-controlled bytes, symlinks included, never touching the token job's filesystem or processes. The token job runs no pnpm and no tree code, its trusted checkout is read-only, and it never follows symlinks.
- Generated code such as grammar.generated.ts and the profiles still reaches master unreviewed. That is not a token risk, but it is accepted because the regen-only check and the review of its generator cover it.

## land-checks session-kill proof (2026-10-08)

On a throwaway tree, the `typecheck` script started a background process that overwrote `$RUNNER_TEMP/land-checks/result.json` and the parts file every second for 120 s. land-checks run 37765094196 succeeded, and its uploaded `result.json` was intact (typecheck status 0, the correct sha). So the per-session `pkill -s` killed the stray before the results were assembled. An earlier run, 37764921871, planted a plain background sleep and finished in 60 s. The throwaway branch has been deleted.

## Status 2026-10-08 08:05: code complete

Landed: #217, #219, #220, #221, #222, #223, #224, #225, #226, #227. #227 brought CI device reliability, explicit block reasons, and the iOS warm-up; CI's iOS per-case hashes now equal the Mac's.

**Remaining before cloud lanes and the Actions driver:**
1. Owner setup:
   - restrict the `land` Environment to master and add LAND_TOKEN (App token preferred)
   - a master ruleset requiring PRs
   - vars LAND_STOP_ISSUE, LAND_REVIEWERS (an identity separate from the token's) and LAND_PROOF_WRITERS
2. A first real land.yml landing, which includes the one-time Android arm64-to-x86_64 rebaseline.
3. A first cloud lane session, to confirm the cloud-setup hook and GraphQL-free gh in a real cloud VM.

## First real cloud session (2026-10-08)

- Session setup worked: Node 24.15.0, pnpm 10.33.2, DRAGON_REQUIRE_NATIVE=1, rerere off, merge drivers set.
- Install, typecheck and platform-free tests passed locally.
- ci:test-files run 37801867068 put chrome-ports on macos-26 and native-backends on ubuntu-24.04-arm (Swift 6.4, kotlinc 2.4.20), and both passed.
- pr:review over REST worked. GraphQL is refused (HTTP 403), as expected; the contract is updated.
- **Bug found:** packages/dragon/test/native-backends.test.ts trapRun passes "blocked" without consulting requireNative(). A whole-class fix is in progress on branch strict-native-class.
- To read runner labels, use `gh api repos/compiled-run/dragoncss/actions/runs/<id>/jobs --jq '.jobs[] | "\(.name) \(.labels)"'`; `gh run view --json jobs` returns null labels.

## Follow-up: strengthen the strict-native guard

#228 fixed every current site where a missing toolchain passed silently. Its AST guard, though, misses many hypothetical shapes:
- aliased imports and helper functions
- tool variables not named `tool`
- `command -v` through `sh -c`
- `existsSync` on SDK paths
- positive guards (`if (tool !== null) { assertions }`)
- try/catch returns and ternaries
- `skipIf` on a variable
- anything under scripts/

Better: a runtime check. Under DRAGON_REQUIRE_NATIVE=1, every native-group test must record that it actually ran a toolchain, enforced by a vitest setup file. Low priority, since none of these shapes exist today.

## Cloud landing replaces the Mac driver (2026-10-09)

The owner asked that landing never depend on the Mac. The Mac driver at /private/tmp/dragon-land is retired; land.yml is the only driver.
- **Token:** a GitHub App, not a PAT. The precomputed Claude reviews are posted from cloud sessions as the owner's account, so the merging identity must be another one (checkNotReviewer). The driver mints an hour-long installation token from `vars.LAND_APP_ID` and `secrets.LAND_APP_PRIVATE_KEY` in the `land` environment whenever the one it holds has under 15 minutes left (scripts/land-app-token.ts), and takes its own identity from the App's bot user. LAND_TOKEN still works for a PAT.
- **Defaults:** LAND_REVIEWERS defaults to the owner's id 104264123 and LAND_STOP_ISSUE to #244, so no repository variables are needed.
- **Owner setup left:** create and install the App, put its id and key in the `land` environment restricted to master, and add the master ruleset requiring PRs.
