import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const ROOT = "D:/desktopSimu/Chinavis2026/汇报及答辩/答辩";
const WORKSPACE = `${ROOT}/outputs/ppt-answer-defense`;
const STARTER = `${WORKSPACE}/template-starter.pptx`;
const OUT = process.env.DEFENSE_PPTX_OUT || `${ROOT}/戏韵万象-京剧数据可视分析答辩.pptx`;
const IMG = `${ROOT}/报告汇总/images`;

function slidesFromPresentation(presentation) {
  if (Array.isArray(presentation.slides?.items)) return presentation.slides.items;
  return Array.from({ length: presentation.slides.count }, (_, index) => presentation.slides.getItem(index));
}

function byId(slide, id) {
  return slide.shapes.items.find((shape) => String(shape.id) === String(id));
}

function setText(shape, text) {
  if (!shape) return;
  if (shape.text?.set) shape.text.set(text);
  else shape.text = text;
}

function setFrame(element, frame) {
  if (!element) return;
  element.position = frame;
}

function addTopBarTitle(slide, title, index) {
  const isCover = index === 1;
  const shape = slide.shapes.add({
    geometry: "rect",
    name: `top-section-title-${index}`,
    position: isCover
      ? { left: 330, top: 38, width: 360, height: 32 }
      : { left: 92, top: 24, width: 760, height: 42 },
    fill: "#00000000",
    line: { style: "solid", fill: "#00000000", width: 0 },
  });
  shape.text = title;
  shape.text.fontSize = isCover ? 19 : 22;
  shape.text.bold = true;
  shape.text.color = "#ffffff";
  shape.text.typeface = "Microsoft YaHei";
  shape.text.alignment = "left";
  shape.text.verticalAlignment = "middle";
  shape.text.insets = { left: 0, right: 0, top: 0, bottom: 0 };
  return shape;
}

async function replaceImage(image, imagePath, fit = "contain") {
  if (!image) return;
  if (String(imagePath).startsWith("data:")) {
    image.replace({ dataUrl: imagePath, fit, alt: "diagram" });
    return;
  }
  const bytes = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  image.replace({ dataUrl, fit, alt: path.basename(imagePath) });
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function flowSvg(title, steps) {
  const w = 900;
  const h = 520;
  const stepW = 148;
  const gap = 28;
  const startX = 42;
  const y = 190;
  const boxes = steps.map((step, i) => {
    const x = startX + i * (stepW + gap);
    const lines = step.label.split("\n");
    const text = lines.map((line, j) => `<text x="${x + stepW / 2}" y="${y + 70 + j * 23}" text-anchor="middle" font-size="20" font-family="Microsoft YaHei" fill="#ffffff">${escapeXml(line)}</text>`).join("");
    const arrow = i < steps.length - 1
      ? `<path d="M ${x + stepW + 9} ${y + 82} L ${x + stepW + gap - 10} ${y + 82}" stroke="#8c1d22" stroke-width="5" stroke-linecap="round"/><path d="M ${x + stepW + gap - 10} ${y + 82} l -14 -10 v 20 z" fill="#8c1d22"/>`
      : "";
    return `<rect x="${x}" y="${y}" width="${stepW}" height="164" rx="18" fill="${step.fill}" stroke="#8c1d22" stroke-width="2.5"/>${text}${arrow}`;
  }).join("");
  return svgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#fffaf7"/>
    <text x="42" y="72" font-size="38" font-weight="700" font-family="Microsoft YaHei" fill="#7e151a">${escapeXml(title)}</text>
    <text x="42" y="116" font-size="22" font-family="Microsoft YaHei" fill="#4b3b3b">从原始剧本到交互式可视分析系统的数据链路</text>
    ${boxes}
  </svg>`);
}

function demoSvg() {
  const items = [
    ["三维总览", "发现组合空间"],
    ["组合筛选", "定位典型模式"],
    ["单剧本详情", "查看角色网络"],
    ["多剧本对比", "比较叙事曲线"],
  ];
  const nodes = items.map(([a, b], i) => {
    const x = 72 + i * 210;
    const arrow = i < items.length - 1 ? `<path d="M ${x + 138} 134 L ${x + 197} 134" stroke="#8c1d22" stroke-width="5" stroke-linecap="round"/><path d="M ${x + 197} 134 l -13 -9 v 18 z" fill="#8c1d22"/>` : "";
    return `<circle cx="${x}" cy="134" r="48" fill="#8c1d22"/><text x="${x}" y="128" text-anchor="middle" font-size="19" font-weight="700" font-family="Microsoft YaHei" fill="#fff">${a}</text><text x="${x}" y="158" text-anchor="middle" font-size="17" font-family="Microsoft YaHei" fill="#fff">${b}</text>${arrow}`;
  }).join("");
  return svgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="900" height="390" viewBox="0 0 900 390">
    <rect width="900" height="390" rx="16" fill="#fffaf7"/>
    <text x="48" y="62" font-size="34" font-weight="700" font-family="Microsoft YaHei" fill="#7e151a">答辩演示路径</text>
    ${nodes}
    <text x="48" y="282" font-size="23" font-family="Microsoft YaHei" fill="#3d3030">示例：从《空城计》进入角色关系视角，再加入《三娘教子》进行网络与叙事曲线对比。</text>
  </svg>`);
}

