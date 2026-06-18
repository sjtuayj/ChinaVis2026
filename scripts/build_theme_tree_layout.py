from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"

COLORS = [
    "#4e79a7",
    "#f28e2b",
    "#e15759",
    "#76b7b2",
    "#59a14f",
    "#edc949",
    "#af7aa1",
    "#ff9da7",
    "#9c755f",
    "#bab0ab",
]


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def link_step(start_angle: float, start_radius: float, end_angle: float, end_radius: float) -> str:
    a0 = math.radians(start_angle - 90)
    a1 = math.radians(end_angle - 90)
    c0, s0 = math.cos(a0), math.sin(a0)
    c1, s1 = math.cos(a1), math.sin(a1)
    arc = ""
    if end_angle != start_angle:
        sweep = 1 if end_angle > start_angle else 0
        arc = f"A{start_radius:.3f},{start_radius:.3f} 0 0 {sweep} {(start_radius * c1):.3f},{(start_radius * s1):.3f}"
    return f"M{(start_radius * c0):.3f},{(start_radius * s0):.3f}{arc}L{(end_radius * c1):.3f},{(end_radius * s1):.3f}"


def text_transform(angle: float, radius: float, offset: float = 4.5) -> str:
    if angle < 180:
        return f"rotate({angle - 90:.3f}) translate({radius + offset:.3f},0)"
    return f"rotate({angle - 90:.3f}) translate({radius + offset:.3f},0) rotate(180)"


def polar_point(center: list[float], angle: float, radius: float) -> tuple[float, float]:
    radians = math.radians(angle - 90)
    return center[0] + math.cos(radians) * radius, center[1] + math.sin(radians) * radius


def annular_sector_path(center: list[float], start_angle: float, end_angle: float, inner_radius: float, outer_radius: float) -> str:
    x0, y0 = polar_point(center, start_angle, inner_radius)
    x1, y1 = polar_point(center, end_angle, inner_radius)
    x2, y2 = polar_point(center, end_angle, outer_radius)
    x3, y3 = polar_point(center, start_angle, outer_radius)
    large_arc = 1 if abs(end_angle - start_angle) > 180 else 0
    return (
        f"M{x0:.3f},{y0:.3f}"
        f"A{inner_radius:.3f},{inner_radius:.3f} 0 {large_arc} 1 {x1:.3f},{y1:.3f}"
        f"L{x2:.3f},{y2:.3f}"
        f"A{outer_radius:.3f},{outer_radius:.3f} 0 {large_arc} 0 {x3:.3f},{y3:.3f}"
        "Z"
    )


def get_theme_path(topic: dict[str, Any], fallback: str) -> list[str]:
    themes = [
        item
        for item in topic.get("themes", [])
        if item.get("theme") and float(item.get("weight") or 0) > 0
    ]
    themes.sort(key=lambda item: float(item.get("weight") or 0), reverse=True)
    strong = [item["theme"] for index, item in enumerate(themes) if index == 0 or float(item.get("weight") or 0) >= 0.055]
    path = strong[:3] or [fallback or "主题待分析"]
    return list(dict.fromkeys(path))[:3]


def build_tree(play_labels: list[dict[str, Any]], topics: list[dict[str, Any]]) -> dict[str, Any]:
    topic_by_id = {item["play_id"]: item for item in topics}
    root = {
        "name": "主题",
        "children": [],
        "child_map": {},
        "depth": 0,
        "length": 0,
        "total_count": len(play_labels),
    }
    path_counts = Counter()
    prepared = []

    for item in play_labels:
        path = get_theme_path(topic_by_id.get(item["play_id"], {}), item.get("x_theme", {}).get("label"))
        prepared.append((item, path))
        for index in range(len(path)):
            path_counts[" | ".join(path[: index + 1])] += 1

    prepared.sort(key=lambda pair: (pair[0].get("x_theme", {}).get("label", ""), pair[0].get("title", "")))

    for item, path in prepared:
        parent = root
        for depth, theme in enumerate(path, 1):
            child = parent["child_map"].get(theme)
            if child is None:
                prefix = " | ".join(path[:depth])
                child = {
                    "name": theme,
                    "children": [],
                    "child_map": {},
                    "depth": depth,
                    "length": 0.85 + (depth - 1) * 0.42,
                    "total_count": path_counts[prefix],
                    "primary": path[0],
                }
                parent["child_map"][theme] = child
                parent["children"].append(child)
            parent = child
        parent["children"].append(
            {
                "name": item.get("title"),
                "play_id": item.get("play_id"),
                "depth": len(path) + 1,
                "length": 0.45 + min(float(item.get("label_confidence") or 0.5) * 0.85, 0.9),
                "theme_path": path,
                "primary": path[0],
            }
        )

    sort_tree(root)
    strip_maps(root)
    return root


def sort_tree(node: dict[str, Any]) -> None:
    if not node.get("children"):
        return
    node["children"].sort(key=lambda item: (0 if item.get("children") else 1, -(item.get("total_count") or 0), item.get("name") or ""))
    for child in node["children"]:
        sort_tree(child)


def strip_maps(node: dict[str, Any]) -> None:
    node.pop("child_map", None)
    for child in node.get("children", []):
        strip_maps(child)


def leaves(node: dict[str, Any]) -> list[dict[str, Any]]:
    if not node.get("children"):
        return [node]
    result = []
    for child in node["children"]:
        result.extend(leaves(child))
    return result


