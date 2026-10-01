// css-values-4 §10 math functions: calc(), min(), max() and clamp() parsed, type-checked and simplified exactly as Blink's parser
// does (core/css/css_math_expression_node.cc at 145.0.7632.6: CSSMathExpressionNodeParser, CreateArithmeticOperationSimplified,
// MaybeDistributeArithmeticOperation, MaybeSimplifySumOrProductNode, CreateComparisonFunction), then lowered to the engine's
// CSS-level CalcExpr (packages/layout/src/input.ts). Blink's tree is binary; the engine's sums and products fold left to right,
// so a left-deep chain becomes one sum and every other shape keeps its nesting. What V1 does not support is refused with a reason.
import type { CalcExpr, LengthCalc } from '@dragon/layout';
import { mathFunctionRefusal, unitEntry } from './units.ts';

export type Category = 'number' | 'length' | 'percent' | 'length-percent';

export type MathLiteral = {
  readonly t: 'lit';
  readonly value: number;
  /** '' for a number, '%' for a percentage, otherwise the lowercased dimension unit. */
  readonly unit: string;
  /** Set when the literal is 1 / n from a division by the number n (CreateInvertFunction), so the lowering keeps the division. */
  readonly inverseOf: number | null;
  nested: boolean;
};

export type MathOperator = 'add' | 'sub' | 'mul' | 'invert' | 'min' | 'max' | 'clamp';

export type MathOp = { readonly t: 'op'; readonly op: MathOperator; readonly args: readonly MathNode[]; readonly category: Category; nested: boolean };

export type MathNode = MathLiteral | MathOp;

/** A math function V1 refuses: reason says why, fix what to write instead. */
export class MathRefusal extends Error {
  readonly reason: string;
  readonly fix: string;
  constructor(reason: string, fix: string) {
    super(reason);
    this.reason = reason;
    this.fix = fix;
  }
}

const refuse = (reason: string, fix = 'Write a calculation of px, %, em, rem, absolute and viewport lengths (vw, vh, vi, vb, vmin, vmax) with +, -, * and / by a number, min(), max() and clamp().'): never => {
  throw new MathRefusal(reason, fix);
};

export const V1_MATH_FUNCTIONS: ReadonlySet<string> = new Set(['calc', 'min', 'max', 'clamp']);

/** The absolute units (css-values-4 §6.2) and their px ratios, from the unit registry (Blink kCssPixelsPer*). */
function pxPer(unit: string): number | null {
  if (unit === 'px') return 1;
  const c = unitEntry(unit)?.conversion;
  return c !== undefined && c.kind === 'absolute' ? c.pxPer : null;
}

