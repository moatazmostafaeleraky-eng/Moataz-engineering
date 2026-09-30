import numpy as np, trimesh, matplotlib, sys; matplotlib.use('Agg')
import matplotlib.pyplot as plt
m=trimesh.load('source/base.STL')
def draw(ax,o,n,idx,col):
    s=m.section(plane_origin=o,plane_normal=n)
    if s is None: return
    for p in s.discrete: ax.fill(p[:,idx[0]],p[:,idx[1]],facecolor=col,alpha=0.4,edgecolor=col,lw=0.6)
jobs=eval(sys.argv[1]); out=sys.argv[2]; cols=int(sys.argv[3]) if len(sys.argv)>3 else 4
rows=(len(jobs)+cols-1)//cols
fig,axs=plt.subplots(rows,cols,figsize=(6*cols,5.5*rows)); axs=np.atleast_1d(axs).ravel()
for ax,(lab,o,n,idx,xl,yl) in zip(axs,jobs):
    draw(ax,o,n,idx,'b'); ax.set_xlim(*xl); ax.set_ylim(*yl); ax.set_aspect('equal'); ax.grid(True); ax.set_title(lab)
plt.tight_layout(); plt.savefig(out,dpi=60)
