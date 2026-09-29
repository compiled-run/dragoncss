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

1. **Branch.** Work on a branch, never on `master`. Keep one change per branch. Put regenerated outputs (vectors, captures, expected files) in their own commit whose message names the command that produced them.
2. **Verify.** Run `pnpm typecheck` and `pnpm test` before pushing.
3. **Open the PR.** `git push -u origin <branch>`, then `gh pr create --base master --title '...' --body '...'`. In the body, say what changed and exactly what passed. Give a written reason for every tolerance, check, test or fixture the PR changes or removes.
4. **Read the review.** Run `pnpm pr:review <number> --wait`. It waits for CI and Macroscope, then lists failed checks and every Macroscope finding nobody has answered. Macroscope re-reviews each push.
5. **Answer every finding.** Either fix it and push, or reply in its thread with why it's intentional: `gh api repos/compiled-run/dragoncss/pulls/<number>/comments/<id>/replies -f body='...'`. Never reply only to clear the list, and never edit `.macroscope/` to silence a finding. If the fix would break a rule above, stop and report it.
6. **Merge.** When `pnpm pr:review <number>` exits 0, run `gh pr merge <number> --merge --delete-branch`. A failed check blocks the merge. Report it instead of retrying until it goes green.

Two cases may push straight to `master`: PM board updates that touch only `docs/goals/**`, and the owner asking for a direct push.

Workers dispatched in worktrees stop at step 3 and return the PR number in their receipt. The PM runs steps 4–6, or sends the findings back to a worker.

