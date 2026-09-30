"""Section-driven prism decomposition of the residual between the source mesh and the parametric shell.

Z-slabs everywhere; runs where the Z-section varies continuously are re-decomposed per component along X or Y."""
import numpy as np, trimesh, pickle, time
from shapely.geometry import Polygon
t0=time.time()
src=trimesh.load('source/base.STL'); sh=trimesh.load('tmp/shell.stl'); sh.merge_vertices(digits_vertex=5)
base=trimesh.load('tmp/shellT.stl'); base.merge_vertices(digits_vertex=4)
def clean(mesh):
    keep=[p for p in mesh.split(only_watertight=False) if abs(p.volume)>=0.2 and abs(p.volume)/(p.area/2)>=0.08]
    return trimesh.util.concatenate(keep)
F=clean(src.difference(base,engine='manifold')); G=clean(base.difference(src,engine='manifold'))
COLS={0:[1,2],1:[0,2],2:[0,1]}
def sect(mesh,axis,v,open_e=0.03):
    n=[0,0,0]; n[axis]=1; o=[0,0,0]; o[axis]=v
    s=mesh.section(plane_origin=o,plane_normal=n)
    if s is None: return Polygon()
    polys=sorted((Polygon(p[:,COLS[axis]]).buffer(0) for p in s.discrete if len(p)>=3), key=lambda q:-q.area)
    solid=Polygon()
    for q in polys: solid = solid.difference(q) if solid.contains(q) else solid.union(q)
    return solid.buffer(-open_e,join_style=2).buffer(open_e,join_style=2) if open_e else solid
def changed(a,b,excl,e=0.02):
    d=a.symmetric_difference(b)
    if excl is not None: d=d.difference(excl)
    return d.buffer(-e,join_style=2).area>0.002
def decompose(mesh,axis,lo,hi,dz=0.05):
    vs=np.arange(np.floor(lo/dz)*dz+dz/2, hi, dz)
    S=[sect(mesh,axis,v) for v in vs]
    cuts=[0]
    for i in range(1,len(vs)):
        excl=sect(sh,axis,vs[i],0).boundary.buffer(0.12)
        # against the previous section (steps) and against the slab start (gradual slopes)
        if changed(S[i],S[i-1],excl) or changed(S[i],S[cuts[-1]],excl,e=0.04): cuts.append(i)
    cuts.append(len(vs)); out=[]
    for a,b in zip(cuts[:-1],cuts[1:]):
        m=(a+b-1)//2
        out.append(dict(axis=axis,v0=round(vs[a]-dz/2,3),v1=round(vs[b-1]+dz/2,3),poly=S[m],empty=S[m].area<0.01))
    return out
def runs(slabs,short=0.3,minn=3):
    """(i,j) index ranges of >=minn consecutive short, non-empty-adjacent slabs."""
    res=[];i=0
    while i<len(slabs):
        if slabs[i]['v1']-slabs[i]['v0']<short and not slabs[i]['empty']:
            j=i
            while j+1<len(slabs) and slabs[j+1]['v1']-slabs[j+1]['v0']<short and not slabs[j+1]['empty']: j+=1
            if j-i+1>=minn: res.append((i,j))
            i=j+1
        else: i+=1
    return res
def process(mesh,label):
    lo,hi=mesh.bounds[:,2]
    Z=decompose(mesh,2,lo,hi)
    R=runs(Z); prisms=[]; skip=set()
    for i,j in R:
        za,zb=Z[i]['v0'],Z[j]['v1']; skip.update(range(i,j+1))
        chunk=mesh.slice_plane([0,0,za],[0,0,1],cap=True).slice_plane([0,0,zb],[0,0,-1],cap=True)
        for c in chunk.split(only_watertight=False):
            if abs(c.volume)<0.05: continue
            cands=[]
            for ax in (0,1):
                a,b=c.bounds[:,ax]
                cands.append([s for s in decompose(c,ax,a-0.05,b+0.05) if not s['empty']])
            cands.append([s for s in decompose(c,2,za,zb) if not s['empty']])
            cands=[d for d in cands if d]
            if not cands: continue
            print('    n per axis',[ (d[0]['axis'],len(d)) for d in cands])
            best=min(cands,key=len)
            print(f'  {label} chunk z[{za},{zb}] comp vol {abs(c.volume):.1f} -> axis {best[0]["axis"]} n={len(best)}')
            for s in best: s['z_range']=(za,zb)
            prisms+=best
    prisms+=[s for k,s in enumerate(Z) if k not in skip and not s['empty']]
    print(label,'prisms',len(prisms),'Zruns',[(Z[i]['v0'],Z[j]['v1']) for i,j in R], round(time.time()-t0))
    return prisms
out={'F':process(F,'F'),'G':process(G,'G')}
pickle.dump(out,open('tmp/prisms2.pkl','wb'))
