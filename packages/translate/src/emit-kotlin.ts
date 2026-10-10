// Kotlin emitter: prints the IR. Every type, conversion and library call was decided by lowering; this file only chooses syntax.
import type { ClassDecl, ConstDecl, Decl, Expr, FuncDecl, Param, Stmt, Ty, UnionDecl } from './ir.ts';
import { assignedLocals, terminates } from './walk.ts';

const KEYWORDS = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null', 'object', 'package',
  'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while',
]);

export function kotlinId(n: string): string {
  return KEYWORDS.has(n) ? `\`${n}\`` : n;
}

export function kotlinStringLiteral(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s.charAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '$') out += '\\$';
    else if (c >= 0x20 && c < 0x7f) out += ch;
    else out += `\\u${c.toString(16).padStart(4, '0')}`;
  }
  return `${out}"`;
}

export function kotlinNum(v: number): string {
  if (Object.is(v, -0)) return '-0.0';
  if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) return `${v}.0`;
  if (!Number.isFinite(v)) throw new Error(`non-finite literal ${v}`);
  const s = String(v);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

export class KotlinEmitter {
  private readonly unions: ReadonlyMap<string, UnionDecl>;
  private tmp = 0;
  /** Each block being emitted: its local names, true for a local function, which a value reference names as ::f. */
  private readonly scopes: Map<string, boolean>[] = [];
  constructor(unions: ReadonlyMap<string, UnionDecl>) {
    this.unions = unions;
  }

  private declareLocal(name: string, isFunc: boolean): void {
    this.scopes[this.scopes.length - 1]?.set(name, isFunc);
  }

  private scoped<T>(names: readonly string[], f: () => T): T {
    this.scopes.push(new Map(names.map((n) => [n, false] as const)));
    try {
      return f();
    } finally {
      this.scopes.pop();
    }
  }

