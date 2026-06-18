from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from pypdf import PdfReader


WORKSPACE = Path(__file__).resolve().parents[2]
DATASET_DIR = WORKSPACE / "1-I_opera_dataset" / "extracted"
PROCESSED_DIR = WORKSPACE / "data" / "processed"
INTERMEDIATE_TEXT_DIR = WORKSPACE / "data" / "intermediate" / "text"
PLAYS_DIR = PROCESSED_DIR / "plays"
REPORTS_DIR = PROCESSED_DIR / "reports"

GENRE_RULES = [
    ("公案戏", ["审", "铡", "案", "冤", "府", "堂", "知府", "包公", "县", "鸣冤", "问斩", "判"]),
    ("家庭戏", ["母", "父", "子", "女", "妻", "夫", "嫂", "婆", "姑", "教子", "认母", "别窑", "团圆"]),
    ("历史戏", ["三国", "汉", "唐", "宋", "明", "清", "秦", "楚", "魏", "蜀", "吴", "将军", "丞相", "皇帝", "先帝", "兵", "城"]),
    ("爱情婚姻戏", ["姻", "媒", "婚", "嫁", "情", "小姐", "书生", "相会", "私订", "花田", "西厢"]),
    ("征战武戏", ["战", "关", "阵", "兵", "将", "枪", "刀", "马", "擒", "杀", "征", "挂帅"]),
    ("神怪戏", ["仙", "妖", "鬼", "神", "天宫", "龙", "狐", "观音", "钟馗"]),
]

STORY_PERIOD_RULES = [
    ("三国", ["三国", "蜀", "魏", "吴", "诸葛", "司马懿", "刘备", "曹操", "关羽", "张飞", "赵云"]),
    ("秦汉", ["秦", "楚汉", "汉高祖", "刘邦", "项羽", "韩信", "萧何", "未央宫"]),
    ("隋唐", ["隋", "唐", "李世民", "薛", "罗成", "秦琼", "尉迟", "瓦岗"]),
    ("宋元", ["宋", "杨家", "岳飞", "包公", "梁山", "水浒", "辽", "金兵"]),
    ("明清", ["明代", "明朝", "明", "清", "崇祯", "康熙", "乾隆", "洪承畴", "明末"]),
    ("神话传说", ["天宫", "观音", "钟馗", "白蛇", "嫦娥", "仙", "妖", "神"]),
]

THEME_RULES = [
    ("智谋对抗", ["计", "谋", "埋伏", "探", "疑", "骗", "退兵", "空城", "用兵", "军令"]),
    ("忠义报国", ["忠", "义", "报国", "汉室", "先帝", "保", "社稷", "国家", "节", "殉"]),
    ("家庭伦理", ["母", "父", "子", "女", "夫", "妻", "孝", "教子", "认亲", "团圆", "别离"]),
    ("公案正义", ["审", "案", "冤", "铡", "堂", "府", "状", "判", "官", "问斩", "伸冤"]),
    ("爱情婚姻", ["情", "婚", "嫁", "媒", "相会", "小姐", "书生", "姻缘", "私订", "花烛"]),
    ("征战武勇", ["战", "兵", "将", "刀", "枪", "阵", "马", "杀", "擒", "挂帅", "破城"]),
    ("女性抗争", ["女", "小姐", "夫人", "公主", "花木兰", "穆桂英", "闺", "贞", "烈"]),
    ("神怪奇幻", ["仙", "妖", "鬼", "神", "天宫", "龙", "狐", "观音", "钟馗"]),
]

IDENTITY_RULES = {
    "帝王/皇族": ["皇帝", "帝王", "太子", "公主", "王爷", "娘娘", "皇后"],
    "官员/谋臣": ["丞相", "军师", "相", "知府", "县令", "大人", "尚书", "太守", "御史"],
    "武将/士兵": ["元帅", "将军", "先锋", "上手", "龙套", "挂帅", "带兵"],
    "女性家眷": ["夫人", "小姐", "娘娘", "太君", "嫂嫂", "丫鬟", "宫女"],
    "仆从/差役": ["旗牌", "报子", "衙役", "家院", "院子", "老军", "人心", "四九", "丫鬟"],
    "文人/书生": ["生员", "书生", "秀才", "进士", "先生", "老师"],
    "神怪/宗教": ["神仙", "妖怪", "妖精", "僧人", "和尚", "道士", "观音", "菩萨"],
}

NAME_IDENTITY_OVERRIDES = {
    "诸葛亮": ["官员/谋臣", "统帅/军政核心"],
    "司马懿": ["官员/谋臣", "统帅/军政核心"],
    "司马师": ["统帅/军政核心"],
    "司马昭": ["统帅/军政核心"],
    "赵云": ["武将/士兵"],
    "王春娥": ["女性家眷"],
    "薛保": ["仆从/差役"],
    "薛倚哥": ["文人/书生", "家庭子辈"],
}

TRAIT_RULES = {
    "忠义": ["忠", "义", "报国", "保", "扶", "节"],
    "智谋": ["计", "谋", "用兵", "疑", "探", "埋伏", "聪明"],
    "刚烈": ["怒", "斩", "杀", "烈", "不屈", "骂"],
    "谨慎": ["谨慎", "小心", "不敢", "细听", "不可轻敌"],
    "滑稽": ["丑", "糊涂", "哈哈", "笑", "伙计"],
    "孝亲": ["孝", "母", "父", "养", "教子"],
    "勇武": ["战", "杀", "打", "枪", "刀", "马", "上阵"],
    "柔情": ["情", "泪", "思", "哭", "相思", "小姐"],
}

