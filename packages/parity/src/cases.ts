// Parity cases (docs/api.md §7): one per reachable assignment of every fixture, never deduplicated or factored.
// HTML fixtures have one case, rendered from the file itself; tree fixtures are rendered by the parity-owned renderer.
import type { Assignment, FrontEndResult } from 'dragon';
import { compiledFixtureHtml, readHtmlFixture } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { authoredModel } from './render.ts';
import { readTreeFixture } from './tree-fixture.ts';

export type ParityCase = {
  /** The fixture id for HTML fixtures, "<fixture>#<k>" for tree fixtures. */
  readonly id: string;
  readonly fixture: string;
  readonly index: number;
  readonly assignment: Assignment;
  readonly isInitial: boolean;
  readonly authoredHtml: string;
  readonly compiledHtml: (css: string, classOf: ReadonlyMap<string, string>) => string;
};

export function fixtureInput(spec: FixtureSpec): FrontEndResult {
  return spec.format === 'html' ? readHtmlFixture(spec.id).input : readTreeFixture(spec.id);
}

/** Every case of a layout fixture, from the source alone (not from Dragon's enumeration). */
export function casesOf(spec: FixtureSpec, input: FrontEndResult): ParityCase[] {
  if (spec.format === 'html') {
    const { html } = readHtmlFixture(spec.id);
    return [{ id: spec.id, fixture: spec.id, index: 0, assignment: [], isInitial: true, authoredHtml: html, compiledHtml: (css, classOf) => compiledFixtureHtml(html, css, classOf) }];
  }
  const model = authoredModel(input);
  return model.assignments.map((assignment, index) => ({
    id: `${spec.id}#${index}`,
    fixture: spec.id,
    index,
    assignment,
    isInitial: index === model.initialIndex,
    authoredHtml: model.render(assignment, { kind: 'authored' }),
    compiledHtml: (css, classOf) => model.render(assignment, { kind: 'compiled', classOf, css }),
  }));
}

/** The product of the free states' domain sizes, computed from the source tree. */
export function expectedCaseCount(spec: FixtureSpec, input: FrontEndResult): number {
  if (spec.format === 'html') return 1;
  return authoredModel(input).free.reduce((n, f) => n * f.domain.length, 1);
}

