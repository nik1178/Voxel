from pathlib import Path

from bench.loc import count_loc, TACTIC_FILES, SHARED, table


def test_count_loc_ignores_blank_and_comments(tmp_path):
    p = tmp_path / "x.wgsl"
    p.write_text("// c\n\nfn a() {}\n  // d\n/* block\n  still */\nlet x = 1;\n")
    assert count_loc(p) == 2


def test_tactic_files_exist():
    for files in list(TACTIC_FILES.values()) + [SHARED]:
        for f in files:
            assert (Path("public") / f).exists(), f


def test_table_has_every_tactic():
    rows = table()
    names = {r["tactic"] for r in rows}
    assert {"mesh", "cubes", "planes", "greedy", "raycast", "hybrid", "fx", "shared core"} <= names
    assert all(r["loc"] > 0 for r in rows)