function interactionSvg() {
  const items = [
    ["点击选择", "点击节点选中或取消剧本\n进入对应组合与详情"],
    ["多剧对比", "最多 4 个剧本并列\n支持跨剧本比较"],
    ["悬停提示", "悬停展示剧名、主题\n关系类型和张力值"],
    ["视角切换", "主题、角色关系、叙事结构\n三类上下文自由切换"],
    ["拖拽缩放", "角色网络支持拖拽、缩放\n和邻居高亮"],
  ];
  const cards = items.map(([title, body], i) => {
    const x = 34 + i * 210;
    const bodyLines = body.split("\n").map((line, j) =>
      `<text x="${x + 90}" y="${232 + j * 25}" text-anchor="middle" font-size="16" font-family="Microsoft YaHei" fill="#5d5555">${escapeXml(line)}</text>`
    ).join("");
    return `
      <rect x="${x}" y="98" width="180" height="235" rx="16" fill="#fff" stroke="#b51f35" stroke-width="2"/>
      <circle cx="${x + 90}" cy="151" r="34" fill="#b51f35"/>
      <text x="${x + 90}" y="163" text-anchor="middle" font-size="30" font-weight="700" font-family="Microsoft YaHei" fill="#fff">${i + 1}</text>
      <text x="${x + 90}" y="204" text-anchor="middle" font-size="22" font-weight="700" font-family="Microsoft YaHei" fill="#8c1d22">${escapeXml(title)}</text>
      ${bodyLines}
    `;
  }).join("");
  return svgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1100" height="430" viewBox="0 0 1100 430">
    <rect width="1100" height="430" fill="#ffffff"/>
    <text x="34" y="54" font-size="34" font-weight="700" font-family="Microsoft YaHei" fill="#7e151a">网站交互机制</text>
    <text x="34" y="86" font-size="20" font-family="Microsoft YaHei" fill="#6c6262">围绕“选择、比较、解释、切换、细看”支持完整分析路径</text>
    ${cards}
  </svg>`);
}

async function addImageInFrame(slide, dataUrl, frame, alt) {
  const image = slide.images.add({ dataUrl, fit: "contain", alt, position: frame });
  return image;
}

async function imageDataUrl(imagePath) {
  const bytes = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function addImagePath(slide, imagePath, frame, fit = "contain") {
  return slide.images.add({
    dataUrl: await imageDataUrl(imagePath),
    fit,
    alt: path.basename(imagePath),
    position: frame,
  });
}

function clearSlideImages(slide) {
  while (slide.images.items.length) slide.images.items[0].delete();
}

const presentation = await PresentationFile.importPptx(await FileBlob.load(STARTER));
const slides = slidesFromPresentation(presentation);

[
  "项目封面",
  "汇报目录",
  "第一部分 任务背景与数据",
  "第一部分 任务背景与数据",
  "第二部分 网站系统与交互",
  "第二部分 网站系统与交互",
  "第二部分 网站系统与交互",
  "第二部分 网站系统与交互",
  "第三部分 五问分析结论",
  "第三部分 五问分析结论",
  "第三部分 五问分析结论",
  "第三部分 五问分析结论",
  "第三部分 五问分析结论",
  "第四部分 综合案例对比",
  "第五部分 技术实现与分工",
].forEach((title, index) => addTopBarTitle(slides[index], title, index + 1));

// 1. Cover
setText(byId(slides[0], 7), "戏韵万象\n京剧数据可视分析");
setText(byId(slides[0], 14), "ChinaVis 2026 任务一｜数据可视化与可视分析课程设计\n作品网站：https://lzy-1021.github.io/ChinaVis2026/");

// 2. Agenda
[
  [7, "第一部分 任务背景与数据"],
  [5, "第二部分 网站系统与交互"],
  [9, "第三部分 五问分析结论"],
  [3, "第四部分 综合案例对比"],
  [14, "第五部分 技术实现与分工"],
].forEach(([id, text]) => setText(byId(slides[1], id), text));

// 3. Challenge questions
setText(byId(slides[2], 7), "01-角色行当推断");
setText(byId(slides[2], 6), "依据性别、年龄、身份与唱念做打提示，补全未标注行当并比较不同时期的对应规律。");
setText(byId(slides[2], 5), "02-角色关系网络");
setText(byId(slides[2], 4), "把角色视为节点，把同场共现、连续对白和强互动视为边，比较历史戏、家庭戏、公案戏的组织方式。");
setText(byId(slides[2], 9), "03-主题与叙事结构");
setText(byId(slides[2], 8), "从剧情、身份、场景和关键词中提取主题，并依据场次、对白密度和张力曲线识别叙事模式。");
setText(byId(slides[2], 3), "04-综合关联分析");
setText(byId(slides[2], 2), "在“主题-角色关系-叙事结构”三维空间中分析三者如何协同形成稳定的戏剧结构。");

// 4. Data pipeline
setText(byId(slides[3], 14), "数据处理与分析流程");
setText(byId(slides[3], 15), "项目以 1473 部京剧剧本为分析对象，先完成 PDF 文本抽取和剧本结构解析，再生成角色表、关系网络、主题标签、叙事节奏曲线，最终打包为网站使用的 JSON 数据。");
if (slides[3].charts.items[0]) {
  const frame = slides[3].charts.items[0].frame;
  slides[3].charts.deleteById(slides[3].charts.items[0].id);
  await addImageInFrame(slides[3], flowSvg("数据流水线", [
    { label: "PDF\n剧本", fill: "#9f2d33" },
    { label: "文本\n解析", fill: "#b64a39" },
    { label: "角色/主题\n叙事分析", fill: "#c9893f" },
    { label: "JSON\n打包", fill: "#6b7f66" },
    { label: "D3 网站\n可视分析", fill: "#386a75" },
  ]), frame, "数据处理流程图");
}

// 5. Website architecture
setText(byId(slides[4], 2), "网站整体架构：总览-筛选-聚焦-对比");
await replaceImage(slides[4].images.items[0], `${IMG}/图1-三维综合总览.png`, "contain");
setFrame(slides[4].images.items[0], { left: 88, top: 244, width: 1090, height: 388 });

// 6. View forms
setText(byId(slides[5], 8), "网站提供四类互补视图：三维综合空间用于发现组合模式；径向总览树用于在主题、角色关系、叙事结构中切换上下文；角色关系网络展示人物互动；叙事时序曲线比较剧情张力。");
setText(byId(slides[5], 12), "视图");
setText(byId(slides[5], 2), "三\n维");
await replaceImage(slides[5].images.items[0], `${IMG}/01-overview-cube.png`, "cover");
await replaceImage(slides[5].images.items[1], `${IMG}/04-kongchengji-role-detail.png`, "cover");
await replaceImage(slides[5].images.items[0], `${IMG}/01-overview-cube.png`, "contain");
await replaceImage(slides[5].images.items[1], `${IMG}/04-kongchengji-role-detail.png`, "contain");
setFrame(slides[5].images.items[0], { left: 78, top: 124, width: 515, height: 225 });
setFrame(slides[5].images.items[1], { left: 78, top: 370, width: 515, height: 225 });
setFrame(byId(slides[5], 8), { left: 655, top: 130, width: 535, height: 390 });
setText(byId(slides[5], 12), "");
setText(byId(slides[5], 2), "");

// 7. Interactions
[
  [23, "点击选择"],
  [25, "多剧对比"],
  [26, "悬停提示"],
  [28, "视角切换"],
  [30, "拖拽缩放"],
  [39, "点击节点选中或取消剧本，进入对应组合与详情。"],
  [40, "最多 4 个剧本并列，支持跨剧本比较。"],
  [41, "悬停展示剧名、主题、关系类型和张力值。"],
  [42, "主题、角色关系、叙事结构三类上下文自由切换。"],
  [43, "角色网络支持节点拖拽、滚轮缩放和邻居高亮。"],
].forEach(([id, text]) => setText(byId(slides[6], id), text));
const interactionImgs = ["01-overview-cube.png", "02-role-relation-overview.png", "03-narrative-overview.png", "04-kongchengji-role-detail.png", "空城计&三娘教子.png"];
for (let i = 0; i < slides[6].images.items.length; i++) {
  await replaceImage(slides[6].images.items[i], `${IMG}/${interactionImgs[i]}`, "cover");
  slides[6].images.items[i].delete();
}
while (slides[6].images.items.length) slides[6].images.items[0].delete();
for (const shape of slides[6].shapes.items) {
  if (String(shape.text || "").trim()) setText(shape, "");
}
await addImageInFrame(slides[6], interactionSvg(), { left: 92, top: 130, width: 1096, height: 440 }, "网站交互机制");

// 8. Demo path
await replaceImage(slides[7].images.items[0], svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="390" viewBox="0 0 900 390">
  <rect width="900" height="390" rx="16" fill="#fffaf7"/>
  <text x="48" y="62" font-size="34" font-weight="700" font-family="Microsoft YaHei" fill="#7e151a">答辩演示路径</text>
  <circle cx="90" cy="150" r="48" fill="#8c1d22"/><text x="90" y="145" text-anchor="middle" font-size="20" font-family="Microsoft YaHei" fill="#fff">总览</text><text x="90" y="170" text-anchor="middle" font-size="16" font-family="Microsoft YaHei" fill="#fff">组合空间</text>
  <path d="M145 150 L245 150" stroke="#8c1d22" stroke-width="5"/><path d="M245 150 l -13 -9 v 18 z" fill="#8c1d22"/>
  <circle cx="305" cy="150" r="48" fill="#b64a39"/><text x="305" y="145" text-anchor="middle" font-size="20" font-family="Microsoft YaHei" fill="#fff">筛选</text><text x="305" y="170" text-anchor="middle" font-size="16" font-family="Microsoft YaHei" fill="#fff">空城计</text>
  <path d="M360 150 L460 150" stroke="#8c1d22" stroke-width="5"/><path d="M460 150 l -13 -9 v 18 z" fill="#8c1d22"/>
  <circle cx="520" cy="150" r="48" fill="#386a75"/><text x="520" y="145" text-anchor="middle" font-size="20" font-family="Microsoft YaHei" fill="#fff">切换</text><text x="520" y="170" text-anchor="middle" font-size="16" font-family="Microsoft YaHei" fill="#fff">角色视角</text>
  <path d="M575 150 L675 150" stroke="#8c1d22" stroke-width="5"/><path d="M675 150 l -13 -9 v 18 z" fill="#8c1d22"/>
  <circle cx="735" cy="150" r="48" fill="#6b7f66"/><text x="735" y="145" text-anchor="middle" font-size="20" font-family="Microsoft YaHei" fill="#fff">对比</text><text x="735" y="170" text-anchor="middle" font-size="16" font-family="Microsoft YaHei" fill="#fff">叙事曲线</text>
  <text x="54" y="282" font-size="23" font-family="Microsoft YaHei" fill="#3d3030">从全局组合进入单剧本，再加入《三娘教子》形成角色网络与叙事节奏的对照。</text>
</svg>`), "contain");
setText(byId(slides[7], 8), "01 从三维总览进入组合");
setText(byId(slides[7], 9), "选择“主题-角色关系-叙事结构”的典型组合，定位具体剧本。");
setText(byId(slides[7], 12), "02 切换上下文视角");
setText(byId(slides[7], 13), "在主题、角色关系、叙事结构之间切换，观察同一剧本的多维位置。");
setText(byId(slides[7], 17), "03 多剧本联动对比");
setText(byId(slides[7], 18), "加入对照剧本，同时比较角色网络和叙事张力曲线。");

