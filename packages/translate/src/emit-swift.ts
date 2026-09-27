// Swift emitter: prints the IR. Every type, conversion and library call was decided by lowering; this file only chooses syntax.
import type { ClassDecl, ConstDecl, Decl, Expr, FuncDecl, Param, Stmt, Ty, UnionDecl } from './ir.ts';
import { assignedLocals, terminates } from './walk.ts';

const KEYWORDS = new Set([
  'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import', 'init', 'inout', 'internal', 'let', 'open',
  'operator', 'private', 'protocol', 'public', 'rethrows', 'static', 'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'continue',
  'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return', 'switch', 'where', 'while', 'as', 'Any',
  'catch', 'false', 'is', 'nil', 'super', 'self', 'Self', 'throw', 'throws', 'true', 'try', 'some', 'any', 'await', 'async',
]);

export function swiftId(n: string): string {
  return KEYWORDS.has(n) ? `\`${n}\`` : n;
}

export type SwiftEmitOptions = {
  /** public for the engine module, internal for the harness. */
  readonly access: 'public' | '';
  /** The enum holding interned string literals. */
  readonly stringsEnum: string;
  readonly strings: ReadonlyMap<string, string>;
};

/** Names for interned string literals: readable when the literal is an identifier-like word. */
export function stringNames(strings: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  strings.forEach((s, i) => {
    let n = /^[A-Za-z][A-Za-z0-9-]{0,40}$/.test(s) ? `s_${s.replace(/-/g, '_')}` : `s${i}`;
    if (used.has(n)) n = `s${i}`;
    used.add(n);
    out.set(s, n);
  });
  return out;
}

export function swiftStringLiteral(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else out += `\\u{${cp.toString(16)}}`;
  }
  return `${out}"`;
}

export function swiftNum(v: number): string {
  if (Object.is(v, -0)) return '-0.0';
  if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) return `${v}.0`;
  const s = String(v);
  if (!Number.isFinite(v)) throw new Error(`non-finite literal ${s}`);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

export class SwiftEmitter {
  private readonly o: SwiftEmitOptions;
  private readonly classes: ReadonlyMap<string, ClassDecl>;
  private tmp = 0;
  private readonly errorClasses: ReadonlySet<string>;
  constructor(o: SwiftEmitOptions, classes: ReadonlyMap<string, ClassDecl>) {
    this.o = o;
    this.classes = classes;
    this.errorClasses = new Set([...classes.values()].filter((c) => c.error !== null).map((c) => c.name));
  }

  ty(t: Ty): string {
    switch (t.k) {
      case 'num':
        return 'Double';
      case 'bool':
        return 'Bool';
      case 'str':
        return 'JsString';
      case 'void':
        return 'Void';
      case 'never':
        return 'Never';
      case 'null':
        return 'Never?';
      case 'error':
        return 'any Error';
      case 'class':
        return t.name;
      case 'union':
        return `any ${t.name}`;
      case 'array':
        return `JsArray<${this.ty(t.elem)}>`;
      case 'map':
        return t.key.k === 'str' ? `JsStringMap<${this.ty(t.value)}>` : `JsObjectMap<${this.ty(t.key)}, ${this.ty(t.value)}>`;
      case 'opt': {
        const inner = this.ty(t.inner);
        return t.inner.k === 'union' || t.inner.k === 'fn' ? `(${inner})?` : `${inner}?`;
      }
      case 'fn':
        return `(${t.params.map((p) => this.ty(p)).join(', ')}) throws -> ${this.ty(t.ret)}`;
    }
  }

  // ------------------------------------------------------------ declarations

  classDecl(c: ClassDecl, unions: ReadonlyMap<string, UnionDecl>): string {
    const a = this.o.access === '' ? '' : `${this.o.access} `;
    const lines: string[] = [`// ts: ${c.loc.file}:${c.loc.line}`];
    if (c.error !== null) {
      lines.push(`${a}final class ${c.name}: JsError {`);
      for (const f of c.fields) lines.push(`  ${a}let ${swiftId(f.name)}: ${this.ty(f.ty)}`);
      lines.push(`  ${a}init(${c.fields.map((f) => `_ ${swiftId(f.name)}: ${this.ty(f.ty)}`).join(', ')}) throws {`);
      for (const f of c.fields) lines.push(`    self.${swiftId(f.name)} = ${swiftId(f.name)}`);
      lines.push(`    super.init(message: ${this.tryPrefix(c.error.message)}${this.ex(c.error.message)})`);
      lines.push('  }', '}');
      return lines.join('\n');
    }
    const conf = c.unions.filter((u) => unions.has(u));
    lines.push(`${a}final class ${c.name}${conf.length > 0 ? `: ${conf.join(', ')}` : ''} {`);
    for (const f of c.fields) lines.push(`  ${a}${f.mutable ? 'var' : 'let'} ${swiftId(f.name)}: ${this.ty(f.ty)}`);
    lines.push(`  ${a}init(${c.fields.map((f) => `_ ${swiftId(f.name)}: ${this.paramTy(f.ty)}`).join(', ')}) {`);
    for (const f of c.fields) lines.push(`    self.${swiftId(f.name)} = ${swiftId(f.name)}`);
    lines.push('  }', '}');
    return lines.join('\n');
  }

