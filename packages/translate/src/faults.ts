// Planted translator faults (native-strategy.md section 1.9). Each one is defined for both emitters: prelude faults swap one
// audited helper for the platform shortcut it replaces, IR faults change the translated engine the same way for every target.
import type { Expr, FuncDecl, Program, Stmt } from './ir.ts';
import { NUM } from './ir.ts';

export type PreludeFault = 'platform-round' | 'unordered-map' | 'unstable-sort' | 'character-iteration' | 'canonical-equality';
export type IrFault = 'missing-fround' | 'int32-cumulative';
export type Fault = PreludeFault | IrFault;

export type FaultSpec = { readonly id: Fault; readonly kind: 'prelude' | 'ir'; readonly swift: string; readonly kotlin: string };

export const FAULTS: readonly FaultSpec[] = [
  // The inner fround of fromCssPx is provably redundant (scaling by 64 commutes with float rounding; notes/T005-p1-translator.md),
  // so the missing inner fround is planted in percentOf, whose inner fround of the percentage changes results.
  { id: 'missing-fround', kind: 'ir', swift: 'percentOf without the inner Double(Float(percent))', kotlin: 'percentOf without the inner percent.toFloat().toDouble()' },
  { id: 'platform-round', kind: 'prelude', swift: 'Math.round as Swift x.rounded() (halves away from zero)', kotlin: 'Math.round as kotlin.math.round(x) (halves to even)' },
  { id: 'unordered-map', kind: 'prelude', swift: 'Map as an unordered Swift Dictionary', kotlin: 'Map as an unordered java.util.HashMap' },
  { id: 'unstable-sort', kind: 'prelude', swift: 'Array.sort as an unstable selection sort', kotlin: 'Array.sort as an unstable selection sort' },
  { id: 'character-iteration', kind: 'prelude', swift: 'for...of over Swift Characters (grapheme clusters) instead of code points', kotlin: 'for...of over Kotlin Chars (UTF-16 units) instead of code points' },
  { id: 'canonical-equality', kind: 'prelude', swift: 'string equality and hashing by Swift String (canonical equivalence)', kotlin: 'string equality and hashing after NFC normalization (canonical equivalence)' },
  { id: 'int32-cumulative', kind: 'ir', swift: 'cumulativeShareRounded numerator narrowed to Int32', kotlin: 'cumulativeShareRounded numerator narrowed to Int' },
];

export function preludeFault(f: Fault | null): PreludeFault | null {
  return f !== null && FAULTS.some((x) => x.id === f && x.kind === 'prelude') ? (f as PreludeFault) : null;
}

/** Applies an IR fault; prelude faults leave the IR unchanged. */
export function plantIr(p: Program, f: Fault | null): Program {
  if (f === 'missing-fround') return mapFunc(p, 'units_percentOf', (e) => (e.e === 'builtin' && e.op === 'fround' && e.args[0]?.e === 'local' ? e.args[0] : null));
  if (f === 'int32-cumulative') {
    return mapFunc(p, 'units_cumulativeShareRounded', (e) => (e.e === 'bin' && e.op === '/' ? { ...e, l: { ty: NUM, e: 'builtin', op: 'plantInt32', args: [e.l] } } : null));
  }
  return p;
}

/** Rewrites the first expression in function name for which f returns a replacement. */
function mapFunc(p: Program, name: string, f: (e: Expr) => Expr | null): Program {
  let done = false;
  const ex = (e: Expr): Expr => {
    if (done) return e;
    const r = f(e);
    if (r !== null) {
      done = true;
      return r;
    }
    const out: Record<string, unknown> = { ...e };
    for (const [k, v] of Object.entries(e)) {
      if (k === 'ty') continue;
      if (Array.isArray(v)) out[k] = v.map((x: unknown) => (isExpr(x) ? ex(x) : x));
      else if (isExpr(v)) out[k] = ex(v);
    }
    return out as Expr;
  };
  const st = (s: Stmt): Stmt => {
    const out: Record<string, unknown> = { ...s };
    for (const [k, v] of Object.entries(s)) {
      if (Array.isArray(v)) out[k] = v.map((x: unknown) => (isStmt(x) ? st(x) : isExpr(x) ? ex(x) : x));
      else if (isExpr(v)) out[k] = ex(v);
    }
    return out as Stmt;
  };
  const decls = p.decls.map((d) => (d.kind === 'func' && d.name === name ? ({ ...d, body: d.body.map(st) } as FuncDecl) : d));
  if (!done) throw new Error(`planted fault found nothing to change in ${name}`);
  return { ...p, decls };
}

function isExpr(x: unknown): x is Expr {
  return typeof x === 'object' && x !== null && 'e' in x && 'ty' in x;
}

function isStmt(x: unknown): x is Stmt {
  return typeof x === 'object' && x !== null && 's' in x;
}
