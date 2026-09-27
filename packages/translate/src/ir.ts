// The typed IR shared by every emitter. Lowering (lower.ts) resolves every TypeScript type into these types and makes every
// conversion explicit, so an emitter only prints.

export type Ty =
  | { readonly k: 'num' }
  | { readonly k: 'bool' }
  | { readonly k: 'str' }
  | { readonly k: 'void' }
  | { readonly k: 'never' }
  | { readonly k: 'null' }
  /** A caught exception (a catch clause variable). */
  | { readonly k: 'error' }
  | { readonly k: 'class'; readonly name: string }
  | { readonly k: 'union'; readonly name: string }
  | { readonly k: 'array'; readonly elem: Ty }
  | { readonly k: 'map'; readonly key: Ty; readonly value: Ty }
  | { readonly k: 'opt'; readonly inner: Ty }
  | { readonly k: 'fn'; readonly params: readonly Ty[]; readonly ret: Ty };

export const NUM: Ty = { k: 'num' };
export const BOOL: Ty = { k: 'bool' };
export const STR: Ty = { k: 'str' };
export const VOID: Ty = { k: 'void' };
export const NEVER: Ty = { k: 'never' };
export const NULL: Ty = { k: 'null' };

export function tyEq(a: Ty, b: Ty): boolean {
  return tyKey(a) === tyKey(b);
}

export function tyKey(t: Ty): string {
  switch (t.k) {
    case 'class':
    case 'union':
      return `${t.k}:${t.name}`;
    case 'array':
      return `[${tyKey(t.elem)}]`;
    case 'map':
      return `{${tyKey(t.key)}:${tyKey(t.value)}}`;
    case 'opt':
      return `${tyKey(t.inner)}?`;
    case 'fn':
      return `(${t.params.map(tyKey).join(',')})=>${tyKey(t.ret)}`;
    default:
      return t.k;
  }
}

/** A source position, printed as `// ts: file.ts:line`. */
export type Loc = { readonly file: string; readonly line: number };

export type Field = { readonly name: string; readonly ty: Ty; readonly mutable: boolean };

export type ClassDecl = {
  readonly kind: 'class';
  readonly name: string;
  readonly fields: readonly Field[];
  /** Union protocols (sealed interfaces) this class is a member of. */
  readonly unions: readonly string[];
  /** Set for `class X extends Error`: the message expression over the constructor parameters (which are the fields). */
  readonly error: { readonly message: Expr } | null;
  readonly loc: Loc;
};

export type UnionDecl = {
  readonly kind: 'union';
  readonly name: string;
  readonly members: readonly string[];
  /** Fields present with one type in every member. */
  readonly common: readonly Field[];
};

export type Param = { readonly name: string; readonly ty: Ty };

export type FuncDecl = {
  readonly kind: 'func';
  readonly name: string;
  readonly params: readonly Param[];
  readonly ret: Ty;
  readonly body: readonly Stmt[];
  readonly loc: Loc;
};

export type ConstDecl = { readonly kind: 'const'; readonly name: string; readonly ty: Ty; readonly init: Expr; readonly loc: Loc };

export type Decl = ClassDecl | UnionDecl | FuncDecl | ConstDecl;

export type Stmt =
  | { readonly s: 'let'; readonly name: string; readonly ty: Ty; readonly mutable: boolean; readonly init: Expr | null; readonly loc: Loc }
  | { readonly s: 'localFunc'; readonly name: string; readonly params: readonly Param[]; readonly ret: Ty; readonly body: readonly Stmt[]; readonly loc: Loc }
  | { readonly s: 'expr'; readonly e: Expr; readonly loc: Loc }
  | { readonly s: 'assign'; readonly target: Expr; readonly op: '=' | '+=' | '-='; readonly value: Expr; readonly loc: Loc }
  | { readonly s: 'if'; readonly cond: Expr; readonly then: readonly Stmt[]; readonly else: readonly Stmt[] | null; readonly loc: Loc }
  | { readonly s: 'while'; readonly cond: Expr; readonly body: readonly Stmt[]; readonly loc: Loc }
  /** A C-style for loop; `continues` says whether the body continues this loop (the emitters then run incr on continue). */
  | { readonly s: 'for'; readonly init: readonly Stmt[]; readonly cond: Expr | null; readonly incr: readonly Stmt[]; readonly body: readonly Stmt[]; readonly continues: boolean; readonly label: string | null; readonly loc: Loc }
  /** for...of over a live array (the length is read on every step, as the JS array iterator does). */
  | { readonly s: 'forOf'; readonly name: string; readonly ty: Ty; readonly iter: Expr; readonly body: readonly Stmt[]; readonly loc: Loc }
  /** for (const [k, v] of map): insertion order. */
  | { readonly s: 'forOfMap'; readonly key: string; readonly value: string; readonly map: Expr; readonly body: readonly Stmt[]; readonly loc: Loc }
  | { readonly s: 'return'; readonly e: Expr | null; readonly loc: Loc }
  | { readonly s: 'throw'; readonly e: Expr; readonly loc: Loc }
  | { readonly s: 'try'; readonly body: readonly Stmt[]; readonly name: string; readonly handler: readonly Stmt[]; readonly loc: Loc }
  | { readonly s: 'switch'; readonly subject: Expr; readonly cases: readonly { readonly values: readonly Expr[]; readonly body: readonly Stmt[] }[]; readonly dflt: readonly Stmt[] | null; readonly loc: Loc }
  /** target: the label of the enclosing for loop whose continue runs its incrementor, or null for a plain loop. */
  | { readonly s: 'break'; readonly target: string | null; readonly loc: Loc }
  | { readonly s: 'continue'; readonly target: string | null; readonly loc: Loc };

