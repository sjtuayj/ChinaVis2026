from __future__ import annotations

import argparse
import math
from collections import Counter, defaultdict
from typing import Any

from common import PROCESSED_DIR, read_json, write_json


THEME_AXIS_ORDER = [
    "智谋对抗",
    "忠义报国",
    "家庭伦理",
    "公案正义",
    "爱情婚姻",
    "征战武勇",
    "女性抗争",
    "神怪奇幻",
    "未识别主题",
]

RELATION_AXIS_ORDER = [
    "群像密集型",
    "双核心/阵营对抗型",
    "家庭伦理中心型",
    "审理辐射型",
    "核心角色辐射型",
    "多中心互动型",
    "角色关系待分析",
]

NARRATIVE_AXIS_ORDER = [
    "冤案-审理-昭雪",
    "家庭冲突-伦理抉择-关系修复",
    "危机-设局-试探-化解",
    "征战-对抗-胜负",
    "铺垫-冲突-转折-结局",
    "叙事结构待分析",
]


def safe_ratio(value: float, total: float) -> float:
    return value / total if total else 0.0


def norm_index(label: str, axis: list[str]) -> int:
    if label in axis:
        return axis.index(label)
    axis.append(label)
    return len(axis) - 1


def confidence_from_weight(weight: float | int | None, fallback: float = 0.35) -> float:
    if weight is None:
        return fallback
    return round(max(0.2, min(0.98, float(weight))), 3)


def dominant_theme(topic: dict[str, Any] | None) -> dict[str, Any]:
    themes = (topic or {}).get("themes") or []
    if not themes:
        return {
            "label": "未识别主题",
            "confidence": 0.2,
            "evidence": [],
            "keywords": [],
        }
    theme = themes[0]
    return {
        "label": theme.get("theme") or "未识别主题",
        "confidence": confidence_from_weight(theme.get("weight")),
        "evidence": theme.get("keywords", [])[:6],
        "keywords": theme.get("keywords", [])[:8],
    }


def relation_label(network: dict[str, Any] | None) -> dict[str, Any]:
    metrics = (network or {}).get("network_metrics") or {}
    density = metrics.get("density")
    central_roles = metrics.get("central_roles") or []
    label = metrics.get("structure_type") or "角色关系待分析"
    confidence = 0.25
    if density is not None:
        confidence = round(max(0.35, min(0.92, 0.45 + float(density))), 3)
    return {
        "label": label,
        "confidence": confidence,
        "evidence": central_roles[:5],
        "density": density,
        "central_roles": central_roles[:5],
    }


def narrative_label(topic: dict[str, Any] | None) -> dict[str, Any]:
    structure = (topic or {}).get("narrative_structure") or {}
    rhythm = structure.get("rhythm_curve") or []
    pattern = structure.get("pattern") or "叙事结构待分析"
    if rhythm:
        peak = max(rhythm, key=lambda item: item.get("tension", 0))
        avg = sum(item.get("tension", 0) for item in rhythm) / len(rhythm)
        confidence = round(max(0.35, min(0.92, 0.45 + avg / 2)), 3)
        evidence = [f"峰值场次 {peak.get('scene_no')}", f"平均张力 {avg:.2f}"]
    else:
        confidence = 0.2
        evidence = []
    return {
        "label": pattern,
        "confidence": confidence,
        "evidence": evidence,
        "rhythm_point_count": len(rhythm),
    }


