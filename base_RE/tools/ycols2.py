import pickle, numpy as np
from shapely.geometry import Point
from shapely.prepared import prep
d=pickle.load(open('tmp/ycols.pkl','rb')); ys=d['ys']; SC=d['SC']; T=d['T']; dy=0.05
PC=[prep(c) for c in SC]; PT=[prep(t) for t in T]
keep=[]
for k,q in d['D']:
    # sample a few interior points; column height = levels the point stays in T above k
    pts=[q.representative_point()]
    hs=[]
    for p in pts:
        j=k
        while j+1<len(ys) and PT[j+1].contains(p): j+=1
        hs.append((j-k+1)*dy)
    h=min(hs)
    if h>=0.25: keep.append((k,q,h))
lv={}
for k,q,h in keep: lv.setdefault(k,[]).append((q,h))
for k in sorted(lv): print(f'y~{ys[k]-dy/2:.2f} n={len(lv[k])} area={sum(q.area for q,_ in lv[k]):.2f} ' + ' '.join(f'[{q.bounds[0]:.1f},{q.bounds[2]:.1f}]x[{q.bounds[1]:.1f},{q.bounds[3]:.1f}]h{h:.1f}' for q,h in lv[k][:6]))
pickle.dump(keep,open('tmp/Tkeep.pkl','wb'))
