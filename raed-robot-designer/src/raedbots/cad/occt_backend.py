"""Small adapter for the installed OCCT kernel when CadQuery cannot import.

The same primitives and placements are used by both paths. No mesh-to-STEP fallback.
"""
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound
from OCP.gp import gp_Pnt, gp_Trsf
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCP.IFSelect import IFSelect_RetDone
from OCP.StlAPI import StlAPI_Writer

def box(w,h,length):
    return BRepPrimAPI_MakeBox(gp_Pnt(-w/2,-h/2,0),w,h,length).Shape()

def cylinder(radius,length):
    return BRepPrimAPI_MakeCylinder(radius,length).Shape()

def cut(a,b):
    operation=BRepAlgoAPI_Cut(a,b);operation.Build()
    if not operation.IsDone():raise ValueError('CAD boolean operation failed')
    return operation.Shape()

def move(shape,transform):
    tr=gp_Trsf();tr.SetValues(*[float(x) for x in transform[:3,:].ravel()])
    return BRepBuilderAPI_Transform(shape,tr,True).Shape()

def compound(shapes):
    builder=BRep_Builder();result=TopoDS_Compound();builder.MakeCompound(result)
    for s in shapes:builder.Add(result,s)
    return result

def export(shape,path):
    if not BRepCheck_Analyzer(shape).IsValid():raise ValueError('Invalid OCCT shape')
    if path.suffix.lower()=='.step':
        writer=STEPControl_Writer()
        if writer.Transfer(shape,STEPControl_AsIs)!=IFSelect_RetDone or writer.Write(str(path))!=IFSelect_RetDone:
            raise ValueError('STEP writer failed')
    else:
        BRepMesh_IncrementalMesh(shape,.15,False,.15,True).Perform()
        # OCCT's filename overload cannot open some Unicode Windows paths.
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory(prefix='raed-stl-') as tmp:
            target=Path(tmp)/'part.stl'
            if not StlAPI_Writer().Write(shape,str(target)):raise ValueError('STL writer failed')
            path.write_bytes(target.read_bytes())
