// The Android system fonts at build time: /system/etc/fonts.xml and /system/fonts/* read out of the SDK's emulator system image
// (android-image.ts), cached under node_modules/.cache, and shaped with Dragon's HarfBuzz at the instance fonts.xml names.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
import { repoPath } from '../paths.ts';
import { androidImagePartitions, fileSource } from './android-image.ts';
import type { Ext4 } from './android-image.ts';
import { parseFontsXml } from './fonts-xml.ts';
import type { FontsXml } from './fonts-xml.ts';

/** The SDK package of the system image the proof emulator runs (the Pixel 7 AVD of EXPORT_DEVICES), whose fonts the export measures. */
export const ANDROID_SYSTEM_IMAGE = { api: 36, tag: 'google_apis', abi: 'arm64-v8a' } as const;

export class AndroidImageUnavailable extends Error {}

/** The system image file: DRAGON_ANDROID_SYSTEM_IMAGE, else the SDK's (ANDROID_HOME, ANDROID_SDK_ROOT, or ~/Library/Android/sdk). */
export function androidSystemImagePath(env: NodeJS.ProcessEnv = process.env): string {
  const own = env['DRAGON_ANDROID_SYSTEM_IMAGE'];
  if (own !== undefined && own !== '') return own;
  const sdk = env['ANDROID_HOME'] ?? env['ANDROID_SDK_ROOT'] ?? join(homedir(), 'Library/Android/sdk');
  const { api, tag, abi } = ANDROID_SYSTEM_IMAGE;
  const path = join(sdk, 'system-images', `android-${api}`, tag, abi, 'system.img');
  if (!existsSync(path)) throw new AndroidImageUnavailable(`Android system fonts are read from the SDK's system image at build time, and ${path} is not there: install it with \`sdkmanager "system-images;android-${api};${tag};${abi}"\` or set DRAGON_ANDROID_SYSTEM_IMAGE`);
  return path;
}

/** A file of the image's system partition, with its SHA-256. */
export type ImageFile = { readonly path: string; readonly bytes: Uint8Array; readonly sha256: string };

/**
 * The image's /system files, each read once and kept in node_modules/.cache/dragon-system-fonts/android-<key>, where the key is
 * the image's path, size and modification time; a cached file is checked against the SHA-256 recorded when it was read.
 */
export class AndroidSystemFiles {
  readonly image: string;
  private readonly dir: string;
  private system: Ext4 | null = null;

  constructor(image: string = androidSystemImagePath()) {
    this.image = image;
    const st = statSync(image);
    const key = createHash('sha256').update(`${image}\n${st.size}\n${st.mtimeMs}`).digest('hex').slice(0, 16);
    this.dir = repoPath(`node_modules/.cache/dragon-system-fonts/android-${key}`);
  }

  private fs(): Ext4 {
    if (this.system === null) {
      const system = androidImagePartitions(fileSource(this.image)).get('system');
      if (system === undefined) throw new AndroidImageUnavailable(`${this.image} has no ext4 system partition`);
      this.system = system;
    }
    return this.system;
  }

  /** A file under /system, by its path there ("/system/fonts/Roboto-Regular.ttf"). */
  read(path: string): ImageFile {
    const name = createHash('sha256').update(path).digest('hex').slice(0, 24);
    const file = join(this.dir, name);
    const meta = `${file}.sha256`;
    if (existsSync(file) && existsSync(meta)) {
      const bytes = new Uint8Array(readFileSync(file));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 === readFileSync(meta, 'utf8').trim()) return { path, bytes, sha256 };
    }
    const bytes = this.fs().readFile(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    mkdirSync(this.dir, { recursive: true });
    // Plan workers are threads of one process: the scratch name is the thread's own.
    const scratch = `${file}.${process.pid}-${threadId}`;
    writeFileSync(scratch, bytes);
    renameSync(scratch, file);
    writeFileSync(meta, `${sha256}\n`);
    return { path, bytes, sha256 };
  }

  fontsXml(): FontsXml {
    return parseFontsXml(new TextDecoder().decode(this.read('/system/etc/fonts.xml').bytes));
  }
}
