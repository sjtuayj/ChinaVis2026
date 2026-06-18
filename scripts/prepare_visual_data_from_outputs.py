from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ROOT / "outputs"
ANALYSIS = OUTPUTS / "opera_analysis"
SEMANTICS = OUTPUTS / "opera_semantics"
PROCESSED = ROOT / "data" / "processed"


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_metrics_csv() -> dict[str, dict[str, str]]:
    path = ANALYSIS / "play_metrics.csv"
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return {row["play_id"]: row for row in csv.DictReader(file)}


def relation_structure(metrics: dict[str, Any]) -> str:
    density = float(metrics.get("density") or 0)
    node_count = int(metrics.get("node_count") or 0)
    top = metrics.get("top_characters") or []
    if node_count <= 3:
        return "小群体集中型"
    if density >= 0.62:
        return "群像密集型"
    if density >= 0.42 and len(top) >= 2:
        return "双核心/阵营对抗型"
    if density <= 0.18:
        return "弱关系散点型"
    return "核心角色辐射型"


def narrative_pattern(profile: dict[str, Any]) -> str:
    phase_counts = profile.get("phase_counts") or {}
    scene_count = int(profile.get("scene_count") or 0)
    avg = float(profile.get("avg_intensity") or 0)
    peak_phase = (profile.get("peak_scene") or {}).get("phase")
    if scene_count <= 1 or "single" in phase_counts:
        return "单场集中型"
    if phase_counts.get("climax", 0) >= 2:
        return "多峰冲突推进"
    if peak_phase == "climax" and avg >= 32:
        return "高强度高潮型"
    if phase_counts.get("resolution", 0) >= phase_counts.get("climax", 0) + 2:
        return "铺垫-转折-收束"
    return "铺垫-发展-高潮-结局"


def stage_rows(profile: dict[str, Any]) -> list[dict[str, Any]]:
    scenes = profile.get("scene_rhythm") or []
    if not scenes:
        return []
    grouped: dict[str, list[dict[str, Any]]] = {}
    for scene in scenes:
        grouped.setdefault(scene.get("phase") or "unknown", []).append(scene)
    rows = []
    for phase, items in grouped.items():
        orders = [int(item.get("order") or 0) for item in items]
        rows.append(
            {
                "stage": phase,
                "scene_range": [min(orders), max(orders)] if orders else [0, 0],
                "events": [item.get("label") or item.get("scene_id") for item in items[:4]],
            }
        )
    return rows


def edge_label(edge: dict[str, Any]) -> str:
    dialogue = int(edge.get("dialogue_turns") or 0)
    cooccur = int(edge.get("scene_cooccurrence") or 0)
    weight = float(edge.get("weight") or 0)
    if dialogue >= 8:
        return "强对话互动"
    if cooccur >= 3:
        return "多场共现"
    if weight >= 8:
        return "强关联"
    return "同场共现"


