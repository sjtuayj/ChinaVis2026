"""Infer broad hangdang labels for roles currently marked as "其他".

The visual Sankey should not let a large generic "其他" bucket dominate when
other plays provide enough evidence for the same or similar role name.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"

OTHER_VALUES = {"其他", "未知", "", None}


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def current_hangdang(record: dict[str, Any]) -> str:
    return record.get("predicted_fine") or record.get("predicted_broad") or record.get("original_category") or ""


def is_other(value: str | None) -> bool:
    return value in OTHER_VALUES


def normalize_name(name: str) -> str:
    text = re.sub(r"\s+", "", str(name or ""))
    text = re.sub(r"^[一二三四五六七八九十两甲乙丙丁戊己庚辛壬癸]+", "", text)
    text = re.sub(r"^[大小老众诸群]", "", text)
    text = re.sub(r"[甲乙丙丁戊己庚辛壬癸]$", "", text)
    return text


def build_name_lookup(records: list[dict[str, Any]]) -> tuple[dict[str, str], dict[str, str]]:
    exact: defaultdict[str, Counter[str]] = defaultdict(Counter)
    normalized: defaultdict[str, Counter[str]] = defaultdict(Counter)

    for record in records:
        hangdang = current_hangdang(record)
        if is_other(hangdang):
            continue
        role = str(record.get("role") or "")
        if not role:
            continue
        exact[role][hangdang] += 1
        key = normalize_name(role)
        if len(key) >= 2:
            normalized[key][hangdang] += 1

    def confident(counter: Counter[str], min_count: int) -> str | None:
        if not counter or counter.total() < min_count:
            return None
        top, count = counter.most_common(1)[0]
        if count / counter.total() < 0.58:
            return None
        return top

    exact_map = {name: value for name, counter in exact.items() if (value := confident(counter, 1))}
    normalized_map = {name: value for name, counter in normalized.items() if (value := confident(counter, 2))}
    return exact_map, normalized_map


def rule_infer(record: dict[str, Any]) -> str | None:
    role = str(record.get("role") or "")
    text = f"{role} {record.get('title') or ''}"

    known_roles: dict[str, str] = {
        # Three Kingdoms / historical officials and strategists
        "乐进": "净",
        "廖化": "老生",
        "马良": "老生",
        "糜竺": "老生",
        "麋芳": "老生",
        "伊籍": "老生",
        "曹参": "老生",
        "郭淮": "净",
        "荀彧": "老生",
        "李儒": "老生",
        "李肃": "老生",
        "费诗": "老生",
        "朱灵": "净",
        "陈震": "老生",
        "卫瓘": "老生",
        "袁术": "净",
        "曹真": "净",
        "高顺": "净",
        "伏完": "老生",
        "华歆": "老生",
        "马遵": "老生",
        "赵咨": "老生",
        "韩浩": "净",
        # Song/Yang-family and martial supporting roles
        "何元庆": "净",
        "张龙": "净",
        "施全": "净",
        "狄雷": "净",
        "韩德": "净",
        "耶律休哥": "净",
        "萧天佑": "净",
        # Warring States / Qin-Han figures
        "田忌": "老生",
        "毛遂": "老生",
        "散宜生": "老生",
        "蒙敖": "净",
        "蒙鳌": "净",
        "骑劫": "净",
        "灌婴": "净",
        "田文": "老生",
        # Mythic and female roles
        "杨戬": "武生",
        "太上老君": "老生",
        "老君": "老生",
        "雷祖": "净",
        "杀神": "净",
        "韦陀": "净",
        "巨灵神": "净",
        "赵天君": "净",
        "紫鹃": "旦",
        "彩屏": "旦",
        "汪彩霞": "旦",
        "雪雁": "旦",
        "小桃": "旦",
        "窦仙童": "旦",
        "程金定": "旦",
        "藩梨花": "旦",
        # Frequent martial or outlaw supporting roles
        "齐国远": "净",
        "周德胜": "净",
        "郝武": "净",
        "郑天寿": "净",
        "朱龙": "净",
        "巴豹": "净",
        "薛霸": "净",
        "晁盖": "净",
        "凌统": "净",
        "孙坚": "净",
        "张奎": "净",
        "张猛": "净",
        "童威": "净",
        "郝思文": "净",
        "俞通海": "净",
        "白猿": "武生",
        # Literati / civil officials
        "张著": "老生",
        "路昭": "老生",
        "郭起凤": "老生",
        "苏从": "老生",
        "孙秀": "老生",
        "李茂": "老生",
        "郤正": "老生",
        "卜商": "老生",
        "法正": "老生",
        "陈登": "老生",
        "虞翻": "老生",
        "刘晔": "老生",
        "陆贾": "老生",
        "谯周": "老生",
        "邹忌": "老生",
    }
    if role in known_roles:
        return known_roles[role]

    rules: list[tuple[str, str]] = [
        ("杂", r"龙套|文堂|大铠|下手|庄丁|庄客|游人|乡邻|邻人|教师|厨|厨房|海巡|水族|众人|众|群众|百姓|乡民|家丁|家人|家院|院子|仆|仆人|奴|丫鬟|丫环|随从|从人|轿夫|船夫|车夫|脚夫|和尚|僧|沙弥|道士|小妖|妖"),
        ("丑", r"差役|衙役|皂隶|门子|报子|报录|探子|更夫|酒保|店小二|小二|太监|内侍|大监|院公|堂役|差头|仵作|小四|李四|阿金|牛二|长班"),
        ("娃娃生", r"童儿|书童|小童|孩儿|小孩|娃"),
        ("武生", r"武生|英雄|好汉|义士|侠|武松|林冲|鲁智深|赵云|马超|小将|少将"),
        ("净", r"净|将军|大将|元帅|先锋|都督|校尉|小校|旗牌|兵|军士|卫士|喽啰|马童|中军|头目|番|水卒|刀手|弓箭手|捕手|大刀手|功曹|值殿|天君|太保|府君|神|张飞|关羽|项羽|包拯|包公"),
        ("老生", r"老爷|老汉|老丈|老者|老仙|先生|大夫|父|伯|叔|公|翁|叟|臣|官|相|知府|县令|县官|太守|寇准|诸葛亮|刘备|曹操|孙权|嘉靖"),
        ("小生", r"公子|书生|秀才|状元|郎|少爷|青年|小生|徐甲"),
        ("老旦", r"老夫人|太君|母|婆|奶奶|老妇|老旦"),
        ("旦", r"夫人|娘娘|小姐|姑娘|娘子|妻|嫂|姐|妹|女|妃|后|姬|婢|丫头|妞|梨花|仙童|金定|小桃|霞|娟|屏|彩|潘金莲|林黛玉|王熙凤|李香君|虞姬"),
    ]

    for hangdang, pattern in rules:
        if re.search(pattern, text):
            return hangdang
    return None


def infer_records(records: list[dict[str, Any]]) -> Counter[str]:
    exact_map, normalized_map = build_name_lookup(records)
    methods: Counter[str] = Counter()

    for record in records:
        if not is_other(current_hangdang(record)):
            continue
        role = str(record.get("role") or "")
        inferred = None
        method = ""

        if role in exact_map:
            inferred = exact_map[role]
            method = "cross_play_exact"
        else:
            key = normalize_name(role)
            if key in normalized_map:
                inferred = normalized_map[key]
                method = "cross_play_similar"
            else:
                inferred = rule_infer(record)
                method = "role_name_rule" if inferred else ""

        if inferred and not is_other(inferred):
            record["predicted_broad"] = inferred
            record["predicted_fine"] = inferred
            record["hangdang_inferred_from_other"] = method
            methods[method] += 1
        else:
            methods["still_other"] += 1

    return methods


def sync_bundle_role_table(bundle: dict[str, Any], records: list[dict[str, Any]]) -> None:
    lookup = {(item.get("play_id"), item.get("role")): item for item in records}
    updated = []
    for item in bundle.get("role_table", []):
        source = lookup.get((item.get("play_id"), item.get("role")))
        if source:
            item.update({
                "predicted_broad": source.get("predicted_broad"),
                "predicted_fine": source.get("predicted_fine"),
                "hangdang_inferred_from_other": source.get("hangdang_inferred_from_other"),
            })
        updated.append(item)
    bundle["role_table"] = updated

    for item in bundle.get("role_network_nodes", []):
        source = lookup.get((item.get("play_id"), item.get("name")))
        if source and not is_other(source.get("predicted_fine")):
            item["hangdang"] = source.get("predicted_fine")
            item["hangdang_inferred_from_other"] = source.get("hangdang_inferred_from_other")


def sync_role_networks(records: list[dict[str, Any]]) -> None:
    path = PROCESSED / "role_networks.json"
    networks = read_json(path, [])
    lookup = {(item.get("play_id"), item.get("role")): item for item in records}
    for network in networks:
        play_id = network.get("play_id")
        for node in network.get("nodes", []):
            source = lookup.get((play_id, node.get("name")))
            if source and not is_other(source.get("predicted_fine")):
                node["hangdang"] = source.get("predicted_fine")
                node["hangdang_inferred_from_other"] = source.get("hangdang_inferred_from_other")
    write_json(path, networks)


def main() -> None:
    analysis_path = PROCESSED / "role_hangdang_analysis.json"
    bundle_path = PROCESSED / "visualization_bundle.json"

    analysis = read_json(analysis_path, {})
    records = analysis.get("role_records", [])
    before = Counter(current_hangdang(item) for item in records)
    methods = infer_records(records)
    after = Counter(current_hangdang(item) for item in records)

    write_json(analysis_path, analysis)

    bundle = read_json(bundle_path, {})
    sync_role_networks(records)
    sync_bundle_role_table(bundle, records)
    write_json(bundle_path, bundle)

    print("=== Infer other hangdang ===")
    print(f"before other: {before.get('其他', 0)}")
    print(f"after other: {after.get('其他', 0)}")
    print(f"methods: {dict(methods)}")
    print("top after:")
    for label, count in after.most_common(20):
      print(f"  {label}: {count}")


if __name__ == "__main__":
    main()
