"""
Build precomputed radial cluster layouts for role and narrative overviews.

3-ring structure: inner arc dots → middle branch → outer leaves
Center is empty. Similar to theme tree aesthetic.
"""
from __future__ import annotations

import json, math
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"

COLORS_BY_TYPE = {
    "角色关系": ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f"],
    "叙事结构": ["#e15759", "#4e79a7", "#f28e2b", "#76b7b2", "#59a14f"],
}


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists(): return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def polar_point(cx, cy, angle_deg, radius):
    a = math.radians(angle_deg - 90)
    return cx + math.cos(a) * radius, cy + math.sin(a) * radius


def annular_sector_path(cx, cy, start_deg, end_deg, inner_r, outer_r):
    x0, y0 = polar_point(cx, cy, start_deg, inner_r)
    x1, y1 = polar_point(cx, cy, end_deg, inner_r)
    x2, y2 = polar_point(cx, cy, end_deg, outer_r)
    x3, y3 = polar_point(cx, cy, start_deg, outer_r)
    la = 1 if abs(end_deg - start_deg) > 180 else 0
    return (
        f"M{x0:.3f},{y0:.3f}"
        f"A{inner_r:.3f},{inner_r:.3f} 0 {la} 1 {x1:.3f},{y1:.3f}"
        f"L{x2:.3f},{y2:.3f}"
        f"A{outer_r:.3f},{outer_r:.3f} 0 {la} 0 {x3:.3f},{y3:.3f}Z"
    )


def link_step(start_deg, start_r, end_deg, end_r):
    if start_r == 0:
        a1 = math.radians(end_deg - 90)
        c1, s1 = math.cos(a1), math.sin(a1)
        return f"M0.000,0.000L{(end_r * c1):.3f},{(end_r * s1):.3f}"
    a0 = math.radians(start_deg - 90)
    a1 = math.radians(end_deg - 90)
    c0, s0 = math.cos(a0), math.sin(a0)
    c1, s1 = math.cos(a1), math.sin(a1)
    arc = ""
    if abs(end_deg - start_deg) > 0.001:
        sweep = 1 if end_deg > start_deg else 0
        arc = f"A{start_r:.3f},{start_r:.3f} 0 0 {sweep} {(start_r * c1):.3f},{(start_r * s1):.3f}"
    return f"M{(start_r * c0):.3f},{(start_r * s0):.3f}{arc}L{(end_r * c1):.3f},{(end_r * s1):.3f}"


def text_transform(angle_deg, radius, offset=4.5):
    if angle_deg < 180:
        return f"rotate({angle_deg - 90:.3f}) translate({radius + offset:.3f},0)"
    return f"rotate({angle_deg - 90:.3f}) translate({radius + offset:.3f},0) rotate(180)"


