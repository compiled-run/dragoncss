// One utility through Dragon: its sheet in a fixture document, compiled once for web, ios and android through the internal entry
// the parity lanes use, then each target's first blocking diagnostic, or the web CSS the Chrome check renders.
import type { Compiled, Diagnostic, FrontEndResult } from 'dragon';
import { ANDROID_MIN_SDK, createProjectWith, NO_FAULTS, REFERENCE_PLATFORM, WEB_CSS_PATH, webClassMap } from 'dragon';
import { compiledFixtureHtml, fixtureToInput, PROJECT_ID } from '../../parity/src/fixture-reader.ts';
import { ENVIRONMENT } from '../../parity/src/fixtures.ts';
import { spanText } from '../../parity/src/pipeline.ts';

export const TARGETS = ['web', 'ios', 'android'] as const;
export type Target = (typeof TARGETS)[number];

/** The fixture element ids: the utility's element and two children, for utilities whose selectors reach children (space-*, divide-*). */
export const ELEMENT_IDS = ['html', 'body', 'u', 'c1', 'c2'] as const;

/** The sweep document: the parity environment (400x300, DPR 1, ltr, Ahem root), the utility on a div with two div children. */
export const SWEEP_ENVIRONMENT = ENVIRONMENT;

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function fixtureHtml(classes: readonly string[], css: string): string {
  if (css.includes('</style')) throw new Error(`${classes.join(' ')}: the sheet closes its <style>`);
  return `<!DOCTYPE html>\n<html data-dragon-id="html"><head><style>\n${css}</style></head><body data-dragon-id="body"><div data-dragon-id="u" class="${escapeHtml(classes.join(' '))}"><div data-dragon-id="c1"></div><div data-dragon-id="c2"></div></div></body></html>\n`;
}

const project = createProjectWith(
  { projectId: PROJECT_ID, targets: { web: {}, ios: { minimum: '15.0' }, android: { minSdk: ANDROID_MIN_SDK.min } } },
  { faults: NO_FAULTS, profiles: 'enforce', direction: SWEEP_ENVIRONMENT.direction, platform: REFERENCE_PLATFORM, rootFont: SWEEP_ENVIRONMENT.rootFont },
);

/**
 * A blocking diagnostic: its code, the source text or profile feature it names, its message and fix, and the text of the
 * declaration or rule prelude its span sits in (for the Chrome parse check of an invalid value or dropped selector).
 */
export type Blocker = { readonly code: string; readonly at: string; readonly message: string; readonly fix: string; readonly context: string | null };

export type DragonResult = {
  /** Per target: null when the target compiles with no error, else its first blocking diagnostic in report order. */
  readonly blockers: { readonly [T in Target]: Blocker | null };
  /** Every distinct blocking code per target, sorted. */
  readonly codes: { readonly [T in Target]: readonly string[] };
  /**
   * NA-NATIVE: per native target that compiles while web does not, the text of the not-applicable items when every web refusal is
   * one of them; null otherwise, and always null for web.
   */
  readonly notApplicable: { readonly [T in Target]: string | null };
  /** The compiled rendering for the Chrome check, when web compiles. */
  readonly compiledHtml: string | null;
  readonly authoredHtml: string;
};

/** Codes about the sweep's own config or fixture, never about the utility: one of them stops the sweep. */
const HARNESS_CODES: readonly string[] = ['DRAGON_CONFIG_INVALID', 'DRAGON_INPUT_INVALID', 'DRAGON_PRODUCER_ERROR', 'DRAGON_INCOMPLETE_INPUT', 'DRAGON_SOURCE_HASH_MISMATCH', 'DRAGON_SPAN_INVALID', 'DRAGON_TREE_SCHEMA'];

/** A fault of the sweep itself (its config or fixture), which must stop the run rather than be recorded as a utility's outcome. */
export class SweepHarnessError extends Error {}

const blocks = (d: Diagnostic, t: Target): boolean => d.severity === 'error' && (d.target === null || d.target === t);

function fixOf(d: Diagnostic): string {
  if (d.fix === null) return '';
  return 'manual' in d.fix ? d.fix.manual : `${d.fix.title}: ${d.fix.edits.map((e) => JSON.stringify(e.replacement)).join(', ')}`;
}

