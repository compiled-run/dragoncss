// Reads files out of an Android emulator system image (the SDK's system.img) at build time: the GPT disk, the dynamic-partition
// "super" partition's logical partitions (liblp metadata), and the ext4 file system of one of them. Read-only, no mount, no
// tools: Dragon reads the platform's own font files and fonts.xml from it (docs/markless-native-styles.md "System fonts").
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** Reads bytes of a file or a region of one; throws when the region runs past its end. */
export type ByteSource = { readonly size: number; read(offset: number, length: number): Uint8Array };

export class ImageError extends Error {}
const fail = (what: string): never => {
  throw new ImageError(what);
};

/** A file on disk as a ByteSource, read lazily (a system image is gigabytes). */
export function fileSource(path: string): ByteSource & { close(): void } {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  return {
    size,
    read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > size) fail(`${path}: read of ${length} bytes at ${offset} runs past its ${size} bytes`);
      const out = new Uint8Array(length);
      let done = 0;
      while (done < length) {
        const n = readSync(fd, out, done, length - done, offset + done);
        if (n === 0) fail(`${path}: short read at ${offset + done}`);
        done += n;
      }
      return out;
    },
    close: () => closeSync(fd),
  };
}

/** Bytes in memory as a ByteSource (tests build images in memory). */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > bytes.length) fail(`read of ${length} bytes at ${offset} runs past ${bytes.length} bytes`);
      return bytes.subarray(offset, offset + length);
    },
  };
}

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u64 = (d: DataView, at: number): number => {
  const v = d.getBigUint64(at, true);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) fail(`a 64-bit field at ${at} is ${v}, past what Dragon reads`);
  return Number(v);
};
const ascii = (b: Uint8Array): string => String.fromCharCode(...b);
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** A region of a source, itself a source. */
export function slice(src: ByteSource, offset: number, size: number, what: string): ByteSource {
  if (offset < 0 || size < 0 || offset + size > src.size) fail(`${what} (${size} bytes at ${offset}) lies outside its ${src.size}-byte source`);
  return { size, read: (o, n) => (o < 0 || n < 0 || o + n > size ? fail(`${what}: read of ${n} bytes at ${o} runs past its ${size} bytes`) : src.read(offset + o, n)) };
}

const SECTOR = 512;

/** The partitions of a GPT disk by name (UEFI 2.10 §5.3): each a region of the disk. */
export function gptPartitions(disk: ByteSource): Map<string, ByteSource> {
  const header = disk.read(SECTOR, 92);
  if (ascii(header.subarray(0, 8)) !== 'EFI PART') fail('not a GPT disk: no "EFI PART" header at LBA 1');
  const d = view(header);
  const entriesAt = u64(d, 72) * SECTOR;
  const count = d.getUint32(80, true);
  const size = d.getUint32(84, true);
  if (size < 128 || count > 1024) fail(`GPT: ${count} partition entries of ${size} bytes is not a partition table Dragon reads`);
  const table = disk.read(entriesAt, count * size);
  const out = new Map<string, ByteSource>();
  for (let i = 0; i < count; i++) {
    const e = table.subarray(i * size, (i + 1) * size);
    if (e.subarray(0, 16).every((b) => b === 0)) continue;
    const ed = view(e);
    const first = u64(ed, 32);
    const last = u64(ed, 40);
    const name = new TextDecoder('utf-16le').decode(e.subarray(56, 128)).split('\0')[0] as string;
    if (last < first) fail(`GPT partition ${name}: last LBA ${last} before first ${first}`);
    if (out.has(name)) fail(`GPT: two partitions are named ${name}`);
    out.set(name, slice(disk, first * SECTOR, (last - first + 1) * SECTOR, `GPT partition ${name}`));
  }
  return out;
}

const LP_RESERVED = 4096;
const LP_GEOMETRY_MAGIC = 0x616c4467;
const LP_METADATA_MAGIC = 0x414c5030;
const LP_TARGET_LINEAR = 0;

/**
 * The logical partitions of a dynamic-partition "super" partition (AOSP system/core/fs_mgr/liblp, metadata_format.h): the primary
 * geometry, then the slot-0 metadata, whose header and tables checksums are checked; each partition is its linear extents in order.
 */