const V1_RELATIVE = new Set(['em', 'rem', 'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax']);
/** Blink HasDoubleValue: the unit types a literal may be combined in (vi and vb are not among them). */
const DOUBLE_VALUED = new Set(['', '%', 'px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'em', 'rem', 'vw', 'vh', 'vmin', 'vmax']);
const FONT_METRIC = new Set(['ex', 'rex', 'ch', 'rch', 'cap', 'rcap', 'ic', 'ric']);
const LINE_HEIGHT_UNITS = new Set(['lh', 'rlh']);
const SIZED_VIEWPORT = /^[sld]v(w|h|i|b|min|max)$/;
const CONTAINER_UNITS = new Set(['cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax']);

function unitCategory(unit: string): Category {
  if (unit === '') return 'number';
  if (unit === '%') return 'percent';
  return 'length';
}

/** Blink UnitTypeToUnitCategory: absolute lengths share a category (and canonical unit px); every other unit is its own. */
function unitFamily(unit: string): string {
  if (unit === '') return 'number';
  if (unit === '%') return 'percent';
  return pxPer(unit) !== null ? 'absolute' : 'other';
}

function canonicalUnit(unit: string): string {
  return unitFamily(unit) === 'absolute' ? 'px' : unit;
}

function scaleToCanonical(unit: string): number {
  const k = pxPer(unit);
  return k === null ? 1 : k;
}

const isLit = (n: MathNode): n is MathLiteral => n.t === 'lit';
const lit = (value: number, unit: string, inverseOf: number | null = null): MathLiteral => ({ t: 'lit', value, unit, inverseOf, nested: false });
const category = (n: MathNode): Category => (isLit(n) ? unitCategory(n.unit) : n.category);

/** Blink ResolvedUnitType: a literal's unit, or an operation's when every operand agrees; null is kUnknown. */
function resolvedUnit(n: MathNode): string | null {
  if (isLit(n)) return n.unit;
  if (n.category === 'number') return '';
  if (n.category === 'length-percent') return null;
  if (n.op === 'mul') {
    const [a, b] = n.args as [MathNode, MathNode];
    return category(a) === 'number' ? resolvedUnit(b) : resolvedUnit(a);
  }
  const first = resolvedUnit(n.args[0] as MathNode);
  if (first === null) return null;
  for (const a of n.args.slice(1)) if (resolvedUnit(a) !== first) return null;
  return first;
}

const hasDoubleValue = (u: string | null): boolean => u !== null && DOUBLE_VALUED.has(u);
const isNumericWithDouble = (n: MathNode): n is MathLiteral => isLit(n) && hasDoubleValue(n.unit);

function isNegativeZero(x: number): boolean {
  return x === 0 && 1 / x < 0;
}

/** Blink CSSMathExpressionOperation::EvaluateOperator, in double. */
function evaluateOperator(values: readonly number[], op: MathOperator | 'div'): number {
  for (const v of values) if (Number.isNaN(v)) return v;
  const [a = 0, b = 0, c = 0] = values;
  switch (op) {
    case 'add':
      return a + b;
    case 'sub':
      return a - b;
    case 'mul':
      return a * b;
    case 'div':
      return a / b;
    case 'invert':
      return 1 / a;
    case 'min': {
      let m = a;
      for (const v of values) m = m === 0 && v === 0 && isNegativeZero(m) !== isNegativeZero(v) ? -0 : v < m ? v : m;
      return m;
    }
    case 'max': {
      let m = a;
      for (const v of values) m = m === 0 && v === 0 && isNegativeZero(m) !== isNegativeZero(v) ? 0 : m < v ? v : m;
      return m;
    }
    case 'clamp': {
      let minimum = c < b ? c : b;
      if (b === 0 && c === 0 && !isNegativeZero(b) && isNegativeZero(c)) minimum = -0;
      let maximum = a < minimum ? minimum : a;
      if (a === 0 && minimum === 0 && isNegativeZero(a) && !isNegativeZero(minimum)) maximum = 0;
      return maximum;
    }
  }
}

// ---------------------------------------------------------------- construction (CSSMathExpressionOperation::Create*)

function addCategory(a: Category, b: Category): Category | null {
  if (a === b) return a;
  if (a === 'number' || b === 'number') return null;
  return 'length-percent';
}

function createInvert(operand: MathNode): MathNode {
  if (isLit(operand) && category(operand) === 'number' && operand.value !== 0) return lit(1 / operand.value, '', operand.value);
  if (!isLit(operand) && operand.op === 'invert') return copy(operand.args[0] as MathNode);
  if (category(operand) !== 'number') return refuse('it divides by a length, which is typed arithmetic (css-values-4 §10.9), not supported');
  return { t: 'op', op: 'invert', args: [operand], category: 'number', nested: false };
}

function createArithmetic(left: MathNode, right: MathNode, op: 'add' | 'sub' | 'mul' | 'div'): MathNode {
  const lc = category(left);
  const rc = category(right);
  if (op === 'add' || op === 'sub') {
    const c = addCategory(lc, rc);
    if (c === null) return refuse(`it ${op === 'add' ? 'adds' : 'subtracts'} a number and a ${lc === 'number' ? rc : lc}, which css-values-4 §10.9 makes invalid`, 'Give every term of a sum the same type: all lengths and percentages, or all numbers.');
    return { t: 'op', op, args: [left, right], category: c, nested: false };
  }
  if (op === 'div') {
    if (rc !== 'number') return refuse('it divides by a length, which is typed arithmetic (css-values-4 §10.9), not supported');
    const inverted = createInvert(right);
    if (lc === 'number' && isLit(left) && left.value === 1) return inverted;
    return { t: 'op', op: 'mul', args: [left, inverted], category: lc, nested: false };
  }
  if (lc !== 'number' && rc !== 'number') return refuse('it multiplies two lengths, which is typed arithmetic (css-values-4 §10.9), not supported');
  return { t: 'op', op: 'mul', args: [left, right], category: lc === 'number' ? rc : lc, nested: false };
}

function copy(n: MathNode): MathNode {
  return isLit(n) ? { ...n, nested: n.nested } : { ...n, nested: n.nested };
}

function numericLiteralSide(left: MathNode, right: MathNode): MathLiteral | null {
  if (isLit(left) && category(left) === 'number') return left;
  if (isLit(right) && category(right) === 'number') return right;
  return null;
}

const isAddOrSub = (n: MathNode): n is MathOp => !isLit(n) && (n.op === 'add' || n.op === 'sub');
const allNumeric = (n: MathOp): boolean => n.args.every(isLit);

function maybeDistribute(left: MathNode, right: MathNode, op: 'add' | 'sub' | 'mul' | 'div'): MathNode | null {
  if (op !== 'mul' && op !== 'div') return null;
  if (isAddOrSub(left) && allNumeric(left) && isLit(right) && category(right) === 'number') {
    const a = createArithmeticSimplified(left.args[0] as MathNode, right, op);
    const b = createArithmeticSimplified(left.args[1] as MathNode, right, op);
    const r = createArithmeticSimplified(a, b, left.op as 'add' | 'sub');
    r.nested = true;
    return r;
  }
  if (isAddOrSub(right) && allNumeric(right) && isLit(left) && category(left) === 'number' && op !== 'div') {
    const a = createArithmeticSimplified(left, right.args[0] as MathNode, op);
    const b = createArithmeticSimplified(left, right.args[1] as MathNode, op);
    const r = createArithmeticSimplified(a, b, right.op as 'add' | 'sub');
    r.nested = true;
    return r;
  }
  return null;
}

/** Blink CSSMathExpressionOperation::CreateArithmeticOperationSimplified. */
function createArithmeticSimplified(left: MathNode, right: MathNode, op: 'add' | 'sub' | 'mul' | 'div'): MathNode {
  const distributed = maybeDistribute(left, right, op);
  if (distributed !== null) return distributed;
  const canSimplify = isLit(left) && isLit(right) && !((op === 'mul' || op === 'div') && category(left) !== 'number' && category(right) !== 'number');
  if (!canSimplify) return createArithmetic(left, right, op);
  const l = left as MathLiteral;
  const r = right as MathLiteral;
  const lc = category(l);
  const rc = category(r);
  if (lc === 'number' && rc === 'number') return lit(evaluateOperator([l.value, r.value], op), '');
  if (op === 'add' || op === 'sub') {
    if (lc === rc && hasDoubleValue(l.unit)) {
      if (l.unit === r.unit) return lit(evaluateOperator([l.value, r.value], op), l.unit);
      const lf = unitFamily(l.unit);
      if (lf !== 'other' && lf === unitFamily(r.unit)) {
        return lit(evaluateOperator([l.value * scaleToCanonical(l.unit), r.value * scaleToCanonical(r.unit)], op), canonicalUnit(l.unit));
      }
    }
  } else {
    if (rc !== 'number' && op === 'div') return refuse('it divides by a length, which is typed arithmetic (css-values-4 §10.9), not supported');
    const numberSide = numericLiteralSide(l, r);
    if (numberSide === null) return createArithmetic(left, right, op);
    const other = numberSide === l ? r : l;
    if (hasDoubleValue(other.unit)) return lit(evaluateOperator([other.value, numberSide.value], op), other.unit);
  }
  return createArithmetic(left, right, op);
}

// ---------------------------------------------------------------- MaybeSimplifySumOrProductNode

type Child = { readonly op: MathOperator; readonly node: MathNode };

function signFor(inNesting: boolean, outer: MathOperator, current: MathOperator): MathOperator {
  if (inNesting && outer === 'sub' && current === 'add') return 'sub';
  if (inNesting && outer === 'sub' && current === 'sub') return 'add';
  return current;
}

/** Blink TraverseNumericChildrenFromNode: the flattened operands of a sum (or product) in order, each with its effective sign. */
function traverse(root: MathNode, op: MathOperator): Child[] {
  const out: Child[] = [];
  const shouldTraverse = (n: MathNode, o: MathOperator): n is MathOp => !isLit(n) && (o === 'mul' ? n.op === 'mul' : n.op === 'add' || n.op === 'sub');
  const stack: { node: MathNode; op: MathOperator; nesting: boolean }[] = [];
  const push = (n: MathOp, o: MathOperator, nesting: boolean): void => {
    const inNesting = nesting || n.nested;
    stack.push({ node: n.args[n.args.length - 1] as MathNode, op: signFor(inNesting, o, n.op), nesting: inNesting });
    stack.push({ node: n.args[0] as MathNode, op: o, nesting: inNesting });
  };
  if (!shouldTraverse(root, op)) return [{ op, node: root }];
  push(root, op, false);
  while (stack.length > 0) {
    const last = stack.pop() as { node: MathNode; op: MathOperator; nesting: boolean };
    if (!shouldTraverse(last.node, last.op)) out.push({ op: last.op, node: last.node });
    else push(last.node, last.op, last.nesting);
  }
  return out;
}

function maybeSimplifySumOrProduct(root: MathOp): MathNode {
  const isMultiply = root.op === 'mul';
  const children = traverse(root, isMultiply ? 'mul' : 'add');
  const combined = new Map<string, number>();
  for (const c of children) {
    if (!isNumericWithDouble(c.node)) continue;
    const v = c.op === 'sub' ? -c.node.value : c.node.value;
    const had = combined.get(c.node.unit);
    combined.set(c.node.unit, had === undefined ? v : isMultiply ? had * v : had + v);
  }
  const litsOfUnit = new Map<string, number>();
  for (const c of children) if (isLit(c.node)) litsOfUnit.set(c.node.unit, (litsOfUnit.get(c.node.unit) ?? 0) + 1);
  const used = new Set<string>();
  let final: MathNode | null = null;
  for (const child of children) {
    let op = child.op;
    let node = child.node;
    if (isLit(node) && combined.has(node.unit)) {
      let value = combined.get(node.unit) as number;
      if (!isMultiply) {
        op = value < 0 ? 'sub' : 'add';
        value = Math.abs(value);
      }
      // An uncombined single inverse keeps its division (Blink copies the literal's value; the lowering only reads the flag).
      const single = litsOfUnit.get(node.unit) === 1;
      node = lit(value, node.unit, single ? (node as MathLiteral).inverseOf : null);
    }
    if (isNumericWithDouble(node)) {
      if (used.has(node.unit)) continue;
      used.add(node.unit);
      if (isMultiply && node.unit === '' && node.value === 1 && combined.size + children.length > 1) continue;
    }
    if (final === null) {
      final = op === 'sub' && isNumericWithDouble(node) ? lit(-node.value, node.unit) : copy(node);
      continue;
    }
    final = createArithmeticSimplified(final, node, op as 'add' | 'sub' | 'mul');
  }
  return final as MathNode;
}

// ---------------------------------------------------------------- comparison functions

function comparisonCategory(args: readonly MathNode[]): Category {
  let c = category(args[0] as MathNode);
  for (const a of args.slice(1)) {
    const next = addCategory(c, category(a));
    if (next === null) return refuse('it compares a number with a length, which css-values-4 §10.9 makes invalid', 'Give every argument of min(), max() and clamp() the same type.');
    c = next;
  }
  return c;
}

function canEagerlySimplify(n: MathNode): boolean {
  if (!isLit(n)) return false;
  const c = category(n);
  if (c === 'number') return true;
  return c === 'length' && pxPer(n.unit) !== null;
}

function createComparison(args: MathNode[], op: 'min' | 'max' | 'clamp'): MathNode {
  const c = comparisonCategory(args);
  if (args.every(canEagerlySimplify)) {
    const values = args.map((a) => (a as MathLiteral).value * scaleToCanonical((a as MathLiteral).unit));
    return lit(evaluateOperator(values, op), canonicalUnit((args[0] as MathLiteral).unit));
  }
  if (args.length === 1) return copy(args[0] as MathNode);
  return { t: 'op', op, args, category: c, nested: false };
}

// ---------------------------------------------------------------- tokens and the parser (CSSMathExpressionNodeParser)

type Token =
  | { readonly k: 'num'; readonly value: number; readonly unit: string }
  | { readonly k: 'ident'; readonly name: string }
  | { readonly k: 'func'; readonly name: string }
  | { readonly k: 'open' | 'close' | 'comma' | 'ws' }
  | { readonly k: 'delim'; readonly ch: string };

// Sticky, so each token is matched in place: tokenizing is linear in the text.
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT = /-?[a-zA-Z_][a-zA-Z0-9_-]*/y;
const UNIT = /[a-zA-Z]+/y;
/** The code points the validity check tokenizes: css-syntax-3 §4.2 white space, ASCII letters and digits, and - _ + * / ( ) . , %. */
const CSS_WHITE_SPACE = /[ \t\n\r\f]/;
const VALIDITY_CHARACTERS = /^[A-Za-z0-9_\-+*/().,% \t\n\r\f]$/;

/**
 * The most tokens a calculation may have. Chrome 145 sets no such limit; Dragon refuses a longer calculation with a reason, so
 * no value can stall a build. The nesting limit (32) does not cap a flat sum, and a sum is a left-deep chain that finite(),
 * resolvedUnit(), foldNumber() and the lowering walk recursively, so this bound also keeps their depth and work small.
 */
export const MAX_MATH_TOKENS = 1000;

const execAt = (re: RegExp, text: string, i: number): RegExpExecArray | null => {
  re.lastIndex = i;
  return re.exec(text);
};

/** The tokens of a calculation, at most MAX_MATH_TOKENS; for the validity check comments are dropped as css-syntax-3 §4.3 does, and an unclosed one or a longer calculation gives null. */
function tokenize(text: string): Token[];
function tokenize(text: string, validity: true): Token[] | null;
function tokenize(text: string, validity = false): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    // The bound holds on both paths: past it the validity check is undetermined (null), and parseMath then refuses with the reason.
    if (out.length >= MAX_MATH_TOKENS) return validity ? null : refuse(`it has more than ${MAX_MATH_TOKENS} tokens, the most a calculation may have`, 'Write a shorter calculation.');
    const ch = text[i] as string;
    if (validity && ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    // Escapes, strings, non-ASCII and other code points the math tokenizer does not model; and css-syntax-3 white space only.
    if (validity && !VALIDITY_CHARACTERS.test(ch)) return null;
    const space = validity ? CSS_WHITE_SPACE : /\s/;
    if (space.test(ch)) {
      while (i < text.length && space.test(text[i] as string)) i++;
      out.push({ k: 'ws' });
      continue;
    }
    const num = execAt(NUMBER, text, i);
    const prevIsValue = out.length > 0 && ['num', 'close', 'ident'].includes((out[out.length - 1] as Token).k);
    if (num !== null && !((ch === '+' || ch === '-') && prevIsValue)) {
      i += num[0].length;
      if (text[i] === '%') {
        i++;
        out.push({ k: 'num', value: Number(num[0]), unit: '%' });
      } else {
        const u = execAt(UNIT, text, i);
        if (u !== null) i += u[0].length;
        out.push({ k: 'num', value: Number(num[0]), unit: u === null ? '' : u[0].toLowerCase() });
      }
      continue;
    }
    const id = execAt(IDENT, text, i);
    if (id !== null) {
      i += id[0].length;
      if (text[i] === '(') {
        i++;
        out.push({ k: 'func', name: id[0].toLowerCase() });
      } else out.push({ k: 'ident', name: id[0].toLowerCase() });
      continue;
    }
    i++;
    if (ch === '(') out.push({ k: 'open' });
    else if (ch === ')') out.push({ k: 'close' });
    else if (ch === ',') out.push({ k: 'comma' });
    else out.push({ k: 'delim', ch });
  }
  return out;
}

class Parser {
  private i = 0;
  private readonly toks: Token[];
  /** The refusal a percentage meets, or null where the property takes one. */
  private readonly percentRefusal: PercentRefusal | null;
  constructor(toks: Token[], percentRefusal: PercentRefusal | null) {
    this.toks = toks;
    this.percentRefusal = percentRefusal;
  }
  private peek(): Token | undefined {
    return this.toks[this.i];
  }
  private skipWs(): boolean {
    let seen = false;
    while (this.peek()?.k === 'ws') {
      this.i++;
      seen = true;
    }
    return seen;
  }
  atEnd(): boolean {
    this.skipWs();
    return this.i >= this.toks.length;
  }
  private invalid(): never {
    return refuse('it does not parse as a css-values-4 calculation');
  }
  /** depth counts the enclosing parentheses and functions, so nested min() is bounded like nested calc(). */
  function(name: string, depth: number): MathNode {
    if (!V1_MATH_FUNCTIONS.has(name)) {
      const r = mathFunctionRefusal(name);
      if (r !== null) return refuse(r.reason, r.fix);
      return refuse(name === 'var' ? 'var() needs custom properties, which are not supported' : `${name}() is not a math function V1 of the value model supports`);
    }
    const args: MathNode[] = [];
    this.skipWs();
    for (;;) {
      args.push(this.expression(depth));
      this.skipWs();
      const t = this.peek();
      if (t?.k === 'comma') {
        this.i++;
        this.skipWs();
        continue;
      }
      if (t?.k === 'close') {
        this.i++;
        break;
      }
      this.invalid();
    }
    if (name === 'calc') {
      if (args.length !== 1) this.invalid();
      return args[0] as MathNode;
    }
    if (name === 'clamp' && args.length !== 3) this.invalid();
    return createComparison(args, name as 'min' | 'max' | 'clamp');
  }
  /** One term: a nested calculation, a function or a value; ws reports whether whitespace follows it. */
  private term(depth: number): { node: MathNode; ws: boolean } {
    const t = this.peek();
    if (t === undefined) return this.invalid();
    this.i++;
    let node: MathNode;
    if (t.k === 'open' || (t.k === 'func' && t.name === 'calc')) {
      this.skipWs();
      node = this.expression(depth + 1);
      this.skipWs();
      if (this.peek()?.k !== 'close') this.invalid();
      this.i++;
      node.nested = true;
    } else if (t.k === 'func') node = this.function(t.name, depth + 1);
    else if (t.k === 'num') node = this.value(t.value, t.unit);
    else if (t.k === 'ident') {
      return refuse(['e', 'pi', 'infinity', '-infinity', 'nan'].includes(t.name) ? `the calculation constant ${t.name} is not supported in V1 of the value model` : `${t.name} is not a value in a calculation`);
    } else return this.invalid();
    return { node, ws: this.skipWs() };
  }
  private value(value: number, unit: string): MathNode {
    if (unit === '' || V1_RELATIVE.has(unit) || pxPer(unit) !== null) return lit(value, unit);
    if (unit === '%') {
      if (this.percentRefusal !== null) return refuse(this.percentRefusal.reason, this.percentRefusal.fix);
      return lit(value, unit);
    }
    if (FONT_METRIC.has(unit)) return refuse(`${unit} is measured from the primary font at its rendered size, which needs the value-model package V2`, 'Use em, rem or px.');
    if (LINE_HEIGHT_UNITS.has(unit)) return refuse(`${unit} is the used line height, which needs the value-model package V2`, 'Use em, rem or px.');
    if (SIZED_VIEWPORT.test(unit)) return refuse(`${unit} is a small, large or dynamic viewport unit, which needs the viewport inputs of the value-model package V2`, 'Use vw, vh, vi, vb, vmin or vmax.');
    if (CONTAINER_UNITS.has(unit)) return refuse(`${unit} is a container query unit, and container queries are not supported`, 'Use %, px, em or rem.');
    return refuse(`${unit === '' ? 'a number' : `the unit ${unit}`} is not a length`);
  }
  private multiplicative(depth: number): { node: MathNode; ws: boolean } {
    let { node, ws } = this.term(depth);
    for (;;) {
      const t = this.peek();
      if (t?.k !== 'delim' || (t.ch !== '*' && t.ch !== '/')) break;
      this.i++;
      this.skipWs();
      const rhs = this.term(depth);
      node = createArithmeticSimplified(node, rhs.node, t.ch === '*' ? 'mul' : 'div');
      ws = rhs.ws;
    }
    if (!isLit(node) && node.op === 'mul') node = maybeSimplifySumOrProduct(node);
    return { node, ws };
  }
  expression(depth: number): MathNode {
    if (depth > 32) return this.invalid();
    let { node, ws } = this.multiplicative(depth);
    for (;;) {
      const t = this.peek();
      if (t?.k !== 'delim' || (t.ch !== '+' && t.ch !== '-')) break;
      if (!ws) this.invalid();
      this.i++;
      if (this.peek()?.k !== 'ws') this.invalid();
      this.skipWs();
      const rhs = this.multiplicative(depth);
      node = createArithmeticSimplified(node, rhs.node, t.ch === '+' ? 'add' : 'sub');
      ws = rhs.ws;
    }
    if (isAddOrSub(node)) node = maybeSimplifySumOrProduct(node);
    return node;
  }
}

/** Why a percentage in a calculation is refused: the reason names the cause, which differs by property. */
export type PercentRefusal = { readonly reason: string; readonly fix: string };

/** What a property takes: a length (with a percentage, or with the refusal a percentage meets) or a number (css-values-4 §10.9 type checking). */
export type MathContext = { readonly type: 'length'; readonly percent: true | PercentRefusal } | { readonly type: 'number' };

const NUMBER_PROPERTIES: ReadonlySet<string> = new Set(['flex-grow', 'flex-shrink', 'order']);
const TEXT_PROPERTIES: ReadonlySet<string> = new Set(['font-size', 'line-height', 'font']);
/**
 * Border, outline and column-rule widths are a <line-width>, which has no percentage (css-backgrounds-3 §3.3, css-ui-4 §3.2,
 * css-multicol-1 §4.2), so a calculation with one is invalid and Chrome drops the declaration: Chrome 145.0.7632.6 gives
 * CSS.supports('border-left-width', 'calc(1px + 5%)') false and keeps the earlier border-left-width (T131).
 */
const LINE_WIDTH = /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-width)?|outline(-width)?|column-rule(-width)?)$/;
/** Gaps take a percentage (css-align-3 §8.1) and Chrome accepts calc(10px + 5%) there, but the layout engine has no percentage gaps yet. */
const GAP = /^(gap|row-gap|column-gap)$/;