  unionDecl(u: UnionDecl): string {
    const a = this.o.access === '' ? '' : `${this.o.access} `;
    const lines = [`/// One of: ${u.members.join(', ')}.`, `${a}protocol ${u.name}: AnyObject {`];
    for (const f of u.common) lines.push(`  var ${swiftId(f.name)}: ${this.ty(f.ty)} { get }`);
    lines.push('}');
    return lines.join('\n');
  }

  /** Conformances of classes declared elsewhere to unions declared here. */
  extensions(u: UnionDecl, here: ReadonlySet<string>): string[] {
    return u.members.filter((m) => !here.has(m)).map((m) => `extension ${m}: ${u.name} {}`);
  }

  funcDecl(f: FuncDecl): string {
    const a = this.o.access === '' ? '' : `${this.o.access} `;
    const head = `${a}func ${f.name}(${this.params(f.params)}) throws -> ${this.ty(f.ret)} {`;
    return [`// ts: ${f.loc.file}:${f.loc.line}`, head, ...this.body(f.params, f.body, f.ret, 1), '}'].join('\n');
  }

  constDecl(c: ConstDecl): string {
    const a = this.o.access === '' ? '' : `${this.o.access} `;
    const t = this.throws(c.init) ? 'try! ' : '';
    return `// ts: ${c.loc.file}:${c.loc.line}\n${a}let ${c.name}: ${this.ty(c.ty)} = ${t}${this.ex(c.init)}`;
  }

  private params(ps: readonly Param[]): string {
    return ps.map((p) => `_ ${swiftId(p.name)}: ${this.paramTy(p.ty)}`).join(', ');
  }

  /** Closures passed as parameters may be stored, as JS closures always can. */
  private paramTy(t: Ty): string {
    return t.k === 'fn' ? `@escaping ${this.ty(t)}` : this.ty(t);
  }

  // ------------------------------------------------------------ statements

  private body(params: readonly Param[], stmts: readonly Stmt[], ret: Ty, depth: number): string[] {
    const assigned = assignedLocals(stmts);
    const out: string[] = [];
    for (const p of params) if (assigned.has(p.name)) out.push(`${pad(depth)}var ${swiftId(p.name)} = ${swiftId(p.name)}`);
    out.push(...this.stmts(stmts, depth));
    if (ret.k !== 'void' && !terminates(stmts)) out.push(`${pad(depth)}jsUnreachable()`);
    return out;
  }

  private stmts(stmts: readonly Stmt[], depth: number): string[] {
    const out: string[] = [];
    for (const s of stmts) out.push(...this.stmt(s, depth));
    return out;
  }

  private tryPrefix(e: Expr): string {
    return this.throws(e) ? 'try ' : '';
  }

  private throws(e: Expr): boolean {
    return mayThrow(e, this.errorClasses);
  }

