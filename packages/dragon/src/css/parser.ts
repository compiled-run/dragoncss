// css-tree 3.2.1's stylesheet parser with one change: an @layer block nested in a style rule parses as a nested declaration list
// (css-nesting-1 §3.2), as css-tree already parses @media, @supports and @container there. css-tree parses it as a rule list, so its
// declarations became parse errors that stopped the whole analysis, enclosed rules of other at-rules included.
import { fork } from 'css-tree';
import type { CssNode, ParseOptions } from 'css-tree';
import { list } from './ast.ts';

const syntax = fork({
  atrule: {
    // fork replaces an at-rule's parse functions as a whole, so the prelude is css-tree's own (lib/syntax/atrule/layer.js).
    layer: {
      parse: {
        prelude() {
          return this.createSingleNodeList(this.LayerList());
        },
        block(nested = false) {
          return this.Block(nested);
        },
      },
    },
  },
});

/** The offsets of every @layer block nested in a style rule: Dragon refuses that @layer, and reports what is inside it with it. */
function nestedLayerBlocks(node: CssNode, inRule: boolean, out: { start: number; end: number }[]): void {
  const block = node['block'] as CssNode | null | undefined;
  if (inRule && node.type === 'Atrule' && String(node['name']).toLowerCase() === 'layer' && block?.loc !== undefined && block.loc !== null) out.push({ start: block.loc.start.offset, end: block.loc.end.offset });
  for (const c of [...list(node, 'children'), ...(block === null || block === undefined ? [] : [block])]) nestedLayerBlocks(c, inRule || node.type === 'Rule', out);
}

/**
 * Parses a stylesheet. A parse error inside a nested @layer block (css-tree reads a nested style rule there only after "&") is not
 * reported, since the @layer itself is refused with what its block holds as related entries.
 */
export function parseCss(text: string, options: ParseOptions): CssNode {
  const errors: { message: string; offset: number }[] = [];
  const ast = syntax.parse(text, { ...options, onParseError: (e) => errors.push(e) });
  const nested: { start: number; end: number }[] = [];
  if (options.positions === true) nestedLayerBlocks(ast, false, nested);
  for (const e of errors) if (!nested.some((b) => e.offset >= b.start && e.offset <= b.end)) options.onParseError?.(e);
  return ast;
}
