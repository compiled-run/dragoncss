<!-- Binding lane contract, owner-approved 2026-10-03 (process review). Replaces /tmp/lane-preamble.md, lane-header-2.md, resume-header.md, spec-header.md. Defaults D1–D13: notes/PM-2026-10-03.md. -->
# Dragon lane contract (binding for every lane: worker, spec author, resumer)

Read AGENTS.md and this file. Your dispatch message gives: task id, spec (if any), worktree, branch, base.
Everything else here is a default you apply without asking.

## Never
- Loosen a tolerance, delete or skip a check or test, or claim support without a passing comparison test.
- Hand-edit a generated output. Regenerate with `pnpm regen` and commit its outputs on their own,
  naming the command in the message.
- Push master, force-push, merge a PR, or write docs/goals/** (report in your receipt instead).
- Edit a file another in-flight lane owns (until `pnpm scope:check` exists: check the open PRs' file lists with `gh pr diff <n> --name-only`; when unsure, note it in your receipt).
- Run a heavy command outside `/tmp/heavy-lease.sh` (until the job queue exists): full `pnpm test`, `pnpm regen`,
  captures, wpt:run, tw:sweep. Device runs are the landing driver's job, never a lane's.

## Work
- One worktree, one branch. NO STACKS (owner, 2026-10-04): every new branch starts from origin/master, stays small
  (one theme, ~150 KB reviewed), and is built to land within about a day. If you need unlanded work, wait for it or
  have the PM fold it in; never build on top of an unlanded branch. Existing stacks drain as they are.
- Develop with targeted `vitest run <files>` and `pnpm typecheck` (no queue needed).
- At the end of the branch (owner, 2026-10-04: prove once, in the driver): one `pnpm regen` (through the queue),
  commit its outputs, run the targeted tests for what you touched plus `pnpm typecheck`, push, open the PR.
  Do NOT run the full `pnpm test` locally: the landing driver runs it once on the merged tree, reruns failing
  files alone, and sends the PR back with the exact failing tests if any fail for real. A review round reruns
  only its targeted tests (plus regen if generator inputs changed). Don't rerun a step that passed.
- Regen on CI (#124, preferred over a local regen): push your source commits and add the `regen` label to your PR (or
  `gh workflow run regen-on-ci.yml -f branch=<branch>`). Wait for the github-actions[bot] commit "Regenerate on CI: pnpm regen
  (regen-on-ci)" or the run summary "already at a fixed point; no commit", then `git pull --ff-only`. Never push to the
  branch while a regen-on-ci run is in progress (its push would be refused; label again). A local regen through the queue
  stays allowed when the runners are down or slow.
- Catch up (`git merge origin/master`, then regen) only when GitHub says CONFLICTING, the driver asks,
  or your parent has merged. Never rebuild a branch as -v2: merge its parent forward.
- Device-record tests that fail only for a missing device run are "device step pending"
  (lanes, lanes-records, device-failures, p6a-promotion, lanes-concurrent, and land.test's evidence:stamp case). Never a stop.
- A test that times out: rerun that file alone. Passes means load (record it); fails means real (stop
  landing this branch, report).

## Scope (defaults; no stop, no ruling)
- Outside your spec's file map: edit it, and list it in the PR body under "Outside the spec", one line each.
- A pinned test your change legitimately moves: retarget it, keep its intent, and list it. Since #125, registry,
  longhand, twin, suite and LGPL pins live in floor files (packages/*/test/*-floor.json, glyph-clearance-pins.json):
  a new entry is appended there (`DRAGON_FLOOR_WRITE=1` / `DRAGON_PIN_WRITE=1`; they never lower), not by editing a test.
- Floor and pin files merge structurally (#183, merge=dragon-floor; run `pnpm setup:git` once per clone): a catch-up merge takes
  the larger count and the union of names. A conflict it still leaves means a removed name, disagreeing orders or a pin changed on
  both sides: resolve it by hand, never lower a floor, and state the reason.
- Features register in per-feature files (#137/#138): codes/<feature>.ts, faults/<feature>.ts, one sorted GROUPS line,
  scripts/regen-steps/<feature>.ts. Don't edit the central lists beyond one sorted line.
- A Chrome/Skia/V8 citation: register it in docs/ports.json. LGPL files are class A
  (reference only, implement from spec, pin by test).
- A generated output you add: give it a regen step (scripts/regen.ts plus .gitattributes) or a MANUAL entry.
- A planted fault a refusal makes unobservable: mark it dormant, with a guard test proving the refusal holds
  and that the plant changes nothing.
- Reviewed diff over ~150 KB (excluding .macroscope/ignore.md paths): split at a theme seam if well over;
  otherwise ship it and state the size.

## Stop (end with a blocked receipt) only when
1. Chrome and the reference or your output disagree and you can't explain it with evidence.
2. A proof can't be built as the spec says (missing capture, impossible fixture, environment wrong with
   no process-local fix).
3. A fix would need a looser tolerance, a skipped test, or a claim without a test.
4. You need a file another in-flight lane owns.
5. Disk is under 40 GB free (`df -h /System/Volumes/Data`).
Everything else is a default above, or a note in your receipt.

## Waiting
- Start every long job (regen, full test, chains of them) DETACHED with `/tmp/job.sh <job-name> <worktree> <cmd...>`
  (e.g. `/tmp/job.sh repla-regen /tmp/dragon-repla pnpm regen`). It runs through the heavy lease in its own
  session, logs to /tmp/jobs/<job-name>.log and writes /tmp/jobs/<job-name>.done (the exit code) when finished.
  Jobs started as session background tasks get killed; detached jobs survive. Name jobs <lane>-<step>.
- Then end your turn with a receipt listing the job names. The PM's watcher resumes you when they finish.
  Never sleep-poll; never wait on anything outside your lane.
- A multi-step chain (regen, commit, test) goes in one small script run through /tmp/job.sh.

## Landing (when your dispatch says "land")
1. Audit every changed source and test file once: unchecked external input, silent error paths,
   checks judged on a subset, missing cleanup on failure. Fix with tests.
2. `git push -u origin <branch>`; `gh pr create --base <master or parent branch>`. Body: what changed, exactly
   what passed, a reason for every changed test, check, tolerance or fixture, and "🤖 Generated with [Claude Code](https://claude.com/claude-code)".
   (Until CI runs on every push, a stacked PR's base is review/<parent>, pushed at the parent's head.)
3. Review loop: `pnpm -s pr:review <n> --wait`; fix every finding with a test that fails without the fix;
   batch one round into one push; reply `Fixed in <sha>` or why it's intentional in each thread.
   No regen or device run in a round unless the fix changes generator inputs.
4. When `pr:review` exits 0, hand the PR to the landing driver (receipt with the clean head).
   The driver does the catch-up, regen, device run, test and merge. While Macroscope is at its limit, the PM
   has a review agent write the precomputed review for each queued PR's clean head before the driver lands it.

## Spec authors (read-only)
Write /tmp/specs/<task>.md:
- scope, with refusals and their diagnostic codes;
- R-rulings, each with evidence (Chrome 145 source file and function, a spec section, a measurement you
  ran, or decisions.md precedent);
- how each target is reached;
- the proofs and planted faults;
- a file map (owned, and shared with whom);
- the evidence stop conditions only;
- a PR plan of at most 2 stacked layers;
- the north-star delta;
- size and risk.
No allowed_files list, no live queue order. Open questions: answer by research; leave for the owner only
what costs money or leaves the repo.

## Resuming a killed lane
Read the dead agent's tail (`python3 /tmp/transcript-tail2.py <id> 150 first`, or the path in your dispatch) and `git status` and
`git log` in its worktrees. Treat uncommitted generated outputs as untrusted: commit sources, regen
from committed sources, commit the outputs.

## Receipt (last message)
    result: done | blocked
    task / branch / head / PR
    commands: <cmd>: pass | fail (one line each; timeouts noted)
    outside the spec: <files, one line each>
    retargeted pins: <test: old -> new, intent kept because ...>
    blocked: <which stop above, and the evidence>
    queued: <job ids still running>
Environment for every command: the job queue (and the leases) set JAVA_HOME, ANDROID_HOME and
DRAGON_WPT_DIR.