// 9-13. Analysis slides
setText(byId(slides[8], 33), "问题一：角色行当推断");
setText(byId(slides[8], 34), "1473 部剧本形成 21620 条角色记录。主要行当为净 3986、丑 3370、旦 2588、老生 2489、生 2234。老生多承载智慧与道德判断，净表现权力和对抗，丑承担传信和喜剧调节。");
await replaceImage(slides[8].images.items[0], `${IMG}/image-1.png`, "contain");
setFrame(slides[8].images.items[0], { left: 78, top: 130, width: 615, height: 465 });
setFrame(byId(slides[8], 33), { left: 735, top: 160, width: 410, height: 64 });
setFrame(byId(slides[8], 34), { left: 735, top: 250, width: 410, height: 250 });

setText(byId(slides[9], 4), "问题一案例：时代差异与《空城计》");
setText(byId(slides[9], 34), "三国题材中净、老生、丑居前，体现谋臣、君主、将帅和传令角色突出。《空城计》呈现“老生智谋核心-净行对抗压力-丑行辅助传信”的历史戏行当结构。");
await replaceImage(slides[9].images.items[0], `${IMG}/image-2.png`, "cover");
await replaceImage(slides[9].images.items[1], `${IMG}/image-3.png`, "cover");
await replaceImage(slides[9].images.items[0], `${IMG}/image-2.png`, "contain");
await replaceImage(slides[9].images.items[1], `${IMG}/image-3.png`, "contain");
setFrame(slides[9].images.items[0], { left: 650, top: 120, width: 505, height: 235 });
setFrame(slides[9].images.items[1], { left: 650, top: 385, width: 505, height: 235 });
setFrame(byId(slides[9], 4), { left: 95, top: 135, width: 470, height: 64 });
setFrame(byId(slides[9], 34), { left: 95, top: 225, width: 470, height: 285 });
setText(byId(slides[9], 31), "");

