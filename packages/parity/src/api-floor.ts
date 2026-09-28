// The Android API floor, proven at build time (notes/T013-p3-review-p4-plan.md section 2 item 7): every android.* class and member
// that classes.dex references, directly or through an app class's inherited members, must exist at the minSdk according to the
// SDK's platforms/android-<n>/data/api-versions.xml. The iOS floor is swiftc's own availability checking at the iOS 15 target.

/** One class of api-versions.xml: its since level, supertypes, and members with their since levels (null: the class's). */
export type ApiClass = { readonly since: number; readonly supers: readonly string[]; readonly methods: ReadonlyMap<string, number | null>; readonly fields: ReadonlyMap<string, number | null> };
export type ApiVersions = ReadonlyMap<string, ApiClass>;

/** Parses api-versions.xml (version 3): classes, extends and implements, methods with signatures, and fields. */
export function parseApiVersions(xml: string): ApiVersions {
  const out = new Map<string, ApiClass>();
  const classRe = /<class name="([^"]+)"([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(xml)) !== null) {
    const name = m[1] as string;
    const since = sinceOf(m[2] as string) ?? 1;
    const supers: string[] = [];
    const methods = new Map<string, number | null>();
    const fields = new Map<string, number | null>();
    if (m[3] !== '/') {
      const end = xml.indexOf('</class>', classRe.lastIndex);
      const body = xml.slice(classRe.lastIndex, end);
      for (const x of body.matchAll(/<(extends|implements) name="([^"]+)"/g)) supers.push(x[2] as string);
      for (const x of body.matchAll(/<method name="([^"]+)"([^>]*)\/?>/g)) methods.set(decode(x[1] as string), sinceOf(x[2] as string));
      for (const x of body.matchAll(/<field name="([^"]+)"([^>]*)\/?>/g)) fields.set(decode(x[1] as string), sinceOf(x[2] as string));
      classRe.lastIndex = end;
    }
    out.set(name, { since, supers, methods, fields });
  }
  return out;
}

function sinceOf(attrs: string): number | null {
  const s = /\bsince="(\d+)"/.exec(attrs);
  return s === null ? null : Number(s[1]);
}

const decode = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** A class of the app's dex: its superclass, interfaces and the methods and fields it declares. */
export type DexClass = { readonly superclass: string | null; readonly interfaces: readonly string[]; readonly methods: ReadonlySet<string>; readonly fields: ReadonlySet<string> };

/** A referenced member or class, in api-versions naming (android/view/View, layout(IIII)V). */
export type DexRef = { readonly owner: string; readonly kind: 'class' | 'method' | 'field'; readonly member: string | null };

const internal = (desc: string): string => desc.replace(/^L/, '').replace(/;$/, '');

/** Parses `dexdump -d` output: the app's classes and every class, method and field reference in its code and declarations. */
export function parseDexdump(text: string): { classes: Map<string, DexClass>; refs: DexRef[] } {
  const classes = new Map<string, DexClass>();
  const refs: DexRef[] = [];
  let current: { name: string; superclass: string | null; interfaces: string[]; methods: Set<string>; fields: Set<string> } | null = null;
  let section: 'none' | 'interfaces' | 'fields' | 'methods' = 'none';
  let pendingName: string | null = null;
  const flush = (): void => {
    if (current !== null) classes.set(current.name, { superclass: current.superclass, interfaces: current.interfaces, methods: current.methods, fields: current.fields });
  };
  for (const line of text.split('\n')) {
    const cls = /^\s*Class descriptor\s*:\s*'([^']+)'/.exec(line);
    if (cls !== null) {
      flush();
      current = { name: internal(cls[1] as string), superclass: null, interfaces: [], methods: new Set(), fields: new Set() };
      section = 'none';
      continue;
    }
    if (current === null) continue;
    const sup = /^\s*Superclass\s*:\s*'([^']+)'/.exec(line);
    if (sup !== null) {
      current.superclass = internal(sup[1] as string);
      refs.push({ owner: current.superclass, kind: 'class', member: null });
      continue;
    }
    if (/^\s*Interfaces\s*-/.test(line)) section = 'interfaces';
    else if (/^\s*(Static|Instance) fields\s*-/.test(line)) section = 'fields';
    else if (/^\s*(Direct|Virtual) methods\s*-/.test(line)) section = 'methods';
    const iface = /^\s*#\d+\s*:\s*'(L[^']+;)'/.exec(line);
    if (section === 'interfaces' && iface !== null) {
      current.interfaces.push(internal(iface[1] as string));
      refs.push({ owner: internal(iface[1] as string), kind: 'class', member: null });
    }
    const name = /^\s*name\s*:\s*'([^']+)'/.exec(line);
    if (name !== null) pendingName = name[1] as string;
    const type = /^\s*type\s*:\s*'([^']+)'/.exec(line);
    if (type !== null && pendingName !== null) {
      if (section === 'methods') current.methods.add(`${pendingName}${type[1]}`);
      else if (section === 'fields') current.fields.add(pendingName);
      pendingName = null;
    }
    // Code references: Lowner;.member:sig for methods and fields, and class operands.
    for (const x of line.matchAll(/(L[\w/$]+;)\.([\w$<>-]+):(\S+)/g)) {
      const owner = internal(x[1] as string);
      const sig = x[3] as string;
      refs.push(sig.startsWith('(') ? { owner, kind: 'method', member: `${x[2]}${sig}` } : { owner, kind: 'field', member: x[2] as string });
    }
    const op = /\b(?:new-instance|const-class|check-cast|instance-of|new-array|filled-new-array)\b[^,]*,\s*\[*(L[\w/$]+;)/.exec(line);
    if (op !== null) refs.push({ owner: internal(op[1] as string), kind: 'class', member: null });
  }
  flush();
  return { classes, refs };
}

