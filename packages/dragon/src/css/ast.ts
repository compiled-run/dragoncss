// css-tree node helpers shared by the parse driver (stylesheet.ts), selectors.ts, at-rules.ts, values.ts and the shorthands.
import type { CssNode, List } from 'css-tree';
import type { Span } from '../types.ts';

/** The children of a css-tree list field, or [] when the node has none. */
export function list(node: CssNode, key: string): CssNode[] {
  const v = node[key] as List<CssNode> | null | undefined;
  return v === null || v === undefined ? [] : v.toArray();
}

/** A node's UTF-16 span in its source, offset by the stylesheet's base span; the base itself when the node has no location. */
export function spanOf(node: CssNode, base: Span): Span {
  const loc = node.loc;
  if (loc === null || loc === undefined) return base;
  return { source: base.source, start: base.start + loc.start.offset, end: base.start + loc.end.offset };
}
