import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const pptx = "D:/desktopSimu/Chinavis2026/汇报及答辩/答辩/outputs/ppt-answer-defense/template-starter.pptx";
const presentation = await PresentationFile.importPptx(await FileBlob.load(pptx));
const slides = Array.isArray(presentation.slides?.items) ? presentation.slides.items : Array.from({length:presentation.slides.count},(_,i)=>presentation.slides.getItem(i));
console.log('presentation keys', Object.keys(presentation));
console.log('slides', slides.length, 'slide keys', Object.keys(slides[0]));
console.log('slide proto', Object.getOwnPropertyNames(Object.getPrototypeOf(slides[0])));
const s=slides[0];
console.log('collections', {shapes: !!s.shapes, images: !!s.images, textboxes: !!s.textboxes});
for (const key of ['shapes','images','tables','charts']) {
  const col=s[key];
  console.log(key, col && Object.keys(col), col && Object.getOwnPropertyNames(Object.getPrototypeOf(col)));
  if (Array.isArray(col?.items)) console.log(key,'items',col.items.length, col.items[0] && Object.keys(col.items[0]), col.items[0] && Object.getOwnPropertyNames(Object.getPrototypeOf(col.items[0])));
}
const layout = await presentation.export({slide:s, format:'layout'});
console.log(String(Buffer.from(await layout.arrayBuffer()).toString('utf8')).slice(0,2000));