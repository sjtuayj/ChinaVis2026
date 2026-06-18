#!/usr/bin/env python
"""Build graph-ready datasets and quality reports from parsed opera JSONL."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable, Iterator


SUSPICIOUS_NAME_PATTERNS = [
    re.compile(r"中国京剧戏考"),
    re.compile(r"https?://"),
    re.compile(r"^\d+$"),
    re.compile(r"[《》【】]"),
    re.compile(r".{16,}"),
    re.compile(r"[，。！？；：“”]"),
]

GENERIC_SPEAKERS = {
    "内",
    "众",
    "众人",
    "同",
    "合",
    "二人",
    "三人",
    "四人",
    "大家",
}


def read_jsonl(path: Path) -> Iterator[dict]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield json.loads(line)


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def suspicious_name_reason(name: str) -> str | None:
    if not name:
        return "empty"
    if name in GENERIC_SPEAKERS:
        return "generic_speaker"
    for pattern in SUSPICIOUS_NAME_PATTERNS:
        if pattern.search(name):
            return pattern.pattern
    return None


def safe_ratio(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def round_float(value: float, digits: int = 6) -> float:
    if math.isnan(value) or math.isinf(value):
        return 0.0
    return round(value, digits)


def load_inputs(input_dir: Path) -> tuple[dict[str, dict], dict[str, list[dict]], dict[str, list[dict]]]:
    plays: dict[str, dict] = {}
    characters: dict[str, list[dict]] = defaultdict(list)
    relations: dict[str, list[dict]] = defaultdict(list)

    for play in read_jsonl(input_dir / "plays.jsonl"):
        plays[play["play_id"]] = {
            "play_id": play["play_id"],
            "title": play["title"],
            "pdf_name": play.get("pdf_name"),
            "group_id": play.get("group_id"),
            "page_count": play.get("page_count", 0),
            "scene_count": play.get("scene_count", 0),
            "speech_count": play.get("speech_count", 0),
            "character_count": play.get("character_count", 0),
            "source_url": play.get("source_url"),
            "source_date": play.get("source_date"),
            "synopsis_length": len(play.get("synopsis") or ""),
            "notes_length": len(play.get("notes") or ""),
            "marker_category_counts": play.get("marker_category_counts") or {},
        }

    for row in read_jsonl(input_dir / "characters.jsonl"):
        characters[row["play_id"]].append(row)

    for row in read_jsonl(input_dir / "relations.jsonl"):
        relations[row["play_id"]].append(row)

    return plays, characters, relations


def build_graph(play: dict, characters: list[dict], relations: list[dict]) -> dict:
    weighted_degree: Counter[str] = Counter()
    degree_neighbors: dict[str, set[str]] = defaultdict(set)

    for edge in relations:
        source = edge["source"]
        target = edge["target"]
        weight = edge.get("weight", 0)
        weighted_degree[source] += weight
        weighted_degree[target] += weight
        degree_neighbors[source].add(target)
        degree_neighbors[target].add(source)

    nodes = []
    for character in characters:
        name = character["name"]
        nodes.append(
            {
                "id": name,
                "label": name,
                "raw_role": character.get("raw_role"),
                "hangdang": character.get("hangdang") or "未知",
                "speech_count": character.get("speech_count", 0),
                "text_length": character.get("text_length", 0),
                "scene_count": character.get("scene_count", 0),
                "degree": len(degree_neighbors.get(name, set())),
                "weighted_degree": weighted_degree.get(name, 0),
                "marker_category_counts": character.get("marker_category_counts") or {},
            }
        )

    edges = [
        {
            "source": edge["source"],
            "target": edge["target"],
            "weight": edge.get("weight", 0),
            "scene_cooccurrence": edge.get("scene_cooccurrence", 0),
            "dialogue_turns": edge.get("dialogue_turns", 0),
            "scenes": edge.get("scenes", []),
        }
        for edge in relations
    ]

    node_count = len(nodes)
    edge_count = len(edges)
    density = safe_ratio(2 * edge_count, node_count * (node_count - 1))

    nodes.sort(key=lambda item: (-item["weighted_degree"], -item["speech_count"], item["label"]))
    edges.sort(key=lambda item: (-item["weight"], item["source"], item["target"]))

    return {
        "play": play,
        "metrics": {
            "node_count": node_count,
            "edge_count": edge_count,
            "density": round_float(density),
            "avg_degree": round_float(safe_ratio(2 * edge_count, node_count)),
            "avg_weighted_degree": round_float(safe_ratio(sum(weighted_degree.values()), node_count)),
            "max_edge_weight": max((edge["weight"] for edge in edges), default=0),
            "top_characters": [
                {
                    "name": node["label"],
                    "hangdang": node["hangdang"],
                    "speech_count": node["speech_count"],
                    "degree": node["degree"],
                    "weighted_degree": node["weighted_degree"],
                }
                for node in nodes[:5]
            ],
        },
        "nodes": nodes,
        "edges": edges,
    }


def build_quality_row(play: dict, characters: list[dict], relations: list[dict], graph: dict) -> dict:
    character_count = len(characters)
    role_labeled = sum(1 for item in characters if item.get("raw_role"))
    hangdang_labeled = sum(1 for item in characters if item.get("hangdang"))
    suspicious = []

    for item in characters:
        reason = suspicious_name_reason(item["name"])
        if reason:
            suspicious.append({"name": item["name"], "reason": reason})

    flags = []
    if play["scene_count"] <= 1:
        flags.append("single_scene")
    if play["speech_count"] < 20:
        flags.append("low_speech_count")
    if play["page_count"] >= 5 and play["speech_count"] < 20:
        flags.append("possible_parse_issue")
    if character_count == 0:
        flags.append("no_characters")
    if relations and character_count < 2:
        flags.append("relation_without_enough_characters")
    if suspicious:
        flags.append("suspicious_character_names")

    return {
        "play_id": play["play_id"],
        "title": play["title"],
        "group_id": play.get("group_id"),
        "page_count": play["page_count"],
        "scene_count": play["scene_count"],
        "speech_count": play["speech_count"],
        "character_rows": character_count,
        "role_coverage": round_float(safe_ratio(role_labeled, character_count)),
        "hangdang_coverage": round_float(safe_ratio(hangdang_labeled, character_count)),
        "edge_count": graph["metrics"]["edge_count"],
        "density": graph["metrics"]["density"],
        "max_edge_weight": graph["metrics"]["max_edge_weight"],
        "top_character": graph["metrics"]["top_characters"][0]["name"] if graph["metrics"]["top_characters"] else None,
        "suspicious_name_count": len(suspicious),
        "suspicious_name_examples": ";".join(f'{item["name"]}:{item["reason"]}' for item in suspicious[:5]),
        "flags": ";".join(flags),
    }


def write_csv(path: Path, rows: Iterable[dict]) -> None:
    rows = list(rows)
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def analyze(args: argparse.Namespace) -> dict:
    input_dir = Path(args.input)
    output_dir = Path(args.output)
    graph_dir = output_dir / "graphs"
    graph_dir.mkdir(parents=True, exist_ok=True)

    plays, characters_by_play, relations_by_play = load_inputs(input_dir)

    quality_rows = []
    graph_index = []
    global_hangdang = Counter()
    global_flags = Counter()
    group_metrics: dict[str, dict] = defaultdict(
        lambda: {
            "play_count": 0,
            "scene_count": 0,
            "speech_count": 0,
            "character_rows": 0,
            "edge_count": 0,
        }
    )

    for index, play_id in enumerate(sorted(plays), start=1):
        play = plays[play_id]
        characters = characters_by_play.get(play_id, [])
        relations = relations_by_play.get(play_id, [])
        graph = build_graph(play, characters, relations)
        quality_row = build_quality_row(play, characters, relations, graph)

        write_json(graph_dir / f"{play_id}.json", graph)
        quality_rows.append(quality_row)

        graph_index.append(
            {
                "play_id": play_id,
                "title": play["title"],
                "group_id": play.get("group_id"),
                "graph_file": f"graphs/{play_id}.json",
                **graph["metrics"],
                "flags": quality_row["flags"],
                "role_coverage": quality_row["role_coverage"],
                "hangdang_coverage": quality_row["hangdang_coverage"],
                "scene_count": play["scene_count"],
                "speech_count": play["speech_count"],
            }
        )

        for character in characters:
            global_hangdang[character.get("hangdang") or "未知"] += 1
        for flag in filter(None, quality_row["flags"].split(";")):
            global_flags[flag] += 1

        group_id = play.get("group_id") or "unknown"
        group = group_metrics[group_id]
        group["play_count"] += 1
        group["scene_count"] += play["scene_count"]
        group["speech_count"] += play["speech_count"]
        group["character_rows"] += len(characters)
        group["edge_count"] += len(relations)

        if args.verbose or index % args.progress_every == 0:
            print(f"[{index}] {play_id} {play['title']} nodes={len(characters)} edges={len(relations)}", flush=True)

    graph_index.sort(key=lambda item: item["play_id"])
    quality_rows.sort(key=lambda item: item["play_id"])

    risky_rows = [
        row
        for row in quality_rows
        if row["flags"]
    ]
    risky_rows.sort(key=lambda item: (-len(item["flags"].split(";")), item["speech_count"], item["play_id"]))

    report = {
        "input": str(input_dir),
        "output": str(output_dir),
        "play_count": len(plays),
        "graph_count": len(graph_index),
        "quality": {
            "flag_counts": dict(global_flags),
            "single_scene_count": global_flags.get("single_scene", 0),
            "low_speech_count": global_flags.get("low_speech_count", 0),
            "possible_parse_issue": global_flags.get("possible_parse_issue", 0),
            "suspicious_character_name_plays": global_flags.get("suspicious_character_names", 0),
            "avg_role_coverage": round_float(
                safe_ratio(sum(row["role_coverage"] for row in quality_rows), len(quality_rows))
            ),
            "avg_hangdang_coverage": round_float(
                safe_ratio(sum(row["hangdang_coverage"] for row in quality_rows), len(quality_rows))
            ),
            "top_risky_plays": risky_rows[:30],
        },
        "hangdang_distribution": dict(global_hangdang.most_common()),
        "group_metrics": dict(sorted(group_metrics.items())),
    }

    write_json(output_dir / "graph_index.json", graph_index)
    write_json(output_dir / "data_quality_report.json", report)
    write_csv(output_dir / "play_metrics.csv", quality_rows)
    write_csv(output_dir / "risky_plays.csv", risky_rows)

    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="outputs/opera_json", help="Directory with parsed JSONL files.")
    parser.add_argument("--output", default="outputs/opera_analysis", help="Output directory for analysis files.")
    parser.add_argument("--progress-every", type=int, default=200, help="Print progress every N plays.")
    parser.add_argument("--verbose", action="store_true", help="Print every processed play.")
    return parser.parse_args()


def main() -> int:
    report = analyze(parse_args())
    print(
        "Done: "
        f'{report["play_count"]} plays, '
        f'{report["graph_count"]} graph files, '
        f'{report["quality"]["single_scene_count"]} single-scene plays, '
        f'{report["quality"]["possible_parse_issue"]} possible parse issues.'
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
