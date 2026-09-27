// The diagnostic catalogue (docs/api.md §6.1): one entry per code with its severity, message, reason and fix kind.
// Diagnostics take their severity, why and fix kind from here; only the located detail varies per diagnostic.
import type { Diagnostic, Fix, Origin, ProofRef, Span } from '../types.ts';
import type { DiagnosticCode } from './codes.ts';

export type CatalogueFix = { readonly kind: 'edit'; readonly title: string } | { readonly kind: 'manual'; readonly title: string; readonly manual: string };

export type CatalogueEntry = {
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly why: string;
  /**
   * The why of a refusal raised on a computed value (analysis/computed-checks.ts) rather than by the support profile: the value
   * may be proven elsewhere, but its computed result or where it applies is outside what milestone 1 lays out.
   */
  readonly computedWhy: string | null;
  readonly fix: CatalogueFix;
};

const manual = (title: string, text: string): CatalogueFix => ({ kind: 'manual', title, manual: text });
const edit = (title: string): CatalogueFix => ({ kind: 'edit', title });
const error = (message: string, why: string, fix: CatalogueFix, computedWhy: string | null = null): CatalogueEntry => ({ severity: 'error', message, why, computedWhy, fix });

export const CATALOGUE: { readonly [C in DiagnosticCode]: CatalogueEntry } = {
  DRAGON_CONFIG_INVALID: error('The project configuration is invalid.', 'Targets and project identity must be known before anything compiles.', manual('Fix the configuration', 'Configure { ios: { minimum: "15.0" } } and/or { web: {} } with a non-empty projectId.')),
  DRAGON_INPUT_INVALID: error('The front-end result is malformed.', 'Compile consumes a complete FrontEndResult; missing or extra fields could hide front-end errors.', manual('Supply a complete FrontEndResult', 'Match docs/api.md §2.1 exactly.')),
  DRAGON_PRODUCER_ERROR: error('The front end reported an error.', 'Errors recovered by the producer block every output that depends on its analysis.', manual('Fix the producer error', 'Fix the source the producer rejected, then compile again.')),
  DRAGON_INCOMPLETE_INPUT: error('The input is not a closed application.', 'Only a closed application with an element tree can produce application outputs.', manual('Supply a closed application', 'Pass completeness "closed-application" with a tree.')),
  DRAGON_SOURCE_HASH_MISMATCH: error('A source hash does not match its text.', 'Spans and fixes are only valid against the exact source text they were computed from.', manual('Recompute the hash', 'Hash the exact UTF-8 text with SHA-256 and pass "sha256:<hex>".')),
  DRAGON_SPAN_INVALID: error('A span points outside its source.', 'Every authored origin must resolve to text in the snapshot, in UTF-16 offsets.', manual('Fix the span', 'Point the span at a source in the snapshot, with 0 <= start <= end <= length and the same revision and hash.')),
  DRAGON_TREE_SCHEMA: error('The tree schema or revision is not supported.', 'Draft @0 inputs require an exact revision match (docs/api.md §9).', manual('Emit the supported schema', 'Emit schema "dragon/tree@0" with the compiler\'s TREE_SCHEMA_REVISION.')),
  DRAGON_TREE_UNSUPPORTED: error('The tree uses a structure milestone 1 does not compile.', 'Milestone 1 compiles one document entry whose document element is <html>.', manual('Restructure the tree', 'Compile one document per project, rooted at <html> with <body>.')),
  DRAGON_CSS_PARSE: error('The CSS does not parse.', 'A recovered CSS parse error would silently drop declarations.', manual('Fix the CSS syntax', 'Fix the CSS at this location.')),
  DRAGON_CSS_INVALID_VALUE: error('The value does not match the property grammar.', 'Browsers drop invalid declarations; native output would disagree about which declaration wins.', manual('Use a valid value', 'Use a value that matches the @webref/css grammar for this property.')),
  DRAGON_UNSUPPORTED_AT_RULE: error('This at-rule is not supported.', 'Milestone 1 resolves only plain style rules; an at-rule would change which rules apply.', manual('Move the rules out of the at-rule', 'Move the declarations you want to keep into plain top-level style rules, then remove the at-rule. Deleting the at-rule alone would also delete the rules inside it.')),
  DRAGON_UNSUPPORTED_SELECTOR: error('This selector is not supported.', 'Scoped selectors may test only their own element and same-owner ancestors through class, type, descendant, child and ui-* attribute parts.', manual('Rewrite the selector', 'Use class compounds, optionally with a tag and [ui-*] or [ui-*="value"], joined by descendant or child combinators.')),
  DRAGON_UNSUPPORTED_IMPORTANT: error('!important is not supported.', 'Order and specificity decide the cascade in milestone 1.', edit('Remove !important')),
  DRAGON_UNSUPPORTED_PROPERTY: error('This property is not supported.', 'The compiler resolves only the milestone-1 longhands and their shorthands.', edit('Remove the declaration')),
  DRAGON_UNSUPPORTED_VALUE: error('This value is not supported on a configured target.', 'The target\'s support profile has no passing proof for this value.', manual('Use a supported value', 'Use a value the target profile supports.'), 'Milestone 1 refuses this value where its computed result or placement needs layout the engine does not model, so Dragon never guesses what Chrome would do.'),
  DRAGON_UNSUPPORTED_ELEMENT: error('This element is not supported.', 'Milestone 1 captures browser defaults only for html, body and div.', manual('Use a div', 'Use html, body or div.')),
  DRAGON_UNSUPPORTED_ATTRIBUTE: error('This attribute is not supported.', 'Only ui-* attributes take part in selector matching; other attributes could style elements invisibly.', manual('Use a ui-* attribute or a class', 'Move styling into the stylesheet and select with classes or ui-* attributes.')),
  DRAGON_UNSUPPORTED_FONT: error('This font is not supported by the layout lane.', 'The milestone-1 layout lane measures text only with Ahem.', manual('Use Ahem', 'Set font-family: Ahem on text for the milestone-1 layout lane.')),
  DRAGON_LOWERING_FAILED: error('The ios lowering has no mapping for this value.', 'Every layout field must be set explicitly; there are no engine defaults.', manual('Use a value with a layout mapping', 'Use a value the ios lowering maps.')),
  DRAGON_TREE_NODE_KIND: error('Unknown tree node kind.', 'Unknown node kinds are errors for resolved native output (docs/api.md §3.1).', manual('Use a tree@0 node kind', 'Use element, text, call, projection or branch nodes.')),
  DRAGON_TREE_RAW_HTML: error('Raw HTML is not allowed in the tree.', 'Raw HTML hides structure the compiler must resolve for every target (docs/api.md §3.1).', manual('Describe the markup as nodes', 'Replace the raw HTML with element and text nodes.')),
  DRAGON_TREE_DUPLICATE_ID: error('Duplicate id.', 'Node, component, state and style ids address resolved results; a duplicate would merge two of them.', manual('Make the id unique', 'Give each node, component, state, parameter, slot and style use its own id in its scope.')),
  DRAGON_TREE_REFERENCE: error('Unknown or invalid reference in the tree.', 'Every component, module, slot, parameter, style use and document element must resolve.', manual('Fix the reference', 'Reference an id declared in the tree.')),
  DRAGON_CALL_CYCLE: error('Component calls form a cycle.', 'A recursive call has no finite logical element tree.', manual('Break the cycle', 'Remove the recursive component call.')),
  DRAGON_STATE_UNKNOWN: error('Unknown state reference.', 'A condition or alias that reads an undeclared state has no domain, so its style cases cannot be enumerated.', manual('Declare the state', 'Reference a state or parameter declared by the instance.')),
  DRAGON_STATE_DOMAIN_INVALID: error('Invalid state domain.', 'Domains are nonempty lists of distinct finite JSON scalars; NaN, Infinity and -0 have no stable identity.', manual('Fix the domain', 'Use distinct strings, finite numbers other than -0, booleans or null.')),
  DRAGON_STATE_VALUE_DOMAIN: error('Value outside its domain.', 'Initial values, arguments and compared values must be members of the declared domain, by type and value.', manual('Use a domain value', 'Use one of the declared domain values; true, "true" and 1 differ.')),
  DRAGON_ALIAS_CYCLE: error('State aliases form a cycle.', 'A cyclic alias has no state that owns the value.', manual('Break the alias cycle', 'Make one instance own the state and alias the others to it.')),
  DRAGON_ALIAS_DOMAIN: error('Alias domains are incompatible.', 'Every value the caller state can take must be valid for the controlled local state.', manual('Align the domains', 'Make the caller domain a subset of the local domain.')),
  DRAGON_INITIAL_CONFLICT: error('Conflicting initial values.', 'Two explicit initial assignments reach the same state through aliases with different values.', manual('Assign the state once', 'Remove one of the conflicting initial assignments.')),
  DRAGON_CHOICE_OVERLAP: error('Choice arms overlap.', 'Exactly one arm must hold for every reachable assignment (docs/api.md §3.2).', manual('Make the arms exclusive', 'Tighten the conditions so no assignment satisfies two arms.')),
  DRAGON_CHOICE_MISSING: error('No choice arm holds for a reachable assignment.', 'Exactly one arm must hold for every reachable assignment (docs/api.md §3.2).', manual('Cover every assignment', 'Add an arm for the uncovered assignment, for example the complement.')),
  DRAGON_STATE_SPACE_LIMIT: error('Too many reachable state assignments.', 'Every reachable assignment is resolved and tested; the compiler never truncates the state space.', manual('Reduce the state space', 'Split the component or reduce its independent states.')),
  DRAGON_CLASS_OWNER: error('Class symbol from another owner.', 'An element may carry only its own component\'s or its document\'s class symbols (docs/api.md §3.1).', manual('Use an own class', 'Declare the class in a style use owned by the element\'s component or the document.')),
  DRAGON_UNPROVEN_CONTEXT: error('This value is not proven in this formatting context.', 'Profile rows are proven per formatting context; another context may behave differently (docs/api.md §6.3).', manual('Use a proven context', 'Use the value only in a proven context, or add a passing fixture for this one.')),
  DRAGON_UNSUPPORTED_NESTED_RULE: error('Nested style rules are not supported.', 'Milestone 1 resolves only top-level style rules; a nested rule (css-nesting-1) would change which declarations apply, so it is never dropped silently.', manual('Un-nest the rule', 'Write the nested rule as its own top-level rule with the full selector, for example .card .title instead of & .title inside .card.')),
  DRAGON_MISSING_ASSET: error('A referenced source or asset is missing from the snapshot or does not match its hash.', 'Every source, stylesheet and asset the input refers to must be in the snapshot with bytes matching its hash; a missing or changed file would change the output without a trace.', manual('Supply the referenced file', 'Add the source or asset to the snapshot with its sha256 hash, or remove the reference.')),
  DRAGON_UNSUPPORTED_BIDI: error('This right-to-left text needs bidirectional reordering.', 'In a right-to-left paragraph, digits, punctuation and other neutral characters are reordered by the Unicode bidirectional algorithm (UAX #9), and U+200B at the end takes the paragraph direction; milestone 1 lays out only letters, spaces and U+200B there and never guesses.', manual('Use letters in right-to-left text', 'Use only A-Z, a-z, spaces and U+200B (not at the end) in right-to-left text, or set direction: ltr on its block.')),
};

