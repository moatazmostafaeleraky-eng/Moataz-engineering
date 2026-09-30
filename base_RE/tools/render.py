import sys, numpy as np, trimesh, matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
m = trimesh.load(sys.argv[1]); out=sys.argv[2]
views=[(25,-60,'iso A'),(25,120,'iso B'),(-35,-60,'iso bottom'),(0,-90,'front (-Y) '),(0,0,'side (+X)'),(90,-90,'top (+Z)')] if len(sys.argv)<4 else eval(sys.argv[3])
fig=plt.figure(figsize=(18,11))
L=np.array([0.4,-0.6,0.7]); L/=np.linalg.norm(L)
sh=np.clip(m.face_normals@L,0,1)*0.65+0.35
cols=np.c_[sh*0.3,sh*0.62,sh*0.3,np.ones_like(sh)]
b=m.bounds; c=b.mean(0); r=(b[1]-b[0]).max()/2
for i,(e,a,t) in enumerate(views):
    ax=fig.add_subplot(2,3,i+1,projection='3d')
    ax.add_collection3d(Poly3DCollection(m.triangles,facecolors=cols,edgecolor=(0,0,0,0.05),linewidth=0.1))
    ax.set_xlim(c[0]-r,c[0]+r); ax.set_ylim(c[1]-r,c[1]+r); ax.set_zlim(c[2]-r,c[2]+r); ax.set_box_aspect((1,1,1))
    ax.view_init(e,a); ax.set_title(t); ax.set_xlabel('X'); ax.set_ylabel('Y'); ax.set_zlabel('Z'); ax.set_proj_type('ortho')
plt.tight_layout(); plt.savefig(out,dpi=70)
