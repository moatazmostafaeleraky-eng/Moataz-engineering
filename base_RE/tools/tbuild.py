"""Build up-to-skin Y prisms (T), export them, and compute the residual F - T for the slab pass."""
import sys, pickle, json, numpy as np, trimesh
sys.path.insert(0,'src')
from shapely.ops import unary_union
from cadgen import build123d as bd
from lib import geometry as g
TM=pickle.load(open('tmp/TM.pkl','rb'))
# cluster levels closer than 0.01
cl=[]
for t in TM['T']:
    if cl and abs(t['y0']-cl[-1]['ys'][-1])<0.01: cl[-1]['ys'].append(t['y0']); cl[-1]['polys'].append(t['poly'])
    else: cl.append(dict(ys=[t['y0']],polys=[t['poly']]))
def _dedup(c):
    c=np.round(np.asarray(c),3); keep=[c[0]]
    for q in c[1:]:
        if np.abs(q-keep[-1]).max()>1e-9: keep.append(q)
    if len(keep)>1 and np.abs(keep[0]-keep[-1]).max()<1e-9: keep.pop()
    return np.asarray(keep).tolist() if len(keep)>=3 else None
def rings(p, tol=0.008):
    out=[]
    for gg in getattr(p.simplify(tol,preserve_topology=True).buffer(0),'geoms',[p.simplify(tol,preserve_topology=True).buffer(0)]):
        if gg.area<0.005: continue
        out.append([_dedup(np.asarray(gg.exterior.coords)[:-1])]+[_dedup(np.asarray(r.coords)[:-1]) for r in gg.interiors]); out[-1]=[r for r in out[-1] if r]
    return out
T=[dict(y0=round(float(np.mean(c['ys'])),3),rings=rings(unary_union(c['polys']))) for c in cl]
for t in T: print('T',t['y0'],len(t['rings']))
json.dump(T,open('tmp/T.json','w'))
