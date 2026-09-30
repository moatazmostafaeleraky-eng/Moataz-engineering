"""prisms2.pkl + T.json -> src/lib/features.json.

F/G prisms touching the shell are grown 0.5 mm into the wall (volumetric overlap, no tangent contacts);
Z prisms whose skin drifts inside their range get a band extension that follows the curved skin."""
import pickle, json, numpy as np, trimesh
from shapely.geometry import Polygon
from shapely.affinity import translate
from shapely.ops import unary_union
from scipy.interpolate import CubicSpline
D=pickle.load(open('tmp/prisms2.pkl','rb')); T=json.load(open('tmp/T.json'))
sh=trimesh.load('tmp/shell.stl'); sh.merge_vertices(digits_vertex=5)
ctrl=np.load('src/lib/profile_ctrl.npz')
yin=CubicSpline(*ctrl['inner'].T); yout=CubicSpline(*ctrl['outer'].T)
COLS={0:[1,2],1:[0,2],2:[0,1]}
def geoms(p): return [q for q in getattr(p,'geoms',[p]) if not q.is_empty]
def _dedup(c):
    c=np.round(np.asarray(c),3); keep=[c[0]]
    for q in c[1:]:
        if np.abs(q-keep[-1]).max()>1e-9: keep.append(q)
    if len(keep)>1 and np.abs(keep[0]-keep[-1]).max()<1e-9: keep.pop()
    return np.asarray(keep).tolist() if len(keep)>=3 else None
def rings(p, tol=0.008):
    out=[]
    for gg in geoms(p.simplify(tol,preserve_topology=True).buffer(0)):
        for g2 in geoms(gg.buffer(0)):
            if g2.geom_type!='Polygon' or g2.area<0.005: continue
            out.append([_dedup(np.asarray(g2.exterior.coords)[:-1])]+[_dedup(np.asarray(r.coords)[:-1]) for r in g2.interiors]); out[-1]=[r for r in out[-1] if r]
            if not out[-1] or out[-1][0] is None: out.pop()
    return out
def sweep_y(p,d0,d1):
    parts=[translate(p,yoff=d0),translate(p,yoff=d1)]
    for g in geoms(p):
        for r in [g.exterior,*g.interiors]:
            c=np.asarray(r.coords)
            for a,b in zip(c[:-1],c[1:]):
                parts.append(Polygon([(a[0],a[1]+d0),(b[0],b[1]+d0),(b[0],b[1]+d1),(a[0],a[1]+d1)]).buffer(0))
    return unary_union(parts)
def shell_sec(axis,v):
    n=[0,0,0]; n[axis]=1; o=[0,0,0]; o[axis]=v
    s=sh.section(plane_origin=o,plane_normal=n)
    if s is None: return Polygon()
    polys=sorted((Polygon(q[:,COLS[axis]]).buffer(0) for q in s.discrete if len(q)>=3), key=lambda q:-q.area)
    solid=Polygon()
    for q in polys: solid = solid.difference(q) if solid.contains(q) else solid.union(q)
    return solid
GROW=0.5
out={'T':T}
for key in 'FG':
    L=[]
    for p in D[key]:
        Q=p['poly']; ax=p['axis']; v0,v1=float(p['v0']),float(p['v1']); vm=(v0+v1)/2
        e=dict(axis=int(ax),v0=v0,v1=v1)
        secs=[shell_sec(ax,v) for v in (v0+0.01,vm,v1-0.01)]
        touching=Q.distance(secs[1].boundary)<0.05
        if key=='F' and touching:
            wall=secs[0].intersection(secs[1]).intersection(secs[2])
            Q=Q.union(Q.buffer(GROW,join_style=2).intersection(wall)).buffer(0)
        e['rings']=rings(Q)
        if not e['rings']: continue
        if ax==2 and touching:
            zz=np.linspace(v0,v1,25)
            for name,f in (('in',yin),('out',yout)):
                if key=='F' and name=='out': continue
                dr=float(np.abs(f(zz)-f(vm)).max())
                if dr>0.02:
                    d=round(dr+0.3,3)
                    ext=sweep_y(p['poly'],0,d) if name=='out' or key=='F' else sweep_y(p['poly'],-d,0)
                    e.setdefault('skin',[]).append(dict(side=name,delta=round(dr+0.02,3),rings=rings(ext)))
        L.append(e)
    out[key]=L
    print(key,len(L),'skin ext',sum('skin' in e for e in L),'verts',sum(len(r) for e in L for poly in e['rings'] for r in poly))
json.dump(out,open('src/lib/features.json','w'))
