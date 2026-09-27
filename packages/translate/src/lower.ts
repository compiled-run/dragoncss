// Lowers the checked TypeScript subset to the typed IR (ir.ts). Every type comes from the TypeScript checker; every narrowing,
// unwrap and union cast the checker proved becomes an explicit IR node. Anything outside the subset is a Violation with file:line.
import { createHash } from 'node:crypto';
import { basename, relative } from 'node:path';
import ts from 'typescript';
import type { BinOp, Builtin, ClassDecl, ConstDecl, Decl, Expr, Field, FuncDecl, Loc, Param, Program, Stmt, Ty, UnionDecl } from './ir.ts';
import { BOOL, NEVER, NULL, NUM, STR, tyEq, tyKey, VOID } from './ir.ts';

export type Violation = { readonly file: string; readonly line: number; readonly message: string };

class Bail extends Error {}

/** Type names that would shadow a target-language type; they get their file prefix. */
const RESERVED_TYPE_NAMES = new Set(['Char', 'String', 'Array', 'Map', 'Set', 'Error', 'Result', 'Pair', 'Any', 'Unit', 'Nothing', 'Int', 'Double', 'Float', 'Bool', 'Boolean', 'Character', 'Optional', 'Never', 'Void', 'Type', 'Protocol', 'Self', 'JsString', 'JsArray', 'JsError', 'S']);

/** The host module of the translated harness: its functions map to prelude builtins and it is never translated. */
const HOST_FUNCS: Readonly<Record<string, Builtin>> = {
  bitsHex: 'hostBitsHex',
  hexBits: 'hostHexBits',
  parseNumber: 'hostParseNumber',
  fromCodePoints: 'hostFromCodePoint',
};

export type LowerOptions = {
  /** Absolute paths of the files to translate. */
  readonly files: readonly string[];
  /** Absolute path of the harness host module (declared, not translated), or null. */
  readonly hostFile: string | null;
  /** Repository root, for relative paths in locations. */
  readonly root: string;
  /** Collect violations instead of stopping at the first (the subset checker). */
  readonly collect: boolean;
  /** Top-level declarations to start from; null lowers every top-level declaration. */
  readonly roots: readonly { readonly file: string; readonly name: string }[] | null;
};

export function stemOf(file: string): string {
  const b = basename(file).replace(/\.ts$/, '');
  return b.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export function compilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2023,
    lib: ['lib.es2023.d.ts'],
    types: [],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
  };
}

export function createProgram(files: readonly string[]): ts.Program {
  return ts.createProgram([...files], compilerOptions());
}

export class Lowerer {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly violations: Violation[] = [];
  private readonly opts: LowerOptions;
  private readonly fileSet: Set<string>;
  private readonly typeNameOverride = new Map<string, string>();
  private readonly classes = new Map<string, { readonly type: ts.Type; readonly node: ts.Node; decl: ClassDecl | null }>();
  private readonly unions = new Map<string, readonly string[]>();
  private readonly strings = new Set<string>();
  private readonly decls = new Map<string, Decl>();
  private readonly pendingDecls: ts.Declaration[] = [];
  private readonly doneDecls = new Set<ts.Node>();
  private tmp = 0;