setText(byId(slides[10], 33), "问题二：角色关系网络");
setText(byId(slides[10], 34), "家庭戏重伦理中心，历史戏重阵营与权力，公案戏重案件聚合。权谋战争类平均角色数最高但密度较低，说明角色多、阵营多，却不是所有人物直接互动。");
await replaceImage(slides[10].images.items[0], `${IMG}/02-role-relation-overview.png`, "contain");
setFrame(slides[10].images.items[0], { left: 78, top: 130, width: 615, height: 465 });
setFrame(byId(slides[10], 33), { left: 735, top: 160, width: 410, height: 64 });
setFrame(byId(slides[10], 34), { left: 735, top: 250, width: 410, height: 250 });

setText(byId(slides[11], 33), "问题三：主题组合模式");
setText(byId(slides[11], 34), "家庭伦理 831 部、权谋战争 382 部、仕途功名 163 部，是最核心的三类主题。主题不是单一标签，而是以伦理秩序为基础，把战争、仕途、婚恋、公案和神怪组织起来。");
await replaceImage(slides[11].images.items[0], `${IMG}/image-4.png`, "contain");
setFrame(slides[11].images.items[0], { left: 78, top: 130, width: 615, height: 465 });
setFrame(byId(slides[11], 33), { left: 735, top: 160, width: 410, height: 64 });
setFrame(byId(slides[11], 34), { left: 735, top: 250, width: 410, height: 250 });

