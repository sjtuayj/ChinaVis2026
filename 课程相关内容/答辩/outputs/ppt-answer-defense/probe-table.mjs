import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const pptx = "D:/desktopSimu/Chinavis2026/汇报及答辩/答辩/outputs/ppt-answer-defense/template-starter.pptx";
const p = await PresentationFile.importPptx(await FileBlob.load(pptx));
const t = p.slides.items[14].tables.items[0];
console.log('table keys', Object.getOwnPropertyNames(Object.getPrototypeOf(t)));
console.log('rowCount', t.rowCount, 'colCount', t.columnCount);
console.log('cells type', typeof t.cells, Object.keys(t.cells || {}), Object.getOwnPropertyNames(Object.getPrototypeOf(t.cells || {})));
for (let r=0;r<Math.min(t.rowCount,3);r++) for(let c=0;c<Math.min(t.columnCount,3);c++) { const cell=t.cells.getItem ? t.cells.getItem(r,c) : t.cells[r]?.[c]; console.log('cell',r,c, cell && Object.keys(cell), cell && Object.getOwnPropertyNames(Object.getPrototypeOf(cell)), 'text', String(cell?.text||'')); }