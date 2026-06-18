from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

from pypdf import PdfReader


WORKSPACE = Path(__file__).resolve().parents[1]
PLAY_ID = "01001001"
OUTPUT = WORKSPACE / "processed_01001001_空城计.json"


def clean_line(line: str) -> str:
    return line.strip("\ufeff\r\n")


def classify_mode(mode_label: str) -> str:
    if "白" in mode_label:
        return "spoken"
    if "念" in mode_label or "叫头" in mode_label:
        return "recitation"
    if "笑" in mode_label:
        return "expression"
    if any(k in mode_label for k in ["西皮", "二黄", "板", "导板"]):
        return "aria"
    return "other_vocal"


def normalize_speakers(name: str) -> list[str]:
    name = name.strip(" 、")
    if not name:
        return []
    return [part for part in name.split("、") if part]


def event_text_length(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def parse_pdf() -> dict:
    matches = [p for p in WORKSPACE.rglob("*.pdf") if p.name.startswith(f"{PLAY_ID}_")]
    if not matches:
        raise FileNotFoundError(f"Cannot find {PLAY_ID}_*.pdf under {WORKSPACE}")
    pdf_path = matches[0]
    reader = PdfReader(str(pdf_path))

    pages: list[dict] = []
    all_items: list[dict] = []
    source_url = None
    source_date = None

    for page_no, page in enumerate(reader.pages, 1):
        raw_lines = [clean_line(line) for line in (page.extract_text() or "").splitlines()]
        body_lines = []
        for line in raw_lines:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("中国京剧戏考"):
                continue
            if stripped.startswith("Powered by TCPDF"):
                continue
            if stripped.startswith("http://scripts.xikao.com/play/"):
                parts = stripped.split()
                source_url = parts[0]
                if len(parts) > 1:
                    source_date = parts[1]
                continue
            body_lines.append(line)
            all_items.append({"page_no": page_no, "line": line})
        pages.append({"page_no": page_no, "raw_line_count": len(raw_lines), "body_lines": body_lines})

    title_line = all_items[0]["line"].strip()
    title_match = re.search(r"《([^》]+)》", title_line)
    title = title_match.group(1) if title_match else "空城计"
    aliases = re.findall(r"一名：?《([^》]+)》", title_line)

    first_scene_idx = next(i for i, item in enumerate(all_items) if re.match(r"【第.+场】", item["line"].strip()))
    front = [item["line"].strip() for item in all_items[:first_scene_idx]]

    roles = []
    plot_lines = []
    note_lines = []
    section = None
    for line in front[1:]:
        if line == "主要角色":
            section = "roles"
            continue
        if line == "情节":
            section = "plot"
            continue
        if line == "注释":
            section = "notes"
            continue
        if section == "roles" and "：" in line:
            name, role_type = line.split("：", 1)
            roles.append(
                {
                    "role_id": f"role_{len(roles) + 1:02d}",
                    "name": name.strip(),
                    "category": role_type.strip(),
                    "is_main_role": True,
                }
            )
        elif section == "plot":
            plot_lines.append(line)
        elif section == "notes":
            note_lines.append(line)

    role_by_name = {role["name"]: role for role in roles}

    scenes = []
    events = []
    current_scene = None
    current_speakers: list[str] = []
    pending_speaker_prefix = ""
    seq_global = 0

    speaker_re = re.compile(r"^(?P<speaker>[\u4e00-\u9fff、]+?)\u3000+（(?P<mode>[^）]+)）\u3000*(?P<text>.*)$")
    mode_only_re = re.compile(r"^\u3000+（(?P<mode>[^）]+)）\u3000*(?P<text>.*)$")

    def ensure_scene(scene_no: int, title_text: str, page_no: int) -> dict:
        scene = {
            "scene_id": f"{PLAY_ID}_s{scene_no:02d}",
            "scene_no": scene_no,
            "title": title_text,
            "page_start": page_no,
            "page_end": page_no,
            "characters": [],
            "event_ids": [],
            "summary": "",
        }
        scenes.append(scene)
        return scene

    def add_event(page_no: int, line_type: str, text: str, speakers=None, mode_label=None) -> None:
        nonlocal seq_global
        if current_scene is None:
            return
        seq_global += 1
        scene_seq = len(current_scene["event_ids"]) + 1
        speakers = speakers or []
        event = {
            "event_id": f"{PLAY_ID}_e{seq_global:04d}",
            "play_id": PLAY_ID,
            "scene_id": current_scene["scene_id"],
            "scene_no": current_scene["scene_no"],
            "seq_global": seq_global,
            "seq_in_scene": scene_seq,
            "page_no": page_no,
            "type": line_type,
            "mode_label": mode_label,
            "speakers": speakers,
            "text": re.sub(r"\s+", "", text),
        }
        event["text_length"] = event_text_length(event["text"])
        events.append(event)
        current_scene["event_ids"].append(event["event_id"])
        current_scene["page_end"] = page_no
        for speaker in speakers:
            if speaker not in current_scene["characters"]:
                current_scene["characters"].append(speaker)
            if speaker not in role_by_name:
                role_by_name[speaker] = {
                    "role_id": f"role_{len(role_by_name) + 1:02d}",
                    "name": speaker,
                    "category": "未知/群体角色",
                    "is_main_role": False,
                }

    for item in all_items[first_scene_idx:]:
        page_no = item["page_no"]
        line = item["line"]
        stripped = line.strip()

        scene_match = re.match(r"【第(.+?)场】", stripped)
        if scene_match:
            scene_no = len(scenes) + 1
            current_scene = ensure_scene(scene_no, stripped.strip("【】"), page_no)
            current_speakers = []
            pending_speaker_prefix = ""
            continue

        if stripped in {"（完）"}:
            continue

        if re.match(r"^[\u4e00-\u9fff]+、$", stripped):
            pending_speaker_prefix += stripped
            continue

        if stripped.startswith("（") and stripped.endswith("）"):
            add_event(page_no, "stage_direction", stripped.strip("（）"), [], "stage_direction")
            continue

        speaker_match = speaker_re.match(line)
        if speaker_match:
            speaker_name = pending_speaker_prefix + speaker_match.group("speaker")
            pending_speaker_prefix = ""
            current_speakers = normalize_speakers(speaker_name)
            mode = speaker_match.group("mode").strip()
            add_event(page_no, classify_mode(mode), speaker_match.group("text"), current_speakers, mode)
            continue

        mode_match = mode_only_re.match(line)
        if mode_match and current_speakers:
            mode = mode_match.group("mode").strip()
            add_event(page_no, classify_mode(mode), mode_match.group("text"), current_speakers, mode)
            continue

        if events:
            events[-1]["text"] += re.sub(r"\s+", "", stripped)
            events[-1]["text_length"] = event_text_length(events[-1]["text"])

    for scene in scenes:
        scene_events = [e for e in events if e["scene_id"] == scene["scene_id"]]
        scene["metrics"] = {
            "event_count": len(scene_events),
            "spoken_count": sum(e["type"] == "spoken" for e in scene_events),
            "aria_count": sum(e["type"] == "aria" for e in scene_events),
            "stage_direction_count": sum(e["type"] == "stage_direction" for e in scene_events),
            "text_length": sum(e["text_length"] for e in scene_events),
        }

    type_counter = Counter(e["type"] for e in events)
    role_metric = defaultdict(lambda: {"line_count": 0, "text_length": 0, "scene_ids": set(), "type_counts": Counter()})
    for event in events:
        for speaker in event["speakers"]:
            metric = role_metric[speaker]
            metric["line_count"] += 1
            metric["text_length"] += event["text_length"]
            metric["scene_ids"].add(event["scene_id"])
            metric["type_counts"][event["type"]] += 1

    role_metrics = []
    for name, metric in sorted(role_metric.items(), key=lambda item: (-item[1]["line_count"], item[0])):
        role = role_by_name[name]
        role_metrics.append(
            {
                "role_id": role["role_id"],
                "name": name,
                "category": role["category"],
                "line_count": metric["line_count"],
                "text_length": metric["text_length"],
                "scene_count": len(metric["scene_ids"]),
                "spoken_count": metric["type_counts"]["spoken"],
                "aria_count": metric["type_counts"]["aria"],
                "recitation_count": metric["type_counts"]["recitation"],
                "first_scene": min((int(s.rsplit("s", 1)[1]) for s in metric["scene_ids"]), default=None),
                "last_scene": max((int(s.rsplit("s", 1)[1]) for s in metric["scene_ids"]), default=None),
            }
        )

    same_scene_edges = Counter()
    for scene in scenes:
        for a, b in combinations(sorted(scene["characters"]), 2):
            same_scene_edges[(a, b)] += 1

    dialogue_edges = Counter()
    last_event = None
    for event in events:
        if event["type"] == "stage_direction" or not event["speakers"]:
            continue
        if last_event and last_event["scene_id"] == event["scene_id"]:
            for a in last_event["speakers"]:
                for b in event["speakers"]:
                    if a != b:
                        dialogue_edges[tuple(sorted((a, b)))] += 1
        last_event = event

    edges = []
    edge_id = 0
    for (source, target), weight in same_scene_edges.items():
        edge_id += 1
        edges.append({"edge_id": f"edge_{edge_id:03d}", "source": source, "target": target, "type": "same_scene", "weight": weight})
    for (source, target), weight in dialogue_edges.items():
        edge_id += 1
        edges.append({"edge_id": f"edge_{edge_id:03d}", "source": source, "target": target, "type": "dialogue_turn", "weight": weight})

    corpus = "".join(plot_lines) + "".join(e["text"] for e in events)
    keyword_candidates = [
        "空城",
        "西城",
        "街亭",
        "司马懿",
        "司马",
        "诸葛亮",
        "孔明",
        "赵云",
        "马谡",
        "丞相",
        "先帝",
        "汉中",
        "埋伏",
        "神兵",
        "扶琴",
        "收兵",
        "四十余里",
        "城门大开",
    ]
    keywords = [
        {"word": word, "count": corpus.count(word), "weight": corpus.count(word)}
        for word in keyword_candidates
        if corpus.count(word) > 0
    ]
    keywords.sort(key=lambda item: (-item["count"], item["word"]))

    processed = {
        "schema_version": "1.0.0",
        "play": {
            "play_id": PLAY_ID,
            "title": title,
            "aliases": aliases,
            "collection_id": "01000000",
            "collection_name": "《戏考》",
            "pdf_path": str(pdf_path.relative_to(WORKSPACE)).replace("\\", "/"),
            "source_url": source_url,
            "source_date": source_date,
            "page_count": len(reader.pages),
            "file_size_bytes": pdf_path.stat().st_size,
        },
        "metadata": {
            "main_roles": list(role_by_name.values()),
            "plot_summary": "".join(plot_lines),
            "notes": note_lines,
        },
        "pages": pages,
        "scenes": scenes,
        "events": events,
        "metrics": {
            "scene_count": len(scenes),
            "event_count": len(events),
            "type_counts": dict(type_counter),
            "text_length": sum(e["text_length"] for e in events),
            "role_count": len(role_by_name),
            "role_metrics": role_metrics,
            "keywords": keywords,
        },
        "relationships": {
            "nodes": list(role_by_name.values()),
            "edges": edges,
        },
        "analysis_ready_views": {
            "timeline_view": [
                {
                    "scene_no": e["scene_no"],
                    "seq_global": e["seq_global"],
                    "type": e["type"],
                    "mode_label": e["mode_label"],
                    "speakers": e["speakers"],
                    "text_length": e["text_length"],
                    "page_no": e["page_no"],
                }
                for e in events
            ],
            "role_scene_matrix": [
                {
                    "role": role,
                    "scene_no": scene["scene_no"],
                    "line_count": sum(
                        role in e["speakers"] and e["scene_id"] == scene["scene_id"]
                        for e in events
                    ),
                }
                for role in sorted(role_by_name)
                for scene in scenes
            ],
        },
        "question_mapping": [
            {
                "question": "剧情如何推进，各场的唱白科介分布如何？",
                "json_fields": ["scenes", "events", "analysis_ready_views.timeline_view"],
                "visualization": ["剧情时间轴", "事件类型堆叠条", "场次热力图"],
            },
            {
                "question": "谁是核心角色，角色出场和台词量如何？",
                "json_fields": ["metrics.role_metrics", "analysis_ready_views.role_scene_matrix"],
                "visualization": ["角色排名条形图", "角色-场次矩阵"],
            },
            {
                "question": "人物之间的共现与对话关系如何？",
                "json_fields": ["relationships.nodes", "relationships.edges"],
                "visualization": ["力导向图", "邻接矩阵", "弦图"],
            },
            {
                "question": "该剧有哪些主题关键词？",
                "json_fields": ["metrics.keywords", "metadata.plot_summary", "events.text"],
                "visualization": ["词云", "关键词柱状图", "关键词-场次热力图"],
            },
            {
                "question": "剧本来源、版本与原始页码如何追溯？",
                "json_fields": ["play", "pages", "events.page_no"],
                "visualization": ["来源信息卡", "页码定位列表"],
            },
        ],
    }
    return processed


def main() -> None:
    processed = parse_pdf()
    OUTPUT.write_text(json.dumps(processed, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(
        {
            "output": str(OUTPUT),
            "scene_count": processed["metrics"]["scene_count"],
            "event_count": processed["metrics"]["event_count"],
            "role_count": processed["metrics"]["role_count"],
            "type_counts": processed["metrics"]["type_counts"],
        },
        ensure_ascii=False,
        indent=2,
    ))


if __name__ == "__main__":
    main()
