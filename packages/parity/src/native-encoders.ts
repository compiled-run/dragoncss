// Swift and Kotlin dump encoders emitted from NATIVE_DUMP_SCHEMA (notes/T013-p3-review-p4-plan.md section 2 item 5): one class per
// described object and a JSON writer that puts keys in schema order, traps on non-finite numbers, on a non-integer or out-of-range
// value in an integer field, on an empty id, an unknown enum value and a wrong array length, and writes null only where the field
// may be null on a device lane (nullable 'always'); 'reference-lane' fields are non-optional on device. No Codable, no kotlinx.
import type { Field, FieldType, NativeDump } from './native-dump.ts';
import { NATIVE_DUMP_SCHEMA } from './native-dump.ts';

export type EncoderLanguage = 'swift' | 'kotlin';
type ObjectType = Extract<FieldType, { kind: 'object' }>;

/** One described object, named by its path. */
type ClassDecl = { readonly name: string; readonly path: string; readonly fields: readonly Field[] };

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const SWIFT_KEYWORDS = new Set(['case', 'default', 'class', 'struct', 'enum', 'func', 'let', 'var', 'in', 'is', 'as', 'self', 'init', 'protocol', 'where', 'switch', 'return', 'import', 'internal', 'public', 'private', 'static', 'repeat', 'while', 'for', 'if', 'else', 'do', 'break', 'continue', 'throw', 'try', 'catch', 'nil', 'true', 'false', 'super', 'Type', 'operator', 'extension', 'subscript', 'typealias', 'inout', 'deinit', 'guard', 'defer', 'fallthrough']);
const KOTLIN_KEYWORDS = new Set(['as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while']);
export const swiftName = (n: string): string => (SWIFT_KEYWORDS.has(n) ? `\`${n}\`` : n);
export const kotlinName = (n: string): string => (KOTLIN_KEYWORDS.has(n) ? `\`${n}\`` : n);

/** Every object of the schema, depth first, each named Dump + its path segments ("nodes" items become DumpNodes). */
export function schemaClasses(schema: ObjectType = NATIVE_DUMP_SCHEMA): ClassDecl[] {
  const out: ClassDecl[] = [];
  const visit = (t: ObjectType, name: string, path: string): void => {
    out.push({ name, path, fields: t.fields });
    for (const f of t.fields) {
      const inner = objectOf(f.type);
      if (inner !== null) visit(inner, `${name}${cap(f.name)}`, path === '' ? f.name : `${path}.${f.name}`);
    }
  };
  visit(schema, 'Dump', '');
  return out;
}

/** The object type of a field, looking through arrays. */
function objectOf(t: FieldType): ObjectType | null {
  if (t.kind === 'object') return t;
  if (t.kind === 'array') return objectOf(t.items);
  return null;
}

/** Device lanes may write null only where the schema allows it on every lane. */
const deviceNullable = (f: Field): boolean => f.nullable === 'always';

const lit = (s: string): string => JSON.stringify(s);

// ---------------------------------------------------------------- Swift

function swiftType(t: FieldType, cls: string): string {
  switch (t.kind) {
    case 'string':
    case 'const':
    case 'enum':
      return 'String';
    case 'number':
    case 'integer':
      return 'Double';
    case 'object':
      return cls;
    case 'array':
      return `[${swiftType(t.items, cls)}]`;
    case 'map':
      return 'DumpJsonObject';
    case 'json':
      return 'DumpJson';
  }
}

