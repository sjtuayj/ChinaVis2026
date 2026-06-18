#!/usr/bin/env python
"""Convert ChinaVis opera PDFs into structured JSONL datasets.

The script supports either:
1. an extracted dataset directory that contains grouped zip files, or
2. the original outer dataset zip that contains grouped zip files.

Output files:
- plays.jsonl: one structured record per opera PDF
- characters.jsonl: one character-stat record per character per play
- relations.jsonl: character co-occurrence/dialogue edges per play
- chunks.jsonl: retrieval chunks for embeddings/vector databases
- summary.json: aggregate processing statistics
"""

from __future__ import annotations

import argparse
import io
import itertools
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, TextIO

try:
    import fitz  # PyMuPDF
except ImportError as exc:  # pragma: no cover - dependency guard
    raise SystemExit("Missing dependency: PyMuPDF. Install it with `pip install pymupdf`.") from exc


HANGDANG_KEYWORDS = [
    "老生",
    "小生",
    "武生",
    "红生",
    "娃娃生",
    "青衣",
    "花旦",
    "刀马旦",
    "武旦",
    "老旦",
    "彩旦",
    "旦",
    "正净",
    "副净",
    "武净",
    "净",
    "文丑",
    "武丑",
    "丑",
    "杂",
]

SINGING_HINTS = (
    "唱",
    "西皮",
    "二黄",
    "反二黄",
    "高拨子",
    "吹腔",
    "昆腔",
    "南梆子",
    "流水",
    "散板",
    "导板",
    "原板",
    "摇板",
)

SCENE_RE = re.compile(r"^【第[一二三四五六七八九十百千万零〇\d]+场】", re.MULTILINE)
SPEECH_RE = re.compile(r"^([^\s　（）()：:]{1,24})[\s　]+[（(]([^）)]{1,30})[）)]\s*(.*)$")
URL_RE = re.compile(r"https?://\S+")
DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
TITLE_RE = re.compile(r"《([^》]{1,80})》")


@dataclass(frozen=True)
class PdfSource:
    pdf_id: str
    pdf_name: str
    group_id: str
    source_path: str
    data: bytes


def fix_zip_name(name: str) -> str:
    """Recover GBK filenames that were decoded as cp437 by zipfile."""
    try:
        return name.encode("cp437").decode("gbk")
    except UnicodeError:
        return name


