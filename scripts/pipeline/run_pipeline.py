from common import (
    INTERMEDIATE_TEXT_DIR,
    PLAYS_DIR,
    PROCESSED_DIR,
    build_manifest,
    build_role_networks,
    build_visualization_bundle,
    extract_pdf_text,
    extract_topics_and_narrative,
    filter_manifest,
    infer_role_features,
    parse_limit,
    parse_structure,
    read_json,
    refresh_manifest_from_text,
)


if __name__ == "__main__":
    args = parse_limit()
    manifest = read_json(PROCESSED_DIR / "corpus_manifest.json")
    if manifest is None or args.force:
        manifest = build_manifest()
    rows = filter_manifest(manifest, args)
    selected_play_ids = {row["play_id"] for row in rows}
    print(f"selected plays: {len(rows)}")

    processed = 0
    failed = []
    for index, row in enumerate(rows, 1):
        play_id = row["play_id"]
        title = row.get("title", "")
        try:
            if args.force or not (INTERMEDIATE_TEXT_DIR / f"{play_id}.json").exists():
                extract_pdf_text([row], force=args.force)
                manifest = refresh_manifest_from_text()
                row = next((item for item in manifest if item["play_id"] == play_id), row)

            if args.force or not (PLAYS_DIR / f"{play_id}.json").exists():
                parse_structure([INTERMEDIATE_TEXT_DIR / f"{play_id}.json"], force=args.force)

            processed += 1
            if processed == 1 or processed % 25 == 0 or index == len(rows):
                print(f"parsed {processed}/{len(rows)}: {play_id} {title}")
        except Exception as exc:  # noqa: BLE001
            failed.append({"play_id": play_id, "title": title, "error": f"{type(exc).__name__}: {exc}"})
            print(f"failed {play_id} {title}: {type(exc).__name__}: {exc}")

    if failed:
        print(f"stream parse failures: {len(failed)}")

    manifest = refresh_manifest_from_text()
    rows = filter_manifest(manifest, args)
    selected_play_ids = {row["play_id"] for row in rows}

    print("step 4: inferring role features")
    print(infer_role_features(force=args.force, play_ids=selected_play_ids))
    print("step 5: building role networks")
    print(f"role networks: {len(build_role_networks(play_ids=selected_play_ids))}")
    print("step 6-7: extracting topics and narrative")
    print(f"topic/narrative records: {len(extract_topics_and_narrative(play_ids=selected_play_ids))}")
    print("step 8: building visualization bundle")
    bundle = build_visualization_bundle(play_ids=selected_play_ids)
    print({key: len(value) for key, value in bundle.items()})