  constructor(program: ts.Program, opts: LowerOptions) {
    this.program = program;
    this.checker = program.getTypeChecker();
    this.opts = opts;
    this.fileSet = new Set(opts.files);
    const seen = new Map<string, Set<string>>();
    for (const f of opts.files) {
      const sf = this.source(f);
      for (const st of sf.statements) {
        if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isClassDeclaration(st)) {
          const n = st.name === undefined ? '' : st.name.text;
          const set = seen.get(n) ?? new Set<string>();
          set.add(f);
          seen.set(n, set);
        }
      }
    }
    for (const [n, fs] of seen) {
      if (fs.size > 1 || RESERVED_TYPE_NAMES.has(n)) for (const f of fs) this.typeNameOverride.set(`${f}#${n}`, `${cap(stemOf(f))}_${n}`);
    }
  }

  private source(file: string): ts.SourceFile {
    const sf = this.program.getSourceFile(file);
    if (sf === undefined) throw new Error(`not in program: ${file}`);
    return sf;
  }

  loc(node: ts.Node): Loc {
    const sf = node.getSourceFile();
    return { file: relative(this.opts.root, sf.fileName), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 };
  }

  fail(node: ts.Node, message: string): never {
    const l = this.loc(node);
    this.violations.push({ file: l.file, line: l.line, message });
    throw new Bail(message);
  }

  /** Runs f; in collect mode a violation is recorded and fallback is returned. */
  private guard<T>(f: () => T, fallback: T): T {
    try {
      return f();
    } catch (e) {
      if (e instanceof Bail && this.opts.collect) return fallback;
      throw e;
    }
  }

  // ---------------------------------------------------------------- program

  lower(): Program {
    const roots = this.opts.roots;
    if (roots === null) {
      for (const f of this.opts.files) {
        for (const st of this.source(f).statements) this.queueStatement(st);
      }
    } else {
      for (const r of roots) {
        const decl = this.findTopLevel(r.file, r.name);
        if (decl === null) throw new Error(`root ${r.name} not found in ${r.file}`);
        this.pendingDecls.push(decl);
      }
    }
    while (this.pendingDecls.length > 0) {
      const d = this.pendingDecls.shift() as ts.Declaration;
      if (this.doneDecls.has(d)) continue;
      this.doneDecls.add(d);
      this.guard(() => this.lowerTopLevel(d), undefined);
    }
    // Build classes until no new class is registered, then unions.
    for (;;) {
      const todo = [...this.classes.entries()].filter(([, c]) => c.decl === null);
      if (todo.length === 0) break;
      for (const [name, c] of todo) {
        c.decl = this.guard(() => this.buildClass(name, c.type, c.node), { kind: 'class', name, fields: [], unions: [], error: null, loc: this.loc(c.node) });
      }
    }
    const unionDecls: UnionDecl[] = [];
    for (const [name, members] of [...this.unions.entries()].sort((a, b) => cmp(a[0], b[0]))) {
      const memberDecls = members.map((m) => (this.classes.get(m) as { decl: ClassDecl }).decl);
      const first = memberDecls[0] as ClassDecl;
      const common = first.fields.filter((f) => memberDecls.every((d) => d.fields.some((g) => g.name === f.name && tyEq(g.ty, f.ty))));
      unionDecls.push({ kind: 'union', name, members, common: common.map((f) => ({ name: f.name, ty: f.ty, mutable: false })) });
    }
    const unionsOf = (cls: string): string[] => unionDecls.filter((u) => u.members.includes(cls)).map((u) => u.name);
    const classDecls: ClassDecl[] = [...this.classes.values()].map((c) => {
      const d = c.decl as ClassDecl;
      return { ...d, unions: unionsOf(d.name) };
    });
    const all: Decl[] = [...classDecls, ...unionDecls, ...this.decls.values()];
    const sources = this.opts.files.map((f) => ({ file: relative(this.opts.root, f), sha256: createHash('sha256').update(this.source(f).text).digest('hex') }));
    return { decls: all, strings: [...this.strings].sort(cmp), sources };
  }

  private findTopLevel(file: string, name: string): ts.Declaration | null {
    for (const st of this.source(file).statements) {
      if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return d;
      if (ts.isClassDeclaration(st) && st.name?.text === name) return st;
    }
    return null;
  }

  private queueStatement(st: ts.Statement): void {
    this.guard(() => {
      if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) this.pendingDecls.push(st);
      else if (ts.isVariableStatement(st)) {
        if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return;
        for (const d of st.declarationList.declarations) this.pendingDecls.push(d);
      } else if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) {
        // Every named type must be representable, even when no function uses it yet.
        const t = this.checker.getTypeAtLocation(st.name);
        this.tyOf(t, st);
      } else if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) {
        // Module wiring only.
      } else {
        this.fail(st, `top-level ${ts.SyntaxKind[st.kind]} is outside the subset`);
      }
    }, undefined);
  }

  /** The global name of a top-level function or const: file stem plus name. */
  globalName(decl: ts.Node, name: string): string {
    return `${stemOf(decl.getSourceFile().fileName)}_${name}`;
  }

  private lowerTopLevel(d: ts.Declaration): void {
    if (ts.isFunctionDeclaration(d)) {
      if (d.name === undefined || d.body === undefined) this.fail(d, 'function declarations need a name and a body');
      if (d.typeParameters !== undefined) this.fail(d, 'generic functions are not supported by the translator yet');
      const name = this.globalName(d, d.name.text);
      const sig = this.checker.getSignatureFromDeclaration(d);
      if (sig === undefined) this.fail(d, 'no signature');
      const params = this.params(d.parameters);
      const ret = this.tyOf(this.checker.getReturnTypeOfSignature(sig), d);
      const fn: FuncDecl = { kind: 'func', name, params, ret, body: this.block(d.body, ret, params), loc: this.loc(d) };
      this.decls.set(name, fn);
      return;
    }
    if (ts.isVariableDeclaration(d)) {
      const list = d.parent;
      if (!(list.flags & ts.NodeFlags.Const)) this.fail(d, 'top-level variables must be const');
      if (!ts.isIdentifier(d.name) || d.initializer === undefined) this.fail(d, 'top-level const needs a name and an initializer');
      const name = this.globalName(d, d.name.text);
      const init = d.initializer;
      if (ts.isArrowFunction(init)) {
        const sig = this.checker.getSignatureFromDeclaration(init);
        if (sig === undefined) this.fail(d, 'no signature');
        const ret = this.tyOf(this.checker.getReturnTypeOfSignature(sig), init);
        const params = this.params(init.parameters);
        const body = ts.isBlock(init.body) ? this.block(init.body, ret, params) : this.exprBody(init.body, ret, params);
        this.decls.set(name, { kind: 'func', name, params, ret, body, loc: this.loc(d) });
        return;
      }
      const ty = this.tyOf(this.checker.getTypeAtLocation(d.name), d);
      const c: ConstDecl = { kind: 'const', name, ty, init: this.expr(init, ty), loc: this.loc(d) };
      this.decls.set(name, c);
      return;
    }
    if (ts.isClassDeclaration(d)) {
      // Registered as a class type; built with the other classes.
      const t = this.checker.getTypeAtLocation(d.name ?? d);
      this.tyOf(t, d);
      return;
    }
    this.fail(d, `unsupported declaration ${ts.SyntaxKind[d.kind]}`);
  }

  private params(ps: ts.NodeArray<ts.ParameterDeclaration>): Param[] {
    return ps.map((p) => {
      if (!ts.isIdentifier(p.name)) this.fail(p, 'destructured parameters are outside the subset');
      if (p.questionToken !== undefined || p.initializer !== undefined || p.dotDotDotToken !== undefined) this.fail(p, 'optional, default and rest parameters are outside the subset');
      return { name: p.name.text, ty: this.tyOf(this.checker.getTypeAtLocation(p), p) };
    });
  }

  // ---------------------------------------------------------------- types

  tyOf(t: ts.Type, at: ts.Node): Ty {
    const f = t.flags;
    if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) this.fail(at, 'any and unknown are outside the subset');
    if (f & ts.TypeFlags.Never) return NEVER;
    if (f & ts.TypeFlags.Void) return VOID;
    if (f & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) return NULL;
    if (f & ts.TypeFlags.NumberLike) return NUM;
    if (f & ts.TypeFlags.BooleanLike) return BOOL;
    if (f & ts.TypeFlags.StringLike) return STR;
    if (t.isUnion()) {
      const parts = t.types;
      const hasNull = parts.some((p) => p.flags & ts.TypeFlags.Null);
      const hasUndef = parts.some((p) => p.flags & ts.TypeFlags.Undefined);
      if (hasNull && hasUndef) this.fail(at, 'a value is either T | null or T | undefined, never both');
      const rest = parts.filter((p) => !(p.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
      let base: Ty;
      if (rest.length === 0) return NULL;
      if (rest.every((p) => p.flags & ts.TypeFlags.BooleanLike)) base = BOOL;
      else if (rest.every((p) => p.flags & ts.TypeFlags.StringLike)) base = STR;
      else if (rest.every((p) => p.flags & ts.TypeFlags.NumberLike || (p.isIntersection() && p.types.some((q) => q.flags & ts.TypeFlags.NumberLike)))) base = NUM;
      else if (rest.length === 1) base = this.tyOf(rest[0] as ts.Type, at);
      else {
        const members = rest.map((p) => {
          const m = this.tyOf(p, at);
          if (m.k !== 'class') this.fail(at, `union of ${this.checker.typeToString(t)}: only unions of named object types are in the subset`);
          return m.name;
        });
        const sorted = [...new Set(members)].sort(cmp);
        if (sorted.length === 1) base = { k: 'class', name: sorted[0] as string };
        else {
          const name = `U_${sorted.join('_')}`;
          this.unions.set(name, sorted);
          base = { k: 'union', name };
        }
      }
      return hasNull || hasUndef ? { k: 'opt', inner: base } : base;
    }
    if (t.isIntersection()) {
      if (t.types.some((p) => p.flags & ts.TypeFlags.NumberLike)) return NUM;
      this.fail(at, `intersection ${this.checker.typeToString(t)} is outside the subset (only branded numbers)`);
    }
    if (f & ts.TypeFlags.Object) {
      if (this.checker.isTupleType(t)) this.fail(at, 'tuples are outside the subset');
      if (this.checker.isArrayType(t)) {
        const [e] = this.checker.getTypeArguments(t as ts.TypeReference);
        return { k: 'array', elem: this.tyOf(e as ts.Type, at) };
      }
      const sym = t.getSymbol();
      if (sym !== undefined && (sym.name === 'Map' || sym.name === 'ReadonlyMap') && this.isLib(sym)) {
        const args = this.checker.getTypeArguments(t as ts.TypeReference);
        const key = this.tyOf(args[0] as ts.Type, at);
        if (key.k !== 'str' && key.k !== 'class' && key.k !== 'union') this.fail(at, 'Map keys are strings or object references');
        return { k: 'map', key, value: this.tyOf(args[1] as ts.Type, at) };
      }
      if (sym !== undefined && this.isLib(sym)) {
        if (sym.name === 'Error') return { k: 'class', name: 'JsError' };
        this.fail(at, `library type ${sym.name} is outside the subset`);
      }
      const calls = t.getCallSignatures();
      if (calls.length > 0) {
        if (calls.length > 1 || t.getProperties().length > 0) this.fail(at, 'overloaded or property-carrying function types are outside the subset');
        const sig = calls[0] as ts.Signature;
        if (sig.typeParameters !== undefined) this.fail(at, 'generic function types are outside the subset');
        const params = sig.getParameters().map((p) => this.tyOf(this.checker.getTypeOfSymbolAtLocation(p, at), at));
        return { k: 'fn', params, ret: this.tyOf(sig.getReturnType(), at) };
      }
      const name = this.classNameOf(t, at);
      if (!this.classes.has(name)) this.classes.set(name, { type: t, node: at, decl: null });
      return { k: 'class', name };
    }
    this.fail(at, `type ${this.checker.typeToString(t)} is outside the subset`);
  }

  private isLib(sym: ts.Symbol): boolean {
    const d = sym.declarations?.[0];
    return d !== undefined && this.program.isSourceFileDefaultLibrary(d.getSourceFile());
  }

  private typeName(node: ts.TypeAliasDeclaration | ts.InterfaceDeclaration | ts.ClassDeclaration): string {
    const n = node.name === undefined ? 'Anonymous' : node.name.text;
    return this.typeNameOverride.get(`${node.getSourceFile().fileName}#${n}`) ?? n;
  }

  private classNameOf(t: ts.Type, at: ts.Node): string {
    const decl = t.getSymbol()?.declarations?.[0];
    if (decl === undefined) this.fail(at, `object type ${this.checker.typeToString(t)} has no declaration`);
    if (!this.fileSet.has(decl.getSourceFile().fileName)) this.fail(at, `object type ${this.checker.typeToString(t)} is declared outside the translated files`);
    if (ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl)) return this.typeName(decl);
    if (ts.isTypeLiteralNode(decl)) return this.nameForTypeLiteral(decl, at);
    this.fail(at, `object type ${this.checker.typeToString(t)} must be a named type alias (found ${ts.SyntaxKind[decl.kind]})`);
  }

  private nameForTypeLiteral(node: ts.TypeLiteralNode, at: ts.Node): string {
    let p: ts.Node = node.parent;
    while (ts.isParenthesizedTypeNode(p)) p = p.parent;
    if (ts.isTypeAliasDeclaration(p)) return this.typeName(p);
    if (ts.isUnionTypeNode(p)) {
      const owner = this.ownerName(p, at);
      const index = p.types.indexOf(node as ts.TypeNode);
      return `${owner}_${this.discriminant(node, index)}`;
    }
    return this.ownerName(node, at);
  }

  /** The name of the named type a type literal is nested in, through arrays, readonly and unions, plus the property path. */
  private ownerName(node: ts.Node, at: ts.Node): string {
    let p: ts.Node = node.parent;
    while (ts.isParenthesizedTypeNode(p) || ts.isArrayTypeNode(p) || ts.isTypeOperatorNode(p) || ts.isUnionTypeNode(p)) p = p.parent;
    if (ts.isTypeAliasDeclaration(p)) return this.typeName(p);
    if (ts.isPropertySignature(p) && ts.isIdentifier(p.name)) {
      const owner = p.parent;
      if (ts.isInterfaceDeclaration(owner)) return `${this.typeName(owner)}_${p.name.text}`;
      if (ts.isTypeLiteralNode(owner)) return `${this.nameForTypeLiteral(owner, at)}_${p.name.text}`;
    }
    this.fail(at, 'anonymous object type: give it a name with a type alias');
  }

  private discriminant(node: ts.TypeLiteralNode, index: number): string {
    for (const m of node.members) {
      if (!ts.isPropertySignature(m) || m.type === undefined || !ts.isIdentifier(m.name)) continue;
      const tn = m.type;
      if (ts.isLiteralTypeNode(tn)) {
        if (ts.isStringLiteral(tn.literal)) return m.name.text === 'kind' ? ident(tn.literal.text) : `${m.name.text}_${ident(tn.literal.text)}`;
        if (tn.literal.kind === ts.SyntaxKind.TrueKeyword) return `${m.name.text}True`;
        if (tn.literal.kind === ts.SyntaxKind.FalseKeyword) return `${m.name.text}False`;
      }
    }
    return String(index);
  }

  private buildClass(name: string, t: ts.Type, at: ts.Node): ClassDecl {
    const decl = t.getSymbol()?.declarations?.[0] as ts.Node;
    const fields: Field[] = [];
    let error: ClassDecl['error'] = null;
    if (ts.isClassDeclaration(decl)) {
      const ext = decl.heritageClauses?.[0]?.types[0];
      if (ext === undefined || ext.expression.getText() !== 'Error') this.fail(decl, 'the only class form in the subset is `class X extends Error`');
      let ctor: ts.ConstructorDeclaration | null = null;
      for (const m of decl.members) {
        if (ts.isPropertyDeclaration(m)) {
          if (!ts.isIdentifier(m.name) || !m.modifiers?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword) || m.initializer !== undefined) this.fail(m, 'class fields are readonly and set in the constructor');
          fields.push({ name: m.name.text, ty: this.tyOf(this.checker.getTypeAtLocation(m), m), mutable: false });
        } else if (ts.isConstructorDeclaration(m)) ctor = m;
        else this.fail(m, 'class members other than readonly fields and one constructor are outside the subset');
      }
      if (ctor === null || ctor.body === undefined) this.fail(decl, 'error classes need a constructor');
      // Pattern: constructor(<one param per field, same names>) { super(message); this.<field> = <param>; ... }
      const params = ctor.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ''));
      if (params.length !== fields.length || fields.some((f, i) => params[i] !== f.name)) this.fail(ctor, 'error class constructor parameters must be the fields in order');
      const [first, ...rest] = ctor.body.statements;
      if (first === undefined || !ts.isExpressionStatement(first) || !ts.isCallExpression(first.expression) || first.expression.expression.kind !== ts.SyntaxKind.SuperKeyword) this.fail(ctor, 'constructor must start with super(message)');
      const msg = first.expression.arguments[0];
      if (msg === undefined) this.fail(ctor, 'super needs a message');
      for (const st of rest) {
        const ok = ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression) && st.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isPropertyAccessExpression(st.expression.left) && st.expression.left.expression.kind === ts.SyntaxKind.ThisKeyword
          && ts.isIdentifier(st.expression.right) && st.expression.right.text === st.expression.left.name.text;
        if (!ok) this.fail(st, 'constructor body may only assign this.<field> = <field>');
      }
      const scope = new Scope(null);
      for (const f of fields) scope.declare(f.name, f.ty);
      error = { message: this.withScope(scope, () => this.expr(msg, STR)) };
      return { kind: 'class', name, fields, unions: [], error, loc: this.loc(decl) };
    }
    for (const p of this.checker.getPropertiesOfType(t)) {
      const pd = p.declarations?.[0];
      if (pd === undefined) this.fail(at, `property ${p.name} has no declaration`);
      if (ts.isPropertySignature(pd) || ts.isMethodSignature(pd)) {
        if (pd.questionToken !== undefined) this.fail(pd, 'optional properties are outside the subset');
        const readonly = ts.isMethodSignature(pd) || (pd.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false);
        if (!ts.isIdentifier(pd.name)) this.fail(pd, 'computed property names are outside the subset');
        fields.push({ name: pd.name.text, ty: this.tyOf(this.checker.getTypeOfSymbolAtLocation(p, pd), pd), mutable: !readonly });
      } else this.fail(pd, `property ${p.name}: ${ts.SyntaxKind[pd.kind]} is outside the subset`);
    }
    return { kind: 'class', name, fields, unions: [], error: null, loc: this.loc(decl) };
  }

  classDecl(name: string): ClassDecl | null {
    const c = this.classes.get(name);
    if (c === undefined) return null;
    if (c.decl === null) c.decl = this.buildClass(name, c.type, c.node);
    return c.decl;
  }

  private unionMembers(name: string): readonly string[] {
    return this.unions.get(name) ?? [];
  }

  /** The type of field `name` on a class or union type, or null. */
  private fieldTy(obj: Ty, name: string): { ty: Ty; mutable: boolean } | null {
    if (obj.k === 'class') {
      const d = this.classDecl(obj.name);
      const f = d?.fields.find((x) => x.name === name);
      return f === undefined ? null : { ty: f.ty, mutable: f.mutable };
    }
    if (obj.k === 'union') {
      const members = this.unionMembers(obj.name).map((m) => this.classDecl(m) as ClassDecl);
      const first = members[0]?.fields.find((x) => x.name === name);
      if (first === undefined) return null;
      if (!members.every((m) => m.fields.some((x) => x.name === name && tyEq(x.ty, first.ty)))) return null;
      return { ty: first.ty, mutable: false };
    }
    return null;
  }

  // ---------------------------------------------------------------- conversions

  /** Converts e to type to, inserting unwraps and casts; structural conversion between distinct classes is a violation. */
  coerce(e: Expr, to: Ty, at: ts.Node): Expr {
    const from = e.ty;
    if (tyEq(from, to) || to.k === 'void' || from.k === 'never') return e;
    if (from.k === 'null' && to.k === 'opt') return { ...e, ty: to };
    if (to.k === 'opt') {
      if (from.k === 'opt') {
        if (this.isSubtype(from.inner, to.inner)) return { ty: to, e: 'castOpt', x: e };
        if (this.isSubtype(to.inner, from.inner) || from.inner.k === 'union') return { ty: to, e: 'castOpt', x: e };
        this.fail(at, `cannot convert ${tyKey(from)} to ${tyKey(to)}`);
      }
      return this.coerce(e, to.inner, at);
    }
    if (from.k === 'opt') return this.coerce({ ty: from.inner, e: 'unwrap', x: e }, to, at);
    if (from.k === 'class' && to.k === 'union') {
      // Widening a narrowed value: drop the cast when its source already fits (a cast keeps its own target type).
      if (e.e === 'cast' && this.isSubtype(e.x.ty, to)) return this.coerce(e.x, to, at);
      if (e.e === 'cast' && this.unionMembers(to.name).includes(from.name)) return e;
      if (this.unionMembers(to.name).includes(from.name)) return { ...e, ty: to };
      this.fail(at, `${from.name} is not a member of ${to.name}`);
    }
    if ((from.k === 'union' || from.k === 'error') && (to.k === 'class' || to.k === 'union')) return { ty: to, e: 'cast', x: e };
    if (from.k === 'array' && to.k === 'array' && from.elem.k === 'never') return { ...e, ty: to };
    if (from.k === 'array' && to.k === 'array' && e.e === 'arr') {
      return { ty: to, e: 'arr', items: e.items.map((i) => this.coerce(i, to.elem, at)) };
    }
    if (from.k === 'map' && to.k === 'map' && e.e === 'mapNew' && e.entries.length === 0) return { ...e, ty: to };
    if (from.k === 'fn' && to.k === 'fn' && from.params.length === to.params.length && from.params.every((p, i) => tyEq(p, to.params[i] as Ty)) && (tyEq(from.ret, to.ret) || from.ret.k === 'never')) return { ...e, ty: to };
    this.fail(at, `cannot convert ${tyKey(from)} to ${tyKey(to)} (structural conversion is outside the subset)`);
  }

  private isSubtype(a: Ty, b: Ty): boolean {
    if (tyEq(a, b)) return true;
    if (a.k === 'class' && b.k === 'union') return this.unionMembers(b.name).includes(a.name);
    if (a.k === 'union' && b.k === 'union') return this.unionMembers(a.name).every((m) => this.unionMembers(b.name).includes(m));
    return false;
  }

  // ---------------------------------------------------------------- scopes

  private scope: Scope = new Scope(null);
  private fnRet: Ty = VOID;
  private loops: { readonly label: string | null }[] = [];

  private withScope<T>(s: Scope, f: () => T): T {
    const prev = this.scope;
    this.scope = s;
    try {
      return f();
    } finally {
      this.scope = prev;
    }
  }

  // ---------------------------------------------------------------- statements

  private block(b: ts.Block, ret: Ty, params: readonly Param[] | null = null): Stmt[] {
    return this.fnBody(b.statements, ret, params);
  }

  private fnBody(sts: readonly ts.Statement[], ret: Ty, params: readonly Param[] | null): Stmt[] {
    const prevRet = this.fnRet;
    const prevLoops = this.loops;
    this.fnRet = ret;
    this.loops = [];
    const s = new Scope(this.scope, true);
    try {
      return this.withScope(s, () => {
        if (params !== null) for (const p of params) s.declare(p.name, p.ty);
        return this.stmts(sts);
      });
    } finally {
      this.fnRet = prevRet;
      this.loops = prevLoops;
    }
  }

  private stmts(sts: readonly ts.Statement[]): Stmt[] {
    const out: Stmt[] = [];
    for (const st of sts) out.push(...this.guard(() => this.stmt(st), [] as Stmt[]));
    return out;
  }

  private nested(st: ts.Statement): Stmt[] {
    return this.withScope(new Scope(this.scope), () => (ts.isBlock(st) ? this.stmts(st.statements) : this.stmt(st)));
  }

  private exprBody(e: ts.Expression, ret: Ty, params: readonly Param[]): Stmt[] {
    const prevRet = this.fnRet;
    const prevLoops = this.loops;
    this.fnRet = ret;
    this.loops = [];
    try {
      return this.withScope(new Scope(this.scope, true), () => {
        for (const p of params) this.scope.declare(p.name, p.ty);
        return [this.returnOf(e, ret)];
      });
    } finally {
      this.fnRet = prevRet;
      this.loops = prevLoops;
    }
  }

  private returnOf(e: ts.Expression, ret: Ty): Stmt {
    const x = this.expr(e, ret);
    if (x.ty.k === 'never' || ret.k === 'void') return { s: 'expr', e: x, loc: this.loc(e) };
    return { s: 'return', e: x, loc: this.loc(e) };
  }

  private stmt(st: ts.Statement): Stmt[] {
    const loc = this.loc(st);
    if (ts.isVariableStatement(st)) return this.varDecls(st.declarationList);
    if (ts.isExpressionStatement(st)) return [this.exprStmt(st.expression)];
    if (ts.isIfStatement(st)) {
      return [{ s: 'if', cond: this.cond(st.expression), then: this.nested(st.thenStatement), else: st.elseStatement === undefined ? null : this.nested(st.elseStatement), loc }];
    }
    if (ts.isReturnStatement(st)) {
      if (st.expression === undefined) return [{ s: 'return', e: null, loc }];
      const x = this.expr(st.expression, this.fnRet);
      // A call that never returns stands alone: Swift cannot return Never as another type.
      if (x.ty.k === 'never') return [{ s: 'expr', e: x, loc }];
      return [{ s: 'return', e: x, loc }];
    }
    if (ts.isThrowStatement(st)) {
      const x = this.expr(st.expression, null);
      if (x.ty.k !== 'class' && x.ty.k !== 'error') this.fail(st, 'throw an Error or a subset error class');
      return [{ s: 'throw', e: x, loc }];
    }
    if (ts.isWhileStatement(st)) {
      this.loops.push({ label: null });
      try {
        return [{ s: 'while', cond: this.cond(st.expression), body: this.nested(st.statement), loc }];
      } finally {
        this.loops.pop();
      }
    }
    if (ts.isForStatement(st)) return [this.forStmt(st)];
    if (ts.isForOfStatement(st)) return [this.forOf(st)];
    if (ts.isBreakStatement(st) || ts.isContinueStatement(st)) {
      if (st.label !== undefined) this.fail(st, 'labels are outside the subset');
      const loop = this.loops[this.loops.length - 1];
      if (loop === undefined) this.fail(st, 'break or continue outside a loop');
      return [ts.isBreakStatement(st) ? { s: 'break', target: loop.label, loc } : { s: 'continue', target: loop.label, loc }];
    }
    if (ts.isTryStatement(st)) {
      if (st.finallyBlock !== undefined || st.catchClause === undefined) this.fail(st, 'try needs a catch and no finally');
      const v = st.catchClause.variableDeclaration;
      if (v === undefined || !ts.isIdentifier(v.name) || v.type !== undefined) this.fail(st, 'catch (e) with an unannotated identifier');
      const body = this.nested(st.tryBlock);
      const handler = this.withScope(new Scope(this.scope), () => {
        this.scope.declare((v.name as ts.Identifier).text, { k: 'error' });
        return this.stmts((st.catchClause as ts.CatchClause).block.statements);
      });
      return [{ s: 'try', body, name: v.name.text, handler, loc }];
    }
    if (ts.isSwitchStatement(st)) return [this.switchStmt(st)];
    if (ts.isBlock(st)) this.fail(st, 'bare blocks are outside the subset');
    if (ts.isFunctionDeclaration(st)) this.fail(st, 'nested function declarations are outside the subset; use a const arrow function');
    this.fail(st, `${ts.SyntaxKind[st.kind]} is outside the subset`);
  }

  private varDecls(list: ts.VariableDeclarationList): Stmt[] {
    const isConst = (list.flags & ts.NodeFlags.Const) !== 0;
    const isLet = (list.flags & ts.NodeFlags.Let) !== 0;
    if (!isConst && !isLet) this.fail(list, 'var is outside the subset');
    const out: Stmt[] = [];
    for (const d of list.declarations) {
      if (!ts.isIdentifier(d.name)) this.fail(d, 'destructuring is outside the subset');
      const name = d.name.text;
      const init = d.initializer;
      if (isConst && init !== undefined && ts.isArrowFunction(init)) {
        const sig = this.checker.getSignatureFromDeclaration(init) as ts.Signature;
        const params = this.params(init.parameters);
        const ret = this.tyOf(this.checker.getReturnTypeOfSignature(sig), init);
        this.scope.declare(name, { k: 'fn', params: params.map((p) => p.ty), ret });
        const body = ts.isBlock(init.body) ? this.block(init.body, ret, params) : this.exprBody(init.body, ret, params);
        out.push({ s: 'localFunc', name, params, ret, body, loc: this.loc(d) });
        continue;
      }
      const ty = this.tyOf(this.checker.getTypeAtLocation(d.name), d);
      const x = init === undefined ? null : this.expr(init, ty);
      this.scope.declare(name, ty);
      out.push({ s: 'let', name, ty, mutable: !isConst, init: x, loc: this.loc(d) });
    }
    return out;
  }

  private exprStmt(e: ts.Expression): Stmt {
    const loc = this.loc(e);
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.EqualsToken || op === ts.SyntaxKind.PlusEqualsToken || op === ts.SyntaxKind.MinusEqualsToken) {
        const target = this.lvalue(e.left);
        const opStr = op === ts.SyntaxKind.EqualsToken ? '=' : op === ts.SyntaxKind.PlusEqualsToken ? '+=' : '-=';
        if (opStr !== '=' && target.ty.k !== 'num' && !(opStr === '+=' && target.ty.k === 'str')) this.fail(e, 'compound assignment on numbers (or += on strings) only');
        return { s: 'assign', target, op: opStr, value: this.expr(e.right, target.ty), loc };
      }
    }
    if ((ts.isPostfixUnaryExpression(e) || ts.isPrefixUnaryExpression(e)) && (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken)) {
      const target = this.lvalue(e.operand);
      if (target.ty.k !== 'num') this.fail(e, '++ and -- on numbers only');
      return { s: 'assign', target, op: e.operator === ts.SyntaxKind.PlusPlusToken ? '+=' : '-=', value: { ty: NUM, e: 'num', value: 1 }, loc };
    }
    if (ts.isCallExpression(e)) {
      const x = this.expr(e, null);
      return { s: 'expr', e: x, loc };
    }
    this.fail(e, `expression statement ${ts.SyntaxKind[e.kind]} is outside the subset`);
  }

  /** An assignable place: a local variable or a mutable field. */
  private lvalue(e: ts.Expression): Expr {
    if (ts.isParenthesizedExpression(e)) return this.lvalue(e.expression);
    if (ts.isIdentifier(e)) {
      const v = this.scope.lookup(e.text);
      if (v === null) this.fail(e, `assignment to ${e.text}, which is not a local variable`);
      return { ty: v, e: 'local', name: e.text };
    }
    if (ts.isPropertyAccessExpression(e)) {
      const obj = this.expr(e.expression, null);
      const f = this.fieldTy(obj.ty, e.name.text);
      if (f === null || !f.mutable) this.fail(e, `assignment to ${e.name.text}, which is not a mutable field`);
      return { ty: f.ty, e: 'field', obj, name: e.name.text };
    }
    this.fail(e, 'assignment target is outside the subset');
  }

  private forStmt(st: ts.ForStatement): Stmt {
    const loc = this.loc(st);
    return this.withScope(new Scope(this.scope), () => {
      let init: Stmt[] = [];
      if (st.initializer !== undefined) {
        if (!ts.isVariableDeclarationList(st.initializer)) this.fail(st, 'for initializer must declare variables');
        init = this.varDecls(st.initializer);
      }
      const cond = st.condition === undefined ? null : this.cond(st.condition);
      const incr = st.incrementor === undefined ? [] : [this.exprStmt(st.incrementor)];
      const continues = containsContinue(st.statement);
      const label = continues ? `loop${++this.tmp}` : null;
      this.loops.push({ label });
      try {
        const body = this.nested(st.statement);
        return { s: 'for', init, cond, incr, body, continues, label, loc };
      } finally {
        this.loops.pop();
      }
    });
  }

  private forOf(st: ts.ForOfStatement): Stmt {
    const loc = this.loc(st);
    const list = st.initializer;
    if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const) || list.declarations.length !== 1) this.fail(st, 'for (const x of ...) only');
    const d = list.declarations[0] as ts.VariableDeclaration;
    const iterTy = this.tyOf(this.checker.getTypeAtLocation(st.expression), st.expression);
    this.loops.push({ label: null });
    try {
      if (iterTy.k === 'map') {
        if (!ts.isArrayBindingPattern(d.name) || d.name.elements.length !== 2) this.fail(d, 'for (const [key, value] of map) only');
        const [k, v] = d.name.elements.map((el) => {
          if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name)) this.fail(d, 'for (const [key, value] of map) only');
          return el.name.text;
        }) as [string, string];
        const map = this.expr(st.expression, iterTy);
        return this.withScope(new Scope(this.scope), () => {
          this.scope.declare(k, iterTy.key);
          this.scope.declare(v, iterTy.value);
          return { s: 'forOfMap', key: k, value: v, map, body: this.nested(st.statement), loc };
        });
      }
      if (!ts.isIdentifier(d.name)) this.fail(d, 'destructuring is outside the subset');
      const name = d.name.text;
      let iter: Expr;
      let elem: Ty;
      if (iterTy.k === 'array') {
        iter = this.expr(st.expression, iterTy);
        elem = iterTy.elem;
      } else if (iterTy.k === 'str') {
        iter = { ty: { k: 'array', elem: STR }, e: 'builtin', op: 'strCodePoints', args: [this.expr(st.expression, STR)] };
        elem = STR;
      } else this.fail(st, 'for...of over arrays, strings and maps only');
      return this.withScope(new Scope(this.scope), () => {
        this.scope.declare(name, elem);
        return { s: 'forOf', name, ty: elem, iter, body: this.nested(st.statement), loc };
      });
    } finally {
      this.loops.pop();
    }
  }

  private switchStmt(st: ts.SwitchStatement): Stmt {
    const loc = this.loc(st);
    const subjTy = this.tyOf(this.checker.getTypeAtLocation(st.expression), st.expression);
    if (subjTy.k !== 'str' && subjTy.k !== 'num') this.fail(st, 'switch on a string or number');
    const subject = this.expr(st.expression, subjTy);
    const cases: { values: Expr[]; body: Stmt[] }[] = [];
    let dflt: Stmt[] | null = null;
    let pending: Expr[] = [];
    for (const clause of st.caseBlock.clauses) {
      const only = clause.statements.length === 1 ? clause.statements[0] : undefined;
      const stmts = only !== undefined && ts.isBlock(only) ? [...only.statements] : [...clause.statements];
      if (ts.isDefaultClause(clause)) {
        if (pending.length > 0) this.fail(clause, 'default must not share a body with case labels');
      } else {
        pending.push(this.expr(clause.expression, subjTy));
      }
      if (stmts.length === 0) {
        if (ts.isDefaultClause(clause)) this.fail(clause, 'empty default');
        continue;
      }
      const last = stmts[stmts.length - 1] as ts.Statement;
      if (ts.isBreakStatement(last)) stmts.pop();
      else if (!ts.isReturnStatement(last) && !ts.isThrowStatement(last) && !ts.isContinueStatement(last)) this.fail(clause, 'each case ends with break, return, throw or continue (no fallthrough)');
      if (stmts.some((s) => containsBreak(s))) this.fail(clause, 'break inside a case other than the last statement is outside the subset');
      const body = this.withScope(new Scope(this.scope), () => this.stmts(stmts));
      if (ts.isDefaultClause(clause)) dflt = body;
      else {
        cases.push({ values: pending, body });
        pending = [];
      }
    }
    if (pending.length > 0) this.fail(st, 'trailing empty case labels');
    return { s: 'switch', subject, cases, dflt, loc };
  }

  private cond(e: ts.Expression): Expr {
    const x = this.expr(e, null);
    if (x.ty.k !== 'bool') this.fail(e, 'conditions must be boolean (no truthiness of numbers, strings or objects)');
    return x;
  }

  // ---------------------------------------------------------------- expressions

  /** Lowers e and converts it to `want` when given. */
  expr(e: ts.Expression, want: Ty | null): Expr {
    const x = this.exprInner(e, want);
    return want === null ? x : this.coerce(x, want, e);
  }

  private checkerTy(e: ts.Node): Ty {
    return this.tyOf(this.checker.getTypeAtLocation(e), e);
  }

  private str(value: string): Expr {
    this.strings.add(value);
    return { ty: STR, e: 'str', value };
  }

  private exprInner(e: ts.Expression, want: Ty | null): Expr {
    if (ts.isParenthesizedExpression(e)) return this.exprInner(e.expression, want);
    if (ts.isNumericLiteral(e)) return { ty: NUM, e: 'num', value: Number(e.text) };
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return this.str(e.text);
    if (e.kind === ts.SyntaxKind.TrueKeyword) return { ty: BOOL, e: 'bool', value: true };
    if (e.kind === ts.SyntaxKind.FalseKeyword) return { ty: BOOL, e: 'bool', value: false };
    if (e.kind === ts.SyntaxKind.NullKeyword) return { ty: NULL, e: 'null' };
    if (ts.isRegularExpressionLiteral(e)) this.fail(e, 'RegExp is outside the subset');
    if (ts.isTemplateExpression(e)) return this.template(e);
    if (ts.isIdentifier(e)) return this.identifier(e);
    if (ts.isPropertyAccessExpression(e)) return this.propertyAccess(e);
    if (ts.isElementAccessExpression(e)) return this.elementAccess(e);
    if (ts.isCallExpression(e)) return this.call(e);
    if (ts.isNewExpression(e)) return this.newExpr(e, want);
    if (ts.isObjectLiteralExpression(e)) return this.objectLiteral(e, want);
    if (ts.isArrayLiteralExpression(e)) return this.arrayLiteral(e, want);
    if (ts.isArrowFunction(e)) return this.arrow(e, want);
    if (ts.isConditionalExpression(e)) {
      const ty = want ?? this.checkerTy(e);
      const c = this.cond(e.condition);
      return { ty, e: 'cond', c, a: this.expr(e.whenTrue, ty), b: this.expr(e.whenFalse, ty) };
    }
    if (ts.isBinaryExpression(e)) return this.binary(e);
    if (ts.isPrefixUnaryExpression(e)) {
      if (e.operator === ts.SyntaxKind.ExclamationToken) {
        const x = this.expr(e.operand, null);
        if (x.ty.k !== 'bool') this.fail(e, '! on booleans only');
        return { ty: BOOL, e: 'not', x };
      }
      if (e.operator === ts.SyntaxKind.MinusToken) {
        if (ts.isNumericLiteral(e.operand)) return { ty: NUM, e: 'num', value: -Number(e.operand.text) };
        return { ty: NUM, e: 'neg', x: this.expr(e.operand, NUM) };
      }
      this.fail(e, `prefix ${ts.SyntaxKind[e.operator]} in an expression is outside the subset`);
    }
    if (ts.isPostfixUnaryExpression(e)) {
      const target = this.lvalue(e.operand);
      if (target.ty.k !== 'num') this.fail(e, '++ and -- on numbers only');
      return { ty: NUM, e: 'postInc', target, delta: e.operator === ts.SyntaxKind.PlusPlusToken ? 1 : -1 };
    }
    if (ts.isAsExpression(e) || ts.isNonNullExpression(e)) {
      if (ts.isAsExpression(e) && ts.isTypeReferenceNode(e.type) && e.type.typeName.getText() === 'const') this.fail(e, 'as const is outside the subset');
      const target = this.tyOf(this.checker.getTypeAtLocation(e), e);
      const x = this.expr(e.expression, null);
      if (x.ty.k === 'str' && target.k === 'str') return x;
      if (x.ty.k === 'num' && target.k === 'num') return x;
      return this.coerce(x, target, e);
    }
    if (ts.isTypeOfExpression(e)) this.fail(e, 'typeof is outside the subset');
    if (ts.isSpreadElement(e)) this.fail(e, 'spread outside an array literal');
    this.fail(e, `${ts.SyntaxKind[e.kind]} is outside the subset`);
  }

  private template(e: ts.TemplateExpression): Expr {
    const parts: Expr[] = [];
    if (e.head.text !== '') parts.push(this.str(e.head.text));
    for (const span of e.templateSpans) {
      const x = this.expr(span.expression, null);
      if (x.ty.k === 'str') parts.push(x);
      else if (x.ty.k === 'num') parts.push({ ty: STR, e: 'builtin', op: 'numToString', args: [x] });
      else this.fail(span, 'template strings interpolate strings and numbers only');
      if (span.literal.text !== '') parts.push(this.str(span.literal.text));
    }
    return { ty: STR, e: 'concat', parts };
  }

  private resolve(id: ts.Identifier): ts.Symbol | undefined {
    let s = this.checker.getSymbolAtLocation(id);
    if (s !== undefined && s.flags & ts.SymbolFlags.Alias) s = this.checker.getAliasedSymbol(s);
    return s;
  }

  private identifier(e: ts.Identifier): Expr {
    if (e.text === 'undefined') return { ty: NULL, e: 'null' };
    const local = this.scope.lookupDecl(e.text);
    if (local !== null) {
      const x: Expr = { ty: local, e: 'local', name: e.text };
      return this.narrow(x, e);
    }
    const sym = this.resolve(e);
    const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
    if (decl === undefined) this.fail(e, `unresolved ${e.text}`);
    const file = decl.getSourceFile().fileName;
    if (!this.fileSet.has(file)) this.fail(e, `${e.text} is not a translated declaration (globals such as Date, JSON, process and globalThis are outside the subset)`);
    if (ts.isFunctionDeclaration(decl) || (ts.isVariableDeclaration(decl) && decl.parent.parent.parent === decl.getSourceFile())) {
      this.pendingDecls.push(decl);
      const name = this.globalName(decl, e.text);
      if (ts.isFunctionDeclaration(decl) || (ts.isVariableDeclaration(decl) && decl.initializer !== undefined && ts.isArrowFunction(decl.initializer))) {
        const fnTy = this.fnTyOfDecl(decl);
        return { ty: fnTy, e: 'global', name };
      }
      const ty = this.tyOf(this.checker.getTypeAtLocation((decl as ts.VariableDeclaration).name), decl);
      return this.narrow({ ty, e: 'global', name }, e);
    }
    this.fail(e, `${e.text} is not a local, a top-level function or a top-level const`);
  }

  private fnTyOfDecl(decl: ts.FunctionDeclaration | ts.VariableDeclaration): Ty & { k: 'fn' } {
    const node = ts.isFunctionDeclaration(decl) ? decl : (decl.initializer as ts.ArrowFunction);
    const sig = this.checker.getSignatureFromDeclaration(node) as ts.Signature;
    return { k: 'fn', params: node.parameters.map((p) => this.tyOf(this.checker.getTypeAtLocation(p), p)), ret: this.tyOf(this.checker.getReturnTypeOfSignature(sig), node) };
  }

  /** Applies the narrowing the checker proved at node: unwrap of a nullable, cast of a union. */
  private narrow(x: Expr, node: ts.Expression): Expr {
    if (x.ty.k === 'fn') return x;
    const t = this.checker.getTypeAtLocation(node);
    if (x.ty.k === 'error' && t.flags & ts.TypeFlags.Unknown) return x;
    const n = this.tyOf(t, node);
    if (tyEq(n, x.ty) || n.k === 'never' || n.k === 'null') return x;
    return this.coerce(x, n, node);
  }

  private propertyAccess(e: ts.PropertyAccessExpression): Expr {
    if (e.questionDotToken !== undefined) this.fail(e, '?. is outside the subset');
    if (ts.isPrivateIdentifier(e.name)) this.fail(e, 'private names are outside the subset');
    const name = e.name.text;
    if (ts.isIdentifier(e.expression) && (e.expression.text === 'Math' || e.expression.text === 'Number' || e.expression.text === 'JSON')) this.fail(e, `${e.expression.text}.${name} is only allowed as a call from the subset library`);
    const obj = this.expr(e.expression, null);
    if (name === 'length') {
      if (obj.ty.k === 'array') return { ty: NUM, e: 'builtin', op: 'arrLength', args: [obj] };
      if (obj.ty.k === 'str') this.fail(e, 'string length is outside the subset (use code points)');
    }
    const f = this.fieldTy(obj.ty, name);
    if (f === null) this.fail(e, `property ${name} on ${tyKey(obj.ty)} is outside the subset`);
    return this.narrow({ ty: f.ty, e: 'field', obj, name }, e);
  }

  private elementAccess(e: ts.ElementAccessExpression): Expr {
    if (e.questionDotToken !== undefined) this.fail(e, '?. is outside the subset');
    const obj = this.expr(e.expression, null);
    if (obj.ty.k !== 'array') this.fail(e, 'index access on arrays only (no string index)');
    const idx = this.expr(e.argumentExpression, NUM);
    const x: Expr = { ty: { k: 'opt', inner: obj.ty.elem }, e: 'builtin', op: 'arrIndex', args: [obj, idx] };
    return this.narrow(x, e);
  }

  private call(e: ts.CallExpression): Expr {
    if (e.questionDotToken !== undefined) this.fail(e, '?. is outside the subset');
    if (e.typeArguments !== undefined) this.fail(e, 'explicit type arguments in calls are outside the subset');
    const callee = e.expression;
    const args = e.arguments;
    const resultTy = (): Ty => this.checkerTy(e);
    if (ts.isPropertyAccessExpression(callee)) {
      const name = callee.name.text;
      const target = callee.expression;
      if (ts.isIdentifier(target) && target.text === 'Math' && this.resolve(target) !== undefined && this.isLib(this.resolve(target) as ts.Symbol)) {
        const ops: Record<string, Builtin> = { fround: 'fround', trunc: 'trunc', floor: 'floor', ceil: 'ceil', round: 'round' };
        const op = ops[name];
        if (op === undefined || args.length !== 1) this.fail(e, `Math.${name} is outside the subset`);
        return { ty: NUM, e: 'builtin', op, args: [this.expr(args[0] as ts.Expression, NUM)] };
      }
      if (ts.isIdentifier(target) && target.text === 'Number' && this.resolve(target) !== undefined && this.isLib(this.resolve(target) as ts.Symbol)) {
        const ops: Record<string, Builtin> = { isNaN: 'isNaN', isFinite: 'isFinite', isInteger: 'isInteger' };
        const op = ops[name];
        if (op === undefined || args.length !== 1) this.fail(e, `Number.${name} is outside the subset`);
        return { ty: BOOL, e: 'builtin', op, args: [this.expr(args[0] as ts.Expression, NUM)] };
      }
      const objTy = this.tyOf(this.checker.getTypeAtLocation(target), target);
      if (objTy.k === 'array') return this.arrayMethod(e, name, target, objTy);
      if (objTy.k === 'str') {
        const s = this.expr(target, STR);
        if (name === 'codePointAt' && args.length === 1 && ts.isNumericLiteral(args[0] as ts.Expression) && (args[0] as ts.NumericLiteral).text === '0') {
          return { ty: { k: 'opt', inner: NUM }, e: 'builtin', op: 'strCodePointAt0', args: [s] };
        }
        if (name === 'toUpperCase' && args.length === 0) return { ty: STR, e: 'builtin', op: 'strToUpperCase', args: [s] };
        this.fail(e, `string.${name} is outside the subset`);
      }
      if (objTy.k === 'num') {
        if (name === 'toString' && args.length === 1 && ts.isNumericLiteral(args[0] as ts.Expression) && (args[0] as ts.NumericLiteral).text === '16') {
          return { ty: STR, e: 'builtin', op: 'numToStringRadix16', args: [this.expr(target, NUM)] };
        }
        this.fail(e, `number.${name} is outside the subset (only toString(16))`);
      }
      if (objTy.k === 'map') {
        const m = this.expr(target, objTy);
        if (name === 'get' && args.length === 1) return { ty: { k: 'opt', inner: objTy.value }, e: 'builtin', op: 'mapGet', args: [m, this.expr(args[0] as ts.Expression, objTy.key)] };
        if (name === 'has' && args.length === 1) return { ty: BOOL, e: 'builtin', op: 'mapHas', args: [m, this.expr(args[0] as ts.Expression, objTy.key)] };
        if (name === 'set' && args.length === 2) return { ty: objTy, e: 'builtin', op: 'mapSet', args: [m, this.expr(args[0] as ts.Expression, objTy.key), this.expr(args[1] as ts.Expression, objTy.value)] };
        this.fail(e, `Map.${name} is outside the subset`);
      }
      // A function-typed field: an interface method or a closure field.
      const fnVal = this.expr(callee, null);
      if (fnVal.ty.k !== 'fn') this.fail(e, `call of ${name} on ${tyKey(objTy)} is outside the subset`);
      const fnTy = fnVal.ty;
      return { ty: fnTy.ret, e: 'callValue', callee: fnVal, args: this.args(e, fnTy.params) };
    }
    if (ts.isIdentifier(callee)) {
      const local = this.scope.lookupDecl(callee.text);
      if (local !== null) {
        if (local.k !== 'fn') this.fail(e, `${callee.text} is not a function`);
        return { ty: local.ret, e: 'callValue', callee: { ty: local, e: 'local', name: callee.text }, args: this.args(e, local.params) };
      }
      const sym = this.resolve(callee);
      const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
      if (decl !== undefined && this.opts.hostFile !== null && decl.getSourceFile().fileName === this.opts.hostFile) {
        const op = HOST_FUNCS[callee.text];
        if (op === undefined) this.fail(e, `host function ${callee.text} is not mapped`);
        const sig = this.checker.getResolvedSignature(e) as ts.Signature;
        const ps = sig.getParameters().map((p) => this.tyOf(this.checker.getTypeOfSymbolAtLocation(p, e), e));
        return { ty: resultTy(), e: 'builtin', op, args: this.args(e, ps) };
      }
      if (decl !== undefined && this.fileSet.has(decl.getSourceFile().fileName) && (ts.isFunctionDeclaration(decl) || (ts.isVariableDeclaration(decl) && decl.initializer !== undefined && ts.isArrowFunction(decl.initializer)))) {
        this.pendingDecls.push(decl);
        const fnTy = this.fnTyOfDecl(decl);
        return { ty: fnTy.ret, e: 'call', fn: this.globalName(decl, callee.text), args: this.args(e, fnTy.params) };
      }
      this.fail(e, `call of ${callee.text} is outside the subset`);
    }
    this.fail(e, 'call form is outside the subset');
  }

  private args(e: ts.CallExpression | ts.NewExpression, params: readonly Ty[]): Expr[] {
    const args = e.arguments ?? ts.factory.createNodeArray();
    if (args.length !== params.length) this.fail(e, `expected ${params.length} arguments, got ${args.length}`);
    return args.map((a, i) => {
      if (ts.isSpreadElement(a)) this.fail(a, 'spread arguments are outside the subset');
      return this.expr(a, params[i] as Ty);
    });
  }

  private arrayMethod(e: ts.CallExpression, name: string, target: ts.Expression, arrTy: Ty & { k: 'array' }): Expr {
    const arr = this.expr(target, arrTy);
    const args = e.arguments;
    const elem = arrTy.elem;
    const cb = (i: number, params: readonly Ty[], ret: Ty | null): Expr => {
      const a = args[i];
      if (a === undefined) this.fail(e, `${name} needs a callback`);
      return this.callback(a, params, ret);
    };
    const arity = (i: number): number => {
      const a = args[i];
      if (a === undefined) return 0;
      if (ts.isArrowFunction(a)) return a.parameters.length;
      const t = this.expr(a, null).ty;
      return t.k === 'fn' ? t.params.length : 0;
    };
    switch (name) {
      case 'push': {
        if (args.length !== 1) this.fail(e, 'push takes one argument');
        return { ty: NUM, e: 'builtin', op: 'arrPush', args: [arr, this.expr(args[0] as ts.Expression, elem)] };
      }
      case 'map': {
        const res = this.checkerTy(e);
        if (res.k !== 'array') this.fail(e, 'map result');
        return arity(0) >= 2
          ? { ty: res, e: 'builtin', op: 'arrMapI', args: [arr, cb(0, [elem, NUM], res.elem)] }
          : { ty: res, e: 'builtin', op: 'arrMap', args: [arr, cb(0, [elem], res.elem)] };
      }
      case 'forEach':
        return arity(0) >= 2
          ? { ty: VOID, e: 'builtin', op: 'arrForEachI', args: [arr, cb(0, [elem, NUM], VOID)] }
          : { ty: VOID, e: 'builtin', op: 'arrForEach', args: [arr, cb(0, [elem], VOID)] };
      case 'filter': {
        const res = this.checkerTy(e);
        return { ty: res, e: 'builtin', op: 'arrFilter', args: [arr, cb(0, [elem], BOOL)] };
      }
      case 'find': {
        const res = this.checkerTy(e);
        return { ty: res, e: 'builtin', op: 'arrFind', args: [arr, cb(0, [elem], BOOL)] };
      }
      case 'some':
        return { ty: BOOL, e: 'builtin', op: 'arrSome', args: [arr, cb(0, [elem], BOOL)] };
      case 'flatMap': {
        const res = this.checkerTy(e);
        if (res.k !== 'array') this.fail(e, 'flatMap result');
        return { ty: res, e: 'builtin', op: 'arrFlatMap', args: [arr, cb(0, [elem], res)] };
      }
      case 'slice': {
        if (args.length !== 1) this.fail(e, 'slice(start) only');
        return { ty: arrTy, e: 'builtin', op: 'arrSlice', args: [arr, this.expr(args[0] as ts.Expression, NUM)] };
      }
      case 'reverse':
        if (args.length !== 0) this.fail(e, 'reverse takes no arguments');
        return { ty: arrTy, e: 'builtin', op: 'arrReverse', args: [arr] };
      case 'sort':
        if (args.length !== 1) this.fail(e, 'sort needs a comparator');
        return { ty: arrTy, e: 'builtin', op: 'arrSort', args: [arr, cb(0, [elem, elem], NUM)] };
      default:
        this.fail(e, `array.${name} is outside the subset`);
    }
  }

  /** A callback argument: an arrow function typed with the given parameters, or a function value of that type. */
  private callback(a: ts.Expression, params: readonly Ty[], ret: Ty | null): Expr {
    if (ts.isArrowFunction(a)) {
      if (a.parameters.length > params.length) this.fail(a, 'callback takes more parameters than the method passes');
      const used = params.slice(0, Math.max(1, a.parameters.length));
      const lam = this.arrow(a, { k: 'fn', params: used, ret: ret ?? VOID });
      return lam;
    }
    const f = this.expr(a, null);
    if (f.ty.k !== 'fn') this.fail(a, 'callback must be a function');
    return f;
  }

  private arrow(a: ts.ArrowFunction, want: Ty | null): Expr {
    const sig = this.checker.getSignatureFromDeclaration(a) as ts.Signature;
    const declared = this.params(a.parameters);
    let params: Param[] = declared;
    if (want !== null && want.k === 'fn') {
      params = want.params.map((t, i) => {
        const d = declared[i];
        if (d !== undefined && !tyEq(d.ty, t)) this.fail(a, `callback parameter ${d.name}: ${tyKey(d.ty)} where ${tyKey(t)} is passed`);
        return { name: d === undefined ? `_unused${i}` : d.name, ty: t };
      });
    }
    let ret = this.tyOf(this.checker.getReturnTypeOfSignature(sig), a);
    if (want !== null && want.k === 'fn' && want.ret.k !== 'void') {
      if (ret.k === 'never' || (ret.k === 'array' && ret.elem.k === 'never')) ret = want.ret;
    }
    if (want !== null && want.k === 'fn' && want.ret.k === 'void') ret = VOID;
    const body = ts.isBlock(a.body) ? this.block(a.body, ret, params) : this.exprBody(a.body, ret, params);
    return { ty: { k: 'fn', params: params.map((p) => p.ty), ret }, e: 'lambda', params, ret, body };
  }

  private newExpr(e: ts.NewExpression, want: Ty | null): Expr {
    const c = e.expression;
    if (!ts.isIdentifier(c)) this.fail(e, 'new of an identifier only');
    const sym = this.resolve(c);
    if (c.text === 'Map' && sym !== undefined && this.isLib(sym)) {
      const ctx = this.contextual(e) ?? want;
      const ty = ctx !== null && ctx.k === 'map' ? ctx : this.checkerTy(e);
      if (ty.k !== 'map') this.fail(e, 'Map type');
      const a = e.arguments?.[0];
      if (a === undefined) return { ty, e: 'mapNew', entries: [] };
      if (!ts.isArrayLiteralExpression(a)) this.fail(e, 'new Map([[key, value], ...]) with literal entries only');
      const entries = a.elements.map((el) => {
        if (!ts.isArrayLiteralExpression(el) || el.elements.length !== 2) this.fail(el, 'Map entries are [key, value] literals');
        return [this.expr(el.elements[0] as ts.Expression, ty.key), this.expr(el.elements[1] as ts.Expression, ty.value)] as const;
      });
      return { ty, e: 'mapNew', entries };
    }
    if (c.text === 'Error' && sym !== undefined && this.isLib(sym)) {
      const m = e.arguments?.[0];
      if (m === undefined || (e.arguments?.length ?? 0) !== 1) this.fail(e, 'new Error(message)');
      return { ty: { k: 'class', name: 'JsError' }, e: 'newError', message: this.expr(m, STR) };
    }
    const decl = sym?.declarations?.[0];
    if (decl !== undefined && ts.isClassDeclaration(decl) && this.fileSet.has(decl.getSourceFile().fileName)) {
      const ty = this.checkerTy(e);
      if (ty.k !== 'class') this.fail(e, 'class type');
      const cd = this.classDecl(ty.name) as ClassDecl;
      return { ty, e: 'new', cls: ty.name, args: this.args(e, cd.fields.map((f) => f.ty)) };
    }
    this.fail(e, `new ${c.text} is outside the subset`);
  }

  private contextual(e: ts.Expression): Ty | null {
    const t = this.checker.getContextualType(e);
    if (t === undefined) return null;
    return this.tyOf(t, e);
  }

  private objectLiteral(e: ts.ObjectLiteralExpression, want: Ty | null): Expr {
    let target: Ty | null = want;
    if (target === null || target.k === 'void') target = this.contextual(e);
    if (target !== null && target.k === 'opt') target = target.inner;
    if (target === null) this.fail(e, 'object literal without a named contextual type (annotate it with a type alias)');
    let cls: string;
    if (target.k === 'class') cls = target.name;
    else if (target.k === 'union') cls = this.pickMember(e, target.name);
    else this.fail(e, `object literal where ${tyKey(target)} is expected`);
    const cd = this.classDecl(cls);
    if (cd === null) this.fail(e, `unknown class ${cls}`);
    const given = new Map<string, ts.Expression | 'shorthand' | ts.MethodDeclaration>();
    const order: string[] = [];
    let spread: Expr | null = null;
    for (const p of e.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
        given.set(p.name.text, p.initializer);
        order.push(p.name.text);
      } else if (ts.isShorthandPropertyAssignment(p)) {
        given.set(p.name.text, 'shorthand');
        order.push(p.name.text);
      } else if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) {
        given.set(p.name.text, p);
        order.push(p.name.text);
      } else if (ts.isSpreadAssignment(p)) {
        if (spread !== null || order.length > 0) this.fail(p, 'one object spread, first, only');
        spread = this.expr(p.expression, null);
        if (spread.e !== 'local' && spread.e !== 'global' && spread.e !== 'field') this.fail(p, 'spread source must be a variable or field');
      } else this.fail(p, 'object literal member is outside the subset');
    }
    for (const k of given.keys()) if (!cd.fields.some((f) => f.name === k)) this.fail(e, `${k} is not a field of ${cls}`);
    // Source order must match field order unless the reordered initializers are side-effect free.
    const fieldOrder = cd.fields.map((f) => f.name).filter((n) => given.has(n));
    if (fieldOrder.join(',') !== order.join(',')) {
      const effects = order.filter((n) => {
        const g = given.get(n);
        return g !== undefined && g !== 'shorthand' && !ts.isMethodDeclaration(g) && hasCall(g);
      });
      if (effects.length > 1) this.fail(e, `object literal initializers with calls must follow the field order of ${cls}`);
    }
    const args = cd.fields.map((f) => {
      const g = given.get(f.name);
      if (g === undefined) {
        if (spread === null) this.fail(e, `missing field ${f.name} of ${cls}`);
        const sf = this.fieldTy(spread.ty, f.name);
        if (sf === null) this.fail(e, `spread source has no field ${f.name}`);
        return this.coerce({ ty: sf.ty, e: 'field', obj: spread, name: f.name }, f.ty, e);
      }
      if (g === 'shorthand') {
        const p = e.properties.find((q) => ts.isShorthandPropertyAssignment(q) && q.name.text === f.name) as ts.ShorthandPropertyAssignment;
        return this.expr(p.name, f.ty);
      }
      if (ts.isMethodDeclaration(g)) return this.method(g, f.ty);
      return this.expr(g, f.ty);
    });
    return { ty: { k: 'class', name: cls }, e: 'new', cls, args };
  }

  private method(m: ts.MethodDeclaration, want: Ty): Expr {
    if (want.k !== 'fn' || m.body === undefined) this.fail(m, 'method where a function field is expected');
    const params = this.params(m.parameters);
    const body = this.block(m.body, want.ret, params);
    return { ty: want, e: 'lambda', params, ret: want.ret, body };
  }

  private pickMember(e: ts.ObjectLiteralExpression, union: string): string {
    const members = this.unionMembers(union);
    const fits = members.filter((m) => {
      const cd = this.classDecl(m) as ClassDecl;
      for (const p of e.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
        const f = cd.fields.find((x) => x.name === (p.name as ts.Identifier).text);
        if (f === undefined) return false;
        const lit = literalOf(p.initializer);
        if (lit === undefined) continue;
        const decl = this.classes.get(m)?.type;
        const prop = decl === undefined ? undefined : this.checker.getPropertyOfType(decl, f.name);
        if (prop === undefined) return false;
        const pt = this.checker.getTypeOfSymbolAtLocation(prop, e);
        if (pt.isStringLiteral() && pt.value !== lit) return false;
        if (pt.flags & ts.TypeFlags.BooleanLiteral && typeof lit === 'boolean' && this.checker.typeToString(pt) !== String(lit)) return false;
      }
      return true;
    });
    if (fits.length !== 1) this.fail(e, `cannot pick the member of ${union} for this literal (${fits.length} fit)`);
    return fits[0] as string;
  }

  private arrayLiteral(e: ts.ArrayLiteralExpression, want: Ty | null): Expr {
    let ty: Ty | null = want !== null && want.k === 'array' ? want : null;
    if (ty === null) {
      const c = this.checker.getContextualType(e);
      const ct = c === undefined ? null : this.tyOf(c, e);
      if (ct !== null && ct.k === 'array') ty = ct;
      else if (ct !== null && ct.k === 'opt' && ct.inner.k === 'array') ty = ct.inner;
    }
    if (ty === null) ty = this.checkerTy(e);
    if (ty.k !== 'array') this.fail(e, 'array literal type');
    if (ty.elem.k === 'never' && e.elements.length > 0) this.fail(e, 'array element type');
    const elemTy = ty.elem;
    const spreads = e.elements.filter(ts.isSpreadElement);
    if (spreads.length === 0) return { ty, e: 'arr', items: e.elements.map((x) => this.expr(x, elemTy)) };
    if (e.elements.length === 1) {
      const s = (e.elements[0] as ts.SpreadElement).expression;
      const st = this.tyOf(this.checker.getTypeAtLocation(s), s);
      if (st.k === 'str') return { ty, e: 'builtin', op: 'strCodePoints', args: [this.expr(s, STR)] };
      if (st.k === 'array') return { ty, e: 'builtin', op: 'arrCopy', args: [this.expr(s, ty)] };
    }
    const parts = e.elements.map((x) => (ts.isSpreadElement(x) ? this.expr(x.expression, ty) : { ty, e: 'arr', items: [this.expr(x, elemTy)] } as Expr));
    return { ty, e: 'builtin', op: 'arrConcat', args: parts };
  }

  private binary(e: ts.BinaryExpression): Expr {
    const k = e.operatorToken.kind;
    const K = ts.SyntaxKind;
    if (k === K.AmpersandAmpersandToken || k === K.BarBarToken) {
      const l = this.expr(e.left, null);
      const r = this.expr(e.right, null);
      if (l.ty.k !== 'bool' || r.ty.k !== 'bool') this.fail(e, '&& and || on booleans only');
      return { ty: BOOL, e: k === K.AmpersandAmpersandToken ? 'and' : 'or', l, r };
    }
    if (k === K.InstanceOfKeyword) {
      const x = this.expr(e.left, null);
      if (!ts.isIdentifier(e.right)) this.fail(e, 'instanceof a class name');
      const sym = this.resolve(e.right);
      const d = sym?.declarations?.[0];
      if (d === undefined || !ts.isClassDeclaration(d)) this.fail(e, 'instanceof a subset class');
      const t = this.tyOf(this.checker.getTypeAtLocation(d.name ?? d), d);
      if (t.k !== 'class') this.fail(e, 'instanceof class');
      return { ty: BOOL, e: 'instanceOf', x, cls: t.name };
    }
    const eqOps: Partial<Record<ts.SyntaxKind, BinOp>> = { [K.EqualsEqualsEqualsToken]: '==', [K.ExclamationEqualsEqualsToken]: '!=' };
    const eq = eqOps[k];
    if (eq !== undefined) {
      const isNullish = (x: ts.Expression): boolean => x.kind === K.NullKeyword || (ts.isIdentifier(x) && x.text === 'undefined');
      if (isNullish(e.right) || isNullish(e.left)) {
        const other = isNullish(e.right) ? e.left : e.right;
        const x = this.expr(other, null);
        if (x.ty.k !== 'opt' && x.ty.k !== 'null') this.fail(e, 'null comparison of a non-nullable value');
        return { ty: BOOL, e: 'isNull', x, negate: eq === '!=' };
      }
      const l = this.expr(e.left, null);
      const r = this.expr(e.right, null);
      const kind = operandKind(l.ty, r.ty);
      if (kind === null) this.fail(e, `=== between ${tyKey(l.ty)} and ${tyKey(r.ty)} is outside the subset`);
      return { ty: BOOL, e: 'bin', op: eq, operand: kind, l, r };
    }
    const arith: Partial<Record<ts.SyntaxKind, BinOp>> = { [K.PlusToken]: '+', [K.MinusToken]: '-', [K.AsteriskToken]: '*', [K.SlashToken]: '/' };
    const cmpOps: Partial<Record<ts.SyntaxKind, BinOp>> = { [K.LessThanToken]: '<', [K.LessThanEqualsToken]: '<=', [K.GreaterThanToken]: '>', [K.GreaterThanEqualsToken]: '>=' };
    const a = arith[k];
    if (a !== undefined) {
      const l = this.expr(e.left, null);
      const r = this.expr(e.right, null);
      if (a === '+' && l.ty.k === 'str' && r.ty.k === 'str') return { ty: STR, e: 'concat', parts: [l, r] };
      if (l.ty.k !== 'num' || r.ty.k !== 'num') this.fail(e, `arithmetic on numbers only (${tyKey(l.ty)} ${a} ${tyKey(r.ty)})`);
      return { ty: NUM, e: 'bin', op: a, operand: 'num', l, r };
    }
    const c = cmpOps[k];
    if (c !== undefined) {
      const l = this.expr(e.left, NUM);
      const r = this.expr(e.right, NUM);
      return { ty: BOOL, e: 'bin', op: c, operand: 'num', l, r };
    }
    if (k === K.EqualsToken || k === K.PlusEqualsToken || k === K.MinusEqualsToken) this.fail(e, 'assignment inside an expression is outside the subset');
    this.fail(e, `operator ${e.operatorToken.getText()} is outside the subset`);
  }
}