export type DiagnosticInit = {
  readonly origin: Origin;
  readonly message: string;
  readonly target?: string | null;
  readonly related?: readonly { readonly origin: Origin; readonly message: string }[];
  /** Required for edit codes: the guarded span edits. */
  readonly edits?: readonly { readonly span: Span; readonly replacement: string }[];
  /** Replaces the catalogue's manual instruction with a located one. */
  readonly manual?: string;
  /** 'computed-value' for a refusal of a computed value: the diagnostic takes the catalogue's computedWhy. */
  readonly basis?: 'profile' | 'computed-value';
  readonly profile?: ProofRef | null;
};

/** Builds a diagnostic from its catalogue entry; the fix kind always matches the catalogue. */
export function diagnostic(code: DiagnosticCode, init: DiagnosticInit): Diagnostic {
  const entry = CATALOGUE[code];
  let fix: Fix;
  if (entry.fix.kind === 'edit') {
    if (init.edits === undefined || init.edits.length === 0) throw new Error(`${code} needs guarded edits`);
    fix = { title: entry.fix.title, edits: init.edits };
  } else {
    fix = { title: entry.fix.title, manual: init.manual === undefined ? entry.fix.manual : init.manual };
  }
  return {
    code,
    severity: entry.severity,
    target: init.target === undefined ? null : init.target,
    origin: init.origin,
    message: init.message,
    why: init.basis === 'computed-value' ? computedWhyOf(code) : entry.why,
    related: init.related === undefined ? [] : init.related,
    fix,
    profile: init.profile === undefined ? null : init.profile,
  };
}

export const authored = (span: Span): Origin => ({ kind: 'authored', span });
export const unlocated = (reason: string): Origin => ({ kind: 'unlocated', reason });

function computedWhyOf(code: DiagnosticCode): string {
  const w = CATALOGUE[code].computedWhy;
  if (w === null) throw new Error(`${code} has no computed-value why in the catalogue`);
  return w;
}
