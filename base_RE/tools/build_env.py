import sys, time; sys.path.insert(0,'src')
from cadgen import build123d as bd
from lib import geometry as g
t=time.time(); s=g.shell(); print('shell',round(s.volume,1),len(s.solids()),s.is_valid,round(time.time()-t))
c=g.finger_recess_cut(); w=g.finger_recess_wall(); print('fr cut',round(c.volume,1),'wall',round(w.volume,1),w.is_valid)
b=g.bosses(); print('bosses',round(b.volume,2))
e=g.envelope(); print('envelope',round(e.volume,1),len(e.solids()),e.is_valid,round(time.time()-t))
T=g._fuse(g.ribs()); u=e.fuse(T); print('env+ribs',round(u.volume,1),len(u.solids()),u.is_valid,round(time.time()-t))
bd.export_stl(u,'tmp/shellT.stl',tolerance=0.005,angular_tolerance=0.05); bd.export_brep(u,'tmp/envT.brep')
bd.export_stl(s,'tmp/shell.stl',tolerance=0.005,angular_tolerance=0.05)
