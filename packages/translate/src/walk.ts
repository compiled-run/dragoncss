// IR walks shared by the emitters.
import type { Expr, Stmt } from './ir.ts';

/** Names of locals assigned anywhere in stmts, nested closures included (parameters are immutable in Swift and Kotlin). */
export function assignedLocals(stmts: readonly Stmt[]): Set<string> {
  const out = new Set<string>();
  const visit = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const y of x) visit(y);
      return;
    }
    if (typeof x !== 'object' || x === null) return;
    const o = x as Record<string, unknown>;
    if (o['s'] === 'assign') {
      const t = o['target'] as Expr;
      if (t.e === 'local') out.add(t.name);
    }
    if (o['e'] === 'postInc') {
      const t = o['target'] as Expr;
      if (t.e === 'local') out.add(t.name);
    }
    for (const [k, v] of Object.entries(o)) if (k !== 'ty') visit(v);
  };
  visit(stmts);
  return out;
}

/** Whether control never falls off the end of stmts, as Swift's and Kotlin's flow analysis also proves. */
export function terminates(stmts: readonly Stmt[]): boolean {
  const last = stmts[stmts.length - 1];
  if (last === undefined) return false;
  switch (last.s) {
    case 'return':
    case 'throw':
      return true;
    case 'expr':
      return last.e.ty.k === 'never';
    case 'if':
      return last.else !== null && terminates(last.then) && terminates(last.else);
    case 'try':
      return terminates(last.body) && terminates(last.handler);
    case 'switch':
      return last.dflt !== null && terminates(last.dflt) && last.cases.every((c) => terminates(c.body));
    case 'for':
      return last.cond === null && !breaks(last.body);
    case 'while':
      return last.cond.e === 'bool' && last.cond.value && !breaks(last.body);
    default:
      return false;
  }
}

/** Whether stmts break out of the loop that directly contains them. */
function breaks(stmts: readonly Stmt[]): boolean {
  return stmts.some((s) => {
    switch (s.s) {
      case 'break':
        return true;
      case 'if':
        return breaks(s.then) || (s.else !== null && breaks(s.else));
      case 'try':
        return breaks(s.body) || breaks(s.handler);
      case 'switch':
        return s.cases.some((c) => breaks(c.body)) || (s.dflt !== null && breaks(s.dflt));
      default:
        return false;
    }
  });
}
