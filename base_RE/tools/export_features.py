"""prisms2.pkl + T.json -> src/lib/features.json.

F/G prisms touching the shell are grown 0.5 mm into the wall (volumetric overlap, no tangent contacts);
Z prisms whose skin drifts inside their range get a band extension that follows the curved skin."""
import pickle, json, numpy as np, trimesh
from shapely.geometry import Polygon
import shapely
from shapely.validation import make_valid
from shapely.affinity import translate
from shapely.ops import unary_union
from scipy.interpolate import CubicSpline
D=pickle.load(open('tmp/prisms2.pkl','rb')); T=json.load(open('tmp/T.json'))
sh=trimesh.load('tmp/shell.stl'); sh.merge_vertices(digits_vertex=5)
ctrl=np.load('src/lib/profile_ctrl.npz')
yin=CubicSpline(*ctrl['inner'].T); yout=CubicSpline(*ctrl['outer'].T)
COLS={0:[1,2],1:[0,2],2:[0,1]}
def geoms(p): return [q for q in getattr(p,'geoms',[p]) if not q.is_empty]
PLANES_X=(0.62,2.62,49.62,51.62)
def _snap(coords, axis):
    c=np.round(np.asarray(coords,float),3)
    # snap to the exact planar walls of the shell so coincident faces are exact, not 0.001 apart
    if axis in (1,2):  # first coordinate is X
        for xv in PLANES_X: c[np.abs(c[:,0]-xv)<0.012,0]=xv
    if axis==2:
        c[np.abs(c[:,1]-4.34)<0.012,1]=4.34
    if axis==0:
        c[np.abs(c[:,0]-4.34)<0.012,0]=4.34
    return c
def rings(p, tol=0.008, axis=2):
    out=[]
    p=p.simplify(tol,preserve_topology=True)
    p=shapely.set_precision(make_valid(p),0.001)
    for g2 in geoms(make_valid(p)):
        if g2.geom_type=='GeometryCollection' or g2.geom_type=='MultiPolygon':
            cand=[q for q in geoms(g2) if q.geom_type=='Polygon']
        else: cand=[g2] if g2.geom_type=='Polygon' else []
        for q in cand:
            if q.area<0.01 or q.buffer(-0.015).is_empty: continue
            ext=_snap(np.asarray(q.exterior.coords)[:-1],axis)
            holes=[_snap(np.asarray(r.coords)[:-1],axis) for r in q.interiors]
            poly=Polygon(ext,[h for h in holes if len(h)>=3])
            if not poly.is_valid:
                poly=make_valid(poly)
                poly=max([x for x in geoms(poly) if x.geom_type=='Polygon'],key=lambda x:x.area,default=None)
                if poly is None: continue
            poly=shapely.set_precision(poly,0.001)
            if poly.is_empty or poly.geom_type!='Polygon' or not poly.is_valid or poly.area<0.01: continue
            out.append([np.round(np.asarray(poly.exterior.coords)[:-1],3).tolist()]+[np.round(np.asarray(r.coords)[:-1],3).tolist() for r in poly.interiors])
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
        if key=='G' and ax==2 and v0>=88.4 and v1<=151.5 and Q.bounds[0]>=10.6 and Q.bounds[2]<=41.65:
            continue   # the battery opening is a parametric feature (geometry.battery_opening)
        e=dict(axis=int(ax),v0=v0,v1=v1)
        secs=[shell_sec(ax,v) for v in (v0+0.01,vm,v1-0.01)]
        touching=Q.distance(secs[1].boundary)<0.05
        if key=='F' and touching:
            wall=secs[0].intersection(secs[1]).intersection(secs[2]).buffer(-0.03,join_style=2)
            Q=Q.union(Q.buffer(GROW,join_style=2).intersection(wall)).buffer(0)
        if key=='F' and ax==2 and v1<=2.9: continue   # bottom-end inner lip: see REPORT exceptions
        e['rings']=rings(Q,axis=ax)
        if not e['rings']: continue
        if ax==2 and touching:
            zz=np.linspace(v0,v1,25)
            for name,f in (('in',yin),('out',yout)):
                if key=='F' and name=='out': continue
                dr=float(np.abs(f(zz)-f(vm)).max())
                if dr>0.02:
                    d=round(dr+0.3,3)
                    ext=sweep_y(p['poly'],0,d) if name=='out' or key=='F' else sweep_y(p['poly'],-d,0)
                    e.setdefault('skin',[]).append(dict(side=name,delta=round(dr+0.02,3),rings=rings(ext,axis=2)))
        L.append(e)
    out[key]=L
    print(key,len(L),'skin ext',sum('skin' in e for e in L),'verts',sum(len(r) for e in L for poly in e['rings'] for r in poly))
json.dump(out,open('src/lib/features.json','w'))
