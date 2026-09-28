"""Build Dragon Blackletter with FontForge from traced/*.json.
Run: fontforge -lang=py -script tools/build_font.py"""
import fontforge, psMat, json, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, '..', 'fonts', 'dragon-blackletter')
os.makedirs(OUT, exist_ok=True)
XH, CAP = 470, 720
SB = json.load(open(os.path.join(ROOT, 'tools', 'spacing.json')))

f = fontforge.font()
f.encoding = 'UnicodeFull'
f.em = 1000
f.ascent, f.descent = 780, 220
f.fontname = 'DragonBlackletter-Regular'
f.familyname = 'Dragon Blackletter'
f.fullname = 'Dragon Blackletter'
f.weight = 'Regular'
f.version = '1.000'
f.copyright = 'Copyright (c) 2026 the Dragon CSS project. Released under the MIT License, the same licence as Dragon CSS.'
f.appendSFNTName('English (US)', 'License', 'MIT License. Permission is hereby granted, free of charge, to any person obtaining a copy of this font software, to deal in it without restriction, subject to including the copyright notice. Same licence as the Dragon CSS project.')
f.appendSFNTName('English (US)', 'License URL', 'https://opensource.org/license/mit')
f.appendSFNTName('English (US)', 'Designer', 'Dragon CSS project (drawn from the Dragon CSS hero wordmark)')
f.appendSFNTName('English (US)', 'Descriptor', 'Blackletter display face drawn from the hero lettering of Dragon CSS.')

names = {'period':'.', 'comma':',', 'colon':':', 'semicolon':';', 'exclam':'!', 'question':'?',
 'quotesingle':"'", 'quotedbl':'"', 'hyphen':'-', 'parenleft':'(', 'parenright':')', 'ampersand':'&',
 'slash':'/', 'at':'@', 'numbersign':'#', 'asterisk':'*', 'plus':'+', 'equal':'=', 'less':'<',
 'greater':'>', 'bracketleft':'[', 'bracketright':']', 'braceleft':'{', 'braceright':'}',
 'periodcentered':'·'}
digitnames = ['zero','one','two','three','four','five','six','seven','eight','nine']

def cls(key):
    if len(key)==1 and key.isupper(): return 'upper'
    if len(key)==1 and key.islower(): return 'lower'
    if len(key)==1 and key.isdigit(): return 'digit'
    return 'punct'

count = 0
for path in sorted(glob.glob(os.path.join(ROOT, 'traced', '*.json'))):
    key = os.path.basename(path)[:-5]
    if key.endswith('_'): key = key[:-1]
    data = json.load(open(path))
    ch = names.get(key, key)
    gn = digitnames[int(key)] if key.isdigit() else (key if key in names else ch)
    g = f.createChar(ord(ch), gn)
    pen = g.glyphPen()
    for c in data['contours']:
        for seg in c:
            if seg[0]=='M': pen.moveTo((seg[1], seg[2]))
            elif seg[0]=='L': pen.lineTo((seg[1], seg[2]))
            else: pen.curveTo((seg[1],seg[2]),(seg[3],seg[4]),(seg[5],seg[6]))
        pen.closePath()
    pen = None
    raw = g.boundingBox(); keep = g.foreground.dup()
    g.removeOverlap(); g.correctDirection()
    g.addExtrema(); g.round()
    bb = g.boundingBox()
    if any(abs(u - v) > 4 for u, v in zip(bb, raw)):  # cleanup went wrong: fall back to the raw trace
        print('WARN cleanup changed bbox of', key, [round(v) for v in raw], '->', [round(v) for v in bb])
        g.foreground = keep; g.correctDirection(); g.round()
    if key in SB.get('_xscale', {}):  # horizontal-only rescale (keeps stroke thickness of horizontals)
        g.transform(psMat.scale(SB['_xscale'][key], 1))
    c = cls(key)
    sb = SB.get(key, SB['_' + c])
    g.left_side_bearing = int(sb[0]); g.right_side_bearing = int(sb[1])
    count += 1

sp = f.createChar(32, 'space'); sp.width = SB['_space']
nb = f.createChar(0xA0, 'uni00A0'); nb.width = SB['_space']
# typographic quotes/dashes reuse drawn marks
for code, name, src in [(0x2019,'quoteright','quotesingle'),(0x2018,'quoteleft','quotesingle'),
                        (0x201D,'quotedblright','quotedbl'),(0x201C,'quotedblleft','quotedbl'),
                        (0x2013,'endash','hyphen'),(0x2022,'bullet','periodcentered')]:
    if src in f:
        g = f.createChar(code, name); g.addReference(src); g.width = f[src].width
        if name == 'endash':
            g.clear(); g.addReference('hyphen', psMat.scale(1.35, 1)); g.unlinkRef(); g.width = int(f['hyphen'].width*1.35)

