// Guarded fixes (docs/api.md §6.1): every edit names the exact source revision and hash it was computed against; the
// whole fix applies atomically across files or is refused as stale when any precondition differs.
import { sha256Hex } from '../digest.ts';
import type { Fix, SourceFile } from '../types.ts';

export type FixResult =
  | { readonly kind: 'applied'; readonly texts: ReadonlyMap<string, string> }
  | { readonly kind: 'stale'; readonly reason: string }
  | { readonly kind: 'manual'; readonly instruction: string };

export function applyFix(fix: Fix, sources: readonly SourceFile[]): FixResult {
  if ('manual' in fix) return { kind: 'manual', instruction: fix.manual };
  const bySource = new Map<string, { start: number; end: number; replacement: string }[]>();
  for (const e of fix.edits) {
    const src = sources.find((s) => s.ref.uri === e.span.source.uri);
    if (src === undefined) return { kind: 'stale', reason: `${e.span.source.uri} is not in the source registry` };
    if (src.ref.revision !== e.span.source.revision) return { kind: 'stale', reason: `${src.ref.uri} is at revision ${src.ref.revision}, the fix needs ${e.span.source.revision}` };
    if (src.ref.hash !== e.span.source.hash || `sha256:${sha256Hex(src.text)}` !== e.span.source.hash) {
      return { kind: 'stale', reason: `${src.ref.uri} does not have hash ${e.span.source.hash}` };
    }
    if (!Number.isInteger(e.span.start) || !Number.isInteger(e.span.end) || e.span.start < 0 || e.span.start > e.span.end || e.span.end > src.text.length) {
      return { kind: 'stale', reason: `edit ${e.span.start}-${e.span.end} is outside ${src.ref.uri}` };
    }
    const list = bySource.get(src.ref.uri) ?? [];
    list.push({ start: e.span.start, end: e.span.end, replacement: e.replacement });
    bySource.set(src.ref.uri, list);
  }
  const texts = new Map<string, string>();
  for (const [uri, edits] of bySource) {
    const sorted = [...edits].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i] as { start: number }).start < (sorted[i - 1] as { end: number }).end) return { kind: 'stale', reason: `overlapping edits in ${uri}` };
    }
    let text = (sources.find((s) => s.ref.uri === uri) as SourceFile).text;
    for (const e of sorted.reverse()) text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
    texts.set(uri, text);
  }
  return { kind: 'applied', texts };
}
