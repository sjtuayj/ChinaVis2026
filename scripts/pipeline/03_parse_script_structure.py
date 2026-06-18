from common import INTERMEDIATE_TEXT_DIR, build_manifest, extract_pdf_text, filter_manifest, parse_limit, parse_structure, read_json, PROCESSED_DIR


if __name__ == "__main__":
    args = parse_limit()
    manifest = read_json(PROCESSED_DIR / "corpus_manifest.json") or build_manifest()
    rows = filter_manifest(manifest, args)
    missing = [row for row in rows if not (INTERMEDIATE_TEXT_DIR / f"{row['play_id']}.json").exists()]
    if missing:
        extract_pdf_text(missing, force=False)
    text_files = [INTERMEDIATE_TEXT_DIR / f"{row['play_id']}.json" for row in rows]
    report = parse_structure(text_files, force=args.force)
    print(report)
