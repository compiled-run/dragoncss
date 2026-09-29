"""Normalise segmented glyphs to font units and trace them with potrace.
Per-sheet linear transform (scale + baseline) from sheet-level medians:
  caps   -> median ink bottom..top = 0..CAP
  lower  -> non-descender bottoms = 0, x-letter tops = XH
  digits -> 0..DIG
  punct  -> scale from median stem width (= lowercase stem), fixed anchors.
Outputs traced/<glyph>.json: {"contours":[[["M",x,y],["L",x,y],["C",x1,y1,x2,y2,x,y]...]], "bbox":[...]}"""
import json, os, re, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XH, CAP, DIG = 470, 720, 650
T_TURD, T_ALPHA, T_OPT = '12', '0.75', '0.3'
UP = 3  # supersample factor before thresholding
X_SET = set('acemnorsuvwxz')
DESC = set('gjpqy')

def load(sheet):
    a = np.asarray(Image.open(os.path.join(ROOT,'sheets',sheet+'.png')).convert('L'))
    return a

def stem_px(mask):
    runs=[]
    for y in range(0, mask.shape[0], 3):
        row=mask[y]; d=np.diff(np.concatenate([[0],row.astype(np.int8),[0]]))
        s=np.where(d==1)[0]; e=np.where(d==-1)[0]
        runs += list(e-s)
    runs=np.array([r for r in runs if r>=15])
    if len(runs)==0: return None
    h,edges=np.histogram(runs,bins=range(15,int(runs.max())+3,2))
    i=h.argmax(); return (edges[i]+edges[i+1])/2

def sheet_transform(sheet, boxes, a):
    """return (scale, baseline_y_px)"""
    b=boxes[sheet]; labs=list(b)
    top=lambda l:b[l]['y0']; bot=lambda l:b[l]['y1']
    kind=sheet.rstrip('0123456789abcdefghijklmnopqrstuvwxyz_')  # up/low/dig/pun (allow suffixes like up2b)
    kind=re.match(r'(up|low|dig|pun|fix)',sheet).group(1)
    if kind=='fix': kind=FIXKIND.get(sheet,'up')
    if kind=='up':
        t=np.median([top(l) for l in labs]); bl=np.median([bot(l) for l in labs if l not in 'JQ'])
        return CAP/(bl-t), bl
    if kind=='dig':
        t=np.median([top(l) for l in labs]); bl=np.median([bot(l) for l in labs])
        return DIG/(bl-t), bl
    if kind=='low':
        nd=[l for l in labs if l not in DESC]; xs=[l for l in labs if l in X_SET]
        bl=np.median([bot(l) for l in nd])
        if xs: t=np.median([top(l) for l in xs])
        else: t=None
        if t is None: raise SystemExit('no x-letters on '+sheet)
        return XH/(bl-t), bl
    # punctuation: stem-based scale
    m=a<128; st=stem_px(m); s=LC_STEM/st
    if 'period' in b: bl=bot('period')-8/s
    elif 'parenleft' in b: bl=(top('parenleft')+bot('parenleft'))/2 + 290/s
    elif 'bracketleft' in b: bl=(top('bracketleft')+bot('bracketleft'))/2 + 290/s
    else: raise SystemExit('no anchor for '+sheet)
    return s, bl

NUM=re.compile(r'[MmCcLlZz]|-?\d+(?:\.\d+)?')
def parse_potrace(svg):
    """parse potrace svg (units px*10, y up from bitmap bottom via transform)"""
    g=re.search(r'translate\(([\d.]+),([\d.]+)\) scale\(([\d.]+),(-[\d.]+)\)',svg)
    sx,sy=float(g.group(3)),float(g.group(4)); H=float(g.group(2))
    contours=[]
    for d in re.findall(r' d="([^"]+)"',svg):
        toks=NUM.findall(d); i=0; cmd=None; cx=cy=0; cur=None
        while i<len(toks):
            t=toks[i]
            if t in 'MmCcLlZz':
                cmd=t; i+=1
                if t in 'Zz':
                    if cur: contours.append(cur); cur=None
                continue
            if cmd in 'Mm':
                x,y=float(toks[i]),float(toks[i+1]); i+=2
                if cmd=='m': x+=cx; y+=cy
                if cur: contours.append(cur)
                cur=[['M',x,y]]; cx,cy=x,y; cmd='l' if cmd=='m' else 'L'
            elif cmd in 'Ll':
                x,y=float(toks[i]),float(toks[i+1]); i+=2
                if cmd=='l': x+=cx; y+=cy
                cur.append(['L',x,y]); cx,cy=x,y
            elif cmd in 'Cc':
                v=[float(toks[i+k]) for k in range(6)]; i+=6
                if cmd=='c': v=[v[0]+cx,v[1]+cy,v[2]+cx,v[3]+cy,v[4]+cx,v[5]+cy]
                cur.append(['C']+v); cx,cy=v[4],v[5]
        if cur: contours.append(cur)
    # convert to bitmap px, y measured from TOP of bitmap
    out=[]
    for c in contours:
        cc=[]
        for seg in c:
            pts=seg[1:]
            conv=[]
            for k in range(0,len(pts),2):
                conv += [pts[k]*sx, H+pts[k+1]*sy]
            cc.append([seg[0]]+conv)
        out.append(cc)
    return out

