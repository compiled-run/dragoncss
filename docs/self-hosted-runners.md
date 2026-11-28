# Self-hosted runners (label `dragon-mini`)

A dispatched `full-test.yml` runs its chrome shards on the owner's Mac mini slots (`runner=mini`, the default) instead of GitHub's
`macos-26` runners. `runner=hosted` is GitHub's runners, unchanged: the fallback when no slot is up. A pull request's
`fulltest` label always runs hosted.

## Only trusted dispatches reach a slot

This repository is public, and a self-hosted runner must never run pull request or fork code. Three controls hold that:

1. **The workflow asks for the label only on a dispatch.** Every `runs-on` that names `dragon-mini` is
   `github.event_name == 'workflow_dispatch' && inputs.runner == 'mini' && 'dragon-mini' || <hosted image>`. Only people with
   write access can dispatch a workflow.
2. **The workflow runs only this repository's branches there.** With `runner=mini`, `resolve` (on a hosted runner) fetches
   every branch head of this repository and refuses a `sha` none of them contains, such as a pull request's head or merge ref.
3. **The slot refuses everything else, and that is the control a pull request cannot edit.** A pull request can change the
   workflow file, so each slot runs a job-started hook (`ACTIONS_RUNNER_HOOK_JOB_STARTED`, a root-owned script on the mini,
   outside this repository). It fails the job before any step unless `GITHUB_REPOSITORY` is `compiled-run/dragoncss`,
   `GITHUB_EVENT_NAME` is `workflow_dispatch`, `GITHUB_REF` is a branch, `GITHUB_WORKFLOW_REF` is this repository's
   `full-test.yml` or `regen-on-ci.yml` at that ref, and the event payload agrees (same ref and repository, no
   `pull_request`, not a fork). A workflow cannot overwrite the `GITHUB_*` variables.

## The slots

- Repository-level just-in-time runners: each takes one job and is removed. Registration uses the admin user's `gh` auth
  (`generate-jitconfig`); the config goes to the slot in a mode-600 file and then an environment variable, never a command line.
- One non-admin macOS user per slot (`dragonrunner1`..`4` on mini-2, group `dragonrunner`, not `staff` or `admin`), so a job cannot read
  the admin user's home. Before every job a root launchd daemon (`com.compiled-run.dragon-runner.slotN`) stops the user's
  processes by PID, clears its crontab and temporary files and recreates its home, so test temp folders never accumulate.
  Jobs run under `nice -n 10`, with the user's own `/var/folders` temporary directory, as on a hosted runner.
- Shared, root-owned and read-only: the runner tarball and hook (`/opt/dragon-runner`), the WPT copy at `packages/wpt/wpt.lock`'s
  commit (`/Users/runner/wpt`, the path the hosted jobs use), and the Android SDK with the system image
  with build-tools 36.0.0 and platform android-36 (`/opt/homebrew/share/android-commandlinetools`). A new WPT pin fails `scripts/fetch-wpt.sh` on a slot until the copy is updated.
- mini-2 runs 4 slots, each giving vitest 2 workers (`VITEST_MAX_WORKERS`): it has 6 fast and 12 efficiency cores, and 6 slots
  timed out tests that pass on `macos-26`. With `runner=mini` the chrome files run in `MINI_CHROME_SHARDS` (12) shards: 4 shards (one per slot) took 37.4 min against 33.1 (run 46133336702 vs 46129976036), the files slowing under four slots kept busy throughout.
- Not isolated: the network (jobs reach the LAN), memory (macOS has no per-user cap), world-readable files.

## What stays hosted, and why

- The regeneration rounds: the mini runs macOS 27, and its Chrome text rasterization differs from `macos-26`'s. Locally on
  2026-11-28, `parity:capture` and `parity:dpr-capture` matched the committed outputs byte for byte, but `parity:pixel-capture`
  rewrote 193 of 4368 PNGs (text glyph edges, largest channel delta 125), as `capture-proof.yml` found for `xcode-27`. The host
  round pins Xcode 27.0 (27A266a); the mini has 27.2, which on landed batch 31 changed only the Swift version string in
  `lanes.json` (a separate change).
- The native shards (`ubuntu-24.04-arm`) and `platform-free`: Linux, off the critical path.

If no slot is up, a `runner=mini` job waits for one (up to 24 hours): cancel the run and dispatch again with `runner=hosted`.