export type FloorViolation = { readonly ref: string; readonly since: number | null; readonly reason: string };

const isAndroid = (c: string): boolean => c.startsWith('android/');

/** The level a member needs on an android class, walking its supertypes; null when the SDK does not describe it. */
function androidSince(api: ApiVersions, owner: string, kind: 'method' | 'field', member: string, seen = new Set<string>()): { owner: string; since: number } | null {
  if (seen.has(owner)) return null;
  seen.add(owner);
  const c = api.get(owner);
  if (c === undefined) return null;
  const table = kind === 'method' ? c.methods : c.fields;
  if (table.has(member)) return { owner, since: Math.max(c.since, table.get(member) ?? c.since) };
  for (const s of c.supers) {
    const hit = androidSince(api, s, kind, member, seen);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Every reference above minSdk. A member referenced on an app class that the app class does not declare resolves through its
 * superclasses and interfaces to the android class that declares it. java.*, javax.*, kotlin.* and dalvik.* are out of scope.
 */
export function checkFloor(api: ApiVersions, dex: { classes: ReadonlyMap<string, DexClass>; refs: readonly DexRef[] }, minSdk: number): { violations: FloorViolation[]; checked: number } {
  const violations: FloorViolation[] = [];
  const seen = new Set<string>();
  let checked = 0;
  const resolveApp = (owner: string, kind: 'method' | 'field', member: string): string | null => {
    let at: string | null = owner;
    const guard = new Set<string>();
    while (at !== null && !isAndroid(at) && !guard.has(at)) {
      guard.add(at);
      const c = dex.classes.get(at);
      if (c === undefined) return null;
      if ((kind === 'method' ? c.methods : c.fields).has(member)) return null;
      const androidIface = c.interfaces.find((i) => isAndroid(i) && androidSince(api, i, kind, member) !== null);
      if (androidIface !== undefined) return androidIface;
      at = c.superclass;
    }
    return at !== null && isAndroid(at) ? at : null;
  };
  for (const r of dex.refs) {
    let owner = r.owner;
    if (!isAndroid(owner) && r.kind !== 'class' && r.member !== null) {
      const resolved = resolveApp(owner, r.kind, r.member);
      if (resolved === null) continue;
      owner = resolved;
    }
    if (!isAndroid(owner)) continue;
    const key = `${owner} ${r.kind} ${r.member ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    checked++;
    const label = r.member === null ? owner.replace(/\//g, '.') : `${owner.replace(/\//g, '.')}#${r.member}`;
    const cls = api.get(owner);
    if (cls === undefined) {
      violations.push({ ref: label, since: null, reason: 'not in api-versions.xml' });
      continue;
    }
    if (r.kind === 'class' || r.member === null) {
      if (cls.since > minSdk) violations.push({ ref: label, since: cls.since, reason: `class since API ${cls.since}` });
      continue;
    }
    const hit = androidSince(api, owner, r.kind, r.member);
    if (hit === null) violations.push({ ref: label, since: null, reason: 'member not in api-versions.xml' });
    else if (hit.since > minSdk) violations.push({ ref: label, since: hit.since, reason: `since API ${hit.since} (declared on ${hit.owner.replace(/\//g, '.')})` });
  }
  return { violations, checked };
}
