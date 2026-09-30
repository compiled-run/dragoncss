// What a utility's own rules declare, read from its swept sheet: the standard properties it sets, the custom properties it sets,
// and the custom properties its standard declarations read (through var(), followed through its own custom declarations).
// The `*` fallback rule and the `:root` theme rule are the shell, not the utility's rules.
import type { CssNode, List } from 'css-tree';
import { parse } from 'css-tree';

export type UtilityRules = {
  /** Standard (non-custom) properties the utility's rules declare, in order, without repeats. */
  readonly properties: readonly string[];
  /** Custom properties the utility's rules declare. */
  readonly sets: readonly string[];
  /** Custom properties its standard declarations read, directly or through its own custom declarations. */
  readonly reads: readonly string[];
  /** Custom properties its custom declarations read. */
  readonly customReads: readonly string[];
};

const children = (node: CssNode, key: string): CssNode[] => {
  const v = node[key] as List<CssNode> | null | undefined;
  return v === null || v === undefined ? [] : v.toArray();
};

const SHELL_SELECTORS = new Set(['*', ':root']);

export function utilityRules(swept: string): UtilityRules {
  const errors: string[] = [];
  const ast = parse(swept, { positions: true, parseValue: false, parseRulePrelude: false, parseAtrulePrelude: false, onParseError: (e) => errors.push(e.message) });
  if (errors.length > 0) throw new Error(`the swept sheet does not parse: ${errors.join('; ')}`);
  const text = (n: CssNode): string => {
    const loc = n.loc;
    if (loc === null || loc === undefined) throw new Error('css-tree gave a node no location');
    return swept.slice(loc.start.offset, loc.end.offset);
  };
  const properties: string[] = [];
  const custom = new Map<string, string[]>();
  const standardReads: string[] = [];
  const refs = (value: string): string[] => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] as string);
  const block = (b: CssNode): void => {
    for (const c of children(b, 'children')) {
      if (c.type === 'Declaration') {
        const p = String(c['property']);
        const v = text(c['value'] as CssNode);
        if (p.startsWith('--')) custom.set(p, [...(custom.get(p) ?? []), ...refs(v)]);
        else {
          if (!properties.includes(p)) properties.push(p);
          standardReads.push(...refs(v));
        }
      } else if (c['block'] !== undefined && c['block'] !== null) block(c['block'] as CssNode);
    }
  };
  const top = (n: CssNode): void => {
    if (n.type === 'Rule') {
      if (SHELL_SELECTORS.has(text(n['prelude'] as CssNode).trim())) return;
      block(n['block'] as CssNode);
    } else if (n.type === 'Atrule' && String(n['name']) !== 'keyframes' && n['block'] !== null) {
      for (const c of children(n['block'] as CssNode, 'children')) top(c);
    }
  };
  for (const n of children(ast, 'children')) top(n);
  const reads = new Set<string>();
  const queue = [...standardReads];
  while (queue.length > 0) {
    const p = queue.pop() as string;
    if (reads.has(p)) continue;
    reads.add(p);
    queue.push(...(custom.get(p) ?? []));
  }
  return { properties, sets: [...custom.keys()], reads: [...reads].sort(), customReads: [...new Set([...custom.values()].flat())].sort() };
}