def smooth_noise(rng, shape, cell):
    n=rng.normal(0,1,(shape[0]//cell+3, shape[1]//cell+3)).astype(np.float32)
    n=np.asarray(Image.fromarray(n).resize((shape[1]+3*cell, shape[0]+3*cell), Image.BICUBIC))[:shape[0],:shape[1]]
    return n/ (n.std()+1e-6)

def erode(m, r):
    out=m.copy()
    for dy in range(-r,r+1,max(1,r//3)):
        for dx in range(-r,r+1,max(1,r//3)):
            if dx*dx+dy*dy<=r*r: out&=np.roll(np.roll(m,dy,0),dx,1)
    return out

def inkify(mask, upx, amount, seed):
    """Printed-ink texture. upx = font units per bitmap px. amount scales everything.
    1) smooth displacement of the edge (~amount*3 units), 2) a few small ink gaps (specks) inside heavy strokes."""
    rng=np.random.default_rng(seed)
    H,W=mask.shape
    amp=1.1*amount/upx                      # displacement in px
    cell=max(4,int(40/upx))                 # wobble wavelength ~22 units
    dx=smooth_noise(rng,(H,W),cell)*amp; dy=smooth_noise(rng,(H,W),cell)*amp
    yy,xx=np.mgrid[0:H,0:W]
    sx=np.clip((xx+dx).round().astype(int),0,W-1); sy=np.clip((yy+dy).round().astype(int),0,H-1)
    m=mask[sy,sx]
    # specks: only where the stroke is thick (>= ~70 units)
    inner=erode(m, max(2,int(35/upx)))
    ys,xs=np.where(inner)
    if len(ys):
        k=int(len(ys)*upx*upx/14000*amount)+ (1 if rng.random()<0.5*amount else 0)
        for i in rng.choice(len(ys), size=min(k,len(ys)), replace=False):
            r=rng.uniform(4,9)*amount/upx; e=rng.uniform(0.5,1.0); a=rng.uniform(0,np.pi)
            cy,cx=ys[i],xs[i]; R=int(r)+2
            y0,y1,x0,x1=max(0,cy-R),min(H,cy+R+1),max(0,cx-R),min(W,cx+R+1)
            Y,X=np.mgrid[y0:y1,x0:x1]; u=(X-cx)*np.cos(a)+(Y-cy)*np.sin(a); v=-(X-cx)*np.sin(a)+(Y-cy)*np.cos(a)
            m[y0:y1,x0:x1]&=~((u/r)**2+(v/(r*e))**2<=1)
    return m

def trace_glyph(a, box, s, bl, rough=0.0, seed=0):
    x0,x1,y0,y1=box['x0'],box['x1'],box['y0'],box['y1']
    pad=6
    crop=a[max(0,y0-pad):y1+pad, max(0,x0-pad):x1+pad]
    oy=max(0,y0-pad); ox=max(0,x0-pad)
    im=Image.fromarray(crop).resize((crop.shape[1]*UP,crop.shape[0]*UP),Image.LANCZOS)
    g=np.asarray(im).astype(np.float32)
    mask=g<128
    if rough>0:
        mask=inkify(mask, s/UP, rough, seed)
    # keep only ink that belongs to this column band (drop neighbour spill at pad)
    bmp=Image.fromarray(np.where(mask,0,255).astype(np.uint8)).convert('1')
    with tempfile.TemporaryDirectory() as td:
        p=os.path.join(td,'g.pbm'); bmp.save(p)
        subprocess.run(['potrace','-b','svg','-t',T_TURD,'-a',T_ALPHA,'-O',T_OPT,'-o',p+'.svg',p],check=True)
        svg=open(p+'.svg').read()
    cons=parse_potrace(svg)
    res=[]
    for c in cons:
        cc=[]
        for seg in c:
            v=seg[1:]; o=[]
            for k in range(0,len(v),2):
                px=v[k]/UP+ox; py=v[k+1]/UP+oy
                o += [round((px-x0)*s,1), round((bl-py)*s,1)]
            cc.append([seg[0]]+o)
        res.append(cc)
    return res

FIXKIND={}
LC_STEM=106
if __name__=='__main__':
    boxes=json.load(open(os.path.join(ROOT,'glyphs','boxes.json')))
    src=json.load(open(os.path.join(ROOT,'sources.json')))  # glyph -> sheet
    FIXKIND.update(src.get('_fixkind',{}))
    rough=float(os.environ.get('ROUGH','0'))
    os.makedirs(os.path.join(ROOT,'traced'),exist_ok=True)
    tf={}; report={}
    for g,sheet in src.items():
        if g.startswith('_'): continue
        if sheet not in tf:
            a=load(sheet); tf[sheet]=(a,)+sheet_transform(sheet,boxes,a)
            m=a<128; st=stem_px(m)
            report[sheet]={'scale':round(tf[sheet][1],3),'stem_units':round(st*tf[sheet][1],1)}
        a,s,bl=tf[sheet]
        cons=trace_glyph(a,boxes[sheet][g],s,bl,rough,seed=sum(ord(c)*(i+1) for i,c in enumerate(g)))
        json.dump({'contours':cons,'sheet':sheet},open(os.path.join(ROOT,'traced',(g+'_' if len(g)==1 and g.isupper() else g)+'.json'),'w'))
    for k,v in report.items(): print(k,v)
