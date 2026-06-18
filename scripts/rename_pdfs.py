"""Rename garbled PDF filenames using existing corpus_manifest.json."""
import json, os, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "processed" / "corpus_manifest.json"
EXTRACTED = ROOT / "1-I_opera_dataset" / "extracted"

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

# Group by collection
by_collection = {}
for row in manifest:
    cid = row["collection_id"]
    by_collection.setdefault(cid, []).append(row)

renamed = 0
for cid, rows in by_collection.items():
    col_dir = EXTRACTED / cid
    if not col_dir.exists():
        continue
    # Get existing PDFs in this collection
    existing = sorted(col_dir.glob("*.pdf"))
    if not existing:
        continue
    # Match by play_id prefix if possible, otherwise by order
    for row in rows:
        pid = row["play_id"]
        title = row.get("title", "")
        target = col_dir / f"{pid}_{title}.pdf"
        if target.exists():
            continue
        # Try to find matching PDF (starts with play_id)
        matches = [p for p in existing if p.name.startswith(pid)]
        if matches:
            old = matches[0]
            if old != target:
                shutil.move(str(old), str(target))
                renamed += 1
                existing = sorted(col_dir.glob("*.pdf"))

print(f"Renamed {renamed} PDFs")

# Remove safe-name duplicates
removed = 0
for col_dir in EXTRACTED.iterdir():
    if not col_dir.is_dir():
        continue
    for pdf in col_dir.glob("*.pdf"):
        name = pdf.name
        if not name[0:8].isdigit() or not "_" in name:
            pdf.unlink()
            removed += 1
print(f"Removed {removed} garbage files")

# Recount
total = 0
for d in sorted(EXTRACTED.iterdir()):
    if d.is_dir():
        cnt = len(list(d.glob("*.pdf")))
        total += cnt
print(f"Remaining: {total} PDFs")
