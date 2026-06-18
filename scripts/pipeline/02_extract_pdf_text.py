from common import build_manifest, extract_pdf_text, filter_manifest, parse_limit, read_json, refresh_manifest_from_text, PROCESSED_DIR


if __name__ == "__main__":
    args = parse_limit()
    manifest = read_json(PROCESSED_DIR / "corpus_manifest.json") or build_manifest()
    rows = filter_manifest(manifest, args)
    report = extract_pdf_text(rows, force=args.force)
    refresh_manifest_from_text()
    print(report)