def build_role_network(graph_index: list[dict[str, Any]], graph_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    networks = []
    for row in graph_index:
        play_id = row.get("play_id")
        graph = graph_by_id.get(play_id) or {}
        metrics = graph.get("metrics") or row
        max_degree = max((float(node.get("weighted_degree") or node.get("degree") or 0) for node in graph.get("nodes", [])), default=1)
        max_degree = max(max_degree, 1)
        nodes = [
            {
                "id": node.get("id") or node.get("label"),
                "name": node.get("label") or node.get("id"),
                "hangdang": node.get("hangdang") or "未知",
                "gender": None,
                "identity": [],
                "importance_score": round(float(node.get("weighted_degree") or node.get("degree") or 0) / max_degree, 3),
                "speech_count": node.get("speech_count", 0),
                "degree": node.get("degree", 0),
            }
            for node in graph.get("nodes", [])
        ]
        edges = [
            {
                "source": edge.get("source"),
                "target": edge.get("target"),
                "type": "interaction",
                "relation_label": edge_label(edge),
                "weight": edge.get("weight", 1),
                "scene_ids": edge.get("scenes", []),
                "dialogue_turns": edge.get("dialogue_turns", 0),
                "scene_cooccurrence": edge.get("scene_cooccurrence", 0),
                "evidence": [],
            }
            for edge in graph.get("edges", [])
        ]
        networks.append(
            {
                "play_id": play_id,
                "title": row.get("title"),
                "genre": None,
                "nodes": nodes,
                "edges": edges,
                "network_metrics": {
                    "density": metrics.get("density", 0),
                    "central_roles": [item.get("name") for item in metrics.get("top_characters", [])[:5]],
                    "structure_type": relation_structure(metrics),
                    "node_count": metrics.get("node_count", len(nodes)),
                    "edge_count": metrics.get("edge_count", len(edges)),
                },
            }
        )
    return networks


def build_topic_records(
    themes_by_id: dict[str, dict[str, Any]],
    narrative_by_id: dict[str, dict[str, Any]],
    integrated_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    records = []
    for play_id, theme_profile in themes_by_id.items():
        narrative = narrative_by_id.get(play_id, {})
        integrated = integrated_by_id.get(play_id, {})
        top_roles = [
            item.get("name")
            for item in (integrated.get("network") or {}).get("top_characters", [])[:6]
            if item.get("name")
        ]
        themes = []
        for item in theme_profile.get("theme_scores", [])[:8]:
            evidence = item.get("evidence") or []
            themes.append(
                {
                    "theme": item.get("theme"),
                    "weight": round(float(item.get("share") or 0), 3),
                    "keywords": [entry.get("keyword") for entry in evidence if entry.get("keyword")][:8],
                    "related_roles": top_roles,
                    "raw_score": item.get("score", 0),
                }
            )
        rhythm_curve = [
            {
                "scene_no": scene.get("order"),
                "tension": round(min(1.0, float((scene.get("rhythm") or {}).get("intensity") or 0) / 55), 3),
                "event_count": scene.get("speech_count", 0),
                "aria_count": (scene.get("marker_category_counts") or {}).get("singing", 0),
                "phase": scene.get("phase"),
                "label": scene.get("label"),
            }
            for scene in narrative.get("scene_rhythm", [])
        ]
        dominant = theme_profile.get("dominant_theme") or "未识别主题"
        records.append(
            {
                "play_id": play_id,
                "title": theme_profile.get("title"),
                "genre": dominant,
                "story_period": theme_profile.get("group_id"),
                "themes": themes,
                "narrative_structure": {
                    "stages": stage_rows(narrative),
                    "rhythm_curve": rhythm_curve,
                    "pattern": narrative_pattern(narrative),
                },
                "integrated_patterns": [
                    {
                        "pattern": hypothesis,
                        "roles": top_roles[:3],
                        "theme": dominant,
                        "narrative_function": "角色关系、主题组合与叙事节奏的联动假设",
                    }
                    for hypothesis in (integrated.get("linkage_hypotheses") or ["主题-角色-叙事联动待分析"])[:3]
                ],
            }
        )
    return records


def build_bundle(
    graph_index: list[dict[str, Any]],
    role_networks: list[dict[str, Any]],
    topic_records: list[dict[str, Any]],
    narrative_by_id: dict[str, dict[str, Any]],
    metrics_by_id: dict[str, dict[str, str]],
) -> dict[str, Any]:
    topic_by_id = {item["play_id"]: item for item in topic_records}
    play_table = []
    role_table = []
    role_network_nodes = []
    role_network_edges = []
    topic_play_matrix = []
    theme_role_links = []
    narrative_stage_table = []
    rhythm_curves = []
    integrated_patterns = []
    hangdang_counter = Counter()

    for row in graph_index:
        play_id = row.get("play_id")
        topic = topic_by_id.get(play_id, {})
        metrics_row = metrics_by_id.get(play_id, {})
        play_table.append(
            {
                "play_id": play_id,
                "title": row.get("title"),
                "collection_id": row.get("group_id"),
                "collection_name": row.get("group_id"),
                "genre": topic.get("genre"),
                "story_period": topic.get("story_period"),
                "page_count": metrics_row.get("page_count") or None,
            }
        )

    for network in role_networks:
        for node in network["nodes"]:
            role_table.append(
                {
                    "play_id": network["play_id"],
                    "title": network["title"],
                    "collection_id": None,
                    "story_period": None,
                    "genre": None,
                    "role": node["name"],
                    "original_category": node.get("hangdang"),
                    "predicted_broad": node.get("hangdang"),
                    "predicted_fine": node.get("hangdang"),
                    "confidence": 0.7 if node.get("hangdang") != "未知" else 0.25,
                    "gender": None,
                    "age_group": None,
                    "identity": [],
                    "personality_traits": [],
                    "spoken_count": node.get("speech_count", 0),
                    "aria_count": 0,
                    "recitation_count": 0,
                    "expression_count": 0,
                    "action_hint_count": 0,
                    "combat_hint_count": 0,
                }
            )
            hangdang_counter[node.get("hangdang") or "未知"] += 1
            role_network_nodes.append({"play_id": network["play_id"], "title": network["title"], **node})
        for edge in network["edges"]:
            role_network_edges.append({"play_id": network["play_id"], "title": network["title"], **edge})

    for item in topic_records:
        for theme in item["themes"]:
            topic_play_matrix.append(
                {
                    "play_id": item["play_id"],
                    "title": item["title"],
                    "theme": theme["theme"],
                    "weight": theme["weight"],
                    "keywords": theme["keywords"],
                }
            )
            for role in theme.get("related_roles", []):
                theme_role_links.append(
                    {
                        "play_id": item["play_id"],
                        "theme": theme["theme"],
                        "role": role,
                        "weight": theme["weight"],
                    }
                )
        for stage in item["narrative_structure"]["stages"]:
            narrative_stage_table.append({"play_id": item["play_id"], "title": item["title"], **stage})
        for point in item["narrative_structure"]["rhythm_curve"]:
            rhythm_curves.append({"play_id": item["play_id"], "title": item["title"], **point})
        for pattern in item["integrated_patterns"]:
            integrated_patterns.append({"play_id": item["play_id"], "title": item["title"], **pattern})

    for profile in narrative_by_id.values():
        for scene in profile.get("scene_rhythm", []):
            pass

    return {
        "play_table": play_table,
        "role_table": role_table,
        "feature_hangdang_matrix": [
            {"feature": "角色", "hangdang": hangdang, "count": count}
            for hangdang, count in hangdang_counter.most_common()
        ],
        "period_hangdang_trends": [],
        "scene_timeline": [],
        "role_network_nodes": role_network_nodes,
        "role_network_edges": role_network_edges,
        "topic_play_matrix": topic_play_matrix,
        "theme_role_links": theme_role_links,
        "narrative_stage_table": narrative_stage_table,
        "rhythm_curves": rhythm_curves,
        "integrated_patterns": integrated_patterns,
    }


def main() -> None:
    graph_index = read_json(ANALYSIS / "graph_index.json", [])
    metrics_by_id = read_metrics_csv()
    graph_by_id = {
        path.stem: read_json(path, {})
        for path in sorted((ANALYSIS / "graphs").glob("*.json"))
    }
    themes_by_id = {row["play_id"]: row for row in read_jsonl(SEMANTICS / "play_theme_profiles.jsonl")}
    narrative_by_id = {row["play_id"]: row for row in read_jsonl(SEMANTICS / "narrative_profiles.jsonl")}
    integrated_by_id = {row["play_id"]: row for row in read_jsonl(SEMANTICS / "integrated_profiles.jsonl")}

    role_networks = build_role_network(graph_index, graph_by_id)
    topic_records = build_topic_records(themes_by_id, narrative_by_id, integrated_by_id)
    bundle = build_bundle(graph_index, role_networks, topic_records, narrative_by_id, metrics_by_id)

    write_json(PROCESSED / "role_networks.json", role_networks)
    write_json(PROCESSED / "topic_narrative_integrated.json", topic_records)
    write_json(PROCESSED / "visualization_bundle.json", bundle)

    print(
        {
            "plays": len(bundle["play_table"]),
            "role_networks": len(role_networks),
            "topic_records": len(topic_records),
            "role_nodes": len(bundle["role_network_nodes"]),
            "role_edges": len(bundle["role_network_edges"]),
        }
    )


if __name__ == "__main__":
    main()
