---
requires:
  - checks
---
Dragon CSS compiles CSS at build time (TypeScript) into native view code (Swift, later Kotlin) and proves each feature against Chrome.

What is intentional here, so don't flag it:
- Exact float comparisons in parity tests. Numbers must match Chrome exactly unless a tolerance comes from a support profile.
- Very long literal data tables under packages/*/src that are generated or captured from Chrome.
- Refusing CSS with a build error instead of approximating it.

What is a real bug here:
- Output that differs between the generated native code and the plain-data property list; both must come from the same compiler result.
- CSS parsing or selector matching in on-device code (Swift/Kotlin runtimes). Only the layout engine runs on the device.
- The TypeScript layout reference and a native layout port disagreeing on any value.
