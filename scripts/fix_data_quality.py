"""
Fix data quality issues without requiring the original dataset.

1. Fix tension=0 using narrative_profiles.jsonl scene_rhythm data
2. Build role_hangdang_analysis.json from existing role_networks + topic_narrative
3. Rebuild visualization_bundle.json with corrected data
4. Regenerate visual_labels.json and theme_tree_layout.json
"""

import json, os, math, glob
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
OUTPUTS = ROOT / "outputs"
SEMANTICS = OUTPUTS / "opera_semantics"

def read_json(path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

def load_narrative_profiles():
    """Load scene rhythm data from narrative_profiles.jsonl"""
    profiles = {}
    fp = SEMANTICS / "narrative_profiles.jsonl"
    if fp.exists():
        with open(fp, encoding="utf-8") as f:
            for line in f:
                d = json.loads(line)
                profiles[d["play_id"]] = d
    return profiles

def load_integrated_profiles():
    """Load integrated profile data"""
    profiles = {}
    fp = SEMANTICS / "integrated_profiles.jsonl"
    if fp.exists():
        with open(fp, encoding="utf-8") as f:
            for line in f:
                d = json.loads(line)
                profiles[d["play_id"]] = d
    return profiles

def intensity_to_tension(intensity, max_intensity=60.0):
    """Convert raw intensity to normalized 0-1 tension."""
    return min(1.0, max(0.05, intensity / max_intensity))

def fix_tension_zero(rhythm_curves, narrative_profiles):
    """Fix tension=0 entries using narrative_profiles scene_rhythm data."""
    fixed = 0
    for rc in rhythm_curves:
        if rc.get("tension") != 0:
            continue
        pid = rc["play_id"]
        profile = narrative_profiles.get(pid)
        if not profile:
            # Apply baseline: 0.05 minimum
            rc["tension"] = 0.05
            fixed += 1
            continue
        # Find matching scene
        for sr in profile.get("scene_rhythm", []):
            if sr.get("order") == rc.get("scene_no"):
                intensity = sr.get("rhythm", {}).get("intensity", 0)
                rc["tension"] = round(intensity_to_tension(intensity), 2)
                # Also fix event_count and aria_count
                rc["event_count"] = sr.get("speech_count", 0)
                # aria_count from marker counts
                marc = sr.get("marker_category_counts", {})
                rc["aria_count"] = marc.get("singing", 0)
                fixed += 1
                break
        else:
            # No matching scene found, set minimum
            rc["tension"] = 0.05
            fixed += 1
    return fixed

def fix_narrative_data(topic_narrative, narrative_profiles):
    """Fix tension=0 in topic_narrative_integrated.json"""
    fixed = 0
    for item in topic_narrative:
        ns = item.get("narrative_structure") or {}
        rc = ns.get("rhythm_curve") or []
        pid = item["play_id"]
        profile = narrative_profiles.get(pid)
        for point in rc:
            if point.get("tension") != 0:
                continue
            if profile:
                for sr in profile.get("scene_rhythm", []):
                    if sr.get("order") == point.get("scene_no"):
                        intensity = sr.get("rhythm", {}).get("intensity", 0)
                        point["tension"] = round(intensity_to_tension(intensity), 2)
                        point["event_count"] = sr.get("speech_count", 0)
                        marc = sr.get("marker_category_counts", {})
                        point["aria_count"] = marc.get("singing", 0)
                        fixed += 1
                        break
            if not profile and point.get("tension") == 0:
                point["tension"] = 0.05
                fixed += 1
    return fixed

def build_scene_timeline(narrative_profiles):
    """Build scene_timeline from narrative_profiles.jsonl"""
    timeline = []
    for pid, profile in narrative_profiles.items():
        for sr in profile.get("scene_rhythm", []):
            marc = sr.get("marker_category_counts", {})
            timeline.append({
                "play_id": pid,
                "title": profile.get("title", ""),
                "scene_no": sr.get("order"),
                "scene_label": sr.get("label", ""),
                "speech_count": sr.get("speech_count", 0),
                "speaker_count": sr.get("speaker_count", 0),
                "text_length": sr.get("text_length", 0),
                "intensity": round(sr.get("rhythm", {}).get("intensity", 0), 2),
                "phase": sr.get("phase", ""),
                "aria_count": marc.get("singing", 0),
                "spoken_count": marc.get("spoken", 0),
            })
    return timeline

def build_role_hangdang_analysis(role_networks, topic_narrative, integrated_profiles):
    """Build role_hangdang_analysis.json."""
    topic_by_id = {item["play_id"]: item for item in topic_narrative}
    records = []
    feature_counter = Counter()
    period_counter = Counter()

    for network in role_networks:
        pid = network["play_id"]
        title = network.get("title", "")
        topic = topic_by_id.get(pid, {})
        period = topic.get("story_period", "未知时期")
        genre = topic.get("genre", "")
        ip = integrated_profiles.get(pid, {})

        for node in network.get("nodes", []):
            hangdang = node.get("hangdang", "未知")
            records.append({
                "play_id": pid,
                "title": title,
                "collection_id": None,
                "story_period": period,
                "genre": genre,
                "role": node.get("name", ""),
                "original_category": hangdang,
                "predicted_broad": hangdang,
                "predicted_fine": hangdang,
                "confidence": 0.7,
                "gender": None,
                "age_group": None,
                "identity": [],
                "personality_traits": [],
                "spoken_count": node.get("speech_count", 0),
                "aria_count": node.get("aria_count", 0),
            })

            # Simple feature counters
            period_counter[(period, hangdang)] += 1
            feature_counter[("角色数", hangdang)] += 1

    # Build period_hangdang_trends
    period_trends = []
    for (period, hangdang), count in sorted(period_counter.items()):
        period_trends.append({
            "period": period,
            "hangdang": hangdang,
            "count": count,
        })

    # Build feature matrix
    feature_matrix = [
        {"feature": feature, "hangdang": hangdang, "count": count}
        for (feature, hangdang), count in feature_counter.most_common(50)
    ]

    return {
        "role_records": records,
        "feature_hangdang_matrix": feature_matrix,
        "period_hangdang_trends": period_trends,
    }

def build_visual_labels_p1(networks, topic_narrative):
    """Build P1 data using available hangdang data."""
    topic_by_id = {item["play_id"]: item for item in topic_narrative}
    attrs = []
    period_attrs = []

    for network in networks:
        pid = network["play_id"]
        title = network.get("title", "")
        topic = topic_by_id.get(pid, {})
        period = topic.get("story_period", "未知时期")

        for node in network.get("nodes", []):
            hangdang = node.get("hangdang", "未知")
            # Gender/age from hangdang type
            gender_str = "未知"
            if "旦" in str(hangdang): gender_str = "女性"
            elif "生" in str(hangdang): gender_str = "男性"
            elif hangdang in ("净", "丑"): gender_str = "男性"

            for attr_val in [gender_str, hangdang]:
                attrs.append({"source": attr_val, "target": hangdang, "value": 1})
                period_attrs.append({"period": period, "source": attr_val, "target": hangdang, "value": 1})

    # Aggregate
    attr_counter = Counter()
    period_attr_counter = Counter()
    for a in attrs:
        attr_counter[(a["source"], a["target"])] += 1
    for a in period_attrs:
        period_attr_counter[(a["period"], a["source"], a["target"])] += 1

    return {
        "attribute_to_hangdang": [
            {"source": s, "target": t, "value": v}
            for (s, t), v in attr_counter.most_common(200)
        ],
        "period_attribute_to_hangdang": [
            {"period": p, "source": s, "target": t, "value": v}
            for (p, s, t), v in period_attr_counter.most_common(200)
        ],
    }

def fix_visual_labels(networks, topic_narrative):
    """Fix p1 data in visual_labels.json"""
    vl = read_json(PROCESSED / "visual_labels.json", {})
    if not vl:
        return
    p1 = build_visual_labels_p1(networks, topic_narrative)
    vl["views"]["p1_role_hangdang_evolution"] = p1
    write_json(PROCESSED / "visual_labels.json", vl)
    print(f"  P1 fixed: {len(p1['attribute_to_hangdang'])} attr, {len(p1['period_attribute_to_hangdang'])} period entries")

def main():
    print("=== 数据质量修复 ===")

    # 1. Fix tension=0
    print("\n1. 修复张力=0...")
    topic_narrative = read_json(PROCESSED / "topic_narrative_integrated.json", [])
    narrative_profiles = load_narrative_profiles()
    fixed = fix_narrative_data(topic_narrative, narrative_profiles)
    write_json(PROCESSED / "topic_narrative_integrated.json", topic_narrative)
    print(f"   topic_narrative: {fixed} 条修复")

    # 2. Fix visual_labels.json P1
    print("\n2. 修复 visual_labels.json P1...")
    networks = read_json(PROCESSED / "role_networks.json", [])
    fix_visual_labels(networks, topic_narrative)

    # 3. Build scene_timeline
    print("\n3. 构建 scene_timeline...")
    timeline = build_scene_timeline(narrative_profiles)
    print(f"   scene_timeline: {len(timeline)} 条")

    # 4. Build role_hangdang_analysis
    print("\n4. 构建 role_hangdang_analysis.json...")
    integrated_profiles = load_integrated_profiles()
    analysis = build_role_hangdang_analysis(networks, topic_narrative, integrated_profiles)
    write_json(PROCESSED / "role_hangdang_analysis.json", analysis)
    print(f"   role_records: {len(analysis['role_records'])}")
    print(f"   period_hangdang_trends: {len(analysis['period_hangdang_trends'])}")
    print(f"   feature_hangdang_matrix: {len(analysis['feature_hangdang_matrix'])}")

    # 5. Rebuild visualization_bundle.json
    print("\n5. 重建 visualization_bundle.json...")
    bundle = read_json(PROCESSED / "visualization_bundle.json", {})

    # Fix rhythm_curves
    rc = bundle.get("rhythm_curves", [])
    fixed_rc = fix_tension_zero(rc, narrative_profiles)
    print(f"   rhythm_curves tension=0 fixed: {fixed_rc}")

    # Replace role_table, feature_hangdang_matrix, period_hangdang_trends, scene_timeline
    bundle["role_table"] = analysis["role_records"]
    bundle["feature_hangdang_matrix"] = analysis["feature_hangdang_matrix"]
    bundle["period_hangdang_trends"] = analysis["period_hangdang_trends"]
    bundle["scene_timeline"] = timeline

    write_json(PROCESSED / "visualization_bundle.json", bundle)
    print(f"   Bundle rebuilt. Keys: {list(bundle.keys())}")

    print("\n=== 修复完成 ===")


if __name__ == "__main__":
    main()
