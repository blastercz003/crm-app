import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve(process.cwd(), "outputs/prodejny-import-template");
const outputPath = path.join(outputDir, "Prodejny-import-sablona.xlsx");
const previewPath = path.join(outputDir, "Prodejny-import-sablona-import-sheet.png");

await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();

const instructionsSheet = workbook.worksheets.add("Pokyny");
const importSheet = workbook.worksheets.add("Import");

instructionsSheet.showGridLines = false;
importSheet.showGridLines = false;

const titleRange = instructionsSheet.getRange("A1:F1");
titleRange.merge();
titleRange.values = [["Sablona pro import sekce Prodejny"]];
titleRange.format.font = { bold: true, size: 16, color: "#0F172A" };
titleRange.format.fill = { color: "#DCEEFF" };
titleRange.format.horizontalAlignment = "center";
titleRange.format.verticalAlignment = "center";
titleRange.format.rowHeight = 28;

instructionsSheet.getRange("A3:B9").values = [
  ["Polozka", "Pravidlo"],
  ["Povinny soubor", "Kazdy klient ma vlastni soubor Excel."],
  ["Povinny list", "Data importu patri pouze do listu Import."],
  ["Povinne sloupce", "chain_name, store_number, city, address, phone_1"],
  ["Nepovinne sloupce", "phone_2, phone_3"],
  ["Povolene chain_name", "PENNY MARKET, LIDL, ALBERT, BILLA"],
  ["Jedna prodejna", "Jeden radek = jedna prodejna."],
];

instructionsSheet.getRange("A3:B3").format.font = { bold: true, color: "#0F172A" };
instructionsSheet.getRange("A3:B9").format.wrapText = true;
instructionsSheet.getRange("A3:B9").format.borders = {
  preset: "all",
  style: "thin",
  color: "#D9E2EC",
};
instructionsSheet.getRange("A3:B3").format.fill = { color: "#EAF4FF" };
instructionsSheet.getRange("A4:A9").format.font = { bold: true, color: "#334155" };

instructionsSheet.getRange("A11:B15").values = [
  ["Dulezite", "Poznamky"],
  ["Sloupce nemenit", "Nazvy sloupcu v listu Import musi zustat presne stejne."],
  ["Bez prazdnych radku", "Mezi zaznamy nenechavat prazdne radky."],
  ["Telefony", "phone_2 a phone_3 mohou zustat prazdne."],
  ["Validace", "Import nacte validni radky a chybne vypise bokem."],
];
instructionsSheet.getRange("A11:B15").format.wrapText = true;
instructionsSheet.getRange("A11:B15").format.borders = {
  preset: "all",
  style: "thin",
  color: "#D9E2EC",
};
instructionsSheet.getRange("A11:B11").format.font = { bold: true, color: "#0F172A" };
instructionsSheet.getRange("A11:B11").format.fill = { color: "#EAF4FF" };
instructionsSheet.getRange("A12:A15").format.font = { bold: true, color: "#334155" };

instructionsSheet.getRange("D3:F9").values = [
  ["Ukazka dat", null, null],
  ["chain_name", "store_number", "city"],
  ["LIDL", "1023", "Praha"],
  ["address", "phone_1", "phone_2"],
  ["Kolbenova 15", "+420777111222", "+420222333444"],
  [null, null, null],
  ["Poznamka", "Sloupce v listu Import jsou prazdne a pripravene k vyplneni.", null],
];
instructionsSheet.getRange("D3:F3").merge();
instructionsSheet.getRange("D3:F3").format.font = { bold: true, color: "#0F172A" };
instructionsSheet.getRange("D3:F3").format.fill = { color: "#EAF4FF" };
instructionsSheet.getRange("D4:F8").format.borders = {
  preset: "all",
  style: "thin",
  color: "#D9E2EC",
};
instructionsSheet.getRange("D4:F4").format.font = { bold: true, color: "#334155" };
instructionsSheet.getRange("D6:F6").format.font = { bold: true, color: "#334155" };
instructionsSheet.getRange("D9:F9").merge();
instructionsSheet.getRange("D9:F9").format.wrapText = true;
instructionsSheet.getRange("D9:F9").format.font = { italic: true, color: "#475569" };

instructionsSheet.getRange("A1:F15").format.verticalAlignment = "center";
instructionsSheet.getRange("A1:F15").format.autofitColumns();
instructionsSheet.getRange("A1:F15").format.autofitRows();
instructionsSheet.getRange("A:A").format.columnWidth = 22;
instructionsSheet.getRange("B:B").format.columnWidth = 48;
instructionsSheet.getRange("D:F").format.columnWidth = 22;

const headers = [["chain_name", "store_number", "city", "address", "phone_1", "phone_2", "phone_3"]];
importSheet.getRange("A1:G1").values = headers;
importSheet.getRange("A1:G1").format.font = { bold: true, color: "#0F172A" };
importSheet.getRange("A1:G1").format.fill = { color: "#DCEEFF" };
importSheet.getRange("A1:G1").format.horizontalAlignment = "center";
importSheet.getRange("A1:G2").format.borders = {
  preset: "all",
  style: "thin",
  color: "#D9E2EC",
};

importSheet.getRange("A2:G2").values = [["", "", "", "", "", "", ""]];
importSheet.getRange("A2:G2").format.fill = { color: "#FFFFFF" };

importSheet.getRange("A2:A5000").dataValidation = {
  rule: {
    type: "list",
    values: ["PENNY MARKET", "LIDL", "ALBERT", "BILLA"],
  },
};

importSheet.getRange("A:G").format.verticalAlignment = "center";
importSheet.getRange("A:G").format.wrapText = true;
importSheet.getRange("A:A").format.columnWidth = 20;
importSheet.getRange("B:B").format.columnWidth = 16;
importSheet.getRange("C:C").format.columnWidth = 20;
importSheet.getRange("D:D").format.columnWidth = 34;
importSheet.getRange("E:G").format.columnWidth = 18;
importSheet.getRange("A:G").setNumberFormat("@");
importSheet.freezePanes.freezeRows(1);

const importTable = importSheet.tables.add("A1:G2", true, "StoresImportTemplate");
importTable.style = "TableStyleMedium2";
importTable.showBandedColumns = false;
importTable.showFilterButton = true;

const importInspect = await workbook.inspect({
  kind: "table",
  range: "Import!A1:G3",
  include: "values",
  tableMaxRows: 3,
  tableMaxCols: 7,
});
console.log(importInspect.ndjson);

const preview = await workbook.render({
  sheetName: "Import",
  range: "A1:G12",
  scale: 2,
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(JSON.stringify({ outputPath, previewPath }));
