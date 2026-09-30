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
  /** Identifier escapes: decode gives the identifier's value with escapes resolved. */
  export const ident: { decode(text: string): string; encode(text: string): string };
  export type MatchResult = { readonly error: { readonly name: string; readonly message: string } | null };
  export interface Lexer {
    matchProperty(property: string, value: CssNode | string): MatchResult;
  }
  export type Syntax = { readonly lexer: Lexer };
  export function fork(extension: {
    properties?: { readonly [name: string]: string };
    types?: { readonly [name: string]: string };
  }): Syntax;
}