FEMALE_HINTS = ["旦", "夫人", "小姐", "公主", "娘", "母", "妻", "嫂", "姐", "妹", "丫鬟", "宫女", "花旦", "青衣", "老旦", "王春娥", "春草"]
MALE_HINTS = ["生", "净", "丑", "王", "公", "帝", "将", "丞相", "老军", "童", "旗牌", "报子", "小生", "老生", "武生"]
OLD_HINTS = ["老生", "老旦", "太君", "老军", "老夫", "母", "父", "翁", "婆"]
YOUNG_HINTS = ["小生", "娃", "童", "小姐", "丫鬟", "公子", "书生", "花旦"]


def ensure_dirs() -> None:
    for path in [PROCESSED_DIR, INTERMEDIATE_TEXT_DIR, PLAYS_DIR, REPORTS_DIR]:
        path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def rel_path(path: Path) -> str:
    return str(path.relative_to(WORKSPACE)).replace("\\", "/")


def parse_limit(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N plays.")
    parser.add_argument("--play-id", action="append", default=None, help="Process one play_id; can be repeated.")
    parser.add_argument("--collection-id", action="append", default=None, help="Process one collection id; can be repeated.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing stage outputs.")
    return parser.parse_args(argv)


def filter_manifest(manifest: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    rows = manifest
    if args.play_id:
        wanted = set(args.play_id)
        rows = [row for row in rows if row["play_id"] in wanted]
    if args.collection_id:
        wanted = {cid.zfill(8) for cid in args.collection_id}
        rows = [row for row in rows if row["collection_id"] in wanted]
    if args.limit is not None:
        rows = rows[: args.limit]
    return rows


def load_collection_map() -> dict[str, dict[str, str]]:
    # Build from existing corpus manifest if available, otherwise from directory names
    manifest_path = PROCESSED_DIR / "corpus_manifest.json"
    if manifest_path.exists():
        manifest = read_json(manifest_path, [])
        mapping: dict[str, dict[str, str]] = {}
        for row in manifest:
            cid = row.get("collection_id", "")
            if cid and cid not in mapping:
                mapping[cid] = {
                    "collection_id": cid,
                    "collection_name": row.get("collection_name") or cid,
                    "size_text": "",
                    "remark": "",
                }
        if mapping:
            return mapping
    # Fallback: build from directory names
    mapping: dict[str, dict[str, str]] = {}
    for d in sorted(DATASET_DIR.iterdir()):
        if d.is_dir():
            cid = d.name
            mapping[cid] = {
                "collection_id": cid,
                "collection_name": cid,
                "size_text": "",
                "remark": "",
            }
    return mapping


def extract_source_from_lines(lines: list[str]) -> tuple[str | None, str | None]:
    for line in reversed(lines):
        stripped = line.strip()
        if stripped.startswith("http://scripts.xikao.com/play/"):
            parts = stripped.split()
            return parts[0], parts[1] if len(parts) > 1 else None
    return None, None


def clean_pdf_lines(raw_lines: list[str]) -> tuple[list[str], str | None, str | None]:
    body = []
    source_url = None
    source_date = None
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
            source_date = parts[1] if len(parts) > 1 else None
            continue
        body.append(line.strip("\r\n"))
    return body, source_url, source_date


def build_manifest() -> list[dict[str, Any]]:
    ensure_dirs()
    collection_map = load_collection_map()
    manifest = []
    for pdf_path in sorted(DATASET_DIR.rglob("*.pdf")):
        stem = pdf_path.stem
        if "_" in stem:
            play_id, title = stem.split("_", 1)
        else:
            play_id, title = stem[:8], stem[8:]
        collection_id = pdf_path.parent.name
        collection = collection_map.get(collection_id, {})
        manifest.append(
            {
                "play_id": play_id,
                "title": title,
                "aliases": [],
                "collection_id": collection_id,
                "collection_name": collection.get("collection_name", collection_id),
                "collection_remark": collection.get("remark", ""),
                "pdf_path": rel_path(pdf_path),
                "source_url": None,
                "source_date": None,
                "page_count": None,
                "file_size_bytes": pdf_path.stat().st_size,
                "parse_error": None,
            }
        )
    write_json(PROCESSED_DIR / "corpus_manifest.json", manifest)
    write_json(PROCESSED_DIR / "collections.json", sorted(collection_map.values(), key=lambda x: x["collection_id"]))
    return manifest


def extract_pdf_text(manifest_rows: list[dict[str, Any]], force: bool = False) -> dict[str, Any]:
    ensure_dirs()
    report = {"processed": 0, "skipped": 0, "failed": []}
    for row in manifest_rows:
        out_path = INTERMEDIATE_TEXT_DIR / f"{row['play_id']}.json"
        if out_path.exists() and not force:
            report["skipped"] += 1
            continue
        pdf_path = WORKSPACE / row["pdf_path"]
        try:
            reader = PdfReader(str(pdf_path))
            pages = []
            source_url = row.get("source_url")
            source_date = row.get("source_date")
            for page_no, page in enumerate(reader.pages, 1):
                raw_lines = (page.extract_text() or "").splitlines()
                body_lines, page_source_url, page_source_date = clean_pdf_lines(raw_lines)
                source_url = page_source_url or source_url
                source_date = page_source_date or source_date
                pages.append({"page_no": page_no, "raw_line_count": len(raw_lines), "body_lines": body_lines})
            write_json(
                out_path,
                {
                    "play": {**row, "source_url": source_url, "source_date": source_date, "page_count": len(pages)},
                    "pages": pages,
                },
            )
            report["processed"] += 1
        except Exception as exc:  # noqa: BLE001
            report["failed"].append({"play_id": row["play_id"], "pdf_path": row["pdf_path"], "error": f"{type(exc).__name__}: {exc}"})
    write_json(REPORTS_DIR / "02_extract_pdf_text_report.json", report)
    return report


def refresh_manifest_from_text() -> list[dict[str, Any]]:
    manifest = read_json(PROCESSED_DIR / "corpus_manifest.json", [])
    refreshed = []
    for row in manifest:
        text_path = INTERMEDIATE_TEXT_DIR / f"{row['play_id']}.json"
        if text_path.exists():
            text_data = read_json(text_path)
            play = text_data.get("play", {})
            row = {
                **row,
                "source_url": play.get("source_url") or row.get("source_url"),
                "source_date": play.get("source_date") or row.get("source_date"),
                "page_count": play.get("page_count") or row.get("page_count"),
                "parse_error": None,
            }
        refreshed.append(row)
    write_json(PROCESSED_DIR / "corpus_manifest.json", refreshed)
    return refreshed


def classify_mode(mode_label: str) -> str:
    if "同白" in mode_label or mode_label == "白" or mode_label.endswith("白"):
        return "spoken"
    if "念" in mode_label or "叫头" in mode_label:
        return "recitation"
    if "笑" in mode_label or "哭" in mode_label:
        return "expression"
    if any(key in mode_label for key in ["西皮", "二黄", "南梆子", "反", "板", "导板", "快板", "摇板", "慢板", "流水"]):
        return "aria"
    return "other_vocal"


def normalize_speakers(name: str) -> list[str]:
    return [part.strip() for part in name.strip(" 、").split("、") if part.strip()]


def clean_event_text(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def text_len(text: str) -> int:
    return len(clean_event_text(text))


def role_id(name: str) -> str:
    safe = re.sub(r"[^\w\u4e00-\u9fff]+", "_", name)
    return f"r_{safe}"


def infer_story_period(text: str, title: str = "", plot: str = "") -> dict[str, Any]:
    best = ("未知", 0, "")
    for label, words in STORY_PERIOD_RULES:
        hits = []
        score = 0
        for word in words:
            if word in title:
                hits.append(word)
                score += 3
            if word in plot:
                hits.append(word)
                score += 3
            remaining = max(0, text.count(word) - title.count(word) - plot.count(word))
            if remaining:
                hits.append(word)
                score += min(2, remaining)
        if score > best[1]:
            best = (label, score, "、".join(list(dict.fromkeys(hits))[:6]))
    confidence = min(0.95, 0.35 + best[1] * 0.08) if best[1] else 0.2
    return {"label": best[0], "evidence": best[2], "confidence": round(confidence, 2)}


def infer_genre(title: str, plot: str) -> dict[str, Any]:
    text = title + plot
    scores = []
    for label, words in GENRE_RULES:
        hits = [word for word in words if word in text]
        if hits:
            scores.append((label, len(hits), hits[:6]))
    if not scores:
        return {"label": "未分类", "confidence": 0.2, "evidence": []}
    label, score, hits = max(scores, key=lambda x: x[1])
    return {"label": label, "confidence": round(min(0.92, 0.38 + score * 0.1), 2), "evidence": hits}


def parse_structure(text_files: list[Path], force: bool = False) -> dict[str, Any]:
    ensure_dirs()
    report = {"processed": 0, "skipped": 0, "failed": [], "no_roles": [], "no_scenes": []}
    for text_path in text_files:
        play_id_value = text_path.stem
        out_path = PLAYS_DIR / f"{play_id_value}.json"
        if out_path.exists() and not force:
            report["skipped"] += 1
            continue
        try:
            data = read_json(text_path)
            parsed = parse_one_text(data)
            write_json(out_path, parsed)
            report["processed"] += 1
            if not parsed["roles"]:
                report["no_roles"].append(play_id_value)
            if not parsed["scenes"]:
                report["no_scenes"].append(play_id_value)
        except Exception as exc:  # noqa: BLE001
            report["failed"].append({"play_id": play_id_value, "error": f"{type(exc).__name__}: {exc}"})
    write_json(REPORTS_DIR / "03_parse_script_structure_report.json", report)
    return report


def parse_one_text(data: dict[str, Any]) -> dict[str, Any]:
    play = data["play"]
    all_items = []
    for page in data["pages"]:
        for line in page["body_lines"]:
            all_items.append({"page_no": page["page_no"], "line": line})
    if not all_items:
        raise ValueError("empty extracted text")

    title_line = all_items[0]["line"].strip()
    title_match = re.search(r"《([^》]+)》", title_line)
    if title_match:
        play["title"] = title_match.group(1)
    aliases = re.findall(r"(?:一名：?|《[^》]+》【[^】]+】|又名：?)《([^》]+)》", title_line)
    play["aliases"] = [alias for alias in aliases if alias != play.get("title")]

    explicit_scene_idx = next((i for i, item in enumerate(all_items) if re.match(r"【第.+?场】", item["line"].strip())), None)
    performance_re = re.compile(r"^(（.+?）|[\u4e00-\u9fff、A-Za-z0-9]+?\u3000+（[^）]+）)")
    first_performance_idx = next((i for i, item in enumerate(all_items[1:], 1) if performance_re.match(item["line"].strip())), len(all_items))
    first_scene_idx = explicit_scene_idx if explicit_scene_idx is not None else first_performance_idx
    front = [item["line"].strip() for item in all_items[:first_scene_idx]]
    roles, plot_lines, note_lines = parse_front_matter(front)
    role_map = {role["name"]: role for role in roles}

    scenes: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    current_scene = None
    current_speakers: list[str] = []
    pending_speaker_prefix = ""
    seq_global = 0

    speaker_re = re.compile(r"^(?P<speaker>[\u4e00-\u9fff、A-Za-z0-9]+?)\u3000+（(?P<mode>[^）]+)）\u3000*(?P<text>.*)$")
    mode_only_re = re.compile(r"^\u3000+（(?P<mode>[^）]+)）\u3000*(?P<text>.*)$")

    def add_scene(title_text: str, page_no: int) -> dict[str, Any]:
        scene_no = len(scenes) + 1
        scene = {
            "scene_id": f"{play['play_id']}_s{scene_no:02d}",
            "scene_no": scene_no,
            "title": title_text.strip("【】"),
            "page_start": page_no,
            "page_end": page_no,
            "characters": [],
            "event_ids": [],
            "summary": "",
        }
        scenes.append(scene)
        return scene

    def add_event(page_no: int, event_type: str, event_text: str, speakers: list[str] | None, mode_label: str | None) -> None:
        nonlocal seq_global
        if current_scene is None:
            return
        seq_global += 1
        speakers = speakers or []
        event = {
            "event_id": f"{play['play_id']}_e{seq_global:05d}",
            "play_id": play["play_id"],
            "scene_id": current_scene["scene_id"],
            "scene_no": current_scene["scene_no"],
            "seq_global": seq_global,
            "seq_in_scene": len(current_scene["event_ids"]) + 1,
            "page_no": page_no,
            "type": event_type,
            "mode_label": mode_label,
            "speakers": speakers,
            "text": clean_event_text(event_text),
        }
        event["text_length"] = text_len(event["text"])
        events.append(event)
        current_scene["event_ids"].append(event["event_id"])
        current_scene["page_end"] = page_no
        for speaker in speakers:
            if speaker not in current_scene["characters"]:
                current_scene["characters"].append(speaker)
            if speaker not in role_map:
                role_map[speaker] = {
                    "role_id": role_id(speaker),
                    "name": speaker,
                    "original_category": None,
                    "is_main_role": False,
                }

    if explicit_scene_idx is None and first_scene_idx < len(all_items):
        current_scene = add_scene("全剧", all_items[first_scene_idx]["page_no"])

    for item in all_items[first_scene_idx:]:
        page_no = item["page_no"]
        line = item["line"]
        stripped = line.strip()
        if not stripped or stripped in {"（完）"}:
            continue
        scene_match = re.match(r"【第.+?场】", stripped)
        if scene_match:
            current_scene = add_scene(stripped, page_no)
            current_speakers = []
            pending_speaker_prefix = ""
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
            events[-1]["text"] += clean_event_text(stripped)
            events[-1]["text_length"] = text_len(events[-1]["text"])

    plot_summary = "".join(plot_lines)
    combined_text = play.get("title", "") + plot_summary + "".join(event["text"] for event in events[:80])
    metadata = {
        "plot_summary": plot_summary,
        "notes": note_lines,
        "story_period": infer_story_period(combined_text, play.get("title", ""), plot_summary),
        "play_genre": infer_genre(play.get("title", ""), plot_summary),
    }

    for scene in scenes:
        scene_events = [event for event in events if event["scene_id"] == scene["scene_id"]]
        scene["metrics"] = event_metrics(scene_events)

    return {
        "schema_version": "1.0.0",
        "play": play,
        "metadata": metadata,
        "roles": list(role_map.values()),
        "scenes": scenes,
        "events": events,
    }


def parse_front_matter(front: list[str]) -> tuple[list[dict[str, Any]], list[str], list[str]]:
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
            name, category = line.split("：", 1)
            name = name.strip()
            if name:
                roles.append({"role_id": role_id(name), "name": name, "original_category": category.strip() or None, "is_main_role": True})
        elif section == "plot":
            plot_lines.append(line)
        elif section == "notes":
            note_lines.append(line)
    return roles, plot_lines, note_lines


def event_metrics(events: list[dict[str, Any]]) -> dict[str, Any]:
    counter = Counter(event["type"] for event in events)
    return {
        "event_count": len(events),
        "spoken_count": counter["spoken"],
        "aria_count": counter["aria"],
        "recitation_count": counter["recitation"],
        "stage_direction_count": counter["stage_direction"],
        "expression_count": counter["expression"],
        "text_length": sum(event.get("text_length", 0) for event in events),
    }


def category_to_broad(category: str | None) -> tuple[str, str | None]:
    if not category:
        return "未知", None
    if "旦" in category:
        return "旦", category
    if "生" in category or category in {"外", "末"}:
        return "生", category
    if "净" in category:
        return "净", category
    if "丑" in category:
        return "丑", category
    return "未知", category


def infer_gender(name: str, category: str | None, context: str) -> dict[str, Any]:
    text = f"{name}{category or ''}{context}"
    if any(hint in text for hint in FEMALE_HINTS):
        return {"label": "女", "confidence": 0.86 if category and "旦" in category else 0.68, "evidence": [next(h for h in FEMALE_HINTS if h in text)]}
    if any(hint in text for hint in MALE_HINTS):
        return {"label": "男", "confidence": 0.8 if category and ("生" in category or "净" in category or "丑" in category) else 0.62, "evidence": [next(h for h in MALE_HINTS if h in text)]}
    return {"label": "未知", "confidence": 0.2, "evidence": []}


def infer_age_group(name: str, category: str | None, context: str) -> dict[str, Any]:
    text = f"{name}{category or ''}{context}"
    if any(hint in text for hint in OLD_HINTS):
        return {"label": "中老年", "confidence": 0.75, "evidence": [next(h for h in OLD_HINTS if h in text)]}
    if any(hint in text for hint in YOUNG_HINTS):
        return {"label": "青年/少年", "confidence": 0.68, "evidence": [next(h for h in YOUNG_HINTS if h in text)]}
    return {"label": "成年", "confidence": 0.42, "evidence": []}


def extract_labels_by_rules(text: str, rules: dict[str, list[str]], max_labels: int = 3) -> list[str]:
    scored = []
    for label, words in rules.items():
        hits = sum(text.count(word) for word in words)
        if hits:
            scored.append((label, hits))
    return [label for label, _ in sorted(scored, key=lambda x: (-x[1], x[0]))[:max_labels]]


def infer_identity_labels(name: str, category: str | None, context: str) -> list[str]:
    name_context = f"{name}{category or ''}"
    labels = []
    for label in NAME_IDENTITY_OVERRIDES.get(name, []):
        if label not in labels:
            labels.append(label)
    if any(word in name_context for word in ["旗牌", "报子", "老军", "丫鬟", "童儿", "家院", "衙役"]):
        if "仆从/差役" not in labels:
            labels.append("仆从/差役")
    if any(word in name_context for word in ["龙套", "上手", "兵"]):
        if "武将/士兵" not in labels:
            labels.append("武将/士兵")
    if category and "旦" in category:
        if "女性家眷" not in labels:
            labels.append("女性家眷")
    if name in NAME_IDENTITY_OVERRIDES:
        return labels[:3]
    for label in extract_labels_by_rules(name_context + context[:300], IDENTITY_RULES, max_labels=3):
        if label not in labels:
            labels.append(label)
    return labels[:3]


def infer_hangdang(role: dict[str, Any], gender: dict[str, Any], age: dict[str, Any], identity: list[str], features: dict[str, int], context: str) -> dict[str, Any]:
    original = role.get("original_category")
    broad, fine = category_to_broad(original)
    evidence = []
    if original:
        evidence.append(f"主要角色标注：{role['name']}：{original}")
        return {"broad": broad, "fine": fine or original, "confidence": 0.97, "evidence": evidence}
    name = role["name"]
    if gender["label"] == "女":
        fine = "老旦" if age["label"] == "中老年" else "旦"
        return {"broad": "旦", "fine": fine, "confidence": 0.62, "evidence": gender["evidence"] + age["evidence"]}
    if any(key in identity for key in ["武将/士兵"]) or features.get("combat_hint_count", 0) > 0:
        return {"broad": "生", "fine": "武生/老生候选", "confidence": 0.55, "evidence": ["武将/士兵或武打提示"]}
    if any(key in identity for key in ["官员/谋臣", "帝王/皇族"]) or age["label"] == "中老年":
        return {"broad": "生", "fine": "老生", "confidence": 0.58, "evidence": identity + age["evidence"]}
    if any(word in name for word in ["丑", "媒婆"]) or "滑稽" in extract_labels_by_rules(context, TRAIT_RULES):
        return {"broad": "丑", "fine": "丑", "confidence": 0.52, "evidence": ["滑稽/丑角语义"]}
    return {"broad": "未知", "fine": "未知", "confidence": 0.25, "evidence": []}


def iter_play_paths(play_ids: set[str] | None = None) -> list[Path]:
    paths = sorted(PLAYS_DIR.glob("*.json"))
    if play_ids is None:
        return paths
    return [path for path in paths if path.stem in play_ids]


def infer_role_features(force: bool = False, play_ids: set[str] | None = None) -> dict[str, Any]:
    report = {"processed": 0, "skipped": 0, "failed": [], "low_confidence_roles": []}
    for play_path in iter_play_paths(play_ids):
        try:
            data = read_json(play_path)
            if data.get("roles_inferred") and not force:
                report["skipped"] += 1
                continue
            infer_roles_for_play(data)
            data["roles_inferred"] = True
            write_json(play_path, data)
            report["processed"] += 1
            for role in data["roles"]:
                if role["hangdang_prediction"]["confidence"] < 0.5:
                    report["low_confidence_roles"].append({"play_id": data["play"]["play_id"], "role": role["name"], "confidence": role["hangdang_prediction"]["confidence"]})
        except Exception as exc:  # noqa: BLE001
            report["failed"].append({"play_id": play_path.stem, "error": f"{type(exc).__name__}: {exc}"})
    write_json(REPORTS_DIR / "04_infer_role_features_report.json", report)
    build_role_hangdang_analysis(play_ids=play_ids)
    return report


def infer_roles_for_play(data: dict[str, Any]) -> None:
    events = data["events"]
    events_by_role: dict[str, list[dict[str, Any]]] = defaultdict(list)
    stage_text_by_role: dict[str, list[str]] = defaultdict(list)
    for event in events:
        for speaker in event.get("speakers", []):
            events_by_role[speaker].append(event)
        if event["type"] == "stage_direction":
            for role in data["roles"]:
                if role["name"] in event["text"]:
                    stage_text_by_role[role["name"]].append(event["text"])
    plot = data["metadata"].get("plot_summary", "")
    for role in data["roles"]:
        name = role["name"]
        role_events = events_by_role[name]
        role_text = plot + "".join(event["text"] for event in role_events[:30]) + "".join(stage_text_by_role[name])
        counter = Counter(event["type"] for event in role_events)
        stage_text = "".join(stage_text_by_role[name])
        performance_features = {
            "spoken_count": counter["spoken"],
            "aria_count": counter["aria"],
            "recitation_count": counter["recitation"],
            "expression_count": counter["expression"],
            "action_hint_count": len(stage_text_by_role[name]),
            "combat_hint_count": sum(stage_text.count(word) for word in ["打", "杀", "战", "枪", "刀", "起霸", "会阵"]),
        }
        gender = infer_gender(name, role.get("original_category"), role_text)
        age = infer_age_group(name, role.get("original_category"), role_text)
        identity = infer_identity_labels(name, role.get("original_category"), role_text)
        traits = extract_labels_by_rules(name + role_text, TRAIT_RULES)
        hangdang = infer_hangdang(role, gender, age, identity, performance_features, role_text)
        role.update(
            {
                "gender": gender["label"],
                "gender_confidence": gender["confidence"],
                "age_group": age["label"],
                "age_confidence": age["confidence"],
                "identity": identity,
                "personality_traits": traits,
                "performance_features": performance_features,
                "hangdang_prediction": hangdang,
            }
        )


def build_role_hangdang_analysis(play_ids: set[str] | None = None) -> dict[str, Any]:
    records = []
    for play_path in iter_play_paths(play_ids):
        data = read_json(play_path)
        play = data["play"]
        period = data["metadata"]["story_period"]["label"]
        genre = data["metadata"]["play_genre"]["label"]
        for role in data["roles"]:
            pred = role.get("hangdang_prediction", {})
            features = role.get("performance_features", {})
            records.append(
                {
                    "play_id": play["play_id"],
                    "title": play["title"],
                    "collection_id": play["collection_id"],
                    "story_period": period,
                    "genre": genre,
                    "role": role["name"],
                    "original_category": role.get("original_category"),
                    "predicted_broad": pred.get("broad"),
                    "predicted_fine": pred.get("fine"),
                    "confidence": pred.get("confidence"),
                    "gender": role.get("gender"),
                    "age_group": role.get("age_group"),
                    "identity": role.get("identity", []),
                    "personality_traits": role.get("personality_traits", []),
                    **features,
                }
            )
    feature_counter = Counter()
    period_counter = Counter()
    pattern_counter = Counter()
    for record in records:
        hangdang = record.get("predicted_fine") or record.get("predicted_broad")
        for identity in record.get("identity", []):
            feature_counter[(identity, hangdang)] += 1
        period_counter[(record.get("story_period"), hangdang)] += 1
        pattern = f"{record.get('gender')} + {record.get('age_group')} + {'/'.join(record.get('identity')[:2]) or '身份未知'}"
        pattern_counter[(pattern, hangdang)] += 1
    output = {
        "role_records": records,
        "feature_hangdang_matrix": [
            {"feature": feature, "hangdang": hangdang, "count": count}
            for (feature, hangdang), count in feature_counter.most_common()
        ],
        "period_hangdang_trends": [
            {"story_period": period, "hangdang": hangdang, "count": count}
            for (period, hangdang), count in period_counter.most_common()
        ],
        "typical_patterns": [
            {"pattern": pattern, "typical_hangdang": hangdang, "support_count": count, "confidence": round(min(0.95, 0.45 + math.log1p(count) / 5), 2)}
            for (pattern, hangdang), count in pattern_counter.most_common(80)
        ],
    }
    write_json(PROCESSED_DIR / "role_hangdang_analysis.json", output)
    return output


def build_role_networks(play_ids: set[str] | None = None) -> list[dict[str, Any]]:
    networks = []
    for play_path in iter_play_paths(play_ids):
        data = read_json(play_path)
        networks.append(build_network_for_play(data))
    write_json(PROCESSED_DIR / "role_networks.json", networks)
    return networks


def build_network_for_play(data: dict[str, Any]) -> dict[str, Any]:
    roles = {role["name"]: role for role in data["roles"]}
    same_scene_edges = Counter()
    scene_ids_by_pair: dict[tuple[str, str], set[str]] = defaultdict(set)
    for scene in data["scenes"]:
        chars = sorted(set(scene.get("characters", [])))
        for a, b in combinations(chars, 2):
            same_scene_edges[(a, b)] += 1
            scene_ids_by_pair[(a, b)].add(scene["scene_id"])
    dialogue_edges = Counter()
    last = None
    for event in data["events"]:
        if not event.get("speakers") or event["type"] == "stage_direction":
            continue
        if last and last["scene_id"] == event["scene_id"]:
            for a in last["speakers"]:
                for b in event["speakers"]:
                    if a != b:
                        pair = tuple(sorted((a, b)))
                        dialogue_edges[pair] += 1
                        scene_ids_by_pair[pair].add(event["scene_id"])
        last = event
    semantic_edges = infer_semantic_edges(data)
    edges = []
    for (a, b), weight in same_scene_edges.items():
        edges.append({"source": a, "target": b, "type": "same_scene", "relation_label": "同场共现", "weight": weight, "scene_ids": sorted(scene_ids_by_pair[(a, b)]), "evidence": []})
    for (a, b), weight in dialogue_edges.items():
        edges.append({"source": a, "target": b, "type": "dialogue_turn", "relation_label": "连续对话", "weight": weight, "scene_ids": sorted(scene_ids_by_pair[(a, b)]), "evidence": []})
    edges.extend(semantic_edges)
    degree = Counter()
    for edge in edges:
        degree[edge["source"]] += edge["weight"]
        degree[edge["target"]] += edge["weight"]
    nodes = []
    max_degree = max(degree.values() or [1])
    for name, role in roles.items():
        pred = role.get("hangdang_prediction", {})
        nodes.append(
            {
                "id": role["role_id"],
                "name": name,
                "hangdang": pred.get("fine") or pred.get("broad"),
                "gender": role.get("gender"),
                "identity": role.get("identity", []),
                "importance_score": round(degree[name] / max_degree, 3) if max_degree else 0,
            }
        )
    n = len(nodes)
    density = round(len({tuple(sorted((edge["source"], edge["target"]))) for edge in edges}) / (n * (n - 1) / 2), 3) if n > 1 else 0
    central_roles = [name for name, _ in degree.most_common(5)]
    return {
        "play_id": data["play"]["play_id"],
        "title": data["play"]["title"],
        "genre": data["metadata"]["play_genre"]["label"],
        "nodes": nodes,
        "edges": edges,
        "network_metrics": {
            "density": density,
            "central_roles": central_roles,
            "structure_type": infer_network_structure(density, len(central_roles), data["metadata"]["play_genre"]["label"]),
        },
    }


def infer_semantic_edges(data: dict[str, Any]) -> list[dict[str, Any]]:
    roles = [role["name"] for role in data["roles"]]
    plot = data["metadata"].get("plot_summary", "")
    text = plot + "".join(event["text"] for event in data["events"][:120])
    edges = []
    for a, b in combinations(roles, 2):
        window_hits = []
        for match in re.finditer(re.escape(a), text):
            start = max(0, match.start() - 35)
            end = min(len(text), match.end() + 35)
            window = text[start:end]
            if b in window:
                window_hits.append(window)
        if not window_hits:
            continue
        relation = "关联"
        if any(word in "".join(window_hits) for word in ["战", "杀", "夺", "敌", "退", "斩", "骂", "围困"]):
            relation = "敌对/冲突"
        elif any(word in "".join(window_hits) for word in ["母", "父", "子", "女", "妻", "夫", "兄", "弟"]):
            relation = "亲属/伦理"
        elif any(word in "".join(window_hits) for word in ["命", "传", "差", "将令", "参见", "丞相"]):
            relation = "上下级/命令"
        edges.append({"source": a, "target": b, "type": "semantic_relation", "relation_label": relation, "weight": round(min(1.0, 0.45 + len(window_hits) * 0.12), 2), "scene_ids": [], "evidence": window_hits[:3]})
    return edges


def infer_network_structure(density: float, central_count: int, genre: str) -> str:
    if density >= 0.45:
        return "群像密集型"
    if "历史" in genre or "征战" in genre:
        return "双核心/阵营对抗型"
    if "家庭" in genre:
        return "家庭伦理中心型"
    if "公案" in genre:
        return "审理辐射型"
    return "核心角色辐射型" if central_count <= 3 else "多中心互动型"


def extract_topics_and_narrative(play_ids: set[str] | None = None) -> list[dict[str, Any]]:
    outputs = []
    networks_by_id = {net["play_id"]: net for net in read_json(PROCESSED_DIR / "role_networks.json", [])}
    for play_path in iter_play_paths(play_ids):
        data = read_json(play_path)
        network = networks_by_id.get(data["play"]["play_id"], {})
        outputs.append(build_topic_narrative_for_play(data, network))
    write_json(PROCESSED_DIR / "topic_narrative_integrated.json", outputs)
    return outputs


def build_topic_narrative_for_play(data: dict[str, Any], network: dict[str, Any]) -> dict[str, Any]:
    text = data["metadata"].get("plot_summary", "") + "".join(event["text"] for event in data["events"])
    themes = []
    for theme, words in THEME_RULES:
        hits = [word for word in words if word in text]
        if hits:
            count = sum(text.count(word) for word in hits)
            related_roles = [role["name"] for role in data["roles"] if role["name"] in text][:6]
            themes.append({"theme": theme, "weight": round(min(0.98, 0.35 + math.log1p(count) / 4), 2), "keywords": hits[:8], "related_roles": related_roles})
    themes.sort(key=lambda item: item["weight"], reverse=True)
    rhythm_curve = []
    for scene in data["scenes"]:
        events = [event for event in data["events"] if event["scene_id"] == scene["scene_id"]]
        scene_text = "".join(event["text"] for event in events)
        tension_words = ["急", "杀", "战", "斩", "哭", "怒", "兵", "失", "死", "冤", "夺", "围", "退"]
        tension = min(1.0, 0.2 + len(scene.get("characters", [])) * 0.04 + sum(scene_text.count(w) for w in tension_words) * 0.05 + len(events) / 120)
        rhythm_curve.append({"scene_no": scene["scene_no"], "tension": round(tension, 2), "event_count": len(events), "aria_count": scene["metrics"]["aria_count"]})
    stages = infer_narrative_stages(data, rhythm_curve)
    dominant_theme = themes[0]["theme"] if themes else "未识别主题"
    central_roles = network.get("network_metrics", {}).get("central_roles", [])[:2]
    return {
        "play_id": data["play"]["play_id"],
        "title": data["play"]["title"],
        "genre": data["metadata"]["play_genre"]["label"],
        "story_period": data["metadata"]["story_period"]["label"],
        "themes": themes,
        "narrative_structure": {
            "stages": stages,
            "rhythm_curve": rhythm_curve,
            "pattern": infer_narrative_pattern(data, themes),
        },
        "integrated_patterns": [
            {
                "pattern": f"{'/'.join(central_roles) or '核心角色'}推动{dominant_theme}",
                "roles": central_roles,
                "theme": dominant_theme,
                "narrative_function": "通过关键互动关系推动主题表达与剧情转折",
            }
        ],
    }


def infer_narrative_stages(data: dict[str, Any], rhythm_curve: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not data["scenes"]:
        return []
    scene_count = len(data["scenes"])
    peak = max(rhythm_curve, key=lambda item: item["tension"])["scene_no"] if rhythm_curve else max(1, scene_count // 2)
    return [
        {"stage": "开端/铺垫", "scene_range": [1, max(1, peak - 1)], "events": summarize_scene_events(data, 1, max(1, peak - 1))},
        {"stage": "冲突/高潮", "scene_range": [peak, peak], "events": summarize_scene_events(data, peak, peak)},
        {"stage": "化解/结局", "scene_range": [min(scene_count, peak + 1), scene_count], "events": summarize_scene_events(data, min(scene_count, peak + 1), scene_count)},
    ]


def summarize_scene_events(data: dict[str, Any], start_scene: int, end_scene: int) -> list[str]:
    events = [event["text"] for event in data["events"] if start_scene <= event["scene_no"] <= end_scene and event["type"] != "stage_direction"]
    snippets = []
    for text in events:
        if len(text) >= 4:
            snippets.append(text[:18])
        if len(snippets) >= 4:
            break
    return snippets


def infer_narrative_pattern(data: dict[str, Any], themes: list[dict[str, Any]]) -> str:
    genre = data["metadata"]["play_genre"]["label"]
    theme_names = [theme["theme"] for theme in themes[:3]]
    if "公案" in genre or "公案正义" in theme_names:
        return "冤案-审理-昭雪"
    if "家庭" in genre or "家庭伦理" in theme_names:
        return "家庭冲突-伦理抉择-关系修复"
    if "智谋对抗" in theme_names:
        return "危机-设局-试探-化解"
    if "征战" in genre or "征战武勇" in theme_names:
        return "征战-对抗-胜负"
    return "铺垫-冲突-转折-结局"


def build_visualization_bundle(play_ids: set[str] | None = None) -> dict[str, Any]:
    manifest = read_json(PROCESSED_DIR / "corpus_manifest.json", [])
    if play_ids is not None:
        manifest = [row for row in manifest if row["play_id"] in play_ids]
    role_analysis = read_json(PROCESSED_DIR / "role_hangdang_analysis.json", {})
    networks = read_json(PROCESSED_DIR / "role_networks.json", [])
    integrated = read_json(PROCESSED_DIR / "topic_narrative_integrated.json", [])
    integrated_by_id = {item["play_id"]: item for item in integrated}
    network_by_id = {item["play_id"]: item for item in networks}
    play_table = []
    scene_timeline = []
    role_network_nodes = []
    role_network_edges = []
    topic_play_matrix = []
    theme_role_links = []
    narrative_stage_table = []
    rhythm_curves = []
    integrated_patterns = []
    for row in manifest:
        integrated_item = integrated_by_id.get(row["play_id"], {})
        play_table.append(
            {
                "play_id": row["play_id"],
                "title": row["title"],
                "collection_id": row["collection_id"],
                "collection_name": row["collection_name"],
                "genre": integrated_item.get("genre"),
                "story_period": integrated_item.get("story_period"),
                "page_count": row.get("page_count"),
            }
        )
    for play_path in iter_play_paths(play_ids):
        data = read_json(play_path)
        for scene in data["scenes"]:
            scene_timeline.append({"play_id": data["play"]["play_id"], "title": data["play"]["title"], "scene_no": scene["scene_no"], **scene["metrics"], "characters": scene["characters"]})
    for network in networks:
        for node in network["nodes"]:
            role_network_nodes.append({"play_id": network["play_id"], "title": network["title"], **node})
        for edge in network["edges"]:
            role_network_edges.append({"play_id": network["play_id"], "title": network["title"], **edge})
    for item in integrated:
        for theme in item["themes"]:
            topic_play_matrix.append({"play_id": item["play_id"], "title": item["title"], "theme": theme["theme"], "weight": theme["weight"], "keywords": theme["keywords"]})
            for role in theme.get("related_roles", []):
                theme_role_links.append({"play_id": item["play_id"], "theme": theme["theme"], "role": role, "weight": theme["weight"]})
        for stage in item["narrative_structure"]["stages"]:
            narrative_stage_table.append({"play_id": item["play_id"], "title": item["title"], **stage})
        for point in item["narrative_structure"]["rhythm_curve"]:
            rhythm_curves.append({"play_id": item["play_id"], "title": item["title"], **point})
        for pattern in item["integrated_patterns"]:
            integrated_patterns.append({"play_id": item["play_id"], "title": item["title"], **pattern})
    bundle = {
        "play_table": play_table,
        "role_table": role_analysis.get("role_records", []),
        "feature_hangdang_matrix": role_analysis.get("feature_hangdang_matrix", []),
        "period_hangdang_trends": role_analysis.get("period_hangdang_trends", []),
        "scene_timeline": scene_timeline,
        "role_network_nodes": role_network_nodes,
        "role_network_edges": role_network_edges,
        "topic_play_matrix": topic_play_matrix,
        "theme_role_links": theme_role_links,
        "narrative_stage_table": narrative_stage_table,
        "rhythm_curves": rhythm_curves,
        "integrated_patterns": integrated_patterns,
    }
    write_json(PROCESSED_DIR / "visualization_bundle.json", bundle)
    return bundle