/**
 * A percentage that survives into the result makes a <line-width> or number calculation invalid (mathInvalidity); one Chrome
 * accepts cancels out by typed arithmetic, as calc(5% / 5% * 1px) does, which V1 does not support.
 */
const LINE_WIDTH_PERCENT: PercentRefusal = {
  reason: 'a percentage in a border, outline or column-rule width cancels out only by typed arithmetic (css-values-4 §10.9), which is not supported',
  fix: 'Use a length without a percentage.',
};
const NUMBER_PERCENT: PercentRefusal = { reason: 'a percentage in a number calculation cancels out only by typed arithmetic (css-values-4 §10.9), which is not supported', fix: 'Write the calculation with numbers only.' };
const GAP_PERCENT: PercentRefusal = { reason: 'a percentage in this property needs percentage gaps, which are not supported yet', fix: 'Use a length without a percentage.' };

/** The calculation a property takes, or the reason V1 refuses every calculation in it. */
export function mathContextFor(property: string): MathContext | { readonly refused: string } {
  if (NUMBER_PROPERTIES.has(property)) return { type: 'number' };
  if (TEXT_PROPERTIES.has(property)) return { refused: `a calculation in ${property} reaches the font and line metrics, which needs the value-model package V2` };
  if (LINE_WIDTH.test(property)) return { type: 'length', percent: LINE_WIDTH_PERCENT };
  if (GAP.test(property)) return { type: 'length', percent: GAP_PERCENT };
  return { type: 'length', percent: true };
}

