<!-- Binding lane contract, owner-approved 2026-10-03 (process review: notes/PM-2026-10-03.md, "Owner decisions on the process review"). That note's D1–D13 table was never filled in; the defaults are the Work and Scope sections below. Rewritten for cloud sessions 2026-10-08 (notes/cloud-migration.md, item 5): every rule is kept; only how it is met changed. -->
# Dragon lane contract (binding for every lane: worker, spec author, resumer)

Read AGENTS.md and this file. Your dispatch message gives: task id, spec (if any), branch, base.
Everything else here is a default you apply without asking.

Lanes run in Claude Code cloud sessions: Ubuntu x86_64, 4 vCPU, 16 GB RAM, 30 GB disk, a fresh clone per session, no
macOS, Chrome, Swift or Kotlin. A command may run for at most 30 minutes, and an idle session pauses and loses its background
jobs. The SessionStart hook (`scripts/cloud-setup.sh`) installs the pinned Node and pnpm, runs `pnpm install` and
`pnpm setup:git`, and exports `DRAGON_REQUIRE_NATIVE=1`, so a native test with no toolchain fails instead of passing as
"blocked". Anything that needs macOS or the native toolchains runs on GitHub Actions. Where the local Mac differs, the
"Local Mac" section at the end says how; both paths are valid. The cloud path applies once #219 (session setup),
#221 (`pnpm ci:test-files`) and #222 (the driver's `LAND_CI=only`) are on master; until then lanes run on the Mac.

## GitHub commands (REST)
The cloud's GitHub proxy refuses GraphQL (confirmed 2026-10-08: `gh pr view` gets HTTP 403), and `gh pr create`, `gh pr view`,
`gh pr edit` and `gh pr diff` all use it. Always use these `gh api` forms in the cloud; `pnpm pr:review` is REST-only. `R=repos/compiled-run/dragoncss`.

**Session permissions (confirmed 2026-10-08).** GitHub's proxy allows a plain push to an existing PR branch and REST writes,
but a cloud session's own permission check asks before each kind of write (git push, adding a label, replying to a review
comment, editing a PR). A write it refuses is a stop: report the exact command and wait for the owner to approve it or for
the PM to do it. Never work around a refusal. Start a lane session on its PR's branch when you can.
- Create a PR (write the body to a file outside the worktree first):
  `gh api $R/pulls -f base=master -f head=<branch> -f title='...' -F body=@<body-file> --jq .number`;
  update its body later: `gh api -X PATCH $R/pulls/<n> -F body=@<body-file> --jq .number`
- Head sha and conflict state (`dirty` means CONFLICTING; `unknown` means GitHub is still computing it, so poll again in a
  minute): `gh api $R/pulls/<n> --jq '.head.sha, .mergeable_state'`
- Files a PR changes: `gh api --paginate "$R/pulls/<n>/files?per_page=100" --jq '.[].filename'`
- Open PRs and their branches: `gh api --paginate "$R/pulls?state=open&per_page=100" --jq '.[] | "\(.number) \(.head.ref)"'`
- PR comments: `gh api --paginate "$R/issues/<n>/comments?per_page=100" --jq '.[] | "\(.id) \(.user.login): \(.body)"'`
- Review comments (findings and their threads):
  `gh api --paginate "$R/pulls/<n>/comments?per_page=100" --jq '.[] | "\(.id) reply-to=\(.in_reply_to_id) \(.user.login) \(.path):\(.line): \(.body)"'`
- Reply to a review comment: `gh api $R/pulls/<n>/comments/<id>/replies -f body='Fixed in <sha>'`
- Add a label: `gh api $R/issues/<n>/labels -f 'labels[]=regen'`; remove one: `gh api -X DELETE $R/issues/<n>/labels/regen`
- Checks on a commit: `gh api "$R/commits/<sha>/check-runs?per_page=100" --jq '.check_runs[] | "\(.name) \(.status) \(.conclusion)"'`

