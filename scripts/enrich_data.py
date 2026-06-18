"""
Enrich existing data without running the PDF pipeline.

Builds richer feature_hangdang_matrix, role_hangdang_analysis, and P1 data
from existing role_networks.json + topic_narrative_integrated.json.
"""
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"

def read_json(path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

# Hangdang classification hierarchy
HANGDANG_GENDERS = {
    "老生": "男性", "小生": "男性", "武生": "男性", "红生": "男性", "娃娃生": "男性",
    "须生": "男性", "生": "男性",
    "青衣": "女性", "花旦": "女性", "武旦": "女性", "老旦": "女性", "彩旦": "女性",
    "闺门旦": "女性", "刀马旦": "女性", "旦": "女性",
    "铜锤花脸": "男性", "架子花脸": "男性", "武净": "男性", "净": "男性",
    "文丑": "男性", "武丑": "男性", "彩旦": "女性", "丑": "男性",
    "未知": "未知",
}

HANGDANG_AGE_GROUPS = {
    "老生": "老年", "小生": "青年", "武生": "青年", "娃娃生": "少年",
    "须生": "中老年", "生": "成年",
    "青衣": "中青年", "花旦": "青年", "武旦": "青年", "老旦": "老年",
    "闺门旦": "青年", "刀马旦": "青年", "旦": "成年",
    "净": "成年", "丑": "成年",
    "未知": "未知",
}

HANGDANG_ROLE_TYPES = {
    "老生": "正面主角", "小生": "正面主角", "武生": "正面主角", "红生": "正面主角",
    "须生": "正面主角", "生": "正面主角",
    "青衣": "正面主角", "花旦": "正面角色", "武旦": "正面角色",
    "闺门旦": "正面主角", "刀马旦": "正面角色", "旦": "正面角色",
    "净": "突出配角", "丑": "喜剧配角",
    "未知": "未知",
}


def classify_hangdang(hg):
    hg = str(hg)
    for key, val in HANGDANG_GENDERS.items():
        if key in hg:
            return val
    return "男性"  # default for most hangdang roles

def classify_age(hg):
    hg = str(hg)
    for key, val in HANGDANG_AGE_GROUPS.items():
        if key in hg:
            return val
    return "成年"

def classify_role_type(hg):
    hg = str(hg)
    for key, val in HANGDANG_ROLE_TYPES.items():
        if key in hg:
            return val
    return "配角"


def main():
    print("=== Enriching data ===")

    networks = read_json(PROCESSED / "role_networks.json", [])
    topic_narrative = read_json(PROCESSED / "topic_narrative_integrated.json", [])
    topic_by_id = {item["play_id"]: item for item in topic_narrative}

    # Build rich role table
    role_records = []
    feature_counter = Counter()
    period_counter = Counter()
    gender_hg_counter = Counter()
    age_hg_counter = Counter()
    type_hg_counter = Counter()

    for net in networks:
        pid = net["play_id"]
        title = net.get("title", "")
        topic = topic_by_id.get(pid, {})
        period = topic.get("story_period", "未知时期")
        genre = topic.get("genre", "")

        for node in net.get("nodes", []):
            hangdang = str(node.get("hangdang", "未知"))
            gender = classify_hangdang(hangdang)
            age = classify_age(hangdang)
            role_type = classify_role_type(hangdang)

            role_records.append({
                "play_id": pid,
                "title": title,
                "collection_id": node.get("collection_id"),
                "story_period": period,
                "genre": genre,
                "role": node.get("name", ""),
                "original_category": hangdang,
                "predicted_broad": hangdang,
                "predicted_fine": hangdang,
                "confidence": 0.7,
                "gender": gender,
                "age_group": age,
                "identity": [role_type],
                "personality_traits": [],
                "spoken_count": node.get("speech_count", 0),
                "aria_count": node.get("aria_count", 0),
            })

            # Counters
            feature_counter[(gender, hangdang)] += 1
            feature_counter[(age, hangdang)] += 1
            feature_counter[(role_type, hangdang)] += 1
            period_counter[(period, hangdang)] += 1
            gender_hg_counter[(gender, hangdang)] += 1
            age_hg_counter[(age, hangdang)] += 1
            type_hg_counter[(role_type, hangdang)] += 1

    # Build feature matrix
    feature_matrix = [{"feature": feature, "hangdang": hangdang, "count": count}
                      for (feature, hangdang), count in feature_counter.most_common(100)]

    # Build period trends
    period_trends = [{"period": period, "hangdang": hangdang, "count": count}
                     for (period, hangdang), count in sorted(period_counter.items())]

    # Save role_hangdang_analysis.json
    analysis = {
        "role_records": role_records,
        "feature_hangdang_matrix": feature_matrix,
        "period_hangdang_trends": period_trends,
    }
    write_json(PROCESSED / "role_hangdang_analysis.json", analysis)
    print(f"role_hangdang_analysis.json: {len(role_records)} records, {len(feature_matrix)} features, {len(period_trends)} trends")

    # Update visualization_bundle.json
    bundle = read_json(PROCESSED / "visualization_bundle.json", {})
    bundle["role_table"] = role_records
    bundle["feature_hangdang_matrix"] = feature_matrix
    bundle["period_hangdang_trends"] = period_trends
    write_json(PROCESSED / "visualization_bundle.json", bundle)
    print(f"visualization_bundle.json updated")

    # Fix visual_labels P1 with rich data
    vl = read_json(PROCESSED / "visual_labels.json", {})
    attr_to_hg = Counter()
    period_attr_to_hg = Counter()

    for net in networks:
        pid = net["play_id"]
        topic = topic_by_id.get(pid, {})
        period = topic.get("story_period", "未知时期")

        for node in net.get("nodes", []):
            hangdang = str(node.get("hangdang", "未知"))
            gender = classify_hangdang(hangdang)
            age = classify_age(hangdang)
            role_type = classify_role_type(hangdang)

            for a in [gender, age, role_type]:
                if a and a != "未知":
                    attr_to_hg[(a, hangdang)] += 2
                    period_attr_to_hg[(period, a, hangdang)] += 2

    p1 = {
        "attribute_to_hangdang": [
            {"source": s, "target": t, "value": v}
            for (s, t), v in attr_to_hg.most_common(200)
        ],
        "period_attribute_to_hangdang": [
            {"period": p, "source": s, "target": t, "value": v}
            for (p, s, t), v in period_attr_to_hg.most_common(200)
        ],
    }
    vl["views"]["p1_role_hangdang_evolution"] = p1
    write_json(PROCESSED / "visual_labels.json", vl)
    print(f"visual_labels.json P1: {len(p1['attribute_to_hangdang'])} attr, {len(p1['period_attribute_to_hangdang'])} period")

    print("\n=== Enrichment complete ===")
    print(f"Gender distribution: {dict(gender_hg_counter.most_common(5))}")
    print(f"Age distribution: {dict(age_hg_counter.most_common(5))}")


if __name__ == "__main__":
    main()
