"""Extract bundled STEP Parts files from the product specification."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

SPEC = Path(r"C:\Users\DELL 2\Downloads\Robot_Designer_Simple_Spec (1).md")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tools" / "step-parts"

EXPECTED = {
    "SKILL.md": "2f0a8988692e2a78075636a3842e2d6f9fe932dd42344e00ea4ae5e76026e22f",
    "references/step-parts-api.md": "dc5beb2326f9b1ceb331412da5adf38f22e485cf4f5d47f6419ef1254c4cf461",
    "scripts/download_step_part.py": "2204d93bc766ee950c28bd2729ba4d0fc8a71585011a0ed5b0a4b8462cd093e5",
    "agents/openai.yaml": "c33a3e43c22b51d81b511131c14eb5e7e0947aab8add455658aa5fac8c17431b",
    "LICENSE": "c11168234f932c4a39bb640571079e73b178b4459682a5507e5944ad723058b3",
}

FENCE_LANG = {
    "SKILL.md": "markdown",
    "references/step-parts-api.md": "markdown",
    "scripts/download_step_part.py": "python",
    "agents/openai.yaml": "yaml",
    "LICENSE": "text",
}


def extract(text: str, rel: str) -> str:
    lang = FENCE_LANG[rel]
    start = f"<!-- BEGIN_BUNDLED_FILE: step-parts/{rel} -->"
    end = f"<!-- END_BUNDLED_FILE: step-parts/{rel} -->"
    i = text.find(start)
    j = text.find(end)
    if i < 0 or j < 0:
        raise SystemExit(f"Missing bundle markers for {rel}")
    block = text[i + len(start) : j].strip("\n")
    open_fence = f"````{lang}"
    if not block.startswith(open_fence):
        raise SystemExit(f"Could not parse opening fence for {rel}")
    body = block[len(open_fence) :]
    close = body.rfind("\n````")
    if close < 0:
        raise SystemExit(f"Could not parse closing fence for {rel}")
    return body[:close].lstrip("\n").replace("\r\n", "\n")


def main() -> None:
    text = SPEC.read_text(encoding="utf-8")
    report = []
    for rel, expected in EXPECTED.items():
        content = extract(text, rel)
        path = OUT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = content.encode("utf-8")
        if not raw.endswith(b"\n"):
            raw += b"\n"
        path.write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        ok = digest == expected
        report.append((rel, digest, ok))
        print(f"{rel}: sha256={digest} match={ok}")
    if not all(ok for _, _, ok in report):
        raise SystemExit("SHA-256 mismatch; inspect line endings and fence extraction.")


if __name__ == "__main__":
    main()
