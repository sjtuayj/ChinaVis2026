#!/usr/bin/env python
"""Derive theme and narrative profiles from parsed opera scripts.

This is a deterministic baseline for ChinaVis problem tasks 3, 4, and 5:
- task 3: cross-play theme composition and combinations
- task 4: narrative rhythm and stage structure
- task 5: linkage between role network, themes, and narrative structure

The output is intentionally JSONL so it can feed both visualization and later
LLM refinement. Theme labels here are rule-based and evidence-bearing; they
should be treated as explainable baseline labels, not final human annotations.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable, Iterator


THEME_LEXICON: dict[str, list[str]] = {
    "忠义报国": ["忠", "义", "报国", "尽忠", "忠臣", "忠良", "保国", "兴汉", "社稷", "江山", "先帝", "为国"],
    "权谋战争": ["兵", "军", "战", "攻", "围", "营", "将军", "敌", "计", "诈", "探", "杀", "降", "夺", "破"],
    "公案审判": ["案", "审", "堂", "状", "冤", "屈", "告", "问罪", "斩", "招", "犯", "法", "包公", "县官"],
    "家庭伦理": ["父", "母", "子", "女", "儿", "媳", "婆", "兄", "弟", "姐", "妹", "家", "孝", "认亲"],
    "婚恋离合": ["夫", "妻", "郎", "妾", "姻", "婚", "配", "媒", "情", "相思", "小姐", "公子", "夫妻", "成亲"],
    "复仇雪恨": ["仇", "恨", "报仇", "雪恨", "害", "杀父", "杀母", "冤仇", "报应", "复仇"],
    "忠奸冲突": ["奸", "贼", "忠", "害忠良", "陷害", "奸臣", "叛", "反", "逆", "谋害"],
    "神怪仙佛": ["神", "仙", "佛", "鬼", "妖", "庙", "梦", "魂", "阴", "阳", "天庭", "龙王", "观音"],
    "仕途功名": ["官", "王", "皇", "帝", "圣上", "功名", "状元", "进京", "朝", "殿", "封", "升官"],
    "离别流亡": ["别", "离", "逃", "奔", "走", "流落", "投奔", "出关", "逃难", "失散", "寻", "送"],
}

RHYTHM_LEXICON: dict[str, list[str]] = {
    "conflict": ["杀", "战", "打", "斩", "怒", "恨", "仇", "冤", "罪", "逼", "擒", "敌", "反", "破"],
    "sorrow": ["哭", "泪", "悲", "苦", "惨", "痛", "哀", "伤", "孤", "亡", "死"],
    "decision": ["计", "命", "令", "传", "调", "请", "问", "审", "判", "奏", "报", "探"],
    "movement": ["上", "下", "走", "进", "出", "来", "去", "逃", "追", "赶", "奔"],
}

MARKER_WEIGHTS = {
    "singing": 1.0,
    "spoken": 0.55,
    "recitation": 0.45,
    "stage_action": 0.35,
    "other": 0.25,
    "unknown": 0.1,
}


def read_jsonl(path: Path) -> Iterator[dict]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield json.loads(line)


def write_jsonl(path: Path, rows: Iterable[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            count += 1
    return count


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def count_keywords(text: str, lexicon: dict[str, list[str]]) -> dict[str, dict]:
    counts: dict[str, dict] = {}
    for label, words in lexicon.items():
        evidence = []
        score = 0
        for word in words:
            hit = text.count(word)
            if hit:
                score += hit
                evidence.append({"keyword": word, "count": hit})
        counts[label] = {"score": score, "evidence": evidence[:8]}
    return counts


def normalize_scores(counts: dict[str, dict], text_length: int) -> list[dict]:
    total = sum(item["score"] for item in counts.values())
    rows = []
    for label, item in counts.items():
        raw = item["score"]
        rows.append(
            {
                "theme": label,
                "score": raw,
                "share": round(raw / total, 6) if total else 0.0,
                "density": round(raw / max(text_length, 1) * 1000, 6),
                "evidence": item["evidence"],
            }
        )
    rows.sort(key=lambda item: (-item["score"], item["theme"]))
    return rows


def top_keywords(text: str, limit: int = 30) -> list[dict]:
    tokens = re.findall(r"[\u4e00-\u9fff]{2,4}", text)
    stop = {
        "中国京剧",
        "戏考",
        "什么",
        "不是",
        "如此",
        "今日",
        "这里",
        "那里",
        "丞相",
        "将军",
        "小人",
        "老爷",
    }
    counter = Counter(token for token in tokens if token not in stop)
    return [{"keyword": word, "count": count} for word, count in counter.most_common(limit)]


def scene_text(scene: dict) -> str:
    return "\n".join(speech.get("text", "") for speech in scene.get("speeches", []))


def marker_intensity(marker_counts: dict[str, int]) -> float:
    total = sum(marker_counts.values())
    if not total:
        return 0.0
    weighted = sum(MARKER_WEIGHTS.get(key, 0.2) * value for key, value in marker_counts.items())
    return round(weighted / total, 6)


def rhythm_score(text: str, marker_counts: dict[str, int], unique_speakers: int) -> dict:
    rhythm_counts = count_keywords(text, RHYTHM_LEXICON)
    conflict = rhythm_counts["conflict"]["score"]
    sorrow = rhythm_counts["sorrow"]["score"]
    decision = rhythm_counts["decision"]["score"]
    movement = rhythm_counts["movement"]["score"]
    marker_power = marker_intensity(marker_counts)
    density_base = max(len(text), 1) / 1000
    intensity = (conflict * 1.3 + sorrow * 0.8 + decision * 0.7 + movement * 0.45) / density_base
    intensity += marker_power * 5 + unique_speakers * 0.18
    return {
        "intensity": round(intensity, 6),
        "conflict": conflict,
        "sorrow": sorrow,
        "decision": decision,
        "movement": movement,
        "marker_power": marker_power,
    }


def infer_phase(index: int, total: int, intensity: float, avg_intensity: float) -> str:
    if total <= 1:
        return "single"
    ratio = index / max(total - 1, 1)
    if intensity >= avg_intensity * 1.25:
        return "climax"
    if ratio < 0.25:
        return "setup"
    if ratio > 0.75:
        return "resolution"
    return "development"


def build_play_theme_profile(play: dict) -> dict:
    scenes = play.get("scenes", [])
    all_text = "\n".join(
        [
            play.get("title", ""),
            play.get("synopsis", ""),
            play.get("notes", ""),
            "\n".join(scene_text(scene) for scene in scenes),
        ]
    )
    synopsis_text = "\n".join([play.get("title", ""), play.get("synopsis", "")])
    full_counts = count_keywords(all_text, THEME_LEXICON)
    synopsis_counts = count_keywords(synopsis_text, THEME_LEXICON)

    full_themes = normalize_scores(full_counts, len(all_text))
    synopsis_themes = normalize_scores(synopsis_counts, len(synopsis_text))
    top_theme_names = [item["theme"] for item in full_themes if item["score"] > 0][:5]

    scene_themes = []
    for scene in scenes:
        text = scene_text(scene)
        themes = normalize_scores(count_keywords(text, THEME_LEXICON), len(text))
        scene_themes.append(
            {
                "scene_id": scene["scene_id"],
                "label": scene.get("label"),
                "top_themes": [item for item in themes if item["score"] > 0][:3],
            }
        )

    return {
        "play_id": play["play_id"],
        "title": play["title"],
        "group_id": play.get("group_id"),
        "source_date": play.get("source_date"),
        "theme_vector": {item["theme"]: item["share"] for item in full_themes},
        "theme_scores": full_themes,
        "synopsis_theme_scores": synopsis_themes,
        "theme_combination": top_theme_names[:3],
        "dominant_theme": top_theme_names[0] if top_theme_names else "未识别",
        "keywords": top_keywords(all_text),
        "scene_themes": scene_themes,
    }


def build_narrative_profile(play: dict) -> dict:
    scenes = play.get("scenes", [])
    scene_rows = []

    for idx, scene in enumerate(scenes):
        text = scene_text(scene)
        speakers = scene.get("speakers") or []
        marker_counts = scene.get("marker_category_counts") or {}
        rhythm = rhythm_score(text, marker_counts, len(speakers))
        scene_rows.append(
            {
                "scene_id": scene["scene_id"],
                "label": scene.get("label"),
                "order": idx + 1,
                "speech_count": scene.get("speech_count", 0),
                "speaker_count": len(speakers),
                "text_length": len(text),
                "marker_category_counts": marker_counts,
                "rhythm": rhythm,
            }
        )

    avg_intensity = sum(row["rhythm"]["intensity"] for row in scene_rows) / max(len(scene_rows), 1)
    for idx, row in enumerate(scene_rows):
        row["phase"] = infer_phase(idx, len(scene_rows), row["rhythm"]["intensity"], avg_intensity)

    peak = max(scene_rows, key=lambda row: row["rhythm"]["intensity"], default=None)
    phase_counts = Counter(row["phase"] for row in scene_rows)
    marker_totals = Counter()
    for row in scene_rows:
        marker_totals.update(row["marker_category_counts"])

    return {
        "play_id": play["play_id"],
        "title": play["title"],
        "group_id": play.get("group_id"),
        "scene_count": len(scene_rows),
        "speech_count": play.get("speech_count", 0),
        "avg_scene_speeches": round(play.get("speech_count", 0) / max(len(scene_rows), 1), 6),
        "avg_intensity": round(avg_intensity, 6),
        "peak_scene": peak,
        "phase_counts": dict(phase_counts),
        "marker_category_totals": dict(marker_totals),
        "scene_rhythm": scene_rows,
    }


def load_graph_index(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    return {item["play_id"]: item for item in json.loads(path.read_text(encoding="utf-8"))}


def cosine_similarity(a: dict[str, float], b: dict[str, float]) -> float:
    keys = set(a) | set(b)
    dot = sum(a.get(key, 0.0) * b.get(key, 0.0) for key in keys)
    norm_a = math.sqrt(sum(a.get(key, 0.0) ** 2 for key in keys))
    norm_b = math.sqrt(sum(b.get(key, 0.0) ** 2 for key in keys))
    if not norm_a or not norm_b:
        return 0.0
    return round(dot / (norm_a * norm_b), 6)


def build_theme_pairs(theme_profiles: list[dict], limit_per_play: int = 8) -> list[dict]:
    rows = []
    for i, left in enumerate(theme_profiles):
        candidates = []
        for right in theme_profiles[i + 1 :]:
            sim = cosine_similarity(left["theme_vector"], right["theme_vector"])
            if sim:
                candidates.append(
                    {
                        "source": left["play_id"],
                        "source_title": left["title"],
                        "target": right["play_id"],
                        "target_title": right["title"],
                        "theme_similarity": sim,
                        "shared_themes": [
                            theme
                            for theme in left["theme_combination"]
                            if theme in right["theme_combination"]
                        ],
                    }
                )
        candidates.sort(key=lambda item: -item["theme_similarity"])
        rows.extend(candidates[:limit_per_play])
    rows.sort(key=lambda item: -item["theme_similarity"])
    return rows


def build_integrated_profile(theme: dict, narrative: dict, graph: dict | None) -> dict:
    graph = graph or {}
    top_characters = graph.get("top_characters") or []
    marker_totals = narrative.get("marker_category_totals") or {}
    singing = marker_totals.get("singing", 0)
    spoken = marker_totals.get("spoken", 0)
    performance_balance = round(singing / max(singing + spoken, 1), 6)

    return {
        "play_id": theme["play_id"],
        "title": theme["title"],
        "group_id": theme.get("group_id"),
        "dominant_theme": theme["dominant_theme"],
        "theme_combination": theme["theme_combination"],
        "network": {
            "node_count": graph.get("node_count", 0),
            "edge_count": graph.get("edge_count", 0),
            "density": graph.get("density", 0),
            "avg_degree": graph.get("avg_degree", 0),
            "top_characters": top_characters[:5],
        },
        "narrative": {
            "scene_count": narrative["scene_count"],
            "avg_intensity": narrative["avg_intensity"],
            "peak_scene_id": (narrative.get("peak_scene") or {}).get("scene_id"),
            "peak_phase": (narrative.get("peak_scene") or {}).get("phase"),
            "phase_counts": narrative["phase_counts"],
            "performance_balance": performance_balance,
        },
        "linkage_hypotheses": infer_linkage_hypotheses(theme, narrative, graph),
    }


def infer_linkage_hypotheses(theme: dict, narrative: dict, graph: dict) -> list[str]:
    hypotheses = []
    dominant = theme["dominant_theme"]
    density = graph.get("density", 0) if graph else 0
    avg_intensity = narrative.get("avg_intensity", 0)
    scene_count = narrative.get("scene_count", 0)
    phase_counts = narrative.get("phase_counts") or {}

    if dominant in {"权谋战争", "公案审判", "复仇雪恨", "忠奸冲突"} and avg_intensity > 18:
        hypotheses.append("高冲突主题与较强叙事强度同步")
    if dominant in {"家庭伦理", "婚恋离合"} and density > 0.5:
        hypotheses.append("伦理/婚恋主题依赖较密集的人物关系呈现")
    if scene_count == 1 and density >= 0.8:
        hypotheses.append("单场折子戏呈现集中式关系网络")
    if phase_counts.get("climax", 0) >= 2:
        hypotheses.append("剧情存在多峰值推进")
    if dominant == "神怪仙佛":
        hypotheses.append("神怪主题可与舞台行动和情节转折联动分析")
    return hypotheses


def analyze(args: argparse.Namespace) -> dict:
    input_dir = Path(args.input)
    analysis_dir = Path(args.analysis)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    graph_index = load_graph_index(analysis_dir / "graph_index.json")

    theme_profiles = []
    narrative_profiles = []
    integrated_profiles = []

    for idx, play in enumerate(read_jsonl(input_dir / "plays.jsonl"), start=1):
        theme = build_play_theme_profile(play)
        narrative = build_narrative_profile(play)
        integrated = build_integrated_profile(theme, narrative, graph_index.get(play["play_id"]))
        theme_profiles.append(theme)
        narrative_profiles.append(narrative)
        integrated_profiles.append(integrated)

        if args.verbose or idx % args.progress_every == 0:
            print(
                f"[{idx}] {play['play_id']} {play['title']} "
                f"theme={theme['dominant_theme']} intensity={narrative['avg_intensity']}",
                flush=True,
            )

    theme_pairs = build_theme_pairs(theme_profiles, args.similar_per_play)

    write_jsonl(output_dir / "play_theme_profiles.jsonl", theme_profiles)
    write_jsonl(output_dir / "narrative_profiles.jsonl", narrative_profiles)
    write_jsonl(output_dir / "integrated_profiles.jsonl", integrated_profiles)
    write_jsonl(output_dir / "theme_similarity_edges.jsonl", theme_pairs)

    theme_summary = Counter(profile["dominant_theme"] for profile in theme_profiles)
    combination_summary = Counter(" + ".join(profile["theme_combination"]) for profile in theme_profiles)
    csv_rows = [
        {
            "play_id": profile["play_id"],
            "title": profile["title"],
            "group_id": profile.get("group_id"),
            "dominant_theme": profile["dominant_theme"],
            "theme_combination": " + ".join(profile["theme_combination"]),
            "avg_intensity": narrative_profiles[idx]["avg_intensity"],
            "peak_scene_id": (narrative_profiles[idx].get("peak_scene") or {}).get("scene_id"),
            "scene_count": narrative_profiles[idx]["scene_count"],
            "speech_count": narrative_profiles[idx]["speech_count"],
            "node_count": integrated_profiles[idx]["network"]["node_count"],
            "edge_count": integrated_profiles[idx]["network"]["edge_count"],
            "density": integrated_profiles[idx]["network"]["density"],
            "linkage_hypotheses": ";".join(integrated_profiles[idx]["linkage_hypotheses"]),
        }
        for idx, profile in enumerate(theme_profiles)
    ]
    write_csv(output_dir / "play_semantic_metrics.csv", csv_rows)

    report = {
        "input": str(input_dir),
        "analysis": str(analysis_dir),
        "output": str(output_dir),
        "play_count": len(theme_profiles),
        "theme_distribution": dict(theme_summary.most_common()),
        "theme_combination_top20": dict(combination_summary.most_common(20)),
        "theme_similarity_edges": len(theme_pairs),
        "files": [
            "play_theme_profiles.jsonl",
            "narrative_profiles.jsonl",
            "integrated_profiles.jsonl",
            "theme_similarity_edges.jsonl",
            "play_semantic_metrics.csv",
        ],
    }
    write_json(output_dir / "semantic_summary.json", report)
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="outputs/opera_json", help="Directory containing plays.jsonl.")
    parser.add_argument("--analysis", default="outputs/opera_analysis", help="Directory containing graph_index.json.")
    parser.add_argument("--output", default="outputs/opera_semantics", help="Output directory.")
    parser.add_argument("--similar-per-play", type=int, default=8, help="Top similar theme edges kept per play.")
    parser.add_argument("--progress-every", type=int, default=200)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def main() -> int:
    report = analyze(parse_args())
    print(
        "Done: "
        f'{report["play_count"]} plays, '
        f'{len(report["theme_distribution"])} theme labels, '
        f'{report["theme_similarity_edges"]} similarity edges.'
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
