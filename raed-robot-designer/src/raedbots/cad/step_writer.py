"""Legacy helpers. OpenCascade writes valid STEP instead of handwritten BREP entities."""
from pathlib import Path
import numpy as np

def _box_facets(xmin, ymin, zmin, xmax, ymax, zmax):
    v = [(xmin,ymin,zmin),(xmax,ymin,zmin),(xmax,ymax,zmin),(xmin,ymax,zmin),
         (xmin,ymin,zmax),(xmax,ymin,zmax),(xmax,ymax,zmax),(xmin,ymax,zmax)]
    faces = [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    return [(v[a],v[b],v[c]) for a,b,c,d in faces] + [(v[a],v[c],v[d]) for a,b,c,d in faces]

def write_stl_ascii(path: Path, triangles, name="solid"):
    lines = [f"solid {name}"]
    for a,b,c in triangles:
        normal = np.cross(np.subtract(b,a), np.subtract(c,a))
        normal = normal / max(np.linalg.norm(normal), 1e-15)
        lines += ["facet normal " + " ".join(map(str,normal)), "outer loop"]
        lines += ["vertex " + " ".join(str(x * 1000) for x in p) for p in (a,b,c)]
        lines += ["endloop", "endfacet"]
    path.write_text("\n".join(lines + [f"endsolid {name}"]), encoding="ascii")

def write_step_faceted(path: Path, triangles, name="PART"):
    import cadquery as cq
    faces = []
    for tri in triangles:
        wire = cq.Wire.makePolygon([cq.Vector(*(x*1000 for x in p)) for p in tri], close=True)
        faces.append(cq.Face.makeFromWires(wire))
    shape = cq.Solid.makeSolid(cq.Shell.makeShell(faces))
    if not shape.isValid():
        raise ValueError("Cannot export an invalid solid")
    cq.exporters.export(shape, str(path), exportType="STEP")
