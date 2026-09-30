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
      const unit = node.unit;
      const single = children.filter((c) => isLit(c.node) && c.node.unit === unit).length === 1;
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

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^-?[a-zA-Z_][a-zA-Z0-9_-]*/;

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      while (i < text.length && /\s/.test(text[i] as string)) i++;
      out.push({ k: 'ws' });
      continue;
    }
    const num = NUMBER.exec(rest);
    const prevIsValue = out.length > 0 && ['num', 'close', 'ident'].includes((out[out.length - 1] as Token).k);
    if (num !== null && !((ch === '+' || ch === '-') && prevIsValue)) {
      i += num[0].length;
      const after = text.slice(i);
      if (after.startsWith('%')) {
        i++;
        out.push({ k: 'num', value: Number(num[0]), unit: '%' });
      } else {
        const u = /^[a-zA-Z]+/.exec(after);
        if (u !== null) i += u[0].length;
        out.push({ k: 'num', value: Number(num[0]), unit: u === null ? '' : u[0].toLowerCase() });
      }
      continue;
    }
    const id = IDENT.exec(rest);
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
  private readonly percentAllowed: boolean;
  constructor(toks: Token[], percentAllowed: boolean) {
    this.toks = toks;
    this.percentAllowed = percentAllowed;
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
      if (!this.percentAllowed) return refuse('a percentage in this property needs percentage gaps, which are not supported yet', 'Use a length without a percentage.');
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

/** What a property takes: a length (with or without a percentage) or a number (css-values-4 §10.9 type checking). */
export type MathContext = { readonly type: 'length'; readonly percent: boolean } | { readonly type: 'number' };

const NUMBER_PROPERTIES: ReadonlySet<string> = new Set(['flex-grow', 'flex-shrink', 'order']);
const TEXT_PROPERTIES: ReadonlySet<string> = new Set(['font-size', 'line-height', 'font']);
/** Border widths take no percentage (css-backgrounds-3 §3.3); V1 refuses a percentage in gaps, as it does outside calc(). */
const NO_PERCENT = /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-width)?|gap|row-gap|column-gap|outline(-width)?)$/;

/** The calculation a property takes, or the reason V1 refuses every calculation in it. */
export function mathContextFor(property: string): MathContext | { readonly refused: string } {
  if (NUMBER_PROPERTIES.has(property)) return { type: 'number' };
  if (TEXT_PROPERTIES.has(property)) return { refused: `a calculation in ${property} reaches the font and line metrics, which needs the value-model package V2` };
  return { type: 'length', percent: !NO_PERCENT.test(property) };
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
  try {
    const toks = tokenize(text.trim());
    const head = toks[0];
    if (head === undefined || head.k !== 'func') return refuse('it does not parse as a css-values-4 calculation');
    const p = new Parser(toks.slice(1), context.type === 'length' && context.percent);
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
  if (n.unit === 'vw' || n.unit === 'vi') return { kind: 'viewport', value: n.value, axis: 'width' };
  if (n.unit === 'vh' || n.unit === 'vb') return { kind: 'viewport', value: n.value, axis: 'height' };
  if (n.unit === 'vmin') return { kind: 'viewport', value: n.value, axis: 'min' };
  if (n.unit === 'vmax') return { kind: 'viewport', value: n.value, axis: 'max' };
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
      return refuse(`a ${e.kind} leaf has no computed form`);
  }
}