def build_layout(play_labels, category_key, label_key, colors, layout_name):
    """Build 3-ring radial cluster layout."""
    groups = defaultdict(list)
    for p in play_labels:
        cat = p[category_key][label_key]
        groups[cat].append(p)

    sorted_groups = sorted(groups.items(), key=lambda x: -len(x[1]))
    color_by_group = {name: colors[i % len(colors)] for i, (name, _) in enumerate(sorted_groups)}

    total_plays = len(play_labels)
    center = [450, 450]

    # Three ring radii (center stays empty)
    R_LEAF = 430
    R_BRANCH = 290
    R_INNER = 150

    # Assign angular sectors proportional to play count
    angle_ranges = []
    cursor = 0
    for name, items in sorted_groups:
        span = 360 * len(items) / total_plays
        angle_ranges.append((name, items, cursor, cursor + span))
        cursor += span

    branches = []
    all_links = []
    all_leaves = []
    link_idx = 0

    for name, items, start_deg, end_deg in angle_ranges:
        color = color_by_group[name]
        mid_deg = (start_deg + end_deg) / 2
        n_items = len(items)

        # --- INNER ring: sub-dots (3-20 per category) ---
        n_inner = max(3, min(20, n_items // 30))
        inner_link_ids = []
        for j in range(n_inner):
            ia = start_deg + (j + 0.5) / n_inner * (end_deg - start_deg)
            iid = f"inner:{name}:{j}"
            branches.append({
                "id": iid, "name": name, "angle": round(ia, 3),
                "radius": R_INNER,
                "transform": f"rotate({ia - 90:.3f}) translate({R_INNER:.3f},0)",
                "total_count": n_items, "color": color, "is_inner": True,
            })
            link_idx += 1
            all_links.append({
                "idx": link_idx, "source": iid, "target": f"branch:{name}",
                "path": link_step(ia, R_INNER, mid_deg, R_BRANCH),
                "color": color,
            })
            inner_link_ids.append(link_idx)

        # --- MIDDLE ring: one category branch dot ---
        bid = f"branch:{name}"
        branches.append({
            "id": bid, "name": name, "angle": round(mid_deg, 3),
            "radius": R_BRANCH,
            "transform": f"rotate({mid_deg - 90:.3f}) translate({R_BRANCH:.3f},0)",
            "total_count": n_items, "color": color,
        })

        # --- OUTER ring: leaves ---
        for i, item in enumerate(items):
            la = start_deg + (i + 0.5) / n_items * (end_deg - start_deg)
            link_idx += 1
            all_links.append({
                "idx": link_idx, "source": bid, "target": f"leaf:{item['play_id']}",
                "path": link_step(mid_deg, R_BRANCH, la, R_LEAF),
                "color": color,
            })
            all_leaves.append({
                "id": f"leaf:{item['play_id']}",
                "play_id": item["play_id"], "name": item["title"],
                "category": name,
                "angle": round(la, 3), "radius": R_LEAF,
                "transform": text_transform(la, R_LEAF),
                "text_anchor": "start" if la < 180 else "end",
                "color": color,
                "path_ids": inner_link_ids + [link_idx],
            })

    # Hit paths for leaves
    sorted_leaves = sorted(all_leaves, key=lambda x: x["angle"])
    for i, leaf in enumerate(sorted_leaves):
        pi = i - 1 if i > 0 else len(sorted_leaves) - 1
        ni = i + 1 if i < len(sorted_leaves) - 1 else 0
        prev_a = sorted_leaves[pi]["angle"]
        if i == 0:
            prev_a -= 360
        next_a = sorted_leaves[ni]["angle"]
        if i == len(sorted_leaves) - 1:
            next_a += 360
        start = (prev_a + leaf["angle"]) / 2
        end = (leaf["angle"] + next_a) / 2
        leaf["hit_path"] = annular_sector_path(*center, start, end, R_LEAF - 12, R_LEAF + 88)

    # Legend
    legend = [{"name": name, "color": color_by_group[name], "count": len(items)}
              for name, items in sorted_groups]

    return {
        "schema_version": 1, "view_type": layout_name,
        "viewBox": [0, 0, 900, 900], "center": center,
        "inner_radius": R_LEAF,
        "branch_radius": R_BRANCH, "inner_ring_radius": R_INNER,
        "legend": legend, "branches": branches, "links": all_links, "leaves": all_leaves,
        "total_plays": total_plays,
    }


def main():
    vl = read_json(PROCESSED / "visual_labels.json", {})
    play_labels = vl.get("play_labels", [])
    if not play_labels:
        print("No play_labels found")
        return

    for cat_key, lbl_key, colors, fname in [
        ("y_relation", "label", COLORS_BY_TYPE["角色关系"], "role_overview_layout.json"),
        ("z_narrative", "label", COLORS_BY_TYPE["叙事结构"], "narrative_overview_layout.json"),
    ]:
        layout = build_layout(play_labels, cat_key, lbl_key, colors, fname)
        write_json(PROCESSED / fname, layout)
        print(f"{fname}: {len(layout['branches'])} branches ({sum(1 for b in layout['branches'] if b.get('is_inner'))} inner), {len(layout['leaves'])} leaves, {len(layout['links'])} links")


if __name__ == "__main__":
    main()