# vertical metrics
f.os2_version = 4
f.os2_typoascent, f.os2_typodescent, f.os2_typolinegap = 820, -230, 150
f.os2_winascent, f.os2_windescent = 820, 230
f.hhea_ascent, f.hhea_descent, f.hhea_linegap = 820, -230, 150
f.os2_use_typo_metrics = True
f.os2_winascent_add = f.os2_windescent_add = f.os2_typoascent_add = f.os2_typodescent_add = f.hhea_ascent_add = f.hhea_descent_add = False
f.os2_xheight, f.os2_capheight = XH, CAP
f.os2_vendor = 'DRGN'

# kerning: FontForge auto-kern for letter pairs, then manual overrides
f.addLookup('kern', 'gpos_pair', (), (('kern', (('latn', ('dflt',)), ('DFLT', ('dflt',)))),))
f.addLookupSubtable('kern', 'kern-1')
lower = [c for c in 'abcdefghijklmnopqrstuvwxyz']
upper = [c for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
K = json.load(open(os.path.join(ROOT, 'tools', 'kerning.json')))

def polyline(g):
    """flatten outlines to polygons"""
    polys = []
    for c in g.foreground:
        pts = list(c); n = len(pts); out = []
        i = 0
        # rotate so we start on an on-curve point
        while not pts[0].on_curve: pts = pts[1:] + pts[:1]
        k = 0
        while k < n:
            p0 = pts[k % n]
            if pts[(k+1) % n].on_curve:
                out.append((p0.x, p0.y)); k += 1
            else:
                p1, p2, p3 = pts[(k+1) % n], pts[(k+2) % n], pts[(k+3) % n]
                for t in [j/12 for j in range(12)]:
                    mt = 1-t
                    out.append((mt**3*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t**3*p3.x,
                                mt**3*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t**3*p3.y))
                k += 3
        polys.append(out)
    return polys

def profile(g, ys):
    """leftmost/rightmost ink x at each y (None if no ink)"""
    polys = polyline(g); L = []; R = []
    for y in ys:
        xs = []
        for P in polys:
            for (x1, y1), (x2, y2) in zip(P, P[1:] + P[:1]):
                if (y1 <= y < y2) or (y2 <= y < y1):
                    xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        L.append(min(xs) if xs else None); R.append(max(xs) if xs else None)
    return L, R

BAND_LC = [60 + 10*i for i in range(36)]        # 60..410: x-height band
BAND_UC = [60 + 10*i for i in range(61)]        # 60..660: cap band
prof = {}
for n in lower + upper:
    prof[n] = {'lc': profile(f[n], BAND_LC), 'uc': profile(f[n], BAND_UC)}

CAP_GAP = K['_cap_gap']
def metric(a, b, band):
    La, Ra = prof[a][band]; Lb, Rb = prof[b][band]; wa = f[a].width
    gaps = [min((wa - r) + l, CAP_GAP) for r, l in zip(Ra, Lb) if r is not None and l is not None]
    if not gaps: return None
    return 0.55 * sum(gaps) / len(gaps) + 0.45 * min(gaps)

ref_lc = metric('n', 'n', 'lc'); ref_uc = metric('H', 'H', 'uc')
kerns = {}
for a in upper + lower:
    for b in upper + lower:
        band = 'uc' if (a in upper and b in upper) else 'lc'
        m = metric(a, b, band)
        if m is None: continue
        k = round((ref_uc if band == 'uc' else ref_lc) - m)
        k = max(K['_min'], min(K['_max'], k))
        if abs(k) >= K['_threshold']: kerns[a + b] = int(k)
kerns.update(K['pairs'])
for pair, v in kerns.items():
    f[pair[0]].addPosSub('kern-1', pair[1], v)
print('kern pairs:', len(kerns), {p: kerns.get(p, 0) for p in ['Dr','ra','ag','go','on','CS','SS','Ta','ry','fo','rg','re']})

f.selection.all()
f.generate(os.path.join(OUT, 'DragonBlackletter-Regular.otf'), flags=('opentype',))
f.generate(os.path.join(OUT, 'DragonBlackletter-Regular.woff2'), flags=('opentype',))
f.save(os.path.join(ROOT, 'DragonBlackletter.sfd'))
print('glyphs drawn:', count, 'total in font:', len([g for g in f.glyphs() if g.unicode > 0]))
