import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const pptx = "D:/desktopSimu/Chinavis2026/汇报及答辩/答辩/outputs/ppt-answer-defense/template-starter.pptx";
const presentation = await PresentationFile.importPptx(await FileBlob.load(pptx));
const slides = presentation.slides.items;
for (let idx=0; idx<15; idx++) {
  const s=slides[idx];
  console.log('--- slide', idx+1, 'shapes', s.shapes.items.length, 'images', s.images.items.length, 'tables', s.tables.items.length, 'charts', s.charts.items.length);
  for (const [i,sh] of s.shapes.items.entries()) {
    let txt='';
    try { txt=String(sh.text || ''); } catch(e) {}
    const pos=sh.position || sh.frame;
    console.log('shape', i, 'id', sh.id, 'name', sh.data?.name, 'pos', pos, 'text', JSON.stringify(txt.slice(0,120)), 'keys', Object.keys(sh));
    if (sh.text) console.log(' text proto', Object.getOwnPropertyNames(Object.getPrototypeOf(sh.text)).slice(0,40), 'fontSize', sh.text.fontSize, 'color', sh.text.color);
  }
  for (const [i,img] of s.images.items.entries()) {
    console.log('image', i, 'id', img.id, 'alt', img.alt, 'fit', img.fit, 'pos', img.position || img.frame, 'size', img.size);
  }
  for (const [i,t] of s.tables.items.entries()) console.log('table', i, 'id', t.id, 'keys', Object.getOwnPropertyNames(Object.getPrototypeOf(t)));
}