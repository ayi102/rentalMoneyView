/**
 * Debug helper: dump the "Benefits" and "Cost Sheet Other" sheets of one workbook
 * so their layout can be inspected while working on the importer.
 *
 * Usage:
 *   npx tsx scripts/_find512.ts "/path/to/... (2022).xlsx"
 *   RENTAL_XLSX_FILE="/path/to/file.xlsx" npx tsx scripts/_find512.ts
 */
import ExcelJS from "exceljs";

const FILE = process.argv[2] || process.env.RENTAL_XLSX_FILE;

function str(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as {
      result?: unknown;
      richText?: { text: string }[];
      text?: string;
    };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if ("text" in o && o.text != null) return String(o.text);
    if ("result" in o) return String(o.result ?? "");
    return "";
  }
  return String(v);
}

async function main() {
  if (!FILE) {
    console.error(
      "Pass the .xlsx path as an argument, or set RENTAL_XLSX_FILE.",
    );
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);

  for (const name of ["Benefits", "Cost Sheet Other"]) {
    const ws = wb.getWorksheet(name);
    console.log(`\n===== ${name} =====`);
    if (!ws) {
      console.log("(missing)");
      continue;
    }
    ws.eachRow((row, rn) => {
      const vals = [1, 2, 3, 4, 5, 6].map((c) => str(row.getCell(c).value));
      if (vals.some((x) => x !== "")) console.log(`r${rn}: ${vals.join(" | ")}`);
    });
  }
}

main();