export function superPartitions(sup: ByteSource): Map<string, ByteSource> {
  const g = view(sup.read(LP_RESERVED, 52));
  if (g.getUint32(0, true) !== LP_GEOMETRY_MAGIC) fail('super: no liblp geometry magic at 4096');
  const maxMetadata = g.getUint32(40, true);
  const at = LP_RESERVED + 2 * 4096;
  const fixed = sup.read(at, 128);
  const h = view(fixed);
  if (h.getUint32(0, true) !== LP_METADATA_MAGIC) fail('super: no liblp metadata header magic');
  const major = h.getUint16(4, true);
  const headerSize = h.getUint32(8, true);
  if (major !== 10 || headerSize < 128 || headerSize > maxMetadata) fail(`super: liblp metadata ${major}.x with a ${headerSize}-byte header is not the format Dragon reads (10.x)`);
  const header = sup.read(at, headerSize);
  const checked = new Uint8Array(header);
  checked.fill(0, 12, 44);
  if (sha256(checked) !== Buffer.from(header.subarray(12, 44)).toString('hex')) fail('super: the liblp metadata header checksum does not match');
  const tablesSize = h.getUint32(44, true);
  const tables = sup.read(at + headerSize, tablesSize);
  if (sha256(tables) !== Buffer.from(header.subarray(48, 80)).toString('hex')) fail('super: the liblp metadata tables checksum does not match');
  const desc = (o: number): { offset: number; count: number; size: number } => ({ offset: h.getUint32(o, true), count: h.getUint32(o + 4, true), size: h.getUint32(o + 8, true) });
  const parts = desc(80);
  const extents = desc(92);
  const td = view(tables);
  const extentList = Array.from({ length: extents.count }, (_, i) => {
    const o = extents.offset + i * extents.size;
    return { sectors: u64(td, o), type: td.getUint32(o + 8, true), data: u64(td, o + 12), source: td.getUint32(o + 20, true) };
  });
  const out = new Map<string, ByteSource>();
  for (let i = 0; i < parts.count; i++) {
    const o = parts.offset + i * parts.size;
    const name = ascii(tables.subarray(o, o + 36)).split('\0')[0] as string;
    const first = td.getUint32(o + 40, true);
    const n = td.getUint32(o + 44, true);
    const own = extentList.slice(first, first + n);
    if (own.length !== n) fail(`super: partition ${name} names extents past the extent table`);
    if (own.some((e) => e.type !== LP_TARGET_LINEAR || e.source !== 0)) fail(`super: partition ${name} has an extent that is not linear on the super device itself`);
    const pieces = own.map((e) => slice(sup, e.data * SECTOR, e.sectors * SECTOR, `super partition ${name}`));
    out.set(name, concat(pieces, name));
  }
  return out;
}

function concat(pieces: readonly ByteSource[], what: string): ByteSource {
  if (pieces.length === 1) return pieces[0] as ByteSource;
  const size = pieces.reduce((s, p) => s + p.size, 0);
  return {
    size,
    read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > size) fail(`${what}: read of ${length} bytes at ${offset} runs past its ${size} bytes`);
      const out = new Uint8Array(length);
      let base = 0;
      let done = 0;
      for (const p of pieces) {
        const from = Math.max(offset + done, base);
        if (done < length && from < base + p.size) {
          const n = Math.min(base + p.size - from, length - done);
          out.set(p.read(from - base, n), done);
          done += n;
        }
        base += p.size;
      }
      return out;
    },
  };
}

const EXT4_MAGIC = 0xef53;
const INCOMPAT_64BIT = 0x80;
const INCOMPAT_EXTENTS = 0x40;
const INCOMPAT_ENCRYPT = 0x10000;
// Inline data (0x8000) is refused per inode in contents(), so an image that uses it only for files Dragon does not read still opens.
const INCOMPAT_SUPPORTED = 0x2 | INCOMPAT_EXTENTS | INCOMPAT_64BIT | 0x200 | 0x8000;
const ENCRYPT_FL = 0x800;
const EXTENTS_FL = 0x80000;
const INLINE_DATA_FL = 0x10000000;
const EXTENT_MAGIC = 0xf30a;
const S_IFMT = 0xf000;
const S_IFDIR = 0x4000;
const S_IFREG = 0x8000;
const S_IFLNK = 0xa000;

