import fs from 'node:fs/promises';
import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const pptx = "D:/desktopSimu/Chinavis2026/汇报及答辩/答辩/outputs/ppt-answer-defense/template-starter.pptx";
const presentation = await PresentationFile.importPptx(await FileBlob.load(pptx));
const slides = presentation.slides.items;
const out=[];
function snap(o){ try { return o?.toSnapshot?.() ?? o?.toProto?.() ?? o; } catch { return o; } }
for (let idx=0; idx<15; idx++) {
  const s=slides[idx];
  const slide={slide:idx+1, shapes:[], images:[], tables:[], charts:[]};
  for (const [i,sh] of s.shapes.items.entries()) {
    slide.shapes.push({i, id:sh.id, name:sh.data?.name, text:String(sh.text||''), position:snap(sh.position), frame:snap(sh.frame), data:sh.data});
  }
  for (const [i,img] of s.images.items.entries()) slide.images.push({i,id:img.id,alt:img.alt,position:snap(img.position),frame:snap(img.frame),size:img.size,data:img.data});
  for (const [i,t] of s.tables.items.entries()) slide.tables.push({i,id:t.id,proto:Object.getOwnPropertyNames(Object.getPrototypeOf(t)),data:t.data});
  for (const [i,c] of s.charts.items.entries()) slide.charts.push({i,id:c.id,proto:Object.getOwnPropertyNames(Object.getPrototypeOf(c)),data:c.data});
  out.push(slide);
}
await fs.writeFile("D:/desktopSimu/Chinavis2026/汇报及答辩/答辩/outputs/ppt-answer-defense/probe-objects.json", JSON.stringify(out,null,2), 'utf8');
console.log('wrote', out.length);