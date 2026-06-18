from common import PROCESSED_DIR, extract_topics_and_narrative, filter_manifest, parse_limit, read_json


if __name__ == "__main__":
    args = parse_limit()
    manifest = read_json(PROCESSED_DIR / "corpus_manifest.json", [])
    rows = filter_manifest(manifest, args)
    selected_play_ids = {row["play_id"] for row in rows} if (args.play_id or args.collection_id or args.limit is not None) else None
    outputs = extract_topics_and_narrative(play_ids=selected_play_ids)
    print(f"updated topic_narrative_integrated.json: {len(outputs)} plays")