export type ParsedMath = { readonly ok: true; readonly node: MathNode } | { readonly ok: false; readonly reason: string; readonly fix: string };

/** Every literal is finite, and so is every number operation, which holds only numbers and so folds now: 10vi / 0 keeps 1 / 0 as an op. */
function finite(n: MathNode): boolean {
  if (isLit(n)) return Number.isFinite(n.value) && (n.inverseOf === null || Number.isFinite(n.inverseOf));
  if (n.category === 'number' && !Number.isFinite(foldNumber(n))) return false;
  return n.args.every(finite);
}

/** Parses one math function's text (as css-tree generates it) for a property context. */
export function parseMath(text: string, context: MathContext): ParsedMath {
  // What Chrome rejects is invalid whatever V1 supports, so the validity check (the one stylesheet parsing drops declarations by) runs first.
  const grammar: MathGrammar = context.type === 'number' ? 'number' : context.percent === LINE_WIDTH_PERCENT ? 'length' : 'length-percentage';
  const invalidity = mathInvalidity(text, grammar);
  if (invalidity !== null) return { ok: false, reason: `${invalidity}, so Chrome drops the declaration`, fix: 'Write a calculation Chrome accepts for this property.' };
  try {
    const toks = tokenize(text.trim());
    const head = toks[0];
    if (head === undefined || head.k !== 'func') return refuse('it does not parse as a css-values-4 calculation');
    const p = new Parser(toks.slice(1), context.type === 'number' ? NUMBER_PERCENT : context.percent === true ? null : context.percent);
    const node = p.function(head.name, 0);
    if (!p.atEnd()) return refuse('it does not parse as a css-values-4 calculation');
    const c = category(node);
    if (context.type === 'number' && c !== 'number') return refuse(`it resolves to a ${c}, not a number`);
    if (context.type === 'length' && c === 'number') return refuse('it resolves to a number, not a length', 'Give the calculation a length unit, for example calc(2 * 10px).');
    if (!finite(node)) return refuse('it divides by zero or produces an infinite or NaN value', 'Write a finite calculation.');
    return { ok: true, node };
  } catch (e) {
    if (e instanceof MathRefusal) return { ok: false, reason: e.reason, fix: e.fix };
    throw e;
  }
}

// ---------------------------------------------------------------- parse-time validity (Chrome drops the declaration)

/**
 * What a property's math function must resolve to, as Blink's consumers check it (core/css/properties/css_parsing_utils.cc at
 * 145.0.7632.6): ConsumeLength takes kCalcLength only (a <line-width>), ConsumeLengthOrPercent a length, a percentage or a mix
 * (kCalcLengthFunction), ConsumeNumber and ConsumeInteger a number, and ConsumeLineHeight or the flex shorthand either.
 */
export type MathGrammar = 'length' | 'length-percentage' | 'number' | 'number-or-length-percentage';

const NUMBER_GRAMMAR: ReadonlySet<string> = new Set(['flex-grow', 'flex-shrink', 'order', 'text-combine-upright']);
const NUMBER_OR_LENGTH_GRAMMAR: ReadonlySet<string> = new Set(['line-height', 'flex']);

/** The grammar a top-level math function of a property resolves against; every other numeric property takes <length-percentage>. */
export function mathGrammarFor(property: string): MathGrammar {
  if (NUMBER_GRAMMAR.has(property)) return 'number';
  if (NUMBER_OR_LENGTH_GRAMMAR.has(property)) return 'number-or-length-percentage';
  if (LINE_WIDTH.test(property)) return 'length';
  return 'length-percentage';
}

/**
 * Blink CSSMathExpressionNodeParser::IsSupportedMathFunction at 145.0.7632.6. Of the functions behind runtime flags, Chrome
 * 145.0.7632.6 parses progress() and rejects media-progress(), container-progress() and random() (captured by
 * packages/parity/src/cli/math-validity-capture.ts), so those three are not math functions here.
 */
export const BLINK_MATH_FUNCTIONS: ReadonlySet<string> = new Set([
  'calc', '-webkit-calc', 'min', 'max', 'clamp', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'anchor', 'anchor-size', 'calc-size',
  'round', 'mod', 'rem', 'pow', 'sqrt', 'hypot', 'log', 'exp', 'sibling-count', 'sibling-index', 'abs', 'sign', 'progress',
]);
/** Math functions this check does not model (anchor queries, calc-size(), progress()): a calculation holding one is left to the rest of the pipeline. */
const UNMODELLED_FUNCTIONS: ReadonlySet<string> = new Set(['anchor', 'anchor-size', 'calc-size', 'progress']);
/** Substitution functions: a value holding one is valid at parse time and checked after substitution (css-values-5, css-variables-1 §3.1). */
const SUBSTITUTION_FUNCTIONS: ReadonlySet<string> = new Set(['var', 'env', 'attr', 'if', 'inherit']);

