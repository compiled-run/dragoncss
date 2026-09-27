// querySupport (docs/api.md §6.3): possibilities are not contextual support. A possibilities query lists the profile rows a
// declaration has, each with its context and proofs (needs-context), or says it has none (unsupported). A resolved query reads the
// contextual decision of one element and property in every case of a compiled result that matches the assignment.
import { sha256Hex } from './digest.ts';
import { diagnostic, unlocated } from './diagnostics/catalogue.ts';
import type { UsedKey } from './analysis/context.ts';
import { usedKeys } from './analysis/context.ts';
import { inDomain } from './analysis/input.ts';
import { isLonghand, PROPERTY_ROLE } from './css/properties.ts';
import { featureOf, parseStylesheet } from './css/stylesheet.ts';
import type { ProfileRow, SupportProfile } from './profiles/types.ts';
import { COMMITTED_PROFILES, findResolved, internalRecord } from './project.ts';
import type { Diagnostic, SupportAnswer, SupportCandidate, SupportQuery } from './types.ts';

const TOLERANCE = { 'linux-dragon-layout': 'gate-1-device-px', 'chrome-dual': 'dual-exact' } as const;

function candidate(row: ProfileRow): SupportCandidate | null {
  if (row.status === 'unsupported') return null;
  return { feature: row.feature, context: row.context, status: row.status, proofs: row.proofs.map((p) => ({ lane: p.lane, cases: p.cases, tolerance: TOLERANCE[p.lane] })) };
}

const invalid = (message: string, code: 'DRAGON_CONFIG_INVALID' | 'DRAGON_INPUT_INVALID' | 'DRAGON_TREE_REFERENCE' = 'DRAGON_CONFIG_INVALID'): SupportAnswer =>
  ({ kind: 'invalid-query', diagnostics: [diagnostic(code, { origin: unlocated('support query'), message, manual: 'Correct the support query.' })] });

function possibilities(target: unknown, css: unknown): SupportAnswer {
  const t = target as { kind?: unknown; minimum?: unknown } | null;
  if (typeof t !== 'object' || t === null || (t.kind !== 'web' && t.kind !== 'ios')) return invalid('target must be { kind: "web" } or { kind: "ios", minimum }');
  if (t.kind === 'web' && Object.keys(t).length !== 1) return invalid('a web target takes no options');
  if (t.kind === 'ios' && (typeof t.minimum !== 'string' || t.minimum.length === 0 || Object.keys(t).length !== 2)) return invalid('an ios target needs exactly { kind: "ios", minimum: string }');
  if (typeof css !== 'string') return invalid('css must be a string holding one declaration');
  const profile: SupportProfile = COMMITTED_PROFILES[t.kind];
  const text = `.q{${css}}`;
  const ref = { uri: 'dragon-query://support', revision: 'query', hash: `sha256:${sha256Hex(text)}` };
  const problems: Diagnostic[] = [];
  const rules = parseStylesheet(text, { source: ref, start: 0, end: text.length }, { id: 'query', owner: 'query', scope: 'document' }, 0, problems);
  if (problems.length > 0) return { kind: 'invalid-query', diagnostics: problems };
  const declarations = rules.flatMap((r) => r.declarations);
  if (rules.length !== 1 || declarations.length !== 1) return invalid('css must hold exactly one declaration, for example "gap: 7px"');
  const d = declarations[0] as (typeof declarations)[number];
  const declaration = `${d.property}: ${d.text}`;
  const features = d.longhands.map((lh) => featureOf(lh.property, lh.value));
  const candidates = profile.rows.filter((r) => features.includes(r.feature)).flatMap((r) => {
    const c = candidate(r);
    return c === null ? [] : [c];
  });
  if (candidates.length > 0) return { kind: 'needs-context', declaration, candidates };
  return { kind: 'unsupported', declaration, reason: `the ${t.kind} support profile ${profile.revision} has no supported row for ${[...new Set(features)].join(', ')}` };
}

