import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const p=await PresentationFile.importPptx(await FileBlob.load("D:/desktopSimu/Chinavis2026/汇报及答辩/答辩/outputs/ppt-answer-defense/template-starter.pptx"));
const c=p.slides.items[3].charts.items[0];
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(c)));
console.log('id',c.id,'pos',c.position,'frame',c.frame,'snapshot',JSON.stringify(c.toSnapshot?.()).slice(0,1000),'data',JSON.stringify(c.data).slice(0,1000));