function swiftWrite(t: FieldType, v: string, path: string, depth = 0): string {
  switch (t.kind) {
    case 'string':
      return `w.string(${v}, nonEmpty: ${t.nonEmpty}, path: ${lit(path)})`;
    case 'const':
      return `w.string(${lit(t.value)}, nonEmpty: true, path: ${lit(path)})`;
    case 'enum':
      return `w.enumValue(${v}, allowed: [${t.values.map(lit).join(', ')}], path: ${lit(path)})`;
    case 'number':
      return `w.number(${v}, path: ${lit(path)})`;
    case 'integer':
      return `w.integer(${v}, min: ${t.min === null ? 'nil' : t.min}, max: ${t.max === null ? 'nil' : t.max}, path: ${lit(path)})`;
    case 'object':
      return `${v}.write(&w)`;
    case 'array': {
      const x = `x${depth}`;
      return `w.array(${v}, length: ${t.length === null ? 'nil' : t.length}, path: ${lit(path)}) { ${x}, w in ${swiftWrite(t.items, x, `${path}[]`, depth + 1)} }`;
    }
    case 'map':
      return `w.object(${v}, path: ${lit(path)})`;
    case 'json':
      return `w.json(${v}, path: ${lit(path)})`;
  }
}

function swiftClass(c: ClassDecl): string {
  const stored = c.fields.filter((f) => f.type.kind !== 'const');
  const typeOf = (f: Field): string => {
    const inner = objectOf(f.type);
    const t = swiftType(f.type, inner === null ? '' : `${c.name}${cap(f.name)}`);
    return deviceNullable(f) ? `${t}?` : t;
  };
  const lines: string[] = [];
  lines.push(`/// ${c.path === '' ? 'dragon.native-dump/1' : c.path}`);
  lines.push(`public final class ${c.name} {`);
  for (const f of stored) lines.push(`  public let ${swiftName(f.name)}: ${typeOf(f)}`);
  lines.push(`  public init(${stored.map((f) => `${swiftName(f.name)}: ${typeOf(f)}`).join(', ')}) {`);
  for (const f of stored) lines.push(`    self.${f.name} = ${swiftName(f.name)}`);
  lines.push('  }');
  lines.push('  public func write(_ w: inout DumpJsonWriter) {');
  lines.push('    w.beginObject()');
  for (const f of c.fields) {
    const p = c.path === '' ? f.name : `${c.path}.${f.name}`;
    lines.push(`    w.key(${lit(f.name)})`);
    const v = `self.${f.name}`;
    if (deviceNullable(f)) lines.push(`    if let v = ${v} { ${swiftWrite(f.type, 'v', p)} } else { w.null() }`);
    else lines.push(`    ${swiftWrite(f.type, v, p)}`);
  }
  lines.push('    w.endObject()');
  lines.push('  }');
  lines.push('}');
  return lines.join('\n');
}

