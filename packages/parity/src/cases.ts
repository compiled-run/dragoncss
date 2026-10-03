// Parity cases (docs/api.md §7): one per reachable assignment of every fixture and environment, never deduplicated or factored.
// HTML fixtures have one case per declared environment direction, rendered from the file itself; tree fixtures are rendered by the
// parity-owned renderer, once per assignment in each environment direction.
import type { Page } from 'playwright';
import type { Assignment, Environment, FrontEndResult } from 'dragon';
import { fontMapOf } from './fixture-groups/fonts.ts';
import { fontReferencePrepare } from './font-reference.ts';
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
  /**
   * TXT1a-2: the stated font reference a fixture with a font map is captured under (fonts.ts MAPS), run on the authored page
   * before it is read; null for every other fixture. The compiled document carries its own fonts (dragon.css assets).
   */
  readonly authoredPrepare: ((page: Page) => Promise<void>) | null;
  readonly compiledHtml: (css: string, classOf: ReadonlyMap<string, string>) => string;
};

export function fixtureInput(spec: FixtureSpec): FrontEndResult {
  return spec.format === 'html' ? readHtmlFixture(spec.id).input : readTreeFixture(spec.id);
}

/** Every case of a layout fixture, from the source alone (not from Dragon's enumeration): environments outer, assignments inner. */
export function casesOf(spec: FixtureSpec, input: FrontEndResult): ParityCase[] {
  const map = fontMapOf(spec.id);
  const authoredPrepare = map === undefined ? null : fontReferencePrepare(map);
  if (spec.format === 'html') {
    const { html } = readHtmlFixture(spec.id);
    return environmentsOf(spec).map((environment) => ({
      id: `${spec.id}${directionSuffix(environment.direction)}`,
      fixture: spec.id,
      index: 0,
      environment,
      computedExtra: spec.kind === 'layout' ? (spec.computedExtra ?? []) : [],
      assignment: [],
      isInitial: true,
      authoredHtml: html,
      authoredPrepare,
      compiledHtml: (css: string, classOf: ReadonlyMap<string, string>) => compiledFixtureHtml(html, css, classOf),
    }));
  }
  const model = authoredModel(input);
  return environmentsOf(spec).flatMap((environment) => model.assignments.map((assignment, index) => ({
    id: `${spec.id}#${index}${directionSuffix(environment.direction)}`,
    fixture: spec.id,
    index,
    environment,
    computedExtra: spec.kind === 'layout' ? (spec.computedExtra ?? []) : [],
    assignment,
    isInitial: index === model.initialIndex,
    authoredHtml: model.render(assignment, { kind: 'authored' }),
    authoredPrepare,
    compiledHtml: (css: string, classOf: ReadonlyMap<string, string>) => model.render(assignment, { kind: 'compiled', classOf, css }),
  })));
}

/** The product of the free states' domain sizes, computed from the source tree: the case count of one environment. */
export function expectedCaseCount(spec: FixtureSpec, input: FrontEndResult): number {
  if (spec.format === 'html') return 1;
  return authoredModel(input).free.reduce((n, f) => n * f.domain.length, 1);
}