  private stmt(s: Stmt, d: number): string[] {
    const p = pad(d);
    const src = `${p}// ts: ${s.loc.file}:${s.loc.line}`;
    switch (s.s) {
      case 'let': {
        const kw = s.mutable ? 'var' : 'let';
        if (s.init === null) return [`${p}var ${swiftId(s.name)}: ${this.ty(s.ty)}`];
        return [`${p}${kw} ${swiftId(s.name)}: ${this.ty(s.ty)} = ${this.tryPrefix(s.init)}${this.ex(s.init)}`];
      }
      case 'localFunc':
        return [src, `${p}func ${swiftId(s.name)}(${this.params(s.params)}) throws -> ${this.ty(s.ret)} {`, ...this.body(s.params, s.body, s.ret, d + 1), `${p}}`];
      case 'expr': {
        const t = this.tryPrefix(s.e);
        const discard = s.e.ty.k !== 'void' && s.e.ty.k !== 'never' ? '_ = ' : '';
        return [`${p}${discard}${t}${this.ex(s.e)}`];
      }
      case 'assign': {
        const t = this.throws(s.target) || this.throws(s.value) ? 'try ' : '';
        return [`${p}${t}${this.ex(s.target)} ${s.op} ${this.ex(s.value)}`];
      }
      case 'if':
        return [src, ...this.ifChain(s, d)];
      case 'while':
        return [src, `${p}while ${this.tryPrefix(s.cond)}${this.ex(s.cond)} {`, ...this.stmts(s.body, d + 1), `${p}}`];
      case 'for': {
        const cond = s.cond === null ? 'true' : `${this.tryPrefix(s.cond)}${this.ex(s.cond)}`;
        const out = [src, `${p}do {`, ...this.stmts(s.init, d + 1)];
        if (s.label === null) {
          out.push(`${pad(d + 1)}while ${cond} {`, ...this.stmts(s.body, d + 2), ...this.stmts(s.incr, d + 2), `${pad(d + 1)}}`);
        } else {
          out.push(`${pad(d + 1)}${s.label}: while ${cond} {`, `${pad(d + 2)}${s.label}_body: do {`, ...this.stmts(s.body, d + 3), `${pad(d + 2)}}`, ...this.stmts(s.incr, d + 2), `${pad(d + 1)}}`);
        }
        out.push(`${p}}`);
        return out;
      }
      case 'forOf': {
        const n = ++this.tmp;
        return [
          src,
          `${p}do {`,
          `${pad(d + 1)}let _a${n} = ${this.tryPrefix(s.iter)}${this.ex(s.iter)}`,
          `${pad(d + 1)}var _i${n} = 0`,
          `${pad(d + 1)}while _i${n} < _a${n}.items.count {`,
          `${pad(d + 2)}let ${swiftId(s.name)}: ${this.ty(s.ty)} = _a${n}.items[_i${n}]`,
          `${pad(d + 2)}_i${n} += 1`,
          ...this.stmts(s.body, d + 2),
          `${pad(d + 1)}}`,
          `${p}}`,
        ];
      }
      case 'forOfMap':
        return [src, `${p}for (${swiftId(s.key)}, ${swiftId(s.value)}) in ${this.tryPrefix(s.map)}${this.ex(s.map)}.entries {`, ...this.stmts(s.body, d + 1), `${p}}`];
      case 'return':
        return [s.e === null ? `${p}return` : `${p}return ${this.tryPrefix(s.e)}${this.ex(s.e)}`];
      case 'throw':
        return [`${p}throw ${this.tryPrefix(s.e)}${this.ex(s.e)}`];
      case 'try':
        return [src, `${p}do {`, ...this.stmts(s.body, d + 1), `${p}} catch let ${swiftId(s.name)} {`, ...this.stmts(s.handler, d + 1), `${p}}`];
      case 'switch': {
        const out = [src, `${p}switch ${this.tryPrefix(s.subject)}${this.ex(s.subject)} {`];
        for (const c of s.cases) {
          out.push(`${p}case ${c.values.map((v) => this.ex(v)).join(', ')}:`);
          out.push(...(c.body.length === 0 ? [`${pad(d + 1)}break`] : this.stmts(c.body, d + 1)));
        }
        out.push(`${p}default:`);
        out.push(...(s.dflt === null || s.dflt.length === 0 ? [`${pad(d + 1)}break`] : this.stmts(s.dflt, d + 1)));
        out.push(`${p}}`);
        return out;
      }
      case 'break':
        return [s.target === null ? `${p}break` : `${p}break ${s.target}`];
      case 'continue':
        return [s.target === null ? `${p}continue` : `${p}break ${s.target}_body`];
    }
  }

  private ifChain(s: Stmt & { s: 'if' }, d: number): string[] {
    const p = pad(d);
    const out = [`${p}if ${this.tryPrefix(s.cond)}${this.ex(s.cond)} {`, ...this.stmts(s.then, d + 1)];
    let e = s.else;
    while (e !== null) {
      const only = e[0];
      if (e.length === 1 && only !== undefined && only.s === 'if') {
        out.push(`${p}} else if ${this.tryPrefix(only.cond)}${this.ex(only.cond)} {`, ...this.stmts(only.then, d + 1));
        e = only.else;
      } else {
        out.push(`${p}} else {`, ...this.stmts(e, d + 1));
        e = null;
      }
    }
    out.push(`${p}}`);
    return out;
  }

