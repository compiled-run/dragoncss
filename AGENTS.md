# Agent guidance

Dragon CSS compiles regular CSS straight into native view properties, and proves every supported feature against Chrome.

- **No claim without a test.** A support-list entry may be anything other than `unsupported` only if it names a passing comparison test. Missing data means unsupported.
- **Numbers decide pass or fail.** Screenshots and AI judgement are evidence only, never the gate. Never loosen a tolerance, delete a check or skip a test to make something pass. Report it instead.
- **Build-time work is TypeScript.** The compiler generates native code (Swift first, Kotlin later) that sets view properties directly, using platform mechanisms (dynamic colours, font metrics, safe areas) where they exist. On-device code never parses CSS or matches selectors. The only on-device library is the layout engine.
- **One source for both outputs.** The generated native code and the plain-data property list used by the test lanes come from the same compiler result, so they cannot disagree.
- **Remove pitfalls by design.** Platform-specific choices belong to the compiler, which resolves every element style for every reachable state from semantic analysis; web output is compiled from the same result when a native target is configured. Never ask the developer to know a platform difference the compiler can decide. See the design principles in docs/goals/milestone-1/goal.md.
- **Support facts live in the support profiles.** Import them; never restate them as literals in the compiler, docs or runtimes.
- **Before reporting work done, run `pnpm typecheck` and `pnpm test`,** and say exactly what passed.
- **Publishing needs an explicit owner directive:** npm (the `dragon` package), git pushes and new remotes.
- **Write in plain, concrete language.** Comments only where the code can't show a constraint, one line at most.