const SWIFT_WRITER = `/// A JSON value inside an applied map.
public indirect enum DumpJson {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([DumpJson])
  case object(DumpJsonObject)
}

/// An ordered JSON object.
public typealias DumpJsonObject = [(String, DumpJson)]

/// The dump writer: keys in schema order; traps instead of writing a value the schema forbids.
public struct DumpJsonWriter {
  public private(set) var text = ""
  private var first: [Bool] = []
  public init() {}
  private mutating func comma() {
    if let f = first.last {
      if !f { text += "," }
      first[first.count - 1] = false
    }
  }
  public mutating func beginObject() { comma(); text += "{"; first.append(true) }
  public mutating func endObject() { first.removeLast(); text += "}" }
  public mutating func key(_ k: String) { comma(); text += DumpJsonWriter.quote(k) + ":"; first[first.count - 1] = true }
  public mutating func null() { comma(); text += "null" }
  public mutating func string(_ s: String, nonEmpty: Bool, path: String) {
    if nonEmpty && s.isEmpty { fatalError("dump \\(path): empty string where the schema requires one") }
    comma(); text += DumpJsonWriter.quote(s)
  }
  public mutating func enumValue(_ s: String, allowed: [String], path: String) {
    if !allowed.contains(s) { fatalError("dump \\(path): \\(s) is not one of \\(allowed)") }
    comma(); text += DumpJsonWriter.quote(s)
  }
  public mutating func number(_ v: Double, path: String) {
    if !v.isFinite { fatalError("dump \\(path): non-finite number \\(v)") }
    comma(); text += DumpJsonWriter.format(v)
  }
  public mutating func integer(_ v: Double, min: Double?, max: Double?, path: String) {
    if !v.isFinite || v.rounded(.towardZero) != v || abs(v) > 9007199254740991 { fatalError("dump \\(path): \\(v) is not an integer") }
    if let m = min, v < m { fatalError("dump \\(path): \\(v) is below \\(m)") }
    if let m = max, v > m { fatalError("dump \\(path): \\(v) is above \\(m)") }
    comma(); text += String(Int64(v))
  }
  public mutating func array<T>(_ items: [T], length: Int?, path: String, _ each: (T, inout DumpJsonWriter) -> Void) {
    if let n = length, items.count != n { fatalError("dump \\(path): \\(items.count) items, the schema requires \\(n)") }
    comma(); text += "["; first.append(true)
    for x in items { each(x, &self) }
    first.removeLast(); text += "]"
  }
  public mutating func object(_ o: DumpJsonObject, path: String) {
    beginObject()
    for (k, v) in o { key(k); json(v, path: "\\(path).\\(k)") }
    endObject()
  }
  public mutating func json(_ v: DumpJson, path: String) {
    switch v {
    case .null: null()
    case .bool(let b): comma(); text += b ? "true" : "false"
    case .number(let d): number(d, path: path)
    case .string(let s): string(s, nonEmpty: false, path: path)
    case .array(let a): array(a, length: nil, path: path) { x, w in w.json(x, path: path) }
    case .object(let o): object(o, path: path)
    }
  }
  /// The shortest decimal that reads back as the same double (Swift's description), integral values without a fraction.
  public static func format(_ v: Double) -> String {
    if v == v.rounded(.towardZero) && abs(v) < 1e15 { return v == 0 && v.sign == .minus ? "-0" : String(Int64(v)) }
    return "\\(v)"
  }
  public static func quote(_ s: String) -> String {
    var out = "\\""
    for u in s.unicodeScalars {
      switch u {
      case "\\"": out += "\\\\\\""
      case "\\\\": out += "\\\\\\\\"
      case "\\n": out += "\\\\n"
      case "\\r": out += "\\\\r"
      case "\\t": out += "\\\\t"
      default:
        if u.value < 0x20 { out += String(format: "\\\\u%04x", u.value) } else { out.unicodeScalars.append(u) }
      }
    }
    return out + "\\""
  }
}

/// The dump as JSON text.
public func dumpJson(_ d: Dump) -> String {
  var w = DumpJsonWriter()
  d.write(&w)
  return w.text
}`;

/** The Swift dump types and writer, walked from the schema. */
export function encoderSwift(schema: ObjectType = NATIVE_DUMP_SCHEMA): string {
  const header = '// GENERATED by @dragon/parity native-encoders.ts from NATIVE_DUMP_SCHEMA (dragon.native-dump/1). Do not edit.\nimport Foundation\n';
  return `${header}\n${SWIFT_WRITER}\n\n${schemaClasses(schema).map(swiftClass).join('\n\n')}\n`;
}

// ---------------------------------------------------------------- Kotlin

function kotlinType(t: FieldType, cls: string): string {
  switch (t.kind) {
    case 'string':
    case 'const':
    case 'enum':
      return 'String';
    case 'number':
    case 'integer':
      return 'Double';
    case 'object':
      return cls;
    case 'array':
      return `List<${kotlinType(t.items, cls)}>`;
    case 'map':
      return 'List<Pair<String, DumpJson>>';
    case 'json':
      return 'DumpJson';
  }
}

