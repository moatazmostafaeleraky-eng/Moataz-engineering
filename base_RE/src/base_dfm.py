"""Rear case - DFM-corrected model (draft, rib draft, weak-steel fills). See dfm/README.md."""

from cadgen import step

from lib.geometry_dfm import base_dfm


@step(out="../output/part_DFM.step")
def rear_case_dfm():
    part = base_dfm()
    part.label = "base_DFM"
    return part


if __name__ == "__main__":
    rear_case_dfm()
