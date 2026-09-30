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
PLANES_X=(0.62,2.62,10.62,41.62,49.62,51.62)  # shell walls and the slot/opening walls
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
# planes the slab ends should land on exactly (rib sketch edges, shell/slot planes): a 0.02 mm gap left
# between a slab end and a rib face would survive the fuse as a zero-thickness slit inside the part
SNAP={0:set(PLANES_X),1:set(),2:{0.0,86.45,88.45,151.44,153.45,153.94}}
for t in T:
    for poly in t['rings']:
        for r in poly:
            c=np.asarray(r); SNAP[0].update(np.round(c[:,0],3)); SNAP[2].update(np.round(c[:,1],3))
SNAPA={k:np.array(sorted(v)) for k,v in SNAP.items()}
def snapv(ax,v,tol=0.03):
    a=SNAPA[ax]
    if not len(a): return v
    i=np.argmin(np.abs(a-v)); return float(a[i]) if abs(a[i]-v)<=tol else v
out={'T':T}
for key in 'FG':
    L=[]
    for p in D[key]:
        Q=p['poly']; ax=p['axis']; v0,v1=float(p['v0']),float(p['v1']); vm=(v0+v1)/2
        if key=='G' and ax==2 and v0>=88.4 and v1<=151.5 and Q.bounds[0]>=10.6 and Q.bounds[2]<=41.65:
            continue   # the battery opening is a parametric feature (geometry.battery_opening)
        v0,v1=snapv(ax,v0),snapv(ax,v1)
        if v1-v0<0.01: continue
        e=dict(axis=int(ax),v0=v0,v1=v1)
        secs=[shell_sec(ax,v) for v in (v0+0.01,vm,v1-0.01)]
        touching=Q.distance(secs[1].boundary)<0.05
        if key=='F' and touching:
            wall=secs[0].intersection(secs[1]).intersection(secs[2]).buffer(-0.03,join_style=2)
            Q=Q.union(Q.buffer(GROW,join_style=2).intersection(wall)).buffer(0)
            # close the <0.08 mm strip between the feature and the (eroded) wall overlap so no thin void is left
            Q=Q.buffer(0.04,join_style=2).buffer(-0.04,join_style=2).union(Q)
        if key=='F' and ax==2 and (v1<=2.9 or (v1<=4.5 and p['poly'].area<1.0)): continue   # bottom-end inner lip: see REPORT exceptions
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

# ---- global coordinate snapping: values within 0.02 mm on the same axis become one value, so faces
# that meet (rib to rib, slab to rib, slab to slab) coincide exactly instead of leaving 0.01-0.02 slits
from collections import Counter
MAP={0:(None,0,0),1:(0,None,1),2:(0,1,None)}   # prism axis -> which world axis each ring coord is
def world_axes(e):
    if 'y0' in e: return (0,2), None           # rib sketch: (x, z) on plane Y = y0
    a=e['axis']; return {0:(1,2),1:(0,2),2:(0,1)}[a], a
vals={0:Counter(),1:Counter(),2:Counter()}
FIXED={0:list(PLANES_X),1:[4.34],2:[151.44,153.45,88.45]}
def each(fn):
    for key in ('T','F','G'):
        for e in out[key]:
            (wa,wb),pa=world_axes(e)
            polys=[e['rings']]+[x['rings'] for x in e.get('skin',[])]
            for P in polys:
                for poly in P:
                    for r in poly:
                        for q in r: fn(q,0,wa); fn(q,1,wb)
            if pa is not None: fn(e,'v0',pa); fn(e,'v1',pa)
            else: fn(e,'y0',1)
each(lambda o,k,ax: vals[ax].update([round(o[k],3)]))
canon={}
for ax,c in vals.items():
    for f in FIXED[ax]: c[f]+=10**6
    xs=sorted(c); groups=[[xs[0]]]
    for v in xs[1:]:
        (groups[-1].append(v) if v-groups[-1][0]<=0.02 else groups.append([v]))
    for gr in groups:
        rep=max(gr,key=lambda v:(c[v],-abs(v-np.median(gr))))
        for v in gr: canon[(ax,v)]=rep
def snap(o,k,ax): o[k]=canon[(ax,round(o[k],3))]
each(snap)
def clean_rings(P):
    res=[]
    for poly in P:
        pg=make_valid(Polygon(poly[0],[h for h in poly[1:] if len(h)>=3]))
        for q in geoms(pg):
            if q.geom_type=='Polygon' and q.area>=0.01:
                q=q.simplify(0.0005)
                res.append([_dd(q.exterior.coords)]+[_dd(r.coords) for r in q.interiors])
    return [[r for r in p if r] for p in res if p[0]]
def _dd(c):
    c=np.round(np.asarray(c)[:-1],3); k=[c[0]]
    for v in c[1:]:
        if np.abs(v-k[-1]).max()>1e-9: k.append(v)
    if len(k)>1 and np.abs(k[0]-k[-1]).max()<1e-9: k.pop()
    return np.asarray(k).tolist() if len(k)>=3 else None
for key in ('T','F','G'):
    keep=[]
    for e in out[key]:
        e['rings']=clean_rings(e['rings'])
        for x in e.get('skin',[]): x['rings']=clean_rings(x['rings'])
        if e['rings'] and ('y0' in e or e['v1']-e['v0']>=0.01): keep.append(e)
    out[key]=keep
print('snapped: clusters per axis', {ax:len(set(v for (a,_),v in canon.items() if a==ax)) for ax in range(3)},
      'T',len(out['T']),'F',len(out['F']),'G',len(out['G']))
json.dump(out,open('src/lib/features.json','w'))