function kotlinWrite(t: FieldType, v: string, path: string, depth = 0): string {
  switch (t.kind) {
    case 'string':
      return `w.string(${v}, ${t.nonEmpty}, ${lit(path)})`;
    case 'const':
      return `w.string(${lit(t.value)}, true, ${lit(path)})`;
    case 'enum':
      return `w.enumValue(${v}, listOf(${t.values.map(lit).join(', ')}), ${lit(path)})`;
    case 'number':
      return `w.number(${v}, ${lit(path)})`;
    case 'integer':
      return `w.integer(${v}, ${t.min === null ? 'null' : `${t.min}.0`}, ${t.max === null ? 'null' : `${t.max}.0`}, ${lit(path)})`;
    case 'object':
      return `${v}.write(w)`;
    case 'array': {
      const x = `x${depth}`;
      return `w.array(${v}, ${t.length === null ? 'null' : t.length}, ${lit(path)}) { ${x} -> ${kotlinWrite(t.items, x, `${path}[]`, depth + 1)} }`;
    }
    case 'map':
      return `w.obj(${v}, ${lit(path)})`;
    case 'json':
      return `w.json(${v}, ${lit(path)})`;
  }
}

function kotlinClass(c: ClassDecl): string {
  const stored = c.fields.filter((f) => f.type.kind !== 'const');
  const typeOf = (f: Field): string => {
    const inner = objectOf(f.type);
    const t = kotlinType(f.type, inner === null ? '' : `${c.name}${cap(f.name)}`);
    return deviceNullable(f) ? `${t}?` : t;
  };
  const lines: string[] = [];
  lines.push(`/** ${c.path === '' ? 'dragon.native-dump/1' : c.path} */`);
  lines.push(`class ${c.name}(`);
  for (const f of stored) lines.push(`  val ${kotlinName(f.name)}: ${typeOf(f)},`);
  lines.push(') {');
  lines.push('  fun write(w: DumpJsonWriter) {');
  lines.push('    w.beginObject()');
  for (const f of c.fields) {
    const p = c.path === '' ? f.name : `${c.path}.${f.name}`;
    lines.push(`    w.key(${lit(f.name)})`);
    const v = `this.${kotlinName(f.name)}`;
    if (deviceNullable(f)) lines.push(`    val v${f.name} = ${v}; if (v${f.name} != null) ${kotlinWrite(f.type, `v${f.name}`, p)} else w.nul()`);
    else lines.push(`    ${kotlinWrite(f.type, v, p)}`);
  }
  lines.push('    w.endObject()');
  lines.push('  }');
  lines.push('}');
  return lines.join('\n');
}

