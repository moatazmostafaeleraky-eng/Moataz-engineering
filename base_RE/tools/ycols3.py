"""Group up-to-skin regions into levels (refined by ray casting) and decompose floating material into Y slabs."""
import pickle, numpy as np, trimesh
from shapely.ops import unary_union
from shapely.geometry import Polygon
d=pickle.load(open('tmp/ycols.pkl','rb')); ys=d['ys']; dy=0.05
keep=pickle.load(open('tmp/Tkeep.pkl','rb'))
src=trimesh.load('source/base.STL'); ray=trimesh.ray.ray_triangle.RayMeshIntersector(src)
lv={}
for k,q,h in keep: lv.setdefault(k,[]).append(q)
ks=sorted(lv); runs=set()
for i,k in enumerate(ks):   # consecutive-level runs = sloped/curved bottoms -> leave for the residual pass
    if (k-1 in lv and k-2 in lv) or (k+1 in lv and k+2 in lv) or (k-1 in lv and k+1 in lv): runs.add(k)
levels={}
for k in ks:
    if k in runs: continue
    for q in lv[k]:
        if q.area<0.3: continue
        p=q.representative_point()
        loc,idx,_=ray.intersects_location([[p.x,-20,p.y]],[[0,1,0]],multiple_hits=True)
        yh=loc[:,1]; yh=yh[np.abs(yh-(ys[k]-dy/2))<0.08]
        yb=round(float(yh[np.argmin(np.abs(yh-(ys[k]-dy/2)))]),3) if len(yh) else round(ys[k]-dy/2,3)
        levels.setdefault(yb,[]).append(q)
T=[]
for yb in sorted(levels):
    u=unary_union(levels[yb]); print('T level',yb,'area',round(u.area,2),'parts',len(getattr(u,'geoms',[u])))
    T.append(dict(y0=yb,poly=u))
# floating material -> Y slabs
M=d['M']
def ch(a,b,e=0.02):
    x=a.symmetric_difference(b); return x.buffer(-e,join_style=2).area>0.002
cuts=[0]
for i in range(1,len(ys)):
    if ch(M[i],M[i-1]): cuts.append(i)
cuts.append(len(ys)); MS=[]
for a,b in zip(cuts[:-1],cuts[1:]):
    m=(a+b-1)//2; Q=M[m]
    if Q.area<0.01: continue
    MS.append(dict(y0=round(ys[a]-dy/2,3),y1=round(ys[b-1]+dy/2,3),poly=Q))
print('M slabs',len(MS),'short',sum(1 for s in MS if s['y1']-s['y0']<0.2))
for s in MS: print('  M',s['y0'],s['y1'],round(s['poly'].area,2),np.round(s['poly'].bounds,1))
pickle.dump(dict(T=T,M=MS),open('tmp/TM.pkl','wb'))
