"""Y-column decomposition: material in the cavity = up-to-skin Y prisms (T) + floating Y slabs (M)."""
import sys, time, pickle, numpy as np, trimesh
sys.path.insert(0,'src')
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from cadgen import build123d as bd
from lib import geometry as g
t0=time.time()
src=trimesh.load('source/base.STL')
bd.export_stl(g.inner_block(),'tmp/inner.stl',tolerance=0.005,angular_tolerance=0.05)
inner=trimesh.load('tmp/inner.stl'); inner.merge_vertices(digits_vertex=5)
pl=trimesh.creation.box(extents=[51.0,10,170],transform=trimesh.transformations.translation_matrix([26.12,4.34-5,75]))
C=inner.union(pl,engine='manifold')
A=src.intersection(C,engine='manifold'); E=C.difference(src,engine='manifold')
print('C',C.volume,'A',A.volume,'E',E.volume,round(time.time()-t0))
def sec(mesh,y,e=0.02):
    s=mesh.section(plane_origin=[0,y,0],plane_normal=[0,1,0])
    if s is None: return Polygon()
    polys=sorted((Polygon(p[:,[0,2]]).buffer(0) for p in s.discrete if len(p)>=3), key=lambda q:-q.area)
    solid=Polygon()
    for q in polys: solid = solid.difference(q) if solid.contains(q) else solid.union(q)
    return solid.buffer(-e,join_style=2).buffer(e,join_style=2) if e else solid
dy=0.05
ys=np.arange(0.4+dy/2,22.6,dy)
SA=[sec(A,y) for y in ys]; SE=[sec(E,y,0) for y in ys]; SC=[sec(C,y,0) for y in ys]
print('sections',round(time.time()-t0))
P=[None]*len(ys); acc=Polygon()
for k in range(len(ys)-1,-1,-1):
    P[k]=acc            # empty strictly above level k
    acc=acc.union(SE[k].buffer(0.005))
T=[SA[k].difference(P[k]) for k in range(len(ys))]
M=[SA[k].intersection(P[k]) for k in range(len(ys))]
def op(p,e=0.02): return p.buffer(-e,join_style=2).buffer(e,join_style=2)
D=[]
for k in range(len(ys)):
    prev=T[k-1] if k else Polygon()
    d=op(T[k].difference(prev.buffer(0.01,join_style=2)))
    for q in (d.geoms if hasattr(d,'geoms') else [d]):
        if q.area>0.005: D.append((k,q))
print('T appear regions',len(D),round(time.time()-t0))
lv={}
for k,q in D: lv.setdefault(k,[]).append(q)
for k in sorted(lv): print(f'  y~{ys[k]-dy/2:.2f} n={len(lv[k])} area={sum(q.area for q in lv[k]):.2f}')
pickle.dump(dict(ys=ys,SA=SA,SE=SE,SC=SC,T=T,M=M,D=D),open('tmp/ycols.pkl','wb'))
trimesh.exchange.export.export_mesh(A,'tmp/A.stl'); trimesh.exchange.export.export_mesh(C,'tmp/C.stl')
