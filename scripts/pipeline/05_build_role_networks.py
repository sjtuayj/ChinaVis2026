from common import PROCESSED_DIR, build_role_networks, filter_manifest, parse_limit, read_json


if __name__ == "__main__":
    args = parse_limit()
    manifest = read_json(PROCESSED_DIR / "corpus_manifest.json", [])
    rows = filter_manifest(manifest, args)
    selected_play_ids = {row["play_id"] for row in rows} if (args.play_id or args.collection_id or args.limit is not None) else None
    networks = build_role_networks(play_ids=selected_play_ids)
    print(f"wrote role_networks.json: {len(networks)} plays")
