"""Battery cover - DFM-corrected for injection moulding (ABS): drafts, radii, straight-pull hook."""

from cadgen import step

from lib.geometry_dfm import battery_cover_dfm_solid


@step(out="../../output/part_DFM.step")
def battery_cover_dfm():
    log = []
    part = battery_cover_dfm_solid(log)
    for label, n, status in log:
        print(f"[dfm] fillet {label}: {n} edges -> {status}")
    part.label = "battery_cover_DFM"
    return part


if __name__ == "__main__":
    battery_cover_dfm()
