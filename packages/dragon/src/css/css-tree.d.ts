// Minimal types for the parts of css-tree 3.2.1 the compiler uses (the package ships no declarations).
declare module 'css-tree' {
  export type Location = {
    readonly source: string;
    readonly start: { readonly offset: number; readonly line: number; readonly column: number };
    readonly end: { readonly offset: number; readonly line: number; readonly column: number };
  };
  export interface List<T> {
    toArray(): T[];
    readonly size: number;
  }
  export type CssNode = { readonly type: string; readonly loc?: Location | null } & { readonly [key: string]: unknown };
  export type ParseOptions = {
    context?: string;
    positions?: boolean;
    offset?: number;
    parseValue?: boolean;
    parseRulePrelude?: boolean;
    onParseError?: (error: { message: string; offset: number }) => void;
  };
  export function parse(text: string, options?: ParseOptions): CssNode;
  export function generate(node: CssNode): string;
  /** css-syntax-3 §4 tokens of text; onToken gets each token's type (tokenTypes) and its offsets. */
  export function tokenize(text: string, onToken: (type: number, start: number, end: number) => void): void;
  export const tokenTypes: { readonly [name: string]: number };
  /** Identifier escapes: decode gives the identifier's value with escapes resolved. */
  export const ident: { decode(text: string): string; encode(text: string): string };
  export type MatchResult = { readonly error: { readonly name: string; readonly message: string } | null };
  export interface Lexer {
    matchProperty(property: string, value: CssNode | string): MatchResult;
  }
  export type Syntax = { readonly lexer: Lexer; parse(text: string, options?: ParseOptions): CssNode };
  /** The parser an at-rule's parse functions run on (css-tree lib/parser/create.js), as far as Dragon's overrides call it. */
  export type AtruleParser = { createSingleNodeList(node: CssNode): unknown; LayerList(): CssNode; Block(nested: boolean): CssNode };
  export function fork(extension: {
    properties?: { readonly [name: string]: string };
    types?: { readonly [name: string]: string };
    atrule?: { readonly [name: string]: { readonly parse: { prelude(this: AtruleParser): unknown; block(this: AtruleParser, nested?: boolean): CssNode } } };
  }): Syntax;
}
