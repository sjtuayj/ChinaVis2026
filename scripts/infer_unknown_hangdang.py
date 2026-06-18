"""
Infer hangdang for 14509 "未知" roles using multi-source evidence:
1. Cross-play role name → hangdang lookup (same name → same hangdang)
2. Performance marker patterns (singing → 旦/生, combat → 武)
3. Gender-indicative name keywords
"""
import json, os, re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
GRAPHS_DIR = ROOT / "outputs" / "opera_analysis" / "graphs"

def read_json(path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

# Female-indicative characters in role names
FEMALE_CHARS = set("娘母女姐妹姑奶妃后妾姬姝媛娟娥娇娃妮婵婷婉妙姝娴")
MALE_CHARS = set("父子爷公伯叔兄弟弟哥郎官将帅侯王帝皇臣相军士")
ELDER_CHARS = set("老太翁叟")

# Performance marker → hangdang hints
def infer_from_markers(markers):
    """Infer broad hangdang from performance markers."""
    singing = markers.get("singing", 0)
    spoken = markers.get("spoken", 0)
    recitation = markers.get("recitation", 0)
    combat = markers.get("combat", 0)
    action = markers.get("stage_action", 0)
    total = singing + spoken + recitation

    if total == 0:
        return None

    singing_ratio = singing / total if total > 0 else 0

    if combat > 0 and combat >= total * 0.3:
        return "武行"  # martial focused - likely 武生/武旦/武净
    if singing_ratio > 0.5:
        return "旦"  # heavy singing → typically dan
    if singing_ratio > 0.2 and singing > 2:
        return "生"  # moderate singing → often sheng
    if recitation >= total * 0.4:
        return "净"  # heavy recitation → jing
    return None  # can't determine


def main():
    print("=== Inferring unknown hangdang ===")

    # Step 1: Build role name → hangdang lookup from known roles
    name_to_hangdang = defaultdict(Counter)
    for gname in sorted(GRAPHS_DIR.glob("*.json")):
        graph = read_json(gname)
        if not graph:
            continue
        for node in graph.get("nodes", []):
            hg = node.get("hangdang", "")
            if hg and hg != "未知":
                name_to_hangdang[node.get("id", "")][hg] += 1

    # Convert to most common hangdang per name
    name_hg_map = {}
    for name, counter in name_to_hangdang.items():
        if len(name) >= 2 and counter.total() >= 2:
            top = counter.most_common(1)[0]
            name_hg_map[name] = top[0]
    print(f"Name→Hangdang lookup: {len(name_hg_map)} names (from {len(name_to_hangdang)} unique)")

    # Step 2: Process graph files and infer unknown hangdang
    inferred_count = 0
    total_unknown = 0
    still_unknown = 0
    method_counts = Counter()

    updated_graphs = {}
    for gname in sorted(GRAPHS_DIR.glob("*.json")):
        graph = read_json(gname)
        if not graph:
            continue
        pid = graph["play"]["play_id"]
        modified = False

        for node in graph.get("nodes", []):
            hg = node.get("hangdang", "未知")
            if hg != "未知":
                continue
            total_unknown += 1
            name = node.get("id", "")
            markers = node.get("marker_category_counts", {})
            new_hg = None

            # Method 1: Cross-play name lookup
            if name in name_hg_map:
                new_hg = name_hg_map[name]
                method_counts["cross_play_name"] += 1
            else:
                # Method 2: Performance markers
                new_hg = infer_from_markers(markers)
                if new_hg:
                    method_counts["performance_markers"] += 1
                else:
                    # Method 3: Name-based gender inference
                    has_female = any(c in name for c in FEMALE_CHARS)
                    has_male = any(c in name for c in MALE_CHARS)
                    if has_female and not has_male:
                        new_hg = "旦"
                        method_counts["name_gender"] += 1
                    elif has_male and not has_female and len(name) <= 3:
                        # Short male name - default to sheng
                        new_hg = "生"
                        method_counts["name_gender"] += 1

            if new_hg:
                node["hangdang"] = new_hg
                inferred_count += 1
                modified = True
            else:
                still_unknown += 1
                method_counts["still_unknown"] += 1

        if modified:
            updated_graphs[pid] = graph

    print(f"Total unknown: {total_unknown}")
    print(f"Inferred: {inferred_count}")
    print(f"Still unknown: {still_unknown}")
    print(f"Methods: {dict(method_counts)}")

    # Step 3: Update role_networks.json
    print("\nUpdating role_networks.json...")
    rn = read_json(PROCESSED / "role_networks.json", [])
    pid_to_graph = {g["play"]["play_id"]: g for g in updated_graphs.values()}
    updated_roles = 0

    for net in rn:
        pid = net["play_id"]
        if pid not in pid_to_graph:
            continue
        graph = pid_to_graph[pid]
        graph_nodes = {n["id"]: n for n in graph["nodes"]}

        for node in net.get("nodes", []):
            if node.get("hangdang") != "未知":
                continue
            gn = graph_nodes.get(node["name"])
            if gn and gn.get("hangdang") != "未知":
                node["hangdang"] = gn["hangdang"]
                updated_roles += 1

    write_json(PROCESSED / "role_networks.json", rn)
    print(f"Updated {updated_roles} roles in role_networks.json")

    # Step 4: Update visualization_bundle.json role_network_nodes
    print("Updating visualization_bundle.json...")
    bundle = read_json(PROCESSED / "visualization_bundle.json", {})
    bundle_nodes = bundle.get("role_network_nodes", [])
    rn_by_pid_name = {}
    for net in rn:
        for node in net.get("nodes", []):
            rn_by_pid_name[(net["play_id"], node["name"])] = node["hangdang"]

    updated_bundle = 0
    for bn in bundle_nodes:
        hg = rn_by_pid_name.get((bn.get("play_id"), bn.get("name")))
        if hg and bn.get("hangdang") == "未知" and hg != "未知":
            bn["hangdang"] = hg
            updated_bundle += 1

    write_json(PROCESSED / "visualization_bundle.json", bundle)
    print(f"Updated {updated_bundle} nodes in bundle")

    # Step 5: Rebuild enriched analysis
    print("Rebuilding enriched data...")
    import subprocess
    subprocess.run(["python", str(ROOT / "scripts" / "enrich_data.py")], check=True)

    # Step 6: Rebuild theme tree
    subprocess.run(["python", str(ROOT / "scripts" / "build_theme_tree_layout.py")], check=True)

    # Final stats
    rn = read_json(PROCESSED / "role_networks.json", [])
    hg_counts = Counter()
    for net in rn:
        for node in net.get("nodes", []):
            hg_counts[node.get("hangdang", "未知")] += 1
    print(f"\n=== Final hangdang distribution ===")
    for hg, cnt in hg_counts.most_common(30):
        pct = cnt / sum(hg_counts.values()) * 100
        print(f"  {hg}: {cnt} ({pct:.1f}%)")


if __name__ == "__main__":
    main()
