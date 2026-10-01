# Agent guidance

Dragon CSS compiles regular CSS straight into native view properties, and proves every supported feature against Chrome.

- **No claim without a test.** A support-list entry may be anything other than `unsupported` only if it names a passing comparison test. Missing data means unsupported.
- **Numbers decide pass or fail.** Screenshots and AI judgement are evidence only, never the gate. Never loosen a tolerance, delete a check or skip a test to make something pass. Report it instead.
- **Build-time work is TypeScript.** The compiler generates native code (Swift first, Kotlin later) that sets view properties directly, using platform mechanisms (dynamic colours, font metrics, safe areas) where they exist. On-device code never parses CSS or matches selectors. The only on-device library is the layout engine.
- **One source for both outputs.** The generated native code and the plain-data property list used by the test lanes come from the same compiler result, so they cannot disagree.
- **Remove pitfalls by design.** Platform-specific choices belong to the compiler, which resolves every element style for every reachable state from semantic analysis; web output is compiled from the same result when a native target is configured. Never ask the developer to know a platform difference the compiler can decide. See the design principles in docs/goals/milestone-1/goal.md.
- **Support facts live in the support profiles.** Import them; never restate them as literals in the compiler, docs or runtimes.
- **Before reporting work done, run `pnpm typecheck` and `pnpm test`,** and say exactly what passed.
- **Publishing needs an explicit owner directive:** npm (the `dragon` package), new remotes, and pushes to `master` other than the two cases under Landing work.
- **Write in plain, concrete language.** Comments only where the code can't show a constraint, one line at most.

## Landing work

Code reaches `master` only through a pull request that Macroscope has reviewed. The owner's standing directive allows the pushes and merges below, and nothing else.

1. **Branch from the latest `master`.** `git fetch origin`, then branch from `origin/master`, never from a stale local `master`. Work on a branch, never on `master`. Keep one change per branch. Put regenerated outputs (vectors, captures, expected files) in their own commit whose message names the command that produced them.
2. **Catch up, then verify.** Run `git fetch origin && git merge origin/master` so the branch includes everything merged while you worked, then `pnpm typecheck` and `pnpm test`.
3. **Audit, then open the PR.** Every review is paid by the size of the diff it reads, so make the first review count. Before the first push, audit every changed source and test file for these classes and fix every instance, with a test: external input used unchecked (JSON, CLI arguments, dumps, device records); error paths that pass silently; checks judged on a subset of the data; missing cleanup on failure. Keep the reviewed diff under about 150 KB and split larger work by theme. Review reads the code that produces generated or captured output, never the output: `.macroscope/ignore.md` covers it by shape (`captures/`, `generated/`, `out/`, `vectors/`, `expected-*/`, `*-oracle/`, `*.generated.*`); a PR that adds output anywhere else adds its ignore entry in the same PR. Then `git push -u origin <branch>`, then `gh pr create --base master --title '...' --body '...'`. In the body, say what changed and exactly what passed. Give a written reason for every tolerance, check, test or fixture the PR changes or removes.
4. **Read the review.** Run `pnpm pr:review <number> --wait`. It waits for CI and then for Macroscope's correctness review of the latest commit, and lists failed checks and every Macroscope finding nobody has answered. Macroscope only posts findings of Medium severity or higher, so every one it lists matters.
5. **Answer every finding.** Fix it, push, and reply `Fixed in <sha>` in its thread; or reply with why the code is intentional. Reply with `gh api repos/compiled-run/dragoncss/pulls/<number>/comments/<id>/replies -f body='...'`. Never reply only to clear the list, and never edit `.macroscope/` to silence a finding. If a fix would break a rule above, find another fix that keeps the rule, or reply with why the finding doesn't apply.
6. **Repeat until Macroscope is done.** Every push gets a new, paid review, which may find new issues, so batch a whole round's fixes into one push, and merge `origin/master` into the PR only when it conflicts or right before merging. From the third round on, re-audit every file that has had a finding, end to end, and fix every instance of each class before pushing. Go back to step 4 until a review of the latest commit leaves nothing unanswered. The loop runs unattended, with no round limit and no report to the owner. When a file keeps drawing findings, replace point fixes with a check that covers the whole class, such as a differential test against Chrome, before the next push.
7. **Merge.** When `pnpm pr:review <number>` exits 0, run `gh pr merge <number> --merge --delete-branch --match-head-commit <sha>` without asking, using the commit `pr:review` printed, so a later unreviewed push can't slip in. Then run `git pull --ff-only` in the main checkout, and call the next branch in the landing queue. Only branches being landed catch up with `origin/master`; the others wait on their own base, because every merge would make an earlier catch-up stale. Leave a running worker's worktree alone; it catches up at step 2. A failed check blocks the merge: fix the cause, or report it. Never retry until it goes green.

**Staying current while agents run.** `master` moves every time a PR merges, so:

- The main checkout follows `origin/master`: after every merge, and before dispatching new work, run `git pull --ff-only` there. Never stash, reset or discard uncommitted edits to do it; if it can't fast-forward, report why.
- Before pushing anything straight to `master`, run `git pull --rebase origin master` first.
- A long-running branch merges `origin/master` when it conflicts, and before it merges.

Two cases skip the pull request and push straight to `master`: PM board updates that touch only `docs/goals/**`, and small changes the owner asks for directly in the conversation (README wording, docs, config). Still run step 2 first.

Dispatched workers (opus-worker, goal-worker, grok, lane agents) never push to `master` and never merge. A worker that the PM has put into landing pushes its own PR branch and runs steps 4–6 itself: it reads the review, fixes and replies to every finding, and repeats until `pnpm pr:review` exits 0, then hands the PR back with the head sha. The PM opens the PR (step 3) and merges it (step 7). Every other worker finishes with a verified, committed branch and a receipt. The PM sends findings back only for branches whose worker has ended.

