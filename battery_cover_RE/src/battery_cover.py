"""Battery cover - design-intent model (flat plate, nominal 2.0 mm wall)."""

from cadgen import step

from lib.geometry import BOW_Y_FLAT, battery_cover_solid


@step(out="../STEP/battery_cover.step")
def battery_cover():
    part = battery_cover_solid(BOW_Y_FLAT)
    part.label = "battery_cover"
    return part


if __name__ == "__main__":
    battery_cover()
