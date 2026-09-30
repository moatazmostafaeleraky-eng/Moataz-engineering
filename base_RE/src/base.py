"""Rear case ("base") - reverse-engineered model of source/base.STL."""

from cadgen import step

from lib.geometry import base


@step(out="../STEP/base.step")
def rear_case():
    part = base()
    part.label = "base"
    return part


if __name__ == "__main__":
    rear_case()