export type BinOp = '+' | '-' | '*' | '/' | '<' | '<=' | '>' | '>=' | '==' | '!=';

/** Library operations; each emitter maps each one to its audited prelude helper. */
export type Builtin =
  | 'fround' | 'trunc' | 'floor' | 'ceil' | 'round'
  | 'isNaN' | 'isFinite' | 'isInteger'
  | 'arrLength' | 'arrIndex' | 'arrPush' | 'arrMap' | 'arrMapI' | 'arrFilter' | 'arrFind' | 'arrSome' | 'arrForEach' | 'arrForEachI'
  | 'arrSlice' | 'arrReverse' | 'arrFlatMap' | 'arrSort' | 'arrCopy' | 'arrConcat'
  | 'strCodePoints' | 'strCodePointAt0' | 'numToStringRadix16' | 'strToUpperCase' | 'numToString'
  | 'mapGet' | 'mapSet' | 'mapHas'
  | 'hostBitsHex' | 'hostHexBits' | 'hostParseNumber' | 'hostFromCodePoint'
  /** Planted fault int32-cumulative only: narrows to a 32-bit integer. */
  | 'plantInt32';

export type Expr = { readonly ty: Ty } & (
  | { readonly e: 'num'; readonly value: number }
  | { readonly e: 'str'; readonly value: string }
  | { readonly e: 'bool'; readonly value: boolean }
  | { readonly e: 'null' }
  | { readonly e: 'local'; readonly name: string }
  | { readonly e: 'global'; readonly name: string }
  | { readonly e: 'field'; readonly obj: Expr; readonly name: string }
  | { readonly e: 'call'; readonly fn: string; readonly args: readonly Expr[] }
  | { readonly e: 'callValue'; readonly callee: Expr; readonly args: readonly Expr[] }
  | { readonly e: 'builtin'; readonly op: Builtin; readonly args: readonly Expr[] }
  | { readonly e: 'bin'; readonly op: BinOp; readonly operand: 'num' | 'str' | 'bool' | 'ref'; readonly l: Expr; readonly r: Expr }
  | { readonly e: 'isNull'; readonly x: Expr; readonly negate: boolean }
  | { readonly e: 'and' | 'or'; readonly l: Expr; readonly r: Expr }
  | { readonly e: 'not'; readonly x: Expr }
  | { readonly e: 'neg'; readonly x: Expr }
  | { readonly e: 'cond'; readonly c: Expr; readonly a: Expr; readonly b: Expr }
  | { readonly e: 'new'; readonly cls: string; readonly args: readonly Expr[] }
  | { readonly e: 'newError'; readonly message: Expr }
  | { readonly e: 'arr'; readonly items: readonly Expr[] }
  | { readonly e: 'mapNew'; readonly entries: readonly (readonly [Expr, Expr])[] }
  | { readonly e: 'lambda'; readonly params: readonly Param[]; readonly ret: Ty; readonly body: readonly Stmt[] }
  | { readonly e: 'concat'; readonly parts: readonly Expr[] }
  /** Downcast of a union (or caught error) to a member class or another union; traps if wrong, as TS narrowing proved. */
  | { readonly e: 'cast'; readonly x: Expr }
  /** Optional to value: throws a JS-style TypeError-like invariant error when absent. */
  | { readonly e: 'unwrap'; readonly x: Expr }
  /** Optional of one union to optional of a narrower type. */
  | { readonly e: 'castOpt'; readonly x: Expr }
  | { readonly e: 'instanceOf'; readonly x: Expr; readonly cls: string }
  /** x++ / x-- in expression position: the old value. */
  | { readonly e: 'postInc'; readonly target: Expr; readonly delta: 1 | -1 }
);

export type Program = {
  readonly decls: readonly Decl[];
  /** Every distinct string literal, sorted (Swift interns them). */
  readonly strings: readonly string[];
  /** Source files translated, with their sha256. */
  readonly sources: readonly { readonly file: string; readonly sha256: string }[];
};
