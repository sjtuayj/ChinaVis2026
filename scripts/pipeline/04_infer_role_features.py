from common import PROCESSED_DIR, filter_manifest, infer_role_features, parse_limit, read_json


if __name__ == "__main__":
    args = parse_limit()
    manifest = read_json(PROCESSED_DIR / "corpus_manifest.json", [])
    rows = filter_manifest(manifest, args)
    selected_play_ids = {row["play_id"] for row in rows} if (args.play_id or args.collection_id or args.limit is not None) else None
    report = infer_role_features(force=args.force, play_ids=selected_play_ids)
    print(report)
