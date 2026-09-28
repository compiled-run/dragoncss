// Parity cases (docs/api.md §7): one per reachable assignment of every fixture and environment, never deduplicated or factored.
// HTML fixtures have one case per declared environment direction, rendered from the file itself; tree fixtures are rendered by the
// parity-owned renderer, once per assignment in each environment direction.
import type { Assignment, Environment, FrontEndResult } from 'dragon';
import { compiledFixtureHtml, readHtmlFixture } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { directionSuffix, environmentsOf } from './fixtures.ts';
import { authoredModel } from './render.ts';
import { readTreeFixture } from './tree-fixture.ts';

export type ParityCase = {
  /** The fixture id for HTML fixtures, "<fixture>#<k>" for tree fixtures, with "-rtl" for the right-to-left environment. */
  readonly id: string;
  readonly fixture: string;
  /** The assignment index in the renderer's enumeration. */
  readonly index: number;
  readonly environment: Environment;
  /** The fixture's computedExtra: background longhands captured besides LONGHANDS in both renderings. */
  readonly computedExtra: readonly string[];
  readonly assignment: Assignment;
  readonly isInitial: boolean;
  readonly authoredHtml: string;
  readonly compiledHtml: (css: string, classOf: ReadonlyMap<string, string>) => string;
};

export function fixtureInput(spec: FixtureSpec): FrontEndResult {
  return spec.format === 'html' ? readHtmlFixture(spec.id).input : readTreeFixture(spec.id);
}

/** Every case of a layout fixture, from the source alone (not from Dragon's enumeration): environments outer, assignments inner. */
export function casesOf(spec: FixtureSpec, input: FrontEndResult): ParityCase[] {
  if (spec.format === 'html') {
    const { html } = readHtmlFixture(spec.id);
    return environmentsOf(spec).map((environment) => ({
      id: `${spec.id}${directionSuffix(environment.direction)}`,
      fixture: spec.id,
      index: 0,
      environment,
      computedExtra: spec.kind === 'layout' ? spec.computedExtra : [],
      assignment: [],
      isInitial: true,
      authoredHtml: html,
      compiledHtml: (css: string, classOf: ReadonlyMap<string, string>) => compiledFixtureHtml(html, css, classOf),
    }));
  }
  const model = authoredModel(input);
  return environmentsOf(spec).flatMap((environment) => model.assignments.map((assignment, index) => ({
    id: `${spec.id}#${index}${directionSuffix(environment.direction)}`,
    fixture: spec.id,
    index,
    environment,
    computedExtra: spec.kind === 'layout' ? spec.computedExtra : [],
    assignment,
    isInitial: index === model.initialIndex,
    authoredHtml: model.render(assignment, { kind: 'authored' }),
    compiledHtml: (css: string, classOf: ReadonlyMap<string, string>) => model.render(assignment, { kind: 'compiled', classOf, css }),
  })));
}

/** The product of the free states' domain sizes, computed from the source tree: the case count of one environment. */
export function expectedCaseCount(spec: FixtureSpec, input: FrontEndResult): number {
  if (spec.format === 'html') return 1;
  return authoredModel(input).free.reduce((n, f) => n * f.domain.length, 1);
}