/** One file system entry: its inode's kind and size. */
export type Ext4Inode = { readonly number: number; readonly kind: 'file' | 'directory' | 'symlink' | 'other'; readonly size: number; readonly flags: number; readonly block: Uint8Array };

/**
 * A read-only ext4 file system (the kernel's Documentation/filesystems/ext4): files by absolute path, read through extent trees.
 * An incompatible feature Dragon does not read (encryption, inline data in a file it reads, ...) is refused by name.
 */
export class Ext4 {
  readonly blockSize: number;
  private readonly inodesPerGroup: number;
  private readonly inodeSize: number;
  private readonly descSize: number;
  private readonly firstDataBlock: number;
  private readonly groups: number;

  private readonly src: ByteSource;
  private readonly what: string;

  constructor(src: ByteSource, what: string) {
    this.src = src;
    this.what = what;
    const sb = view(src.read(1024, 1024));
    if (sb.getUint16(56, true) !== EXT4_MAGIC) fail(`${what}: not an ext4 file system`);
    const incompat = sb.getUint32(96, true);
    if ((incompat & INCOMPAT_ENCRYPT) !== 0) fail(`${what}: ext4 encryption (incompatible feature 0x${INCOMPAT_ENCRYPT.toString(16)}) is not read by Dragon`);
    const unknown = incompat & ~INCOMPAT_SUPPORTED;
    if (unknown !== 0) fail(`${what}: ext4 incompatible features 0x${unknown.toString(16)} are not read by Dragon`);
    this.blockSize = 1024 << sb.getUint32(24, true);
    this.inodesPerGroup = sb.getUint32(40, true);
    this.inodeSize = sb.getUint16(88, true);
    this.descSize = (incompat & INCOMPAT_64BIT) !== 0 ? sb.getUint16(254, true) : 32;
    this.firstDataBlock = sb.getUint32(20, true);
    const blocks = sb.getUint32(4, true) + ((incompat & INCOMPAT_64BIT) !== 0 ? sb.getUint32(0x150, true) * 2 ** 32 : 0);
    this.groups = Math.ceil((blocks - this.firstDataBlock) / sb.getUint32(32, true));
    if (this.inodeSize < 128 || this.descSize < 32 || this.blockSize > 65536) fail(`${what}: inode size ${this.inodeSize} or descriptor size ${this.descSize} is not ext4's`);
  }

  inode(n: number): Ext4Inode {
    const group = Math.floor((n - 1) / this.inodesPerGroup);
    if (n < 1 || group >= this.groups) fail(`${this.what}: inode ${n} is outside the file system`);
    const gd = view(this.src.read((this.firstDataBlock + 1) * this.blockSize + group * this.descSize, this.descSize));
    const table = gd.getUint32(8, true) + (this.descSize >= 64 ? gd.getUint32(0x28, true) * 2 ** 32 : 0);
    const raw = this.src.read(table * this.blockSize + ((n - 1) % this.inodesPerGroup) * this.inodeSize, 128);
    const d = view(raw);
    const mode = d.getUint16(0, true) & S_IFMT;
    const kind = mode === S_IFDIR ? 'directory' : mode === S_IFREG ? 'file' : mode === S_IFLNK ? 'symlink' : 'other';
    return { number: n, kind, size: d.getUint32(4, true) + d.getUint32(0x6c, true) * 2 ** 32, flags: d.getUint32(0x20, true), block: raw.subarray(0x28, 0x28 + 60) };
  }