## Never
- Loosen a tolerance, delete or skip a check or test, or claim support without a passing comparison test.
- Hand-edit a generated output. Regenerate on CI (Work, below) and commit its outputs on their own, naming the command.
- Push master, force-push, merge a PR, or write docs/goals/** (report in your receipt instead; spec authors, see below).
- Edit a file another in-flight lane owns (until `pnpm scope:check` exists: list the open PRs and their files with the
  commands above; when unsure, note it in your receipt).
- Run `pnpm regen`, the full `pnpm test`, captures, wpt:run or tw:sweep in a cloud session: they need macOS and would write
  wrong outputs or blame the wrong thing. Device runs are the landing driver's job, never a lane's.
- In a cloud session, claim a Chrome or native test file passed unless `pnpm ci:test-files` reported it passing. (On the
  Mac, a local run of the file counts.)

## Work
- One branch. NO STACKS (owner, 2026-10-04): every new branch starts from origin/master, stays small
  (one theme, ~150 KB reviewed), and is built to land within about a day. If you need unlanded work, wait for it or
  have the PM fold it in; never build on top of an unlanded branch. Existing stacks drain as they are.
  Exception (PM, 2026-10-05, so lanes don't idle behind the landing queue): once a parent PR is reviewed and in a landing
  queue, you may prepare the next slice on a branch based on the parent's queued head. Push it (the VM can be reclaimed),
  but open no PR and request no regen until the parent has merged. Then merge origin/master in, regen, and open the PR
  against master. If the parent's head changes, merge the parent's new head into your prep branch (AGENTS.md step 2);
  never rebase a pushed branch.
- Push work in progress early and often: the VM can be reclaimed, and anything not pushed is lost. Commit sources only;
  regenerated outputs come from CI.
- Develop with targeted tests and `pnpm typecheck`. Find a test file's group with
  `node scripts/test-shards.ts group-files <file>...`:
  - `platform-free` (packages/layout, packages/dragon): run it locally with `pnpm vitest run <files>`.
  - `chrome` and `native`: push, then `pnpm ci:test-files <full head sha> <files...> --once` (it runs Chrome files on
    macos-26 and native files on ubuntu-24.04-arm). Give the pushed head's full sha, not the branch, so the run's title and
    its `tested <ref> at <sha>` line name the exact commit. Exit codes: 0 passed, 1 failed, 2 error, 3 pending; it prints the
    run id. Poll it again with `pnpm ci:test-files --run <id> --once`.
- Regen only on CI, with no local fallback, through `pnpm ci:regen <branch>` (regen-on-ci.yml in branch mode). It works
  whether or not your PR conflicts, since it is a dispatch, not a pull_request event. Push your source commits, then run
  `pnpm ci:regen <branch> --head <full head sha> --once`. It dispatches a run named `regen of branch <branch> at <sha>
  (<nonce>)` (or reuses the run already going for that head), and the run refuses to regenerate or push a branch that is not
  at that sha. A run takes about 35–45 minutes. Exit codes: 0 done, printing `regen commit <sha>` (pushed on top of your
  head) or `head <sha>` ("already at a fixed point; no commit"); 1 failed, printing the failing step and its error; 2 error
  (a usage or gh error, a cancelled run, a run that is not the one asked for); 3 pending. It prints the run id; poll again
  with `pnpm ci:regen <branch> --run <id> --once`, or run the first command again: with the same `--head` it finds the same
  run by its name, even after the run's regen commit moved the branch on.
  After exit 0, `git pull --ff-only`. Never push while the run is in progress (it would fail with "moved during the run"
  and push nothing). If it fails, fix the cause, push, and run it again. If the runners are down, wait and say so in your
  receipt. Find a lane's regen runs after a pause:
  `gh api "$R/actions/workflows/regen-on-ci.yml/runs?event=workflow_dispatch&per_page=100" --jq '.workflow_runs[] | select(.display_title | startswith("regen of branch <branch> at ")) | "\(.id) \(.status) \(.conclusion) \(.display_title)"'`
  Alternative, the `regen` label on your PR (above): it starts a run only while GitHub does not call the PR conflicting
  (`mergeable_state` `dirty`), because GitHub skips pull_request workflows on a PR that can't merge, and a master regen that
  rewrites a generated file the PR also changes (usually `packages/parity/out/lanes.json`) makes it conflict. Find a label
  run (other labels' events add skipped runs, which this drops):
  `gh api "$R/actions/workflows/regen-on-ci.yml/runs?branch=<branch>&event=pull_request&per_page=100" --jq '[.workflow_runs[] | select(.conclusion != "skipped")][0:3][] | "\(.id) \(.status) \(.conclusion) \(.head_sha) \(.created_at)"'`
  The newest line is yours when its head_sha is the head you labeled. It is done when that run is `completed success` and
  the branch has the github-actions[bot] commit "Regenerate on CI: pnpm regen (regen-on-ci)", or the run summary says
  "already at a fixed point; no commit". If it fails, fix the cause, push, then remove the label (the workflow removes it
  only after a success) and add it again.
- At the end of the branch (owner, 2026-10-04: prove once, in the driver): audit and push, open the PR (Landing, below),
  regenerate with `pnpm ci:regen <branch>` (above) and pull its commit, then run `pnpm typecheck` and the targeted tests for
  what you touched on the regenerated head, and update the PR body with exactly what passed. Always include the cross-cutting
  registry tests:
  `packages/parity/test/chrome-ports.test.ts` (every Chrome citation is in docs/ports.json), both `registry-claims.test.ts`,
  and the iOS and Android profile tests if you promote native rows. Route each by its group: chrome-ports and parity's
  registry-claims are in the Chrome group (ci:test-files); `packages/dragon/test/registry-claims.test.ts` is platform-free
  (local). Chrome-ports failed #197 at landing (2026-10-05).
  Do NOT run the full `pnpm test`: the landing driver runs it once on the merged tree, and sends the PR back with the
  exact failing tests if any fail for real. A review round reruns only its targeted tests (plus a regen if generator inputs
  changed). Don't rerun a step that passed.
- Catch up (`git merge origin/master`, then regen) only when GitHub says CONFLICTING (`mergeable_state` `dirty`; poll again
  while it is `unknown`), the driver asks, or your parent has merged. Never rebuild a branch as -v2: merge its parent forward.
- Device-record tests that fail only for a missing device run are "device step pending"
  (lanes, lanes-records, device-failures, p6a-promotion, lanes-concurrent, and land.test's evidence:stamp case). Never a stop.
  The `devices` label (device-lanes.yml) runs the device lanes for a branch as a diagnostic only; the device evidence that
  lands comes from the driver.
- A test that times out: rerun that file alone (on CI if it is a Chrome or native file). Passes means load (record it);
  fails means real (stop landing this branch, report).

## Scope (defaults; no stop, no ruling)
- Outside your spec's file map: edit it, and list it in the PR body under "Outside the spec", one line each.
- A pinned test your change legitimately moves: retarget it, keep its intent, and list it. Since #125, registry,
  longhand, twin, suite and LGPL pins live in floor files (packages/*/test/*-floor.json, glyph-clearance-pins.json):
  a new entry is appended there (`DRAGON_FLOOR_WRITE=1` / `DRAGON_PIN_WRITE=1`; they never lower), not by editing a test.
  For a floor or pin a Chrome or native test writes, use `pnpm ci:test-files <full head sha> <files...> --floor-write` and apply
  the patch it prints.
- Floor and pin files merge structurally (#183, merge=dragon-floor; `pnpm setup:git`, which the session hook runs): a catch-up
  merge takes the larger count and the union of names. A conflict it still leaves means a removed name, disagreeing orders or a
  pin changed on both sides: resolve it by hand, never lower a floor, and state the reason.
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
5. The session's disk has under 5 GB free (`df -h .`) after you remove your own build outputs.
Everything else is a default above, or a note in your receipt.

## Waiting
- Never keep a session busy waiting on CI. Start the CI work (a push, a ci:regen or ci:test-files dispatch), poll
  once, and if it is still running, end your turn with a receipt that names what you wait on (PR, run ids). The PM resumes
  you; on resume, read the state from GitHub (the commands above), not from memory.
- Every command must finish within 30 minutes: use `--once` with ci:test-files, ci:regen and `pnpm pr:review <n>`. A short wait may repeat a single poll in the foreground, bounded under 25 minutes, e.g.
  `for i in 1 2 3 4 5 6 7; do pnpm -s ci:test-files --run <id> --once; s=$?; [ $s -ne 3 ] && break; sleep 180; done; echo exit=$s`.
- No background watchers, /tmp/job.sh, leases or `.done` files: background jobs die when the session pauses.
- Never wait on anything outside your lane.

## Landing (when your dispatch says "land")
1. Audit every changed source and test file once: unchecked external input, silent error paths,
   checks judged on a subset, missing cleanup on failure. Fix with tests.
2. `git push -u origin <branch>`, then create the PR with the REST command above (base master). Body: what changed, exactly
   what passed (with the ci:test-files run URLs), a reason for every changed test, check, tolerance or fixture, and
   "🤖 Generated with [Claude Code](https://claude.com/claude-code)".
3. Review loop: `pnpm -s pr:review <n> --once` (one poll over REST: exit 0 clean, 1 not clean, 2 still pending: CI, the
   review or GitHub's mergeability not settled yet); fix every finding with a test that fails without the fix; batch one
   round into one push; reply `Fixed in <sha>` or why it's intentional in each thread (REST reply above). No regen or device
   run in a round unless the fix changes generator inputs. On exit 2, poll again later (end your turn if it's long). Never
   claim clean without a pr:review exit 0.
4. Hand the PR to the landing driver (READY, below) only when all of these hold for one head sha, the PR's current head
   (`gh api $R/pulls/<n> --jq .head.sha`):
   - `pr:review` exits 0 on it;
   - its regen run finished with that sha as its result (the bot's commit, or "already at a fixed point; no commit" for that
     sha), or no regen was needed because no generator input changed since the last one;
   - `pnpm typecheck` passed on it;
   - every targeted test passed on it: platform-free files locally, the rest through ci:test-files runs whose
     `tested <ref> at <sha>` line names that sha. pr:review can't see these runs (their checks are filed under master), so
     they are the lane's to prove. A push after any of them (a review fix, a merge) means running them again on the new head.
   The READY report lists that sha and the URL of each regen and ci:test-files run.
   The driver does the catch-up, regen, device run, full test and merge (on CI when the PM runs it with `LAND_CI=only`). While Macroscope is at its
   limit, the driver also needs a precomputed Claude review of each queued PR's clean head; the PM provides it (today a file the
   driver reads; plan item 8 moves it to a PR comment). Lanes don't write it.

## Spec authors (read-only)
Write the spec as docs/goals/milestone-2-proof/notes/<task>-spec.md on a branch `spec/<task>` from origin/master, push it,
and open no PR. The PM commits it to master as a board update; this is the one docs/goals/** write a lane makes. Contents:
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
A new session has only what reached GitHub. `git fetch origin`, check out the lane's branch, and read its state: `git log`,
the PR (head, conflict state, comments, review comments, labels) with the commands above, its checks, and its CI runs
(regen runs with the commands in Work; the ci:test-files runs of a head, whose titles
carry the sha you gave:
`gh api "$R/actions/workflows/test-files.yml/runs?event=workflow_dispatch&per_page=100" --jq '.workflow_runs[] | select(.display_title | startswith("test files of <sha> ")) | "\(.id) \(.status) \(.conclusion) \(.html_url)"'`).
Don't redo finished work. Treat generated outputs that did not come from a regen-on-ci commit as untrusted: regen on CI.

## Receipt (last message)
When a PR meets Landing step 4, the first line is `READY <branch>:<pr>:<full clean head sha>`, and the `commands` lines name
that sha, the regen run URL (or why none was needed) and every ci:test-files run URL.

    result: done | blocked | waiting
    task / branch / head / PR
    commands: <cmd or CI run URL>: pass | fail (one line each; say which ran locally and which on CI; timeouts noted)
    outside the spec: <files, one line each>
    retargeted pins: <test: old -> new, intent kept because ...>
    blocked: <which stop above, and the evidence>
    waiting on: <PR checks, regen or ci:test-files run ids still running>

## Local Mac (alternative path; still valid)
A lane on the local Mac meets the same rules this way:
- Worktrees under /tmp, one per branch; `git -C <worktree>` for git commands.
- Heavy commands (full `pnpm test`, `pnpm regen`, captures, wpt:run, tw:sweep) run only through `/tmp/heavy-lease.sh`, and long
  jobs detached with `/tmp/job.sh <lane>-<step> <worktree> <cmd...>` (log in /tmp/jobs/<name>.log, exit code in
  /tmp/jobs/<name>.done). The job queue sets JAVA_HOME, ANDROID_HOME and DRAGON_WPT_DIR.
- Chrome and native test files may run locally with `pnpm vitest run <files>`; ci:test-files is optional.
- Regen on CI is preferred. If a regen-on-ci run has been queued for 15 minutes or more, `pnpm regen` through /tmp/job.sh is
  allowed; commit its outputs and push.
- Waiting: a background watcher on the job's .done file, or end the turn and let the PM's watcher resume you.
- `gh pr create`, `gh pr view` and `pnpm pr:review <n> --wait` work there.
- Stop rule 5 is disk under 40 GB free (`df -h /System/Volumes/Data`).
- Resuming also reads the dead agent's transcript tail and `git status` in its worktrees: commit uncommitted sources, never
  uncommitted generated outputs, and regenerate from the committed sources.