const KOTLIN_WRITER = `/** A JSON value inside an applied map. */
sealed class DumpJson {
  object Null : DumpJson()
  class Bool(val value: Boolean) : DumpJson()
  class Num(val value: Double) : DumpJson()
  class Str(val value: String) : DumpJson()
  class Arr(val items: List<DumpJson>) : DumpJson()
  class Obj(val entries: List<Pair<String, DumpJson>>) : DumpJson()
}

/** The dump writer: keys in schema order; traps instead of writing a value the schema forbids. */
class DumpJsonWriter {
  val text = StringBuilder()
  private val first = ArrayList<Boolean>()
  private fun comma() {
    if (first.isEmpty()) return
    if (!first[first.size - 1]) text.append(',')
    first[first.size - 1] = false
  }
  fun beginObject() { comma(); text.append('{'); first.add(true) }
  fun endObject() { first.removeAt(first.size - 1); text.append('}') }
  fun key(k: String) { comma(); text.append(quote(k)).append(':'); first[first.size - 1] = true }
  fun nul() { comma(); text.append("null") }
  fun string(s: String, nonEmpty: Boolean, path: String) {
    if (nonEmpty && s.isEmpty()) throw IllegalStateException("dump $path: empty string where the schema requires one")
    comma(); text.append(quote(s))
  }
  fun enumValue(s: String, allowed: List<String>, path: String) {
    if (s !in allowed) throw IllegalStateException("dump $path: $s is not one of $allowed")
    comma(); text.append(quote(s))
  }
  fun number(v: Double, path: String) {
    if (!v.isFinite()) throw IllegalStateException("dump $path: non-finite number $v")
    comma(); text.append(format(v))
  }
  fun integer(v: Double, min: Double?, max: Double?, path: String) {
    if (!v.isFinite() || kotlin.math.truncate(v) != v || kotlin.math.abs(v) > 9007199254740991.0) throw IllegalStateException("dump $path: $v is not an integer")
    if (min != null && v < min) throw IllegalStateException("dump $path: $v is below $min")
    if (max != null && v > max) throw IllegalStateException("dump $path: $v is above $max")
    comma(); text.append(v.toLong().toString())
  }
  fun <T> array(items: List<T>, length: Int?, path: String, each: (T) -> Unit) {
    if (length != null && items.size != length) throw IllegalStateException("dump $path: \${items.size} items, the schema requires $length")
    comma(); text.append('['); first.add(true)
    for (x in items) each(x)
    first.removeAt(first.size - 1); text.append(']')
  }
  fun obj(o: List<Pair<String, DumpJson>>, path: String) {
    beginObject()
    for ((k, v) in o) { key(k); json(v, "$path.$k") }
    endObject()
  }
  fun json(v: DumpJson, path: String) {
    when (v) {
      is DumpJson.Null -> nul()
      is DumpJson.Bool -> { comma(); text.append(if (v.value) "true" else "false") }
      is DumpJson.Num -> number(v.value, path)
      is DumpJson.Str -> string(v.value, false, path)
      is DumpJson.Arr -> array(v.items, null, path) { x -> json(x, path) }
      is DumpJson.Obj -> obj(v.entries, path)
    }
  }
  companion object {
    /** A decimal that reads back as the same double; integral values without a fraction. */
    fun format(v: Double): String {
      if (v == kotlin.math.truncate(v) && kotlin.math.abs(v) < 1e15) return if (v == 0.0 && 1.0 / v < 0) "-0" else v.toLong().toString()
      return v.toString()
    }
    fun quote(s: String): String {
      val out = StringBuilder("\\"")
      for (ch in s) {
        when {
          ch == '"' -> out.append("\\\\\\"")
          ch == '\\\\' -> out.append("\\\\\\\\")
          ch == '\\n' -> out.append("\\\\n")
          ch == '\\r' -> out.append("\\\\r")
          ch == '\\t' -> out.append("\\\\t")
          ch.code < 0x20 -> out.append(String.format("\\\\u%04x", ch.code))
          else -> out.append(ch)
        }
      }
      return out.append('"').toString()
    }
  }
}

/** The dump as JSON text. */
fun dumpJson(d: Dump): String {
  val w = DumpJsonWriter()
  d.write(w)
  return w.text.toString()
}`;

export const KOTLIN_DUMP_PACKAGE = 'dev.dragon.dump';

/** The Kotlin dump types and writer, walked from the schema. */
export function encoderKotlin(schema: ObjectType = NATIVE_DUMP_SCHEMA): string {
  const header = `// GENERATED by @dragon/parity native-encoders.ts from NATIVE_DUMP_SCHEMA (dragon.native-dump/1). Do not edit.\npackage ${KOTLIN_DUMP_PACKAGE}\n`;
  return `${header}\n${KOTLIN_WRITER}\n\n${schemaClasses(schema).map(kotlinClass).join('\n\n')}\n`;
}

export function encoderSource(lang: EncoderLanguage, schema: ObjectType = NATIVE_DUMP_SCHEMA): string {
  return lang === 'swift' ? encoderSwift(schema) : encoderKotlin(schema);
}

// ---------------------------------------------------------------- dump construction source (host tests only)

