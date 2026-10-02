// Layout-time calculations (css-values-4 §10.10): a LengthCalc in Blink's CalculationExpression shape, as the environment pass
// (environment.ts) leaves it, evaluated in float against a percentage basis (Blink CalculationValue::Evaluate at 145.0.7632.6,
// platform/geometry/calculation_value.cc and calculation_expression_node.cc). Arithmetic is units.ts's.
import type { CalcExpr, LengthCalc } from './input.ts';
import type { EngineFaults } from './block.ts';
import type { LU } from './units.ts';
import {
  calcToLu,
  doubleAdd,
  doubleDiv,
  doubleInvert,
  doubleMul,
  float32,
  floatAdd,
  floatDiv,
  floatInvert,
  floatMax,
  floatMin,
  floatMul,
  pixelsAndPercentAt,
  pixelsAndPercentDouble,
  pixelsAndPercentPlainOrder,
  toFloat,
} from './units.ts';

/** Blink CalculationExpressionNode::HasPercent: a pixels-and-percent leaf with an explicit percentage, 0% included. */
export function calcHasPercent(e: CalcExpr): boolean {
  switch (e.kind) {
    case 'percent':
      return true;
    case 'pixels-and-percent':
      return e.explicitPercent;
    case 'px':
    case 'number':
    case 'viewport':
    case 'em':
    case 'rem':
    case 'font-metric':
    case 'lh':
    case 'env':
    case 'font-percent':
    case 'font-calc':
      return false;
    case 'invert':
      return calcHasPercent(e.term);
    case 'clamp':
      return calcHasPercent(e.min) || calcHasPercent(e.value) || calcHasPercent(e.max);
    case 'sum':
    case 'product':
    case 'min':
    case 'max':
      for (const t of e.terms) if (calcHasPercent(t)) return true;
      return false;
  }
}

/** A term that is the inverse of a number: a division the compiler kept as a product (planted fault divideDirect divides instead). */
function invertedNumber(e: CalcExpr): number | null {
  if (e.kind === 'invert' && e.term.kind === 'number') return e.term.value;
  return null;
}

function add(a: number, b: number, faults: EngineFaults): number {
  return faults.calcDoubleEval ? doubleAdd(a, b) : floatAdd(a, b);
}

function mul(a: number, b: number, faults: EngineFaults): number {
  return faults.calcDoubleEval ? doubleMul(a, b) : floatMul(a, b);
}

/** Blink CalculationExpressionNode::Evaluate(max_value) in float; planted fault calcDoubleEval keeps every step in double. */
export function evaluateCalc(e: CalcExpr, maxValue: number, faults: EngineFaults): number {
  switch (e.kind) {
    case 'pixels-and-percent':
      if (faults.calcDoubleEval) return pixelsAndPercentDouble(e.pixels, e.percent, maxValue);
      if (faults.calcPercentPlainOrder) return pixelsAndPercentPlainOrder(e.pixels, e.percent, maxValue);
      return pixelsAndPercentAt(e.pixels, e.percent, maxValue);
    case 'number':
      return float32(e.value);
    case 'px':
      return pixelsAndPercentAt(float32(e.value), 0, maxValue);
    case 'percent':
      return pixelsAndPercentAt(0, float32(e.value), maxValue);
    case 'viewport':
    case 'em':
    case 'rem':
    case 'font-metric':
    case 'lh':
    case 'env':
    case 'font-percent':
    case 'font-calc':
      throw new Error(`a ${e.kind} leaf reached layout; the environment pass resolves it`);
    case 'sum': {
      let total = evaluateCalc(e.terms[0] as CalcExpr, maxValue, faults);
      for (let i = 1; i < e.terms.length; i++) total = add(total, evaluateCalc(e.terms[i] as CalcExpr, maxValue, faults), faults);
      return total;
    }
    case 'product': {
      let total = evaluateCalc(e.terms[0] as CalcExpr, maxValue, faults);
      for (let i = 1; i < e.terms.length; i++) {
        const t = e.terms[i] as CalcExpr;
        const divisor = invertedNumber(t);
        if (faults.divideDirect && divisor !== null) total = faults.calcDoubleEval ? doubleDiv(total, divisor) : floatDiv(total, float32(divisor));
        else total = mul(total, evaluateCalc(t, maxValue, faults), faults);
      }
      return total;
    }
    case 'invert': {
      const d = evaluateCalc(e.term, maxValue, faults);
      return faults.calcDoubleEval ? doubleInvert(d) : floatInvert(d);
    }
    case 'min': {
      let m = evaluateCalc(e.terms[0] as CalcExpr, maxValue, faults);
      for (const t of e.terms) m = floatMin(m, evaluateCalc(t, maxValue, faults));
      return m;
    }
    case 'max': {
      let m = evaluateCalc(e.terms[0] as CalcExpr, maxValue, faults);
      for (const t of e.terms) m = floatMax(m, evaluateCalc(t, maxValue, faults));
      return m;
    }
    case 'clamp': {
      const lo = evaluateCalc(e.min, maxValue, faults);
      const v = evaluateCalc(e.value, maxValue, faults);
      const hi = evaluateCalc(e.max, maxValue, faults);
      // Planted fault clampMaxWins: min(max(MIN, VAL), MAX), so MAX wins when MIN > MAX.
      if (faults.clampMaxWins) return floatMin(floatMax(lo, v), hi);
      return floatMax(lo, floatMin(v, hi));
    }
  }
}

/** Blink MinimumValueForLength for a calculated Length: LayoutUnit(NonNanCalculatedValue(float(basis))). */
export function resolveCalc(c: LengthCalc, basis: LU, faults: EngineFaults): LU {
  return calcToLu(evaluateCalc(c.expr, toFloat(basis), faults), c.range === 'non-negative' && !faults.calcNoNonNegClamp);
}
