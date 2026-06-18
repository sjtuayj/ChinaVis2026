import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const p = await PresentationFile.importPptx(await FileBlob.load("D:/desktopSimu/Chinavis2026/汇报及答辩/答辩/outputs/ppt-answer-defense/template-starter.pptx"));
const img=p.slides.items[4].images.items[0]; const shape=p.slides.items[0].shapes.items[3]; const table=p.slides.items[14].tables.items[0];
console.log('img.replace', img.replace.toString().slice(0,800));
console.log('images.add', p.slides.items[0].images.add.toString().slice(0,800));
console.log('shape text set', Object.getOwnPropertyDescriptor(Object.getPrototypeOf(shape),'text'));
console.log('table.setValues', table.setValues.toString().slice(0,500));
console.log('table.setCellValue', table.setCellValue.toString().slice(0,500));