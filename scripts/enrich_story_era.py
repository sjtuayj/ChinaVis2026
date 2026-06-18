from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
PLAYS_DIR = PROCESSED / "plays"


ERA_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("上古神话", re.compile(r"黄帝|蚩尤|尧帝|舜帝|许由|巢父|祝融|雷公|洗耳记|战蚩尤")),
    ("春秋战国", re.compile(r"周幽王|褒姒|犬戎|伍员|伍子胥|专诸|要离|庆忌|荆轲|太子丹|秦王|田单|齐湣王|乐毅|孙膑|庞涓|廉颇|蔺相如|豫让|信陵|赵氏孤儿|颖考叔|郑庄公|伐子都|鱼肠剑|文昭关|黄金台|刺王僚|将相和|焚烟墩|搜孤救孤")),
    ("秦汉", re.compile(r"秦始皇|秦二世|胡亥|赵高|项羽|刘邦|韩信|萧何|樊哙|虞姬|霸王|鸿门|王莽|刘秀|汉武帝|苏武|李陵|昭君|蔡伯喈|赵五娘|朱买臣|博浪锥|宇宙锋|草桥关|苏武牧羊|牧羊记|琵琶记|扫松下书|马前泼水")),
    ("三国", re.compile(r"汉末|三国|诸葛亮|刘备|关羽|张飞|曹操|孙权|周瑜|赵云|姜维|司马懿|司马昭|吕布|貂蝉|黄忠|马超|魏延|鲁肃|荀彧|程昱|许褚|颜良|文丑|马谡|祢衡|黄祖|刘表|刘璋|张鲁|华容道|空城计|群英会|定军山|白门楼|战北原|天水关|七星灯|黄鹤楼|柴桑口|捉放曹|打鼓骂曹|击鼓骂曹|骂王朗|春闺梦")),
    ("魏晋南北朝", re.compile(r"晋代|石勒|邓伯道|周处|王浚|桑园寄子|除三害")),
    ("隋唐", re.compile(r"隋|唐|五代|周朝|李世民|秦琼|尉迟|程咬金|罗成|单雄信|薛仁贵|薛丁山|薛平贵|樊梨花|武则天|唐德宗|卢杞|陈杏元|李克用|李嗣源|杨国真|雷万春|马嵬驿|天宝|高力士|汾河湾|打金枝|沙陀国|八大锤|罗成|摩天岭|破洪州|虹霓关|双尽忠|破华州|珠帘寨|落花园|刀劈三关")),
    ("宋元", re.compile(r"北宋|南宋|宋|元代|杨延昭|杨宗保|佘太君|孟良|焦赞|包拯|包公|赵德芳|赵匡胤|岳飞|秦桧|韩世忠|梁山|宋江|武松|林冲|鲁智深|金兀术|萧恩|苏东坡|王十朋|蔡襄|临安|杨家将|洪羊洞|铡美案|乌盆计|乌盆记|探阴山|打龙袍|辕门斩子|风波亭|连环套|洛阳桥|荆钗记|玉簪记|狮吼记|打渔杀家")),
    ("元末明初", re.compile(r"元末|朱元璋|红巾军|徐达|取金陵")),
    ("明清", re.compile(r"明代|清代|明|清|朱元璋|刘伯温|海瑞|严嵩|崇祯|施世纶|黄天霸|侯方域|李香君|阮大铖|陆游|唐婉|红楼|贾宝玉|林黛玉|王熙凤|尤二姐|杜十娘|玉堂春|苏三|十三妹|殷家堡|女起解|桃花扇|钗头凤|一捧雪|祭雪艳")),
    ("神话传说", re.compile(r"月宫|鬼府|阴阳|阎罗|龙宫|哪吒|杨戬|沉香|三圣母|白蛇|许仙|观音|目莲|嫦娥|南斗|北斗|仙|神|妖|鬼|魂|阴山|宝莲灯|滑油山|目莲救母|赵颜借寿|骂阎罗|阴阳河|洛阳桥·下海")),
    ("民间世情", re.compile(r"商人|士人|相公|县衙|县官|知县|妓女|妻妾|争风|皮匠|鞋铺|花鼓|打面缸|打樱桃|双摇会|十八扯|张古董借妻|一匹布|皮匠杀妻|通天犀|张古董|风尘|讨花红|狎邪")),
]


def read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def valid_label(label: str | None) -> bool:
    return bool(label and label not in {"未知", "未知时期", "时代未识别"} and not re.fullmatch(r"\d+", str(label)))


def infer_era(title: str, plot: str, roles: list[dict[str, Any]]) -> tuple[str, str]:
    text = f"{title} {plot} {' '.join(str(role.get('name', '')) for role in roles[:40])}"
    for label, pattern in ERA_RULES:
        if pattern.search(text):
            return label, "keyword"
    return "民间世情", "fallback"


def build_play_era_lookup() -> dict[str, dict[str, str]]:
    lookup: dict[str, dict[str, str]] = {}
    for path in PLAYS_DIR.glob("*.json"):
        data = read_json(path, {})
        play = data.get("play", {})
        play_id = play.get("play_id") or path.stem
        title = play.get("title") or ""
        metadata = data.get("metadata", {})
        story_period = metadata.get("story_period", {})
        label = story_period.get("label") if isinstance(story_period, dict) else story_period
        if valid_label(label):
            era = str(label)
            source = "metadata"
        else:
            era, source = infer_era(title, metadata.get("plot_summary", ""), data.get("roles", []))
        lookup[play_id] = {"story_era": era, "story_era_source": source}
    return lookup


def update_visualization_bundle(lookup: dict[str, dict[str, str]]) -> None:
    path = PROCESSED / "visualization_bundle.json"
    bundle = read_json(path, {})
    for table_name in ("play_table", "role_table", "role_network_nodes", "role_network_edges", "theme_role_links", "narrative_stage_table", "rhythm_curves", "integrated_patterns"):
        rows = bundle.get(table_name, [])
        if not isinstance(rows, list):
            continue
        for row in rows:
            info = lookup.get(row.get("play_id"))
            if info:
                row.update(info)
    write_json(path, bundle)


def update_topic_narrative(lookup: dict[str, dict[str, str]]) -> None:
    path = PROCESSED / "topic_narrative_integrated.json"
    rows = read_json(path, [])
    if not isinstance(rows, list):
        return
    for row in rows:
        info = lookup.get(row.get("play_id"))
        if info:
            row.update(info)
    write_json(path, rows)


def update_role_hangdang_analysis(lookup: dict[str, dict[str, str]]) -> None:
    path = PROCESSED / "role_hangdang_analysis.json"
    data = read_json(path, {})
    rows = data.get("role_records", [])
    if isinstance(rows, list):
        for row in rows:
            info = lookup.get(row.get("play_id"))
            if info:
                row.update(info)
    write_json(path, data)


def write_summary(lookup: dict[str, dict[str, str]]) -> None:
    rows = [{"play_id": play_id, **info} for play_id, info in sorted(lookup.items())]
    counts = Counter(row["story_era"] for row in rows)
    sources = Counter(row["story_era_source"] for row in rows)
    write_json(PROCESSED / "story_era_lookup.json", {"rows": rows, "counts": dict(counts), "sources": dict(sources)})
    print("story era counts:")
    for label, count in counts.most_common():
        print(f"  {label}: {count}")
    print("sources:", dict(sources))


def main() -> None:
    lookup = build_play_era_lookup()
    update_visualization_bundle(lookup)
    update_topic_narrative(lookup)
    update_role_hangdang_analysis(lookup)
    write_summary(lookup)


if __name__ == "__main__":
    main()
