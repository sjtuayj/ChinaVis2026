import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const ROOT = "D:/desktopSimu/Chinavis2026/汇报及答辩/答辩";
const PPTX = process.env.DEFENSE_PPTX_IN || `${ROOT}/戏韵万象-京剧数据可视分析答辩.pptx`;
const OUT_DIR = `${ROOT}/outputs/ppt-answer-defense/final-preview`;

function slidesFromPresentation(presentation) {
  if (Array.isArray(presentation.slides?.items)) return presentation.slides.items;
  return Array.from({ length: presentation.slides.count }, (_, index) => presentation.slides.getItem(index));
}

async function saveBlob(blob, filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(await blob.arrayBuffer()));
}

const presentation = await PresentationFile.importPptx(await FileBlob.load(PPTX));
const slides = slidesFromPresentation(presentation);
await fs.rm(OUT_DIR, { recursive: true, force: true });
await fs.mkdir(OUT_DIR, { recursive: true });
for (let i = 0; i < Math.min(15, slides.length); i++) {
  const png = await presentation.export({ slide: slides[i], format: "png", scale: 1 });
  await saveBlob(png, `${OUT_DIR}/slide-${String(i + 1).padStart(2, "0")}.png`);
}
console.log(JSON.stringify({ outDir: OUT_DIR, rendered: Math.min(15, slides.length) }, null, 2));
