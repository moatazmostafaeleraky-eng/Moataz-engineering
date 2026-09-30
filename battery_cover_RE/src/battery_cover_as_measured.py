"""Battery cover - as-measured model (reproduces the 0.34 mm plate bow found in the source mesh)."""

from cadgen import step

from lib.geometry import BOW_Y_AS_MEASURED, battery_cover_solid


@step(out="../STEP/battery_cover_as_measured.step")
def battery_cover_as_measured():
    part = battery_cover_solid(BOW_Y_AS_MEASURED)
    part.label = "battery_cover_as_measured"
    return part


if __name__ == "__main__":
    battery_cover_as_measured()
