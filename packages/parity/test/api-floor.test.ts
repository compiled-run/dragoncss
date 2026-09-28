// P4 item 7 (notes/T013-p3-review-p4-plan.md section 2): the Android API floor check over dexdump output and api-versions.xml. A
// member referenced through an app subclass resolves to the android class that declares it; anything above minSdk is named.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFloor, parseApiVersions, parseDexdump } from '../src/api-floor.ts';

const API = `<?xml version="1.0" encoding="utf-8"?>
<api version="3">
	<class name="android/content/Context" since="1">
		<extends name="java/lang/Object"/>
		<method name="getDisplay()Landroid/view/Display;" since="30"/>
		<method name="getAssets()Landroid/content/res/AssetManager;"/>
	</class>
	<class name="android/app/Activity" since="1">
		<extends name="android/content/Context"/>
		<method name="finish()V"/>
	</class>
	<class name="android/view/View" since="1">
		<extends name="java/lang/Object"/>
		<method name="layout(IIII)V"/>
		<method name="setClipBounds(Landroid/graphics/Rect;)V" since="18"/>
		<field name="clipBounds" since="31"/>
	</class>
	<class name="android/graphics/fonts/Font" since="29">
		<extends name="java/lang/Object"/>
		<method name="getBuffer()Ljava/nio/ByteBuffer;"/>
	</class>
	<class name="android/window/Brand" since="33"/>
</api>`;

const DEX = `Class #0            -
  Class descriptor  : 'Ldev/dragon/host/DragonActivity;'
  Access flags      : 0x0011 (PUBLIC FINAL)
  Superclass        : 'Landroid/app/Activity;'
  Interfaces        -
  Static fields     -
  Instance fields   -
  Direct methods    -
    #0              : (in Ldev/dragon/host/DragonActivity;)
      name          : '<init>'
      type          : '()V'
  Virtual methods   -
    #0              : (in Ldev/dragon/host/DragonActivity;)
      name          : 'runCase'
      type          : '(I)V'
      insns size    : 4 16-bit code units
0001f0:                                        |[0001f0] dev.dragon.host.DragonActivity.runCase:(I)V
0001f4: 6e10 0000 0100                         |0000: invoke-virtual {v1}, Ldev/dragon/host/DragonActivity;.finish:()V // method@0000
0001fa: 6e10 0100 0100                         |0003: invoke-virtual {v1}, Ldev/dragon/host/DragonActivity;.runCase:(I)V // method@0001
000200: 6e10 0100 0100                         |0006: invoke-virtual {v2}, Landroid/view/View;.layout:(IIII)V // method@0002
000206: 2200 0300                              |0009: new-instance v0, Landroid/graphics/fonts/Font; // type@0003
`;

describe('the Android API floor check', () => {
  it('resolves members through app classes and checks classes and members at minSdk 29', () => {
    const api = parseApiVersions(API);
    const dex = parseDexdump(DEX);
    expect(dex.classes.get('dev/dragon/host/DragonActivity')?.superclass).toBe('android/app/Activity');
    const r = checkFloor(api, dex, 29);
    expect(r.violations).toEqual([]);
    expect(r.checked).toBe(4);
  });
  it('an API 30 member reached through the app activity is named; an API 33 class is named; minSdk 30 accepts the member', () => {
    const api = parseApiVersions(API);
    const planted = `${DEX}000210: 6e10 0200 0100                         |000c: invoke-virtual {v1}, Ldev/dragon/host/DragonActivity;.getDisplay:()Landroid/view/Display; // method@0003
000216: 2200 0400                              |000f: new-instance v0, Landroid/window/Brand; // type@0004
000220: 5410 0500                              |0012: iget-object v0, v1, Landroid/view/View;.clipBounds:Landroid/graphics/Rect; // field@0005
`;
    const r = checkFloor(api, parseDexdump(planted), 29);
    expect(r.violations.map((v) => v.ref)).toEqual(['android.content.Context#getDisplay()Landroid/view/Display;', 'android.window.Brand', 'android.view.View#clipBounds']);
    expect(r.violations[0]?.since).toBe(30);
    expect(checkFloor(api, parseDexdump(planted), 33).violations.map((v) => v.ref)).toEqual([]);
  });
  it('a member the SDK does not describe is a violation, never a pass', () => {
    const api = parseApiVersions(API);
    const r = checkFloor(api, parseDexdump(`${DEX}000230: 6e10 0600 0100   |0015: invoke-virtual {v2}, Landroid/view/View;.hiddenThing:()V // method@0006\n`), 29);
    expect(r.violations.map((v) => [v.ref, v.reason])).toEqual([['android.view.View#hiddenThing()V', 'member not in api-versions.xml']]);
  });
  it('reads the installed android-36 api-versions.xml when the SDK is present', () => {
    const home = process.env['ANDROID_HOME'];
    const file = home === undefined ? null : join(home, 'platforms', 'android-36', 'data', 'api-versions.xml');
    if (file === null || !existsSync(file)) {
      console.log('api-versions.xml: blocked (owner tooling): no ANDROID_HOME with platforms/android-36');
      return;
    }
    const api = parseApiVersions(readFileSync(file, 'utf8'));
    expect(api.get('android/text/StaticLayout$Builder')?.since).toBe(23);
    expect(api.get('android/graphics/fonts/Font')?.since).toBe(29);
    expect(api.get('android/content/Context')?.methods.get('getDisplay()Landroid/view/Display;')).toBe(30);
  });
});