/** Literal source for a JSON-described dump value, built with the typed constructors (no decoding). */
function constructValue(lang: EncoderLanguage, t: FieldType, v: unknown, cls: string): string {
  const num = (x: number): string => {
    if (Object.is(x, -0)) return '-0.0';
    const s = String(x);
    return /[.eE]/.test(s) ? s.replace('e', 'E').replace(/E\+?/, lang === 'kotlin' ? 'E' : 'e') : `${s}.0`;
  };
  const str = (s: string): string => stringLiteral(lang, s);
  switch (t.kind) {
    case 'string':
    case 'enum':
      return str(v as string);
    case 'const':
      return str(t.value);
    case 'number':
    case 'integer':
      return num(v as number);
    case 'object':
      return constructObject(lang, t, v as Record<string, unknown>, cls);
    case 'array': {
      const items = (v as unknown[]).map((x) => constructValue(lang, t.items, x, cls));
      return lang === 'swift' ? `[${items.join(', ')}] as ${swiftType(t, cls)}` : `listOf<${kotlinType(t.items, cls)}>(${items.join(', ')})`;
    }
    case 'map': {
      const e = Object.entries(v as Record<string, unknown>).map(([k, x]) => (lang === 'swift' ? `(${str(k)}, ${jsonValue(lang, x)})` : `Pair(${str(k)}, ${jsonValue(lang, x)})`));
      return lang === 'swift' ? `[${e.join(', ')}] as DumpJsonObject` : `listOf<Pair<String, DumpJson>>(${e.join(', ')})`;
    }
    case 'json':
      return jsonValue(lang, v);
  }
}

function jsonValue(lang: EncoderLanguage, v: unknown): string {
  const s = lang === 'swift';
  if (v === null) return s ? 'DumpJson.null' : 'DumpJson.Null';
  if (typeof v === 'boolean') return s ? `DumpJson.bool(${v})` : `DumpJson.Bool(${v})`;
  if (typeof v === 'number') return s ? `DumpJson.number(${constructValue(lang, { kind: 'number' }, v, '')})` : `DumpJson.Num(${constructValue(lang, { kind: 'number' }, v, '')})`;
  if (typeof v === 'string') return s ? `DumpJson.string(${stringLiteral(lang, v)})` : `DumpJson.Str(${stringLiteral(lang, v)})`;
  if (Array.isArray(v)) return s ? `DumpJson.array([${v.map((x) => jsonValue(lang, x)).join(', ')}] as [DumpJson])` : `DumpJson.Arr(listOf<DumpJson>(${v.map((x) => jsonValue(lang, x)).join(', ')}))`;
  const e = Object.entries(v as Record<string, unknown>).map(([k, x]) => (s ? `(${stringLiteral(lang, k)}, ${jsonValue(lang, x)})` : `Pair(${stringLiteral(lang, k)}, ${jsonValue(lang, x)})`));
  return s ? `DumpJson.object([${e.join(', ')}] as DumpJsonObject)` : `DumpJson.Obj(listOf<Pair<String, DumpJson>>(${e.join(', ')}))`;
}

function constructObject(lang: EncoderLanguage, t: ObjectType, v: Record<string, unknown>, cls: string): string {
  const args = t.fields.filter((f) => f.type.kind !== 'const').map((f) => {
    const x = v[f.name];
    const inner = objectOf(f.type);
    const value = x === null ? (lang === 'swift' ? 'nil' : 'null') : constructValue(lang, f.type, x, inner === null ? cls : `${cls}${cap(f.name)}`);
    return lang === 'swift' ? `${f.name}: ${value}` : `${kotlinName(f.name)} = ${value}`;
  });
  return `${cls}(${args.join(', ')})`;
}

/**
 * Source that builds one dump with the typed constructors of the emitted encoder: one function per node (so no generated function
 * grows large), then the dump. Returns the function declarations; the dump function is named name.
 */
