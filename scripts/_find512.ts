import ExcelJS from "exceljs";
const f = "/Users/ayi102/Library/CloudStorage/GoogleDrive-aismail102@gmail.com/My Drive/Rental/Finance/30831 Mitdown Ct (2022).xlsx";
const s=(v:any)=> v==null?"":typeof v==="string"?v:typeof v==="object"?(v.richText?v.richText.map((t:any)=>t.text).join(""):("result" in v?String(v.result??""):("text" in v?String(v.text):""))):String(v);
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(f);
  for (const name of ["Benefits","Cost Sheet Other"]) {
    const ws = wb.getWorksheet(name);
    console.log(`\n===== ${name} =====`);
    if (!ws) { console.log("(missing)"); continue; }
    ws.eachRow((row, rn) => {
      const vals = [1,2,3,4,5,6].map(c => s(row.getCell(c).value));
      if (vals.some(x=>x!=="")) console.log(`r${rn}: ${vals.join(" | ")}`);
    });
  }
})();