/** The declaration, or the rule prelude, that a span inside the style element sits in: from the last "{", "}" or ";" before it to the next ";", "{" or "}". */
function contextOf(input: FrontEndResult, d: Diagnostic): string | null {
  if (d.origin.kind !== 'authored') return null;
  const { start, end, source } = d.origin.span;
  const text = input.snapshot.sources.find((s) => s.ref.uri === source.uri)?.text;
  if (text === undefined) return null;
  const from = Math.max(text.lastIndexOf('{', start - 1), text.lastIndexOf('}', start - 1), text.lastIndexOf(';', start - 1)) + 1;
  const stops = [';', '{', '}'].map((c) => text.indexOf(c, end)).filter((i) => i >= 0);
  if (from <= 0 || stops.length === 0) return null;
  return text.slice(from, Math.min(...stops)).replace(/\s+/g, ' ').trim();
}

function blocker(input: FrontEndResult, d: Diagnostic): Blocker {
  const at = d.profile !== null ? d.profile.feature : (spanText(input, d.origin) ?? '');
  return { code: d.code, at: at.replace(/\s+/g, ' ').trim(), message: d.message, fix: fixOf(d), context: contextOf(input, d) };
}

/** Compiles the swept sheet of utilities used together on one element; the Chrome check renders publishedCss as the authored side. */
export function compileUtility(classes: readonly string[], sweptCss: string, publishedCss: string): DragonResult {
  const name = classes.join(' ');
  const html = fixtureHtml(classes, sweptCss);
  const input = fixtureToInput('tw', html);
  const compiled: Compiled<Target> = project.compile(input);
  const blockers = {} as { [T in Target]: Blocker | null };
  const codes = {} as { [T in Target]: readonly string[] };
  for (const t of TARGETS) {
    const mine = compiled.diagnostics.filter((d) => blocks(d, t));
    const first = mine[0];
    blockers[t] = first === undefined ? null : blocker(input, first);
    codes[t] = [...new Set(mine.map((d) => d.code))].sort();
    const harness = mine.find((d) => HARNESS_CODES.includes(d.code));
    if (harness !== undefined) throw new SweepHarnessError(`${name}: ${t}: ${harness.code} ${harness.message}`);
    const out = compiled.outputs[t];
    if (first === undefined && out.kind === 'blocked') throw new Error(`${name}: ${t} output is blocked with no blocking diagnostic`);
    if (first !== undefined && out.kind !== 'blocked') throw new Error(`${name}: ${t} has a blocking diagnostic but its output is ${out.kind}`);
  }
  let compiledHtml: string | null = null;
  const web = compiled.outputs.web;
  if (web.kind === 'ready') {
    const css = web.files.find((f) => f.path === WEB_CSS_PATH);
    const classOf = webClassMap(compiled, []);
    if (css === undefined || !('text' in css) || classOf === null) throw new Error(`${name}: web output has no ${WEB_CSS_PATH} or class map`);
    compiledHtml = compiledFixtureHtml(fixtureHtml(classes, publishedCss), css.text, classOf);
  }
  const notApplicable = {} as { [T in Target]: string | null };
  for (const t of TARGETS) notApplicable[t] = blockers[t] === null && blockers.web !== null ? notApplicableOn(input, compiled.diagnostics, t) : null;
  return { blockers, codes, notApplicable, compiledHtml, authoredHtml: fixtureHtml(classes, publishedCss) };
}

/**
 * The text of target t's DRAGON_NOT_APPLICABLE_NATIVE items when they explain every web refusal: each web refusal is at an item's own
 * span. Null otherwise.
 */
export function notApplicableOn(input: FrontEndResult, diagnostics: readonly Diagnostic[], t: Target): string | null {
  const items = diagnostics.filter((d) => d.code === 'DRAGON_NOT_APPLICABLE_NATIVE' && d.severity === 'info' && d.target === t && d.origin.kind === 'authored');
  if (items.length === 0) return null;
  const spanOf = (d: Diagnostic) => (d.origin.kind === 'authored' ? d.origin.span : null);
  const covered = (d: Diagnostic): boolean => {
    const s = spanOf(d);
    return s !== null && items.some((i) => {
      const a = spanOf(i);
      return a !== null && a.source.uri === s.source.uri && a.start === s.start && a.end === s.end;
    });
  };
  if (!diagnostics.filter((d) => blocks(d, 'web')).every((d) => d.target === 'web' && covered(d))) return null;
  return [...new Set(items.map((i) => (spanText(input, i.origin) ?? '').replace(/\s+/g, ' ').trim()))].join('; ');
}
