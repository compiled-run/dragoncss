"""Segment glyph sheets into per-glyph bitmaps via column projection.
Keeps the N-1 widest blank gaps so multi-part glyphs (i ; " =) stay whole.
Writes glyphs/<name>.png (ink crop) and glyphs/boxes.json (sheet coords)."""
import json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = {
  'sample': list('DragonCSS'),
  'up1': list('ABCDEFG'), 'up2': list('HIJKLMN'), 'up3': list('OPQRSTU'), 'up4': list('VWXYZ'),
  'low1': list('abcdefg'), 'low2': list('hijklmn'), 'low3': list('opqrstu'), 'low4': list('vwxyz'),
  'dig1': list('01234'), 'dig2': list('56789'), 'dig3': list('018'),
  'pun1': ['period','comma','colon','semicolon','exclam','question','quotesingle','quotedbl'],
  'pun2': ['hyphen','parenleft','parenright','ampersand','slash','at','numbersign','asterisk'],
  'pun3': ['plus','equal','less','greater','bracketleft','bracketright','braceleft','braceright','periodcentered'],
}
OVERRIDES = json.load(open(os.path.join(ROOT,'sheets','overrides.json'))) if os.path.exists(os.path.join(ROOT,'sheets','overrides.json')) else {}

def gname(ch):
    if len(ch) > 1: return ch
    if ch.isupper(): return ch + '_'   # case-safe filenames
    return ch

def ink(path):
    a = np.asarray(Image.open(path).convert('L')).astype(np.int16)
    m = a < 128
    m[:8,:]=m[-8:,:]=False; m[:,:8]=m[:,-8:]=False
    return m

def segment(name, labels):
    m = ink(os.path.join(ROOT,'sheets',name+'.png'))
    col = m.sum(0) >= 2
    runs=[]; x=0; W=len(col)
    while x < W:
        if col[x]:
            s=x
            while x < W and col[x]: x+=1
            runs.append([s,x])
        else: x+=1
    gaps = sorted(range(len(runs)-1), key=lambda i: runs[i+1][0]-runs[i][1], reverse=True)[:len(labels)-1]
    cuts = sorted(gaps)
    groups=[]; start=0
    for c in cuts:
        groups.append((runs[start][0], runs[c][1])); start=c+1
    groups.append((runs[start][0], runs[-1][1]))
    if len(groups)!=len(labels):
        print(name,'MISMATCH',len(groups),len(labels)); return {}
    out={}
    for (x0,x1),lab in zip(groups,labels):
        sub=m[:,x0:x1]; rows=np.where(sub.sum(1)>=1)[0]
        y0,y1=rows[0],rows[-1]+1
        crop=sub[y0:y1]
        key = name+':'+lab
        out[lab]={'sheet':name,'x0':int(x0),'x1':int(x1),'y0':int(y0),'y1':int(y1),'h':int(m.shape[0])}
        Image.fromarray(np.where(crop,0,255).astype(np.uint8)).save(os.path.join(ROOT,'glyphs',f'{name}__{gname(lab)}.png'))
    return out

if __name__=='__main__':
    os.makedirs(os.path.join(ROOT,'glyphs'),exist_ok=True)
    names = sys.argv[1:] or list(SHEETS)
    path=os.path.join(ROOT,'glyphs','boxes.json')
    boxes=json.load(open(path)) if os.path.exists(path) else {}
    for n in names:
        labels = OVERRIDES.get(n, SHEETS.get(n))
        boxes[n]=segment(n, labels)
        print(n, len(boxes[n]))
    json.dump(boxes,open(path,'w'),indent=1)
