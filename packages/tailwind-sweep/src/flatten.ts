// The sheet-shell pre-pass. Tailwind wraps every utility in the same shell: cascade layers, @property registrations with their
// no-@property fallback, and a `:root, :host` theme rule. Dragon refuses each shell part today, so every utility of the published
// sheet stops at the shell (the sweep counts that separately). The pre-pass lowers only the shell, to what the same sheet means
// for one document with no other sheets, and leaves every utility rule byte for byte:
//   @layer theme { R } / @layer utilities { R }  ->  R        one sheet, theme before utilities: layer order equals source order
//   @layer properties;                             ->  (none)   a layer-order statement with no rules
//   @property --x { ... }                          ->  (none)   replaced by Tailwind's own fallback rule below
//   @layer properties { @supports (T) { *, ::before, ::after, ::backdrop { D } } }  ->  * { D }, first in the sheet
//                                                  the fallback Tailwind ships for engines without @property: every element gets
//                                                  the initial values, so none inherits (inherits: false); the pseudo-element arms
//                                                  match nothing in a tree without pseudo-elements. @layer properties; puts
//                                                  this layer below theme and utilities, so the rule goes first: a later
//                                                  `*` would beat a `:where()` utility rule of equal specificity
//   :root, :host { D }                             ->  :root { D }   :host matches only a shadow host; the sweep document has none
// Any other at-rule or shape is kept as written, so Dragon judges it. A shell that differs from these shapes throws.
import type { CssNode, List } from 'css-tree';
import { parse } from 'css-tree';

/** The @supports condition Tailwind 4 guards its @property fallback with (Safari before @property, Firefox before relative colours). */
export const FALLBACK_CONDITION = '((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b))))';
const FALLBACK_SELECTOR = '*, ::before, ::after, ::backdrop';
const THEME_SELECTOR = ':root, :host';

/** The shell parts the pre-pass lowered; each is a Dragon refusal in the published sheet. */
export type ShellPart = 'layer-block' | 'layer-statement' | 'property' | 'property-fallback' | 'host-arm';

export type Flattened = { readonly css: string; readonly shell: readonly ShellPart[] };

const children = (node: CssNode, key: string): CssNode[] => {
  const v = node[key] as List<CssNode> | null | undefined;
  return v === null || v === undefined ? [] : v.toArray();
};

export function flatten(published: string): Flattened {
  const errors: string[] = [];
  const ast = parse(published, { positions: true, parseValue: false, parseRulePrelude: false, parseAtrulePrelude: false, onParseError: (e) => errors.push(`${e.message} at ${e.offset}`) });
  if (errors.length > 0) throw new Error(`the published sheet does not parse: ${errors.join('; ')}`);
  const text = (n: CssNode | null | undefined): string => {
    const loc = n?.loc;
    if (loc === null || loc === undefined) throw new Error('css-tree gave a node no location');
    return published.slice(loc.start.offset, loc.end.offset);
  };
  const raw = (n: CssNode, key: string): string => text(n[key] as CssNode).trim();
  const out: string[] = [];
  const shell = new Set<ShellPart>();
  const registered: string[] = [];
  const fallback = new Set<string>();
  let fallbackRule: string | null = null;
  const layers: string[] = [];

  const top = (n: CssNode): void => {
    if (n.type === 'Atrule' && String(n['name']) === 'layer') {
      const name = raw(n, 'prelude');
      const block = n['block'] as CssNode | null;
      if (block === null) {
        if (name !== 'properties') throw new Error(`unexpected layer statement @layer ${name};`);
        shell.add('layer-statement');
        return;
      }
      shell.add('layer-block');
      if (name === 'properties') return propertiesLayer(block);
      if (name !== 'theme' && name !== 'utilities') throw new Error(`unexpected layer @layer ${name}`);
      layers.push(name);
      for (const c of children(block, 'children')) top(c);
      return;
    }
    if (n.type === 'Atrule' && String(n['name']) === 'property') {
      registered.push(raw(n, 'prelude'));
      shell.add('property');
      return;
    }
    if (n.type === 'Rule' && raw(n, 'prelude') === THEME_SELECTOR) {
      shell.add('host-arm');
      out.push(`:root ${text(n['block'] as CssNode)}`);
      return;
    }
    out.push(text(n));
  };

  const propertiesLayer = (block: CssNode): void => {
    const [supports, ...rest] = children(block, 'children');
    if (supports === undefined || rest.length > 0 || supports.type !== 'Atrule' || String(supports['name']) !== 'supports' || raw(supports, 'prelude') !== FALLBACK_CONDITION) {
      throw new Error('@layer properties is not the one @supports fallback block Tailwind 4 writes');
    }
    const [rule, ...more] = children(supports['block'] as CssNode, 'children');
    if (rule === undefined || more.length > 0 || rule.type !== 'Rule' || raw(rule, 'prelude') !== FALLBACK_SELECTOR) throw new Error(`the @property fallback is not one "${FALLBACK_SELECTOR}" rule`);
    for (const d of children(rule['block'] as CssNode, 'children')) {
      if (d.type !== 'Declaration') throw new Error('the @property fallback holds something other than declarations');
      fallback.add(String(d['property']));
    }
    shell.add('property-fallback');
    if (fallbackRule !== null) throw new Error('two @layer properties blocks');
    fallbackRule = `* ${text(rule['block'] as CssNode)}`;
  };

  for (const n of children(ast, 'children')) top(n);
  if (layers.join(' ') !== 'theme utilities' && layers.join(' ') !== 'utilities') throw new Error(`layers in the order ${layers.join(', ')}, not theme then utilities`);
  if ((fallbackRule === null) !== (registered.length === 0) || shell.has('layer-statement') !== (fallbackRule !== null)) throw new Error('@property, the properties layer statement and its fallback block do not come together');
  const missing = registered.filter((p) => !fallback.has(p));
  if (missing.length > 0) throw new Error(`@property ${missing.join(', ')} has no declaration in the fallback rule`);
  if (fallback.size !== registered.length) throw new Error(`the fallback rule declares ${fallback.size} properties, ${registered.length} are registered`);
  return { css: `${[...(fallbackRule === null ? [] : [fallbackRule]), ...out].join('\n')}\n`, shell: [...shell].sort() };
}