def assign_angles(node: dict[str, Any], start: float, end: float) -> None:
    node["angle"] = (start + end) / 2
    children = node.get("children") or []
    if not children:
        return
    total = sum(len(leaves(child)) for child in children)
    cursor = start
    for child in children:
        span = (end - start) * len(leaves(child)) / total if total else 0
        assign_angles(child, cursor, cursor + span)
        cursor += span


def max_length(node: dict[str, Any], current: float = 0) -> float:
    total = current + float(node.get("length") or 0)
    children = node.get("children") or []
    if not children:
        return total
    return max(max_length(child, total) for child in children)


def assign_radius(node: dict[str, Any], current: float, scale: float) -> None:
    radius = current + float(node.get("length") or 0)
    node["radius"] = radius * scale
    for child in node.get("children", []):
        assign_radius(child, radius, scale)


def assign_colors(node: dict[str, Any], color_by_primary: dict[str, str], inherited: str = "#8f1f28") -> None:
    color = color_by_primary.get(node.get("primary"), inherited)
    node["color"] = color
    for child in node.get("children", []):
        assign_colors(child, color_by_primary, color)


def collect_nodes(node: dict[str, Any], parent_id: str | None, rows: dict[str, list[dict[str, Any]]], inner_radius: float) -> None:
    node_id = node.get("play_id") or f'{parent_id or "root"}:{node.get("name")}'
    is_leaf = not node.get("children")
    if parent_id is not None:
        rows["links"].append(
            {
                "source": parent_id,
                "target": node_id,
                "path": link_step(node.get("parent_angle", 0), node.get("parent_radius", 0), node["angle"], node["radius"]),
                "extension_path": link_step(node["angle"], node["radius"], node["angle"], inner_radius) if is_leaf else None,
                "color": node["color"],
            }
        )
    if is_leaf:
        rows["leaves"].append(
            {
                "id": node_id,
                "play_id": node.get("play_id"),
                "name": node.get("name"),
                "theme_path": node.get("theme_path", []),
                "angle": round(node["angle"], 3),
                "radius": round(node["radius"], 3),
                "transform": text_transform(node["angle"], inner_radius),
                "text_anchor": "start" if node["angle"] < 180 else "end",
                "color": node["color"],
                "path_ids": [],
            }
        )
    elif parent_id is not None:
        rows["branches"].append(
            {
                "id": node_id,
                "name": node.get("name"),
                "angle": round(node["angle"], 3),
                "radius": round(node["radius"], 3),
                "transform": f"rotate({node['angle'] - 90:.3f}) translate({node['radius']:.3f},0)",
                "total_count": node.get("total_count", 0),
                "color": node["color"],
            }
        )
    for child in node.get("children", []):
        child["parent_angle"] = node["angle"]
        child["parent_radius"] = node["radius"]
        collect_nodes(child, node_id, rows, inner_radius)


def add_leaf_paths(rows: dict[str, list[dict[str, Any]]]) -> None:
    parent_by_target = {link["target"]: link["source"] for link in rows["links"]}
    link_by_target = {link["target"]: index for index, link in enumerate(rows["links"])}
    for leaf in rows["leaves"]:
        path_ids = []
        cursor = leaf["id"]
        while cursor in parent_by_target:
            path_ids.append(link_by_target[cursor])
            cursor = parent_by_target[cursor]
        leaf["path_ids"] = path_ids


def add_leaf_hit_paths(leaves: list[dict[str, Any]], center: list[float], inner_radius: float) -> None:
    if not leaves:
        return
    ordered = sorted(leaves, key=lambda item: item["angle"])
    for index, leaf in enumerate(ordered):
        angle = leaf["angle"]
        prev_angle = ordered[index - 1]["angle"] if index > 0 else ordered[-1]["angle"] - 360
        next_angle = ordered[index + 1]["angle"] if index < len(ordered) - 1 else ordered[0]["angle"] + 360
        start = (prev_angle + angle) / 2
        end = (angle + next_angle) / 2
        leaf["hit_path"] = annular_sector_path(center, start, end, inner_radius - 12, inner_radius + 22)


def build_layout() -> dict[str, Any]:
    labels = read_json(PROCESSED / "visual_labels.json", {})
    topics = read_json(PROCESSED / "topic_narrative_integrated.json", [])
    play_labels = labels.get("play_labels", [])
    tree = build_tree(play_labels, topics)
    inner_radius = 430
    assign_angles(tree, 0, 360)
    scale = inner_radius / max_length(tree)
    assign_radius(tree, 0, scale)
    primaries = [child["name"] for child in tree.get("children", [])]
    color_by_primary = {name: COLORS[index % len(COLORS)] for index, name in enumerate(primaries)}
    assign_colors(tree, color_by_primary)
    rows = {"branches": [], "links": [], "leaves": []}
    collect_nodes(tree, None, rows, inner_radius)
    add_leaf_paths(rows)
    add_leaf_hit_paths(rows["leaves"], [450, 450], inner_radius)
    return {
        "schema_version": 1,
        "viewBox": [0, 0, 900, 900],
        "center": [450, 450],
        "inner_radius": inner_radius,
        "legend": [
            {"name": name, "color": color_by_primary[name], "count": next(child["total_count"] for child in tree["children"] if child["name"] == name)}
            for name in primaries
        ],
        "branches": rows["branches"],
        "links": rows["links"],
        "leaves": rows["leaves"],
    }


if __name__ == "__main__":
    layout = build_layout()
    write_json(PROCESSED / "theme_tree_layout.json", layout)
    print(
        {
            "branches": len(layout["branches"]),
            "links": len(layout["links"]),
            "leaves": len(layout["leaves"]),
        }
    )
