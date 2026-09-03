# Written by AI (Claude, Anthropic) under the direction of Nik Jenič, who reviewed and tested it.
"""Lines-of-code proxy for the thesis "simplest" axis.

No field standard exists for "implementation simplicity"; this counts the
non-blank, non-comment lines of the files each render tactic needs BEYOND the
shared core (VTF upload, chunk loading, quadtree streaming), which every tactic
pays for equally. Say so in the text and call it a proxy.

Run: venv\\Scripts\\python -m bench.loc [--csv out.csv]
"""
import argparse
import csv
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"

SHARED = ["renderer.js", "chunk-mesher.js", "hmap-loader.js", "chunk-quad-strategy.js",
          "chunk-websocket.js", "chunk-manager.js", "chunk.js"]
TACTIC_FILES = {
    "mesh":    ["mesh-shader.wgsl"],
    "cubes":   ["instanced-cubes-shader.wgsl"],
    "planes":  ["instanced-shader.wgsl"],
    "greedy":  ["instanced-greedy-shader.wgsl", "greedy-mesher.js"],
    "raycast": ["ray-shader.wgsl"],
    "hybrid":  ["instanced-greedy-shader.wgsl", "greedy-mesher.js", "ray-shader.wgsl"],
    "fx":      ["fx-shader.wgsl"],
}


def count_loc(path):
    """Non-blank, non-comment lines (// and /* */ styles, JS and WGSL alike)."""
    n = 0
    in_block = False
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if in_block:
            if "*/" in s:
                in_block = False
            continue
        if not s or s.startswith("//"):
            continue
        if s.startswith("/*"):
            in_block = "*/" not in s
            continue
        n += 1
    return n


def table():
    rows = []
    for tactic, files in TACTIC_FILES.items():
        rows.append({"tactic": tactic, "files": " + ".join(files),
                     "loc": sum(count_loc(PUBLIC / f) for f in files)})
    rows.append({"tactic": "shared core", "files": " + ".join(SHARED),
                 "loc": sum(count_loc(PUBLIC / f) for f in SHARED)})
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", help="also write the table to this CSV")
    args = ap.parse_args(argv)
    rows = table()
    for r in rows:
        print(f"{r['tactic']:<12}{r['loc']:>6}  {r['files']}")
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)


if __name__ == "__main__":
    main()