  // ------------------------------------------------------------ expressions

  ex(e: Expr): string {
    switch (e.e) {
      case 'num':
        return swiftNum(e.value);
      case 'str':
        return `${this.o.stringsEnum}.${this.o.strings.get(e.value) as string}`;
      case 'bool':
        return e.value ? 'true' : 'false';
      case 'null':
        return 'nil';
      case 'local':
        return swiftId(e.name);
      case 'global':
        return e.name;
      case 'field':
        return `${this.ex(e.obj)}.${swiftId(e.name)}`;
      case 'call':
        return `${e.fn}(${e.args.map((a) => this.ex(a)).join(', ')})`;
      case 'callValue':
        return `${this.ex(e.callee)}(${e.args.map((a) => this.ex(a)).join(', ')})`;
      case 'builtin':
        return this.builtin(e);
      case 'bin': {
        let op: string = e.op;
        if (e.operand === 'ref') op = e.op === '==' ? '===' : '!==';
        return `(${this.ex(e.l)} ${op} ${this.ex(e.r)})`;
      }
      case 'isNull':
        return `(${this.ex(e.x)} ${e.negate ? '!=' : '=='} nil)`;
      case 'and':
        return `(${this.ex(e.l)} && ${this.ex(e.r)})`;
      case 'or':
        return `(${this.ex(e.l)} || ${this.ex(e.r)})`;
      case 'not':
        return `(!${this.ex(e.x)})`;
      case 'neg':
        return `(-${this.ex(e.x)})`;
      case 'cond': {
        // Swift does not join two classes to their protocol, so each branch is converted to the result type.
        const up = e.ty.k === 'union' || e.ty.k === 'opt' ? ` as ${this.ty(e.ty)}` : '';
        return up === '' ? `(${this.ex(e.c)} ? ${this.ex(e.a)} : ${this.ex(e.b)})` : `(${this.ex(e.c)} ? (${this.ex(e.a)}${up}) : (${this.ex(e.b)}${up}))`;
      }
      case 'new':
        return `${e.cls}(${e.args.map((a) => this.ex(a)).join(', ')})`;
      case 'newError':
        return `JsError(message: ${this.ex(e.message)})`;
      case 'arr':
        return `JsArray<${this.ty((e.ty as Ty & { k: 'array' }).elem)}>([${e.items.map((a) => this.ex(a)).join(', ')}])`;
      case 'mapNew': {
        const t = e.ty as Ty & { k: 'map' };
        const base = this.ty(t);
        if (e.entries.length === 0) return `${base}()`;
        return `${base}([${e.entries.map(([k, v]) => `(${this.ex(k)}, ${this.ex(v)})`).join(', ')}])`;
      }
      case 'lambda': {
        const ps = e.params.map((p) => `${swiftId(p.name)}: ${this.ty(p.ty)}`).join(', ');
        const inner = this.body(e.params, e.body, e.ret, 1).map((l) => `  ${l}`);
        return `{ (${ps}) throws -> ${this.ty(e.ret)} in\n${inner.join('\n')}\n}`;
      }
      case 'concat':
        return `jsConcat(${e.parts.map((a) => this.ex(a)).join(', ')})`;
      case 'cast':
        return e.ty.k === 'union' ? `(${this.ex(e.x)} as! any ${e.ty.name})` : `(${this.ex(e.x)} as! ${this.ty(e.ty)})`;
      case 'unwrap':
        return `jsUnwrap(${this.ex(e.x)})`;
      case 'castOpt': {
        const inner = (e.ty as Ty & { k: 'opt' }).inner;
        return `(${this.ex(e.x)}).map { $0 as! ${this.ty(inner)} }`;
      }
      case 'instanceOf':
        return `(${this.ex(e.x)} is ${e.cls})`;
      case 'postInc':
        return `jsPostInc(&${this.ex(e.target)}, ${e.delta === 1 ? '1' : '-1'})`;
    }
  }