def json_dump_line(handle, data: dict) -> None:
    handle.write(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")


def clean_pdf_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def is_page_artifact(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    if stripped == "中国京剧戏考":
        return True
    if stripped.isdigit():
        return True
    if URL_RE.fullmatch(stripped) or DATE_RE.fullmatch(stripped):
        return True
    if TITLE_RE.fullmatch(stripped):
        return True
    return False


def infer_pdf_id(pdf_name: str) -> str:
    stem = Path(pdf_name).stem
    match = re.match(r"(\d{6,})", stem)
    return match.group(1) if match else re.sub(r"\W+", "_", stem)


def infer_title(pdf_name: str, text: str) -> str:
    early_text = text[:1200]
    match = TITLE_RE.search(early_text)
    if match:
        return match.group(1).strip()

    stem = Path(pdf_name).stem
    if "_" in stem:
        return stem.split("_", 1)[1].strip()
    return stem


def normalize_marker(marker: str) -> str:
    return re.sub(r"\s+", "", marker.strip())


def marker_category(marker: str) -> str:
    marker = normalize_marker(marker)
    if not marker:
        return "unknown"
    if "白" in marker:
        return "spoken"
    if "念" in marker:
        return "recitation"
    if any(hint in marker for hint in SINGING_HINTS):
        return "singing"
    if any(hint in marker for hint in ("上", "下", "同", "打", "做", "舞", "起霸")):
        return "stage_action"
    return "other"


def infer_hangdang(raw_role: str) -> str | None:
    compact = re.sub(r"\s+", "", raw_role)
    for keyword in HANGDANG_KEYWORDS:
        if keyword in compact:
            return keyword
    return None


def extract_block(text: str, start_label: str, stop_labels: Iterable[str]) -> str:
    start = text.find(start_label)
    if start < 0:
        return ""
    body_start = start + len(start_label)
    stops = [text.find(label, body_start) for label in stop_labels]
    stops = [idx for idx in stops if idx >= 0]
    body_end = min(stops) if stops else len(text)
    return text[body_start:body_end].strip()


def parse_roles(text: str) -> list[dict]:
    block = extract_block(text, "主要角色", ("情节", "注释", "根据", "【第"))
    roles: list[dict] = []
    seen: set[str] = set()

    for raw_line in block.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("http://", "https://")):
            continue
        match = re.match(r"^([^：:]{1,24})[：:]\s*(.+)$", line)
        if not match:
            continue
        name = match.group(1).strip()
        raw_role = match.group(2).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        roles.append(
            {
                "name": name,
                "raw_role": raw_role,
                "hangdang": infer_hangdang(raw_role),
            }
        )
    return roles


def split_scenes(text: str) -> list[dict]:
    matches = list(SCENE_RE.finditer(text))
    if not matches:
        return [{"scene_id": "scene_001", "label": "全文", "text": text}]

    scenes: list[dict] = []
    for idx, match in enumerate(matches):
        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        label = match.group(0)
        scene_text = text[start:end].strip()
        scenes.append(
            {
                "scene_id": f"scene_{idx + 1:03d}",
                "label": label.strip("【】"),
                "text": scene_text,
            }
        )
    return scenes


def parse_speeches(scene_text: str) -> list[dict]:
    speeches: list[dict] = []

    for raw_line in scene_text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if is_page_artifact(stripped):
            continue
        match = SPEECH_RE.match(line)
        if match:
            speaker = match.group(1).strip()
            marker = normalize_marker(match.group(2))
            content = match.group(3).strip()
            speeches.append(
                {
                    "speaker": speaker,
                    "marker": marker,
                    "marker_category": marker_category(marker),
                    "text": content,
                }
            )
            continue

        if speeches and (line.startswith((" ", "\t", "　")) or not stripped.startswith("（")):
            existing = speeches[-1]["text"]
            speeches[-1]["text"] = f"{existing}{stripped}" if existing else stripped

    return [speech for speech in speeches if speech["speaker"] and (speech["text"] or speech["marker"])]


def extract_pdf_text(data: bytes) -> tuple[str, int]:
    with fitz.open(stream=data, filetype="pdf") as doc:
        pages = [page.get_text("text") for page in doc]
        return clean_pdf_text("\n".join(pages)), doc.page_count


def iter_pdfs_from_zip(zip_path: Path) -> Iterator[PdfSource]:
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            fixed_name = fix_zip_name(info.filename)
            if info.is_dir():
                continue

            lower_name = fixed_name.lower()
            if lower_name.endswith(".pdf"):
                yield PdfSource(
                    pdf_id=infer_pdf_id(fixed_name),
                    pdf_name=Path(fixed_name).name,
                    group_id=zip_path.stem,
                    source_path=f"{zip_path}!{fixed_name}",
                    data=zf.read(info),
                )
            elif lower_name.endswith(".zip"):
                nested_bytes = zf.read(info)
                group_id = Path(fixed_name).stem
                with zipfile.ZipFile(io.BytesIO(nested_bytes)) as nested:
                    for nested_info in nested.infolist():
                        nested_name = fix_zip_name(nested_info.filename)
                        if nested_info.is_dir() or not nested_name.lower().endswith(".pdf"):
                            continue
                        yield PdfSource(
                            pdf_id=infer_pdf_id(nested_name),
                            pdf_name=Path(nested_name).name,
                            group_id=group_id,
                            source_path=f"{zip_path}!{fixed_name}!{nested_name}",
                            data=nested.read(nested_info),
                        )


def iter_pdf_sources(input_path: Path) -> Iterator[PdfSource]:
    if input_path.is_file() and input_path.suffix.lower() == ".zip":
        yield from iter_pdfs_from_zip(input_path)
        return

    if not input_path.is_dir():
        raise FileNotFoundError(f"Input path does not exist or is not supported: {input_path}")

    for pdf_path in sorted(input_path.rglob("*.pdf")):
        yield PdfSource(
            pdf_id=infer_pdf_id(pdf_path.name),
            pdf_name=pdf_path.name,
            group_id=pdf_path.parent.name,
            source_path=str(pdf_path),
            data=pdf_path.read_bytes(),
        )

    for zip_path in sorted(input_path.rglob("*.zip")):
        yield from iter_pdfs_from_zip(zip_path)


def build_relations(play_id: str, title: str, scenes: list[dict]) -> list[dict]:
    edges: dict[tuple[str, str], dict] = {}

    for scene in scenes:
        speakers = [speech["speaker"] for speech in scene["speeches"] if speech["speaker"]]
        unique_speakers = sorted(set(speakers))

        for source, target in itertools.combinations(unique_speakers, 2):
            key = tuple(sorted((source, target)))
            edge = edges.setdefault(
                key,
                {
                    "play_id": play_id,
                    "title": title,
                    "source": key[0],
                    "target": key[1],
                    "scene_cooccurrence": 0,
                    "dialogue_turns": 0,
                    "scenes": [],
                },
            )
            edge["scene_cooccurrence"] += 1
            edge["scenes"].append(scene["scene_id"])

        for first, second in zip(speakers, speakers[1:]):
            if first == second:
                continue
            key = tuple(sorted((first, second)))
            edge = edges.setdefault(
                key,
                {
                    "play_id": play_id,
                    "title": title,
                    "source": key[0],
                    "target": key[1],
                    "scene_cooccurrence": 0,
                    "dialogue_turns": 0,
                    "scenes": [],
                },
            )
            edge["dialogue_turns"] += 1
            if scene["scene_id"] not in edge["scenes"]:
                edge["scenes"].append(scene["scene_id"])

    relations = []
    for edge in edges.values():
        edge["weight"] = edge["scene_cooccurrence"] + edge["dialogue_turns"] * 2
        edge["scenes"] = sorted(set(edge["scenes"]))
        relations.append(edge)

    relations.sort(key=lambda item: (-item["weight"], item["source"], item["target"]))
    return relations


def build_character_stats(play_id: str, title: str, roles: list[dict], scenes: list[dict]) -> list[dict]:
    role_map = {role["name"]: role for role in roles}
    stats: dict[str, dict] = {}

    for scene in scenes:
        scene_speakers = set()
        for speech in scene["speeches"]:
            speaker = speech["speaker"]
            scene_speakers.add(speaker)
            item = stats.setdefault(
                speaker,
                {
                    "play_id": play_id,
                    "title": title,
                    "name": speaker,
                    "raw_role": role_map.get(speaker, {}).get("raw_role"),
                    "hangdang": role_map.get(speaker, {}).get("hangdang"),
                    "speech_count": 0,
                    "text_length": 0,
                    "scene_count": 0,
                    "marker_counts": Counter(),
                    "marker_category_counts": Counter(),
                },
            )
            item["speech_count"] += 1
            item["text_length"] += len(speech.get("text", ""))
            item["marker_counts"][speech["marker"]] += 1
            item["marker_category_counts"][speech["marker_category"]] += 1

        for speaker in scene_speakers:
            stats.setdefault(
                speaker,
                {
                    "play_id": play_id,
                    "title": title,
                    "name": speaker,
                    "raw_role": role_map.get(speaker, {}).get("raw_role"),
                    "hangdang": role_map.get(speaker, {}).get("hangdang"),
                    "speech_count": 0,
                    "text_length": 0,
                    "scene_count": 0,
                    "marker_counts": Counter(),
                    "marker_category_counts": Counter(),
                },
            )["scene_count"] += 1

    for role in roles:
        stats.setdefault(
            role["name"],
            {
                "play_id": play_id,
                "title": title,
                "name": role["name"],
                "raw_role": role["raw_role"],
                "hangdang": role["hangdang"],
                "speech_count": 0,
                "text_length": 0,
                "scene_count": 0,
                "marker_counts": Counter(),
                "marker_category_counts": Counter(),
            },
        )

    rows = []
    for item in stats.values():
        item = dict(item)
        item["marker_counts"] = dict(item["marker_counts"])
        item["marker_category_counts"] = dict(item["marker_category_counts"])
        rows.append(item)
    rows.sort(key=lambda item: (-item["speech_count"], item["name"]))
    return rows


def build_chunks(play: dict, chunk_level: str) -> list[dict]:
    chunks: list[dict] = []
    play_id = play["play_id"]
    title = play["title"]

    if play.get("roles"):
        chunks.append(
            {
                "chunk_id": f"{play_id}_roles",
                "play_id": play_id,
                "title": title,
                "chunk_type": "roles",
                "scene_id": None,
                "speaker": None,
                "text": "\n".join(f'{role["name"]}: {role.get("raw_role") or ""}' for role in play["roles"]),
            }
        )

    if play.get("synopsis"):
        chunks.append(
            {
                "chunk_id": f"{play_id}_synopsis",
                "play_id": play_id,
                "title": title,
                "chunk_type": "synopsis",
                "scene_id": None,
                "speaker": None,
                "text": play["synopsis"],
            }
        )

    for scene in play["scenes"]:
        if chunk_level in ("scene", "both"):
            scene_text = "\n".join(
                f'{speech["speaker"]}({speech["marker"]}): {speech["text"]}'
                for speech in scene["speeches"]
            )
            chunks.append(
                {
                    "chunk_id": f'{play_id}_{scene["scene_id"]}',
                    "play_id": play_id,
                    "title": title,
                    "chunk_type": "scene",
                    "scene_id": scene["scene_id"],
                    "speaker": None,
                    "text": scene_text or scene.get("text", ""),
                }
            )

        if chunk_level in ("speech", "both"):
            for idx, speech in enumerate(scene["speeches"], start=1):
                if not speech.get("text"):
                    continue
                chunks.append(
                    {
                        "chunk_id": f'{play_id}_{scene["scene_id"]}_speech_{idx:04d}',
                        "play_id": play_id,
                        "title": title,
                        "chunk_type": "speech",
                        "scene_id": scene["scene_id"],
                        "speaker": speech["speaker"],
                        "marker": speech["marker"],
                        "marker_category": speech["marker_category"],
                        "text": speech["text"],
                    }
                )

    return chunks


def parse_play(source: PdfSource) -> dict:
    text, page_count = extract_pdf_text(source.data)
    title = infer_title(source.pdf_name, text)
    roles = parse_roles(text)
    synopsis = extract_block(text, "情节", ("注释", "根据", "【第", "http://", "https://"))
    notes = extract_block(text, "注释", ("根据", "【第", "http://", "https://"))
    url_match = URL_RE.search(text)
    date_match = DATE_RE.search(text)

    scenes = []
    for scene in split_scenes(text):
        speeches = parse_speeches(scene["text"])
        speaker_counts = Counter(speech["speaker"] for speech in speeches)
        marker_counts = Counter(speech["marker"] for speech in speeches)
        category_counts = Counter(speech["marker_category"] for speech in speeches)
        scenes.append(
            {
                "scene_id": scene["scene_id"],
                "label": scene["label"],
                "speech_count": len(speeches),
                "speakers": sorted(speaker_counts),
                "speaker_counts": dict(speaker_counts),
                "marker_counts": dict(marker_counts),
                "marker_category_counts": dict(category_counts),
                "speeches": speeches,
            }
        )

    all_speeches = [speech for scene in scenes for speech in scene["speeches"]]
    play = {
        "play_id": source.pdf_id,
        "title": title,
        "pdf_name": source.pdf_name,
        "group_id": source.group_id,
        "source_path": source.source_path,
        "page_count": page_count,
        "source_url": url_match.group(0) if url_match else None,
        "source_date": date_match.group(0) if date_match else None,
        "roles": roles,
        "synopsis": synopsis,
        "notes": notes,
        "scene_count": len(scenes),
        "speech_count": len(all_speeches),
        "character_count": len({speech["speaker"] for speech in all_speeches} | {role["name"] for role in roles}),
        "marker_category_counts": dict(Counter(speech["marker_category"] for speech in all_speeches)),
        "scenes": scenes,
    }
    return play


def open_output_files(output_dir: Path) -> dict[str, TextIO]:
    output_dir.mkdir(parents=True, exist_ok=True)
    return {
        "plays": (output_dir / "plays.jsonl").open("w", encoding="utf-8"),
        "characters": (output_dir / "characters.jsonl").open("w", encoding="utf-8"),
        "relations": (output_dir / "relations.jsonl").open("w", encoding="utf-8"),
        "chunks": (output_dir / "chunks.jsonl").open("w", encoding="utf-8"),
    }


def close_output_files(files: dict[str, TextIO]) -> None:
    for handle in files.values():
        handle.close()


def process_dataset(args: argparse.Namespace) -> dict:
    input_path = Path(args.input)
    output_dir = Path(args.output)
    files = open_output_files(output_dir)

    summary = {
        "input": str(input_path),
        "output": str(output_dir),
        "processed_plays": 0,
        "failed_plays": 0,
        "total_pages": 0,
        "total_scenes": 0,
        "total_speeches": 0,
        "total_characters_rows": 0,
        "total_relations": 0,
        "total_chunks": 0,
        "errors": [],
    }

    try:
        for index, source in enumerate(iter_pdf_sources(input_path), start=1):
            if args.limit and summary["processed_plays"] >= args.limit:
                break

            try:
                play = parse_play(source)
                characters = build_character_stats(play["play_id"], play["title"], play["roles"], play["scenes"])
                relations = build_relations(play["play_id"], play["title"], play["scenes"])
                chunks = build_chunks(play, args.chunk_level)

                json_dump_line(files["plays"], play)
                for row in characters:
                    json_dump_line(files["characters"], row)
                for row in relations:
                    json_dump_line(files["relations"], row)
                for row in chunks:
                    if row.get("text"):
                        json_dump_line(files["chunks"], row)

                summary["processed_plays"] += 1
                summary["total_pages"] += play["page_count"]
                summary["total_scenes"] += play["scene_count"]
                summary["total_speeches"] += play["speech_count"]
                summary["total_characters_rows"] += len(characters)
                summary["total_relations"] += len(relations)
                summary["total_chunks"] += len([chunk for chunk in chunks if chunk.get("text")])

                if args.verbose or summary["processed_plays"] % args.progress_every == 0:
                    print(
                        f'[{summary["processed_plays"]}] {play["play_id"]} {play["title"]} '
                        f'pages={play["page_count"]} scenes={play["scene_count"]} speeches={play["speech_count"]}',
                        flush=True,
                    )
            except Exception as exc:  # pragma: no cover - per-file recovery
                summary["failed_plays"] += 1
                error = {
                    "source_path": source.source_path,
                    "pdf_name": source.pdf_name,
                    "error": repr(exc),
                }
                summary["errors"].append(error)
                print(f'ERROR {source.pdf_name}: {exc!r}', file=sys.stderr, flush=True)

    finally:
        close_output_files(files)

    (output_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return summary


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        default="Opera_Dataset",
        help="Dataset directory or original outer zip path. Default: Opera_Dataset",
    )
    parser.add_argument(
        "--output",
        default="outputs/opera_json",
        help="Output directory for JSONL files. Default: outputs/opera_json",
    )
    parser.add_argument("--limit", type=int, default=0, help="Only process N PDFs for testing.")
    parser.add_argument(
        "--chunk-level",
        choices=("scene", "speech", "both"),
        default="both",
        help="Chunk granularity for chunks.jsonl. Default: both",
    )
    parser.add_argument("--progress-every", type=int, default=50, help="Print progress every N plays.")
    parser.add_argument("--verbose", action="store_true", help="Print every processed play.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    summary = process_dataset(args)
    print(
        "Done: "
        f'{summary["processed_plays"]} plays, '
        f'{summary["total_scenes"]} scenes, '
        f'{summary["total_speeches"]} speeches, '
        f'{summary["total_relations"]} relations, '
        f'{summary["total_chunks"]} chunks. '
        f'Failed: {summary["failed_plays"]}.'
    )
    return 0 if summary["failed_plays"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