export function constructDump(lang: EncoderLanguage, dump: NativeDump, name: string, schema: ObjectType = NATIVE_DUMP_SCHEMA): string[] {
  const nodesField = schema.fields.find((f) => f.name === 'nodes');
  if (nodesField === undefined || nodesField.type.kind !== 'array') throw new Error('the schema has no nodes array');
  const nodeType = nodesField.type.items as ObjectType;
  const decls = dump.nodes.map((n, j) => (lang === 'swift'
    ? `func ${name}n${j}() -> DumpNodes {\n  return ${constructObject(lang, nodeType, n as unknown as Record<string, unknown>, 'DumpNodes')}\n}`
    : `fun ${name}n${j}(): DumpNodes =\n  ${constructObject(lang, nodeType, n as unknown as Record<string, unknown>, 'DumpNodes')}`));
  const top = constructObject(lang, schema, { ...(dump as unknown as Record<string, unknown>), nodes: [] }, 'Dump');
  const nodes = dump.nodes.map((_, j) => `${name}n${j}()`).join(', ');
  const withNodes = lang === 'swift' ? top.replace('nodes: [] as [DumpNodes]', `nodes: [${nodes}] as [DumpNodes]`) : top.replace('nodes = listOf<DumpNodes>()', `nodes = listOf<DumpNodes>(${nodes})`);
  if (withNodes === top && dump.nodes.length > 0) throw new Error('constructDump: the nodes placeholder was not found');
  decls.push(lang === 'swift' ? `func ${name}() -> Dump {\n  return ${withNodes}\n}` : `fun ${name}(): Dump =\n  ${withNodes}`);
  return decls;
}

/** A string literal in the language, escaping everything outside printable ASCII. */
export function stringLiteral(lang: EncoderLanguage, s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (lang === 'kotlin' && ch === '$') out += '\\$';
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (lang === 'swift') out += `\\u{${cp.toString(16)}}`;
    else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else {
      const hi = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
      const lo = ((cp - 0x10000) % 0x400) + 0xdc00;
      out += `\\u${hi.toString(16)}\\u${lo.toString(16)}`;
    }
  }
  return `${out}"`;
}

// ---------------------------------------------------------------- planted encoder faults

/** Faults planted in the emitted encoder; each must make the written dump fail validateNativeDump with its code. */
export const ENCODER_FAULTS = ['drop-field', 'add-key', 'device-edges-60.5', 'null-outside-reference'] as const;
export type EncoderFault = (typeof ENCODER_FAULTS)[number];
export const ENCODER_FAULT_CODES: { readonly [F in EncoderFault]: string } = {
  'drop-field': 'missing-key',
  'add-key': 'extra-key',
  'device-edges-60.5': 'not-integer',
  'null-outside-reference': 'null-not-allowed',
};

function replaceOnce(src: string, needle: string, replacement: string, fault: string): string {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`encoder fault ${fault}: "${needle}" is not in the emitted encoder`);
  return src.slice(0, i) + replacement + src.slice(i + needle.length);
}

/** The emitted encoder with one fault planted in its source. */
export function plantEncoderFault(lang: EncoderLanguage, src: string, fault: EncoderFault): string {
  const s = lang === 'swift';
  switch (fault) {
    case 'drop-field':
      // The writer skips the case fixture key and its value.
      return replaceOnce(src, s ? 'w.key("fixture")\n    w.string(self.fixture, nonEmpty: true, path: "case.fixture")\n' : 'w.key("fixture")\n    w.string(this.fixture, true, "case.fixture")\n', '', fault);
    case 'add-key':
      // The writer adds a key the schema does not describe to the device block.
      return replaceOnce(src, 'w.key("renderer")', s ? 'w.key("extraKey")\n    w.string("x", nonEmpty: false, path: "device.extraKey")\n    w.key("renderer")' : 'w.key("extraKey")\n    w.string("x", false, "device.extraKey")\n    w.key("renderer")', fault);
    case 'device-edges-60.5':
      // The node deviceEdges left bypasses the integer writer and writes 60.5.
      return replaceOnce(src, s ? 'w.integer(self.left, min: nil, max: nil, path: "nodes.deviceEdges.left")' : 'w.integer(this.left, null, null, "nodes.deviceEdges.left")', s ? 'w.number(60.5, path: "nodes.deviceEdges.left")' : 'w.number(60.5, "nodes.deviceEdges.left")', fault);
    case 'null-outside-reference':
      // The writer writes null for timing on a device lane.
      return replaceOnce(src, s ? 'w.key("timing")\n    self.timing.write(&w)' : 'w.key("timing")\n    this.timing.write(w)', s ? 'w.key("timing")\n    w.null()' : 'w.key("timing")\n    w.nul()', fault);
  }
}
