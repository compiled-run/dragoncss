# Self-hosted runners (label `dragon-mini`)

`full-test.yml` can run its chrome shards on the owner's Mac mini slots instead of GitHub's `macos-26` runners: dispatch it
with `runner=mini`. `runner=hosted` (the default) is GitHub's runners, unchanged.

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
- One non-admin macOS user per slot (`dragonrunner1`..`6`, group `dragonrunner`, not `staff` or `admin`), so a job cannot read
  the admin user's home. Before every job a root launchd daemon (`com.compiled-run.dragon-runner.slotN`) stops the user's
  processes by PID, clears its crontab and temporary files and recreates its home, so test temp folders never accumulate.
  Jobs run under `nice -n 10`, with `TMPDIR` in the slot's home.
- Shared, root-owned and read-only: the runner tarball and hook (`/opt/dragon-runner`), the WPT copy at `packages/wpt/wpt.lock`'s
  commit (`/Users/runner/wpt`, the path the hosted jobs use), and the Android SDK with the system image
  (`/opt/homebrew/share/android-commandlinetools`). A new WPT pin fails `scripts/fetch-wpt.sh` on a slot until the copy is updated.
- A slot gives vitest 3 workers (`VITEST_MAX_WORKERS`), as a `macos-26` runner has 3 cores; with `runner=mini` the chrome files
  run in `MINI_CHROME_SHARDS` shards.
- Not isolated: the network (jobs reach the LAN), memory (macOS has no per-user cap), world-readable files.

## What stays hosted, and why

- The regeneration rounds: the mini runs macOS 27, and its Chrome text rasterization differs from `macos-26`'s. Locally on
  2026-11-28, `parity:capture` and `parity:dpr-capture` matched the committed outputs byte for byte, but `parity:pixel-capture`
  rewrote 193 of 4368 PNGs (text glyph edges, largest channel delta 125), as `capture-proof.yml` found for `xcode-27`. The host
  round needs Xcode 27.0 (27A266a), which the mini lacks.
- The native shards (`ubuntu-24.04-arm`) and `platform-free`: Linux, off the critical path.

If a slot is down, a `runner=mini` job waits for it; dispatch again with `runner=hosted`.