setText(byId(slides[12], 33), "问题四：叙事结构与节奏");
setText(byId(slides[12], 34), "叙事结构被归纳为五类：多峰冲突推进 612 部、单场集中型 291 部、四阶段型 281 部、高强度高潮型 262 部、转折收束型 27 部。历史戏重连续冲突，家庭戏重情感累积。");
await replaceImage(slides[12].images.items[0], `${IMG}/03-narrative-overview.png`, "contain");
setFrame(slides[12].images.items[0], { left: 78, top: 130, width: 615, height: 465 });
setFrame(byId(slides[12], 33), { left: 735, top: 160, width: 410, height: 64 });
setFrame(byId(slides[12], 34), { left: 735, top: 250, width: 410, height: 250 });

// 14. Integrated analysis
setText(byId(slides[13], 8), "综合关联：角色、主题与叙事如何协同\n\n三维空间共形成 84 种组合。家庭伦理 × 群像密集 × 单场集中显示：密集关系可压缩伦理表达；权谋战争 × 阵营互动 × 多峰推进显示：高冲突主题会借信息差展开为连续试探。\n\n《三娘教子》体现“小群体闭合-伦理冲突集中-单场完成”，《空城计》体现“阵营互动-信息差-多峰心理博弈”。");
setText(byId(slides[13], 12), "综合");
setText(byId(slides[13], 2), "关\n联");
await replaceImage(slides[13].images.items[0], `${IMG}/图2-典型组合三元关联.png`, "cover");
await replaceImage(slides[13].images.items[1], `${IMG}/空城计&三娘教子.png`, "cover");
await replaceImage(slides[13].images.items[0], `${IMG}/图2-典型组合三元关联.png`, "contain");
await replaceImage(slides[13].images.items[1], `${IMG}/空城计&三娘教子.png`, "contain");
setFrame(slides[13].images.items[0], { left: 74, top: 120, width: 535, height: 235 });
setFrame(slides[13].images.items[1], { left: 74, top: 380, width: 535, height: 235 });
setFrame(byId(slides[13], 8), { left: 650, top: 130, width: 540, height: 420 });
setText(byId(slides[13], 12), "");
setText(byId(slides[13], 2), "");

