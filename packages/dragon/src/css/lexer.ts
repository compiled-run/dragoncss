// css-tree 3.2.1 forked synchronously over the committed @webref/css grammar (docs/api.md §4.4).
import { fork } from 'css-tree';
import type { Lexer } from 'css-tree';
import { properties, types } from './grammar.generated.ts';

let lexer: Lexer | null = null;

export function webrefLexer(): Lexer {
  if (lexer === null) {
    const props: Record<string, string> = {};
    for (const [name, p] of Object.entries(properties)) props[name] = p.syntax;
    lexer = fork({ properties: props, types }).lexer;
  }
  return lexer;
}