class Scope {
  private readonly vars = new Map<string, Ty>();
  readonly parent: Scope | null;
  readonly fnBoundary: boolean;
  constructor(parent: Scope | null, fnBoundary = false) {
    this.parent = parent;
    this.fnBoundary = fnBoundary;
  }
  declare(name: string, ty: Ty): void {
    this.vars.set(name, ty);
  }
  lookupDecl(name: string): Ty | null {
    const v = this.vars.get(name);
    if (v !== undefined) return v;
    return this.parent === null ? null : this.parent.lookupDecl(name);
  }
  lookup(name: string): Ty | null {
    return this.lookupDecl(name);
  }
}

function operandKind(a: Ty, b: Ty): 'num' | 'str' | 'bool' | 'ref' | null {
  if (a.k === 'num' && b.k === 'num') return 'num';
  if (a.k === 'str' && b.k === 'str') return 'str';
  if (a.k === 'bool' && b.k === 'bool') return 'bool';
  const isRef = (t: Ty): boolean => t.k === 'class' || t.k === 'union';
  if (isRef(a) && isRef(b)) return 'ref';
  return null;
}

function literalOf(e: ts.Expression): string | boolean | undefined {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function hasCall(n: ts.Node): boolean {
  if (ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isPostfixUnaryExpression(n)) return true;
  if (ts.isArrowFunction(n)) return false;
  return ts.forEachChild(n, hasCall) === true;
}

function containsContinue(n: ts.Node): boolean {
  if (ts.isContinueStatement(n)) return true;
  if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isWhileStatement(n) || ts.isArrowFunction(n) || ts.isFunctionLike(n)) return false;
  return ts.forEachChild(n, containsContinue) === true;
}

function containsBreak(n: ts.Node): boolean {
  if (ts.isBreakStatement(n)) return true;
  if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isWhileStatement(n) || ts.isSwitchStatement(n) || ts.isFunctionLike(n)) return false;
  return ts.forEachChild(n, containsBreak) === true;
}

export function ident(s: string): string {
  return s.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c === undefined ? '' : c.toUpperCase()));
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