/** Blink CalculationResultCategory, less kCalcOther (a failure) and kCalcIdent (keyword literals, which no checked property takes). */
type VCategory = 'number' | 'length' | 'percent' | 'length-function' | 'intermediate' | 'angle' | 'time' | 'frequency' | 'resolution';

/** Blink UnitCategory: the dimension units a calculation accepts, with their categories; any other unit fails the parse. */
const UNIT_CATEGORIES: ReadonlyMap<string, VCategory> = new Map<string, VCategory>([
  ...['em', 'ex', 'px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'rem', 'ch', 'vw', 'vh', 'vmin', 'vmax', 'rex', 'rch', 'ric', 'rlh', 'ic', 'lh', 'cap', 'rcap', 'vi', 'vb', 'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'].map((u) => [u, 'length'] as const),
  ...['s', 'l', 'd'].flatMap((p) => ['w', 'h', 'i', 'b', 'min', 'max'].map((a) => [`${p}v${a}`, 'length'] as const)),
  ...['deg', 'grad', 'rad', 'turn'].map((u) => [u, 'angle'] as const),
  ...['ms', 's'].map((u) => [u, 'time'] as const),
  ...['hz', 'khz'].map((u) => [u, 'frequency'] as const),
  ...['dppx', 'x', 'dpi', 'dpcm'].map((u) => [u, 'resolution'] as const),
]);
/** Blink HasDoubleValue: the units a literal folds in. */
const BLINK_DOUBLE_VALUED: ReadonlySet<string> = new Set(['', '%', 'em', 'ex', 'ch', 'ic', 'lh', 'cap', 'rcap', 'rlh', 'rem', 'rex', 'rch', 'ric', 'px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'deg', 'rad', 'grad', 'turn', 'ms', 's', 'hz', 'khz', 'vw', 'vh', 'vmin', 'vmax', 'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax', 'dppx', 'x', 'dpi', 'dpcm']);
/** Blink UnitTypeToUnitCategory: units that convert to one canonical unit, with it; the rest are their own. */
const CANONICAL: ReadonlyMap<string, string> = new Map([
  ...['px', 'cm', 'mm', 'q', 'in', 'pt', 'pc'].map((u) => [u, 'px'] as const),
  ...['deg', 'rad', 'grad', 'turn'].map((u) => [u, 'deg'] as const),
  ...['ms', 's'].map((u) => [u, 's'] as const),
  ...['hz', 'khz'].map((u) => [u, 'hz'] as const),
  ...['dppx', 'x', 'dpi', 'dpcm'].map((u) => [u, 'dppx'] as const),
]);
const CANONICAL_OF_CATEGORY: { readonly [c in VCategory]?: string } = { number: '', length: 'px', angle: 'deg', time: 's', frequency: 'hz', resolution: 'dppx' };

/** css-typed-om-1 §4.1 types (Blink CSSMathType): powers of length, angle, time, frequency, resolution, flex and percent, and a percent hint. */
type VType = { readonly powers: readonly number[]; readonly hint: number | null };
const PERCENT_INDEX = 6;
const BASE_INDEX: { readonly [c in VCategory]?: number } = { length: 0, angle: 1, time: 2, frequency: 3, resolution: 4, percent: PERCENT_INDEX };

/** A parsed node: its category, its type when it is an arithmetic operation, and its unit when it is certainly a numeric literal. */
type VNode = { readonly category: VCategory; readonly type: VType | null; readonly literal: string | null };

/** A calculation Chrome rejects; reason says why. */
class MathInvalid extends Error {}
/** A calculation this check cannot decide (an unmodelled function, a substitution, an escape): it is not reported as invalid. */
class MathUndetermined extends Error {}
const invalid = (reason: string): never => {
  throw new MathInvalid(reason);
};
const undetermined = (): never => {
  throw new MathUndetermined();
};

function typeOfCategory(c: VCategory): VType {
  const powers = [0, 0, 0, 0, 0, 0, 0];
  if (c === 'intermediate') return undetermined();
  if (c === 'length-function') {
    powers[0] = 1;
    return { powers, hint: 0 };
  }
  const i = BASE_INDEX[c];
  if (i !== undefined) powers[i] = 1;
  return { powers, hint: null };
}
const typeOf = (n: VNode): VType => n.type ?? typeOfCategory(n.category);

function applyHint(t: VType, hint: number): VType {
  if (t.hint !== null) return t;
  const powers = [...t.powers];
  if (hint !== PERCENT_INDEX) {
    powers[hint] = (powers[hint] as number) + (powers[PERCENT_INDEX] as number);
    powers[PERCENT_INDEX] = 0;
  }
  return { powers, hint };
}
const sameType = (a: VType, b: VType): boolean => a.hint === b.hint && a.powers.every((p, i) => p === b.powers[i]);
const sumOf = (t: VType): number => t.powers.reduce((s, p) => s + p, 0);

/** Blink operator+(CSSMathType, CSSMathType): css-typed-om-1 "add two types". */
function addTypes(t1: VType, t2: VType): VType | null {
  if (t1.hint !== null && t2.hint !== null && t1.hint !== t2.hint) return null;
  if (t1.hint !== null && t2.hint === null) t2 = applyHint(t2, t1.hint);
  if (t1.hint === null && t2.hint !== null) t1 = applyHint(t1, t2.hint);
  if (sameType(t1, t2)) return t1;
  const percent = t1.powers[PERCENT_INDEX] !== 0 || t2.powers[PERCENT_INDEX] !== 0;
  const other = t1.powers[PERCENT_INDEX] !== sumOf(t1) || t2.powers[PERCENT_INDEX] !== sumOf(t2);
  if (percent && other) {
    for (let hint = 0; hint < PERCENT_INDEX; hint++) {
      const a = applyHint(t1, hint);
      if (sameType(a, applyHint(t2, hint))) return a;
    }
  }
  return null;
}

/** Blink operator*(CSSMathType, CSSMathType): css-typed-om-1 "multiply two types"; division multiplies by the negated type. */
function multiplyTypes(t1: VType, t2: VType): VType | null {
  if (t1.hint !== null && t2.hint !== null && t1.hint !== t2.hint) return null;
  if (t1.hint !== null && t2.hint === null) t2 = applyHint(t2, t1.hint);
  if (t1.hint === null && t2.hint !== null) t1 = applyHint(t1, t2.hint);
  return { powers: t1.powers.map((p, i) => p + (t2.powers[i] as number)), hint: t1.hint };
}
const negateType = (t: VType): VType => ({ powers: t.powers.map((p) => -p), hint: t.hint });

/** Blink CSSMathType::Category: null is kCalcOther. */
function categoryOfType(t: VType): VCategory | null {
  let sum = 0;
  let base = -1;
  for (let i = 0; i < PERCENT_INDEX + 1; i++) {
    const p = t.powers[i] as number;
    if (p === 0) continue;
    if (sum !== 0) {
      if (i !== PERCENT_INDEX) return 'intermediate';
      // Percentages beside one other base type resolve against it (the deduced percent hint).
      sum += p;
      break;
    }
    base = i;
    sum += p;
  }
  if (sum === 0) return 'number';
  if (sum !== 1) return 'intermediate';
  if (t.hint !== null) return t.powers[0] !== 0 ? 'length-function' : null;
  return (['length', 'angle', 'time', 'frequency', 'resolution', null, 'percent'] as const)[base] ?? null;
}

/** Blink kAddSubtractResult: the category of a sum, a comparison or a stepped-value function; null is kCalcOther. */
function addCategories(a: VCategory, b: VCategory): VCategory | null {
  if (a === 'intermediate' || b === 'intermediate') return null;
  const lengthy = (c: VCategory): boolean => c === 'length' || c === 'percent' || c === 'length-function';
  if (lengthy(a) && lengthy(b)) return a === b ? a : 'length-function';
  return a === b ? a : null;
}

const NAMES: { readonly [c in VCategory]: string } = {
  number: 'a number', length: 'a length', percent: 'a percentage', 'length-function': 'a length with a percentage', intermediate: 'a product of units',
  angle: 'an angle', time: 'a time', frequency: 'a frequency', resolution: 'a resolution',
};

const isRelativeLength = (unit: string): boolean => CANONICAL.get(unit) !== 'px';
/** Blink CanEagerlySimplify: a literal number, angle, time, frequency or resolution, or an absolute length. */
const eager = (n: VNode): boolean => n.literal !== null && (n.category === 'length' ? !isRelativeLength(n.literal) : n.category !== 'percent' && n.category !== 'length-function' && n.category !== 'intermediate');
const opNode = (category: VCategory): VNode => ({ category, type: null, literal: null });

/** Blink CSSMathExpressionOperation::CreateArithmeticOperationSimplified, as far as the category and the literal-ness of the result. */
function arithmetic(l: VNode, r: VNode, op: 'add' | 'sub' | 'mul' | 'div'): VNode {
  const lt = typeOf(l);
  const rt = typeOf(r);
  const type = op === 'add' || op === 'sub' ? addTypes(lt, rt) : multiplyTypes(lt, op === 'mul' ? rt : negateType(rt));
  const category = type === null ? null : categoryOfType(type);
  if (type === null || category === null) {
    const verb = op === 'add' ? 'adds' : op === 'sub' ? 'subtracts' : op === 'mul' ? 'multiplies' : 'divides';
    return invalid(`it ${verb} ${NAMES[l.category]} and ${NAMES[r.category]}, which have no common type (css-values-4 §10.9)`);
  }
  // CanArithmeticOperationBeSimplified, then the literal folds; anything else is an operation.
  const literals = l.literal !== null && r.literal !== null && !((op === 'mul' || op === 'div') && l.category !== 'number' && r.category !== 'number') && category !== 'intermediate';
  if (literals) {
    if (l.category === 'number' && r.category === 'number') return { category, type: null, literal: '' };
    if ((op === 'add' || op === 'sub') && l.category === r.category && BLINK_DOUBLE_VALUED.has(l.literal as string)) {
      if (l.literal === r.literal) return { category, type: null, literal: l.literal };
      const canonical = CANONICAL.get(l.literal as string);
      if (canonical !== undefined && canonical === CANONICAL.get(r.literal as string)) return { category, type: null, literal: canonical };
    }
    if (op === 'mul' || op === 'div') {
      const other = r.category === 'number' ? l : l.category === 'number' && op === 'mul' ? r : null;
      if (other !== null && BLINK_DOUBLE_VALUED.has(other.literal as string)) return { category, type: null, literal: other.literal };
    }
  }
  return { category, type, literal: null };
}

function validityComparison(args: readonly VNode[], what: string): VCategory {
  let c: VCategory | null = (args[0] as VNode).category;
  for (const a of args.slice(1)) {
    c = addCategories(c, a.category);
    if (c === null) return invalid(`${what} mixes arguments of different types (css-values-4 §10.9)`);
  }
  if (c === 'intermediate') return invalid(`${what} takes a product of units, which has no valid type there`);
  return c;
}
const eagerLiteral = (args: readonly VNode[], category: VCategory): string | null => (args.every(eager) ? (CANONICAL_OF_CATEGORY[category] ?? null) : null);

const ROUNDING_STRATEGIES: ReadonlySet<string> = new Set(['nearest', 'up', 'down', 'to-zero']);
const CONSTANTS: ReadonlySet<string> = new Set(['e', 'pi', 'infinity', '-infinity', 'nan']);
/** css-values-4 §10.1: the deepest nesting Blink parses (kMaxExpressionDepth). */
const MAX_VALIDITY_DEPTH = 100;

/** Blink CSSMathExpressionNodeParser at 145.0.7632.6, reduced to types: what it accepts and what each node's category is. */
class ValidityParser {
  private i = 0;
  private readonly toks: readonly Token[];
  constructor(toks: readonly Token[]) {
    this.toks = toks;
  }
  private peek(): Token | undefined {
    return this.toks[this.i];
  }
  private skipWs(): boolean {
    let seen = false;
    while (this.peek()?.k === 'ws') {
      this.i++;
      seen = true;
    }
    return seen;
  }
  atEnd(): boolean {
    this.skipWs();
    return this.i >= this.toks.length;
  }
  private syntax(): never {
    return invalid('it does not parse as a css-values-4 calculation');
  }
  /** The arguments up to the closing parenthesis, each an expression (ParseValueExpression), between min and max of them. */
  private args(depth: number, min: number, max: number, name: string): VNode[] {
    const out: VNode[] = [];
    this.skipWs();
    while (this.peek()?.k !== 'close' && out.length < max) {
      if (out.length > 0) {
        if (this.peek()?.k !== 'comma') return this.syntax();
        this.i++;
        this.skipWs();
      }
      out.push(this.expression(depth));
      this.skipWs();
    }
    if (this.peek()?.k !== 'close') return out.length >= max ? invalid(`${name}() takes at most ${max} argument${max === 1 ? '' : 's'}`) : this.syntax();
    this.i++;
    if (out.length < min) return invalid(`${name}() takes at least ${min} argument${min === 1 ? '' : 's'}`);
    return out;
  }
  /** ParseMathFunction: the function's arguments, checked and typed as its Create* function does. */
  function(name: string, depth: number): VNode {
    if (SUBSTITUTION_FUNCTIONS.has(name) || UNMODELLED_FUNCTIONS.has(name)) return undetermined();
    if (!BLINK_MATH_FUNCTIONS.has(name)) return invalid(`${name}() is not a math function`);
    if (name === 'sibling-index' || name === 'sibling-count') {
      this.skipWs();
      if (this.peek()?.k !== 'close') return invalid(`${name}() takes no arguments`);
      this.i++;
      return opNode('number');
    }
    switch (name) {
      case 'calc':
      case '-webkit-calc':
        return (this.args(depth, 1, 1, name)[0] as VNode);
      case 'min':
      case 'max':
      case 'clamp': {
        const args = name === 'clamp' ? this.args(depth, 3, 3, name) : this.args(depth, 1, Infinity, name);
        const c = validityComparison(args, `${name}()`);
        if (args.length === 1) return args[0] as VNode;
        return { category: c, type: null, literal: eagerLiteral(args, c) };
      }
      case 'sin':
      case 'cos':
      case 'tan':
      case 'asin':
      case 'acos':
      case 'atan': {
        const [a] = this.args(depth, 1, 1, name) as [VNode];
        const numberOut = name === 'sin' || name === 'cos' || name === 'tan';
        if (numberOut ? a.category !== 'number' && a.category !== 'angle' : a.category !== 'number') return invalid(`${name}() takes ${numberOut ? 'a number or an angle' : 'a number'}, not ${NAMES[a.category]}`);
        const c: VCategory = numberOut ? 'number' : 'angle';
        return { category: c, type: null, literal: eagerLiteral([a], c) };
      }
      case 'atan2': {
        const args = this.args(depth, 2, 2, name);
        if ((args[0] as VNode).category !== (args[1] as VNode).category) return invalid('atan2() takes two arguments of the same type');
        return { category: 'angle', type: null, literal: eagerLiteral(args, 'angle') };
      }
      case 'pow':
      case 'sqrt':
      case 'hypot':
      case 'log':
      case 'exp':
        return this.exponential(name, depth);
      case 'round':
      case 'mod':
      case 'rem': {
        this.skipWs();
        const t = this.peek();
        if (name === 'round' && t?.k === 'ident' && ROUNDING_STRATEGIES.has(t.name)) {
          this.i++;
          this.skipWs();
          if (this.peek()?.k !== 'comma') return this.syntax();
          this.i++;
        }
        const args = name === 'round' ? this.args(depth, 1, 2, name) : this.args(depth, 2, 2, name);
        if (args.length === 1 && (args[0] as VNode).category !== 'number') return invalid('round() without a step takes a number');
        const step = args.length === 1 ? { category: 'number' as const, type: null, literal: '' } : (args[1] as VNode);
        const c = addCategories((args[0] as VNode).category, step.category);
        if (c === null) return invalid(`${name}() takes a value and a step of the same type`);
        return { category: c, type: null, literal: eagerLiteral([args[0] as VNode, step], c) };
      }
      case 'abs':
      case 'sign': {
        const [a] = this.args(depth, 1, 1, name) as [VNode];
        if (name === 'sign') return { category: 'number', type: null, literal: eager(a) ? '' : null };
        return { category: a.category, type: null, literal: eager(a) ? (CANONICAL_OF_CATEGORY[a.category] ?? null) : null };
      }
      default:
        return undetermined();
    }
  }
  /** CreateExponentialFunction: pow() and log() take numbers, hypot() one type, sqrt() and exp() a number once folded. */
  private exponential(name: 'pow' | 'sqrt' | 'hypot' | 'log' | 'exp', depth: number): VNode {
    const args = name === 'pow' ? this.args(depth, 2, 2, name) : name === 'hypot' ? this.args(depth, 1, MAX_VALIDITY_DEPTH, name) : name === 'log' ? this.args(depth, 1, 2, name) : this.args(depth, 1, 1, name);
    const first = args[0] as VNode;
    if (first.category === 'intermediate') return invalid(`${name}() takes a value with a canonical unit, not a product of units`);
    if (name === 'pow' || name === 'hypot') {
      const c = validityComparison(args, `${name}()`);
      if (name === 'pow' && c !== 'number') return invalid('pow() takes numbers');
      return { category: c, type: null, literal: eagerLiteral(args, c) };
    }
    if (name === 'log') {
      if (first.category !== 'number' || (args[args.length - 1] as VNode).category !== 'number') return invalid('log() takes numbers');
      return { category: 'number', type: null, literal: eagerLiteral(args, 'number') };
    }
    // sqrt() and exp() of a folded literal need a number (ValueAsNumber); otherwise sqrt() keeps its argument's category.
    if (first.category === 'number') return { category: 'number', type: null, literal: eagerLiteral(args, 'number') };
    if (first.literal === null) return undetermined();
    if (eager(first)) return invalid(`${name}() takes a number, not ${NAMES[first.category]}`);
    return opNode(name === 'exp' ? 'number' : first.category);
  }
  /** ParseValueTerm: a nested calculation, a math function or a value; ws reports whether whitespace follows it. */
  private term(depth: number): { node: VNode; ws: boolean } {
    const t = this.peek();
    if (t === undefined) return this.syntax();
    this.i++;
    let node: VNode;
    if (t.k === 'open' || (t.k === 'func' && t.name === 'calc')) {
      this.skipWs();
      node = this.expression(depth);
      this.skipWs();
      if (this.peek()?.k !== 'close') return this.syntax();
      this.i++;
    } else if (t.k === 'func') node = this.function(t.name, depth);
    else if (t.k === 'num') {
      const category: VCategory | undefined = t.unit === '' ? 'number' : t.unit === '%' ? 'percent' : UNIT_CATEGORIES.get(t.unit);
      if (category === undefined) return invalid(`${t.unit} is not a unit a calculation takes`);
      node = { category, type: null, literal: t.unit };
    } else if (t.k === 'ident') {
      if (!CONSTANTS.has(t.name)) return invalid(`${t.name} is not a value in a calculation`);
      node = { category: 'number', type: null, literal: '' };
    } else return this.syntax();
    return { node, ws: this.skipWs() };
  }
  private multiplicative(depth: number): { node: VNode; ws: boolean } {
    let { node, ws } = this.term(depth);
    for (;;) {
      const t = this.peek();
      if (t?.k !== 'delim' || (t.ch !== '*' && t.ch !== '/')) break;
      this.i++;
      this.skipWs();
      const rhs = this.term(depth);
      node = arithmetic(node, rhs.node, t.ch === '*' ? 'mul' : 'div');
      ws = rhs.ws;
    }
    return { node, ws };
  }
  /** ParseValueExpression: depth counts the enclosing expressions, as Blink's State does. */
  expression(depth: number): VNode {
    if (depth + 1 > MAX_VALIDITY_DEPTH) return invalid(`it nests calculations deeper than ${MAX_VALIDITY_DEPTH}, the most Chrome parses`);
    let { node, ws } = this.multiplicative(depth + 1);
    for (;;) {
      const t = this.peek();
      if (t?.k !== 'delim' || (t.ch !== '+' && t.ch !== '-')) break;
      if (!ws) return invalid(`${t.ch} needs white space on both sides (css-values-4 §10.1)`);
      this.i++;
      if (this.peek()?.k !== 'ws') return invalid(`${t.ch} needs white space on both sides (css-values-4 §10.1)`);
      this.skipWs();
      const rhs = this.multiplicative(depth + 1);
      node = arithmetic(node, rhs.node, t.ch === '+' ? 'add' : 'sub');
      ws = rhs.ws;
    }
    return node;
  }
}

const GRAMMAR_ACCEPTS: { readonly [g in MathGrammar]: readonly VCategory[] } = {
  length: ['length'],
  'length-percentage': ['length', 'percent', 'length-function'],
  number: ['number'],
  'number-or-length-percentage': ['number', 'length', 'percent', 'length-function'],
};
const GRAMMAR_NAMES: { readonly [g in MathGrammar]: string } = {
  length: 'a length without a percentage (a <line-width> takes no percentage, css-backgrounds-3 §3.3)',
  'length-percentage': 'a length or a percentage',
  number: 'a number',
  'number-or-length-percentage': 'a number, a length or a percentage',
};

/**
 * Whether Chrome's parser rejects a math function as a value of a grammar (Blink CSSMathExpressionNodeParser and the property's
 * consumer at 145.0.7632.6): the reason it does, or null when Chrome accepts it or this check cannot tell (a substitution
 * function, an unmodelled math function such as anchor(), an escape, a comment left open). text is the function's source text.
 */
export function mathInvalidity(text: string, grammar: MathGrammar): string | null {
  const source = text.trim();
  // null: a code point the tokenizer does not model, more than MAX_MATH_TOKENS tokens, or an unclosed comment or block (which Chrome closes at the end).
  const toks = tokenize(source, true);
  if (toks === null || toks.filter((t) => t.k === 'open' || t.k === 'func').length !== toks.filter((t) => t.k === 'close').length) return null;
  const head = toks[0];
  if (head === undefined || head.k !== 'func' || !BLINK_MATH_FUNCTIONS.has(head.name)) return null;
  try {
    const p = new ValidityParser(toks.slice(1));
    const node = p.function(head.name, 0);
    if (!p.atEnd()) return 'it does not parse as a css-values-4 calculation';
    if (!GRAMMAR_ACCEPTS[grammar].includes(node.category)) return `it resolves to ${NAMES[node.category]}, and the property takes ${GRAMMAR_NAMES[grammar]}`;
    return null;
  } catch (e) {
    if (e instanceof MathInvalid) return e.message;
    if (e instanceof MathUndetermined) return null;
    throw e;
  }
}

// ---------------------------------------------------------------- lowering to the engine

/** The font sizes em and rem read, in px: the element's specified size and the root's, at text scale 1. */
export type MathFonts = { readonly em: number; readonly rem: number };

/** Whether a calculation reads the element's font size (em) or the root's (rem). */
export function fontUnitsIn(n: MathNode): { readonly em: boolean; readonly rem: boolean } {
  if (isLit(n)) return { em: n.unit === 'em', rem: n.unit === 'rem' };
  const parts = n.args.map(fontUnitsIn);
  return { em: parts.some((x) => x.em), rem: parts.some((x) => x.rem) };
}

function lowerLeaf(n: MathLiteral, fonts: MathFonts): CalcExpr {
  if (n.unit === '') return n.inverseOf === null ? { kind: 'number', value: n.value } : { kind: 'invert', term: { kind: 'number', value: n.inverseOf } };
  if (n.unit === '%') return { kind: 'percent', value: n.value };
  if (n.unit === 'em') return { kind: 'em', value: n.value, fontSize: { kind: 'px', value: fonts.em } };
  if (n.unit === 'rem') return { kind: 'em', value: n.value, fontSize: { kind: 'px', value: fonts.rem } };
  if (n.unit === 'vw' || n.unit === 'vi') return { kind: 'viewport', value: n.value, axis: 'width', size: 'large' };
  if (n.unit === 'vh' || n.unit === 'vb') return { kind: 'viewport', value: n.value, axis: 'height', size: 'large' };
  if (n.unit === 'vmin') return { kind: 'viewport', value: n.value, axis: 'min', size: 'large' };
  if (n.unit === 'vmax') return { kind: 'viewport', value: n.value, axis: 'max', size: 'large' };
  // An absolute unit: ZoomedComputedPixels multiplies by its px ratio, then by the zoom.
  return { kind: 'px', value: n.value * (pxPer(n.unit) as number) };
}

/** A subtracted term: a negated leaf (exact), or the term times -1 (exact in float and double alike). */
function negate(e: CalcExpr): CalcExpr {
  switch (e.kind) {
    case 'px':
    case 'percent':
    case 'number':
    case 'viewport':
      return { ...e, value: -e.value };
    case 'em':
      return { kind: 'em', value: -e.value, fontSize: e.fontSize };
    default:
      return { kind: 'product', terms: [e, { kind: 'number', value: -1 }] };
  }
}

/** Compiler fault sumOrderSwapped reverses the terms of every sum; dropExplicitZeroPercent removes 0% terms. */
export type MathFaults = { readonly sumOrderSwapped: boolean; readonly dropExplicitZeroPercent: boolean };

export const NO_MATH_FAULTS: MathFaults = { sumOrderSwapped: false, dropExplicitZeroPercent: false };

/** The planted compiler faults, applied to a lowered calculation: every sum reversed, every explicit 0% term dropped. */
function planted(e: CalcExpr, faults: MathFaults): CalcExpr {
  const sub = (x: CalcExpr): CalcExpr => planted(x, faults);
  switch (e.kind) {
    case 'sum': {
      let terms = e.terms.map(sub);
      if (faults.dropExplicitZeroPercent) terms = terms.filter((t) => !(t.kind === 'percent' && t.value === 0));
      if (faults.sumOrderSwapped) terms = [...terms].reverse();
      return terms.length === 1 ? (terms[0] as CalcExpr) : { kind: 'sum', terms };
    }
    case 'product':
    case 'min':
    case 'max':
      return { kind: e.kind, terms: e.terms.map(sub) } as CalcExpr;
    case 'invert':
      return { kind: 'invert', term: sub(e.term) };
    case 'clamp':
      return { kind: 'clamp', min: sub(e.min), value: sub(e.value), max: sub(e.max) };
    case 'em':
      return { kind: 'em', value: e.value, fontSize: sub(e.fontSize) };
    default:
      return e;
  }
}

export function lowerMathNode(n: MathNode, fonts: MathFonts, faults: MathFaults = NO_MATH_FAULTS): CalcExpr {
  const e = lowerPlain(n, fonts);
  return faults.sumOrderSwapped || faults.dropExplicitZeroPercent ? planted(e, faults) : e;
}

function lowerPlain(n: MathNode, fonts: MathFonts): CalcExpr {
  if (isLit(n)) return lowerLeaf(n, fonts);
  const args = n.args.map((a) => lowerPlain(a, fonts));
  switch (n.op) {
    case 'add':
    case 'sub': {
      const left = args[0] as CalcExpr;
      const right = n.op === 'sub' ? negate(args[1] as CalcExpr) : (args[1] as CalcExpr);
      const leftTerms = left.kind === 'sum' ? [...left.terms] : [left];
      return { kind: 'sum', terms: [...leftTerms, right] };
    }
    case 'mul':
      return { kind: 'product', terms: args };
    case 'invert':
      return { kind: 'invert', term: args[0] as CalcExpr };
    case 'min':
      return { kind: 'min', terms: args };
    case 'max':
      return { kind: 'max', terms: args };
    case 'clamp':
      return { kind: 'clamp', min: args[0] as CalcExpr, value: args[1] as CalcExpr, max: args[2] as CalcExpr };
  }
}

/** A math function in a length property, for the engine. */
export function lowerLengthCalc(n: MathNode, fonts: MathFonts, range: LengthCalc['range'], faults: MathFaults = NO_MATH_FAULTS): LengthCalc {
  return { kind: 'calc', expr: lowerMathNode(n, fonts, faults), range };
}

/** A constant number calculation, folded in double (Blink CSSMathFunctionValue::ComputeNumber). */
export function foldNumber(n: MathNode): number {
  if (isLit(n)) return n.value;
  const values = n.args.map(foldNumber);
  return evaluateOperator(values, n.op);
}

// ---------------------------------------------------------------- serialization (css-values-4 §10.12, Blink CustomCSSText)

/** How a number is written: Blink's six significant digits. Rounding lives in css/color.ts and the engine, so callers pass it. */
export type NumberFormat = (x: number) => string;

type Term = { readonly op: MathOperator; readonly node: MathNode };

/** Blink CollectSumOrProductInOrder: numbers, then percentages, then dimensions by unit, then everything else. */
function inOrder(root: MathOp): Term[] {
  const children = traverse(root, root.op === 'mul' ? 'mul' : 'add');
  const numeric = new Map<string, Term[]>();
  const complex: Term[] = [];
  for (const c of children) {
    if (isNumericWithDouble(c.node)) {
      const list = numeric.get(c.node.unit) ?? [];
      list.push(c);
      numeric.set(c.node.unit, list);
    } else complex.push(c);
  }
  const out: Term[] = [];
  for (const u of ['', '%']) {
    out.push(...(numeric.get(u) ?? []));
    numeric.delete(u);
  }
  for (const u of [...numeric.keys()].sort()) out.push(...(numeric.get(u) as Term[]));
  return [...out, ...complex];
}

function nodeText(n: MathNode, fmt: NumberFormat): string {
  if (isLit(n)) return `${fmt(n.value)}${n.unit}`;
  if (n.op === 'min' || n.op === 'max' || n.op === 'clamp') return `${n.op}(${n.args.map((a) => topText(a, fmt)).join(', ')})`;
  if (n.op === 'invert') return `(1 / ${nodeText(n.args[0] as MathNode, fmt)})`;
  const terms = inOrder(n);
  const first = terms[0] as Term;
  let out = `(${first.op === 'sub' && isNumericWithDouble(first.node) ? `${fmt(-first.node.value)}${first.node.unit}` : nodeText(first.node, fmt)}`;
  for (const t of terms.slice(1)) {
    let op = t.op;
    let node = t.node;
    if (isNumericWithDouble(node) && (op === 'add' || op === 'sub') && node.value < 0) {
      op = op === 'add' ? 'sub' : 'add';
      node = lit(-node.value, node.unit);
    }
    out += ` ${op === 'add' ? '+' : op === 'sub' ? '-' : '*'} ${nodeText(node, fmt)}`;
  }
  return `${out})`;
}

function topText(n: MathNode, fmt: NumberFormat): string {
  const t = nodeText(n, fmt);
  return !isLit(n) && t.startsWith('(') ? t.slice(1, -1) : t;
}

/** A math function as Chrome serializes it (CSSMathFunctionValue::CustomCSSText). */
export function serializeMath(n: MathNode, fmt: NumberFormat): string {
  if (!isLit(n) && (n.op === 'min' || n.op === 'max' || n.op === 'clamp')) return nodeText(n, fmt);
  const t = nodeText(n, fmt);
  return t.startsWith('(') ? `calc${t}` : `calc(${t})`;
}

/**
 * The math node Chrome rebuilds from a computed CalculationValue at zoom 1 (CSSMathExpressionNode::Create), from the engine's
 * resolved CalcExpr; getComputedStyle serializes it for properties whose resolved value is the computed value (min-width,
 * max-width, min-height, max-height, flex-basis).
 */
export function computedMathNode(e: CalcExpr): MathNode {
  switch (e.kind) {
    case 'pixels-and-percent': {
      if (!e.explicitPixels) return lit(e.percent, '%');
      if (!e.explicitPercent) return lit(e.pixels, 'px');
      const neg = e.pixels < 0;
      return { t: 'op', op: neg ? 'sub' : 'add', args: [lit(e.percent, '%'), lit(neg ? -e.pixels : e.pixels, 'px')], category: 'length-percent', nested: false };
    }
    case 'number':
      return lit(e.value, '');
    case 'px':
      return lit(e.value, 'px');
    case 'percent':
      return lit(e.value, '%');
    case 'sum': {
      let acc = computedMathNode(e.terms[0] as CalcExpr);
      for (const t of e.terms.slice(1)) acc = { t: 'op', op: 'add', args: [acc, computedMathNode(t)], category: 'length-percent', nested: false };
      return acc;
    }
    case 'product':
      return { t: 'op', op: 'mul', args: e.terms.map(computedMathNode), category: 'length-percent', nested: false };
    case 'invert':
      return createInvert(computedMathNode(e.term));
    case 'min':
    case 'max':
      return createComparison(e.terms.map(computedMathNode), e.kind);
    case 'clamp':
      return createComparison([computedMathNode(e.min), computedMathNode(e.value), computedMathNode(e.max)], 'clamp');
    case 'viewport':
    case 'em':
    case 'rem':
    case 'font-metric':
    case 'lh':
    case 'env':
    case 'font-percent':
    case 'font-calc':
      return refuse(`a ${e.kind} leaf has no computed form`);
  }
}