function resolved(q: Extract<SupportQuery<string>, { kind: 'resolved' }>): SupportAnswer {
  const record = typeof q.result === 'object' && q.result !== null ? internalRecord(q.result) : undefined;
  if (record === undefined) return invalid('result is not a compiled result from this package', 'DRAGON_INPUT_INVALID');
  const target = q.target as string;
  if (!(target in q.result.targets) || (target !== 'web' && target !== 'ios')) return invalid(`target ${target} is not configured`);
  if ((q.result.targets as Record<string, string>)[target] === 'blocked') {
    const out = (q.result.outputs as Record<string, { kind: string; diagnostics?: readonly Diagnostic[] }>)[target];
    return { kind: 'blocked', diagnostics: out !== undefined && out.kind === 'blocked' && out.diagnostics !== undefined ? out.diagnostics : q.result.diagnostics };
  }
  if (!isLonghand(q.property)) return invalid(`${q.property} is not a milestone-1 longhand`);
  const linked = record.linked;
  const docId = record.documentId;
  if (linked === null || docId === null) return invalid('the result did not link', 'DRAGON_TREE_REFERENCE');
  const problems: Diagnostic[] = [];
  if (!Array.isArray(q.assignment as unknown)) return invalid('assignment must be a list of { state, value }');
  for (const e of q.assignment) {
    const v = linked.free.find((f) => f.instance === e.state.instance && f.state === e.state.state);
    if (v === undefined) problems.push(diagnostic('DRAGON_STATE_UNKNOWN', { origin: unlocated('support query'), message: `${e.state.instance}.${e.state.state} is not a free state of document ${docId}` }));
    else if (!inDomain(v.domain, e.value)) problems.push(diagnostic('DRAGON_STATE_VALUE_DOMAIN', { origin: unlocated('support query'), message: `${JSON.stringify(e.value)} is not in the domain of ${v.instance}.${v.state}` }));
  }
  if (problems.length > 0) return { kind: 'invalid-query', diagnostics: problems };
  const rel = q.instance === docId ? '' : q.instance.startsWith(`${docId}/`) ? q.instance.slice(docId.length + 1) : null;
  if (rel === null) return invalid(`no instance ${q.instance} in document ${docId}`, 'DRAGON_TREE_REFERENCE');
  const address = rel === '' ? q.node : `${rel}/${q.node}`;
  const profile = record.profiles[target];
  const out: { assignment: (typeof q.assignment); decision: SupportCandidate | null }[] = [];
  for (const c of record.cases) {
    if (!q.assignment.every((e) => c.assignment.some((x) => x.state.instance === e.state.instance && x.state.state === e.state.state && x.value === e.value))) continue;
    if (c.resolved === null || findResolved(c.resolved, address) === null) continue;
    // An element-level longhand is keyed at the element; a text longhand at the first of its text nodes the value reaches.
    const keys = usedKeys(c.resolved);
    const hit: UsedKey | undefined = PROPERTY_ROLE[q.property] === 'text'
      ? keys.find((u) => u.property === q.property && u.address.startsWith(`${address}:`))
      : keys.find((u) => u.property === q.property && u.address === address);
    const row = hit === undefined ? undefined : profile.rows.find((r) => r.feature === hit.feature && r.context === hit.context);
    out.push({ assignment: c.assignment, decision: row === undefined ? null : candidate(row) });
  }
  if (out.length === 0) return invalid(`no element ${address} in any case matching the assignment`, 'DRAGON_TREE_REFERENCE');
  return { kind: 'decided', cases: out };
}

export function querySupport<K extends string>(query: SupportQuery<K>): SupportAnswer {
  if (typeof query !== 'object' || query === null) return invalid('the query must be an object');
  if (query.kind === 'possibilities') return possibilities(query.target, query.css);
  if (query.kind === 'resolved') return resolved(query as unknown as Extract<SupportQuery<string>, { kind: 'resolved' }>);
  return invalid(`unknown query kind ${String((query as { kind?: unknown }).kind)}`);
}
