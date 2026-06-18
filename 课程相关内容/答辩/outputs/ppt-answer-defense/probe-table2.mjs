import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const p = await PresentationFile.importPptx(await FileBlob.load("D:/desktopSimu/Chinavis2026/汇报及答辩/答辩/outputs/ppt-answer-defense/template-starter.pptx"));
const t=p.slides.items[14].tables.items[0];
for (let r=0;r<t.rowCount;r++) { let arr=[]; for(let c=0;c<t.columnCount;c++){ const cell=t.getCell(r,c); arr.push(String(cell?.text||'')); if(r==0&&c==0) console.log('cell proto',Object.getOwnPropertyNames(Object.getPrototypeOf(cell)),Object.keys(cell),cell.data);} console.log(r, arr.join('|'));}