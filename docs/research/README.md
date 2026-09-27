# Research

These notes came out of the Markless native-targets research (2026-09-25 to 2026-09-26). They were copied here unchanged, so:
- relative links between these files still work;
- links to repo source such as `../../../../packages/...` point into the Markless repo (`compiled-run/markless`), not this one;
- task IDs like "T018" are the Markless goal-board IDs they were written under.

Start with:

- [css-support.md](css-support.md): what CSS works on web, iOS, Android and email, and how agents are stopped from writing CSS that doesn't work.
- [testing-plan.md](testing-plan.md): how parity is proven without a human doing QA.
- [T025-styling-direction.md](T025-styling-direction.md): the chosen direction. It is regular CSS; on native targets, a rule may test only its own element, parents in the same component, and app-wide conditions.
- [T018-styling-design.md](T018-styling-design.md): the design: the computed-value pipeline, style tables, the on-device runtime and diagnostics.

Evidence:
- [T029-support-evidence.md](T029-support-evidence.md): per-property support.
- [T015-css-range.md](T015-css-range.md): CSS usage ranking.
- [T016-styling-dx.md](T016-styling-dx.md): developer experience.
- [T017-css-corpus.md](T017-css-corpus.md): Markless's own CSS, parsed.
- [T011-styling.md](T011-styling.md): engines.
- [T023-stylex.md](T023-stylex.md): StyleX.
- [T024-styling-projects.md](T024-styling-projects.md): existing projects.
- [T030-agent-guardrails.md](T030-agent-guardrails.md): agent guardrails.
- [T035-testing-landscape.md](T035-testing-landscape.md): testing landscape.
- [T036-test-infra.md](T036-test-infra.md): Markless test infrastructure.
- [css-support-profile.draft.json](css-support-profile.draft.json): draft support profile. Every entry is proposed and unsupported until a test proves it.
