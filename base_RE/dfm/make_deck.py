"""Rebuild output/DFM.pptx from output/dfm_summary.json without re-running the analysis.
Run from base_RE/:  python dfm/make_deck.py"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import toolmaker_ppt  # noqa: E402

OUT = HERE.parent / "output"
S = json.loads((OUT / "dfm_summary.json").read_text())
toolmaker_ppt.build(S, HERE.parent.parent, OUT / "DFM.pptx")
print("deck ->", OUT / "DFM.pptx")