  /** The inode's bytes, its whole size; a sparse or unwritten extent reads as zeros. */
  contents(ino: Ext4Inode): Uint8Array {
    if ((ino.flags & ENCRYPT_FL) !== 0) fail(`${this.what}: inode ${ino.number} is encrypted, which Dragon does not read`);
    if (ino.kind === 'symlink' && ino.size < 60 && (ino.flags & EXTENTS_FL) === 0) return ino.block.slice(0, ino.size);
    if ((ino.flags & INLINE_DATA_FL) !== 0) fail(`${this.what}: inode ${ino.number} keeps its data inline, which Dragon does not read`);
    if ((ino.flags & EXTENTS_FL) === 0) fail(`${this.what}: inode ${ino.number} uses block maps, not extents, which Dragon does not read`);
    const out = new Uint8Array(ino.size);
    const walk = (node: Uint8Array, depth: number): void => {
      const d = view(node);
      if (d.getUint16(0, true) !== EXTENT_MAGIC) fail(`${this.what}: inode ${ino.number} has a bad extent header`);
      const entries = d.getUint16(2, true);
      const level = d.getUint16(6, true);
      if (level !== depth && depth >= 0) fail(`${this.what}: inode ${ino.number} extent depth ${level}, expected ${depth}`);
      for (let i = 0; i < entries; i++) {
        const o = 12 + i * 12;
        if (level === 0) {
          const logical = d.getUint32(o, true);
          let len = d.getUint16(o + 4, true);
          const unwritten = len > 32768;
          if (unwritten) len -= 32768;
          const physical = d.getUint16(o + 6, true) * 2 ** 32 + d.getUint32(o + 8, true);
          const start = logical * this.blockSize;
          if (unwritten || start >= ino.size) continue;
          const n = Math.min(len * this.blockSize, ino.size - start);
          out.set(this.src.read(physical * this.blockSize, n), start);
        } else {
          const leaf = d.getUint32(o + 4, true) + d.getUint16(o + 8, true) * 2 ** 32;
          walk(this.src.read(leaf * this.blockSize, this.blockSize), level - 1);
        }
      }
    };
    walk(ino.block, view(ino.block).getUint16(6, true));
    return out;
  }

  /** A directory's entries by name (linear scan; an htree's index blocks read as empty entries). */
  entries(dir: Ext4Inode): Map<string, number> {
    if (dir.kind !== 'directory') fail(`${this.what}: inode ${dir.number} is not a directory`);
    const bytes = this.contents(dir);
    const d = view(bytes);
    const out = new Map<string, number>();
    for (let o = 0; o + 8 <= bytes.length;) {
      const inode = d.getUint32(o, true);
      const rec = d.getUint16(o + 4, true);
      const len = d.getUint8(o + 6);
      if (rec < 8 || o + rec > bytes.length) fail(`${this.what}: directory ${dir.number} has a bad entry at ${o}`);
      if (inode !== 0 && len > 0) out.set(new TextDecoder().decode(bytes.subarray(o + 8, o + 8 + len)), inode);
      o += rec;
    }
    return out;
  }

  /** The inode at an absolute path, following symlinks in its directories (not past the file system's root); null when absent. */
  lookup(path: string): Ext4Inode | null {
    if (!path.startsWith('/')) fail(`${this.what}: ${path} is not an absolute path`);
    let at = this.inode(2);
    const parts = path.split('/').filter((p) => p !== '');
    for (const [k, name] of parts.entries()) {
      const n = this.entries(at).get(name);
      if (n === undefined) return null;
      at = this.inode(n);
      if (at.kind === 'symlink' && k < parts.length - 1) fail(`${this.what}: ${path} passes through the symlink ${name}, which Dragon does not follow`);
    }
    return at;
  }

  /** A regular file's bytes; a missing path or one that is not a regular file is refused by name. */
  readFile(path: string): Uint8Array {
    const ino = this.lookup(path);
    if (ino === null) fail(`${this.what}: no ${path}`);
    if ((ino as Ext4Inode).kind !== 'file') fail(`${this.what}: ${path} is a ${(ino as Ext4Inode).kind}, not a regular file`);
    return this.contents(ino as Ext4Inode);
  }

  /** A directory's regular files' names. */
  list(path: string): string[] {
    const ino = this.lookup(path);
    if (ino === null) fail(`${this.what}: no ${path}`);
    return [...this.entries(ino as Ext4Inode)].filter(([, n]) => this.inode(n).kind === 'file').map(([name]) => name).sort();
  }
}

/**
 * An emulator system image's logical partition file systems by name (system, product, ...), each as Android mounts it: the system
 * partition is system-as-root, so its files are under /system/ inside it.
 */
export function androidImagePartitions(disk: ByteSource): Map<string, Ext4> {
  const sup = gptPartitions(disk).get('super');
  if (sup === undefined) fail('the system image has no "super" GPT partition (dynamic partitions)');
  const out = new Map<string, Ext4>();
  for (const [name, src] of superPartitions(sup as ByteSource)) {
    if (src.size < 2048) continue;
    if (view(src.read(1024 + 56, 2)).getUint16(0, true) !== EXT4_MAGIC) continue;
    out.set(name, new Ext4(src, `logical partition ${name}`));
  }
  return out;
}