  private isLocalFunc(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i]?.get(name);
      if (v !== undefined) return v;
    }
    return false;
  }

  fileHeader(): string {
    return 'package dev.dragon.layout\n\n';
  }

  ty(t: Ty): string {
    switch (t.k) {
      case 'num':
        return 'Double';
      case 'bool':
        return 'Boolean';
      case 'str':
        return 'String';
      case 'void':
        return 'Unit';
      case 'never':
        return 'Nothing';
      case 'null':
        return 'Nothing?';
      case 'error':
        return 'Throwable';
      case 'class':
      case 'union':
        return t.name;
      case 'array':
        return `JsArray<${this.ty(t.elem)}>`;
      case 'map':
        return t.key.k === 'str' ? `JsStringMap<${this.ty(t.value)}>` : `JsObjectMap<${this.ty(t.key)}, ${this.ty(t.value)}>`;
      case 'opt':
        return t.inner.k === 'fn' ? `(${this.ty(t.inner)})?` : `${this.ty(t.inner)}?`;
      case 'fn':
        return `(${t.params.map((p) => this.ty(p)).join(', ')}) -> ${this.ty(t.ret)}`;
    }
  }

  decl(d: Decl): string {
    if (d.kind === 'class') return this.classDecl(d);
    if (d.kind === 'func') return this.funcDecl(d);
    if (d.kind === 'const') return this.constDecl(d);
    return this.unionDecl(d);
  }

  classDecl(c: ClassDecl): string {
    const loc = `// ts: ${c.loc.file}:${c.loc.line}`;
    if (c.error !== null) {
      const ps = c.fields.map((f) => `val ${kotlinId(f.name)}: ${this.ty(f.ty)}`).join(', ');
      return `${loc}\nclass ${c.name}(${ps}) : JsError(${this.ex(c.error.message)})`;
    }
    const overrides = new Set<string>();
    const conf = c.unions.filter((u) => this.unions.has(u));
    for (const u of conf) for (const f of (this.unions.get(u) as UnionDecl).common) overrides.add(f.name);
    const ps = c.fields.map((f) => `${overrides.has(f.name) ? 'override ' : ''}${f.mutable ? 'var' : 'val'} ${kotlinId(f.name)}: ${this.ty(f.ty)}`);
    return `${loc}\nclass ${c.name}(\n${ps.map((p) => `  ${p},`).join('\n')}\n)${conf.length > 0 ? ` : ${conf.join(', ')}` : ''}`;
  }

  unionDecl(u: UnionDecl): string {
    const lines = [`/** One of: ${u.members.join(', ')}. */`, `sealed interface ${u.name} {`];
    for (const f of u.common) lines.push(`  val ${kotlinId(f.name)}: ${this.ty(f.ty)}`);
    lines.push('}');
    return lines.join('\n');
  }

  funcDecl(f: FuncDecl): string {
    return [`// ts: ${f.loc.file}:${f.loc.line}`, `fun ${f.name}(${this.params(f.params)}): ${this.ty(f.ret)} {`, ...this.body(f.params, f.body, f.ret, 1), '}'].join('\n');
  }

  constDecl(c: ConstDecl): string {
    return `// ts: ${c.loc.file}:${c.loc.line}\nval ${c.name}: ${this.ty(c.ty)} = ${this.ex(c.init)}`;
  }

  private params(ps: readonly Param[]): string {
    return ps.map((p) => `${kotlinId(p.name)}: ${this.ty(p.ty)}`).join(', ');
  }

  // ------------------------------------------------------------ statements

  private body(params: readonly Param[], stmts: readonly Stmt[], ret: Ty, depth: number): string[] {
    const assigned = assignedLocals(stmts);
    const out: string[] = [];
    this.scoped(
      params.map((p) => p.name),
      () => {
        for (const p of params) if (assigned.has(p.name)) out.push(`${pad(depth)}var ${kotlinId(p.name)} = ${kotlinId(p.name)}`);
        out.push(...this.stmts(stmts, depth));
      },
    );
    if (ret.k !== 'void' && !terminates(stmts)) out.push(`${pad(depth)}jsUnreachable()`);
    return out;
  }

  /** A block, in a scope of its own that also holds names (a loop or catch variable). */
  private stmts(stmts: readonly Stmt[], depth: number, names: readonly string[] = []): string[] {
    return this.scoped(names, () => stmts.flatMap((s) => this.stmt(s, depth)));
  }

  private stmt(s: Stmt, d: number): string[] {
    const p = pad(d);
    const src = `${p}// ts: ${s.loc.file}:${s.loc.line}`;
    switch (s.s) {
      case 'let':
        this.declareLocal(s.name, false);
        if (s.init === null) return [`${p}var ${kotlinId(s.name)}: ${this.ty(s.ty)}`];
        return [`${p}${s.mutable ? 'var' : 'val'} ${kotlinId(s.name)}: ${this.ty(s.ty)} = ${this.ex(s.init)}`];
      case 'localFunc':
        this.declareLocal(s.name, true);
        return [src, `${p}fun ${kotlinId(s.name)}(${this.params(s.params)}): ${this.ty(s.ret)} {`, ...this.body(s.params, s.body, s.ret, d + 1), `${p}}`];
      case 'expr':
        return [`${p}${this.ex(s.e)}`];
      case 'assign':
        return [`${p}${this.ex(s.target)} ${s.op} ${this.ex(s.value)}`];
      case 'if':
        return [src, ...this.ifChain(s, d)];
      case 'while':
        return [src, `${p}while (${this.ex(s.cond)}) {`, ...this.stmts(s.body, d + 1), `${p}}`];
      case 'for':
        // The init's names are in scope through the condition, body and increment.
        return this.scoped([], () => this.forLoop(s, d, src));
      case 'forOf': {
        const n = ++this.tmp;
        return [
          src,
          `${p}run {`,
          `${pad(d + 1)}val _a${n} = ${this.ex(s.iter)}`,
          `${pad(d + 1)}var _i${n} = 0`,
          `${pad(d + 1)}while (_i${n} < _a${n}.size) {`,
          `${pad(d + 2)}val ${kotlinId(s.name)}: ${this.ty(s.ty)} = _a${n}[_i${n}]`,
          `${pad(d + 2)}_i${n}++`,
          ...this.stmts(s.body, d + 2, [s.name]),
          `${pad(d + 1)}}`,
          `${p}}`,
        ];
      }
      case 'forOfMap':
        return [src, `${p}for ((${kotlinId(s.key)}, ${kotlinId(s.value)}) in ${this.ex(s.map)}.entries()) {`, ...this.stmts(s.body, d + 1, [s.key, s.value]), `${p}}`];
      case 'return':
        return [s.e === null ? `${p}return` : `${p}return ${this.ex(s.e)}`];
      case 'throw':
        return [`${p}throw ${this.ex(s.e)}`];
      case 'try':
        return [src, `${p}try {`, ...this.stmts(s.body, d + 1), `${p}} catch (${kotlinId(s.name)}: Throwable) {`, ...this.stmts(s.handler, d + 1, [s.name]), `${p}}`];
      case 'switch': {
        const out = [src, `${p}when (${this.ex(s.subject)}) {`];
        for (const c of s.cases) out.push(`${pad(d + 1)}${c.values.map((v) => this.ex(v)).join(', ')} -> {`, ...this.stmts(c.body, d + 2), `${pad(d + 1)}}`);
        out.push(`${pad(d + 1)}else -> {`, ...(s.dflt === null ? [] : this.stmts(s.dflt, d + 2)), `${pad(d + 1)}}`, `${p}}`);
        return out;
      }
      case 'break':
        return [s.target === null ? `${p}break` : `${p}break@${s.target}`];
      case 'continue':
        return [s.target === null ? `${p}continue` : `${p}break@${s.target}_body`];
    }
  }

  private forLoop(s: Stmt & { s: 'for' }, d: number, src: string): string[] {
    const p = pad(d);
    const out = [src, `${p}run {`, ...s.init.flatMap((x) => this.stmt(x, d + 1))];
    const cond = s.cond === null ? 'true' : this.ex(s.cond);
    if (s.label === null) {
      out.push(`${pad(d + 1)}while (${cond}) {`, ...this.stmts(s.body, d + 2), ...this.stmts(s.incr, d + 2), `${pad(d + 1)}}`);
    } else {
      out.push(`${pad(d + 1)}${s.label}@ while (${cond}) {`, `${pad(d + 2)}${s.label}_body@ do {`, ...this.stmts(s.body, d + 3), `${pad(d + 2)}} while (false)`, ...this.stmts(s.incr, d + 2), `${pad(d + 1)}}`);
    }
    out.push(`${p}}`);
    return out;
  }

  private ifChain(s: Stmt & { s: 'if' }, d: number): string[] {
    const p = pad(d);
    const out = [`${p}if (${this.ex(s.cond)}) {`, ...this.stmts(s.then, d + 1)];
    let e = s.else;
    while (e !== null) {
      const only = e[0];
      if (e.length === 1 && only !== undefined && only.s === 'if') {
        out.push(`${p}} else if (${this.ex(only.cond)}) {`, ...this.stmts(only.then, d + 1));
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
        return kotlinNum(e.value);
      case 'str':
        return kotlinStringLiteral(e.value);
      case 'bool':
        return e.value ? 'true' : 'false';
      case 'null':
        return 'null';
      case 'local':
        return this.isLocalFunc(e.name) ? `::${kotlinId(e.name)}` : kotlinId(e.name);
      case 'global':
        return e.ty.k === 'fn' ? `::${e.name}` : e.name;
      case 'field':
        return `${this.ex(e.obj)}.${kotlinId(e.name)}`;
      case 'call':
        return `${e.fn}(${e.args.map((a) => this.ex(a)).join(', ')})`;
      case 'callValue': {
        const c = e.callee;
        const callee = c.e === 'local' ? kotlinId(c.name) : c.e === 'field' ? this.ex(c) : `(${this.ex(c)})`;
        return `${callee}(${e.args.map((a) => this.ex(a)).join(', ')})`;
      }
      case 'builtin':
        return this.builtin(e);
      case 'bin': {
        if (e.operand === 'ref') return `(${this.ex(e.l)} ${e.op === '==' ? '===' : '!=='} ${this.ex(e.r)})`;
        if (e.operand === 'str') return `${e.op === '!=' ? '!' : ''}jsStrEq(${this.ex(e.l)}, ${this.ex(e.r)})`;
        return `(${this.ex(e.l)} ${e.op} ${this.ex(e.r)})`;
      }
      case 'isNull':
        return `(${this.ex(e.x)} ${e.negate ? '!=' : '=='} null)`;
      case 'and':
        return `(${this.ex(e.l)} && ${this.ex(e.r)})`;
      case 'or':
        return `(${this.ex(e.l)} || ${this.ex(e.r)})`;
      case 'not':
        return `(!${this.ex(e.x)})`;
      case 'neg':
        return `(-${this.ex(e.x)})`;
      case 'cond':
        return `(if (${this.ex(e.c)}) ${this.ex(e.a)} else ${this.ex(e.b)})`;
      case 'new':
        return `${e.cls}(${e.args.map((a) => this.ex(a)).join(', ')})`;
      case 'newError':
        return `JsError(${this.ex(e.message)})`;
      case 'arr':
        return `jsArrayOf<${this.ty((e.ty as Ty & { k: 'array' }).elem)}>(${e.items.map((a) => this.ex(a)).join(', ')})`;
      case 'mapNew': {
        const t = e.ty as Ty & { k: 'map' };
        const base = this.ty(t);
        if (e.entries.length === 0) return `${base}()`;
        return `${base}(listOf(${e.entries.map(([k, v]) => `Pair(${this.ex(k)}, ${this.ex(v)})`).join(', ')}))`;
      }
      case 'lambda': {
        const inner = this.body(e.params, e.body, e.ret, 1).map((l) => `  ${l}`);
        return `fun(${this.params(e.params)}): ${this.ty(e.ret)} {\n${inner.join('\n')}\n}`;
      }
      case 'concat':
        return `(${e.parts.map((a) => this.ex(a)).join(' + ')})`;
      case 'cast':
        return `(${this.ex(e.x)} as ${this.ty(e.ty)})`;
      case 'unwrap':
        return `jsUnwrap(${this.ex(e.x)})`;
      case 'castOpt':
        return `(${this.ex(e.x)} as ${this.ty(e.ty)})`;
      case 'instanceOf':
        return `(${this.ex(e.x)} is ${e.cls})`;
      case 'postInc':
        return `(${this.ex(e.target)}${e.delta === 1 ? '++' : '--'})`;
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
        return `(${x}).isNaN()`;
      case 'isFinite':
        return `(${x}).isFinite()`;
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
        return JSON.stringify(src.elem) === JSON.stringify(res.elem) ? call : `jsCastArray<${this.ty(res.elem)}>(${call})`;
      }
      case 'arrFind': {
        const src = (e.args[0] as Expr).ty as Ty & { k: 'array' };
        const res = e.ty as Ty & { k: 'opt' };
        const call = `jsFind(${x}, ${y})`;
        return JSON.stringify(src.elem) === JSON.stringify(res.inner) ? call : `(${call} as ${this.ty(res)})`;
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
        return `jsConcatArrays(listOf(${a.join(', ')}))`;
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
        return `(${x}).toLong().toInt().toDouble()`;
    }
  }
}

function pad(d: number): string {
  return '  '.repeat(d);
}