  private builtin(e: Expr & { e: 'builtin' }): string {
    const a = e.args.map((x) => this.ex(x));
    const [x, y] = a;
    switch (e.op) {
      case 'fround':
        return `jsFround(${x})`;
      case 'trunc':
        return `jsTrunc(${x})`;
      case 'floor':
        return `jsFloor(${x})`;
      case 'ceil':
        return `jsCeil(${x})`;
      case 'round':
        return `jsRound(${x})`;
      case 'isNaN':
        return `(${x}).isNaN`;
      case 'isFinite':
        return `(${x}).isFinite`;
      case 'isInteger':
        return `jsIsInteger(${x})`;
      case 'arrLength':
        return `jsLength(${x})`;
      case 'arrIndex':
        return `jsAt(${x}, ${y})`;
      case 'arrPush':
        return `jsPush(${x}, ${y})`;
      case 'arrMap':
        return `jsMap(${x}, ${y})`;
      case 'arrMapI':
        return `jsMapI(${x}, ${y})`;
      case 'arrForEach':
        return `jsForEach(${x}, ${y})`;
      case 'arrForEachI':
        return `jsForEachI(${x}, ${y})`;
      case 'arrFilter': {
        const src = (e.args[0] as Expr).ty as Ty & { k: 'array' };
        const res = e.ty as Ty & { k: 'array' };
        const call = `jsFilter(${x}, ${y})`;
        return tyStr(src.elem) === tyStr(res.elem) ? call : `jsCastArray(${call}, (${this.ty(res.elem)}).self)`;
      }
      case 'arrFind': {
        const src = (e.args[0] as Expr).ty as Ty & { k: 'array' };
        const res = e.ty as Ty & { k: 'opt' };
        const call = `jsFind(${x}, ${y})`;
        return tyStr(src.elem) === tyStr(res.inner) ? call : `(${call}).map { $0 as! ${this.ty(res.inner)} }`;
      }
      case 'arrSome':
        return `jsSome(${x}, ${y})`;
      case 'arrSlice':
        return `jsSlice(${x}, ${y})`;
      case 'arrReverse':
        return `jsReverse(${x})`;
      case 'arrFlatMap':
        return `jsFlatMap(${x}, ${y})`;
      case 'arrSort':
        return `jsSort(${x}, ${y})`;
      case 'arrCopy':
        return `jsCopy(${x})`;
      case 'arrConcat':
        return `jsConcatArrays([${a.join(', ')}])`;
      case 'strCodePoints':
        return `jsCodePoints(${x})`;
      case 'strCodePointAt0':
        return `jsCodePointAt0(${x})`;
      case 'numToStringRadix16':
        return `jsToStringRadix16(${x})`;
      case 'strToUpperCase':
        return `jsToUpperCase(${x})`;
      case 'numToString':
        return `jsNumberToString(${x})`;
      case 'mapGet':
        return `${x}.get(${y})`;
      case 'mapSet':
        return `${x}.set(${y}, ${a[2]})`;
      case 'mapHas':
        return `${x}.has(${y})`;
      case 'hostBitsHex':
        return `hostBitsHex(${x})`;
      case 'hostHexBits':
        return `hostHexBits(${x})`;
      case 'hostParseNumber':
        return `hostParseNumber(${x})`;
      case 'hostFromCodePoint':
        return `hostFromCodePoints(${x})`;
      case 'plantInt32':
        return `Double(Int32(truncatingIfNeeded: Int64(${x})))`;
    }
  }
}

function tyStr(t: Ty): string {
  return JSON.stringify(t);
}

/** Whether evaluating e can throw (Swift needs `try`): calls, unwraps, error constructors and library calls taking closures. */
export function mayThrow(e: Expr, errorClasses: ReadonlySet<string>): boolean {
  const sub = (x: Expr): boolean => mayThrow(x, errorClasses);
  switch (e.e) {
    case 'call':
    case 'callValue':
    case 'unwrap':
      return true;
    case 'new':
      return errorClasses.has(e.cls) || e.args.some(sub);
    case 'builtin':
      if (['numToStringRadix16', 'hostHexBits', 'hostParseNumber', 'arrMap', 'arrMapI', 'arrForEach', 'arrForEachI', 'arrFilter', 'arrFind', 'arrSome', 'arrFlatMap', 'arrSort'].includes(e.op)) return true;
      return e.args.some(sub);
    case 'lambda':
      return false;
    default: {
      for (const [k, v] of Object.entries(e)) {
        if (k === 'ty') continue;
        if (Array.isArray(v)) {
          for (const x of v) {
            if (Array.isArray(x)) {
              if (x.some((y) => isExprLike(y) && sub(y))) return true;
            } else if (isExprLike(x) && sub(x)) return true;
          }
        } else if (isExprLike(v) && sub(v)) return true;
      }
      return false;
    }
  }
}

function isExprLike(x: unknown): x is Expr {
  return typeof x === 'object' && x !== null && 'e' in x && 'ty' in x;
}

function pad(d: number): string {
  return '  '.repeat(d);
}

export type { Decl };
