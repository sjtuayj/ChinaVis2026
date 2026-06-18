# ChinaVis2026 — 京剧数据可视分析

赛题 I 方向五：角色、主题与叙事的综合可视分析。基于 ~200 部京剧剧本，构建四层递进式可视分析系统。

## 快速启动

```powershell
# 启动开发服务器
python -m http.server 5179 --bind 127.0.0.1
```

浏览器打开 `http://127.0.0.1:5179/`

### 第四层视角切换

```
http://127.0.0.1:5179/?context=theme      # 主题总图
http://127.0.0.1:5179/?context=role       # 角色关系总图
http://127.0.0.1:5179/?context=narrative  # 叙事结构总图
```

## 项目结构

```
ChinaVis2026/
├── index.html                          # 入口页面
├── src/
│   ├── main.js                         # 状态管理、数据加载、路由
│   ├── layer1.js / layer2.js / layer3.js  # 占位层
│   ├── layer4.js                       # 第四层核心（主题树/角色/叙事总图 + 角色网络 + 叙事时序图）
│   ├── style.css                       # 全局样式
│   └── assets/                         # 静态资源
├── scripts/
│   ├── pipeline/                       # 新版流水线（需要原始 PDF 数据集）
│   │   ├── run_pipeline.py             # 一键跑全流程
│   │   ├── common.py                   # 共享库（~1000 行，全部规则/解析/推断）
│   │   ├── 01_build_manifest.py        # 构建剧本清单
│   │   ├── 02_extract_pdf_text.py      # PDF 文本提取
│   │   ├── 03_parse_script_structure.py # 剧本结构解析
│   │   ├── 04_infer_role_features.py   # 角色特征推断（性别/年龄/行当）
│   │   ├── 05_build_role_networks.py   # 角色网络构建
│   │   ├── 06_extract_topics.py        # 主题提取
│   │   ├── 07_analyze_narrative.py     # 叙事分析
│   │   ├── 08_build_visualization_bundle.py # 可视化数据打包
│   │   └── 09_build_visual_labels.py   # X/Y/Z 轴标签和 P1-P5 视图
│   ├── build_overview_layouts.py       # 生成角色/叙事总图预计算布局
│   ├── build_theme_tree_layout.py      # 生成主题树预计算布局
│   ├── enrich_data.py                  # 行当特征丰富化
│   ├── fix_data_quality.py             # 数据质量修复
│   ├── infer_unknown_hangdang.py       # 未知行当推断
│   └── prepare_visual_data_from_outputs.py  # 旧版数据打包（已弃用）
├── data/processed/                     # 处理后数据
│   ├── visualization_bundle.json       # 可视化聚合数据
│   ├── visual_labels.json              # X/Y/Z 轴标签 + P1-P5 视图
│   ├── topic_narrative_integrated.json # 主题与叙事分析
│   ├── role_networks.json              # 每剧本角色网络
│   ├── role_hangdang_analysis.json     # 行当推断分析
│   ├── theme_tree_layout.json          # 主题树预计算布局
│   ├── role_overview_layout.json       # 角色总图预计算布局
│   ├── narrative_overview_layout.json  # 叙事总图预计算布局
│   ├── corpus_manifest.json            # 剧本清单
│   └── collections.json                # 集合信息
└── outputs/                            # 旧版流水线输出
    ├── opera_analysis/graphs/          # 单剧本图数据
    └── opera_semantics/                # 语义分析结果
```

## 数据流程

### 使用现有数据（推荐）

数据已预处理好，直接启动服务器即可。

### 从原始 PDF 重建数据

```powershell
# 1. 解压数据集 ZIP 到 1-I_opera_dataset/extracted/
# 2. 跑完整流水线
python scripts/pipeline/run_pipeline.py --force

# 3. 生成标签
python scripts/pipeline/09_build_visual_labels.py

# 4. 生成布局
python scripts/build_theme_tree_layout.py
python scripts/build_overview_layouts.py

# 5. 丰富特征（如果行当"未知"较多）
python scripts/enrich_data.py
python scripts/infer_unknown_hangdang.py
```

## 可视化架构

系统采用四层递进式设计：

| 层 | 文件 | 功能 |
|----|------|------|
| 1 — 首页 | `layer1.js` | 占位 |
| 2 — 总览 | `layer2.js` | 占位 |
| 3 — 单元格 | `layer3.js` | 占位 |
| 4 — 单剧本详情 | `layer4.js` | **完整实现** |

### 第四层三个上下文视图

左上角 SVG（900×900）展示三种视角的径向聚类总图：

- **主题树**：9 个一级分支 → 228 个二级分支 → 1473 叶子
- **角色总图**：5 种关系类型 → 内环（子节点）→ 外环（叶子）
- **叙事总图**：5 种叙事模式 → 内环（子节点）→ 外环（叶子）

交互：点击叶子节点选中/取消剧本（最多 4 个），悬停显示 tooltip。

### 角色网络面板（右上角）

- 力导向图，按连通分量分簇布局
- 最大 4 个面板并列对比
- 点击标题进入单剧本缩放模式（带书签切换）
- 拖拽节点 + 滚轮缩放
- 悬停高亮相连边 + 邻居节点

### 叙事时序图（底部）

- 多线图对比不同剧本的张力曲线
- 起承转合四阶段背景色带
- 面积渐变填充
- 悬停数据点显示 tooltip

## 技术栈

- **前端**: D3.js v7 (CDN), ES Modules, 原生 JS
- **数据处理**: Python (pypdf, openpyxl)
- **数据格式**: JSON (UTF-8)