def build_cube_cells(play_labels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in play_labels:
        grouped[item["cube_id"]].append(item)

    cells = []
    for cube_id, plays in grouped.items():
        first = plays[0]
        cells.append(
            {
                "cube_id": cube_id,
                "x_theme": first["x_theme"]["label"],
                "y_relation": first["y_relation"]["label"],
                "z_narrative": first["z_narrative"]["label"],
                "position": first["cube_position"],
                "play_count": len(plays),
                "play_ids": [play["play_id"] for play in plays],
                "titles": [play["title"] for play in plays[:12]],
                "confidence": round(sum(play["label_confidence"] for play in plays) / len(plays), 3),
            }
        )
    return sorted(cells, key=lambda item: (-item["play_count"], item["cube_id"]))


def build_p1_role_hangdang(bundle: dict[str, Any]) -> dict[str, Any]:
    records = bundle.get("role_table") or []
    link_counter = Counter()
    period_link_counter = Counter()
    for record in records:
        hangdang = record.get("predicted_broad") or record.get("predicted_fine") or "未知"
        period = record.get("story_period") or "未知时期"
        attrs = [
            record.get("gender"),
            record.get("age_group"),
            *(record.get("identity") or [])[:2],
            *(record.get("personality_traits") or [])[:2],
        ]
        for attr in attrs:
            if attr:
                link_counter[(attr, hangdang)] += 1
                period_link_counter[(period, attr, hangdang)] += 1
    return {
        "attribute_to_hangdang": [
            {"source": source, "target": target, "value": value}
            for (source, target), value in link_counter.most_common()
        ],
        "period_attribute_to_hangdang": [
            {"period": period, "source": source, "target": target, "value": value}
            for (period, source, target), value in period_link_counter.most_common()
        ],
    }


def build_p2_network_summary(networks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for network in networks:
        metrics = network.get("network_metrics") or {}
        nodes = network.get("nodes") or []
        edges = network.get("edges") or []
        relation_counts = Counter(edge.get("relation_label") or edge.get("type") or "关联" for edge in edges)
        rows.append(
            {
                "play_id": network.get("play_id"),
                "title": network.get("title"),
                "structure_type": metrics.get("structure_type") or "角色关系待分析",
                "density": metrics.get("density", 0),
                "node_count": len(nodes),
                "edge_count": len(edges),
                "central_roles": metrics.get("central_roles", [])[:5],
                "relation_counts": dict(relation_counts),
            }
        )
    return rows


def build_p3_theme_tree(play_labels: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in play_labels:
        groups[item["x_theme"]["label"]].append(item)
    return {
        "name": "主题",
        "children": [
            {
                "name": theme,
                "count": len(plays),
                "children": [
                    {"name": play["title"], "play_id": play["play_id"], "confidence": play["x_theme"]["confidence"]}
                    for play in plays
                ],
            }
            for theme, plays in sorted(groups.items(), key=lambda pair: (-len(pair[1]), pair[0]))
        ],
    }


def build_p4_narrative_series(topic_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for topic in topic_by_id.values():
        rhythm = ((topic.get("narrative_structure") or {}).get("rhythm_curve")) or []
        if not rhythm:
            continue
        max_tension = max(point.get("tension", 0) for point in rhythm) or 1
        rows.append(
            {
                "play_id": topic.get("play_id"),
                "title": topic.get("title"),
                "pattern": (topic.get("narrative_structure") or {}).get("pattern"),
                "series": [
                    {
                        "scene_no": point.get("scene_no"),
                        "tension": point.get("tension", 0),
                        "normalized_tension": round(safe_ratio(point.get("tension", 0), max_tension), 3),
                        "event_count": point.get("event_count", 0),
                        "aria_count": point.get("aria_count", 0),
                    }
                    for point in rhythm
                ],
            }
        )
    return rows


def build_p5_cube_points(play_labels: list[dict[str, Any]], cells: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "points": [
            {
                "play_id": item["play_id"],
                "title": item["title"],
                "cube_id": item["cube_id"],
                "x": item["cube_position"]["x"],
                "y": item["cube_position"]["y"],
                "z": item["cube_position"]["z"],
                "theme": item["x_theme"]["label"],
                "relation": item["y_relation"]["label"],
                "narrative": item["z_narrative"]["label"],
                "confidence": item["label_confidence"],
            }
            for item in play_labels
        ],
        "cells": cells,
    }


def build_visual_labels(play_ids: set[str] | None = None) -> dict[str, Any]:
    bundle = read_json(PROCESSED_DIR / "visualization_bundle.json", {})
    topics = read_json(PROCESSED_DIR / "topic_narrative_integrated.json", [])
    networks = read_json(PROCESSED_DIR / "role_networks.json", [])

    play_table = bundle.get("play_table") or []
    if play_ids is not None:
        play_table = [play for play in play_table if play.get("play_id") in play_ids]
        topics = [topic for topic in topics if topic.get("play_id") in play_ids]
        networks = [network for network in networks if network.get("play_id") in play_ids]

    topic_by_id = {item.get("play_id"): item for item in topics}
    network_by_id = {item.get("play_id"): item for item in networks}
    theme_axis = [*THEME_AXIS_ORDER]
    relation_axis = [*RELATION_AXIS_ORDER]
    narrative_axis = [*NARRATIVE_AXIS_ORDER]

    play_labels = []
    for play in play_table:
        play_id = play.get("play_id")
        topic = topic_by_id.get(play_id)
        network = network_by_id.get(play_id)
        x = dominant_theme(topic)
        y = relation_label(network)
        z = narrative_label(topic)
        position = {
            "x": norm_index(x["label"], theme_axis),
            "y": norm_index(y["label"], relation_axis),
            "z": norm_index(z["label"], narrative_axis),
        }
        cube_id = f'{x["label"]} | {y["label"]} | {z["label"]}'
        confidence = round((x["confidence"] + y["confidence"] + z["confidence"]) / 3, 3)
        play_labels.append(
            {
                "play_id": play_id,
                "title": play.get("title"),
                "collection_id": play.get("collection_id"),
                "collection_name": play.get("collection_name"),
                "genre": play.get("genre"),
                "story_period": play.get("story_period"),
                "x_theme": x,
                "y_relation": y,
                "z_narrative": z,
                "cube_id": cube_id,
                "cube_position": position,
                "label_confidence": confidence,
            }
        )

    cube_cells = build_cube_cells(play_labels)
    output = {
        "schema_version": 1,
        "axis_definitions": {
            "x_theme": theme_axis,
            "y_relation": relation_axis,
            "z_narrative": narrative_axis,
        },
        "play_labels": play_labels,
        "cube_cells": cube_cells,
        "views": {
            "p1_role_hangdang_evolution": build_p1_role_hangdang(bundle),
            "p2_role_network_summary": build_p2_network_summary(networks),
            "p3_theme_tree": build_p3_theme_tree(play_labels),
            "p4_narrative_series": build_p4_narrative_series(topic_by_id),
            "p5_integrated_cube": build_p5_cube_points(play_labels, cube_cells),
        },
        "quality": {
            "play_count": len(play_labels),
            "cube_cell_count": len(cube_cells),
            "avg_label_confidence": round(
                sum(item["label_confidence"] for item in play_labels) / len(play_labels), 3
            )
            if play_labels
            else 0,
            "low_confidence_play_ids": [
                item["play_id"] for item in play_labels if item["label_confidence"] < 0.45
            ],
            "empty_source_warning": not bool(play_labels),
        },
    }
    write_json(PROCESSED_DIR / "visual_labels.json", output)
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--play-id", action="append", default=None, help="Only label selected play_id values.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    labels = build_visual_labels(set(args.play_id) if args.play_id else None)
    print(
        {
            "plays": labels["quality"]["play_count"],
            "cube_cells": labels["quality"]["cube_cell_count"],
            "avg_label_confidence": labels["quality"]["avg_label_confidence"],
            "low_confidence": len(labels["quality"]["low_confidence_play_ids"]),
        }
    )
