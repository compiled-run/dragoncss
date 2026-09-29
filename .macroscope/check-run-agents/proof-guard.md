---
title: Proof guard
input: full_diff
conclusion: failure
include: ["packages/**", "scripts/**", "README.md", "docs/*.md", "docs/research/**"]
maxRuns: 3
maxBudgetPerPR: 3.00
---
@/AGENTS.md

You enforce the proof rules above. Flag only these, citing the file and line:

## Blocking
- A tolerance, epsilon or threshold loosened, or a check, assertion, test case or fixture deleted or skipped (`.skip`, `.todo`, commented out, early return) without a written reason in the PR.
- A support-list entry set to anything other than `unsupported` without naming a passing comparison test.
- Support facts (status, floors, fixes) restated as literals in the compiler, docs or runtimes instead of imported from the support profiles.
- Code on the device (Swift or Kotlin runtimes, anything outside the layout engine) that parses CSS or matches selectors.

## Not your job
Correctness bugs, style and naming are covered elsewhere. If nothing above applies, report that no issues were found.
