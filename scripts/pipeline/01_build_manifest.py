from common import build_manifest


if __name__ == "__main__":
    manifest = build_manifest()
    print(f"wrote corpus_manifest.json: {len(manifest)} plays")