// Rebuild content images on top of template color blocks. Frames stay within the content area.
clearSlideImages(slides[4]);
await addImagePath(slides[4], `${IMG}/图1-三维综合总览.png`, { left: 88, top: 238, width: 1090, height: 398 });

clearSlideImages(slides[5]);
await addImagePath(slides[5], `${IMG}/01-overview-cube.png`, { left: 75, top: 120, width: 535, height: 230 });
await addImagePath(slides[5], `${IMG}/04-kongchengji-role-detail.png`, { left: 75, top: 370, width: 535, height: 230 });

clearSlideImages(slides[8]);
await addImagePath(slides[8], `${IMG}/image-1.png`, { left: 70, top: 128, width: 630, height: 470 });

clearSlideImages(slides[9]);
await addImagePath(slides[9], `${IMG}/image-2.png`, { left: 620, top: 118, width: 560, height: 230 });
await addImagePath(slides[9], `${IMG}/image-3.png`, { left: 620, top: 378, width: 560, height: 235 });

clearSlideImages(slides[10]);
await addImagePath(slides[10], `${IMG}/02-role-relation-overview.png`, { left: 70, top: 128, width: 630, height: 470 });

clearSlideImages(slides[11]);
await addImagePath(slides[11], `${IMG}/image-4.png`, { left: 70, top: 128, width: 630, height: 470 });

clearSlideImages(slides[12]);
await addImagePath(slides[12], `${IMG}/03-narrative-overview.png`, { left: 70, top: 128, width: 630, height: 470 });

clearSlideImages(slides[13]);
await addImagePath(slides[13], `${IMG}/图2-典型组合三元关联.png`, { left: 70, top: 122, width: 540, height: 235 });
await addImagePath(slides[13], `${IMG}/空城计&三娘教子.png`, { left: 70, top: 382, width: 540, height: 230 });

// 15. Summary, implementation, division
setText(byId(slides[14], 18), "技术实现：D3.js / Three.js / 原生 JS / Python 数据处理 / GitHub Pages 部署。系统以 JSON 数据驱动，支持主题、角色关系与叙事结构的联动分析。");
setText(byId(slides[14], 24), "结论：作品用交互式网站回答赛题五问，将京剧剧本文本转化为可探索的“主题-角色关系-叙事结构”三维分析空间；核心发现是密集关系可压缩伦理表达，高冲突主题会展开为多峰叙事。");
const table = slides[14].tables.items[0];
const values = [
  ["模块", "数据", "分析", "前端", "材料"],
  ["职责", "解析", "建模", "交互", "交付"],
  ["工具", "Python", "网络统计", "D3/Three", "PPT/视频"],
  ["产出", "1473剧本", "五问结论", "四层网站", "报告海报"],
  ["重点", "数据可信", "结构规律", "联动对比", "展示汇报"],
  ["网站", "GitHub", "ChinaVis", "在线演示", "答辩入口"],
];
table.setValues(values);

// Clear invisible template layout labels from the copied front slides so they do not appear in the PPT outline.
for (const slide of slides.slice(0, 15)) {
  for (const shape of slide.shapes.items) {
    const frame = shape.frame;
    const text = String(shape.text || "");
    if ((frame?.width === 0 || frame?.height === 0) && /版式/.test(text)) {
      setText(shape, "");
    }
  }
}

const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(OUT);
console.log(JSON.stringify({ output: OUT, slideCount: slides.length }, null, 2));
