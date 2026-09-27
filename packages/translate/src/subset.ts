// The subset checker (native-strategy.md section 1.2): every engine file except validate.ts must use only constructs the
// translator can translate exactly. Syntactic bans are checked here; everything else is checked by lowering every top-level
// declaration of every file, so the checker and the translator cannot disagree.
import { relative } from 'node:path';
import ts from 'typescript';
import { engineFiles, ROOT } from './generate.ts';
import type { Violation } from './lower.ts';
import { cmp, createProgram, Lowerer } from './lower.ts';

const BANNED_GLOBALS = new Set(['Date', 'JSON', 'globalThis', 'process', 'performance', 'RegExp', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect', 'Object', 'Array', 'String', 'Boolean', 'BigInt', 'eval', 'parseInt', 'parseFloat', 'console']);

const BANNED_BINARY: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.QuestionQuestionToken, '??'],
  [ts.SyntaxKind.QuestionQuestionEqualsToken, '??='],
  [ts.SyntaxKind.AmpersandToken, 'bitwise &'],
  [ts.SyntaxKind.BarToken, 'bitwise |'],
  [ts.SyntaxKind.CaretToken, 'bitwise ^'],
  [ts.SyntaxKind.LessThanLessThanToken, '<<'],
  [ts.SyntaxKind.GreaterThanGreaterThanToken, '>>'],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, '>>>'],
  [ts.SyntaxKind.AmpersandEqualsToken, '&='],
  [ts.SyntaxKind.BarEqualsToken, '|='],
  [ts.SyntaxKind.CaretEqualsToken, '^='],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, '<<='],
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, '>>='],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, '>>>='],
  [ts.SyntaxKind.InKeyword, 'in'],
  [ts.SyntaxKind.EqualsEqualsToken, '== (use ===)'],
  [ts.SyntaxKind.ExclamationEqualsToken, '!= (use !==)'],
  [ts.SyntaxKind.PercentToken, '%'],
  [ts.SyntaxKind.PercentEqualsToken, '%='],
  [ts.SyntaxKind.AsteriskAsteriskToken, '**'],
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken, '**='],
  [ts.SyntaxKind.CommaToken, 'the comma operator'],
  [ts.SyntaxKind.BarBarEqualsToken, '||='],
  [ts.SyntaxKind.AmpersandAmpersandEqualsToken, '&&='],
]);

function syntactic(sf: ts.SourceFile, program: ts.Program): Violation[] {
  const out: Violation[] = [];
  const checker = program.getTypeChecker();
  const file = relative(ROOT, sf.fileName);
  const at = (n: ts.Node, message: string): void => {
    out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, message });
  };
  const visit = (n: ts.Node): void => {
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || ts.isCallExpression(n)) && n.questionDotToken !== undefined) at(n, '?. is outside the subset');
    if ((ts.isPropertySignature(n) || ts.isParameter(n) || ts.isPropertyDeclaration(n) || ts.isMethodSignature(n) || ts.isMethodDeclaration(n)) && n.questionToken !== undefined) at(n, 'optional ?: members and parameters are outside the subset');
    if (ts.isBinaryExpression(n)) {
      const b = BANNED_BINARY.get(n.operatorToken.kind);
      if (b !== undefined) at(n, `${b} is outside the subset`);
    }
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.TildeToken) at(n, 'bitwise ~ is outside the subset');
    if (ts.isRegularExpressionLiteral(n)) at(n, 'RegExp is outside the subset');
    if (ts.isDeleteExpression(n)) at(n, 'delete is outside the subset');
    if (ts.isTypeOfExpression(n)) at(n, 'typeof is outside the subset outside validate.ts');
    if (ts.isVoidExpression(n)) at(n, 'void is outside the subset');
    if (ts.isGetAccessor(n) || ts.isSetAccessor(n)) at(n, 'getters and setters are outside the subset');
    if (n.kind === ts.SyntaxKind.AnyKeyword) at(n, 'any is outside the subset');
    if (n.kind === ts.SyntaxKind.UnknownKeyword) at(n, 'unknown is outside the subset outside validate.ts');
    if (ts.isVariableDeclarationList(n) && !(n.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) at(n, 'var is outside the subset');
    if (ts.isLabeledStatement(n) || ts.isDoStatement(n) || ts.isForInStatement(n) || ts.isWithStatement(n) || ts.isDebuggerStatement(n)) at(n, `${ts.SyntaxKind[n.kind]} is outside the subset`);
    if (ts.isEnumDeclaration(n) || ts.isModuleDeclaration(n)) at(n, `${ts.SyntaxKind[n.kind]} is outside the subset`);
    if ((ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.typeParameters !== undefined) at(n, 'generic functions are not supported by the translator yet');
    if (ts.isFunctionExpression(n)) at(n, 'function expressions are outside the subset (use arrow functions)');
    if (ts.isClassDeclaration(n) && n.heritageClauses?.[0]?.types[0]?.expression.getText(sf) !== 'Error') at(n, 'the only class form is `class X extends Error`');
    if (ts.isIdentifier(n) && BANNED_GLOBALS.has(n.text) && !ts.isPropertyAccessExpression(n.parent) && !ts.isPropertySignature(n.parent) && !ts.isPropertyAssignment(n.parent)) {
      const s = checker.getSymbolAtLocation(n);
      const d = s?.declarations?.[0];
      if (d !== undefined && program.isSourceFileDefaultLibrary(d.getSourceFile())) at(n, `${n.text} is outside the subset`);
    }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Math' && n.name.text === 'random') at(n, 'Math.random is outside the subset');
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // Declaration merging: one declaration per top-level name.
  for (const st of sf.statements) {
    if (!(ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isClassDeclaration(st) || ts.isFunctionDeclaration(st))) continue;
    const name = st.name;
    if (name === undefined) continue;
    const s = checker.getSymbolAtLocation(name);
    if (s !== undefined && (s.declarations?.length ?? 0) > 1) at(st, `declaration merging of ${name.text} is outside the subset`);
  }
  return out;
}

/** All violations of the engine files, sorted by file and line. */
export function checkSubset(files: readonly string[] = engineFiles()): Violation[] {
  const program = createProgram(files);
  const out: Violation[] = [];
  for (const f of files) out.push(...syntactic(program.getSourceFile(f) as ts.SourceFile, program));
  const l = new Lowerer(program, { files, hostFile: null, root: ROOT, collect: true, roots: null });
  l.lower();
  out.push(...l.violations);
  const seen = new Set<string>();
  return out
    .filter((v) => {
      const k = `${v.file}:${v.line}:${v.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.message, b.message));
}
