from common import PROCESSED_DIR, build_visualization_bundle, filter_manifest, parse_limit, read_json


if __name__ == "__main__":
    args = parse_limit()
    manifest = read_json(PROCESSED_DIR / "corpus_manifest.json", [])
    rows = filter_manifest(manifest, args)
    selected_play_ids = {row["play_id"] for row in rows} if (args.play_id or args.collection_id or args.limit is not None) else None
    bundle = build_visualization_bundle(play_ids=selected_play_ids)
    print({key: len(value) for key, value in bundle.items()})
